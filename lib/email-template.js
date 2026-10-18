// Template email kode verifikasi (header biru, kotak kode, peringatan merah) — meniru desain "Kode Verifikasi Pendaftaran".
// Aman untuk Gmail (inline style + tabel) dan ikut tampil bagus di mode gelap.
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function safeUrl(u) {
  u = String(u || '').trim();
  return /^(https?:\/\/|mailto:|tg:\/\/)/i.test(u) ? u : '';
}

function buildOtpEmail({ siteName, subtitle, username, intro, code, minutes = 5, contactUrl, year } = {}) {
  const name = esc(siteName || 'Payment Gateway');
  const link = safeUrl(contactUrl);
  const contact = link
    ? `<a href="${esc(link)}" style="color:#3b82f6;font-weight:600;text-decoration:none;">${name}</a>`
    : `<span style="color:#3b82f6;font-weight:600;">${name}</span>`;
  const digits = esc(code).split('').join('&nbsp;');
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <tr><td align="center" style="background:#0b57b0;background-image:linear-gradient(135deg,#0a4aa0,#0d5fbf);padding:34px 24px 30px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" width="68" height="68" style="width:68px;height:68px;border-radius:34px;background:#0a4894;font-size:30px;line-height:68px;">&#9993;&#65039;</td></tr></table>
    <div style="margin-top:16px;font-size:26px;font-weight:700;color:#ffffff;letter-spacing:.2px;">${name}</div>
    <div style="margin-top:6px;font-size:15px;color:#dbeafe;">${esc(subtitle || 'Kode Verifikasi')}</div>
    <div style="width:44px;height:3px;background:#1e40af;border-radius:2px;margin:16px auto 0;"></div>
  </td></tr>
  <tr><td style="padding:30px 28px 8px;color:#0f172a;font-size:15px;line-height:1.7;">
    <p style="margin:0 0 10px;">Halo <b>${esc(username)}</b>,</p>
    <p style="margin:0;color:#475569;">${esc(intro || 'Gunakan kode berikut untuk melanjutkan proses Anda:')}</p>
  </td></tr>
  <tr><td align="center" style="padding:18px 28px;">
    <div style="display:inline-block;background:#e8f0fe;border:1px solid #c7d7f5;border-radius:14px;padding:16px 28px;font-size:32px;font-weight:700;letter-spacing:4px;color:#1d4ed8;font-family:Consolas,'Courier New',monospace;">${digits}</div>
  </td></tr>
  <tr><td style="padding:4px 28px 22px;">
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:14px 16px;text-align:center;font-size:13.5px;line-height:1.65;color:#dc2626;font-weight:600;">
      Kode ini berlaku selama ${esc(minutes)} menit. Demi keamanan akun, jangan bagikan kode ini kepada siapa pun, termasuk pihak yang mengaku sebagai tim kami. Jika Anda tidak merasa melakukan permintaan ini, abaikan email ini.
    </div>
  </td></tr>
  <tr><td style="padding:0 28px 28px;"><div style="border-top:1px solid #e2e8f0;padding-top:18px;text-align:center;font-size:13.5px;color:#64748b;line-height:1.7;">Punya pertanyaan? Hubungi tim kami di<br>${contact}</div></td></tr>
</table>
<div style="max-width:480px;margin:14px auto 0;text-align:center;font-size:11.5px;color:#94a3b8;font-family:Arial,sans-serif;">&copy; ${esc(year || new Date().getFullYear())} ${name}. Email otomatis, mohon tidak membalas.</div>
</td></tr></table>
</body></html>`;
}

module.exports = { buildOtpEmail };
