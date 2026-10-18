/* Media focus: hanya SATU video/audio yang boleh berbunyi/berputar dalam satu waktu.
 * Aturan:
 *  - video mulai play  -> semua video lain otomatis pause (feed, Reels, story, profil).
 *  - story viewer terbuka -> semua video di luar story di-pause; video luar tidak bisa play selama story terbuka.
 *  - video yang keluar layar / tab disembunyikan / pindah tab (Home <-> Reels) -> pause.
 * Thumbnail & preview (muted, tanpa suara) diabaikan supaya tidak mengganggu. */
(function () {
  'use strict';
  if (window.__mediaFocus) return;
  window.__mediaFocus = true;

  var IGNORE = '.st-thumb, .sg-tile, .up-tile, .st-prev';
  function isMedia(el) { return el && el.tagName && /^(VIDEO|AUDIO)$/.test(el.tagName); }
  function ignored(el) {
    if (el.closest && el.closest(IGNORE)) return true;
    // preview loop tanpa suara (mis. composer story) bukan pemutar sungguhan
    return !!(el.muted && el.loop && !(el.closest && el.closest('.sg-reel')));
  }
  function pause(el) { try { el.pause(); } catch (e) {} }
  function pauseAll(except, insideOnly) {
    var list = document.querySelectorAll('video, audio');
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m === except || m.paused || ignored(m)) continue;
      if (insideOnly && insideOnly.contains(m)) continue;
      pause(m);
    }
  }

  var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (!en.isIntersecting && !en.target.paused) pause(en.target); });
  }, { threshold: 0.2 }) : null;
  var watched = (typeof WeakSet === 'function') ? new WeakSet() : null;

  document.addEventListener('play', function (e) {
    var m = e.target;
    if (!isMedia(m) || ignored(m)) return;
    var ov = document.querySelector('.st-ov');
    if (ov && !ov.contains(m)) { pause(m); return; }   // story sedang terbuka: prioritas story
    pauseAll(m);
    if (io && watched && m.tagName === 'VIDEO' && !(m.closest && m.closest('.st-ov')) && !watched.has(m)) { watched.add(m); io.observe(m); }
  }, true);

  document.addEventListener('visibilitychange', function () { if (document.hidden) pauseAll(null); });

  function watchStory() {
    if (!window.MutationObserver || !document.body) return;
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType === 1 && n.classList && n.classList.contains('st-ov')) { pauseAll(null, n); return; }
        }
      }
    }).observe(document.body, { childList: true });
  }
  if (document.body) watchStory(); else document.addEventListener('DOMContentLoaded', watchStory);

  window.MediaFocus = { pauseAll: function () { pauseAll(null); } };
})();
