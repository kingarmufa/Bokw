/* Shared native dialogs: top layer, visual viewport, independent inner scroll. */
(function () {
  'use strict';
  const opened = new Set();
  const bound = new WeakSet();
  let saved = null;
  function element(value) { return typeof value === 'string' ? document.getElementById(value) : value; }
  function viewport() {
    const vv = window.visualViewport;
    opened.forEach(dialog => {
      dialog.style.setProperty('--cm-vheight', (vv ? vv.height : innerHeight) + 'px');
      dialog.style.setProperty('--cm-vtop', (vv ? vv.offsetTop : 0) + 'px');
    });
  }
  function release(dialog) {
    if (!opened.delete(dialog)) return;
    dialog.classList.remove('open');
    if (!opened.size && saved) {
      document.documentElement.style.overflow = saved.html;
      document.body.style.overflow = saved.body;
      document.body.style.paddingRight = saved.padding;
      window.scrollTo({ top: saved.y, left: saved.x, behavior: 'instant' });
      saved = null;
    }
  }
  function open(value) {
    const dialog = element(value);
    if (!dialog || dialog.open) return;
    if (!bound.has(dialog)) {
      bound.add(dialog);
      dialog.addEventListener('close', () => release(dialog));
      dialog.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(dialog.querySelectorAll('a[href], button, input, select, textarea, [tabindex]'))
          .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (!controls.includes(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      });
      let backdropStart = false;
      const outside = event => {
        const r = dialog.getBoundingClientRect();
        return event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom);
      };
      dialog.addEventListener('pointerdown', event => { backdropStart = outside(event); });
      dialog.addEventListener('click', event => { if (backdropStart && outside(event)) close(dialog); backdropStart = false; });
    }
    if (!opened.size) {
      const body = document.body, html = document.documentElement;
      saved = { html: html.style.overflow, body: body.style.overflow, padding: body.style.paddingRight, x: scrollX, y: scrollY };
      const gap = innerWidth - html.clientWidth;
      html.style.overflow = 'hidden'; body.style.overflow = 'hidden';
      if (gap > 0) body.style.paddingRight = (parseFloat(getComputedStyle(body).paddingRight) + gap) + 'px';
    }
    opened.add(dialog);
    viewport();
    dialog.classList.add('open');
    dialog.showModal();
    dialog.querySelectorAll('[data-dialog-scroll]').forEach(node => { node.scrollTop = 0; });
  }
  function close(value) { const dialog = element(value); if (dialog && dialog.open) dialog.close(); }
  window.addEventListener('resize', viewport);
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', viewport);
    visualViewport.addEventListener('scroll', viewport);
  }
  window.ComicDialog = { open, close };
})();
