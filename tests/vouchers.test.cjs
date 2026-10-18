'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('./helpers/voucher-fixture.cjs');
const lib = require('../lib/vouchers');
const future = () => new Date(Date.now() + 86400000);
async function seed(f, data = {}) { return f.Voucher.create({ code: 'VOCHER10', percent: 10, active: true, published: true, expiresAt: future(), services: [...lib.SERVICE_IDS], ...data }); }

test('discount arithmetic: exact rupiah, decimal percent, 100%, unsafe amounts', () => {
  assert.deepEqual(lib.calculate(19999, 12.5), { originalPrice: 19999, discountAmount: 2499, total: 17500 });
  assert.equal(lib.calculate(10000, 100).total, 0);
  assert.equal(lib.calculate(1, 99.99).total, 1);
  for (const n of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => lib.calculate(n, 10));
  for (const n of [-1, Infinity, 100.1]) assert.throws(() => lib.calculate(10000, n));
});
test('admin validation: custom code, date WIB, duplicate/invalid services, percentages', () => {
  const input = { code: ' vocher10 ', percent: '12.50', expiresAt: lib.dateInput(future()), services: ['nokos', 'nokos'], active: 'on' };
  const v = lib.validateAdmin(input); assert.equal(v.code, 'VOCHER10'); assert.equal(v.percent, 12.5); assert.equal(v.published, false); assert.deepEqual(v.services, ['nokos']);
  assert.equal(lib.parseWib('2027-01-01T07:00').toISOString(), '2027-01-01T00:00:00.000Z');
  for (const expiresAt of ['2026-02-30T12:00', 'invalid', '2020-01-01T00:00']) assert.throws(() => lib.validateAdmin({ ...input, expiresAt }));
  for (const percent of ['0', '101', '10.123', '-10', 'NaN', {}, []]) assert.throws(() => lib.validateAdmin({ ...input, percent }));
  for (const services of [[], ['topup'], ['withdraw'], ['transfer'], undefined]) assert.throws(() => lib.validateAdmin({ ...input, services }));
  for (const code of [{ $ne: '' }, ['VOCHER10'], 'x', '<script>', 'A'.repeat(33)]) assert.throws(() => lib.normalizeCode(code));
});
test('public recommendations exclude private, expired, disabled and wrong-service vouchers; manual private works', async () => {
  const f = fixture(); await seed(f); await seed(f, { code: 'PRIVAT', published: false }); await seed(f, { code: 'EXPIRED', expiresAt: new Date(0) }); await seed(f, { code: 'OFF', active: false }); await seed(f, { code: 'PANEL', services: ['panel'] });
  assert.deepEqual((await f.vouchers.publicList('nokos')).map(v => v.code), ['VOCHER10']);
  assert.equal((await f.vouchers.quote('privat', 'nokos', 10000)).total, 9000);
  for (const code of ['EXPIRED', 'OFF', 'PANEL', 'MISSING']) await assert.rejects(f.vouchers.quote(code, 'nokos', 10000));
  for (const service of ['topup','withdraw','transfer','invoice']) await assert.rejects(f.vouchers.quote('VOCHER10', service, 10000));
  await assert.rejects(f.vouchers.quote('VOCHER10', 'nokos', 0));
  await assert.rejects(f.vouchers.quote('VOCHER10', 'nokos', 10000, future()));
});
// Nokos moved to lib/nokos-dibanana; its real web/API voucher handlers are tested in dibanana.test.cjs.
const routes = [
  ['/paket/beli/:id', 'paket'], ['/gacha-nokos/daftar','gacha_access'], ['/gacha-nokos/tarik','gacha_nokos'], ['/fix-no/buka','fix_access'], ['/fix-no/paket/beli/:packageId','fix_package'], ['/panel/order','panel'], ['/premium/order','premium'], ['/sosmed/order','sosmed'], ['/produk/:id/beli','produk'], ['/reseller/beli','reseller'], ['/admin-panel/beli','admin_panel'], ['/api/gacha-nokos/tarik','gacha_nokos'], ['/api/pterodactyl/order','panel'], ['/api/premium/order','premium'], ['/api/sosmed/order','sosmed'], ['/api/produk/beli','produk']
];
function prep(f, service) { if (service === 'gacha_access') f.state.user.gachaNokosStatus = 'none'; if (service === 'fix_access') f.state.user.fixNoAccess = false; }
for (const [route, service] of routes) {
  test('real handler discounts and records net price: ' + route, async () => {
    const f = fixture(); prep(f, service); await seed(f);
    const { req, res } = await f.invoke(route, { fields: { amount: 1, price: 1, percent: 100, discountAmount: 999999 }, query: { amount: 1, price: 1, percent: 100 } });
    const total = service === 'premium' ? 18000 : 9000;
    assert.equal(f.state.orders.length, 1, req.session.errorMsg || JSON.stringify(res.body));
    const order = f.state.orders[0]; assert.equal(order.voucherCode, 'VOCHER10'); assert.equal(order.discountAmount, total / 9); assert.equal(order.price ?? order.sellPrice ?? order.cost, total);
    assert.equal(f.state.user.balance + f.state.user.heldBalance, 103000 - total);
    assert.equal(f.pkg.price, 10000, 'catalogue price must stay unchanged');
  });
  test('real handler rejects expired or wrong-service voucher before debit: ' + route, async () => {
    for (const invalid of [{ expiresAt: new Date(0) }, { services: [] }]) {
      const f = fixture(); prep(f, service); await seed(f, invalid);
      const { req, res } = await f.invoke(route);
      assert.equal(f.state.user.balance + f.state.user.heldBalance, 103000); assert.equal(f.state.orders.length, 0); assert.equal(f.state.calls.length, 0);
      assert.ok(req.session.errorMsg || res.body?.error);
    }
  });
}
for (const route of ['/premium/order', '/sosmed/order', '/panel/order', '/gacha-nokos/tarik', '/api/premium/order', '/api/sosmed/order', '/api/pterodactyl/order', '/api/gacha-nokos/tarik']) {
  test('provider rejection refunds exact discounted held + merchant balance: ' + route, async () => {
    const f = fixture(); await seed(f); f.state.user.role = 'merchant'; f.state.failProvider = true;
    await f.invoke(route); assert.equal(f.state.calls.length, 1); assert.equal(f.state.orders.length, 0); assert.equal(f.state.user.topupBalance, 100000); assert.equal(f.state.user.heldBalance, 3000); assert.equal(f.state.user.balance, 100000);
  });
}
test('100% voucher purchases with zero balance, normal full price without voucher, insufficient funds', async () => {
  for (const [route, service] of routes) {
    const f = fixture(); prep(f, service); await seed(f, { percent: 100 }); Object.assign(f.state.user, { balance: 0, heldBalance: 0 });
    const { req, res } = await f.invoke(route); assert.equal(f.state.orders.length, 1, route + ': ' + (req.session.errorMsg || JSON.stringify(res.body))); assert.equal(f.state.user.balance, 0);
    const record = f.state.orders[0]; assert.equal(record.price ?? record.sellPrice ?? record.cost, 0);
  }
  const f = fixture(); await f.invoke('/produk/:id/beli', { code: '' }); assert.equal(f.state.orders[0].price, 10000);
  const short = fixture(); await seed(short); short.state.user.balance = 1000; short.state.user.heldBalance = 0; await short.invoke('/produk/:id/beli'); assert.equal(short.state.orders.length, 0); assert.equal(short.state.user.balance, 1000);
});
test('parallel purchases cannot overdraw a shared balance', async () => {
  const f = fixture(); await seed(f); Object.assign(f.state.user, { balance: 9000, heldBalance: 0 });
  await Promise.all([f.invoke('/produk/:id/beli'), f.invoke('/produk/:id/beli')]); assert.equal(f.state.orders.length, 1); assert.equal(f.state.user.balance, 0);
});
test('SMM partial refund uses discounted sell price and does not repeat', async () => {
  const f = fixture(); await seed(f); await f.invoke('/sosmed/order');
  const order = { ...f.state.orders[0], status: 'partial', remains: 400, quantity: 1000, refunded: false };
  const fs = require('fs'), vm = require('vm'); const source = fs.readFileSync(require('path').join(__dirname, '../server.js'), 'utf8');
  const start = source.indexOf('async function sosmedApplyExtras('), end = source.indexOf('\n}', start) + 2;
  vm.runInNewContext(source.slice(start, end), f.context); await f.context.sosmedApplyExtras(order, {});
  assert.equal(order.refundAmount, 3600); const balance = f.state.user.balance; await f.context.sosmedApplyExtras(order, {}); assert.equal(f.state.user.balance, balance);
});
test('product storage failure refunds only the net amount and records no delivered order', async () => {
  for (const route of ['/produk/:id/beli', '/api/produk/beli']) {
    const f = fixture(); await seed(f); f.state.failCreate = true; await f.invoke(route);
    assert.equal(f.state.user.balance, 100000); assert.equal(f.state.user.heldBalance, 3000); assert.equal(f.state.orders.length, 0);
  }
});
