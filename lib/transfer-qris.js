'use strict';
// QRIS Transfer AVERPAY: QRIS internal (format EMV-QR + CRC16) milik tiap user untuk menerima
// transfer saldo antar user. Bukan QRIS pembayaran bank/e-wallet; hanya terbaca di menu
// TRANSFER QRIS AVERPAY.

const MERCHANT_GUID = 'ID.AVERPAY.TRANSFER';

function emvField(id, val) {
  const v = String(val);
  return id + String(v.length).padStart(2, '0') + v;
}

function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= (str.charCodeAt(i) & 0xFF) << 8;
    for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function asciiName(name, fallback) {
  const clean = String(name || '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim().slice(0, 25);
  return clean || String(fallback || 'AVERPAY USER').slice(0, 25);
}

function buildTransferQris({ name, username, code }) {
  if (!/^[A-Z0-9]{8,32}$/.test(String(code || ''))) throw new Error('Kode QRIS tidak valid');
  const body =
    emvField('00', '01') + emvField('01', '11') +
    emvField('26', emvField('00', MERCHANT_GUID) + emvField('01', code)) +
    emvField('52', '0000') + emvField('53', '360') + emvField('58', 'ID') +
    emvField('59', asciiName(name, username)) + emvField('60', 'AVERPAY') +
    emvField('62', emvField('07', 'TRANSFER')) + '6304';
  return body + crc16(body);
}

function parseTlv(text) {
  const tags = {};
  let i = 0;
  while (i + 4 <= text.length) {
    const id = text.slice(i, i + 2), len = Number(text.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(text.slice(i + 2, i + 4)) || i + 4 + len > text.length) return null;
    tags[id] = text.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return i === text.length ? tags : null;
}

// Hasil: { valid, name, city, code } — valid hanya kalau CRC benar DAN ini QRIS Transfer AVERPAY.
function parseTransferQris(raw) {
  const text = String(raw || '').trim();
  const out = { valid: false, name: '', city: '', code: '' };
  if (text.length < 20 || text.length > 512) return out;
  const tags = parseTlv(text);
  if (!tags) return out;
  out.name = String(tags['59'] || '').trim();
  out.city = String(tags['60'] || '').trim();
  if (tags['00'] !== '01' || !/^[0-9A-F]{4}$/.test(String(tags['63'] || '').toUpperCase())) return out;
  if (crc16(text.slice(0, -4)) !== text.slice(-4).toUpperCase()) return out;
  const mai = parseTlv(tags['26'] || '');
  if (!mai || mai['00'] !== MERCHANT_GUID || !/^[A-Z0-9]{8,32}$/.test(mai['01'] || '')) return out;
  out.code = mai['01'];
  out.valid = true;
  return out;
}

function xmlEsc(s) {
  return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

// Kartu QRIS bergaya komik (hijau / kuning / hitam) sebagai SVG mandiri.
// modules = { size, get(r,c) } hasil QR matrix. fontBase64 opsional (Bangers) supaya tampil sama saat jadi PNG.
function buildQrisCardSvg({ modules, name, username, fontBase64 }) {
  const n = modules.size, quiet = 4, total = n + quiet * 2, qrPx = 440, m = qrPx / total;
  const ox = 80, oy = 250;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (modules.get(r, c)) d += `M${(ox + (c + quiet) * m).toFixed(2)} ${(oy + (r + quiet) * m).toFixed(2)}h${m.toFixed(2)}v${m.toFixed(2)}h-${m.toFixed(2)}z`;
  }
  const shown = String(name || username || '').trim().slice(0, 24).toUpperCase();
  const font = fontBase64 ? `@font-face{font-family:'BangersEmb';src:url(data:font/ttf;base64,${fontBase64}) format('truetype');}` : '';
  const ff = "'BangersEmb','Bangers','Impact','Arial Black',sans-serif";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 860" width="600" height="860" role="img" aria-label="QRIS Transfer ${xmlEsc(username)}">
<defs><style>${font}.f{font-family:${ff}}</style>
<pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="2.2" fill="#111" opacity=".16"/></pattern></defs>
<rect width="600" height="860" fill="#FACC15"/><rect width="600" height="860" fill="url(#dots)"/>
<rect x="14" y="14" width="572" height="832" rx="26" fill="none" stroke="#111" stroke-width="8"/>
<rect x="46" y="44" width="524" height="150" rx="20" fill="#111"/>
<rect x="38" y="36" width="524" height="150" rx="20" fill="#22C55E" stroke="#111" stroke-width="7"/>
<text class="f" x="300" y="112" text-anchor="middle" font-size="68" fill="#111" stroke="#fff" stroke-width="2" paint-order="stroke" letter-spacing="3">AVERPAY</text>
<text class="f" x="300" y="158" text-anchor="middle" font-size="30" fill="#111" letter-spacing="4">QRIS TRANSFER SALDO</text>
<rect x="${ox - 6 + 10}" y="${oy - 6 + 10}" width="${qrPx + 12}" height="${qrPx + 12}" rx="18" fill="#111"/>
<rect x="${ox - 6}" y="${oy - 6}" width="${qrPx + 12}" height="${qrPx + 12}" rx="18" fill="#fff" stroke="#111" stroke-width="7"/>
<path d="${d}" fill="#111" shape-rendering="crispEdges"/>
<rect x="65" y="738" width="486" height="72" rx="16" fill="#111"/>
<rect x="57" y="730" width="486" height="72" rx="16" fill="#fff" stroke="#111" stroke-width="6"/>
<text class="f" x="300" y="772" text-anchor="middle" font-size="${shown.length > 16 ? 30 : 38}" fill="#111" letter-spacing="2">${xmlEsc(shown)}</text>
<text class="f" x="300" y="794" text-anchor="middle" font-size="22" fill="#16A34A" letter-spacing="2">@${xmlEsc(String(username).toUpperCase())}</text>
<text class="f" x="300" y="836" text-anchor="middle" font-size="20" fill="#111" letter-spacing="2">SCAN DI MENU TRANSFER QRIS AVERPAY</text>
</svg>`;
}

module.exports = { MERCHANT_GUID, crc16, buildTransferQris, parseTransferQris, buildQrisCardSvg, asciiName };
