'use strict';
const { serverless, backgroundEnabled } = require('./vercel-runtime');
/*
 * FITUR SOSIAL ALA INSTAGRAM (postingan, like, komentar, share) + story digabung di satu halaman.
 * Judul/nama fitur diatur admin di /admin/social. Semua foto/video disimpan lewat CloudPool
 * (banyak project Supabase, otomatis pindah kalau penuh, fallback lokal supaya API tidak putus).
 *
 * Dipasang dari server.js:   social.install({ app, User, Story, isAuth, isAdmin, chatIsId, relinkTargets })
 */
const mongoose = require('mongoose');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { CloudPool, MIME_EXT, EXT_MIME, EXTRA_EXT_MIME, parseGhUrl } = require('./supabase-pool');

const { Schema } = mongoose;
const oid = (v) => mongoose.Types.ObjectId.isValid(String(v || '')) && String(v).length === 24;

// ---------------------------------------------------------------- MODEL
const CloudProject = mongoose.models.CloudProject || mongoose.model('CloudProject', new Schema({
  name: { type: String, default: 'Supabase' },
  url: { type: String, default: '' },
  key: { type: String, default: '' },
  bucket: { type: String, default: 'averpay' },
  provider: { type: String, enum: ['supabase', 'github'], default: 'supabase' },   // github: key = token, url = https://github.com/owner/repo
  owner: { type: String, default: '' },
  repo: { type: String, default: '' },
  branch: { type: String, default: 'main' },
  order: { type: Number, default: 0 },
  enabled: { type: Boolean, default: true },
  maxMB: { type: Number, default: 900 },        // batas pakai (paket gratis Supabase = 1 GB)
  usedBytes: { type: Number, default: 0 },
  fullUntil: { type: Date, default: null },
  lastError: { type: String, default: '' },
  lastOkAt: { type: Date, default: null },
  source: { type: String, default: 'admin' },
  createdAt: { type: Date, default: Date.now }
}));

const CloudFile = mongoose.models.CloudFile || mongoose.model('CloudFile', new Schema({
  url: { type: String, required: true, unique: true },
  provider: { type: String, default: 'local', index: true },
  projectId: { type: String, default: '' },
  path: { type: String, default: '' },
  bytes: { type: Number, default: 0 },
  folder: { type: String, default: '' },
  ownerId: { type: Schema.Types.ObjectId, default: null },
  createdAt: { type: Date, default: Date.now }
}));

const SocialConfig = mongoose.models.SocialConfig || mongoose.model('SocialConfig', new Schema({
  enabled: { type: Boolean, default: true },
  title: { type: String, default: 'AverGram' },
  subtitle: { type: String, default: 'Bagikan momen kamu ala komik' },
  allowComments: { type: Boolean, default: true },
  allowShare: { type: Boolean, default: true },
  maxMediaPerPost: { type: Number, default: 5 },
  maxPostsPerDay: { type: Number, default: 30 }
}));

const SocialPost = mongoose.models.SocialPost || mongoose.model('SocialPost', new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  caption: { type: String, default: '' },
  media: [{ _id: false, url: String, kind: { type: String, enum: ['image', 'video'], default: 'image' } }],
  likes: [{ type: Schema.Types.ObjectId }],
  likeCount: { type: Number, default: 0 },
  commentCount: { type: Number, default: 0 },
  sharedBy: [{ type: Schema.Types.ObjectId }],
  shareCount: { type: Number, default: 0 },
  repostCount: { type: Number, default: 0 },
  hidden: { type: Boolean, default: false },
  isReel: { type: Boolean, default: false, index: true },   // Reels = video dari menu REELS (tampil di tab Reels DAN di feed Home)
  createdAt: { type: Date, default: Date.now, index: true }
}));

// Repost: user memposting ulang postingan orang lain ke profilnya (1 user = 1 repost per postingan).
const SocialRepost = mongoose.models.SocialRepost || mongoose.model('SocialRepost', (() => {
  const sc = new Schema({
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    postId: { type: Schema.Types.ObjectId, required: true, index: true },
    createdAt: { type: Date, default: Date.now, index: true }
  });
  sc.index({ userId: 1, postId: 1 }, { unique: true });
  return sc;
})());

const SocialComment = mongoose.models.SocialComment || mongoose.model('SocialComment', new Schema({
  postId: { type: Schema.Types.ObjectId, required: true, index: true },
  userId: { type: Schema.Types.ObjectId, required: true },
  text: { type: String, default: '' },
  parentId: { type: Schema.Types.ObjectId, default: null, index: true },   // null = komentar utama, terisi = balasan (selalu menempel ke komentar utama)
  replyToUserId: { type: Schema.Types.ObjectId, default: null, index: true }, // user yang dibalas (untuk @mention & tab Komentar)
  replyCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
}));

// ---------------------------------------------------------------- CONFIG (cache 10 detik)
const CFG_DEFAULT = { enabled: true, title: 'AverGram', subtitle: 'Bagikan momen kamu ala komik', allowComments: true, allowShare: true, maxMediaPerPost: 5, maxPostsPerDay: 30 };
let cfgCache = null, cfgAt = 0;
async function getConfig(force) {
  if (!force && cfgCache && Date.now() - cfgAt < 10000) return cfgCache;
  try {
    let c = await SocialConfig.findOne().lean();
    if (!c) c = (await SocialConfig.create({})).toObject();
    cfgCache = { ...CFG_DEFAULT, ...c }; cfgAt = Date.now();
  } catch (e) { if (!cfgCache) cfgCache = { ...CFG_DEFAULT }; }
  return cfgCache;
}
/** Versi ringan untuk res.locals (menu/nav). Tidak pernah melempar error. */
async function getPublicConfig() {
  const c = await getConfig().catch(() => CFG_DEFAULT);
  return { enabled: !!c.enabled, title: c.title || CFG_DEFAULT.title, subtitle: c.subtitle || '' };
}

// ---------------------------------------------------------------- CLOUD POOL
const pool = new CloudPool({
  listProjects: async () => CloudProject.find().sort({ order: 1, createdAt: 1 }).lean(),
  addUsage: async (id, delta) => { if (oid(id)) await CloudProject.updateOne({ _id: id }, { $inc: { usedBytes: delta } }); },
  patchProject: async (id, patch) => { if (oid(id)) await CloudProject.updateOne({ _id: id }, { $set: patch }); },
  fileAdd: async (rec) => { await CloudFile.updateOne({ url: rec.url }, { $set: rec }, { upsert: true }); },
  fileGet: async (url) => CloudFile.findOne({ url }).lean(),
  fileDel: async (url) => { await CloudFile.deleteOne({ url }); },
  fileListLocal: async (limit) => CloudFile.find({ provider: 'local' }).sort({ createdAt: 1 }).limit(limit).lean(),
  relink: async (oldUrl, newUrl) => {
    for (const [Model, field] of relinkList) {
      try { await Model.updateMany({ [field]: oldUrl }, { $set: { [field]: newUrl } }); } catch (e) { /* abaikan */ }
    }
    try { await SocialPost.updateMany({ 'media.url': oldUrl }, { $set: { 'media.$[e].url': newUrl } }, { arrayFilters: [{ 'e.url': oldUrl }] }); } catch (e) { /* abaikan */ }
    try { if (relinkExtra && relinkExtra.apply) await relinkExtra.apply(oldUrl, newUrl); } catch (e) { /* abaikan */ }
  }
});
let relinkList = [];
let relinkExtra = null;   // { count(url), apply(old, new) } untuk field bersarang (mis. Ticket.messages.image)

// ---------------------------------------------------------------- HELPERS
function cleanText(v, max) {
  return String(v || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
function safeStr(v, max) { return String(v || '').replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max); }
function mask(k) { k = String(k || ''); return k.length <= 10 ? '••••' : k.slice(0, 6) + '••••••' + k.slice(-3); }
function displayNameOf(u) { return ((u && u.firstName) || '').trim() || (u && u.username) || ''; }
function userOut(u) {
  if (!u) return { id: '', username: 'user', displayName: 'user', avatarUrl: '', role: 'user' };
  return { id: String(u._id), username: u.username, displayName: displayNameOf(u), avatarUrl: u.avatarUrl || '', role: u.role || 'user' };
}
const hits = new Map();
function rateOk(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now); hits.set(key, arr); return true;
}
if (backgroundEnabled) setInterval(() => { const now = Date.now(); for (const [k, v] of hits) { const f = v.filter(t => now - t < 3600000); if (f.length) hits.set(k, f); else hits.delete(k); } }, 600000).unref();

