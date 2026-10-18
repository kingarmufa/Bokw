'use strict';
// Helper SEO Pencarian & Tagar — dipakai server.js (route admin, robots.txt, sitemap.xml)
// dan partial views/partials/seo_meta.ejs (lewat res.locals.seo).

const DEFAULT_BASE_URL = 'https://app.nevapedia.com';
const DEFAULT_GOOGLE_VERIFICATION = 'LRIQ3uK1QGUAFZ9uldMSGe8yyVcEVaIeAGSlj-HGkQg';
const DEFAULT_KEYWORDS = 'nevapedia, nevaqr, qris payment, payment gateway, qris, nevapedia app, pg, api gateway, nevapedia.com, payment gateway qris, qris otomatis, payment gateway indonesia, qr gateway, qris nevapedia, qris payment gateway, app nevapedia, deposit otomatis, withdraw otomatis, api qris';
const DEFAULT_ROBOTS_DISALLOW = ['/admin', '/api', '/dashboard', '/profile', '/deposit', '/withdraw', '/chat', '/forgot-password', '/reset-password'];
const MAX_TAGS = 50;

// Halaman publik yang boleh diindex Google. Selain ini otomatis "noindex".
const PUBLIC_PATHS = Object.freeze(['/', '/login', '/register', '/docs', '/privacy-policy', '/terms-of-service']);
const SITEMAP_PRIORITY = { '/': '1.0', '/docs': '0.8', '/register': '0.7', '/login': '0.5' };

