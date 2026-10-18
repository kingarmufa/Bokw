/* Web Push (notifikasi browser) untuk chat & pengumuman.
 * - Kunci VAPID dibuat otomatis sekali, disimpan di MongoDB (koleksi pushconfigs) — atau pakai env VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
 * - Subscription tiap perangkat disimpan di MongoDB (koleksi pushsubscriptions).
 * - Kalau paket "web-push" belum terpasang, dipasang otomatis (sama seperti socket.io). Kalau gagal, server TETAP jalan tanpa push. */
const path = require('path');
const { execSync } = require('child_process');

function loadWebPush() {
  try { return require('web-push'); } catch (e) { if (e && e.code !== 'MODULE_NOT_FOUND') throw e; }
  return null;
}

function init({ app, mongoose, isAuth, getIcon }) {
  const webpush = loadWebPush();

  const configSchema = new mongoose.Schema({ key: { type: String, unique: true }, publicKey: String, privateKey: String });
  const PushConfig = mongoose.models.PushConfig || mongoose.model('PushConfig', configSchema);
  const subSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },
    endpoint: { type: String, unique: true },
    keys: { p256dh: String, auth: String },
    ua: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
  });
  const PushSub = mongoose.models.PushSubscription || mongoose.model('PushSubscription', subSchema);

  let publicKey = '';
  let ready = false;
  let readyPromise;
  function ensurePush() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
    if (!webpush) return;
    try {
      let pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
      if (!pub || !priv) {
        let cfg = await PushConfig.findOne({ key: 'vapid' }).lean();
        if (!cfg) {
          const k = webpush.generateVAPIDKeys();
          cfg = (await PushConfig.findOneAndUpdate({ key: 'vapid' }, { $setOnInsert: { publicKey: k.publicKey, privateKey: k.privateKey } }, { upsert: true, new: true })).toObject();
        }
        pub = cfg.publicKey; priv = cfg.privateKey;
      }
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@localhost.invalid', pub, priv);
      publicKey = pub; ready = true;
    } catch (e) { console.error('Push init gagal'); readyPromise = null; }
    })();
    return readyPromise;
  }

  app.get('/push/key', isAuth, async (req, res) => {
    await ensurePush();
    res.set('Cache-Control', 'no-store');
    res.json({ ok: ready, key: publicKey });
  });

  app.post('/push/subscribe', isAuth, async (req, res) => {
    try {
      await ensurePush();
      if (!ready) return res.json({ ok: false });
      const s = req.body && req.body.subscription;
      if (!s || typeof s.endpoint !== 'string' || !s.keys || !s.keys.p256dh || !s.keys.auth) return res.json({ ok: false });
      await PushSub.findOneAndUpdate(
        { endpoint: s.endpoint },
        { userId: req.session.userId, endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, ua: String(req.headers['user-agent'] || '').slice(0, 200) },
        { upsert: true, new: true }
      );
      res.json({ ok: true });
    } catch (e) { res.json({ ok: false }); }
  });

  app.post('/push/unsubscribe', isAuth, async (req, res) => {
    try {
      const ep = req.body && req.body.endpoint;
      if (ep) await PushSub.deleteOne({ endpoint: String(ep), userId: req.session.userId });
      res.json({ ok: true });
    } catch (e) { res.json({ ok: false }); }
  });

  // Tes cepat: kirim notifikasi ke perangkat milik sendiri. Buka /push/test di browser setelah login.
  app.get('/push/test', isAuth, async (req, res) => {
    await ensurePush();
    if (!ready) return res.json({ ok: false, message: 'Push nonaktif (web-push belum terpasang / VAPID gagal dibuat).' });
    const subs = await PushSub.find({ userId: req.session.userId }).lean();
    if (!subs.length) return res.json({ ok: false, message: 'Perangkat ini belum terdaftar. Izinkan notifikasi dulu lalu muat ulang halaman.' });
    const r = await deliver(subs, { title: '🔔 Tes notifikasi', body: 'Kalau ini muncul, notifikasi sudah aktif.', url: '/dashboard', tag: 'test' });
    res.json({ ok: true, devices: subs.length, sent: r.sent, failed: r.failed });
  });

  // Icon notifikasi = URL logo yang diatur admin (Pengaturan > Logo). Payload yang sudah bawa icon sendiri dibiarkan.
  async function resolveIcon() {
    try {
      let u = typeof getIcon === 'function' ? await getIcon() : '';
      u = String(u || '').trim();
      if (!u) return '';
      if (/^https?:\/\//i.test(u)) return u;
      const base = String(process.env.BASE_URL || process.env.APP_URL || process.env.SITE_URL || '').replace(/\/+$/, '');
      return u.startsWith('/') && base ? base + u : (u.startsWith('/') ? u : '');
    } catch (_) { return ''; }
  }

  async function deliver(subs, payload) {
    if (!ready || !subs.length) return { sent: 0, failed: 0 };
    if (payload && !payload.icon) {
      const icon = await resolveIcon();
      if (icon) payload = Object.assign({}, payload, { icon });
    }
    const body = JSON.stringify(payload);
    let sent = 0, failed = 0;
    const dead = [];
    const queue = subs.slice();
    async function worker() {
      while (queue.length) {
        const sub = queue.shift();
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, { TTL: 86400 });
          sent++;
        } catch (e) {
          failed++;
          if (e && (e.statusCode === 404 || e.statusCode === 410)) dead.push(sub.endpoint);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(10, subs.length) }, worker));
    if (dead.length) PushSub.deleteMany({ endpoint: { $in: dead } }).catch(() => {});
    return { sent, failed };
  }

  // payload: { title, body, url, tag, icon }
  async function sendToUsers(userIds, payload) {
    try {
      await ensurePush();
      const ids = Array.from(new Set((userIds || []).map(String)));
      if (!ready || !ids.length) return;
      const subs = await PushSub.find({ userId: { $in: ids } }).lean();
      if (!subs.length) { console.log('[push] tidak ada perangkat terdaftar untuk user', ids.join(',')); return; }
      const r = await deliver(subs, payload);
      console.log('[push] terkirim ' + r.sent + ', gagal ' + r.failed + ' ->', payload.title);
    } catch (e) { console.error('sendToUsers push error:', e.message); }
  }
  async function sendToAll(payload, excludeUserId) {
    try {
      await ensurePush();
      if (!ready) return;
      const q = excludeUserId ? { userId: { $ne: excludeUserId } } : {};
      const subs = await PushSub.find(q).lean();
      await deliver(subs, payload);
    } catch (e) { console.error('sendToAll push error:', e.message); }
  }

  return { sendToUsers, sendToAll, PushSub };
}

module.exports = { init };
