'use strict';
const { randomBytes } = require('node:crypto');
const maintenance = require('./maintenance');
const TTL = 10 * 60 * 1000;
const rp = value => 'Rp ' + Number(value || 0).toLocaleString('id-ID');
const back = { reply_markup: { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'user_menu' }]] } };
const cancel = { reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'service_cancel' }]] } };
function amountFromText(text) {
  const raw = String(text || '').trim();
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(raw)) return null;
  const n = Number(raw.replace(/\./g, ''));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function siteLink(manager, path) {
  try {
    const url = new URL(manager.getProfileUrl());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return new URL(path, url.origin).href;
  } catch (_) { return null; }
}
function userMenu(manager, user) {
  const rows = [
    [{ text: '📲 Buat QRIS · Nominal Bebas', callback_data: 'user_qris' }],
    [{ text: '⚡ Penarikan Instan', callback_data: 'user_withdraw_instant' }, { text: '📝 Penarikan Manual', callback_data: 'user_withdraw_manual' }],
    [{ text: '👤 Profil Saya', callback_data: 'user_profile' }, { text: '💰 Cek Saldo', callback_data: 'user_balance' }],
    [{ text: '📜 Riwayat Transaksi', callback_data: 'user_history' }, { text: '🛍 Layanan Lainnya', callback_data: 'user_services' }]
  ];
  if (user && user.role === 'merchant') rows.push([{ text: '➕ Top Up Saldo Belanja', callback_data: 'user_topup' }]);
  return rows;
}
function photoInput(value) {
  const str = String(value || '');
  const data = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(str);
  if (data) return { source: Buffer.from(data[2], 'base64'), filename: 'qris.' + data[1] };
  try { const url = new URL(str); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return str; } catch (_) {}
  return null;
}
function registerServices(manager, { createDeposit, getSettings, workHours }) {
  const bot = manager.bot, flows = new Map(), busy = new Set();
  manager.withdrawFlow.clear();
  const clear = id => { flows.delete(id); manager.withdrawFlow.delete(id); };
  const ack = ctx => ctx.callbackQuery ? ctx.answerCbQuery().catch(() => {}) : Promise.resolve();
  const menu = async ctx => { await ack(ctx); clear(String(ctx.from.id)); return manager.sendStartMessage(ctx, 'Pilih layanan yang kamu butuhkan:', { reply_markup: { inline_keyboard: manager.userMenuKeyboard(ctx.serviceUser) } }); };
  const expired = (state) => state && Date.now() - state.updatedAt > TTL;

  // Per-chat lock covers the existing withdrawal handlers too. Never run account
  // operations in groups or reuse a flow after Telegram has been linked elsewhere.
  bot.use(async (ctx, next) => {
    const id = String(ctx.from && ctx.from.id || '');
    const data = ctx.callbackQuery && ctx.callbackQuery.data || '';
    const cmd = String(ctx.message && ctx.message.text || '').split(/[\s@]/)[0];
    const managed = /^(user_|wd[timp]_|qris_|service_)/.test(data) ||
      ['/start', '/menu', '/qris', '/topup', '/withdraw', '/tarik', '/cancel', '/batal', '/layanan'].includes(cmd) || flows.has(id) || manager.withdrawFlow.has(id);
    if (!managed) return next();
    if (!ctx.chat || ctx.chat.type !== 'private') { await ack(ctx); return ctx.reply('Buka chat pribadi dengan bot untuk menggunakan menu akun.'); }
    if (busy.has(id)) { await ack(ctx); return ctx.reply('⏳ Permintaan sebelumnya masih diproses. Tunggu sebentar.'); }
    busy.add(id);
    try {
      // Prune idle states without keeping a process timer alive.
      for (const [key, flow] of flows) if (expired(flow)) flows.delete(key);
      for (const [key, flow] of manager.withdrawFlow) if (expired(flow)) manager.withdrawFlow.delete(key);
      const user = await manager.models.User.findOne({ telegramId: id }).lean();
      if (!user) { clear(id); if (cmd === '/start') return next(); await ack(ctx); return ctx.reply('Tautkan ID Telegram di Profil website, lalu kirim /start.'); }
      if (user.suspended) { clear(id); await ack(ctx); return ctx.reply('⚠️ Akun sedang disuspend. Hubungi admin.'); }
      const wd = manager.withdrawFlow.get(id), qr = flows.get(id);
      if ([wd, qr].some(s => s && String(s.userId) !== String(user._id))) clear(id);
      manager.settings = await getSettings();
      ctx.serviceUser = user;
      const withdrawing = /^user_withdraw|^wd[timp]_/.test(data) || ['/withdraw', '/tarik'].includes(cmd) || manager.withdrawFlow.has(id);
      const creatingQris = /^user_(qris|topup)|^qris_/.test(data) || ['/qris','/topup'].includes(cmd) || flows.has(id);
      const maintenanceState = maintenance.decision(manager.settings, user, withdrawing ? '/withdraw' : creatingQris ? '/deposit' : '/dashboard');
      if (maintenanceState) { clear(id); await ack(ctx); return ctx.reply('🛠 ' + maintenanceState.title + '\n' + maintenanceState.scope + '\n\n' + maintenanceState.message); }
      if (withdrawing && !['/start', '/menu', '/cancel', '/batal', '/qris', '/topup', '/layanan'].includes(cmd) && !['user_menu', 'user_cancel_withdraw', 'service_cancel'].includes(data)) {
        if (user.role === 'merchant') { clear(id); await ack(ctx); return ctx.reply('ℹ️ Akun Merchant memakai QRIS pribadi: dana diterima langsung di akun provider. Penarikan saldo website tersedia untuk akun non-Merchant. Buat QRIS melalui menu di bawah.', back); }
        if (!workHours(manager.settings)) { clear(id); await ack(ctx); return ctx.reply('⚠️ Penarikan sedang di luar jam operasional.', back); }
      }
      const currentWd = manager.withdrawFlow.get(id);
      if (currentWd && ['idest', 'account', 'iamount', 'iproduct'].includes(currentWd.step) && !cmd.startsWith('/')) {
        let method;
        if (currentWd.opt) {
          const selected = manager.instantOptions().find(o => o.method.name === currentWd.opt.method.name && o.method.provider === currentWd.opt.method.provider && o.kind === currentWd.opt.kind);
          method = selected && selected.method;
          if (selected) currentWd.opt = selected;
          if (selected && selected.kind === 'fixed' && currentWd.amount) {
            const product = (method.products || []).find(p => p.code === currentWd.productCode && Number(p.amount) === currentWd.amount);
            if (!product) method = null;
          }
        } else method = (manager.settings.withdrawMethods || []).find(m => m.name === currentWd.method.name);
        if (!method || (currentWd.amount && ((method.min && currentWd.amount < method.min) || currentWd.amount > (method.max || 1000000)))) {
          clear(id); await ack(ctx); return ctx.reply('Metode atau batas penarikan berubah. Buka menu penarikan lagi.', back);
        }
        if (!currentWd.opt) currentWd.method = method;
      }
      if (cmd.startsWith('/') || ['user_menu', 'user_profile', 'user_balance', 'user_history', 'user_services'].includes(data)) clear(id);
      await next();
      const state = manager.withdrawFlow.get(id);
      if (state) state.updatedAt = Date.now();
    } finally { busy.delete(id); }
  });
  bot.command('menu', menu);
  bot.command(['cancel', 'batal'], menu);
  bot.action('service_cancel', menu);

  const withdraw = async (ctx, mode) => {
    await ack(ctx); const id = String(ctx.from.id); clear(id);
    manager.withdrawFlow.set(id, { step: 'type', userId: String(ctx.serviceUser._id), updatedAt: Date.now() });
    if (mode === 'instant') return manager.wdShowInstantMethods(ctx, id);
    if (mode === 'manual') return manager.wdShowManualMethods(ctx, id);
    return ctx.reply('Pilih jenis penarikan:', { reply_markup: { inline_keyboard: [userMenu(manager)[1], ...back.reply_markup.inline_keyboard] } });
  };
  bot.command(['withdraw', 'tarik'], ctx => withdraw(ctx));
  bot.action('user_withdraw_instant', ctx => withdraw(ctx, 'instant'));
  bot.action('user_withdraw_manual', ctx => withdraw(ctx, 'manual'));

  const startQris = async (ctx, topup = false) => {
    await ack(ctx); const id = String(ctx.from.id); clear(id);
    if (topup && ctx.serviceUser.role !== 'merchant') topup = false;
    flows.set(id, { step: 'amount', topup, userId: String(ctx.serviceUser._id), updatedAt: Date.now() });
    return ctx.reply(`📲 ${topup ? 'Top Up Saldo Belanja' : 'Buat QRIS'}\nKetik nominal rupiah, contoh 10000 atau 10.000.\nMinimal ${rp(manager.settings.minDeposit)}. Biaya dan total bayar ditampilkan setelah QRIS dibuat.\n${ctx.serviceUser.role === 'merchant' && !topup ? 'Menggunakan QRIS pribadi sesuai pengaturan akun.' : 'Menggunakan gateway dan aturan biaya admin yang aktif.'}`, cancel);
  };
  bot.command('qris', ctx => startQris(ctx));
  bot.command('topup', ctx => startQris(ctx, true));
  bot.action('user_qris', ctx => startQris(ctx));
  bot.action('user_topup', ctx => startQris(ctx, true));

  async function showInvoice(ctx, dep, sendPhoto) {
    const id = String(dep._id);
    let status = dep.status;
    if (status === 'pending' && new Date(dep.expiredAt).getTime() <= Date.now()) status = 'expired';
    const statuses = { pending: 'Menunggu pembayaran', paid: 'Sudah dibayar', expired: 'Kedaluwarsa', cancelled: 'Dibatalkan', success: 'Berhasil' };
    const text = `📲 QRIS ${dep.isTopup ? 'Top Up' : 'Pembayaran'}\nID: ${id}\nNominal: ${rp(dep.amount)}\nBiaya: ${rp(dep.fee)}\nTotal bayar: ${rp(dep.total)}\nStatus: ${statuses[status] || status}\nBerlaku sampai: ${new Date(dep.expiredAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n${status === 'pending' ? 'Bayar sesuai total. Jangan membayar QRIS yang sudah kedaluwarsa.' : 'Status mengikuti catatan transaksi website.'}`;
    const extra = { reply_markup: { inline_keyboard: [[{ text: '🔄 Cek Status', callback_data: 'qris_status:' + id }], ...back.reply_markup.inline_keyboard] } };
    if (sendPhoto && status === 'pending') {
      const photo = photoInput(dep.qris_image);
      if (photo) { try { return await ctx.replyWithPhoto(photo, { caption: text, ...extra }); } catch (_) {} }
      extra.reply_markup.inline_keyboard.unshift([{ text: '🖼 Kirim Ulang QRIS', callback_data: 'qris_show:' + id }]);
      const url = siteLink(manager, dep.isTopup ? '/merchant/topup' : '/deposit');
      if (url) extra.reply_markup.inline_keyboard.unshift([{ text: '🌐 Lihat QRIS di Website', url }]);
      return ctx.reply(text + '\n\nQRIS sudah dibuat, tetapi gambar belum dapat dikirim. Kirim ulang gambar atau lihat di website; tidak perlu membuat invoice baru.', extra);
    }
    return ctx.reply(text, extra);
  }
  bot.on('text', async (ctx, next) => {
    const id = String(ctx.from.id), state = flows.get(id);
    if (!state) return next();
    if (state.step !== 'amount') return ctx.reply('Tekan Buat QRIS untuk konfirmasi, atau Batal.', cancel);
    const amount = amountFromText(ctx.message.text);
    if (amount === null) return ctx.reply('Masukkan rupiah bulat positif, contoh 10000 atau 10.000. Tanpa tanda minus atau desimal.', cancel);
    if (amount < Number(manager.settings.minDeposit || 0)) return ctx.reply('Minimal ' + rp(manager.settings.minDeposit) + '.', cancel);
    state.amount = amount; state.step = 'confirm'; state.nonce = randomBytes(12).toString('hex'); state.updatedAt = Date.now();
    return ctx.reply(`Buat QRIS senilai ${rp(amount)}?\nBiaya mengikuti pengaturan akun dan admin. Total final muncul pada QRIS. Saldo tidak dipotong saat membuat QRIS.`, { reply_markup: { inline_keyboard: [[{ text: '✅ Buat QRIS', callback_data: 'qris_create:' + state.nonce }], ...cancel.reply_markup.inline_keyboard] } });
  });
  bot.action(/^qris_create:([a-f0-9]{24})$/, async ctx => {
    await ack(ctx); const id = String(ctx.from.id), state = flows.get(id);
    if (!state || state.step !== 'confirm' || state.nonce !== ctx.match[1]) return ctx.reply('Konfirmasi sudah dipakai atau kedaluwarsa. Kirim /qris untuk mulai lagi.', back);
    // Consume before awaiting the gateway; repeated callbacks cannot create twice.
    flows.delete(id);
    if (state.topup && ctx.serviceUser.role !== 'merchant') return ctx.reply('Jenis akun berubah. Mulai ulang melalui /qris.', back);
    if (state.amount < Number(manager.settings.minDeposit || 0)) return ctx.reply('Minimal deposit berubah. Mulai ulang melalui /qris.', back);
    let dep;
    try { dep = await createDeposit(ctx.serviceUser._id, state.amount, manager.settings, state.topup); }
    catch (_) { return ctx.reply('⚠️ QRIS belum berhasil dibuat. Cek Riwayat Transaksi terlebih dahulu sebelum mencoba lagi. Jika belum ada invoice, periksa konfigurasi gateway dengan admin.', back); }
    return showInvoice(ctx, dep, true);
  });
  bot.action(/^qris_(status|show):([A-Za-z0-9_-]{1,45})$/, async ctx => {
    await ack(ctx);
    const dep = await manager.models.Transaction.findOne({ _id: ctx.match[2], userId: ctx.serviceUser._id, type: 'deposit' }).lean();
    if (!dep) return ctx.reply('Invoice tidak ditemukan untuk akun kamu.', back);
    return showInvoice(ctx, dep, ctx.match[1] === 'show');
  });
  const services = async ctx => {
    await ack(ctx);
    const links = [['🏠 Dashboard', '/dashboard'], ['📲 QRIS & Riwayat', '/deposit'], ['🔁 Transfer Saldo', '/transfer'], ['📱 Nokos', '/nokos'], ['🎬 Aplikasi Premium', '/premium'], ['🎟 Voucher', '/voucher'], ['💬 Bantuan', '/bantuan']];
    const rows = links.map(([text, path]) => ({ text, url: siteLink(manager, path) })).filter(b => b.url).map(b => [b]);
    return ctx.reply(rows.length ? '🛍 Pilih layanan website. Login dengan akunmu untuk melanjutkan.' : 'Admin perlu mengisi URL Profil Telegram di Pengaturan agar tombol layanan website tersedia.', { reply_markup: { inline_keyboard: [...rows, ...back.reply_markup.inline_keyboard] } });
  };
  bot.command('layanan', services);
  bot.action('user_services', services);
}
module.exports = { registerServices, userMenu, amountFromText, photoInput, siteLink };
