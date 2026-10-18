/* Emoji animasi (Lottie) — sumber: LottieFiles (Lottie Simple License).
 * Pakai: <span class="lottie-emoji" data-lottie-emoji="clock" data-size="24"></span>
 * Urutan sumber animasi:
 *   1) file lokal  /lottie/<nama>.json atau /lottie/<nama>.lottie  (taruh hasil download di public/lottie/)
 *   2) URL di REGISTRY di bawah (kosong = lewati)
 *   3) fallback: emoji biasa yang digerakkan CSS (tetap "hidup" walau Lottie gagal dimuat)
 */
(function () {
  var PLAYER = 'https://unpkg.com/@lottiefiles/dotlottie-wc@latest/dist/dotlottie-wc.js';
  var REGISTRY = {
    // https://lottiefiles.com/free-animation/clock-lottie-animation-K2sPMoyo0P
    clock:   { emoji: '⏰', fx: 'le-shake',  src: 'https://assets-v2.lottiefiles.com/a/db4d8c50-118a-11ee-9003-97fd78c5d3b5/KcZNrMQZtv.lottie' },
    // Isi src dengan link download dari halaman animasi LottieFiles (atau taruh file di public/lottie/)
    party:   { emoji: '🎉', fx: 'le-bounce', src: '' },
    hourglass:{ emoji: '⏳', fx: 'le-spin',  src: '' },
    trash:   { emoji: '🗑️', fx: 'le-shake',  src: '' },
    warning: { emoji: '⚠️', fx: 'le-pulse',  src: '' }
  };

  var css = '.lottie-emoji{display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;line-height:1}' +
    '.lottie-emoji .le-fb{display:inline-block}' +
    '.le-bounce{animation:leB 1s ease-in-out infinite}.le-shake{animation:leS 1.2s ease-in-out infinite}' +
    '.le-spin{animation:leR 2s ease-in-out infinite}.le-pulse{animation:leP 1.2s ease-in-out infinite}' +
    '@keyframes leB{0%,100%{transform:translateY(0)}50%{transform:translateY(-22%)}}' +
    '@keyframes leS{0%,100%{transform:rotate(0)}20%{transform:rotate(-14deg)}40%{transform:rotate(14deg)}60%{transform:rotate(-8deg)}80%{transform:rotate(8deg)}}' +
    '@keyframes leR{0%{transform:rotate(0)}60%,100%{transform:rotate(180deg)}}' +
    '@keyframes leP{0%,100%{transform:scale(1)}50%{transform:scale(1.2)}}' +
    '@media (prefers-reduced-motion:reduce){.le-bounce,.le-shake,.le-spin,.le-pulse{animation:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var playerPromise = null;
  function loadPlayer() {
    if (window.customElements && customElements.get('dotlottie-wc')) return Promise.resolve();
    if (!playerPromise) playerPromise = new Promise(function (ok, no) {
      var s = document.createElement('script'); s.type = 'module'; s.src = PLAYER;
      s.onload = function () { ok(); }; s.onerror = function () { no(new Error('player')); };
      document.head.appendChild(s);
    });
    return playerPromise;
  }
  function exists(url) {
    return fetch(url, { method: 'HEAD' }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }
  function pickSource(name, cfg) {
    return exists('/lottie/' + name + '.lottie').then(function (a) {
      if (a) return '/lottie/' + name + '.lottie';
      return exists('/lottie/' + name + '.json').then(function (b) { return b ? '/lottie/' + name + '.json' : (cfg.src || ''); });
    });
  }
  function mount(el) {
    if (el.__le) return; el.__le = true;
    var name = el.getAttribute('data-lottie-emoji');
    var cfg = REGISTRY[name] || { emoji: el.getAttribute('data-fallback') || '✨', fx: 'le-pulse', src: '' };
    var size = parseInt(el.getAttribute('data-size'), 10) || 24;
    el.style.width = el.style.height = size + 'px';
    el.innerHTML = '<span class="le-fb ' + cfg.fx + '" style="font-size:' + Math.round(size * 0.85) + 'px">' + cfg.emoji + '</span>';
    pickSource(name, cfg).then(function (src) {
      if (!src) return;
      return loadPlayer().then(function () {
        var p = document.createElement('dotlottie-wc');
        p.setAttribute('src', src); p.setAttribute('autoplay', ''); p.setAttribute('loop', '');
        p.style.cssText = 'width:' + size + 'px;height:' + size + 'px;display:block';
        p.addEventListener('error', function () { p.remove(); el.innerHTML = '<span class="le-fb ' + cfg.fx + '" style="font-size:' + Math.round(size * 0.85) + 'px">' + cfg.emoji + '</span>'; });
        el.innerHTML = ''; el.appendChild(p);
      });
    }).catch(function () { /* tetap pakai fallback emoji */ });
  }
  function scan() { document.querySelectorAll('[data-lottie-emoji]').forEach(mount); }
  window.LottieEmoji = { scan: scan, registry: REGISTRY };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
})();