function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// https://domain.com (tanpa path / slash akhir). Selain itu ditolak -> ''.
function normalizeBaseUrl(v) {
  const s = String(v || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i.test(s) ? s : '';
}

function normalizeTag(raw) {
  const t = String(raw == null ? '' : raw).replace(/^#+/, '').replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return t;
}

// "#qris, payment gateway\n#api" -> ['qris','payment gateway','api'] (tanpa duplikat)
function parseTags(input, existing = []) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[,\n;]+/);
  const out = [];
  const seen = new Set();
  for (const t of [...existing, ...list]) {
    const n = normalizeTag(t);
    if (!n) continue;
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function hashtag(tag) { return '#' + normalizeTag(tag).replace(/[\s-]+/g, ''); }

function cleanPathLines(text, max = 30) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const p = line.trim();
    if (!/^\/[A-Za-z0-9\-._~\/%]*$/.test(p) || p.length > 120) continue;
    if (!out.includes(p)) out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

function xmlEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function isPublicPath(p) { return PUBLIC_PATHS.includes(p); }

function pick(v, fallback) { return (v === undefined || v === null || v === '') ? fallback : v; }

// Bentuk objek `seo` untuk dipakai template. `path` = req.path.
function buildSeo(settings = {}, path = '/') {
  const s = settings || {};
  const base = normalizeBaseUrl(s.seoSiteUrl) || DEFAULT_BASE_URL;
  const siteName = clean(s.name, 80) || 'Gateway';
  const isHome = path === '/';
  const tags = parseTags(s.seoTags || []);
  const baseKeywords = clean(pick(s.seoKeywords, DEFAULT_KEYWORDS), 500);
  const kwList = [];
  const seenKw = new Set();
  for (const k of baseKeywords.split(',').concat(tags)) {
    const v = clean(k, 60);
    if (v && !seenKw.has(v.toLowerCase())) { seenKw.add(v.toLowerCase()); kwList.push(v); }
  }
  const indexable = s.seoIndexEnabled !== false && isPublicPath(path);
  const description = clean(pick(s.seoDescription, s.description), 320) || 'Payment Gateway QRIS Otomatis Indonesia';
  const homeTitle = clean(s.seoTitle, 120) || ((s.name || '') + ' - ' + (s.title || '')).trim();
  return {
    base,
    siteName,
    canonical: base + (path === '/' ? '' : path),
    indexable,
    robots: indexable ? 'index, follow, max-image-preview:large, max-snippet:-1' : 'noindex, nofollow',
    homeTitle,
    isHome,
    description,
    keywords: kwList.join(', '),
    author: clean(pick(s.seoAuthor, 'Nevapedia'), 80),
    locale: /^[a-z]{2}_[A-Z]{2}$/.test(s.seoLocale || '') ? s.seoLocale : 'id_ID',
    ogImage: clean(pick(s.seoOgImage, s.logoUrl), 500),
    twitterHandle: /^@?[A-Za-z0-9_]{1,15}$/.test(s.seoTwitterHandle || '') ? '@' + String(s.seoTwitterHandle).replace(/^@/, '') : '',
    googleVerification: /^[A-Za-z0-9_\-]{10,100}$/.test(s.seoGoogleVerification || '') ? s.seoGoogleVerification : (s.seoGoogleVerification === undefined ? DEFAULT_GOOGLE_VERIFICATION : ''),
    bingVerification: /^[A-Za-z0-9_\-]{10,100}$/.test(s.seoBingVerification || '') ? s.seoBingVerification : '',
    gaId: /^G-[A-Z0-9]{4,15}$/.test(s.seoGaId || '') ? s.seoGaId : '',
    jsonLdEnabled: s.seoJsonLdEnabled !== false,
    tags,
    showTags: !!s.seoTagsShow
  };
}

// JSON-LD (Organization + WebSite) aman ditaruh di dalam <script>.
function buildJsonLd(seo, settings = {}) {
  const org = { '@type': 'Organization', '@id': seo.base + '/#org', name: seo.siteName, url: seo.base };
  if (seo.ogImage) org.logo = seo.ogImage;
  const site = { '@type': 'WebSite', '@id': seo.base + '/#website', url: seo.base, name: seo.siteName, inLanguage: seo.locale.replace('_', '-'), publisher: { '@id': seo.base + '/#org' } };
  if (seo.description) site.description = seo.description;
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': [org, site] }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function buildRobotsTxt(settings = {}) {
  const s = settings || {};
  const seo = buildSeo(s, '/');
  const lines = ['User-agent: *'];
  if (s.seoIndexEnabled === false) {
    lines.push('Disallow: /');
  } else {
    lines.push('Allow: /');
    const extra = cleanPathLines(s.seoRobotsDisallow);
    const dis = extra.length ? extra : DEFAULT_ROBOTS_DISALLOW;
    for (const p of dis) lines.push('Disallow: ' + p);
  }
  lines.push('', 'Sitemap: ' + seo.base + '/sitemap.xml', '');
  return lines.join('\n');
}

function buildSitemapXml(settings = {}, now = new Date()) {
  const s = settings || {};
  const seo = buildSeo(s, '/');
  const paths = [];
  for (const p of ['/', '/docs', '/register', '/login', '/privacy-policy', '/terms-of-service'].concat(cleanPathLines(s.seoSitemapPaths))) {
    if (!paths.includes(p)) paths.push(p);
  }
  const lastmod = (s.seoUpdatedAt ? new Date(s.seoUpdatedAt) : now).toISOString().slice(0, 10);
  const items = paths.map((p) => {
    const pr = SITEMAP_PRIORITY[p] || '0.4';
    return '  <url>\n    <loc>' + xmlEsc(seo.base + (p === '/' ? '/' : p)) + '</loc>\n    <lastmod>' + lastmod + '</lastmod>\n    <changefreq>' + (p === '/' ? 'weekly' : 'monthly') + '</changefreq>\n    <priority>' + pr + '</priority>\n  </url>';
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + items.join('\n') + '\n</urlset>\n';
}

// Ubah body form admin -> field Setting yang sudah dibersihkan.
function sanitizeSeoForm(b = {}) {
  const on = (v) => v === 'on' || v === true || v === 'true';
  const site = String(b.seoSiteUrl || '').trim();
  const out = {
    seoIndexEnabled: on(b.seoIndexEnabled),
    seoJsonLdEnabled: on(b.seoJsonLdEnabled),
    seoTitle: clean(b.seoTitle, 120),
    seoDescription: clean(b.seoDescription, 320),
    seoKeywords: clean(b.seoKeywords, 500),
    seoAuthor: clean(b.seoAuthor, 80),
    seoOgImage: /^https?:\/\/[^\s"'<>\\]{3,480}$/.test(String(b.seoOgImage || '').trim()) ? String(b.seoOgImage).trim() : '',
    seoTwitterHandle: /^@?[A-Za-z0-9_]{1,15}$/.test(String(b.seoTwitterHandle || '').trim()) ? String(b.seoTwitterHandle).trim().replace(/^@/, '') : '',
    seoGoogleVerification: /^[A-Za-z0-9_\-]{10,100}$/.test(String(b.seoGoogleVerification || '').trim()) ? String(b.seoGoogleVerification).trim() : '',
    seoBingVerification: /^[A-Za-z0-9_\-]{10,100}$/.test(String(b.seoBingVerification || '').trim()) ? String(b.seoBingVerification).trim() : '',
    seoGaId: /^G-[A-Z0-9]{4,15}$/.test(String(b.seoGaId || '').trim().toUpperCase()) ? String(b.seoGaId).trim().toUpperCase() : '',
    seoLocale: /^[a-z]{2}_[A-Z]{2}$/.test(String(b.seoLocale || '').trim()) ? String(b.seoLocale).trim() : 'id_ID',
    seoRobotsDisallow: cleanPathLines(b.seoRobotsDisallow).join('\n'),
    seoSitemapPaths: cleanPathLines(b.seoSitemapPaths).join('\n'),
    seoSiteUrl: normalizeBaseUrl(site),
    seoUpdatedAt: new Date()
  };
  return { fields: out, siteUrlInvalid: !!site && !out.seoSiteUrl };
}

module.exports = {
  DEFAULT_BASE_URL, DEFAULT_KEYWORDS, DEFAULT_ROBOTS_DISALLOW, PUBLIC_PATHS, MAX_TAGS,
  normalizeBaseUrl, normalizeTag, parseTags, hashtag, cleanPathLines,
  buildSeo, buildJsonLd, buildRobotsTxt, buildSitemapXml, sanitizeSeoForm
};
