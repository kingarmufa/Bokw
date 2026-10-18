'use strict';
/*
 * CLOUD POOL — penyimpanan foto/video ke banyak project Supabase Storage.
 *
 * Prinsip "API jangan putus":
 *  1. Upload dicoba ke project Supabase berurutan (urutan = prioritas). Project yang penuh / error
 *     dilewati otomatis, lalu lanjut ke project berikutnya.
 *  2. Kalau SEMUA project gagal (penuh, down, belum diisi), file disimpan LOKAL di
 *     public/uploads/cloud/ supaya user tidak pernah kena error. Nanti dipindah otomatis
 *     ke Supabase oleh migrateLocal() begitu ada project yang sehat.
 *  3. Semua fungsi publik TIDAK PERNAH melempar error ke pemanggil (selalu hasil terstruktur).
 *  4. Tanpa dependency tambahan: memakai fetch bawaan Node 20+.
 *
 * Yang dipakai adalah Supabase Storage REST API. Pakai kunci "service_role" (atau "secret")
 * — kunci ini hanya ada di server, tidak pernah dikirim ke browser.
 */
const fs = require('fs');
const { serverless, dataRoot } = require('./vercel-runtime');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(dataRoot, 'public');
const LOCAL_ROOT = path.join(PUBLIC_DIR, 'uploads', 'cloud');
const UPLOAD_TIMEOUT_MS = 120000;
const QUOTA_COOLDOWN_MS = 30 * 60 * 1000;   // project yang kena error kuota dicoba lagi setelah 30 menit
const FAIL_COOLDOWN_MS = 60 * 1000;         // project error jaringan/5xx istirahat 1 menit
const FAIL_LIMIT = 3;                        // 3x gagal beruntun -> istirahat
const QUOTA_RE = /(quota|exceed|storage.*(limit|full)|payload too large|too large|maximum allowed|insufficient|no space)/i;

const MIME_EXT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov'
};
const EXT_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };

// Tipe TAMBAHAN (hanya dipakai kalau pemanggil mengizinkan lewat options.allowExtra, mis. lampiran chat).
// Postingan/story/reels tetap hanya foto & video karena memakai EXT_MIME saja.
const EXTRA_EXT_MIME = {
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.txt': 'text/plain',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac'
};

// ---- GitHub sebagai penyimpanan tambahan (Contents API). Repo HARUS public supaya foto/video bisa tampil.
const GH_API = 'https://api.github.com';
const GH_MAX_BYTES = 25 * 1024 * 1024;   // API Contents mengirim base64 lewat memori, jadi dibatasi 25 MB per file
const GH_RAW = 'https://raw.githubusercontent.com';
const isGithub = (p) => !!(p && p.provider === 'github');
const ghSeg = (s) => String(s).split('/').map(encodeURIComponent).join('/');
function ghHeaders(token) {
  return { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'averpay-gateway' };
}
// Repo boleh PRIVATE: file dilayani lewat server sendiri di /gh/{owner}/{repo}/{branch}/{path} (lihat route di lib/social.js).
function ghRawUrl(p, objPath) { return `/gh/${encodeURIComponent(p.owner)}/${encodeURIComponent(p.repo)}/${encodeURIComponent(p.branch || 'main')}/${ghSeg(objPath)}`; }
function parseGhUrl(url) {
  const m = String(url || '').match(/^\/gh\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/) || String(url || '').match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  if (!m) return null;
  try { return { owner: decodeURIComponent(m[1]), repo: decodeURIComponent(m[2]), branch: decodeURIComponent(m[3]), path: decodeURIComponent(m[4].split('?')[0]) }; } catch (e) { return null; }
}

function cleanFolder(f) { return String(f || 'misc').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30) || 'misc'; }
function cleanBase(u) { return String(u || '').trim().replace(/\/+$/, ''); }
function isJwt(key) { return /^eyJ/.test(String(key || '')); }
function authHeaders(key) {
  const h = { apikey: key };
  if (isJwt(key)) h.Authorization = 'Bearer ' + key; // kunci format baru (sb_secret_...) cukup lewat header apikey
  return h;
}
function publicUrl(p, objPath) {
  return `${cleanBase(p.url)}/storage/v1/object/public/${encodeURIComponent(p.bucket)}/${objPath.split('/').map(encodeURIComponent).join('/')}`;
}
function randomName(ext) {
  return Date.now().toString(36) + '_' + crypto.randomBytes(6).toString('hex') + ext;
}

