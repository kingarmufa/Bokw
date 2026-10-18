const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function grab(name) {
  const a = src.indexOf('function ' + name + '(');
  assert.ok(a > -1, name + ' tidak ditemukan');
  let depth = 0, i = src.indexOf('{', a);
  for (let j = i; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) return src.slice(a, j + 1); }
}
const sortsSrc = src.slice(src.indexOf('const FS_SORTS'), src.indexOf('function fsListQuery'));
const { afterAuthRedirect, fsCleanUrl, fsListQuery } = new Function(grab('afterAuthRedirect') + '\n' + grab('fsCleanUrl') + '\n' + sortsSrc + '\n' + grab('fsListQuery') + '\nreturn { afterAuthRedirect, fsCleanUrl, fsListQuery };')();

const ID = 'a'.repeat(24);
test('setelah login lanjut ke link download yang tadi diklik (sekali pakai)', () => {
  const req = { session: { returnTo: { path: `/script-gratis/${ID}/download`, exp: Date.now() + 60000 } } };
  assert.equal(afterAuthRedirect(req, '/dashboard'), `/script-gratis/${ID}/download`);
  assert.equal(afterAuthRedirect(req, '/dashboard'), '/dashboard');
});
test('returnTo kedaluwarsa atau di luar whitelist diabaikan (anti open redirect)', () => {
  const old = { session: { returnTo: { path: `/script-gratis/${ID}/download`, exp: Date.now() - 1 } } };
  assert.equal(afterAuthRedirect(old, '/dashboard'), '/dashboard');
  for (const bad of ['//evil.com', 'https://evil.com', '/admin/dashboard', `/script-gratis/${ID}/download/../x`, '/script-gratis/zzz/download']) {
    assert.equal(afterAuthRedirect({ session: { returnTo: { path: bad, exp: Date.now() + 60000 } } }, '/dashboard'), '/dashboard', bad);
  }
});
test('link download harus http/https', () => {
  assert.equal(fsCleanUrl(''), '');
  assert.equal(fsCleanUrl('https://github.com/x/y/archive/main.zip'), 'https://github.com/x/y/archive/main.zip');
  assert.equal(fsCleanUrl('javascript:alert(1)'), null);
  assert.equal(fsCleanUrl('ftp://x'), null);
});

test('pencarian & urutan: default rekomendasi, sort tidak dikenal ditolak, regex di-escape', () => {
  assert.equal(fsListQuery({}).sortKey, 'rekomendasi');
  assert.equal(fsListQuery({ sort: '$where' }).sortKey, 'rekomendasi');
  assert.equal(fsListQuery({ sort: 'populer' }).sort.downloads, -1);
  assert.equal(fsListQuery({ sort: 'terlama' }).sort.createdAt, 1);
  assert.equal(fsListQuery({ sort: 'terbaru' }).sort.createdAt, -1);
  const f = fsListQuery({ q: '  a.b(c)* ' });
  assert.equal(f.q, 'a.b(c)*');
  const rx = f.filter.$or[0].title;
  assert.ok(rx.test('Bot A.B(C)* keren'));
  assert.ok(!rx.test('Bot AxB(C)'));
  assert.equal(fsListQuery({ q: 'x'.repeat(200) }).q.length, 60);
  assert.equal(fsListQuery({}).filter.$or, undefined);
});
