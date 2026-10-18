// AI Groq — https://console.groq.com/docs
const zlib = require('zlib');
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-20b'];
const DEFAULT_SUGGESTIONS = [
  'Saldo saya tertahan, kenapa dan kapan cair?',
  'Kenapa deposit saya belum masuk?',
  'Bagaimana cara tarik saldo?',
  'Cara pakai API dari dokumentasi?'
];

function isLegacyProvider(url) {
  try { return /(^|\.)(openrouter\.ai|apmix\.ai)$/.test(new URL(String(url)).hostname); } catch (_) { return false; }
}
function normalizeBaseUrl(url) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u) || isLegacyProvider(u)) return DEFAULT_BASE_URL;
  try {
    const parsed = new URL(u);
    if (['api.groq.com', 'console.groq.com', 'groq.com', 'www.groq.com'].includes(parsed.hostname)) return DEFAULT_BASE_URL;
  } catch (_) { return DEFAULT_BASE_URL; }
  return u;
}
function migrateLegacySettings(settings) {
  if (!isLegacyProvider(settings.aiApiBaseUrl)) return false;
  settings.aiApiBaseUrl = DEFAULT_BASE_URL;
  settings.aiApiKey = ''; // Kunci provider lama tidak dikirim ke Groq.
  settings.aiModels = DEFAULT_MODELS.join('\n');
  settings.aiDefaultModel = DEFAULT_MODELS[0];
  return true;
}

// Terima teks (satu model per baris / dipisah koma) -> array model unik & valid.
function parseModelList(text) {
  const seen = new Set(); const out = [];
  String(text || '').split(/[\n,;]+/).forEach((s) => {
    s = s.trim();
    if (s && /^~?[A-Za-z0-9._\/:+-]{1,100}$/.test(s) && !seen.has(s)) { seen.add(s); out.push(s); }
  });
  return out.slice(0, 80);
}
function parseLines(text, max = 8, len = 120) {
  return String(text || '').split('\n').map((s) => s.trim().slice(0, len)).filter(Boolean).slice(0, max);
}

// Error Groq: https://console.groq.com/docs/errors
const ERR_BY_STATUS = {
  401: 'API Key AI tidak valid atau sudah dihapus. Hubungi admin.',
  402: 'Kredit layanan AI tidak mencukupi. Hubungi admin.',
  403: 'Permintaan ditolak (konten terkena moderasi atau model tidak diizinkan). Ubah pesan atau pilih model lain.',
  404: 'Model tidak ditemukan atau sedang tidak tersedia. Pilih model lain.',
  408: 'AI terlalu lama merespons. Coba lagi atau pilih model lain.',
  429: 'Terlalu banyak permintaan atau model sedang penuh. Tunggu sebentar lalu coba lagi.',
  413: 'Pesan atau lampiran terlalu besar. Kurangi ukuran lalu coba lagi.',
  422: 'Isi permintaan tidak dapat diproses model. Ubah pesan atau pilih model lain.',
  502: 'Model sedang bermasalah. Coba lagi atau pilih model lain.',
  503: 'Layanan Groq sedang tidak tersedia. Coba lagi nanti.'
};
function friendlyError(err) {
  const status = (err && err.response && err.response.status) || (err && err.orStatus) || 0;
  const e = (err && err.response && err.response.data && err.response.data.error) || (err && err.orError) || null;
  const code = status || (e && Number(e.code)) || 0;
  if (code === 400 && e && e.message) return 'Permintaan ditolak model: ' + String(e.message).slice(0, 200);
  if (ERR_BY_STATUS[code]) return ERR_BY_STATUS[code];
  if (err && (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || ''))) return 'AI terlalu lama merespons. Coba lagi.';
  if (status) return 'AI sedang gangguan (HTTP ' + status + '). Coba lagi.';
  return 'Tidak bisa terhubung ke layanan AI. Coba lagi nanti.';
}

