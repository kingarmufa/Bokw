/* Comic contrast guard v1.
 * Last line of defence: any visible text whose colour is too close to the surface
 * behind it is switched (via --cm-fg) to the palette ink (#171717) or white, whichever reads better.
 * Runs on every page, re-checks on theme change and DOM updates. Never touches layout. */
(() => {
  'use strict';
  if (window.__comicContrast) return;
  window.__comicContrast = true;
  const INK = [23, 23, 23], WHITE = [255, 255, 255], MIN = 4.5, ATTR = 'data-cm-fix', PREV = 'data-cm-fix-prev';
  const root = document.documentElement;
  const parse = (value) => {
    const m = /rgba?\(([^)]+)\)/.exec(value || '');
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    return [p[0], p[1], p[2], p[3] === undefined || isNaN(p[3]) ? 1 : p[3]];
  };
  const lum = (c) => {
    const a = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (top, bottom) => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1);

  // Effective surface colour behind an element; null when it sits on a photo/url() image.
  function surface(el, cache) {
    if (cache.has(el)) return cache.get(el);
    let result;
    const cs = getComputedStyle(el);
    const image = cs.backgroundImage;
    const own = parse(cs.backgroundColor);
    if (image && image !== 'none' && /url\(/i.test(image)) result = null;
    else if (image && image !== 'none' && /gradient\(/i.test(image)) {
      const stop = /rgba?\([^)]*\)/.exec(image);
      result = stop ? over(parse(stop[0]), parent(el, cache) || WHITE.concat(1)) : parent(el, cache);
    } else if (own && own[3] >= 1) result = own;
    else if (own && own[3] > 0) result = over(own, parent(el, cache) || WHITE.concat(1));
    else result = parent(el, cache);
    cache.set(el, result);
    return result;
  }
  function parent(el, cache) {
    if (el.parentElement) return surface(el.parentElement, cache);
    const base = parse(getComputedStyle(root).backgroundColor);
    return base && base[3] > 0 ? base : WHITE.concat(1);
  }
  const hasOwnText = (el) => {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
    return false;
  };
  const isTarget = (el) => {
    const tag = el.tagName;
    if (/^(SCRIPT|STYLE|NOSCRIPT|CANVAS|VIDEO|IMG|SVG|PATH|OPTION|HEAD|META|LINK|TITLE)$/i.test(tag)) return false;
    if (el.closest && el.closest('.liked, .reposted, .rt-status.on, .sg-reel-heart')) return false; // warna status (like merah, dst.) dikunci CSS
    if (tag === 'I' && /(^|\s)fa[a-z-]*(\s|$)/.test(el.className)) return true;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return hasOwnText(el);
  };

  let observer, queued = false, running = false;
  function run() {
    queued = false; running = true;
    if (observer) observer.disconnect();
    try {
      const fixed = document.querySelectorAll('[' + ATTR + ']');
      fixed.forEach((el) => {
        const prev = el.getAttribute(PREV);
        if (prev) el.style.setProperty('--cm-fg', prev, 'important'); else el.style.removeProperty('--cm-fg');
        el.removeAttribute(ATTR); el.removeAttribute(PREV);
        if (!el.getAttribute('style')) el.removeAttribute('style');
      });
      const cache = new Map(), changes = [];
      const walker = document.createTreeWalker(document.body || root, NodeFilter.SHOW_ELEMENT);
      for (let el = walker.currentNode; el; el = walker.nextNode()) {
        if (!(el instanceof HTMLElement) || !isTarget(el)) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const bg = surface(el, cache);
        if (!bg) continue;
        const fg = parse(cs.color);
        if (!fg || fg[3] === 0) continue;
        const shown = fg[3] < 1 ? over(fg, bg) : fg;
        if (ratio(shown, bg) >= MIN) continue;
        changes.push([el, ratio(INK, bg) >= ratio(WHITE, bg) ? '#171717' : '#ffffff']);
      }
      // The theme paints every text node with var(--cm-fg), and comic-palette.js rewrites inline
      // colour declarations, so the fix goes through the theme's own foreground token.
      changes.forEach(([el, color]) => {
        const prev = el.style.getPropertyValue('--cm-fg');
        if (prev) el.setAttribute(PREV, prev);
        el.style.setProperty('--cm-fg', color, 'important');
        el.setAttribute(ATTR, '1');
      });
    } finally {
      running = false;
      if (observer) observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'data-theme'] });
    }
  }
  function schedule() {
    if (queued || running) return;
    queued = true;
    (window.requestAnimationFrame || setTimeout)(() => setTimeout(run, 60));
  }
  observer = new MutationObserver(schedule);
  addEventListener('comic:change', schedule);
  addEventListener('load', schedule);
  addEventListener('pageshow', schedule);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule); else schedule();
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'data-theme'] });
})();
