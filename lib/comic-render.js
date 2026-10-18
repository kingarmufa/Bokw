'use strict';
const { normalizeComicSettings, TEMPLATES } = require('./comic-settings');
const { css: templateCss } = require('../public/comic-templates');
// All EJS pages, including standalone login/register/chat, pass through here.
// Existing template content and form actions are kept intact.
function authCssVersion() {
  try { return Math.floor(require('fs').statSync(require('path').join(__dirname, '..', 'public', 'auth-anime.css')).mtimeMs / 1000).toString(36); }
  catch (e) { return '1'; }
}
function decorateAuthHtml(html) {
  html = html.replace(/<script\b[^>]*src=[\"']https:\/\/cdn\.tailwindcss\.com[^\"']*[\"'][^>]*>\s*<\/script>/gi,
    '<link rel="stylesheet" href="/comic-utilities.css?v=5.0"><script>window.tailwind=window.tailwind||{};</script>');
  html = html.replace(/<link\b[^>]*href=[\"'][^\"']*fonts\.googleapis\.com[^\"']*[\"'][^>]*>/gi, '')
    .replace(/<link\b[^>]*href=[\"']\/comic-theme\.css[^\"']*[\"'][^>]*>/gi, '')
    .replace(/<link\b[^>]*href=[\"']\/auth-anime\.css[^\"']*[\"'][^>]*>/gi, '')
    .replace(/<script\b[^>]*src=[\"']\/comic-(?:fx|contrast|palette)\.js[^\"']*[\"'][^>]*>\s*<\/script>/gi, '')
    .replace(/<link\b[^>]*href=[\"']https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome[^\"']*[\"'][^>]*>/gi, '');
  if (!html.includes('href="/comic-utilities.css')) html = html.replace(/<head([^>]*)>/i, '<head$1><link rel="stylesheet" href="/comic-utilities.css?v=5.0">');
  // auth-anime.css dimuat PALING AKHIR (cache-busting lewat ?v=) supaya menang atas gaya lain
  return html.replace(/<\/head>/i, `
<link rel="stylesheet" href="/vendor/fontawesome/css/all.min.css">
<link rel="stylesheet" href="/auth-anime.css?v=${authCssVersion()}" data-auth-owned>
</head>`);
}
function decorateComicHtml(html, settings) {
  if (!/<head[\s>]/i.test(html)) return html;
  html = html.replace(/<link\b[^>]*href=["']\/vouchers\.css[^"']*["'][^>]*>/gi, '').replace(/<script\b[^>]*src=["']\/vouchers\.js[^"']*["'][^>]*>\s*<\/script>/gi, '');
  const config = normalizeComicSettings(settings);
  const auth = /<body\b[^>]*\bdata-auth=/i.test(html);
  const store = /<body\b[^>]*\bdata-game-store=/i.test(html);
  if (auth) html = decorateAuthHtml(html);
  // Preserve the dedicated auth/store layouts; add only scoped seasonal styles.
  html = html.replace(/<html\b([^>]*)>/i, (_, attrs) => '<html' + attrs
    .replace(/\sdata-(?:theme|template|particle|bg)=(['"])[\s\S]*?\1/gi, '')
    .replace(/\sstyle=(['"])[\s\S]*?\1/gi, '')
    + ` data-template="${config.themeTemplate}" data-theme="${config.themeColor}" data-particle="${config.bgParticle}" data-bg="${config.bgStyle}">`);
  html = html.replace(/<style\b[^>]*id=["']cmTemplateTokens["'][^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<link\b[^>]*href=["']\/(?:comic-templates|glass-ui)\.css[^"']*["'][^>]*>/gi, '')
    .replace(/<script\b[^>]*src=["']\/comic-(?:templates|palette|fx|contrast)\.js[^"']*["'][^>]*>\s*<\/script>/gi, '');
  html = html.replace(/<meta\b[^>]*name=["']theme-color["'][^>]*>/gi, '');
  const templateAssets = `<meta name="theme-color" content="${config.bgSolidColor}">
<style id="cmTemplateTokens" data-comic-owned>${templateCss()}</style>
<link rel="stylesheet" href="/comic-templates.css?v=12.0" data-comic-owned>
<script src="/comic-templates.js?v=12.0"></script>`;
  if (auth || store) return html.replace(/<\/head>/i, `${templateAssets}
<script src="/comic-fx.js?v=12.0" defer></script></head>`);
  html = html.replace(/<script\b[^>]*src=["']https:\/\/cdn\.tailwindcss\.com[^"']*["'][^>]*>\s*<\/script>/gi,
    '<link rel="stylesheet" href="/comic-utilities.css?v=5.0"><script>window.tailwind=window.tailwind||{};</script>');
  html = html.replace(/<link\b[^>]*href=["'][^"']*fonts\.googleapis\.com[^"']*["'][^>]*>/gi, '');
  html = html.replace(/<link\b[^>]*href=["']\/comic-theme\.css[^"']*["'][^>]*>/gi, '')
    .replace(/<script\b[^>]*src=["']\/comic-fx\.js[^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<script\b[^>]*src=["']\/comic-contrast\.js[^"']*["'][^>]*>\s*<\/script>/gi, '');
  html = html.replace(/<script\b[^>]*src=["']https:\/\/kit\.fontawesome\.com[^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<link\b[^>]*href=["']https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome[^"']*["'][^>]*>/gi, '')
    .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js\/[^"']+\/chart\.umd\.min\.js/gi, '/vendor/chartjs/chart.umd.js');
  if (!html.includes('href="/comic-utilities.css')) html = html.replace(/<head([^>]*)>/i, '<head$1><link rel="stylesheet" href="/comic-utilities.css?v=5.0">');
  html = html.replace(/\/comic-utilities\.css(?:\?[^"']*)?/g, '/comic-utilities.css?v=5.0');
  return html.replace(/<\/head>/i, `
<link rel="stylesheet" href="/vendor/fontawesome/css/all.min.css">
<link rel="stylesheet" href="/comic-theme.css?v=4.4" data-comic-owned>
<link rel="stylesheet" href="/glass-ui.css?v=1" data-comic-owned>
${templateAssets}
<script src="/comic-palette.js?v=5.0"></script>
<script src="/comic-fx.js?v=12.0" defer></script>
<script src="/comic-contrast.js?v=4.3" defer></script>
<link rel="stylesheet" href="/vouchers.css?v=2" data-comic-owned>
<script src="/vouchers.js?v=2"></script>
<link rel="stylesheet" href="/comic-navigation.css?v=2" data-comic-owned>
</head>`);
}
function installComicRenderer(app) {
  const ejs = require('ejs');
  app.engine('ejs', (filename, options, callback) => {
    const locals = Object.assign({}, options, { nokosCountries: require('./nokos-countries.json'), comicTemplates: TEMPLATES, comicSettings: normalizeComicSettings(options.settings) });
    ejs.renderFile(filename, locals, (error, html) => {
      if (error) return callback(error);
      try { callback(null, decorateComicHtml(html, options.settings)); }
      catch (error) { callback(error); }
    });
  });
}
module.exports = { decorateComicHtml, installComicRenderer };
