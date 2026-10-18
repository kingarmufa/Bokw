'use strict';

// Return actionable messages only; Telegram/network errors can contain token URLs.
function botError(error) {
  if (error && error.botPublicMessage) return error.botPublicMessage;
  const code = Number(error && (error.response?.error_code || error.code));
  if (code === 401 || code === 404) return 'Token bot tidak valid. Periksa token dari @BotFather lalu klik ON lagi.';
  if (code === 409) return 'Token sedang dipakai proses bot lain. Hentikan instance lama di hosting lain, lalu klik ON lagi.';
  if (code === 429) return 'Telegram membatasi permintaan. Tunggu sebentar lalu coba lagi.';
  if (code === 403) return 'Telegram menolak akses. Pastikan bot tidak diblokir dan Owner sudah mengirim /start.';
  return 'Bot belum tersambung ke Telegram. Periksa koneksi hosting ke api.telegram.org lalu coba ON lagi.';
}
function publicError(message) { const e = new Error(message); e.botPublicMessage = message; return e; }
function aborted() { const e = new Error('Bot stopped'); e.name = 'AbortError'; return e; }

class TelegramBotLifecycle {
  constructor({ startupTimeout = 18000, requestTimeout = 15000 } = {}) {
    this.settings = null;
    this.bot = null;
    this.running = false;
    this.state = 'stopped';
    this.lastError = '';
    this.warning = '';
    this._queue = Promise.resolve();
    this._run = null;
    this.startupTimeout = startupTimeout;
    this.requestTimeout = requestTimeout;
  }
  _serial(task) {
    const result = this._queue.then(task);
    this._queue = result.catch(() => {});
    return result;
  }
  getStatus() {
    return { botRunning: this.running, enabled: !!this.settings?.telegramBotEnabled,
      state: this.state, error: this.lastError, warning: this.warning,
      username: this._run?.bot?.botInfo?.username || '' };
  }
  isRunning() { return this.running; }
  updateSettings(settings) {
    return this._serial(async () => { this.settings = settings; await this._manage(); });
  }
  manageBot() { return this._serial(() => this._manage()); }
  restartBot() {
    return this._serial(async () => {
      if (!this.settings?.telegramBotEnabled) throw publicError('Bot OFF. Klik ON untuk mengaktifkannya.');
      await this._stop(); await this._manage();
    });
  }
  stopBot() { return this._serial(() => this._stop()); }
  async _manage() {
    if (!this.settings?.telegramBotEnabled) { await this._stop(); return; }
    const token = String(this.settings.telegramBotToken || '').trim();
    const owner = String(this.settings.telegramOwnerId || '').trim();
    if (!token || !owner) {
      await this._stop(); this.state = 'error';
      this.lastError = 'Isi Token Bot dan Owner ID, lalu klik ON.';
      throw publicError(this.lastError);
    }
    if (this._run?.token === token && this._run.owner === owner && ['running', 'reconnecting'].includes(this.state)) return;
    await this._stop();
    await this._start(token, owner);
  }
  async _start(token, owner) {
    this.state = 'starting'; this.lastError = ''; this.warning = ''; this.running = false;
    const run = { token, owner, controller: new AbortController(), bot: null };
    this._run = run;
    let readyResolve, readyReject, startupTimer;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const current = () => this._run === run && !run.controller.signal.aborted;
    try {
      const bot = this.createBot(token, owner);
      this.bot = run.bot = bot;
      const callApi = bot.telegram.callApi.bind(bot.telegram);
      // Telegraf's launch callback only confirms getMe, not successful polling.
      // Observe the actual polling response before declaring the bot online.
      bot.telegram.callApi = async (method, payload, options = {}) => {
        if (!current()) throw aborted();
        const polling = method === 'getUpdates' && !!options.signal;
        const controller = new AbortController();
        const cancel = () => controller.abort();
        const signals = [run.controller.signal, options.signal].filter(Boolean);
        signals.forEach(signal => { signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel(); });
        const timer = setTimeout(cancel, polling && this.state === 'running' ? 65000 : this.requestTimeout);
        try {
          // A short first poll validates 401/409 immediately, retaining all updates.
          const body = polling && this.state !== 'running' ? { ...payload, timeout: 0 } : payload;
          const result = await callApi(method, body, { ...options, signal: controller.signal });
          if (!current()) throw aborted();
          if (polling) {
            this.running = true; this.state = 'running'; this.lastError = '';
            readyResolve();
          }
          return result;
        } catch (error) {
          if (!current()) throw aborted();
          if (polling) { this.running = false; this.state = 'reconnecting'; this.lastError = botError(error); }
          // Telegraf retries FetchError; an intentional OFF stays AbortError.
          if (error.name === 'AbortError' && !options.signal?.aborted) {
            const timeout = new Error('Telegram request timeout'); timeout.name = 'FetchError'; throw timeout;
          }
          throw error;
        } finally {
          clearTimeout(timer); signals.forEach(signal => signal.removeEventListener('abort', cancel));
        }
      };
      const failed = error => {
        if (!current()) return;
        this.running = false; this.state = 'error'; this.lastError = botError(error);
        readyReject(publicError(this.lastError));
      };
      run.launch = Promise.resolve().then(() => bot.launch({ dropPendingUpdates: false }))
        .then(() => failed(publicError('Koneksi bot berhenti. Klik ON untuk menyambungkan kembali.')), failed);
      startupTimer = setTimeout(() => readyReject(publicError(botError())), this.startupTimeout);
      await ready;
      if (current() && this.running && this.onBotReady) {
        Promise.resolve().then(() => this.onBotReady(bot, owner)).catch(() => {
          if (current()) this.warning = 'Bot online, tetapi menu/notifikasi Owner belum terkirim. Kirim /start ke bot dan periksa Owner ID.';
        });
      }
    } catch (error) {
      const message = botError(error);
      await this._stop(); this.state = 'error'; this.lastError = message;
      throw publicError(message);
    } finally { clearTimeout(startupTimer); }
  }
  async _stop() {
    const run = this._run;
    this._run = null; this.bot = null; this.running = false;
    this.state = 'stopped'; this.lastError = ''; this.warning = '';
    if (!run) return;
    run.controller.abort();
    // Telegraf throws if stopped before polling was created (e.g. invalid token).
    try { run.bot?.stop('Admin OFF/restart'); } catch (_) {}
    // Cancellation plus the identity guard prevents stale launches changing state
    // or making fresh Telegram requests after a new instance starts.
  }
}

module.exports = { TelegramBotLifecycle, botError, publicError };