class CloudPool {
  /**
   * store: {
   *   listProjects(): Promise<Project[]>, addUsage(id, deltaBytes), patchProject(id, patch),
   *   fileAdd(rec), fileGet(url), fileDel(url), fileListLocal(limit), fileUpdate(url, patch), relink(oldUrl, newUrl)
   * }
   */
  constructor(store) {
    this.store = store;
    this.cool = new Map();      // projectId -> timestamp sampai kapan dilewati
    this.fails = new Map();     // projectId -> jumlah gagal beruntun
    this.bucketOk = new Set();  // projectId:bucket yang sudah dipastikan ada
    this.migrating = false;
  }

  async _projects() {
    try { const list = await this.store.listProjects(); return Array.isArray(list) ? list : []; }
    catch (e) { return []; }
  }

  _usable(p, size) {
    if (!p || !p.enabled || !p.url || !p.key) return false;
    if (isGithub(p) && (!p.owner || !p.repo || size > GH_MAX_BYTES)) return false;
    const until = this.cool.get(String(p._id || p.id));
    if (until && until > Date.now()) return false;
    if (p.fullUntil && new Date(p.fullUntil).getTime() > Date.now()) return false;
    const max = (Number(p.maxMB) || 0) * 1024 * 1024;
    if (max > 0 && (Number(p.usedBytes) || 0) + size > max) return false;
    return true;
  }

  async _ensureBucket(p) {
    if (isGithub(p)) return;
    const k = String(p._id || p.id) + ':' + p.bucket;
    if (this.bucketOk.has(k)) return;
    const base = cleanBase(p.url);
    try {
      const r = await fetch(`${base}/storage/v1/bucket/${encodeURIComponent(p.bucket)}`, {
        headers: authHeaders(p.key), signal: AbortSignal.timeout(15000)
      });
      if (r.ok) { this.bucketOk.add(k); return; }
    } catch (e) { /* lanjut coba buat bucket */ }
    try {
      const r = await fetch(`${base}/storage/v1/bucket`, {
        method: 'POST',
        headers: { ...authHeaders(p.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.bucket, name: p.bucket, public: true, file_size_limit: 52428800 }),
        signal: AbortSignal.timeout(15000)
      });
      // 200 = dibuat, 409 = sudah ada (keduanya aman)
      if (r.ok || r.status === 409) this.bucketOk.add(k);
    } catch (e) { /* biarkan; upload akan memberi tahu kalau bucket memang belum ada */ }
  }

  _markFail(p, msg, quota) {
    const id = String(p._id || p.id);
    if (quota) {
      const until = new Date(Date.now() + QUOTA_COOLDOWN_MS);
      this.cool.set(id, until.getTime());
      this._patch(id, { fullUntil: until, lastError: String(msg).slice(0, 200) });
      return;
    }
    const n = (this.fails.get(id) || 0) + 1;
    this.fails.set(id, n);
    if (n >= FAIL_LIMIT) { this.cool.set(id, Date.now() + FAIL_COOLDOWN_MS); this.fails.set(id, 0); }
    this._patch(id, { lastError: String(msg).slice(0, 200) });
  }
  _markOk(p) {
    const id = String(p._id || p.id);
    this.fails.set(id, 0); this.cool.delete(id);
    this._patch(id, { lastOkAt: new Date(), lastError: '', fullUntil: null });
  }
  _patch(id, patch) { try { Promise.resolve(this.store.patchProject(id, patch)).catch(() => {}); } catch (e) { /* abaikan */ } }

