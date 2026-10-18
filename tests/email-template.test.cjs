const test = require('node:test');
const assert = require('node:assert');
const { buildOtpEmail } = require('../lib/email-template');

test('nama di email mengikuti nama di setting (header, footer, hak cipta)', () => {
  for (const nama of ['Dilxz Payment Gateway', 'Toko ABC Pay']) {
    const h = buildOtpEmail({ siteName: nama, username: 'budi', code: '123456' });
    assert.strictEqual(h.split(nama).length - 1, 3);
  }
});
test('nama & username di-escape', () => {
  const h = buildOtpEmail({ siteName: '<b>X</b>', username: '<i>u</i>', code: '123456' });
  assert.ok(!h.includes('<b>X</b>') && !h.includes('<i>u</i>'));
});
