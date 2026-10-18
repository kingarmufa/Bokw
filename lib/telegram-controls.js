'use strict';
const { botError, publicError } = require('./telegram-lifecycle');

function createBotControls({ Setting, getManager }) {
  let queue = Promise.resolve();
  const unavailable = { botRunning: false, enabled: false, state: 'unavailable', error: 'Bot Manager belum siap. Tunggu koneksi database lalu muat ulang.', warning: '', username: '' };
  const status = (req, res) => {
    res.set('Cache-Control', 'no-store');
    const manager = getManager();
    res.json({ success: !!manager, ...(manager ? manager.getStatus() : unavailable) });
  };
  function control(restart) {
    return async (req, res) => {
      const task = async () => {
        const manager = getManager();
        if (!manager) return res.status(503).json({ success: false, ...unavailable });
        try {
          if (!restart && typeof req.body?.enabled !== 'boolean') {
            return res.status(400).json({ success: false, ...manager.getStatus(), error: 'Pilih ON atau OFF secara jelas.' });
          }
          const enabled = restart || req.body.enabled;
          const settings = await Setting.findOne();
          if (!settings) throw publicError('Pengaturan belum tersedia. Muat ulang setelah database siap.');
          if (enabled) {
            const token = typeof req.body?.token === 'string' ? req.body.token.trim() : String(settings.telegramBotToken || '').trim();
            const owner = typeof req.body?.ownerId === 'string' ? req.body.ownerId.trim() : String(settings.telegramOwnerId || '').trim();
            if (!/^\d+:[A-Za-z0-9_-]+$/.test(token) || token.length > 255) throw publicError('Isi Token Bot yang valid dari @BotFather.');
            if (!/^-?\d{1,20}$/.test(owner)) throw publicError('Isi Owner ID berupa angka ID Telegram.');
            settings.telegramBotToken = token; settings.telegramOwnerId = owner;
          }
          settings.telegramBotEnabled = enabled;
          await settings.save();
          if (restart) await manager.stopBot();
          await manager.updateSettings(settings);
          const snapshot = manager.getStatus();
          const success = !enabled || snapshot.botRunning;
          return res.status(success ? 200 : 502).json({ success, ...snapshot,
            message: enabled ? 'Bot online dan siap menerima pesan.' : 'Bot OFF. Tidak akan otomatis aktif saat server dimulai ulang.' });
        } catch (error) {
          return res.status(error.botPublicMessage ? 400 : 502).json({ success: false, ...manager.getStatus(), error: botError(error) });
        }
      };
      const result = queue.then(task);
      queue = result.catch(() => {});
      return result;
    };
  }
  return { status, toggle: control(false), restart: control(true) };
}
module.exports = { createBotControls };
