/* Service worker: menampilkan notifikasi push (chat, pengumuman, dll) walau tab/browser ditutup. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (event) {
  var d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'Notifikasi', body: event.data ? event.data.text() : '' }; }
  var title = d.title || 'Notifikasi';
  var opts = {
    body: d.body || '',
    icon: d.icon || '/icon.png',
    badge: d.badge || '/icon.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if ('focus' in c) { if ('navigate' in c) { try { c.navigate(url); } catch (e) {} } return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  }));
});
