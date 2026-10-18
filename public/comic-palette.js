/* Comic palette bridge v4. CSS rules retain their exact selectors and variants.
 * Never match a whole class string with substring selectors (hover/peer states).
 * Each opaque surface owns its foreground; nested surfaces start a new context.
 */
(function (global) {
  'use strict';
  const P = { black: '#171717', white: '#ffffff', yellow: '#edc531', green: '#2ecc40' };
  function rgb(value) {
    value = String(value || '').trim().toLowerCase();
    const names = { black: '#000000', white: '#ffffff', yellow: '#ffff00', red: '#ff0000', blue: '#0000ff', green: '#008000', orange: '#ffa500', gray: '#808080', grey: '#808080', transparent: '#00000000' };
    value = names[value] || value;
    if (/^#[\da-f]{3,8}$/.test(value)) {
      let h = value.slice(1);
      if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
      if (h.length === 6 || h.length === 8) return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).concat(h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1);
    }
    const m = value.match(/^rgba?\((.+)\)$/);
    if (m) {
      const parts = m[1].split(/[,\s/]+/).filter(Boolean);
      return parts.slice(0, 3).map(p => parseFloat(p) * (p.includes('%') ? 2.55 : 1)).concat(parts[3] === undefined ? 1 : parseFloat(parts[3]) / (parts[3].includes('%') ? 100 : 1));
    }
    return null;
  }
  function mapColor(value) {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'none' || v === 'transparent' || !v) return null;
    if (/var\(--cm-/.test(v)) return null;
    if (/var\(--comic-green/.test(v)) return P.green;
    if (/var\(--comic-(yellow|sky)/.test(v)) return P.yellow;
    if (/var\(--comic-(cream|white)/.test(v)) return P.white;
    if (/var\(--comic-/.test(v)) return P.black;
    let c = rgb(v);
    if (!c && global.document && !v.includes('var(')) {
      // Browser parser supports named colors, HSL, and modern CSS color syntax.
      const probe = global.document.createElement('canvas').getContext('2d');
      if (probe) { probe.fillStyle = '#000000'; probe.fillStyle = v; c = rgb(probe.fillStyle); }
    }
    if (!c) return P.white;
    if (c[3] === 0) return null;
    const [r, g, b] = c, max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min < 32) return (r + g + b) / 3 > 128 ? P.white : P.black;
    if (min > 195) return P.white;
    if (g > r * 1.12 && g > b * 1.08) return P.green;
    if (r > 155 && g > 110 && b < g * .82) return P.yellow;
    return P.black;
  }
  const api = { palette: P, mapColor, rgb };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!global.document) return;
  if (global.ComicTheme) return;
  const doc = global.document, root = doc.documentElement;
  let seen = new WeakMap();
  const ownedSurfaces = new WeakSet();
  let observer;
  function set(style, key, value) { if (style.getPropertyValue(key) !== value || style.getPropertyPriority(key) !== 'important') style.setProperty(key, value, 'important'); }
  function pair(style, color) {
    const token = color === P.black ? 'ink' : color === P.yellow ? 'yellow' : color === P.green ? 'green' : 'white';
    set(style, 'background-color', 'var(--cm-' + token + ')');
    set(style, '--cm-fg', color === P.black ? 'var(--cm-white)' : 'var(--cm-ink)');
    set(style, '--cm-edge', color === P.black ? 'var(--cm-yellow)' : 'var(--cm-ink)');
    ownedSurfaces.add(style);
  }
  function normalizeStyle(style) {
    if (!style || seen.get(style) === style.cssText) return;
    // CSSOM leaves longhands empty for a shorthand such as background:var(...).
    // Resolve legacy comic tokens here so their icons inherit the paired ink.
    const shorthand = style.getPropertyValue('background');
    const bg = style.getPropertyValue('background-color') ||
      (/^var\(--(?:comic|cm)-[\w-]+(?:\s*,[^)]*)?\)$/.test(shorthand.trim()) ? shorthand : '');
    // background:linear-gradient(...var(--x)...) leaves background-image empty in CSSOM,
    // so read the gradient from the shorthand too (otherwise the surface keeps a token
    // colour that can equal its text colour).
    let image = style.getPropertyValue('background-image');
    if (!image && /gradient\(/i.test(shorthand)) image = shorthand;
    if (bg && !bg.includes('--cm-')) {
      const mapped = mapColor(bg);
      if (mapped) pair(style, mapped);
      else { set(style, '--cm-fg', 'inherit'); set(style, '--cm-edge', 'inherit'); ownedSurfaces.add(style); }
    }
    if (!bg && ownedSurfaces.has(style)) { style.removeProperty('--cm-fg'); style.removeProperty('--cm-edge'); ownedSurfaces.delete(style); }
    if (image && /gradient\(/i.test(image)) {
      const first = image.match(/#[\da-f]{3,8}\b|rgba?\([^)]*\)|var\(--comic-[^)]*\)/i);
      pair(style, first ? mapColor(first[0]) || P.yellow : P.yellow);
      set(style, 'background-image', 'none');
    }
    for (const property of Array.from(style)) {
      if (property === 'color' || property === '-webkit-text-fill-color') set(style, property, 'var(--cm-fg)');
      else if (/^(border.*-color|outline-color|text-decoration-color|column-rule-color)$/.test(property)) {
        if (style.getPropertyValue(property) !== 'transparent') set(style, property, 'var(--cm-edge, #171717)');
      } else if (property === 'box-shadow' && style.getPropertyValue(property) !== 'none') set(style, property, '3px 3px 0 var(--cm-edge, #171717)');
      else if (property === 'text-shadow') set(style, property, 'none');
      else if (/^(fill|stroke)$/.test(property) && !/^(none|url\()/.test(style.getPropertyValue(property))) set(style, property, 'currentColor');
      else if (/^--tw-(ring|shadow).*color$/.test(property)) set(style, property, 'var(--cm-edge, #171717)');
      else if (property === 'accent-color') set(style, property, 'var(--cm-ink)');
      else if (property === 'opacity') {
        const n = Number(style.getPropertyValue(property));
        // Keep opacity:0 visibility/transition endpoints working.
        if (n > 0 && n < 1) set(style, property, '1');
      } else if (/^(backdrop-filter|-webkit-backdrop-filter)$/.test(property)) set(style, property, 'none');
    }
    seen.set(style, style.cssText);
  }
  function normalizeRules(rules) {
    if (!rules) return;
    for (const rule of rules) {
      if (rule.style) normalizeStyle(rule.style);
      if (rule.cssRules) normalizeRules(rule.cssRules);
    }
  }
  function normalizeSheet(sheet) {
    if (sheet.ownerNode && (sheet.ownerNode.hasAttribute('data-comic-owned') || /comic-theme\.css/.test(sheet.href || ''))) return;
    try { normalizeRules(sheet.cssRules); } catch (_) { /* Cross-origin icon fonts contain no UI surfaces. */ }
  }
  function inlineTree(node) {
    if (node.nodeType !== 1) return;
    if (node.matches('style, link[rel="stylesheet"]')) {
      if (node.sheet) normalizeSheet(node.sheet);
      if (node.tagName === 'LINK') node.addEventListener('load', () => normalizeSheet(node.sheet), { once: true });
    }
    if (node.hasAttribute('style') && !node.hasAttribute('data-comic-owned')) normalizeStyle(node.style);
    node.querySelectorAll('[style], style, link[rel="stylesheet"]').forEach(el => {
      if (el.sheet) normalizeSheet(el.sheet);
      if (el.hasAttribute('style') && !el.hasAttribute('data-comic-owned')) normalizeStyle(el.style);
    });
  }
  function refresh() {
    Array.from(doc.styleSheets).forEach(normalizeSheet);
    inlineTree(root);
  }
  function installChart(Chart) {
    if (!Chart || !Chart.register || Chart.__comicPalette) return;
    Chart.__comicPalette = true;
    Chart.register({ id: 'comicPalette', beforeUpdate(chart) {
      const P = global.ComicTemplates ? global.ComicTemplates.get(root.dataset.template).palette : api.palette;
      chart.data.datasets.forEach((d, i) => {
        d.borderColor = P.black; d.backgroundColor = [P.yellow, P.white, P.green][i % 3];
        d.pointBackgroundColor = [P.yellow, P.white, P.green][i % 3];
        d.pointBorderColor = P.black; d.borderWidth = 3;
        if (!['pie','doughnut','bar'].includes(chart.config.type)) { d.fill = false; d.borderDash = i % 2 ? [7, 4] : []; }
      });
      if (chart.options.plugins?.legend?.labels) chart.options.plugins.legend.labels.color = P.black;
      Object.values(chart.options.scales || {}).forEach(s => {
        if (s.ticks) s.ticks.color = P.black;
        if (s.grid) s.grid.color = P.black;
      });
    } });
  }
  let chartValue = global.Chart;
  if (!chartValue) Object.defineProperty(global, 'Chart', { configurable: true, get() { return chartValue; }, set(v) { chartValue = v; installChart(v); } });
  else installChart(chartValue);
  function setTemplate(value) {
    const catalogue = global.ComicTemplates;
    if (!catalogue) return;
    const t = catalogue.get(value);
    root.dataset.template = t.id;
    root.dataset.theme = t.themeColor;
    root.dataset.particle = t.particle;
    root.dataset.bg = 'comic';
    const meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t.background;
    const name = doc.getElementById('templatePreviewName');
    const description = doc.getElementById('templatePreviewDescription');
    if (name) name.textContent = t.name;
    if (description) description.textContent = t.description;
    doc.querySelectorAll('[name="themeTemplate"]').forEach(input => { input.checked = input.value === t.id; });
    global.dispatchEvent(new CustomEvent('comic:change', { detail: { template: t.id } }));
  }
  global.ComicTheme = Object.assign(api, { refresh, setTemplate });
  refresh();
  observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') { if (!record.target.hasAttribute('data-comic-owned')) normalizeStyle(record.target.style); }
      else if (record.target.nodeName === 'STYLE') normalizeSheet(record.target.sheet);
      else record.addedNodes.forEach(inlineTree);
    }
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
  doc.addEventListener('load', event => { if (event.target.sheet) normalizeSheet(event.target.sheet); }, true);
  doc.addEventListener('DOMContentLoaded', () => {
    refresh(); setTemplate(root.dataset.template);
    // Shared auth heading: every standalone auth form receives the same framing.
    const auth = doc.querySelector('form[action="/login"], form[action="/register"], form[action^="/forgot-password"], form[action^="/reset-password"]');
    if (auth) {
      const panel = auth.closest('.bg-white') || auth.parentElement;
      panel.classList.add('cm-auth-panel');
      const heading = doc.createElement('div');
      heading.className = 'cm-auth-heading';
      const title = doc.createElement('h1');
      title.textContent = auth.action.endsWith('/login') ? 'MASUK & MULAI!' : auth.action.endsWith('/register') ? 'GABUNG SEKARANG!' : 'PULIHKAN AKUN';
      heading.append(title); panel.prepend(heading);
    }
    doc.querySelectorAll('[name="themeTemplate"]').forEach(input => input.addEventListener('change', () => { if (input.checked) setTemplate(input.value); }));
    doc.getElementById('mainSettingsForm')?.addEventListener('reset', () => {
      global.setTimeout(() => setTemplate(doc.querySelector('[name="themeTemplate"]:checked')?.value), 0);
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
