const test = require('node:test');
const assert = require('node:assert/strict');
const q = require('../lib/transfer-qris');

const base = { name: 'Budi Santoso', username: 'budi123', code: 'A1B2C3D4E5F60789' };

test('payload QRIS transfer bisa dibuild dan diparse balik', () => {
  const p = q.buildTransferQris(base);
  const r = q.parseTransferQris(p);
  assert.equal(r.valid, true);
  assert.equal(r.code, base.code);
  assert.equal(r.name, 'Budi Santoso');
});
test('payload yang diubah (CRC salah) ditolak', () => {
  const p = q.buildTransferQris(base);
  assert.equal(q.parseTransferQris(p.replace('Budi', 'Evil')).valid, false);
});
test('QRIS bank/e-wallet biasa ditolak', () => {
  assert.equal(q.parseTransferQris('00020101021226570011ID.CO.QRIS.WWW0118936009143000000000520454995303360540415005802ID5909TOKO TEST6007JAKARTA6304ABCD').valid, false);
  assert.equal(q.parseTransferQris('hello').valid, false);
});
test('nama non-ASCII dibersihkan, kode tidak valid ditolak', () => {
  const p = q.buildTransferQris({ ...base, name: 'Żółć 😀' });
  assert.equal(q.parseTransferQris(p).valid, true);
  assert.throws(() => q.buildTransferQris({ ...base, code: 'x' }));
});
test('kartu SVG meng-escape nama', () => {
  const svg = q.buildQrisCardSvg({ modules: { size: 21, get: () => true }, name: '<b>"x"</b>', username: 'u1' });
  assert.ok(!svg.includes('<b>'));
  assert.ok(svg.includes('&lt;B&gt;'));
});
