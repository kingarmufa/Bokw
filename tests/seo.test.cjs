const test = require('node:test'), assert = require('node:assert/strict');
const seo = require('../lib/seo');

test('tagar: dibersihkan, tanpa duplikat, dan dibatasi jumlahnya', () => {
  assert.deepEqual(seo.parseTags('#QRIS, payment gateway\n#qris;api!!'), ['QRIS', 'payment gateway', 'api']);
  assert.deepEqual(seo.parseTags('baru', ['Lama']), ['Lama', 'baru']);
  assert.equal(seo.parseTags(Array.from({ length: 80 }, (_, i) => 't' + i)).length, seo.MAX_TAGS);
  assert.equal(seo.hashtag('payment gateway'), '#paymentgateway');
});

test('URL situs hanya menerima origin http(s) yang valid', () => {
  assert.equal(seo.normalizeBaseUrl('https://contoh.com/'), 'https://contoh.com');
  assert.equal(seo.normalizeBaseUrl('javascript:alert(1)'), '');
  assert.equal(seo.normalizeBaseUrl('https://contoh.com/path'), '');
});

test('halaman privat noindex, halaman publik index + canonical', () => {
  const s = { name: 'A', title: 'B', seoSiteUrl: 'https://contoh.com' };
  assert.equal(seo.buildSeo(s, '/admin/seo').robots, 'noindex, nofollow');
  assert.equal(seo.buildSeo(s, '/dashboard').indexable, false);
  const d = seo.buildSeo(s, '/docs');
  assert.equal(d.indexable, true);
  assert.equal(d.canonical, 'https://contoh.com/docs');
  assert.equal(seo.buildSeo(s, '/').canonical, 'https://contoh.com');
  assert.equal(seo.buildSeo({ ...s, seoIndexEnabled: false }, '/').indexable, false);
});

test('tagar ikut masuk ke meta keywords', () => {
  const r = seo.buildSeo({ seoKeywords: 'qris', seoTags: ['api qris', 'QRIS'] }, '/');
  assert.equal(r.keywords, 'qris, api qris');
});

test('robots.txt memuat Sitemap dan bisa menutup seluruh situs', () => {
  const r = seo.buildRobotsTxt({ seoSiteUrl: 'https://contoh.com' });
  assert.match(r, /Disallow: \/admin/);
  assert.match(r, /Sitemap: https:\/\/contoh\.com\/sitemap\.xml/);
  assert.match(seo.buildRobotsTxt({ seoIndexEnabled: false }), /Disallow: \/\n/);
  assert.match(seo.buildRobotsTxt({ seoRobotsDisallow: '/rahasia\nbukan-path' }), /Disallow: \/rahasia/);
});

test('sitemap.xml valid, meng-escape XML, dan menolak path aneh', () => {
  const x = seo.buildSitemapXml({ seoSiteUrl: 'https://contoh.com', seoSitemapPaths: '/a&b\n/ok\nx y' });
  assert.match(x, /<loc>https:\/\/contoh\.com\/<\/loc>/);
  assert.match(x, /<loc>https:\/\/contoh\.com\/ok<\/loc>/);
  assert.doesNotMatch(x, /a&b/);
  assert.doesNotMatch(x, /x y/);
});

test('JSON-LD aman ditaruh di dalam <script>', () => {
  const s = seo.buildSeo({ name: '</script><b>', seoSiteUrl: 'https://contoh.com' }, '/');
  const j = seo.buildJsonLd(s, {});
  assert.doesNotMatch(j, /<\/script>/i);
  assert.equal(JSON.parse(j)['@graph'][0].name, '</script><b>');
});

test('form admin: nilai tidak valid dibuang', () => {
  const { fields, siteUrlInvalid } = seo.sanitizeSeoForm({
    seoSiteUrl: 'bukan url', seoGaId: 'g-abc12345', seoGoogleVerification: '"><script>', seoOgImage: 'javascript:1', seoLocale: 'xx'
  });
  assert.equal(siteUrlInvalid, true);
  assert.equal(fields.seoSiteUrl, '');
  assert.equal(fields.seoGaId, 'G-ABC12345');
  assert.equal(fields.seoGoogleVerification, '');
  assert.equal(fields.seoOgImage, '');
  assert.equal(fields.seoLocale, 'id_ID');
});
