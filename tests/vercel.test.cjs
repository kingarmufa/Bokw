'use strict';
process.env.SERVERLESS = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const runtime = require('../lib/vercel-runtime');
const { EventEmitter } = require('node:events');
function database() {
  const collections = new Map();
  return { db: { collection(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    const data = collections.get(name);
    function matches(doc, q) { return doc && Object.entries(q).every(([k,v]) => v && v.$lte ? doc[k] <= v.$lte : v && v.$gt ? doc[k] > v.$gt : doc[k] === v); }
    return {
      async updateOne(q, update, options = {}) {
        const current = data.get(q._id);
        if (matches(current, q)) { Object.assign(current, update.$set); return; }
        if (!options.upsert) return;
        if (current) throw Object.assign(new Error('duplicate'), { code: 11000 });
        data.set(q._id, { _id: q._id, ...update.$set });
      },
      async deleteOne(q) { if (matches(data.get(q._id), q)) data.delete(q._id); },
      async findOne(q) { const d = data.get(q._id); return matches(d, q) ? d : null; },
      find() { return { toArray: async () => Array.from(data.values()) }; }
    };
  } } };
}
test('cron authorization rejects missing and incorrect secrets', () => {
  const secret = 'x'.repeat(48);
  assert.equal(runtime.authorized(undefined, secret), false);
  assert.equal(runtime.authorized('Bearer ' + secret, ''), false);
  assert.equal(runtime.authorized('Bearer ' + secret, secret), true);
  assert.equal(runtime.authorized('Bearer ' + 'y'.repeat(48), secret), false);
});
test('Mongo lease excludes a concurrent instance and releases after errors', async () => {
  const db = database(); let release, entered;
  const ready = new Promise(r => entered = r);
  const first = runtime.withLease(db, 'payments', async () => { entered(); await new Promise(r => release = r); return 'done'; });
  await ready;
  assert.equal(await runtime.withLease(db, 'payments', async () => assert.fail('must not run')), null);
  release(); assert.equal(await first, 'done');
  await assert.rejects(runtime.withLease(db, 'payments', async () => { throw Error('provider'); }));
  assert.equal(await runtime.withLease(db, 'payments', async () => 'retry'), 'retry');
});
test('sessions survive two independent stores and reject expired sessions', async () => {
  const Store = require('../lib/mongo-session')({ Store: EventEmitter });
  const connection = database(); const one = new Store({ connection }), two = new Store({ connection });
  const call = (s, method, ...args) => new Promise((resolve, reject) => s[method](...args, (e,v) => e ? reject(e) : resolve(v)));
  const value = { userId: 'u1', cookie: { expires: new Date(Date.now()+60000) } };
  await call(one, 'set', 'abc', value);
  assert.equal((await call(two, 'get', 'abc')).userId, 'u1');
  await call(two, 'touch', 'abc', { cookie: { expires: new Date(0) } });
  assert.equal(await call(one, 'get', 'abc'), null);
  await call(one, 'set', 'abc', value); await call(two, 'destroy', 'abc');
  assert.equal(await call(one, 'get', 'abc'), null);
});
test('cloud failure cannot return a temporary local URL in Vercel', async () => {
  const { CloudPool } = require('../lib/supabase-pool');
  const pool = new CloudPool({ listProjects: async () => [] });
  const result = await pool.upload(Buffer.from('image'), { folder: 'test', ext: '.png', contentType: 'image/png' });
  assert.equal(result.ok, false); assert.equal(result.url, undefined);
});
test('operations authenticate before running work and handle contention', async t => {
  require('express-async-errors');
  const app = require('express')(); const connection = database(); let calls = 0;
  process.env.CRON_SECRET = 'z'.repeat(48);
  runtime.installOperations(app, { connection, payments: async () => { calls++; }, maintenance: async () => {}, backfill: async () => {} });
  const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(base+'/api/cron/payments')).status, 401); assert.equal(calls, 0);
  const response = await fetch(base+'/api/cron/payments', { headers: { authorization: 'Bearer '+process.env.CRON_SECRET } });
  assert.equal(response.status, 200); assert.equal((await response.json()).skipped, false); assert.equal(calls, 1);
});
test('app imports without listening, serves assets and fails missing config cleanly', async t => {
  delete process.env.MONGO_URI;
  const app = require('../server'); assert.equal(typeof app, 'function');
  const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(base+'/healthz')).status, 200);
  assert.equal((await fetch(base+'/style.css')).status, 200);
  const page = await fetch(base+'/'); assert.equal(page.status, 503); assert.match(await page.text(), /Environment Variables/);
});
