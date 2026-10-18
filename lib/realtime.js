/* Realtime (Socket.IO): status user online + sinkronisasi like.
 * Session Express dipakai bersama, jadi hanya user yang sudah login yang bisa tersambung. */
const path = require('path');
const { execSync } = require('child_process');

/* Auto-install: kalau socket.io belum terpasang (mis. PM2 jalan tanpa "npm install"),
 * pasang otomatis dari package.json lalu lanjut. Kalau tetap gagal, server web TETAP jalan tanpa realtime. */
function loadSocketIO() {
  try { return require('socket.io'); } catch (e) {
    if (e && e.code !== 'MODULE_NOT_FOUND') throw e;
  }
  try {
    console.log('📦 socket.io belum terpasang, menginstal otomatis...');
    execSync('npm install --omit=dev --no-audit --no-fund --loglevel=error', { cwd: path.join(__dirname, '..'), stdio: 'inherit', timeout: 5 * 60 * 1000 });
    return require('socket.io');
  } catch (e) {
    console.error('⚠️ Gagal auto-install socket.io (' + (e && e.message) + '). Server jalan tanpa realtime. Jalankan manual: npm install');
    return null;
  }
}

function attach({ httpServer, app, sessionMiddleware }) {
  const sio = loadSocketIO();
  if (!sio) return null;
  const { Server } = sio;
  const io = new Server(httpServer, { serveClient: true, pingInterval: 20000, pingTimeout: 25000 });
  app.set('io', io);
  io.engine.use(sessionMiddleware);

  const online = new Map();   // userId -> Set(socket.id)
  const offlineTimers = new Map(); // jeda kecil supaya pindah halaman tidak bikin status kedip

  io.use((socket, next) => {
    const s = socket.request.session;
    if (!s || !s.userId) return next(new Error('unauthorized'));
    socket.data.uid = String(s.userId);
    next();
  });

  io.on('connection', (socket) => {
    const uid = socket.data.uid;
    socket.join('u:' + uid);

    const timer = offlineTimers.get(uid);
    if (timer) { clearTimeout(timer); offlineTimers.delete(uid); }

    let set = online.get(uid);
    const wasOffline = !set || set.size === 0;
    if (!set) { set = new Set(); online.set(uid, set); }
    set.add(socket.id);

    socket.emit('presence:init', { online: Array.from(online.keys()) });
    if (wasOffline) socket.broadcast.emit('presence:update', { id: uid, online: true });

    socket.on('disconnect', () => {
      const cur = online.get(uid);
      if (!cur) return;
      cur.delete(socket.id);
      if (cur.size > 0) return;
      const t = setTimeout(() => {
        offlineTimers.delete(uid);
        const again = online.get(uid);
        if (again && again.size > 0) return;
        online.delete(uid);
        io.emit('presence:update', { id: uid, online: false });
      }, 4000);
      offlineTimers.set(uid, t);
    });
  });

  return io;
}

module.exports = { attach };
