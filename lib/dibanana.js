'use strict';
const crypto = require('node:crypto');
const BASE = 'https://dibanana.id/api/v1';
const SERVERS = ['ekonomi', 'premium', 'khusus', 'wa_luar'];
const OPERATORS = ['any', 'telkomsel', 'indosat', 'axis', 'three', 'smartfren', 'byu'];
const COUNTRIES = require('./nokos-countries.json');
const ERRORS = { INVALID_API_KEY:'API key Dibanana belum valid. Hubungi admin.', INVALID_PRODUCT_ID:'Pilihan harga kedaluwarsa. Muat ulang daftar harga.', INSUFFICIENT_BALANCE:'Saldo provider belum mencukupi. Hubungi admin.', NO_NUMBERS:'Stok nomor habis. Pilih harga atau server lain.', TOO_EARLY:'Pembatalan baru boleh setelah 120 detik.', SMS_ALREADY_RECEIVED:'OTP sudah masuk, pesanan tidak dapat dibatalkan.', CANNOT_CANCEL:'Pesanan tidak dapat dibatalkan.', INVALID_STATUS:'Status pesanan belum memenuhi syarat.', MAX_RESEND:'OTP kedua hanya dapat diminta satu kali.', ORDER_NOT_FOUND:'Pesanan provider tidak ditemukan.', SERVER_UNREACHABLE:'Provider sedang tidak merespons. Coba cek status lagi.', INVALID_SERVER:'Server tidak valid.', MISSING_SERVICE:'Pilih layanan terlebih dahulu.' };
class BananaError extends Error { constructor(code, definitive = false) { super(ERRORS[code] || 'Layanan Dibanana belum dapat memproses permintaan.'); this.code = code; this.definitive = definitive; } }
function selection(input) {
  const server = String(input.server || 'ekonomi'), service = String(input.service || ''), country = String(input.country || 'id').toLowerCase();
  if (!SERVERS.includes(server)) throw new BananaError('INVALID_SERVER');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(service)) throw new BananaError('MISSING_SERVICE');
  if (!/^[a-z]{2}$/.test(country)) throw new Error('Kode negara harus dua huruf, contoh id atau my.');
  return { server, service, country };
}
function client(axios, settings) {
  if (!settings.dibananaApiKey) throw new BananaError('INVALID_API_KEY');
  const http = axios.create({ baseURL:BASE, timeout:20000, headers:{ Authorization:'Bearer ' + settings.dibananaApiKey, 'Content-Type':'application/json' } });
  return async (method, endpoint, input = {}) => {
    let data;
    try { const r = method === 'GET' ? await http.get(endpoint,{params:input}) : await http.post(endpoint,input); data = r.data; }
    catch (e) {
      const body = e.response && e.response.data;
      // Only documented definitive rejections permit a purchase refund; a lost
      // response/5xx may still represent an accepted provider order.
      throw new BananaError(body && body.error || 'NETWORK_ERROR', !!(body && body.ok === false && [400,401,402,404,405,422].includes(e.response.status)));
    }
    if (!data || data.ok !== true) throw new BananaError(data && data.error || 'INVALID_RESPONSE', !!(data && data.ok === false && ERRORS[data.error] && data.error !== 'SERVER_UNREACHABLE'));
    return data;
  };
}
function signatureValid(raw, signature, secret) {
  if (!Buffer.isBuffer(raw) || !secret || !/^sha256=[a-f0-9]{64}$/.test(signature || '')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
function remotePatch(order, remote) {
  if (remote.order_id !== undefined && String(remote.order_id) !== String(order.providerOrderId)) throw new Error('ID pesanan provider tidak cocok.');
  const map = { pending:'ACTIVE', received:'OTP_RECEIVED', cancelled:'CANCELED', expired:'EXPIRED', refunded:'CANCELED', resend_cancelled:'RESEND_CANCELED' };
  const status = map[remote.status || remote.new_status];
  if (!status) throw new Error('Status provider belum dikenali.');
  const patch = { status };
  if (remote.otp_code) patch.otpCode = String(remote.otp_code);
  if (remote.otp_code_2) patch.otpCode2 = String(remote.otp_code_2);
  if (remote.full_sms) patch.otpMessage = String(remote.full_sms);
  if (status === 'OTP_RECEIVED' && !(patch.otpCode || order.otpCode)) throw new Error('OTP belum tersedia, coba cek status lagi.');
  if (remote.resend_count !== undefined) patch.resendCount = Math.min(1, Math.max(Number(remote.resend_count) || 0, order.resendCount || 0));
  if (Number.isFinite(remote.expires_in) && remote.expires_in > 0) patch.expiresAt = new Date(Date.now() + remote.expires_in*1000);
  if (status === 'OTP_RECEIVED') patch.otpReceivedAt = new Date();
  return patch;
}
function publicOrder(o) {
  const keys = ['_id','productName','server','countryName','phoneNumber','sellPrice','status','otpCode','otpCode2','otpMessage','resendCount','expiresAt','createdAt','refunded','provider','providerOrderId'];
  return Object.fromEntries(keys.map(k => [k,o[k]]));
}
module.exports = { BASE, SERVERS, OPERATORS, COUNTRIES, BananaError, selection, client, signatureValid, remotePatch, publicOrder };
