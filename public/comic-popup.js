/* AVERPAY ComicPopup — library popup kecil, dipakai bersama (promo, penarikan, dst).
 *
 * Kenapa ada: popup yang ditaruh di dalam konten halaman bisa "terkurung" oleh elemen induk
 * (transform / z-index) sehingga muncul di bawah & harus di-scroll. Library ini:
 *   1. memindahkan popup ke <body> (portal) -> selalu menempel di depan LAYAR, bukan di depan halaman;
 *   2. mengunci scroll halaman selama popup terbuka (tidak perlu scroll ke bawah);
 *   3. menengahkan popup pakai tinggi layar dinamis (100dvh), isi yang panjang scroll di DALAM kartu;
 *   4. menutup lewat tombol [data-cp-close], klik latar, atau tombol Esc.
 *
 * Pakai:
 *   <div id="x" class="cp-overlay" role="dialog" aria-modal="true"> <div class="cp-card"> ... </div> </div>
 *   ComicPopup.open('x');  ComicPopup.close('x');  ComicPopup.isOpen('x');
 *   Atribut opsional pada overlay: data-cp-backdrop="off" (klik latar tidak menutup), data-cp-esc="off".
 *   Event: 'comicpopup:open' & 'comicpopup:close' (bubbling, detail = elemen popup).
 */
(function () {
  'use strict';
  var locks = 0, saved = null, stack = [];

  function el(x) { return typeof x === 'string' ? document.getElementById(x) : x; }

  function lockScroll() {
    if (locks++ > 0) return;
    var de = document.documentElement, b = document.body;
    var gap = window.innerWidth - de.clientWidth; // cegah layout loncat saat scrollbar hilang (desktop)
    saved = { de: de.style.overflow, b: b.style.overflow, pr: b.style.paddingRight };
    de.style.overflow = 'hidden';
    b.style.overflow = 'hidden';
    if (gap > 0) b.style.paddingRight = gap + 'px';
  }
  function unlockScroll() {
    if (locks === 0 || --locks > 0) return;
    var de = document.documentElement, b = document.body;
    if (saved) { de.style.overflow = saved.de; b.style.overflow = saved.b; b.style.paddingRight = saved.pr; }
    saved = null;
  }

  function mount(node) {
    if (node && node.parentNode !== document.body) document.body.appendChild(node);
    return node;
  }

  function open(x) {
    var node = el(x);
    if (!node) return null;
    mount(node);
    node.classList.remove('hidden');
    node.removeAttribute('hidden');
    if (!node._cpOpen) {
      node._cpOpen = true;
      stack.push(node);
      lockScroll();
    }
    node.classList.add('is-open');
    node.setAttribute('aria-hidden', 'false');
    var card = node.querySelector('.cp-card, .cm-modal-card');
    if (card) { card.scrollTop = 0; var body = card.querySelector('.cm-modal-body'); if (body) body.scrollTop = 0; }
    node.dispatchEvent(new CustomEvent('comicpopup:open', { bubbles: true, detail: node }));
    return node;
  }

  function close(x) {
    var node = el(x);
    if (!node || !node._cpOpen) { if (node) { node.classList.remove('is-open'); node.classList.add('hidden'); } return; }
    node._cpOpen = false;
    stack = stack.filter(function (n) { return n !== node; });
    node.classList.remove('is-open');
    node.classList.add('hidden');
    node.setAttribute('aria-hidden', 'true');
    unlockScroll();
    node.dispatchEvent(new CustomEvent('comicpopup:close', { bubbles: true, detail: node }));
  }

  function isOpen(x) { var node = el(x); return !!(node && node._cpOpen); }

  // Tutup lewat tombol [data-cp-close] atau klik latar (target = overlay itu sendiri).
  document.addEventListener('click', function (e) {
    var closer = e.target.closest && e.target.closest('[data-cp-close]');
    if (closer) {
      var host = closer.closest('.cp-overlay, .cm-modal');
      if (host) { close(host); return; }
    }
    var t = e.target;
    if (t && t._cpOpen && t.getAttribute('data-cp-backdrop') !== 'off') close(t);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !stack.length) return;
    var top = stack[stack.length - 1];
    if (top.getAttribute('data-cp-esc') !== 'off') close(top);
  });

  window.ComicPopup = { open: open, close: close, isOpen: isOpen, mount: mount };
})();