  /** Satu percobaan upload ke satu project. Return {ok, url, path} atau {ok:false, quota, message}. */
  /** GitHub: PUT /repos/{owner}/{repo}/contents/{path}. Diantrekan per repo karena commit paralel ke branch yang sama memicu 409. */
  _putGithub(p, body, objPath) {
    const id = String(p._id || p.id);
    if (!this.ghQueue) this.ghQueue = new Map();
    const prev = this.ghQueue.get(id) || Promise.resolve();
    const run = prev.catch(() => {}).then(() => this._putGithubNow(p, body, objPath));
    this.ghQueue.set(id, run.catch(() => {}));
    return run;
  }
  async _putGithubNow(p, body, objPath) {
    let b64;
    try {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(await body.arrayBuffer());
      b64 = buf.toString('base64');
    } catch (e) { return { ok: false, quota: false, message: 'Gagal membaca file: ' + (e && e.message ? e.message : e) }; }
    const endpoint = `${GH_API}/repos/${encodeURIComponent(p.owner)}/${encodeURIComponent(p.repo)}/contents/${ghSeg(objPath)}`;
    const payload = JSON.stringify({ message: 'upload ' + objPath, content: b64, branch: p.branch || 'main' });
    b64 = null;
    let res, text = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await fetch(endpoint, { method: 'PUT', headers: { ...ghHeaders(p.key), 'Content-Type': 'application/json' }, body: payload, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
        text = await res.text().catch(() => '');
      } catch (e) { return { ok: false, quota: false, message: 'Koneksi ke GitHub gagal: ' + (e && e.message ? e.message : e) }; }
      if (res.status !== 409) break;                                  // 409 = commit bentrok, coba sekali lagi
      await new Promise(r => setTimeout(r, 800));
    }
    if (res.ok) return { ok: true, url: ghRawUrl(p, objPath), path: objPath };
    const quota = res.status === 429 || (res.status === 403 && /rate limit|abuse|secondary/i.test(text)) || res.status === 413 || /too large|storage|quota/i.test(text);
    return { ok: false, quota, status: res.status, message: `GitHub ${res.status}: ${text.slice(0, 160)}` };
  }

