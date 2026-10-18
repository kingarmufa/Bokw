'use strict';
// Uji CloudPool memakai server Supabase palsu (tanpa jaringan luar, tanpa dependency).
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { CloudPool, LOCAL_ROOT } = require('../lib/supabase-pool');

function fakeSupabase(mode) { // mode.value: 'ok' | 'full' | 'down'
  const objects = new Map();
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (mode.value === 'down') return send(503, { message: 'unavailable' });
      if (req.method === 'GET' && req.url.startsWith('/storage/v1/bucket/')) return send(200, { id: 'averpay' });
      if (req.method === 'GET' && req.url === '/storage/v1/bucket') return send(200, []);
      if (req.method === 'POST' && req.url.startsWith('/storage/v1/object/')) {
        if (mode.value === 'full') return send(413, { message: 'The object exceeded the maximum allowed size / quota' });
        objects.set(req.url, body); return send(200, { Key: 'ok' });
      }
      if (req.method === 'DELETE' && req.url.startsWith('/storage/v1/object/')) return send(200, []);
      send(404, { message: 'nope' });
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, objects, url: 'http://127.0.0.1:' + srv.address().port })));
}

function makeStore(projects) {
  const files = new Map();
  return {
    files, projects,
    listProjects: async () => projects,
    addUsage: async (id, d) => { const p = projects.find(x => String(x._id) === String(id)); if (p) p.usedBytes = (p.usedBytes || 0) + d; },
    patchProject: async (id, patch) => { const p = projects.find(x => String(x._id) === String(id)); if (p) Object.assign(p, patch); },
    fileAdd: async (r) => { files.set(r.url, r); },
    fileGet: async (u) => files.get(u) || null,
    fileDel: async (u) => { files.delete(u); },
    fileListLocal: async (n) => [...files.values()].filter(f => f.provider === 'local').slice(0, n),
    relink: async () => {}
  };
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

test('upload sukses ke project pertama', async () => {
  const m = { value: 'ok' }; const a = await fakeSupabase(m);
  const store = makeStore([{ _id: 'a', name: 'A', url: a.url, key: 'k'.repeat(30), bucket: 'averpay', enabled: true, order: 1, maxMB: 900, usedBytes: 0 }]);
  const pool = new CloudPool(store);
  // URL fake memakai http; test() menolak format, tapi upload tidak memeriksa domain
  const r = await pool.upload(PNG, { folder: 'posts', ext: '.png' });
  assert.equal(r.ok, true); assert.equal(r.provider, 'supabase');
  assert.match(r.url, /\/storage\/v1\/object\/public\/averpay\/posts\//);
  assert.equal(store.projects[0].usedBytes, PNG.length);
  a.srv.closeAllConnections(); a.srv.close();
});

test('project penuh -> pindah ke project kedua (API tidak putus)', async () => {
  const m1 = { value: 'full' }, m2 = { value: 'ok' };
  const a = await fakeSupabase(m1), b = await fakeSupabase(m2);
  const store = makeStore([
    { _id: 'a', name: 'A', url: a.url, key: 'k'.repeat(30), bucket: 'averpay', enabled: true, order: 1, maxMB: 900, usedBytes: 0 },
    { _id: 'b', name: 'B', url: b.url, key: 'k'.repeat(30), bucket: 'averpay', enabled: true, order: 2, maxMB: 900, usedBytes: 0 }
  ]);
  const pool = new CloudPool(store);
  const r = await pool.upload(PNG, { folder: 'stories', ext: '.png' });
  assert.equal(r.ok, true); assert.equal(r.projectId, 'b');
  assert.ok(store.projects[0].fullUntil, 'project A ditandai penuh');
  // upload berikutnya langsung ke B (A dilewati)
  const r2 = await pool.upload(PNG, { folder: 'stories', ext: '.png' });
  assert.equal(r2.projectId, 'b');
  a.srv.closeAllConnections(); a.srv.close(); b.srv.closeAllConnections(); b.srv.close();
});

test('batas MB internal dihormati tanpa memanggil project', async () => {
  const b = await fakeSupabase({ value: 'ok' });
  const store = makeStore([
    { _id: 'a', name: 'A', url: 'http://127.0.0.1:1', key: 'k'.repeat(30), bucket: 'averpay', enabled: true, order: 1, maxMB: 10, usedBytes: 10 * 1024 * 1024 },
    { _id: 'b', name: 'B', url: b.url, key: 'k'.repeat(30), bucket: 'averpay', enabled: true, order: 2, maxMB: 900, usedBytes: 0 }
  ]);
  const r = await new CloudPool(store).upload(PNG, { folder: 'x', ext: '.png' });
  assert.equal(r.projectId, 'b'); b.srv.closeAllConnections(); b.srv.close();
});

test('semua project down -> fallback lokal, lalu dimigrasi otomatis saat pulih', async () => {
  const m = { value: 'down' }; const a = await fakeSupabase(m);
  const store = makeStore([{ _id: 'a', name: 'A', url: a.url, key: 'k'.repeat(30), bucket: 'averpay', enabled: true, order: 1, maxMB: 900, usedBytes: 0 }]);
  const pool = new CloudPool(store);
  const r = await pool.upload(PNG, { folder: 'testlocal', ext: '.png' });
  assert.equal(r.ok, true); assert.equal(r.provider, 'local');
  assert.ok(r.url.startsWith('/uploads/cloud/testlocal/'));
  const abs = path.join(LOCAL_ROOT, 'testlocal', path.basename(r.url));
  assert.ok(fs.existsSync(abs));
  // Supabase pulih
  m.value = 'ok'; pool.cool.clear(); store.projects[0].fullUntil = null;
  const moved = await pool.migrateLocal(10);
  assert.equal(moved, 1);
  await new Promise(r => setTimeout(r, 100));
  assert.ok(!fs.existsSync(abs), 'file lokal dibersihkan setelah pindah');
  a.srv.closeAllConnections(); a.srv.close();
  fs.rmSync(path.join(LOCAL_ROOT, 'testlocal'), { recursive: true, force: true });
});

test('tanpa project sama sekali tetap berhasil (lokal), tidak melempar error', async () => {
  const pool = new CloudPool(makeStore([]));
  const r = await pool.upload(PNG, { folder: 'testnone', ext: '.png' });
  assert.equal(r.ok, true); assert.equal(r.provider, 'local');
  await pool.remove(r.url);
  fs.rmSync(path.join(LOCAL_ROOT, 'testnone'), { recursive: true, force: true });
});

test('input tidak valid ditolak dengan hasil terstruktur', async () => {
  const pool = new CloudPool(makeStore([]));
  assert.equal((await pool.upload(Buffer.alloc(0), { ext: '.png' })).ok, false);
  assert.equal((await pool.upload(PNG, { ext: '.exe' })).ok, false);
  assert.equal(await pool.remove(null), false);
  assert.equal(await pool.remove('https://example.com/x.png'), false);
});

test('store yang error tidak merusak upload', async () => {
  const b = await fakeSupabase({ value: 'ok' });
  const store = makeStore([{ _id: 'b', name: 'B', url: b.url, key: 'k'.repeat(30), bucket: 'averpay', enabled: true, order: 1, maxMB: 900, usedBytes: 0 }]);
  store.fileAdd = async () => { throw new Error('db down'); };
  store.addUsage = async () => { throw new Error('db down'); };
  const r = await new CloudPool(store).upload(PNG, { folder: 'x', ext: '.png' });
  assert.equal(r.ok, true); b.srv.closeAllConnections(); b.srv.close();
});

test('routing: foto -> GitHub dulu, video -> Supabase dulu (apa pun ukurannya)', async () => {
  const projects = [
    { _id: 'sb', name: 'SB', provider: 'supabase', url: 'https://x.supabase.co', key: 'k'.repeat(30), bucket: 'averpay', enabled: true, order: 1 },
    { _id: 'gh', name: 'GH', provider: 'github', url: 'https://github.com/o/r', key: 'g'.repeat(30), owner: 'o', repo: 'r', branch: 'main', enabled: true, order: 2 }
  ];
  const pool = new CloudPool(makeStore(projects));
  const tried = [];
  pool._putOne = async (p, buf, objPath) => { tried.push(p._id); return { ok: true, url: 'https://cdn.test/' + objPath, path: objPath }; };
  const img = await pool.upload(PNG, { folder: 'stories', ext: '.png' });
  assert.equal(img.ok, true); assert.equal(img.provider, 'github');
  const vid = await pool.upload(Buffer.alloc(1024, 1), { folder: 'stories', ext: '.mp4' });   // video kecil pun ke Supabase
  assert.equal(vid.ok, true); assert.equal(vid.provider, 'supabase');
  assert.deepEqual(tried, ['gh', 'sb']);
});

test('routing: foto jatuh ke Supabase kalau GitHub gagal, video jatuh ke GitHub kalau Supabase gagal', async () => {
  const mk = (downId) => {
    const projects = [
      { _id: 'sb', name: 'SB', provider: 'supabase', url: 'https://x.supabase.co', key: 'k'.repeat(30), bucket: 'averpay', enabled: true, order: 1 },
      { _id: 'gh', name: 'GH', provider: 'github', url: 'https://github.com/o/r', key: 'g'.repeat(30), owner: 'o', repo: 'r', branch: 'main', enabled: true, order: 2 }
    ];
    const pool = new CloudPool(makeStore(projects));
    pool._putOne = async (p, buf, objPath) => p._id === downId ? { ok: false, quota: true, message: 'penuh' } : { ok: true, url: 'https://cdn.test/' + objPath, path: objPath };
    return pool;
  };
  assert.equal((await mk('gh').upload(PNG, { folder: 'posts', ext: '.png' })).provider, 'supabase');
  assert.equal((await mk('sb').upload(Buffer.alloc(1024, 1), { folder: 'posts', ext: '.mp4' })).provider, 'github');
});

test('store: provider github tidak fallback ke Supabase atau lokal', async () => {
  const pool = new CloudPool({ listProjects: async () => [{ _id:'sb', provider:'supabase', enabled:true, maxMB:900 }] });
  let calls=0; pool._putOne=async()=>{calls++;return {ok:true,url:'unexpected'}};
  const result=await pool.upload(Buffer.from('image'),{ext:'.png',provider:'github',remoteOnly:true});
  assert.equal(result.ok,false);assert.equal(calls,0);
});