async function chatCompletion(axios, { baseUrl, apiKey, model, messages, maxTokens = 1500, temperature = 0.6, timeout = 60000, siteName, siteUrl }) {
  const headers = { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' };
  if (!String(apiKey || '').trim()) throw { response: { status: 401 } };
  const endpoint = normalizeBaseUrl(baseUrl);
  const tokenLimit = endpoint === DEFAULT_BASE_URL ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
  const r = await axios.post(endpoint + '/chat/completions',
    { model, messages, ...tokenLimit, temperature }, { headers, timeout });
  // Tolak respons error meskipun HTTP 200.
  if (r.data && r.data.error) { const ex = new Error(r.data.error.message || 'Groq error'); ex.orError = r.data.error; ex.orStatus = Number(r.data.error.code) || 502; throw ex; }
  const c = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message;
  const content = c && (typeof c.content === 'string' ? c.content
    : Array.isArray(c.content) ? c.content.map((p) => (p && p.text) || '').join('') : '');
  return (content || '').trim() || 'Maaf, saya tidak bisa memproses itu sekarang.';
}

// Groq GET /models membutuhkan Authorization Bearer.
async function listModels(axios, { baseUrl, apiKey, timeout = 20000 }) {
  if (!String(apiKey || '').trim()) throw { response: { status: 401 } };
  const r = await axios.get(normalizeBaseUrl(baseUrl) + '/models', { headers: { Authorization: 'Bearer ' + apiKey }, timeout });
  const arr = r.data && r.data.data;
  if (!Array.isArray(arr)) throw { response: { status: 502 } };
  return arr.filter(m => m && typeof m.id === 'string' && m.active !== false && !/whisper|orpheus|playai|guard/i.test(m.id)).map(m => ({
    id: m.id, name: String(m.name || m.id).slice(0, 80), image: false, free: false
  }));
}

// ---------- Pembaca ZIP (central directory + inflateRaw), dengan batas keamanan ----------
const TEXT_EXT = new Set(['md', 'markdown', 'txt', 'rst', 'json', 'yaml', 'yml', 'toml', 'ini', 'env', 'csv', 'xml', 'html', 'htm', 'css',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'ejs', 'py', 'php', 'java', 'kt', 'go', 'rb', 'rs', 'c', 'h', 'cpp', 'cs', 'sh', 'bat', 'sql', 'log', 'conf', 'cfg', 'http', 'rest']);
const SKIP_DIR = /(^|\/)(node_modules|\.git|vendor|dist|build|__MACOSX|\.next)(\/|$)/i;

function readZipText(buf, { maxFiles = 400, maxFileBytes = 200 * 1024, maxTotalChars = 120000, maxEntries = 5000 } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('File ZIP tidak valid.');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('File ZIP tidak valid atau rusak.');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (total > maxEntries) throw new Error('Isi ZIP terlalu banyak file (maks ' + maxEntries + ').');
  const files = []; const skipped = []; let chars = 0; let truncated = false; let count = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString((flags & 0x800) ? 'utf8' : 'latin1').replace(/\\/g, '/');
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    count++;
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (SKIP_DIR.test(name) || !TEXT_EXT.has(ext) || (flags & 1) || usize > maxFileBytes || (method !== 0 && method !== 8)) { skipped.push(name); continue; }
    if (truncated || files.length >= maxFiles) { truncated = true; skipped.push(name); continue; }
    try {
      if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) { skipped.push(name); continue; }
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const raw = buf.slice(start, start + csize);
      const data = method === 0 ? raw : zlib.inflateRawSync(raw, { maxOutputLength: maxFileBytes + 1 });
      if (data.length > maxFileBytes || data.includes(0)) { skipped.push(name); continue; }
      let text = data.toString('utf8');
      const room = maxTotalChars - chars;
      if (room <= 0) { truncated = true; skipped.push(name); continue; }
      if (text.length > room) { text = text.slice(0, room); truncated = true; }
      chars += text.length;
      files.push({ name, text });
    } catch (_) { skipped.push(name); }
  }
  return { files, skipped, truncated, totalEntries: count };
}
function zipToPrompt(parsed, zipName) {
  const parts = parsed.files.map((f) => '=== FILE: ' + f.name + ' ===\n' + f.text);
  let out = 'Isi ZIP "' + zipName + '" (' + parsed.files.length + ' file teks dibaca' + (parsed.skipped.length ? ', ' + parsed.skipped.length + ' dilewati' : '') + (parsed.truncated ? ', terpotong karena terlalu besar' : '') + '):\n\n' + parts.join('\n\n');
  return out;
}

module.exports = { isLegacyProvider, migrateLegacySettings, DEFAULT_BASE_URL, DEFAULT_MODELS, DEFAULT_SUGGESTIONS, normalizeBaseUrl, parseModelList, parseLines, friendlyError, chatCompletion, listModels, readZipText, zipToPrompt };
