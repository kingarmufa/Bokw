'use strict';
// SekaliPay Reseller API v1 — https://sekalipay.com/api-docs
// All operations are server-side. Never expose X-APIKEY to a browser.
const axios = require('axios');
const BASE = 'https://sekalipay.com/api';
const rejectCodes = new Set(['BALANCE_IS_INSUFFICIENT','REQUIRED_FIELD_MISSING','PRODUCT_TEMPORARILY_UNAVAILABLE','INVALID_API_KEY','INVALID_IP','ACCOUNT_MUST_BE_RESELLER','THE_ACCOUNT_HAS_BEEN_SUSPENDED']);

function request(settings, method, path, data, query) {
  if (!settings || !String(settings.sekalipayApiKey || '').trim()) throw new Error('API Key Sekalipay belum diatur oleh admin.');
  if (!/^\/v1\/[\w/\-.]+$/.test(path)) throw new Error('Path Sekalipay tidak valid');
  return axios({method, url: BASE + path, params: query, data,
    headers: { 'X-APIKEY': settings.sekalipayApiKey, Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json' } : {}) },
    timeout: 20000, validateStatus: () => true, maxRedirects: 0
  }).then(res => ({ httpStatus: res.status, body: res.data }));
}
function decode(reply) {
  if (!reply || reply.httpStatus < 200 || reply.httpStatus >= 300 || !reply.body || reply.body.message !== 'OK') {
    const error = new Error(String(reply?.body?.error || reply?.body?.message || 'Sekalipay tidak dapat memproses request.'));
    error.httpStatus = reply?.httpStatus;
    error.code = reply?.body?.message;
    error.confirmedNotCreated = rejectCodes.has(String(error.code || ''));
    throw error;
  }
  return reply.body;
}
function item(settings, id) { return request(settings, 'GET', `/v1/item/${Number(id)}`).then(decode).then(r => r.data); }
function balance(settings) { return request(settings, 'GET', '/v1/balance').then(decode); }
function validation(settings, id, customer) {
  return request(settings, 'POST', '/v1/item/validate', { item_id: Number(id), customer_id: String(customer) }).then(decode).then(r => {
    const name = String(r.data?.display_name || r.data?.account_name || '').trim();
    if (!name) throw new Error('Sekalipay tidak mengembalikan nama akun penerima.');
    return { name, raw: r.data };
  });
}
function order(settings, ref, itemId, dest, amount, openDenom) {
  const cart = { item_id: Number(itemId), quantity: 1,
    note: openDenom ? JSON.stringify({ target: String(dest), provider_qty: Number(amount) }) : String(dest) };
  if (openDenom) cart.provider_qty = Number(amount);
  return request(settings, 'POST', '/v1/trx', { ref_id: ref, carts: [cart] }).then(decode).then(r => r.data);
}
function detail(settings, ref) { return request(settings, 'GET', `/v1/trx/${encodeURIComponent(ref)}`).then(decode); }
function parseDetail(raw, itemId) {
  const body = raw?.body || raw || {};
  const d = body.data || {};
  const status = String(d.status || '').toLowerCase();
  const rows = body.h2h_results || d.h2h_results || [];
  const target = (Array.isArray(rows) ? rows : []).filter(x => Number(x.variant_id) === Number(itemId));
  const row = target[0] || null;
  const dispatch = String(row?.dispatch_status || '').toLowerCase();
  const success = status === 'completed' && dispatch === 'completed';
  const failed = status === 'failed' || status === 'canceled' || status === 'cancelled' || dispatch === 'failed';
  // status "paid" is NOT an e-wallet delivery confirmation.
  return { raw: body, status, success, failed, pending: !success && !failed,
    trxid: d.invoice || d.ref_id || null,
    message: String(row?.log_message || d.message || status || 'Menunggu konfirmasi pengiriman') };
}
function cleanMethods(methods) {
  if (!Array.isArray(methods)) return [];
  const seen = new Set();
  return methods.map(m => ({
    name: String(m.name || '').trim().slice(0, 70), itemId: Number(m.itemId),
    openDenom: m.openDenom === true || m.openDenom === 'true',
    amount: Number(m.amount) || 0, min: Number(m.min) || 10000,
    max: Number(m.max) || 1000000, fee: Number(m.fee) || 0,
    active: m.active === true || m.active === 'true' || m.active === 'on'
  })).filter(m => {
    const nameKey = m.name.toLowerCase();
    if (!m.name || !Number.isSafeInteger(m.itemId) || m.itemId < 1 || !Number.isSafeInteger(m.fee) || m.fee < 0 || seen.has(nameKey)) return false;
    if (m.openDenom ? (!Number.isSafeInteger(m.min) || !Number.isSafeInteger(m.max) || m.min < 1 || m.max < m.min) : (!Number.isSafeInteger(m.amount) || m.amount < 1)) return false;
    seen.add(nameKey); return true;
  });
}
function validateAmount(method, rawAmount, productCode, dest) {
  if (!/^0[0-9]{8,14}$/.test(String(dest || ''))) return { error: 'Nomor tujuan e-wallet harus dimulai 0 dan berisi 9–15 digit.' };
  const amount = Number(rawAmount);
  if (method.openDenom) {
    if (!Number.isSafeInteger(amount) || amount < method.min || amount > method.max) return { error: `Nominal harus Rp ${method.min} sampai Rp ${method.max}.` };
  } else if ((productCode && String(productCode) !== String(method.itemId)) || (amount && amount !== method.amount)) {
    return { error: 'Nominal atau produk tidak sesuai konfigurasi admin.' };
  }
  return { amount: method.openDenom ? amount : method.amount };
}
function ensureCatalogItem(itemData, method, amount) {
  if (!itemData || Number(itemData.id) !== Number(method.itemId) || itemData.order_process !== 'h2h') throw new Error('Item Sekalipay bukan produk PPOB/H2H yang valid.');
  if (itemData.stock !== undefined && Number(itemData.stock) < 1) throw new Error('Stok item Sekalipay kosong.');
  if (!!itemData.provider_meta?.open_denom !== !!method.openDenom) throw new Error('Mode nominal tidak cocok dengan produk Sekalipay. Periksa konfigurasi admin.');
  if (method.openDenom) {
    const meta = itemData.provider_meta || {};
    const min = Number(meta.min_qty) || 1; const max = Number(meta.max_qty) || Number.MAX_SAFE_INTEGER;
    const step = Number(meta.step_qty) || 1;
    if (amount < min || amount > max || (amount - min) % step !== 0) throw new Error(`Nominal di luar batas/kelipatan produk Sekalipay (${min}-${max}, step ${step}).`);
  }
  if (itemData.validation?.available !== true || itemData.validation?.requires_zone_id === true) throw new Error('Produk belum mendukung cek nama e-wallet satu nomor melalui Sekalipay.');
  return true;
}
module.exports = { request, item, balance, validation, order, detail, parseDetail, cleanMethods, validateAmount, ensureCatalogItem };