const TMP_DIR = path.join(os.tmpdir(), 'averpay-social');
try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch (e) { /* abaikan */ }
function dropTmp(files) { (files || []).forEach(f => { if (f && f.path) fs.unlink(f.path, () => {}); }); }

/** Normalisasi MIME dari HP: Android/Chrome sering mengirim type kosong, application/octet-stream, atau video/x-m4v
 *  untuk video. Kalau MIME tidak dikenali, pakai ekstensi nama file. Mengubah file.mimetype supaya semua cek berikutnya konsisten. */
const EXT_ALIAS = { '.m4v': 'video/mp4', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
function fixMime(file) {
  let m = String((file && file.mimetype) || '').toLowerCase().trim();
  if (m === 'video/x-m4v' || m === 'video/x-quicktime') m = m === 'video/x-m4v' ? 'video/mp4' : 'video/quicktime';
  if (!MIME_EXT[m]) {
    const ext = path.extname((file && file.originalname) || '').toLowerCase();
    if (EXT_ALIAS[ext]) m = EXT_ALIAS[ext];
  }
  if (file) file.mimetype = m;
  return m;
}

/** Upload 1 file multer (disk) -> pool. Menghapus file sementara. Return {ok,url,kind,...}. */
async function saveFile(file, folder, ownerId) {
  try {
    if (!file || !file.path) return { ok: false, message: 'File tidak ada.' };
    const mime = fixMime(file);
    const ext = MIME_EXT[mime] || path.extname(file.originalname || '').toLowerCase();
    if (!EXT_MIME[ext]) return { ok: false, message: 'Format file tidak didukung.' };
    const r = await pool.uploadFile(file.path, { folder, ext, contentType: EXT_MIME[ext], ownerId });
    return { ...r, kind: /^video\//.test(EXT_MIME[ext]) ? 'video' : 'image' };
  } catch (e) {
    return { ok: false, message: 'Gagal menyimpan file.' };
  } finally { fs.unlink(file.path, () => {}); }
}
/** Middleware untuk upload lama (banner/promo): setelah multer, kirim ke pool dan isi req.file.cloudUrl. */
function cloudize(folder) {
  return async (req, res, next) => {
    try {
      if (req.file && req.file.path) {
        const local = req.file.path;
        const ext = path.extname(req.file.filename || local).toLowerCase();
        const r = await pool.uploadFile(local, { folder, ext, contentType: EXT_MIME[ext] || req.file.mimetype, ownerId: req.session && req.session.userId, remoteOnly: true });
        if (r.ok) { req.file.cloudUrl = r.url; fs.unlink(local, () => {}); }
        // kalau gagal: file tetap di disk lokal & alur lama jalan normal (tidak ada error ke user)
      }
    } catch (e) { /* abaikan, pakai file lokal */ }
    if (serverless && req.file && !req.file.cloudUrl) { fs.unlink(req.file.path, () => {}); const error = new Error('Cloud upload failed'); error.publicMessage = 'Upload gagal. Tambahkan project Supabase/GitHub aktif di pengaturan cloud.'; return next(error); }
    next();
  };
}
/** Versi fungsi (bukan middleware) untuk handler yang memanggil multer manual (avatar). Return URL atau ''. */
async function cloudizeFile(file, folder, ownerId) {
  try {
    if (!file || !file.path) return '';
    const ext = path.extname(file.filename || file.path).toLowerCase();
    const r = await pool.uploadFile(file.path, { folder, ext, contentType: EXT_MIME[ext] || file.mimetype, ownerId, remoteOnly: true });
    if (r.ok) { fs.unlink(file.path, () => {}); return r.url; }
  } catch (e) { /* handled below */ }
  if (serverless) { if (file && file.path) fs.unlink(file.path, () => {}); const error = new Error('Upload cloud gagal. Periksa pengaturan Supabase/GitHub.'); error.publicMessage = error.message; throw error; }
  return '';
}
/** Lampiran chat / bukti tiket (gambar, video, pdf, zip, dokumen, audio) -> Supabase, streaming dari disk.
 *  Sukses: file lokal dihapus & return URL Supabase. Gagal: return '' dan file lokal dibiarkan (alur lama tetap jalan). */
async function cloudizeAttachment(file, folder, ownerId) {
  try {
    if (!file || !file.path) return '';
    const ext = path.extname(file.filename || file.path).toLowerCase();
    const r = await pool.uploadFile(file.path, { folder, ext, contentType: EXT_MIME[ext] || EXTRA_EXT_MIME[ext] || file.mimetype, ownerId, remoteOnly: true, allowExtra: true });
    if (r.ok) { fs.unlink(file.path, () => {}); return r.url; }
  } catch (e) { /* handled below */ }
  if (serverless) { if (file && file.path) fs.unlink(file.path, () => {}); const error = new Error('Upload cloud gagal. Periksa pengaturan Supabase/GitHub.'); error.publicMessage = error.message; throw error; }
  return '';
}
function removeMedia(url) { return pool.remove(url); }

// ---------------------------------------------------------------- PROXY GITHUB (repo private)
// Browser tidak bisa membuka file di repo private, jadi server mengambilnya pakai token lalu meneruskannya.
// Disimpan sementara di cache disk (batas 150 MB, yang lama dibuang) supaya video bisa di-seek (Range) dan hemat kuota API.
const GH_CACHE_DIR = path.join(os.tmpdir(), 'averpay-gh-cache');
const GH_CACHE_MAX = 150 * 1024 * 1024;
try { fs.mkdirSync(GH_CACHE_DIR, { recursive: true }); } catch (e) { /* abaikan */ }
const ghInflight = new Map();
let ghLastTrim = 0;
async function ghTrimCache() {
  if (Date.now() - ghLastTrim < 60000) return; ghLastTrim = Date.now();
  try {
    const names = await fs.promises.readdir(GH_CACHE_DIR);
    const items = [];
    for (const n of names) { try { const st = await fs.promises.stat(path.join(GH_CACHE_DIR, n)); if (st.isFile()) items.push({ n, size: st.size, t: st.atimeMs || st.mtimeMs }); } catch (e) { /* abaikan */ } }
    let total = items.reduce((a, b) => a + b.size, 0);
    items.sort((a, b) => a.t - b.t);
    for (const it of items) { if (total <= GH_CACHE_MAX) break; await fs.promises.unlink(path.join(GH_CACHE_DIR, it.n)).catch(() => {}); total -= it.size; }
  } catch (e) { /* abaikan */ }
}
async function ghEnsureCached(g, key) {
  const file = path.join(GH_CACHE_DIR, key);
  try { const st = await fs.promises.stat(file); if (st.size > 0) { fs.promises.utimes(file, new Date(), st.mtime).catch(() => {}); return { file, size: st.size }; } } catch (e) { /* belum ada */ }
  if (ghInflight.has(key)) return ghInflight.get(key);
  const job = (async () => {
    const r = await pool.fetchGithub(g.owner, g.repo, g.branch, g.path);
    if (!r.ok) return { error: r.status || 502 };
    const buf = Buffer.from(await r.response.arrayBuffer());
    if (!buf.length) return { error: 404 };
    const tmp = file + '.' + process.pid + '.tmp';
    await fs.promises.writeFile(tmp, buf);
    await fs.promises.rename(tmp, file);
    ghTrimCache();
    return { file, size: buf.length };
  })().catch(() => ({ error: 502 })).finally(() => { ghInflight.delete(key); });
  ghInflight.set(key, job);
  return job;
}
/** GET /gh/:owner/:repo/:branch/* */
async function serveGithub(req, res) {
  try {
    const url = '/gh/' + req.params.owner + '/' + req.params.repo + '/' + req.params.branch + '/' + req.params[0];
    const g = parseGhUrl(url);
    if (!g || g.path.split('/').some(seg => !seg || seg === '.' || seg === '..')) return res.status(400).end();
    const ext = path.extname(g.path).toLowerCase();
    const mime = EXT_MIME[ext] || EXTRA_EXT_MIME[ext];
    if (!mime) return res.status(404).end();
    const key = require('crypto').createHash('sha1').update(g.owner.toLowerCase() + '/' + g.repo.toLowerCase() + '/' + g.branch + '/' + g.path).digest('hex') + ext;
    const got = await ghEnsureCached(g, key);
    if (got.error) return res.status(got.error === 404 ? 404 : (got.error === 413 ? 413 : 502)).end();
    let start = 0, end = got.size - 1, status = 200;
    const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (rg && (rg[1] || rg[2])) {
      if (rg[1] === '') { start = Math.max(0, got.size - parseInt(rg[2], 10)); }
      else { start = parseInt(rg[1], 10); if (rg[2]) end = Math.min(end, parseInt(rg[2], 10)); }
      if (start > end || start >= got.size) { res.set('Content-Range', 'bytes */' + got.size); return res.status(416).end(); }
      status = 206;
    }
    res.status(status);
    res.set({
      'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1),
      'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff'
    });
    if (!/^(image|video|audio)\//.test(mime)) res.set('Content-Disposition', 'attachment');   // dokumen: selalu unduh, jangan dieksekusi di browser
    if (status === 206) res.set('Content-Range', `bytes ${start}-${end}/${got.size}`);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(got.file, { start, end }).on('error', () => res.destroy()).pipe(res);
  } catch (e) { if (!res.headersSent) res.status(500).end(); }
}

// ---------------------------------------------------------------- INSTALL
function install(ctx) {
  const { app, User, Story, isAuth, isAdmin, chatIsId } = ctx;
  relinkList = ctx.relinkTargets || [];
  relinkExtra = ctx.relinkExtra || null;

  app.get('/gh/:owner/:repo/:branch/*', serveGithub);   // media dari repo GitHub (private) lewat server

  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
    console.error('[social]', req.method, req.path, e && e.message);
    if (res.headersSent) return;
    if (req.path.startsWith('/api/')) res.status(500).json({ success: false, message: 'Terjadi kesalahan di server, coba lagi.' });
    else { req.session.errorMsg = 'Terjadi kesalahan, coba lagi.'; res.redirect('/admin/social'); }
  });
  app.use('/api/social', (req, res, next) => { res.set('Cache-Control', 'no-store, max-age=0'); res.set('Pragma', 'no-cache'); next(); });
  const apiAuth = (req, res, next) => (req.session.userId ? next() : res.status(401).json({ success: false, message: 'Silakan login dulu.' }));
  const meOf = async (req) => {
    const me = await User.findById(req.session.userId).select('username firstName bio role avatarUrl suspended createdAt').lean();
    return me && !me.suspended ? me : null;
  };
  const isAdminReq = (req) => req.session.userRole === 'admin';

  // migrasi file lokal ke Supabase berkala (project Supabase disimpan di MongoDB, diatur dari menu admin)
  const boot = () => { getConfig(true).catch(() => {}); };
  if (mongoose.connection.readyState === 1) boot(); else mongoose.connection.once('open', boot);

  // ------------------------------------------------------------ AUTO BACKUP: server lokal -> Supabase / GitHub, lalu hapus salinan lokal
  // 1) file cadangan yang tersimpan sementara di public/uploads/cloud (pool.migrateLocal)
  // 2) file lama di folder upload lokal (story, avatar, banner, promo, chat, tiket) yang masih dirujuk database (sweepLegacy)
  // File lokal HANYA dihapus setelah upload sukses dan referensi di database sudah diarahkan ke URL cloud.
  const LEGACY_DIRS = ['stories', 'avatars', 'profile-banners', 'banners', 'promos', 'chat', 'tickets'];   // 'announcements' sengaja tidak: bot Telegram membaca file lokalnya
  const UPLOADS_ROOT = path.join(__dirname, '..', 'public', 'uploads');
  let sweeping = false;
  async function refCount(url) {
    let n = 0;
    for (const [Model, field] of relinkList) { try { n += await Model.countDocuments({ [field]: url }); } catch (e) { /* abaikan */ } }
    try { n += await SocialPost.countDocuments({ 'media.url': url }); } catch (e) { /* abaikan */ }
    try { if (relinkExtra && relinkExtra.count) n += await relinkExtra.count(url); } catch (e) { /* abaikan */ }
    return n;
  }
  async function sweepLegacy(limit) {
    if (sweeping) return { moved: 0, left: 0 };
    sweeping = true;
    let moved = 0, left = 0;
    try {
      const anyReady = (await pool._projects()).some(p => pool._usable(p, 1));
      if (!anyReady) return { moved: 0, left: 0 };
      for (const dir of LEGACY_DIRS) {
        let names = [];
        try { names = await fs.promises.readdir(path.join(UPLOADS_ROOT, dir)); } catch (e) { continue; }
        for (const name of names) {
          if (moved >= limit) return { moved, left };
          if (name.startsWith('.')) continue;
          const abs = path.join(UPLOADS_ROOT, dir, name);
          const ext = path.extname(name).toLowerCase();
          if (!EXT_MIME[ext] && !EXTRA_EXT_MIME[ext]) continue;
          let st; try { st = await fs.promises.stat(abs); } catch (e) { continue; }
          if (!st.isFile() || st.size === 0 || Date.now() - st.mtimeMs < 90 * 1000) continue;   // jangan sentuh file yang baru diupload
          const oldUrl = '/uploads/' + dir + '/' + name;
          if (!(await refCount(oldUrl))) { left++; continue; }                                    // tidak dirujuk database -> biarkan, jangan diunggah sia-sia
          const r = await pool.uploadFile(abs, { folder: dir, ext, remoteOnly: true, allowExtra: true });
          if (!r.ok) return { moved, left };                                                      // semua penyimpanan sedang bermasalah, coba lagi nanti
          await pool.store.relink(oldUrl, r.url);
          fs.unlink(abs, () => {});
          moved++;
        }
      }
    } catch (e) { console.warn('[cloud] sweepLegacy:', e && e.message); } finally { sweeping = false; }
    return { moved, left };
  }
  async function autoBackup(limit) {
    let a = 0, b = { moved: 0, left: 0 };
    try { a = await pool.migrateLocal(limit); } catch (e) { /* abaikan */ }
    try { b = await sweepLegacy(limit); } catch (e) { /* abaikan */ }
    if (a + b.moved > 0) console.log(`☁️  Auto backup: ${a + b.moved} file dipindah ke Supabase/GitHub dan dihapus dari server.`);
    return { moved: a + b.moved, left: b.left };
  }
  const startBackup = () => setTimeout(() => autoBackup(40).catch(() => {}), 20 * 1000).unref();
  if (backgroundEnabled) { if (mongoose.connection.readyState === 1) startBackup(); else mongoose.connection.once('open', startBackup); }
  if (backgroundEnabled) setInterval(() => { autoBackup(40).catch(() => {}); }, 5 * 60 * 1000).unref();

  // ------------------------------------------------------------ output helpers
  async function postsOut(rows, meId) {
    const ids = [...new Set(rows.map(r => String(r.userId)))];
    const users = ids.length ? await User.find({ _id: { $in: ids } }).select('username firstName role avatarUrl suspended').lean() : [];
    const byId = new Map(users.map(u => [String(u._id), u]));
    let repostedSet = new Set();
    if (meId && rows.length) {
      try {
        const mine = await SocialRepost.find({ userId: meId, postId: { $in: rows.map(r => r._id) } }).select('postId').lean();
        repostedSet = new Set(mine.map(x => String(x.postId)));
      } catch (e) { /* abaikan: tombol repost tetap jalan */ }
    }
    return rows.map(r => {
      const u = byId.get(String(r.userId));
      return {
        id: String(r._id), user: userOut(u), caption: r.caption || '', media: (r.media || []).map(m => ({ url: m.url, kind: m.kind })),
        likeCount: r.likeCount || 0, commentCount: r.commentCount || 0, shareCount: r.shareCount || 0,
        repostCount: Math.max(0, r.repostCount || 0), reposted: repostedSet.has(String(r._id)),
        liked: (r.likes || []).some(l => String(l) === String(meId)), mine: String(r.userId) === String(meId),
        isReel: !!r.isReel, createdAt: new Date(r.createdAt).getTime()
      };
    });
  }
  // daftar author yang boleh tampil (bukan suspended)
  async function visibleFilter(extra) { return { hidden: { $ne: true }, ...(extra || {}) }; }

  // ------------------------------------------------------------ PEMULIHAN POSTINGAN YATIM
  // File foto/video sudah tersimpan (Supabase/GitHub/lokal) tapi dokumen SocialPost-nya tidak ada di MongoDB
  // (mis. database ganti / gagal simpan / data terhapus). Kita buat ulang postingannya dari catatan file.
  const CLOUD_LOCAL_ROOT = path.join(__dirname, '..', 'public', 'uploads', 'cloud');
  let recovering = false;
  async function recoverPosts() {
    if (recovering) return { created: 0, orphans: 0 };
    recovering = true;
    let created = 0, orphans = 0;
    try {
      const cand = new Map();   // url -> { ownerId, createdAt, folder }
      const recs = await CloudFile.find({ folder: { $in: ['posts', 'reels'] }, ownerId: { $ne: null } }).select('url folder ownerId createdAt').lean();
      recs.forEach(r => cand.set(r.url, { ownerId: r.ownerId, createdAt: r.createdAt, folder: r.folder }));
      // file lokal yang tidak tercatat di CloudFile (catatan gagal disimpan) -> pemilik tidak diketahui, pakai admin
      let adminId = null;
      for (const folder of ['posts', 'reels']) {
        let names = []; try { names = await fs.promises.readdir(path.join(CLOUD_LOCAL_ROOT, folder)); } catch (e) { continue; }
        for (const name of names) {
          if (name.startsWith('.')) continue;
          const url = '/uploads/cloud/' + folder + '/' + name;
          if (cand.has(url) || !EXT_MIME[path.extname(name).toLowerCase()]) continue;
          if (!adminId) { const a = await User.findOne({ role: 'admin' }).select('_id').lean(); adminId = a && a._id; }
          let st; try { st = await fs.promises.stat(path.join(CLOUD_LOCAL_ROOT, folder, name)); } catch (e) { continue; }
          if (adminId) cand.set(url, { ownerId: adminId, createdAt: st.mtime, folder });
        }
      }
      const urls = [...cand.keys()];
      if (!urls.length) return { created: 0, orphans: 0 };
      const used = new Set();
      const have = await SocialPost.find({ 'media.url': { $in: urls } }).select('media.url').lean();
      have.forEach(d => (d.media || []).forEach(m => used.add(m.url)));
      const list = urls.filter(u => !used.has(u)).sort((a, b) => new Date(cand.get(a).createdAt) - new Date(cand.get(b).createdAt));
      orphans = list.length;
      for (const url of list) {
        const c = cand.get(url);
        const owner = await User.findById(c.ownerId).select('_id').lean();
        if (!owner) continue;                                              // pemilik sudah dihapus -> jangan dipulihkan
        const ext = path.extname(url.split('?')[0]).toLowerCase();
        const kind = /^video\//.test(EXT_MIME[ext] || '') ? 'video' : 'image';
        await SocialPost.create({ userId: owner._id, caption: '', media: [{ url, kind }], isReel: c.folder === 'reels' && kind === 'video', createdAt: c.createdAt || new Date() });
        created++;
      }
    } catch (e) { console.warn('[social] recoverPosts:', e && e.message); } finally { recovering = false; }
    if (created) console.log(`🛟 Social: ${created} postingan dipulihkan dari file yang sudah terupload.`);
    return { created, orphans };
  }
  // Data lama: reels yang tersimpan tanpa tanda isReel (foldernya 'reels') diberi tanda supaya masuk tab Reels.
  async function tagLegacyReels() {
    try { const r = await SocialPost.updateMany({ isReel: { $ne: true }, 'media.url': /\/reels\// }, { $set: { isReel: true } }); if (r && r.modifiedCount) console.log('[social] reels lama ditandai:', r.modifiedCount); } catch (e) { /* abaikan */ }
  }
  if (backgroundEnabled) setTimeout(() => tagLegacyReels(), 5000).unref();
  const startRecover = () => setTimeout(() => recoverPosts().catch(() => {}), 15 * 1000).unref();
  if (backgroundEnabled) { if (mongoose.connection.readyState === 1) startRecover(); else mongoose.connection.once('open', startRecover); }

  // Diagnosa cepat (khusus admin): buka /api/social/debug
  app.get('/api/social/debug', apiAuth, wrap(async (req, res) => {
    if (!isAdminReq(req)) return res.status(403).json({ success: false, message: 'Khusus admin.' });
    const [total, hidden, reels, feedVisible, files, filesPosts, localFiles, sample] = await Promise.all([
      SocialPost.countDocuments({}), SocialPost.countDocuments({ hidden: true }), SocialPost.countDocuments({ isReel: true }),
      SocialPost.countDocuments({ hidden: { $ne: true }, isReel: { $ne: true } }),
      CloudFile.countDocuments({}), CloudFile.countDocuments({ folder: 'posts' }), CloudFile.countDocuments({ provider: 'local' }),
      SocialPost.find().sort({ createdAt: -1 }).limit(3).select('userId media isReel hidden createdAt').lean()
    ]);
    res.json({ success: true, db: mongoose.connection.name, dbState: mongoose.connection.readyState, collection: SocialPost.collection.name, total, hidden, reels, feedVisible, cloudFiles: files, cloudFilePosts: filesPosts, localFiles, sample });
  }));

  // ------------------------------------------------------------ HALAMAN
  const renderPage = async (req, res, focusPost) => {
    const cfg = await getConfig();
    if (!cfg.enabled && !isAdminReq(req)) {
      req.session.errorMsg = 'Fitur ' + cfg.title + ' sedang dinonaktifkan admin.';
      return res.redirect(isAdminReq(req) ? '/admin/dashboard' : '/dashboard');
    }
    const me = await meOf(req);
    if (!me) return res.redirect('/login');
    res.render('social', {
      socialCfg: cfg, focusPost: focusPost || '', hideBottomNav: true,
      home: isAdminReq(req) ? '/admin/dashboard' : '/dashboard',
      editProfileUrl: isAdminReq(req) ? '/admin/account' : '/profile'
    });
  };
  app.get('/social', isAuth, wrap((req, res) => renderPage(req, res, '')));
  app.get('/lib', isAuth, (req, res) => res.redirect('/social'));
  app.get('/social/p/:id', isAuth, wrap((req, res) => renderPage(req, res, oid(req.params.id) ? req.params.id : '')));

  // ------------------------------------------------------------ API: FEED & POST
  app.get('/api/social/feed', apiAuth, wrap(async (req, res) => {
    const cfg = await getConfig();
    if (!cfg.enabled && !isAdminReq(req)) return res.json({ success: false, message: 'Fitur dinonaktifkan.' });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 8, 1), 20);
    const q = await visibleFilter();   // Home = beranda bebas: foto, video, DAN reels semuanya tampil
    const before = parseInt(req.query.before, 10);
    if (before > 0) q.createdAt = { $lt: new Date(before) };
    const rows = await SocialPost.find(q).select('-sharedBy').sort({ createdAt: -1 }).limit(limit + 1).lean();
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const items = await postsOut(page, req.session.userId);
    res.json({ success: true, posts: items, hasMore: more, next: page.length ? new Date(page[page.length - 1].createdAt).getTime() : 0 });
  }));

  app.get('/api/social/posts/:id', apiAuth, wrap(async (req, res) => {
    if (!oid(req.params.id)) return res.status(404).json({ success: false, message: 'Postingan tidak ditemukan.' });
    const p = await SocialPost.findOne({ _id: req.params.id, hidden: { $ne: true } }).lean();
    if (!p) return res.status(404).json({ success: false, message: 'Postingan tidak ditemukan.' });
    const [item] = await postsOut([p], req.session.userId);
    res.json({ success: true, post: item });
  }));

  const postUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, TMP_DIR),
      filename: (req, file, cb) => cb(null, 'p_' + Date.now() + '_' + crypto.randomBytes(5).toString('hex'))
    }),
    limits: { fileSize: serverless ? Math.floor(3.8 * 1024 * 1024) : 50 * 1024 * 1024, files: 8 },   // video maks. 50MB, foto maks. 25MB (dicek di handler)
    fileFilter: (req, file, cb) => (MIME_EXT[fixMime(file)] ? cb(null, true) : cb(new Error('Postingan hanya bisa foto (JPG/PNG/WEBP/GIF) atau video (MP4/WEBM/MOV).')))
  }).array('media', 8);

  app.post('/api/social/posts', apiAuth, (req, res) => {
    postUpload(req, res, async (err) => {
      const files = req.files || [];
      const fail = (code, message) => { dropTmp(files); return res.status(code).json({ success: false, message }); };
      if (err) return fail(400, err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran video maksimal 50MB (foto 25MB).' : (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT' ? 'Terlalu banyak file.' : (err.message || 'Gagal mengunggah file.')));
      try {
        const cfg = await getConfig();
        if (!cfg.enabled && !isAdminReq(req)) return fail(403, 'Fitur sedang dinonaktifkan admin.');
        const me = await meOf(req);
        if (!me) return fail(403, 'Akun ini tidak bisa memposting.');
        const caption = cleanText(req.body.caption, 500);
        if (!files.length && !caption) return fail(400, 'Isi foto atau tulisan dulu.');
        if (!files.length) return fail(400, 'Postingan wajib punya minimal 1 foto atau video. Untuk tulisan saja, pakai Story.');
        const maxMedia = Math.min(Math.max(parseInt(cfg.maxMediaPerPost, 10) || 5, 1), 8);
        if (files.length > maxMedia) return fail(400, `Maksimal ${maxMedia} foto/video per postingan.`);
        if (files.filter(f => /^video\//i.test(f.mimetype)).length > 1) return fail(400, 'Maksimal 1 video per postingan.');
        if (files.some(f => !/^video\//i.test(f.mimetype) && f.size > 25 * 1024 * 1024)) return fail(400, 'Ukuran foto maksimal 25MB.');
        if (!rateOk('post:' + me._id, 6, 10 * 60 * 1000)) return fail(429, 'Terlalu cepat. Tunggu beberapa menit lalu coba lagi.');
        const today = await SocialPost.countDocuments({ userId: me._id, createdAt: { $gt: new Date(Date.now() - 86400000) } });
        if (today >= (parseInt(cfg.maxPostsPerDay, 10) || 30)) return fail(429, 'Batas postingan harian tercapai. Coba lagi besok.');

        const media = [];
        for (const f of files) {
          const r = await saveFile(f, 'posts', me._id);
          if (!r.ok) { for (const m of media) pool.remove(m.url); dropTmp(files); console.error('[social] simpan media gagal:', r.message); return res.status(500).json({ success: false, message: r.message || 'Gagal menyimpan file.' }); }
          media.push({ url: r.url, kind: r.kind });
        }
        const doc = await SocialPost.create({ userId: me._id, caption, media });
        const [item] = await postsOut([doc.toObject()], me._id);
        res.json({ success: true, post: item });
      } catch (e) {
        console.error('[social] buat post:', e && e.message);
        fail(500, 'Gagal membuat postingan.');
      }
    });
  });

  app.post('/api/social/posts/:id/like', apiAuth, wrap(async (req, res) => {
    if (!oid(req.params.id)) return res.status(404).json({ success: false });
    if (!rateOk('like:' + req.session.userId, 60, 60 * 1000)) return res.status(429).json({ success: false, message: 'Terlalu cepat.' });
    const me = await meOf(req);
    if (!me) return res.status(403).json({ success: false, message: 'Akun tidak bisa memberi like.' });
    const id = req.params.id;
    const want = req.body && req.body.like === false ? false : (req.body && req.body.like === true ? true : null);
    const cur = await SocialPost.findOne({ _id: id, hidden: { $ne: true } }).select('likes').lean();
    if (!cur) return res.status(404).json({ success: false, message: 'Postingan tidak ditemukan.' });
    const has = (cur.likes || []).some(l => String(l) === String(me._id));
    const doLike = want === null ? !has : want;
    if (doLike && !has) await SocialPost.updateOne({ _id: id, likes: { $ne: me._id } }, { $addToSet: { likes: me._id }, $inc: { likeCount: 1 } });
    if (!doLike && has) await SocialPost.updateOne({ _id: id, likes: me._id }, { $pull: { likes: me._id }, $inc: { likeCount: -1 } });
    const p = await SocialPost.findById(id).select('likeCount').lean();
    const likeCount = Math.max(0, (p && p.likeCount) || 0);
    try { const io = app.get('io'); if (io) io.emit('post:like', { postId: String(id), likeCount, userId: String(me._id), liked: doLike }); } catch (e) { /* realtime opsional */ }
    res.json({ success: true, liked: doLike, likeCount });
  }));

  app.post('/api/social/posts/:id/share', apiAuth, wrap(async (req, res) => {
    const cfg = await getConfig();
    if (!cfg.allowShare) return res.json({ success: false, message: 'Share dinonaktifkan admin.' });
    if (!oid(req.params.id)) return res.status(404).json({ success: false });
    const id = req.params.id;
    await SocialPost.updateOne({ _id: id, hidden: { $ne: true }, sharedBy: { $ne: req.session.userId } }, { $addToSet: { sharedBy: req.session.userId }, $inc: { shareCount: 1 } });
    const p = await SocialPost.findOne({ _id: id, hidden: { $ne: true } }).select('shareCount').lean();
    if (!p) return res.status(404).json({ success: false, message: 'Postingan tidak ditemukan.' });
    const origin = (req.headers['x-forwarded-proto'] || req.protocol || 'https') + '://' + req.get('host');
    res.json({ success: true, shareCount: p.shareCount || 0, url: origin + '/social/p/' + id });
  }));

  // Repost / batal repost (toggle). Tidak bisa repost postingan sendiri.
  app.post('/api/social/posts/:id/repost', apiAuth, wrap(async (req, res) => {
    if (!oid(req.params.id)) return res.status(404).json({ success: false, message: 'Postingan tidak ditemukan.' });
    if (!rateOk('rp:' + req.session.userId, 30, 60 * 1000)) return res.status(429).json({ success: false, message: 'Terlalu cepat.' });
    const me = await meOf(req);
    if (!me) return res.status(403).json({ success: false, message: 'Akun tidak bisa repost.' });
    const id = req.params.id;
    const post = await SocialPost.findOne({ _id: id, hidden: { $ne: true } }).select('userId').lean();
    if (!post) return res.status(404).json({ success: false, message: 'Postingan tidak ditemukan.' });
    if (String(post.userId) === String(me._id)) return res.status(400).json({ success: false, message: 'Postingan sendiri tidak bisa di-repost.' });
    const has = await SocialRepost.exists({ userId: me._id, postId: id });
    const want = req.body && req.body.repost === false ? false : (req.body && req.body.repost === true ? true : null);
    const doRepost = want === null ? !has : want;
    if (doRepost && !has) {
      try { await SocialRepost.create({ userId: me._id, postId: id }); await SocialPost.updateOne({ _id: id }, { $inc: { repostCount: 1 } }); }
      catch (e) { if (!(e && e.code === 11000)) throw e; } // sudah ada (klik ganda) -> abaikan
    }
    if (!doRepost && has) {
      const r = await SocialRepost.deleteOne({ userId: me._id, postId: id });
      if (r && r.deletedCount) await SocialPost.updateOne({ _id: id }, { $inc: { repostCount: -1 } });
    }
    const p = await SocialPost.findById(id).select('repostCount').lean();
    res.json({ success: true, reposted: doRepost, repostCount: Math.max(0, (p && p.repostCount) || 0) });
  }));

  app.post('/api/social/posts/:id/delete', apiAuth, wrap(async (req, res) => {
    if (!oid(req.params.id)) return res.status(404).json({ success: false, message: 'Postingan tidak ditemukan.' });
    const p = await SocialPost.findById(req.params.id);
    if (!p) return res.status(404).json({ success: false, message: 'Postingan tidak ditemukan.' });
    if (String(p.userId) !== String(req.session.userId) && !isAdminReq(req)) return res.status(403).json({ success: false, message: 'Bukan postingan kamu.' });
    (p.media || []).forEach(m => pool.remove(m.url));
    await SocialComment.deleteMany({ postId: p._id });
    await SocialRepost.deleteMany({ postId: p._id });
    await p.deleteOne();
    res.json({ success: true });
  }));

  // ------------------------------------------------------------ API: KOMENTAR (+ BALASAN)
  // Balasan selalu menempel ke komentar utama (1 level, seperti Instagram). Membalas sebuah balasan
  // tetap masuk ke utas yang sama, dengan @mention ke orang yang dibalas.
  async function commentsOut(rows, req, postOwnerIds) {
    const uids = [...new Set(rows.flatMap(c => [String(c.userId), c.replyToUserId ? String(c.replyToUserId) : null]).filter(Boolean))];
    const users = uids.length ? await User.find({ _id: { $in: uids } }).select('username firstName role avatarUrl').lean() : [];
    const byId = new Map(users.map(u => [String(u._id), u]));
    const meId = String(req.session.userId);
    return rows.map(c => {
      const rt = c.replyToUserId ? byId.get(String(c.replyToUserId)) : null;
      return {
        id: String(c._id), text: c.text, createdAt: new Date(c.createdAt).getTime(), user: userOut(byId.get(String(c.userId))),
        parentId: c.parentId ? String(c.parentId) : '', replyCount: Math.max(0, c.replyCount || 0),
        replyTo: rt ? { id: String(rt._id), username: rt.username, displayName: displayNameOf(rt) } : null,
        canDelete: String(c.userId) === meId || isAdminReq(req) || !!(postOwnerIds && postOwnerIds.get(String(c.postId)) === meId)
      };
    });
  }
  async function ownersOf(postIds) {
    const ps = postIds.length ? await SocialPost.find({ _id: { $in: postIds } }).select('userId').lean() : [];
    return new Map(ps.map(p => [String(p._id), String(p.userId)]));
  }

  app.get('/api/social/posts/:id/comments', apiAuth, wrap(async (req, res) => {
    if (!oid(req.params.id)) return res.json({ success: false, comments: [] });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 60);
    const q = { postId: req.params.id, parentId: null };
    const before = parseInt(req.query.before, 10);
    if (before > 0) q.createdAt = { $lt: new Date(before) };
    const rows = await SocialComment.find(q).sort({ createdAt: -1 }).limit(limit + 1).lean();
    const more = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    const owners = await ownersOf([req.params.id]);
    res.json({ success: true, hasMore: more, next: page.length ? new Date(page[0].createdAt).getTime() : 0, comments: await commentsOut(page, req, owners) });
  }));

  app.get('/api/social/comments/:id/replies', apiAuth, wrap(async (req, res) => {
    if (!oid(req.params.id)) return res.json({ success: false, comments: [] });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 30);
    const q = { parentId: req.params.id };
    const after = parseInt(req.query.after, 10);
    if (after > 0) q.createdAt = { $gt: new Date(after) };
    const rows = await SocialComment.find(q).sort({ createdAt: 1 }).limit(limit + 1).lean();
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const root = await SocialComment.findById(req.params.id).select('postId').lean();
    const owners = await ownersOf(root ? [root.postId] : []);
    res.json({ success: true, hasMore: more, next: page.length ? new Date(page[page.length - 1].createdAt).getTime() : 0, comments: await commentsOut(page, req, owners) });
  }));

  app.post('/api/social/posts/:id/comments', apiAuth, wrap(async (req, res) => {
    const cfg = await getConfig();
    if (!cfg.allowComments) return res.json({ success: false, message: 'Komentar dinonaktifkan admin.' });
    if (!oid(req.params.id)) return res.status(404).json({ success: false, message: 'Postingan tidak ditemukan.' });
    const me = await meOf(req);
    if (!me) return res.status(403).json({ success: false, message: 'Akun tidak bisa berkomentar.' });
    const text = cleanText(req.body.text, 300).replace(/\n+/g, ' ');
    if (!text) return res.status(400).json({ success: false, message: 'Komentar tidak boleh kosong.' });
    if (!rateOk('cm:' + me._id, 20, 10 * 60 * 1000)) return res.status(429).json({ success: false, message: 'Terlalu cepat, tunggu sebentar.' });
    const post = await SocialPost.findOne({ _id: req.params.id, hidden: { $ne: true } }).select('userId').lean();
    if (!post) return res.status(404).json({ success: false, message: 'Postingan tidak ditemukan.' });

    // balasan: cari komentar yang dibalas, lalu tempelkan ke komentar utamanya
    let parentId = null, replyToUserId = null;
    if (req.body.parentId) {
      if (!oid(req.body.parentId)) return res.status(404).json({ success: false, message: 'Komentar yang dibalas tidak ditemukan.' });
      const target = await SocialComment.findOne({ _id: req.body.parentId, postId: req.params.id }).lean();
      if (!target) return res.status(404).json({ success: false, message: 'Komentar yang dibalas sudah dihapus.' });
      parentId = target.parentId || target._id;
      replyToUserId = target.userId;
    }
    const c = await SocialComment.create({ postId: req.params.id, userId: me._id, text, parentId, replyToUserId });
    if (parentId) await SocialComment.updateOne({ _id: parentId }, { $inc: { replyCount: 1 } });
    const upd = await SocialPost.findByIdAndUpdate(req.params.id, { $inc: { commentCount: 1 } }, { new: true }).select('commentCount').lean();
    const owners = new Map([[String(req.params.id), String(post.userId)]]);
    const [out] = await commentsOut([c.toObject()], req, owners);
    out.canDelete = true;
    // Notifikasi push: pemilik postingan (komentar baru) & pemilik komentar yang dibalas
    try {
      const push = app.get('push');
      if (push) {
        const who = displayNameOf(me) || 'Seseorang';
        const snippet = text.slice(0, 100);
        const url = '/social/p/' + req.params.id;
        const meId = String(me._id);
        const replied = replyToUserId ? String(replyToUserId) : '';
        if (replied && replied !== meId) {
          push.sendToUsers([replied], { title: '💬 ' + who + ' membalas komentarmu', body: snippet, url, tag: 'cm-' + req.params.id });
        }
        const owner = String(post.userId);
        if (owner !== meId && owner !== replied) {
          push.sendToUsers([owner], { title: '💬 ' + who + ' mengomentari postinganmu', body: snippet, url, tag: 'cm-' + req.params.id });
        }
      }
    } catch (e) { /* push opsional */ }
    res.json({ success: true, commentCount: (upd && upd.commentCount) || 0, comment: out });
  }));

  app.post('/api/social/comments/:id/delete', apiAuth, wrap(async (req, res) => {
    if (!oid(req.params.id)) return res.status(404).json({ success: false });
    const c = await SocialComment.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: 'Komentar tidak ditemukan.' });
    const post = await SocialPost.findById(c.postId).select('userId').lean();
    const allowed = String(c.userId) === String(req.session.userId) || isAdminReq(req) || (post && String(post.userId) === String(req.session.userId));
    if (!allowed) return res.status(403).json({ success: false, message: 'Tidak boleh menghapus komentar ini.' });
    let removed = 1;
    if (c.parentId) {
      await SocialComment.updateOne({ _id: c.parentId, replyCount: { $gt: 0 } }, { $inc: { replyCount: -1 } });
    } else {
      const r = await SocialComment.deleteMany({ parentId: c._id }); // komentar utama dihapus -> semua balasannya ikut
      removed += (r && r.deletedCount) || 0;
    }
    await c.deleteOne();
    const upd = await SocialPost.findByIdAndUpdate(c.postId, { $inc: { commentCount: -removed } }, { new: true }).select('commentCount').lean();
    res.json({ success: true, removed, commentCount: Math.max(0, (upd && upd.commentCount) || 0) });
  }));

  // ------------------------------------------------------------ API: TAB KOMENTAR (aktivitas)
  // tab=posts   -> komentar/balasan orang lain di postingan/reels milik saya
  // tab=replies -> balasan orang lain untuk komentar saya
  app.get('/api/social/activity', apiAuth, wrap(async (req, res) => {
    const meId = req.session.userId;
    const which = req.query.tab === 'replies' ? 'replies' : 'posts';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 40);
    const q = { userId: { $ne: meId } };
    if (which === 'replies') q.replyToUserId = meId;
    else {
      const mine = await SocialPost.find({ userId: meId }).select('_id').sort({ createdAt: -1 }).limit(500).lean();
      if (!mine.length) return res.json({ success: true, items: [], hasMore: false, next: 0 });
      q.postId = { $in: mine.map(m => m._id) };
    }
    const before = parseInt(req.query.before, 10);
    if (before > 0) q.createdAt = { $lt: new Date(before) };
    const rows = await SocialComment.find(q).sort({ createdAt: -1 }).limit(limit + 1).lean();
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const postIds = [...new Set(page.map(c => String(c.postId)))];
    const posts = postIds.length ? await SocialPost.find({ _id: { $in: postIds }, hidden: { $ne: true } }).select('userId media isReel').lean() : [];
    const pById = new Map(posts.map(p => [String(p._id), p]));
    const owners = new Map(posts.map(p => [String(p._id), String(p.userId)]));
    const outs = await commentsOut(page.filter(c => pById.has(String(c.postId))), req, owners);
    const rowById = new Map(page.map(c => [String(c._id), c]));
    const items = outs.map(o => {
      const c = rowById.get(o.id), p = pById.get(String(c.postId));
      return { ...o, postId: String(c.postId), isReel: !!p.isReel, cover: (p.media && p.media[0]) ? p.media[0] : null };
    });
    res.json({ success: true, items, hasMore: more, next: page.length ? new Date(page[page.length - 1].createdAt).getTime() : 0 });
  }));

  // ------------------------------------------------------------ API: REELS (khusus video)
  app.get('/api/social/reels', apiAuth, wrap(async (req, res) => {
    const cfg = await getConfig();
    if (!cfg.enabled && !isAdminReq(req)) return res.json({ success: false, message: 'Fitur dinonaktifkan.' });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 6, 1), 12);
    // Tab Reels = khusus video yang diupload lewat menu REELS (isReel). Reels ini tetap tampil juga di Home.
    const q = { hidden: { $ne: true }, isReel: true };
    const before = parseInt(req.query.before, 10);
    if (before > 0) q.createdAt = { $lt: new Date(before) };
    const rows = await SocialPost.find(q).select('-sharedBy').sort({ createdAt: -1 }).limit(limit + 1).lean();
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const items = (await postsOut(page, req.session.userId)).map(it => {
      const v = (it.media || []).find(m => m.kind === 'video');
      return { ...it, video: v ? v.url : '' };
    }).filter(it => it.video);
    res.json({ success: true, reels: items, hasMore: more, next: page.length ? new Date(page[page.length - 1].createdAt).getTime() : 0 });
  }));

  const reelUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, TMP_DIR),
      filename: (req, file, cb) => cb(null, 'r_' + Date.now() + '_' + crypto.randomBytes(5).toString('hex'))
    }),
    limits: { fileSize: serverless ? Math.floor(3.8 * 1024 * 1024) : 50 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => (/^video\/(mp4|webm|quicktime)$/i.test(fixMime(file)) ? cb(null, true) : cb(new Error('Reels hanya menerima video (MP4/WEBM/MOV).')))
  }).single('video');

  app.post('/api/social/reels', apiAuth, (req, res) => {
    reelUpload(req, res, async (err) => {
      const files = req.file ? [req.file] : [];
      const fail = (code, message) => { dropTmp(files); return res.status(code).json({ success: false, message }); };
      if (err) return fail(400, err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran video maksimal 50MB.' : (err.message || 'Gagal mengunggah video.'));
      try {
        const cfg = await getConfig();
        if (!cfg.enabled && !isAdminReq(req)) return fail(403, 'Fitur sedang dinonaktifkan admin.');
        const me = await meOf(req);
        if (!me) return fail(403, 'Akun ini tidak bisa memposting.');
        if (!req.file) return fail(400, 'Pilih 1 video dulu.');
        const caption = cleanText(req.body.caption, 500);
        if (!rateOk('post:' + me._id, 6, 10 * 60 * 1000)) return fail(429, 'Terlalu cepat. Tunggu beberapa menit lalu coba lagi.');
        const today = await SocialPost.countDocuments({ userId: me._id, createdAt: { $gt: new Date(Date.now() - 86400000) } });
        if (today >= (parseInt(cfg.maxPostsPerDay, 10) || 30)) return fail(429, 'Batas postingan harian tercapai. Coba lagi besok.');
        const r = await saveFile(req.file, 'reels', me._id);
        if (!r.ok) return res.status(500).json({ success: false, message: r.message || 'Gagal menyimpan video.' });
        if (r.kind !== 'video') { pool.remove(r.url); return res.status(400).json({ success: false, message: 'Reels hanya boleh video.' }); }
        const doc = await SocialPost.create({ userId: me._id, caption, media: [{ url: r.url, kind: 'video' }], isReel: true });
        const [item] = await postsOut([doc.toObject()], me._id);
        res.json({ success: true, reel: { ...item, video: r.url } });
      } catch (e) {
        console.error('[social] buat reels:', e && e.message);
        fail(500, 'Gagal membuat reels.');
      }
    });
  });

  // ------------------------------------------------------------ API: PROFIL
  app.get('/api/social/users/:id', apiAuth, wrap(async (req, res) => {
    const id = req.params.id === 'me' ? req.session.userId : req.params.id;
    if (!oid(id)) return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });
    const u = await User.findById(id).select('username firstName bio role avatarUrl bannerUrl suspended createdAt').lean();
    if (!u || u.suspended) return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });
    const [rows, totals, repostRows] = await Promise.all([
      SocialPost.find({ userId: u._id, hidden: { $ne: true } }).select('media likeCount commentCount createdAt isReel').sort({ createdAt: -1 }).limit(60).lean(),
      SocialPost.aggregate([{ $match: { userId: u._id, hidden: { $ne: true } } }, { $group: { _id: null, posts: { $sum: 1 }, likes: { $sum: '$likeCount' } } }]),
      SocialRepost.find({ userId: u._id }).sort({ createdAt: -1 }).limit(80).lean()
    ]);
    // postingan yang di-repost user ini (yang sudah dihapus/disembunyikan admin otomatis tidak tampil)
    let reposts = [];
    if (repostRows.length) {
      const orig = await SocialPost.find({ _id: { $in: repostRows.map(r => r.postId) }, hidden: { $ne: true } }).select('userId media likeCount commentCount').lean();
      const oById = new Map(orig.map(o => [String(o._id), o]));
      const authors = await User.find({ _id: { $in: [...new Set(orig.map(o => String(o.userId)))] }, suspended: { $ne: true } }).select('username').lean();
      const aById = new Map(authors.map(a => [String(a._id), a.username]));
      reposts = repostRows.map(r => oById.get(String(r.postId))).filter(o => o && aById.has(String(o.userId))).slice(0, 60)
        .map(o => ({ id: String(o._id), by: aById.get(String(o.userId)), cover: (o.media && o.media[0]) ? o.media[0] : null, count: (o.media || []).length, likeCount: o.likeCount || 0, commentCount: o.commentCount || 0 }));
    }
    const t = totals[0] || { posts: 0, likes: 0 };
    let group = null;
    try {
      const st = await Story.find({ userId: u._id, expiresAt: { $gt: new Date() } }).sort({ createdAt: 1 }).limit(20).lean();
      if (st.length) group = { hasStory: true, allSeen: st.every(s => String(u._id) === String(req.session.userId) || (s.viewers || []).some(v => String(v) === String(req.session.userId))) };
    } catch (e) { /* abaikan */ }
    res.json({
      success: true,
      user: { ...userOut(u), bio: u.bio || '', bannerUrl: u.bannerUrl || '', joinedAt: new Date(u.createdAt).getTime() },
      isSelf: String(u._id) === String(req.session.userId),
      stats: { posts: t.posts, likes: t.likes, reposts: reposts.length },
      story: group,
      reposts,
      posts: rows.map(r => ({ id: String(r._id), isReel: !!r.isReel, cover: (r.media && r.media[0]) ? r.media[0] : null, count: (r.media || []).length, likeCount: r.likeCount || 0, commentCount: r.commentCount || 0 }))
    });
  }));

  // ------------------------------------------------------------ ADMIN
  const projectOut = (p) => ({
    id: String(p._id), name: p.name, url: p.url, keyMask: mask(p.key), bucket: p.bucket, order: p.order, provider: p.provider || 'supabase', owner: p.owner || '', repo: p.repo || '', branch: p.branch || 'main', enabled: !!p.enabled,
    maxMB: p.maxMB, usedMB: Math.round(((p.usedBytes || 0) / 1048576) * 10) / 10, percent: p.maxMB ? Math.min(100, Math.round(((p.usedBytes || 0) / (p.maxMB * 1048576)) * 100)) : 0,
    full: !!(p.fullUntil && new Date(p.fullUntil) > new Date()) || (p.maxMB > 0 && (p.usedBytes || 0) >= p.maxMB * 1048576),
    lastError: p.lastError || '', lastOkAt: p.lastOkAt ? new Date(p.lastOkAt).getTime() : 0, source: p.source
  });

  app.get('/admin/social', isAuth, isAdmin, wrap(async (req, res) => {
    const [cfg, projects, posts, stats, localFiles] = await Promise.all([
      getConfig(true),
      CloudProject.find().sort({ order: 1, createdAt: 1 }).lean(),
      SocialPost.find().sort({ createdAt: -1 }).limit(30).lean(),
      Promise.all([SocialPost.countDocuments(), SocialComment.countDocuments(), CloudFile.countDocuments()]),
      CloudFile.countDocuments({ provider: 'local' })
    ]);
    const outPosts = await postsOut(posts, req.session.userId);
    const hiddenMap = new Map(posts.map(p => [String(p._id), !!p.hidden]));
    outPosts.forEach(p => { p.hidden = hiddenMap.get(p.id); });
    res.render('admin_social', {
      cfg, projects: projects.map(projectOut), posts: outPosts,
      stats: { posts: stats[0], comments: stats[1], files: stats[2], localFiles }
    });
  }));

  app.post('/admin/social/config', isAuth, isAdmin, wrap(async (req, res) => {
    const b = req.body || {};
    const title = safeStr(b.title, 30) || CFG_DEFAULT.title;
    const patch = {
      enabled: b.enabled === 'on' || b.enabled === 'true',
      title,
      subtitle: safeStr(b.subtitle, 80),
      allowComments: b.allowComments === 'on' || b.allowComments === 'true',
      allowShare: b.allowShare === 'on' || b.allowShare === 'true',
      maxMediaPerPost: Math.min(Math.max(parseInt(b.maxMediaPerPost, 10) || 5, 1), 8),
      maxPostsPerDay: Math.min(Math.max(parseInt(b.maxPostsPerDay, 10) || 30, 1), 500)
    };
    let c = await SocialConfig.findOne();
    if (!c) c = new SocialConfig();
    c.set(patch); await c.save();
    await getConfig(true);
    req.session.successMsg = 'Pengaturan ' + title + ' disimpan.';
    res.redirect('/admin/social');
  }));

  const projFromBody = (b) => {
    const url = String(b.url || '').trim().replace(/\/+$/, '');
    const bucket = String(b.bucket || 'averpay').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'averpay';
    return {
      name: safeStr(b.name, 40) || 'Supabase', url, bucket,
      order: parseInt(b.order, 10) || 0, enabled: b.enabled === 'on' || b.enabled === 'true',
      maxMB: Math.min(Math.max(parseInt(b.maxMB, 10) || 900, 10), 1024 * 1024)
    };
  };
  // ---- GitHub: token + owner + repo (+ branch). Bisa ditambah lebih dari satu repo.
  const ghName = (v, max) => String(v || '').trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, max);
  const ghBranch = (v) => String(v || 'main').trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 60) || 'main';
  app.post('/admin/social/github', isAuth, isAdmin, wrap(async (req, res) => {
    const b = req.body || {};
    const owner = ghName(b.owner, 39), repo = ghName(b.repo, 100), branch = ghBranch(b.branch);
    const token = String(b.token || '').trim();
    if (!owner || !repo) { req.session.errorMsg = 'Owner dan nama repo GitHub wajib diisi.'; return res.redirect('/admin/social'); }
    if (!/^(ghp_|github_pat_|gho_|ghs_|ghu_)?[A-Za-z0-9_]{20,}$/.test(token)) { req.session.errorMsg = 'Token GitHub tidak valid. Pakai Personal Access Token (izin Contents: Read and write).'; return res.redirect('/admin/social'); }
    const url = `https://github.com/${owner}/${repo}`;
    if (await CloudProject.findOne({ url })) { req.session.errorMsg = 'Repo itu sudah terdaftar.'; return res.redirect('/admin/social'); }
    const count = await CloudProject.countDocuments();
    await CloudProject.create({
      provider: 'github', name: safeStr(b.name, 40) || `GitHub ${owner}/${repo}`, url, key: token, owner, repo, branch,
      bucket: 'github', order: parseInt(b.order, 10) || count + 1, enabled: true,
      maxMB: Math.min(Math.max(parseInt(b.maxMB, 10) || 900, 10), 1024 * 1024)
    });
    req.session.successMsg = 'Repo GitHub ditambahkan. Klik "Tes" untuk memastikan terhubung.';
    res.redirect('/admin/social');
  }));
  app.post('/admin/social/projects', isAuth, isAdmin, wrap(async (req, res) => {
    const p = projFromBody(req.body || {});
    const key = String(req.body.key || '').trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(p.url)) { req.session.errorMsg = 'URL project harus seperti https://abcdxyz.supabase.co'; return res.redirect('/admin/social'); }
    if (key.length < 20) { req.session.errorMsg = 'Key belum diisi / terlalu pendek. Pakai service_role atau secret key.'; return res.redirect('/admin/social'); }
    if (await CloudProject.findOne({ url: p.url })) { req.session.errorMsg = 'Project dengan URL itu sudah ada.'; return res.redirect('/admin/social'); }
    const count = await CloudProject.countDocuments();
    await CloudProject.create({ ...p, key, enabled: true, order: p.order || count + 1 });
    req.session.successMsg = 'Project Supabase ditambahkan. Klik "Tes" untuk memastikan terhubung.';
    res.redirect('/admin/social');
  }));
  app.post('/admin/social/projects/:id/update', isAuth, isAdmin, wrap(async (req, res) => {
    if (!oid(req.params.id)) return res.redirect('/admin/social');
    const p = projFromBody(req.body || {});
    const cur = await CloudProject.findById(req.params.id).lean();
    if (!cur) return res.redirect('/admin/social');
    const set = { name: p.name, order: p.order, enabled: p.enabled, maxMB: p.maxMB };
    const key = String(req.body.key || '').trim();
    if (key) set.key = key;
    if (cur.provider === 'github') {
      const owner = ghName(req.body.owner, 39), repo = ghName(req.body.repo, 100);
      if (owner && repo) { set.owner = owner; set.repo = repo; set.url = `https://github.com/${owner}/${repo}`; }
      set.branch = ghBranch(req.body.branch);
    } else {
      set.bucket = p.bucket;
      if (/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(p.url)) set.url = p.url;
    }
    await CloudProject.updateOne({ _id: req.params.id }, { $set: set });
    req.session.successMsg = 'Project diperbarui.';
    res.redirect('/admin/social');
  }));
  app.post('/admin/social/projects/:id/reset', isAuth, isAdmin, wrap(async (req, res) => {
    if (oid(req.params.id)) {
      // hitung ulang pemakaian dari catatan file + bersihkan status penuh/error
      const agg = await CloudFile.aggregate([{ $match: { projectId: String(req.params.id) } }, { $group: { _id: null, bytes: { $sum: '$bytes' } } }]);
      await CloudProject.updateOne({ _id: req.params.id }, { $set: { usedBytes: agg[0] ? agg[0].bytes : 0, fullUntil: null, lastError: '' } });
      pool.cool.delete(String(req.params.id)); pool.fails.delete(String(req.params.id));
    }
    req.session.successMsg = 'Status project di-reset & pemakaian dihitung ulang.';
    res.redirect('/admin/social');
  }));
  app.post('/admin/social/projects/:id/delete', isAuth, isAdmin, wrap(async (req, res) => {
    if (oid(req.params.id)) await CloudProject.deleteOne({ _id: req.params.id });
    req.session.successMsg = 'Project dihapus dari daftar (file di Supabase / GitHub tidak ikut terhapus).';
    res.redirect('/admin/social');
  }));
  app.post('/admin/social/projects/:id/test', isAuth, isAdmin, wrap(async (req, res) => {
    if (!oid(req.params.id)) return res.json({ success: false, message: 'ID tidak valid.' });
    const p = await CloudProject.findById(req.params.id).lean();
    if (!p) return res.json({ success: false, message: 'Project tidak ditemukan.' });
    const r = await pool.test(p);
    await CloudProject.updateOne({ _id: p._id }, { $set: r.ok ? { lastOkAt: new Date(), lastError: '', fullUntil: null } : { lastError: r.message.slice(0, 200) } });
    res.json({ success: r.ok, message: r.message });
  }));
  app.post('/admin/social/recover', isAuth, isAdmin, wrap(async (req, res) => {
    const r = await recoverPosts();
    res.json({ success: true, created: r.created, message: r.created ? `${r.created} postingan berhasil dipulihkan dari file yang sudah terupload.` : (r.orphans ? 'File ditemukan tapi pemiliknya sudah tidak ada.' : 'Tidak ada file yatim. Semua file sudah punya postingan.') });
  }));
  app.post('/admin/social/migrate', isAuth, isAdmin, wrap(async (req, res) => {
    const r = await autoBackup(200);
    res.json({ success: true, moved: r.moved, message: r.moved ? `${r.moved} file dipindah ke Supabase/GitHub dan dihapus dari server.` : 'Tidak ada file yang dipindah (semua sudah di cloud, atau belum ada Supabase/GitHub yang siap).' });
  }));

  app.post('/admin/social/posts/:id/hide', isAuth, isAdmin, wrap(async (req, res) => {
    if (oid(req.params.id)) { const p = await SocialPost.findById(req.params.id); if (p) { p.hidden = !p.hidden; await p.save(); } }
    res.redirect('/admin/social#posts');
  }));
  app.post('/admin/social/posts/:id/delete', isAuth, isAdmin, wrap(async (req, res) => {
    if (oid(req.params.id)) {
      const p = await SocialPost.findById(req.params.id);
      if (p) { (p.media || []).forEach(m => pool.remove(m.url)); await SocialComment.deleteMany({ postId: p._id }); await SocialRepost.deleteMany({ postId: p._id }); await p.deleteOne(); }
    }
    req.session.successMsg = 'Postingan dihapus.';
    res.redirect('/admin/social#posts');
  }));
}

module.exports = { serveGithub, install, getPublicConfig, getConfig, cloudize, cloudizeFile, cloudizeAttachment, saveFile, removeMedia, pool, CloudFile, CloudProject };
