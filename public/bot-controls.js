(() => {
  'use strict';
  const panel = document.getElementById('telegramBotControls');
  if (!panel) return;
  const status = document.getElementById('botStatusText');
  const message = document.getElementById('botControlMessage');
  const enabledInput = document.getElementById('telegramBotEnabledInput');
  const buttons = [...panel.querySelectorAll('button[data-bot-action]')];
  const labels = { running: 'ONLINE · Bot terhubung', stopped: 'OFF · Bot dinonaktifkan', starting: 'Menghubungkan ke Telegram…', reconnecting: 'Koneksi terputus · Mencoba kembali…', error: 'BELUM ONLINE · Perlu diperiksa', unavailable: 'Bot belum siap' };
  let busy = false, refreshing = false, generation = 0, lastState;
  function notice(text, error = false) { message.textContent = text || ''; message.dataset.error = String(error); }
  function render(data) {
    if (!data.state) return;
    lastState = data; panel.dataset.state = data.state;
    status.textContent = labels[data.state] || 'Memeriksa status…';
    if (data.botRunning && data.username) status.textContent += ' · @' + data.username;
    if (typeof data.enabled === 'boolean') enabledInput.value = data.enabled ? 'on' : '';
    buttons.forEach(button => button.setAttribute('aria-pressed', String(
      button.dataset.botAction === 'on' ? data.botRunning : button.dataset.botAction === 'off' && !data.enabled
    )));
    if (data.error) notice(data.error, true);
    else if (data.warning) notice(data.warning, true);
    else notice(data.message || (data.botRunning ? 'Bot siap menerima pesan. Coba kirim /start di Telegram.' : 'Klik ON untuk menyimpan Token dan Owner ID lalu menyambungkan bot.'));
  }
  async function jsonFetch(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
      if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Sesi admin berakhir. Muat ulang dan login lagi.');
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  async function refresh() {
    if (busy || refreshing || document.hidden) return;
    refreshing = true;
    const ticket = generation;
    try {
      const data = await jsonFetch('/admin/settings/bot-status');
      if (ticket === generation && !busy) render(data);
    } catch (_) {
      if (ticket === generation && !busy) {
        status.textContent = 'Status belum dapat diperiksa';
        notice('Tidak dapat memeriksa status bot. Periksa koneksi atau muat ulang sesi admin.', true);
      }
    } finally { refreshing = false; }
  }
  async function control(action) {
    if (busy) return;
    busy = true; generation++;
    panel.setAttribute('aria-busy', 'true'); buttons.forEach(button => { button.disabled = true; });
    status.textContent = action === 'off' ? 'Mematikan bot…' : 'Menghubungkan ke Telegram…';
    notice('Tunggu sebentar, perubahan sedang diproses.');
    const enabled = action !== 'off';
    try {
      const body = { enabled };
      if (enabled) {
        body.token = document.querySelector('[name=telegramBotToken]').value.trim();
        body.ownerId = document.querySelector('[name=telegramOwnerId]').value.trim();
      }
      const data = await jsonFetch('/admin/settings/' + (action === 'restart' ? 'restart-bot' : 'toggle-bot'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      render(data);
      if (!data.success) notice(data.error || 'Perubahan belum berhasil. Coba lagi.', true);
    } catch (error) {
      if (lastState) render(lastState);
      status.textContent = 'Status belum terkonfirmasi';
      notice(error.name === 'AbortError' ? 'Respons server terlalu lama. Status akan diperiksa kembali otomatis.' : 'Permintaan gagal. Periksa koneksi dan sesi admin lalu coba lagi.', true);
    } finally {
      busy = false; panel.setAttribute('aria-busy', 'false'); buttons.forEach(button => { button.disabled = false; });
    }
  }
  buttons.forEach(button => button.addEventListener('click', () => control(button.dataset.botAction)));
  panel.closest('form')?.addEventListener('submit', event => {
    if (busy) { event.preventDefault(); notice('Tunggu proses tombol bot selesai sebelum menyimpan pengaturan.', true); }
  });
  const timer = setInterval(refresh, 5000);
  addEventListener('pagehide', () => clearInterval(timer), { once: true });
  document.addEventListener('visibilitychange', refresh);
  refresh();
})();
