const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const skBlock = src.slice(src.indexOf('const SEKALIPAY_DEFAULT_BASE'), src.indexOf('// ===== Dispatcher provider withdraw instan'));
const smBlock = src.slice(src.indexOf('const SOSMED_DEFAULT_URL'), src.indexOf('// Admin: cek koneksi & isi katalog panel'));
const errFn = (() => { const a = src.indexOf('function sosmedErrorMessage('); let d = 0; for (let j = src.indexOf('{', a); j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return src.slice(a, j + 1); } })();
const axios = async ({ method, url, params, data, headers, timeout }) => {
  const u = new URL(url); if (params) Object.entries(params).forEach(([k, v]) => v != null && u.searchParams.set(k, v));
  const r = await fetch(u, { method, headers, body: data, signal: AbortSignal.timeout(timeout || 5000) });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch (e) { d = t; } return { status: r.status, data: d };
};
const users = {}; const spendField = () => 'balance';
const User = { findById: async (id) => { const u = users[id]; if (u) u.save = async () => {}; return u; } };
const S = new Function('axios', 'crypto', 'User', 'spendField', 'return (function(){' + skBlock + smBlock + errFn + ';return {sosmedNormalizeServices,sosmedServices,sosmedCreateOrder,sosmedFetchStatus,sosmedApplyExtras,sosmedErrorMessage,sosmedReady,sosmedMapStatus,sosmedCall}})()')(axios, require('crypto'), User, spendField);

const SERVICES = [
  { service: 11, name: 'IG Followers Murah', category: 'Instagram Followers', rate: '9500', min: '100', max: '50000', type: 'Default', refill: true },
  { service: 12, name: 'Paket', category: 'Instagram', rate: '5000', min: '1', max: '10', type: 'Package' },
  { service: 13, name: 'Nonaktif', category: 'TikTok', rate: '3000', min: '10', max: '1000', status: 'nonaktif' },
  { id: 14, name: 'TikTok Likes', kategori: 'TikTok Likes', price: 2500, min: 50, max: 10000 }];
const seen = []; let mode = 'ok';
const srv = http.createServer((req, res) => { let body = ''; req.on('data', c => body += c); req.on('end', () => {
  const f = Object.fromEntries(new URLSearchParams(body)); seen.push({ u: req.url, f });
  const j = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url.startsWith('/v2')) {   // gaya satu endpoint
    if (f.key !== 'K2') return j(401, { error: 'Invalid API key' });
    if (f.action === 'services') return j(200, SERVICES);
    if (f.action === 'add') return j(200, { order: 777 });
    if (f.action === 'status') return j(200, { status: 'In progress', start_count: '5', remains: '30' });
    if (f.action === 'refill') return j(200, { refill: 31 });
    return j(400, { error: 'Incorrect action' });
  }
  if (f.api_key !== 'K1' || f.api_id !== 'ID1') return j(200, { status: false, data: { msg: 'API Key salah' } });
  if (req.url === '/services') return j(200, { status: true, data: SERVICES });
  if (req.url === '/order') {
    if (mode === 'saldo') return j(200, { status: false, data: { msg: 'Saldo tidak cukup' } });
    if (mode === 'min') return j(400, { status: false, msg: 'Jumlah di bawah minimal' });
    return j(200, { status: true, data: { id: 555 } });
  }
  if (req.url === '/status') { const m = { S1: 'Success', E1: 'Error', P1: 'Partial', R1: 'Processing', C1: 'Canceled', Z1: 'Pending' }; return j(200, { status: true, data: { status: m[f.id] || 'Pending', start_count: 10, remains: f.id === 'P1' ? 400 : 0 } }); }
  if (req.url === '/refill') return j(200, { status: true, data: { id: 9 } });
  j(404, { status: false, message: 'not found' }); }); });