  async _putOne(p, buffer, objPath, contentType) {
    if (isGithub(p)) return this._putGithub(p, buffer, objPath);
    await this._ensureBucket(p);
    const base = cleanBase(p.url);
    const endpoint = `${base}/storage/v1/object/${encodeURIComponent(p.bucket)}/${objPath.split('/').map(encodeURIComponent).join('/')}`;
    let res, text = '';
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { ...authHeaders(p.key), 'Content-Type': contentType, 'Cache-Control': 'max-age=31536000', 'x-upsert': 'false' },
        body: buffer,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
      });
      text = await res.text().catch(() => '');
    } catch (e) {
      return { ok: false, quota: false, message: 'Koneksi ke Supabase gagal: ' + (e && e.message ? e.message : e) };
    }
    if (res.ok) return { ok: true, url: publicUrl(p, objPath), path: objPath };
    const quota = res.status === 413 || res.status === 507 || QUOTA_RE.test(text);
    if (res.status === 404 && /bucket/i.test(text)) this.bucketOk.delete(String(p._id || p.id) + ':' + p.bucket);
    return { ok: false, quota, status: res.status, message: `Supabase ${res.status}: ${text.slice(0, 160)}` };
  }

  /**
   * Upload buffer. options: { folder, ext, contentType, ownerId, remoteOnly }
   * Selalu resolve. Hasil: { ok:true, url, provider:'supabase'|'local', projectId, path, bytes }
   * Hanya {ok:false} kalau disk lokal pun gagal (sangat jarang) atau remoteOnly.
   */
  /** Upload dari path file di disk TANPA membaca seluruh isinya ke memori (Node 20+: fs.openAsBlob). */
  uploadFile(filePath, options = {}) { return this.upload({ file: filePath }, options); }

  async upload(input, options = {}) {
    const folder = cleanFolder(options.folder);
    let ext = String(options.ext || '').toLowerCase();
    const okExt = (e) => !!(EXT_MIME[e] || (options.allowExtra && EXTRA_EXT_MIME[e]));
    let contentType = options.contentType || EXT_MIME[ext] || (options.allowExtra && EXTRA_EXT_MIME[ext]) || 'application/octet-stream';
    if (!ext) ext = MIME_EXT[String(contentType).toLowerCase()] || '.bin';
    if (!okExt(ext)) return { ok: false, message: 'Tipe file tidak didukung.' };
    let buffer = input, size = 0, localSrc = null;
    if (input && typeof input === 'object' && !Buffer.isBuffer(input) && input.file) {
      localSrc = input.file;
      try { size = (await fs.promises.stat(localSrc)).size; } catch (e) { return { ok: false, message: 'File tidak ditemukan.' }; }
      if (!size) return { ok: false, message: 'File kosong.' };
      buffer = null;
      if (typeof fs.openAsBlob === 'function') { try { buffer = await fs.openAsBlob(localSrc, { type: contentType }); } catch (e) { buffer = null; } }
      if (!buffer) buffer = await fs.promises.readFile(localSrc);   // Node lama: terpaksa buffer
    } else {
      if (!Buffer.isBuffer(buffer) || !buffer.length) return { ok: false, message: 'File kosong.' };
      size = buffer.length;
    }
    const d = new Date();
    const objPath = `${folder}/${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}/${randomName(ext)}`;

    const projects = (await this._projects()).filter(p => this._usable(p, size) && (!options.provider || p.provider === options.provider));
    // Pembagian berdasarkan JENIS file: foto -> GitHub dulu, video (dan file lain: audio/dokumen) -> Supabase dulu,
    // karena video jauh lebih besar dari foto. Kalau penyimpanan utama penuh/error, otomatis pindah ke yang lain
    // (GitHub tetap otomatis dilewati untuk file > 25 MB, lihat _usable).
    const isImage = /^image\//i.test(String(contentType));
    const rank = (x) => (isImage ? (isGithub(x) ? 0 : 1) : (isGithub(x) ? 1 : 0));
    projects.sort((a, b) => rank(a) - rank(b) || (Number(a.order) || 0) - (Number(b.order) || 0));
    for (const p of projects) {
      const id = String(p._id || p.id);
      let r = await this._putOne(p, buffer, objPath, contentType);
      if (!r.ok && !r.quota) r = await this._putOne(p, buffer, objPath, contentType); // 1x ulang untuk gangguan sesaat
      if (r.ok) {
        this._markOk(p);
        try { await this.store.addUsage(id, size); } catch (e) { /* abaikan */ }
        try { await this.store.fileAdd({ url: r.url, provider: isGithub(p) ? 'github' : 'supabase', projectId: id, path: objPath, bytes: size, folder, ownerId: options.ownerId || null }); } catch (e) { /* abaikan */ }
        return { ok: true, url: r.url, provider: isGithub(p) ? 'github' : 'supabase', projectId: id, path: objPath, bytes: size };
      }
      this._markFail(p, r.message, r.quota);
      console.warn(`[cloud] project "${p.name}" gagal (${r.quota ? 'penuh/kuota' : 'error'}): ${r.message}`);
    }
    if (options.remoteOnly || serverless) return { ok: false, message: 'Tidak ada project Supabase yang siap.' };
    return this._putLocal(localSrc || buffer, folder, ext, size, options.ownerId);
  }

  async _putLocal(buffer, folder, ext, size, ownerId) {
    try {
      const dir = path.join(LOCAL_ROOT, folder);
      fs.mkdirSync(dir, { recursive: true });
      const name = randomName(ext);
      if (typeof buffer === 'string') fs.copyFileSync(buffer, path.join(dir, name)); // sumber = path file
      else fs.writeFileSync(path.join(dir, name), buffer);
      const url = `/uploads/cloud/${folder}/${name}`;
      try { await this.store.fileAdd({ url, provider: 'local', projectId: '', path: `${folder}/${name}`, bytes: size, folder, ownerId: ownerId || null }); } catch (e) { /* abaikan */ }
      return { ok: true, url, provider: 'local', projectId: '', path: `${folder}/${name}`, bytes: size };
    } catch (e) {
      return { ok: false, message: 'Gagal menyimpan file: ' + (e && e.message ? e.message : e) };
    }
  }

  /** Hapus file berdasarkan URL (Supabase atau lokal). Tidak pernah melempar error. */
  async remove(url) {
    try {
      if (typeof url !== 'string' || !url) return false;
      if (url.startsWith('/uploads/')) {
        const abs = path.resolve(PUBLIC_DIR, '.' + url);
        if (abs.startsWith(path.join(PUBLIC_DIR, 'uploads') + path.sep)) fs.unlink(abs, () => {});
        try { await this.store.fileDel(url); } catch (e) { /* abaikan */ }
        return true;
      }
      const gh = parseGhUrl(url);
      if (gh) return this._removeGithub(url, gh.owner, gh.repo, gh.branch, gh.path);
      const m = url.match(/^(https?:\/\/[^/]+)\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
      if (!m) return false;
      const origin = m[1];
      const bucket = decodeURIComponent(m[2]);
      const objPath = decodeURIComponent(m[3]);
      const projects = await this._projects();
      const p = projects.find(x => { try { return new URL(cleanBase(x.url)).origin === origin; } catch (e) { return false; } });
      if (!p) return false;
      const r = await fetch(`${cleanBase(p.url)}/storage/v1/object/${encodeURIComponent(bucket)}`, {
        method: 'DELETE',
        headers: { ...authHeaders(p.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [objPath] }),
        signal: AbortSignal.timeout(15000)
      });
      if (r.ok) {
        try {
          const rec = await this.store.fileGet(url);
          if (rec && rec.bytes) await this.store.addUsage(String(p._id || p.id), -rec.bytes);
          await this.store.fileDel(url);
        } catch (e) { /* abaikan */ }
      }
      return r.ok;
    } catch (e) { return false; }
  }

  /** Cari project GitHub berdasarkan owner/repo (tanpa peduli huruf besar-kecil). */
  async findGithub(owner, repo) {
    return (await this._projects()).find(x => isGithub(x) && String(x.owner).toLowerCase() === String(owner).toLowerCase() && String(x.repo).toLowerCase() === String(repo).toLowerCase()) || null;
  }
  /** Ambil isi file dari repo (private pun bisa) lewat token. Return { ok, buffer|null, status }. Batas 30 MB. */
  async fetchGithub(owner, repo, branch, objPath) {
    const p = await this.findGithub(owner, repo);
    if (!p) return { ok: false, status: 404 };
    const ep = `${GH_API}/repos/${encodeURIComponent(p.owner)}/${encodeURIComponent(p.repo)}/contents/${ghSeg(objPath)}?ref=${encodeURIComponent(branch)}`;
    const r = await fetch(ep, { headers: { ...ghHeaders(p.key), Accept: 'application/vnd.github.raw+json' }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) return { ok: false, status: r.status === 403 || r.status === 429 ? 503 : r.status };
    const len = Number(r.headers.get('content-length')) || 0;
    if (len > 30 * 1024 * 1024) return { ok: false, status: 413 };
    return { ok: true, response: r, project: p };
  }
  async fetchGithubBuffer(url) {
    const g = parseGhUrl(url); if (!g) return null;
    const r = await this.fetchGithub(g.owner, g.repo, g.branch, g.path);
    if (!r.ok) return null;
    return Buffer.from(await r.response.arrayBuffer());
  }

  async _removeGithub(url, owner, repo, branch, objPath) {
    const p = (await this._projects()).find(x => isGithub(x) && String(x.owner).toLowerCase() === owner.toLowerCase() && String(x.repo).toLowerCase() === repo.toLowerCase());
    if (!p) return false;
    const ep = `${GH_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${ghSeg(objPath)}`;
    const g = await fetch(`${ep}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders(p.key), signal: AbortSignal.timeout(15000) });
    if (!g.ok) return g.status === 404;
    const sha = (await g.json().catch(() => ({}))).sha;
    if (!sha) return false;
    const r = await fetch(ep, { method: 'DELETE', headers: { ...ghHeaders(p.key), 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hapus ' + objPath, sha, branch }), signal: AbortSignal.timeout(20000) });
    if (r.ok) {
      try {
        const rec = await this.store.fileGet(url);
        if (rec && rec.bytes) await this.store.addUsage(String(p._id || p.id), -rec.bytes);
        await this.store.fileDel(url);
      } catch (e) { /* abaikan */ }
    }
    return r.ok;
  }

  /** Tes koneksi satu project (dipakai tombol "Tes" di admin). */
  async test(p) {
    const out = { ok: false, message: '' };
    try {
      if (isGithub(p)) {
        if (!p.owner || !p.repo || !p.key) { out.message = 'Owner, repo, atau token belum diisi.'; return out; }
        const r = await fetch(`${GH_API}/repos/${encodeURIComponent(p.owner)}/${encodeURIComponent(p.repo)}`, { headers: ghHeaders(p.key), signal: AbortSignal.timeout(15000) });
        const j = await r.json().catch(() => ({}));
        if (r.status === 401) { out.message = 'Token GitHub salah atau kedaluwarsa (401).'; return out; }
        if (r.status === 404) { out.message = 'Repo tidak ditemukan, atau token tidak punya akses ke repo itu (404).'; return out; }
        if (!r.ok) { out.message = `GitHub ${r.status}: ${String(j.message || '').slice(0, 120)}`; return out; }
        if (j.permissions && j.permissions.push === false) { out.message = 'Token tidak punya izin tulis (Contents: Read and write).'; return out; }
        out.ok = true; out.message = `Terhubung ke ${j.full_name} (${j.private ? 'PRIVATE' : 'public'}, izin tulis OK).` + (j.private ? '' : ' Saran: ubah repo jadi private, file tetap tampil lewat server.');
        return out;
      }
      if (!p || !p.url || !p.key) { out.message = 'URL atau Key belum diisi.'; return out; }
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(cleanBase(p.url))) { out.message = 'Format URL harus https://xxxx.supabase.co'; return out; }
      const base = cleanBase(p.url);
      const r = await fetch(`${base}/storage/v1/bucket`, { headers: authHeaders(p.key), signal: AbortSignal.timeout(15000) });
      const t = await r.text().catch(() => '');
      if (!r.ok) { out.message = r.status === 401 || r.status === 403 ? 'Key ditolak. Pakai kunci service_role / secret, bukan anon/publishable.' : `Supabase ${r.status}: ${t.slice(0, 120)}`; return out; }
      this.bucketOk.delete(String(p._id || p.id) + ':' + p.bucket);
      await this._ensureBucket(p);
      out.ok = true; out.message = `Terhubung. Bucket "${p.bucket}" siap dipakai.`;
      return out;
    } catch (e) {
      out.message = 'Tidak bisa terhubung: ' + (e && e.message ? e.message : e);
      return out;
    }
  }

  /** Pindahkan file yang sempat tersimpan lokal ke Supabase (jalan berkala di background). */
  async migrateLocal(limit = 20) {
    if (this.migrating) return 0;
    this.migrating = true;
    let moved = 0;
    try {
      const anyReady = (await this._projects()).some(p => this._usable(p, 1));
      if (!anyReady) return 0;
      const recs = await this.store.fileListLocal(limit);
      for (const rec of recs) {
        try {
          const abs = path.resolve(PUBLIC_DIR, '.' + rec.url);
          if (!abs.startsWith(LOCAL_ROOT + path.sep) || !fs.existsSync(abs)) { await this.store.fileDel(rec.url); continue; }
          const ext = path.extname(abs).toLowerCase();
          const r = await this.uploadFile(abs, { folder: rec.folder, ext, ownerId: rec.ownerId, remoteOnly: true, allowExtra: true });
          if (!r.ok) break; // semua project sedang bermasalah, coba lagi nanti
          await this.store.relink(rec.url, r.url);
          await this.store.fileDel(rec.url);
          fs.unlink(abs, () => {});
          moved++;
        } catch (e) { /* lanjut file berikutnya */ }
      }
    } catch (e) { /* abaikan */ } finally { this.migrating = false; }
    return moved;
  }
}

module.exports = { isGithub, ghRawUrl, parseGhUrl, GH_MAX_BYTES, CloudPool, MIME_EXT, EXT_MIME, EXTRA_EXT_MIME, cleanFolder, LOCAL_ROOT };
