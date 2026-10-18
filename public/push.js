/* Minta izin notifikasi + daftarkan perangkat untuk push (chat, pengumuman, dll). */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;

  function b64ToUint8(s) {
    var p = '='.repeat((4 - s.length % 4) % 4);
    var raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function post(url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }

  function subscribe() {
    return navigator.serviceWorker.register('/sw.js').then(function (reg) {
      return navigator.serviceWorker.ready.then(function () {
        return fetch('/push/key', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (k) {
          if (!k || !k.ok || !k.key) throw new Error('push off');
          return reg.pushManager.getSubscription().then(function (existing) {
            return existing || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(k.key) });
          });
        });
      }).then(function (sub) { return post('/push/subscribe', { subscription: sub.toJSON() }); });
    });
  }

  var KEY = 'averpayPushAsked';
  function banner() {
    if (document.getElementById('pushAsk')) return;
    var el = document.createElement('div');
    el.id = 'pushAsk';
    el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:92px;z-index:99999;max-width:420px;margin:0 auto;background:#fff;color:#171717;border:3px solid #171717;border-radius:14px;box-shadow:4px 4px 0 #171717;padding:12px 14px;font-family:"Baloo 2",sans-serif;font-size:14px';
    el.innerHTML = '<div style="font-weight:700;margin-bottom:4px">🔔 Izinkan notifikasi?</div>' +
      '<div style="margin-bottom:10px;line-height:1.35">Biar kamu langsung tahu ada chat baru, pengumuman, dan info penting lainnya.</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button id="pushNo" type="button" style="padding:7px 12px;border:2.5px solid #171717;border-radius:10px;background:#fff;font-weight:700">Nanti</button>' +
      '<button id="pushYes" type="button" style="padding:7px 12px;border:2.5px solid #171717;border-radius:10px;background:#edc531;font-weight:700">Izinkan</button></div>';
    document.body.appendChild(el);
    document.getElementById('pushNo').onclick = function () { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} el.remove(); };
    document.getElementById('pushYes').onclick = function () {
      el.remove();
      Notification.requestPermission().then(function (p) {
        try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
        if (p === 'granted') subscribe().catch(function () {});
      });
    };
  }

  function init() {
    if (Notification.permission === 'granted') { subscribe().catch(function () {}); return; }
    if (Notification.permission === 'denied') return;
    var last = 0; try { last = parseInt(localStorage.getItem(KEY) || '0', 10) || 0; } catch (e) {}
    if (Date.now() - last < 3 * 24 * 3600 * 1000) return; // tanya ulang maks tiap 3 hari
    setTimeout(banner, 2500);
  }
  window.AverpayPush = { ask: banner, subscribe: subscribe };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
