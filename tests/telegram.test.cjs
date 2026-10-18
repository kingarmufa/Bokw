'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Telegraf, TelegramError } = require('telegraf');
const { TelegramBotLifecycle, botError } = require('../lib/telegram-lifecycle');
const { createBotControls } = require('../lib/telegram-controls');
const tick = () => new Promise(resolve => setImmediate(resolve));
const settings = enabled => ({ telegramBotEnabled: enabled, telegramBotToken: '123:TEST_ONLY', telegramOwnerId: '12345' });
function waiting(signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { const e = new Error('cancelled'); e.name = 'AbortError'; reject(e); };
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
}
class MockNetworkBot extends TelegramBotLifecycle {
  constructor(api, options) { super(options); this.api = api; this.calls = []; this.instances = []; }
  createBot(token, owner) {
    const bot = new Telegraf(token); this.instances.push(bot); this.ownerId = owner;
    // All HTTP is replaced BEFORE lifecycle launch. No Telegram contact.
    bot.telegram.callApi = async (method, payload, options) => {
      this.calls.push({ method, payload, bot });
      if (this.api) {
        const result = await this.api(method, payload, options, bot);
        if (result !== undefined) return result;
      }
      if (method === 'getMe') return { id: 123, is_bot: true, username: 'qa_simulated_bot' };
      if (method === 'deleteWebhook' || method === 'setMyCommands' || method === 'sendMessage') return true;
      if (method === 'getUpdates') return payload.timeout === 0 ? [] : waiting(options.signal);
      throw new Error('Unexpected API: ' + method);
    };
    return bot;
  }
}
test('ON waits for real polling; repeated ON/settings save is idempotent; OFF cancels polling', async () => {
  let release;
  const bot = new MockNetworkBot((method, body) => method === 'getUpdates' && body.timeout === 0 ? new Promise(r => { release = r; }) : undefined);
  const start = bot.updateSettings(settings(true)); await tick();
  assert.equal(bot.isRunning(), false); assert.equal(bot.state, 'starting');
  release([]); await start; await tick();
  assert.equal(bot.isRunning(), true); assert.equal(bot.getStatus().username, 'qa_simulated_bot');
  assert.equal(bot.calls.find(c => c.method === 'deleteWebhook').payload.drop_pending_updates, false);
  await bot.updateSettings({ ...settings(true), name: 'New website name' });
  assert.equal(bot.instances.length, 1);
  await bot.updateSettings(settings(false)); await tick();
  assert.equal(bot.state, 'stopped'); assert.equal(bot.bot, null); assert.equal(bot.isRunning(), false);
  assert.equal(bot.getStatus().enabled, false);
});
test('invalid token fails honestly; OFF works after launch fails and retry succeeds', async () => {
  let fail = true;
  const bot = new MockNetworkBot(method => { if (method === 'getMe' && fail) throw new TelegramError({ error_code: 401, description: 'invalid' }); });
  await assert.rejects(bot.updateSettings(settings(true)), /Token bot tidak valid/);
  assert.equal(bot.state, 'error'); assert.equal(bot.isRunning(), false);
  await bot.updateSettings({ telegramBotEnabled: false }); assert.equal(bot.state, 'stopped');
  fail = false; await bot.updateSettings(settings(true)); assert(bot.isRunning()); await bot.stopBot();
});
test('409 during initial polling cannot turn status green and no token is exposed', async () => {
  const bot = new MockNetworkBot(method => { if (method === 'getUpdates') throw new TelegramError({ error_code: 409, description: 'https://api.telegram.org/bot123:SECRET_TOKEN/getUpdates' }); });
  await assert.rejects(bot.updateSettings(settings(true)), /proses bot lain/);
  assert.equal(bot.isRunning(), false); assert.equal(bot.state, 'error');
  assert.doesNotMatch(JSON.stringify(bot.getStatus()), /SECRET_TOKEN|TEST_ONLY|api.telegram.org\/bot/);
  await bot.stopBot();
});
test('late fatal polling error updates status after a successful start', async () => {
  let fail;
  const bot = new MockNetworkBot((method, body) => method === 'getUpdates' && body.timeout > 0 ? new Promise((r, reject) => { fail = reject; }) : undefined);
  await bot.updateSettings(settings(true)); await tick(); assert(bot.isRunning());
  fail(new TelegramError({ error_code: 409, description: 'Conflict' })); await tick();
  assert.equal(bot.isRunning(), false); assert.equal(bot.state, 'error'); assert.match(bot.lastError, /instance lama/);
  await bot.stopBot();
});
test('transient Telegram rate limit is shown as reconnecting and recovers', async () => {
  let fail;
  let poll = 0;
  const bot = new MockNetworkBot((method, body) => {
    if (method === 'getUpdates' && body.timeout > 0 && poll++ === 0) return new Promise((r, reject) => { fail = reject; });
  });
  await bot.updateSettings(settings(true)); await tick();
  fail(new TelegramError({ error_code: 429, description: 'Slow down', parameters: { retry_after: 0 } }));
  await tick(); assert.equal(bot.state, 'reconnecting'); assert.equal(bot.isRunning(), false);
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(bot.state, 'running'); await bot.stopBot();
});
test('startup timeout cancels launch and a late response never revives old bot', async () => {
  let release;
  let first = true;
  const bot = new MockNetworkBot(method => {
    if (method === 'getMe' && first) { first = false; return new Promise(resolve => { release = resolve; }); }
  }, { startupTimeout: 25, requestTimeout: 15 });
  await assert.rejects(bot.updateSettings(settings(true)), /belum tersambung/);
  await bot.updateSettings(settings(true)); const active = bot.bot; assert(bot.isRunning());
  release({ id: 1, is_bot: true, username: 'old_bot' }); await tick();
  assert.equal(bot.bot, active); assert(bot.isRunning());
  assert.equal(bot.calls.filter(c => c.bot === bot.instances[0]).length, 1);
  await bot.stopBot();
});
test('concurrent controls serialize and OFF survives a new process; token change restarts once', async () => {
  const bot = new MockNetworkBot();
  await Promise.all([bot.updateSettings(settings(true)), bot.updateSettings(settings(false))]);
  assert.equal(bot.state, 'stopped');
  const afterReload = new MockNetworkBot(); await afterReload.updateSettings(settings(false)); assert.equal(afterReload.instances.length, 0);
  await bot.updateSettings(settings(true));
  await bot.updateSettings({ ...settings(true), telegramBotToken: '456:TEST_NEW' });
  assert.equal(bot.instances.length, 3); assert(bot.isRunning());
  await bot.restartBot(); assert.equal(bot.instances.length, 4); assert(bot.isRunning());
  await bot.updateSettings(settings(false)); await assert.rejects(bot.restartBot(), /Bot OFF/);
});
test('noncritical setup failure leaves bot online with warning', async () => {
  const bot = new MockNetworkBot(); bot.onBotReady = async () => { throw new Error('403'); };
  await bot.updateSettings(settings(true)); await tick(); assert(bot.isRunning()); assert.match(bot.warning, /Owner/); await bot.stopBot();
});
function response() {
  return { statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
}
test('admin controls save explicit desired state and current form fields; restart persists ON', async () => {
  const manager = new MockNetworkBot(); let saved = settings(false), saves = 0;
  const Setting = { async findOne() { return { ...saved, async save() { const { save, ...data } = this; saved = data; saves++; } }; } };
  const api = createBotControls({ Setting, getManager: () => manager });
  let res = response(); await api.toggle({ body: { enabled: true, token: '456:NEW_FROM_FORM', ownerId: '54321' } }, res);
  assert(res.body.success); assert(res.body.botRunning); assert.equal(saved.telegramBotToken, '456:NEW_FROM_FORM');
  res = response(); await api.toggle({ body: { enabled: true } }, res); assert.equal(manager.instances.length, 1);
  res = response(); await api.toggle({ body: { enabled: false, token: '', ownerId: '' } }, res);
  assert(res.body.success); assert.equal(saved.telegramBotEnabled, false); assert.equal(saved.telegramBotToken, '456:NEW_FROM_FORM');
  res = response(); await api.restart({ body: {} }, res); assert(res.body.botRunning); assert(saved.telegramBotEnabled);
  res = response(); await api.toggle({ body: {} }, res); assert.equal(res.statusCode, 400);
  const before = saves; res = response(); await api.toggle({ body: { enabled: true, token: '', ownerId: '' } }, res); assert(!res.body.success); assert.equal(saves, before);
  res = response(); api.status({}, res); assert.equal(res.headers['Cache-Control'], 'no-store'); assert.doesNotMatch(JSON.stringify(res.body), /NEW_FROM_FORM/);
  await manager.stopBot();
});
test('API failure/uninitialized manager never returns online success', async () => {
  const manager = new MockNetworkBot(method => { if (method === 'getMe') throw new TelegramError({ error_code: 401, description: 'Bad' }); });
  let saved = settings(true);
  const api = createBotControls({ Setting: { findOne: async () => ({ ...saved, save: async () => {} }) }, getManager: () => manager });
  const res = response(); await api.toggle({ body: { enabled: true } }, res);
  assert.equal(res.body.success, false); assert.equal(res.body.botRunning, false); assert.match(res.body.error, /Token/);
  const offline = createBotControls({ Setting: {}, getManager: () => null });
  const r = response(); await offline.toggle({ body: { enabled: true } }, r); assert.equal(r.statusCode, 503); assert.equal(r.body.success, false);
  assert.doesNotMatch(botError(new Error('https://secret-token')), /secret-token/);
});
test('real BotManager registers existing commands and uses the new lifecycle', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const start = source.indexOf('class BotManager extends TelegramBotLifecycle {');
  const end = source.indexOf('\n}', start) + 2;
  const commands = [], calls = [];
  class IsolatedTelegraf extends Telegraf {
    constructor(token) {
      super(token);
      this.telegram.callApi = async (method, payload, opts) => {
        calls.push(method);
        if (method === 'getMe') return { id: 123, is_bot: true, username: 'simulated' };
        if (method === 'getUpdates') return payload.timeout === 0 ? [] : waiting(opts.signal);
        return true;
      };
    }
    command(name, ...handlers) { commands.push(name); return super.command(name, ...handlers); }
  }
  const BotManager = new Function('Telegraf', 'TelegramBotLifecycle', 'botError', 'telegramServices', 'createDepositTransaction', 'getSettings', 'isWithinWorkHours', source.slice(start, end) + '\nreturn BotManager;')(IsolatedTelegraf, TelegramBotLifecycle, botError, require('../lib/telegram-services'), async () => { throw new Error('Unexpected deposit'); }, async () => settings(true), () => true);
  const bot = new BotManager({ Setting: { findOne: async () => settings(true) } });
  await bot.init(); await bot.manageBot(); await tick();
  assert(bot.isRunning()); assert(commands.includes('menu')); assert(commands.includes('stats'));
  assert(calls.includes('setMyCommands')); assert(calls.includes('sendMessage'));
  await bot.stopBot();
  for (const name of ['bot-status', 'toggle-bot', 'restart-bot']) assert(source.includes("'/admin/settings/" + name + "', isAuth, isAdmin,"));
});