test('Heru Pedia (SMM panel): katalog, order, status, refund parsial', () => new Promise((done, fail) => srv.listen(0, async () => { try {
  const url = 'http://127.0.0.1:' + srv.address().port;
  const st = { sosmedApiId: 'ID1', sosmedApiKey: 'K1', sosmedApiUrl: url, sosmedApiStyle: 'perpath', fayupediaEnabled: true };
  assert.equal(S.sosmedReady(st), true); assert.equal(S.sosmedReady({ ...st, sosmedApiKey: '' }), false); assert.equal(S.sosmedReady({ ...st, fayupediaEnabled: false }), false);
  // --- gaya per-endpoint ---
  const list = await S.sosmedServices(st);
  assert.equal(list.length, 2);                                   // Package & nonaktif dibuang
  assert.equal(list[0].id, 11); assert.equal(list[0].rate, 9500); assert.equal(list[0].min, 100); assert.equal(list[0].refill, true);
  assert.equal(list[1].id, 14); assert.equal(list[1].rate, 2500); assert.equal(list[1].category, 'TikTok Likes');
  assert.equal(seen[0].u, '/services'); assert.equal(seen[0].f.api_id, 'ID1');
  let r = await S.sosmedCreateOrder(st, { serviceId: 11, target: 'https://instagram.com/akun', quantity: 1000 });
  assert.equal(r.orderId, '555');
  const o = seen.filter(x => x.u === '/order').pop().f; assert.deepEqual([o.service, o.target, o.quantity], ['11', 'https://instagram.com/akun', '1000']);
  // error: pesan panel diteruskan, masalah saldo disembunyikan dari user
  mode = 'saldo'; await assert.rejects(S.sosmedCreateOrder(st, { serviceId: 11, target: 't', quantity: 100 }), e => /hubungi CS/i.test(S.sosmedErrorMessage(e)) && !/saldo/i.test(S.sosmedErrorMessage(e)));
  mode = 'min'; await assert.rejects(S.sosmedCreateOrder(st, { serviceId: 11, target: 't', quantity: 1 }), e => S.sosmedErrorMessage(e) === 'Jumlah di bawah minimal');
  await assert.rejects(S.sosmedCall({ ...st, sosmedApiKey: 'SALAH' }, 'services'), e => /API Key salah/.test(e.message));
  // status baku
  const ord = (id, status = 'pending', provider = 'herupedia') => ({ provider, fayupediaOrderId: id, status });
  const stat = async id => (await S.sosmedFetchStatus(st, ord(id))).status;
  assert.equal(await stat('S1'), 'completed'); assert.equal(await stat('E1'), 'failed'); assert.equal(await stat('P1'), 'partial');
  assert.equal(await stat('R1'), 'processing'); assert.equal(await stat('C1'), 'canceled'); assert.equal(await stat('Z1'), 'pending');
  assert.equal((await S.sosmedFetchStatus(st, ord('X', 'pending', 'fayupedia'))).status, 'pending');   // order lama tidak dicek lagi
  const refill = await S.sosmedCall(st, 'refill', { id: '555' }); assert.equal(refill.id, 9);
  // --- gaya satu endpoint (v2) ---
  const v2 = { sosmedApiKey: 'K2', sosmedApiUrl: url + '/v2', sosmedApiStyle: 'v2', fayupediaEnabled: true };
  assert.equal((await S.sosmedServices(v2)).length, 2);
  assert.equal((await S.sosmedCreateOrder(v2, { serviceId: 11, target: 'https://x.com/a', quantity: 100 })).orderId, '777');
  const add = seen.filter(x => x.u === '/v2').pop().f; assert.deepEqual([add.action, add.link, add.service], ['add', 'https://x.com/a', '11']);
  const s2 = await S.sosmedFetchStatus(v2, ord('777')); assert.equal(s2.status, 'in progress'); assert.equal(s2.remains, '30');
  assert.equal((await S.sosmedCall(v2, 'refill', { id: '777' })).refill, 31);
  await assert.rejects(S.sosmedCall({ ...v2, sosmedApiKey: 'x' }, 'services'), e => /Invalid API key/.test(e.message));
  // partial -> refund proporsional ke saldo user, hanya sekali
  users.u1 = { balance: 0 };
  const order = { userId: 'u1', status: 'partial', refunded: false, remains: 350, quantity: 1000, sellPrice: 10000 };
  await S.sosmedApplyExtras(order, {});
  assert.equal(users.u1.balance, 3500); assert.equal(order.refunded, true); assert.equal(order.refundAmount, 3500);
  await S.sosmedApplyExtras(order, {}); assert.equal(users.u1.balance, 3500);
  srv.close(); done(); } catch (e) { srv.close(); fail(e); } })));
