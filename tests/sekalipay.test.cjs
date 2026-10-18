'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
// Stub axios transport: tests never access Sekalipay or send money.
const realLoad = Module._load;
let calls = [];
Module._load = function(name, ...args) {
  if (name === 'axios') return async opts => { calls.push(opts); return { status: 200, data: { message: 'OK', data: { invoice: 'SPY1', ref_id: 'SPWD-test', status: 'paid', display_name: 'Penerima Test' } } }; };
  return realLoad.call(this, name, ...args);
};
const sp = require('../lib/sekalipay');
Module._load = realLoad;
const settings = { sekalipayApiKey: 'fake-test-key' };
test('cleanMethods rejects malformed and duplicates', () => {
  const valid = { name:'DANA PPOB', itemId:456, openDenom:true, min:10000, max:100000, fee:1500, active:true };
  assert.equal(sp.cleanMethods([valid, valid]).length, 1);
  assert.equal(sp.cleanMethods([{ ...valid, itemId:-1 }]).length, 0);
  assert.equal(sp.cleanMethods([{ ...valid, fee:-1 }]).length, 0);
});
test('amount and destination validation enforce server limits', () => {
  const m = { itemId:456, openDenom:true, min:10000, max:100000 };
  assert.deepEqual(sp.validateAmount(m, 10000, '456', '081234567890'), {amount:10000});
  assert.match(sp.validateAmount(m, 9000, '456', '081234567890').error, /Nominal/);
  assert.match(sp.validateAmount(m, 10000, '456', '6281234567890').error, /Nomor/);
  const fixed = { itemId:654, openDenom:false, amount:50000 };
  assert.equal(sp.validateAmount(fixed, 50000, '654', '081234567890').amount,50000);
  assert.ok(sp.validateAmount(fixed, 30000, '654', '081234567890').error);
});
test('catalog requires H2H, validation, matching denom capability', () => {
  const m = { itemId:456, openDenom:true };
  const it = { id:456, order_process:'h2h', stock:1, provider_meta:{open_denom:true,min_qty:10000,max_qty:100000,step_qty:1000}, validation:{available:true,requires_zone_id:false} };
  assert.equal(sp.ensureCatalogItem(it,m,10000),true);
  assert.throws(() => sp.ensureCatalogItem({...it,order_process:'manual'},m,10000));
  assert.throws(() => sp.ensureCatalogItem({...it,validation:{available:false}},m,10000));
});
test('create open denom sends documented JSON note and unique ref', async () => {
  calls = [];
  await sp.order(settings, 'SPWD-test', 456, '081234567890', 30000, true);
  assert.equal(calls[0].url, 'https://sekalipay.com/api/v1/trx');
  assert.equal(calls[0].headers['X-APIKEY'], 'fake-test-key');
  const sent = calls[0].data;
  assert.equal(sent.ref_id,'SPWD-test');
  assert.equal(sent.carts[0].item_id,456);
  assert.equal(JSON.parse(sent.carts[0].note).provider_qty,30000);
  assert.equal(JSON.parse(sent.carts[0].note).target,'081234567890');
});
test('paid without H2H completed is pending; failed is refund eligible', () => {
  assert.equal(sp.parseDetail({data:{status:'paid'}, h2h_results:[]},456).pending,true);
  assert.equal(sp.parseDetail({data:{status:'completed'}, h2h_results:[{variant_id:456,dispatch_status:'completed'}]},456).success,true);
  assert.equal(sp.parseDetail({data:{status:'failed'}, h2h_results:[]},456).failed,true);
  assert.equal(sp.parseDetail({data:{status:'completed'}, h2h_results:[{variant_id:456,dispatch_status:'failed'}]},456).failed,true);
  assert.equal(sp.parseDetail({data:{status:'completed'}, h2h_results:[]},456).success,false);
});
