/* Client realtime (Socket.IO). Dipakai bersama oleh social-ui.js & chat-ui.js.
 *   RT.isOnline(id)        -> apakah user sedang online
 *   RT.on('post:like', fn) -> like dari user lain / tab lain, langsung masuk
 *   RT.on('presence', fn)  -> {id, online}
 *   RT.dot(id)             -> HTML titik hijau untuk dipasang di dalam .rt-av
 * Elemen [data-uid] otomatis dapat class "on" saat online; [data-rt-status] diisi teks; [data-rt-count] diisi jumlah online. */
(function () {
  'use strict';
  if (window.RT) return;
  var online = new Set(), handlers = {}, sock = null, queued = false;
  function fire(ev, data) { (handlers[ev] || []).slice().forEach(function (fn) { try { fn(data); } catch (e) {} }); }
  function paint() {
    queued = false;
    var els = document.querySelectorAll('[data-uid]');
    for (var i = 0; i < els.length; i++) {
      var on = online.has(String(els[i].getAttribute('data-uid')));
      if (els[i].classList.contains('on') !== on) els[i].classList.toggle('on', on);
    }
    var st = document.querySelectorAll('[data-rt-status]');
    for (var j = 0; j < st.length; j++) {
      var o = online.has(String(st[j].getAttribute('data-rt-status')));
      var t = o ? '● Online' : 'Offline';
      if (st[j].textContent !== t) st[j].textContent = t;
      if (st[j].classList.contains('on') !== o) st[j].classList.toggle('on', o);
    }
    var cs = document.querySelectorAll('[data-rt-count]');
    for (var k = 0; k < cs.length; k++) { var n = String(online.size); if (cs[k].textContent !== n) cs[k].textContent = n; }
  }
  function schedule() { if (queued) return; queued = true; (window.requestAnimationFrame || setTimeout)(paint); }

  var RT = window.RT = {
    isOnline: function (id) { return online.has(String(id)); },
    count: function () { return online.size; },
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    off: function (ev, fn) { handlers[ev] = (handlers[ev] || []).filter(function (f) { return f !== fn; }); },
    socket: function () { return sock; },
    paint: schedule,
    dot: function () { return '<i class="rt-dot"></i>'; }
  };

  if (window.AVERPAY_SERVERLESS) {
    var active = true;
    async function poll() {
      if (!active || document.hidden) return;
      try {
        var response = await fetch('/api/runtime/presence', { method: 'POST', credentials: 'same-origin' });
        if (response.status === 401) { active = false; return; }
        if (!response.ok) return;
        var data = await response.json();
        online = new Set((data.online || []).map(String)); schedule(); fire('presence', null);
      } catch (_) {}
    }
    poll(); setInterval(poll, 25000);
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    return;
  }
  if (typeof io === 'undefined') return;
  sock = io({ withCredentials: true });
  sock.on('presence:init', function (d) {
    online.clear(); ((d && d.online) || []).forEach(function (id) { online.add(String(id)); });
    schedule(); fire('presence', null);
  });
  sock.on('presence:update', function (d) {
    if (!d) return;
    if (d.online) online.add(String(d.id)); else online.delete(String(d.id));
    schedule(); fire('presence', d);
  });
  sock.on('post:like', function (d) { if (d) fire('post:like', d); });

  function start() {
    schedule();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
