'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { Telegraf } = require('telegraf');
const telegramServices = require('../lib/telegram-services');
const { TelegramBotLifecycle, botError } = require('../lib/telegram-lifecycle');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const start = source.indexOf('class BotManager extends TelegramBotLifecycle {'), end = source.indexOf('\n}', start) + 2;
const query = data => ({ lean: async () => data, select() { return this; }, sort() { return this; }, limit() { return this; }, then(resolve, reject) { return Promise.resolve(data).then(resolve, reject); } });
function fixture() {
  let user = { _id: 'U1', username: 'tester', telegramId: '123', email: 'test@example.test', createdAt: new Date(), role: 'user', balance: 100000, pinEnabled: false, suspended: false };
  const settings = { name: 'QA', minDeposit: 1000, telegramProfileUrl: 'https://example.test/profile', telegramStartPhotoUrl: '', withdrawMethods: [{ name: 'Bank Uji', min: 1000, max: 100000, fee: 500 }], instantWithdrawMethods: [{ name: 'Instan Uji', provider: 'vipreseller', active: true, fee: 500, products: [{ code: 'TEST10', amount: 10000 }] }] };
  const calls = [], invoices = [], withdrawals = [], debits = [];
  let createCalls = 0, createOverride, photoFail = false;
  const models = {
    User: { findOne: () => query(user), findById: () => query(user), findOneAndUpdate: async (filter, update) => { debits.push({filter, update}); user.balance += update.$inc.balance; return user; }, findByIdAndUpdate: async () => {} },
    Transaction: { findOne: filter => query(invoices.find(d => d._id === filter._id && d.userId === filter.userId && d.type === filter.type) || null), find: () => query([...invoices, ...withdrawals]) }
  };
  const deps = {
    TelegramBotLifecycle, botError, Telegraf, telegramServices,
    getSettings: async () => settings, isWithinWorkHours: s => !s.closed,
    createDepositTransaction: async (userId, amount, st, topup) => {
      createCalls++; if (createOverride) return createOverride();
      const d = { _id: 'INV' + createCalls, userId, type: 'deposit', amount, fee: 100, total: amount + 100, status: 'pending', isTopup: topup, qris_image: 'data:image/png;base64,aGVsbG8=', expiredAt: new Date(Date.now() + 60000) }; invoices.push(d); return d;
    },
    instantMethodUsable: m => m.active, instantProviderOf: m => m.provider, instantProviderAllowed: () => true, instantProviderReady: () => true,
    austinConfigured: () => false, sekalipayConfigured: () => false,
    paketRuleFor: async () => ({ fee: 200 }), paketFee: r => r.fee, instantFeeFor: r => r.fee,
    instantIsOpenDenom: () => false, mapEwalletCekCode: () => null,
    instantExecute: async () => ({ provider: 'vipreseller', result: { trxid: 'GW1' } }),
    createWithRetry: async (model, data) => { const d = { ...data, save: async () => {} }; withdrawals.push(d); return d; },
    generateCustomId: prefix => prefix + (withdrawals.length + 1), startId: { withdraw: 'WD' },
    console: { error() {} }
  };
  const Manager = new Function(...Object.keys(deps), source.slice(start, end) + '; return BotManager;')(...Object.values(deps));
  const manager = new Manager(models); manager.settings = settings;
  manager.notifyWithdrawRequest = () => {}; manager.notifyError = () => {};
  const bot = manager.createBot('123:TEST_ONLY', '999');
  bot.botInfo = { id: 456, is_bot: true, username: 'qa_bot' };
  // Patch context too: Telegraf constructs a Telegram client for each update.
  const { Telegram } = require('telegraf');
  const api = async (method, payload) => {
    calls.push({ method, payload });
    if (method === 'sendPhoto' && photoFail) throw new Error('photo unavailable');
    if (!['sendPhoto', 'sendMessage', 'answerCallbackQuery', 'deleteMessage'].includes(method)) throw new Error('Unexpected Telegram API: ' + method);
    return { message_id: calls.length, chat: { id: 123, type: 'private' } };
  };
  bot.telegram.callApi = api;
  let sequence = 1;
  async function update(text, callback, type = 'private') {
    const chat = { id: 123, type }, from = { id: 123, is_bot: false, first_name: 'QA' };
    const u = { update_id: sequence++ };
    if (callback) u.callback_query = { id: String(sequence), from, chat_instance: 'test', data: callback, message: { message_id: 1, chat, date: 1, text: 'Menu' } };
    else { u.message = { message_id: sequence, from, chat, date: 1, text }; if (text.startsWith('/')) u.message.entities = [{ offset: 0, length: text.split(' ')[0].length, type: 'bot_command' }]; }
    // Run middleware directly with a real Telegraf Context and a mocked Telegram client.
    const { Context } = require('telegraf');
    const telegram = new Telegram('123:TEST_ONLY'); telegram.callApi = api;
    await bot.middleware()(new Context(u, telegram, bot.botInfo), async () => {});
  }
  const latest = () => calls.filter(c => c.method === 'sendMessage' || c.method === 'sendPhoto').at(-1).payload;
  const nonce = () => latest().reply_markup.inline_keyboard[0][0].callback_data;
  return { manager, settings, calls, invoices, withdrawals, debits, update, latest, nonce, get user() { return user; }, set user(v) { user = v; }, get createCalls() { return createCalls; }, set createOverride(v) { createOverride = v; }, set photoFail(v) { photoFail = v; } };
}
test('start and menu show QRIS + separate withdrawals for user and merchant', async () => {
  const f = fixture();
  for (const role of ['user', 'merchant']) { f.user.role = role; for (const cmd of ['/start', '/menu']) { await f.update(cmd); const keys = f.latest().reply_markup.inline_keyboard.flat().map(b => b.callback_data); for (const key of ['user_qris','user_withdraw_manual','user_withdraw_instant','user_services']) assert(keys.includes(key)); } }
  await f.update('', 'user_withdraw_manual'); assert.match(f.latest().text, /Merchant/); assert.equal(f.debits.length, 0);
});
test('QRIS amount, confirm, image, duplicate callback and scoped status', async () => {
  const f = fixture(); await f.update('/qris');
  for (const amount of ['-10000', 'abc', '1.5', '0', '999']) { await f.update(amount); assert.equal(f.createCalls, 0); }
  await f.update('10.000'); const token = f.nonce(); assert.equal(f.createCalls, 0);
  await f.update('', token); assert.equal(f.createCalls, 1); assert.equal(f.invoices[0].amount, 10000);
  assert.match(f.latest().caption, /Total bayar: Rp 10.100/); assert(Buffer.isBuffer(f.latest().photo.source));
  await f.update('', token); assert.equal(f.createCalls, 1);
  f.invoices[0].status = 'paid'; await f.update('', 'qris_status:INV1'); assert.match(f.latest().text, /Sudah dibayar/);
  f.invoices.push({ _id: 'FOREIGN', userId: 'U2', type: 'deposit' }); await f.update('', 'qris_status:FOREIGN'); assert.match(f.latest().text, /tidak ditemukan/);
});
test('QRIS cancellation, stale nonce, expiry and group/suspended/unlinked guards', async () => {
  const f = fixture(); await f.update('/qris'); await f.update('10000'); const token = f.nonce(); await f.update('/cancel'); await f.update('', token); assert.equal(f.createCalls, 0);
  await f.update('/qris', null, 'group'); assert.match(f.latest().text, /chat pribadi/);
  f.user.suspended = true; await f.update('/qris'); assert.match(f.latest().text, /disuspend/);
  f.user = null; await f.update('/qris'); assert.match(f.latest().text, /Tautkan/);
});
test('parallel confirmation creates only one invoice; image failure reuses saved invoice', async () => {
  const f = fixture(); await f.update('/qris'); await f.update('10000'); const token = f.nonce(); f.photoFail = true;
  await Promise.all([f.update('', token), f.update('', token)]); assert.equal(f.createCalls, 1); assert.equal(f.invoices.length, 1);
  assert.match(f.latest().text, /QRIS sudah dibuat/); f.photoFail = false;
  await f.update('', 'qris_show:INV1'); assert.equal(f.createCalls, 1); assert.match(f.latest().caption, /INV1/);
  f.invoices[0].expiredAt = new Date(0); await f.update('', 'qris_show:INV1'); assert.match(f.latest().text, /Kedaluwarsa/); assert.equal(f.latest().photo, undefined);
});
test('merchant QRIS and topup invoke the same shared deposit service with distinct modes', async () => {
  const f = fixture(); f.user.role = 'merchant';
  await f.update('/qris'); await f.update('10000'); await f.update('', f.nonce()); assert.equal(f.invoices[0].isTopup, false);
  await f.update('/topup'); await f.update('10000'); await f.update('', f.nonce()); assert.equal(f.invoices[1].isTopup, true);
});
test('manual and instant withdrawals complete without PIN even when website PIN is enabled', async () => {
  const f = fixture(); f.user.pinEnabled = true; f.user.pinLockedUntil = new Date(Date.now() + 60000); await f.update('', 'user_withdraw_manual'); assert.match(f.latest().text, /metode penarikan manual/);
  await f.update('', 'wdm_0'); await f.update('10000'); await f.update('081234567890');
  assert.equal(f.withdrawals.length, 1); assert.equal(f.withdrawals[0].instant, false); assert.equal(f.withdrawals[0].fee, 200); assert.equal(f.debits[0].update.$inc.balance, -10200);
  await f.update('', 'user_withdraw_instant'); await f.update('', 'wdi_0'); await f.update('', 'wdp_0'); await f.update('081234567890');
  assert.equal(f.withdrawals.length, 2); assert.equal(f.withdrawals[1].instant, true); assert.equal(f.withdrawals[1].gatewayTrxId, 'GW1');
  assert.equal(f.debits[1].filter.telegramId, '123');
  for (const debit of f.debits) assert.equal(Object.hasOwn(debit.filter, 'pinEnabled'), false);
  assert.equal(f.user.pinEnabled, true);
  assert(!f.calls.some(c => /verifikasi PIN|Penarikan dengan PIN/.test(c.payload.text || '')));
});
test('withdraw hours, changed method and changed account block debit', async () => {
  const f = fixture(); f.settings.closed = true; await f.update('', 'user_withdraw_instant'); assert.match(f.latest().text, /jam operasional/);
  f.settings.closed = false; await f.update('', 'user_withdraw_manual'); await f.update('', 'wdm_0'); await f.update('10000'); f.settings.withdrawMethods = []; await f.update('081234567890'); assert.match(f.latest().text, /berubah/); assert.equal(f.debits.length, 0);
  await f.update('', 'user_withdraw_instant'); await f.update('', 'wdi_0'); await f.update('', 'wdp_0'); f.user._id = 'U2'; await f.update('081234567890'); assert.equal(f.debits.length, 0);
});
test('latest minimum checked again and gateway errors do not reveal secrets', async () => {
  const f = fixture(); await f.update('/qris'); await f.update('10000'); const token = f.nonce(); f.settings.minDeposit = 20000; await f.update('', token); assert.equal(f.createCalls, 0);
  f.settings.minDeposit = 1000; f.createOverride = async () => { throw new Error('apikey=SECRET'); };
  await f.update('/qris'); await f.update('10000'); await f.update('', f.nonce()); assert.match(f.latest().text, /belum berhasil/); assert.doesNotMatch(f.latest().text, /SECRET/);
});
test('service links and commands return to menu without owner backup exposure', async () => {
  const f = fixture(); await f.update('/layanan'); assert(f.latest().reply_markup.inline_keyboard.flat().some(b => b.url === 'https://example.test/transfer'));
  await f.update('/menu'); assert(!f.latest().reply_markup.inline_keyboard.flat().some(b => b.callback_data === 'backup'));
  await f.update('/adminmenu'); assert.match(f.latest().text, /khusus owner/);
});
test('maintenance blocks pending bot confirmation without debit and reopens after disable', async () => {
  const f=fixture();await f.update('/qris');await f.update('10000');const token=f.nonce();
  f.settings.maintenance={enabled:true,mode:'services',services:[{id:'deposit',message:'QRIS diperbaiki'}]};
  await f.update('',token);assert.equal(f.createCalls,0);assert.match(f.latest().text,/QRIS diperbaiki/);
  f.settings.maintenance={enabled:true,mode:'services',services:[{id:'withdraw',message:'Penarikan diperbaiki'}]};
  await f.update('','user_withdraw_instant');assert.equal(f.debits.length,0);assert.match(f.latest().text,/Penarikan diperbaiki/);
  f.settings.maintenance.enabled=false;await f.update('/qris');await f.update('10000');await f.update('',f.nonce());assert.equal(f.createCalls,1);
});
