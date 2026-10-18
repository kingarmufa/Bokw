(function () {
  'use strict';
  const states = new Map(), lists = new Map();
  const money = n => 'Rp ' + Number(n).toLocaleString('id-ID');
  const status = (state, message, error = false) => {
    const el = state.el.querySelector('.vc-status');
    el.textContent = message; el.dataset.error = String(error);
  };
  async function jsonRequest(url, options) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    let data;
    try { data = await response.json(); } catch (_) { throw new Error('Sesi berakhir atau koneksi terganggu. Muat ulang halaman.'); }
    if (!response.ok || !data.success) throw new Error(data.error || 'Voucher belum dapat diperiksa.');
    return data.data;
  }
  function clearQuote(state) {
    state.sequence++; state.quote = null;
    state.el.querySelector('.vc-summary').hidden = true;
  }
  async function apply(state) {
    clearQuote(state);
    const code = state.input.value.trim().toUpperCase();
    state.input.value = code;
    if (!code) { status(state, 'Tanpa voucher. Total bayar ' + money(state.amount) + '.'); return; }
    const sequence = state.sequence;
    status(state, 'Memeriksa voucher…');
    try {
      const quote = await jsonRequest('/api/vouchers/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voucherCode: code, service: state.el.dataset.service, amount: state.amount }) });
      if (sequence !== state.sequence) return;
      state.quote = quote;
      state.el.querySelector('[data-original]').textContent = money(quote.originalPrice);
      state.el.querySelector('[data-discount]').textContent = '− ' + money(quote.discountAmount);
      state.el.querySelector('[data-total]').textContent = money(quote.total);
      state.el.querySelector('.vc-summary').hidden = false;
      status(state, quote.voucherCode + ' · diskon ' + quote.voucherPercent + '%. Harga dan masa berlaku dicek kembali saat pembelian.');
    } catch (err) { if (sequence === state.sequence) status(state, err.message, true); }
  }
  async function recommendations(state) {
    const service = state.el.dataset.service;
    const target = state.el.querySelector('.vc-recommend');
    try {
      if (!lists.has(service)) lists.set(service, jsonRequest('/api/vouchers/public?service=' + encodeURIComponent(service)));
      const vouchers = await lists.get(service);
      target.replaceChildren();
      if (!vouchers.length) {
        const text = document.createElement('span'); text.className = 'vc-note'; text.textContent = 'Belum ada rekomendasi publik. Kode privat tetap bisa dipakai.'; target.append(text); return;
      }
      const heading = document.createElement('span'); heading.className = 'vc-note'; heading.textContent = 'Rekomendasi:'; target.append(heading);
      vouchers.slice(0, 6).forEach(voucher => {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = voucher.code + ' −' + voucher.percent + '%';
        button.title = 'Berlaku sampai ' + new Date(voucher.expiresAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
        button.addEventListener('click', () => { state.input.value = voucher.code; apply(state); }); target.append(button);
      });
    } catch (_) { lists.delete(service); target.textContent = 'Rekomendasi belum dapat dimuat. Kamu tetap bisa memasukkan kode.'; }
  }
  function init() {
    document.querySelectorAll('[data-voucher]').forEach(el => {
      if (states.has(el.dataset.form)) return;
      const state = { el, input: el.querySelector('input[name=voucherCode]'), amount: Number(el.dataset.amount) || 0, quote: null, sequence: 0 };
      states.set(el.dataset.form, state);
      state.input.addEventListener('input', () => { clearQuote(state); status(state, 'Klik Terapkan untuk melihat potongan.'); });
      state.input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); apply(state); } });
      el.querySelector('[data-voucher-apply]').addEventListener('click', () => apply(state));
      recommendations(state);
    });
    document.querySelectorAll('[data-vc-select]').forEach(button => button.addEventListener('click', () => {
      button.closest('form').querySelectorAll('input[name=services]').forEach(input => { input.checked = button.dataset.vcSelect === 'all'; input.dispatchEvent(new Event('change', { bubbles: true })); });
    }));
    document.querySelectorAll('form:has([data-vc-preview-code])').forEach(form => {
      const refresh = () => {
        form.querySelector('[data-vc-preview-code]').textContent = form.elements.code.value.trim().toUpperCase() || 'KODE VOUCHER';
        form.querySelector('[data-vc-preview-percent]').textContent = (form.elements.percent.value || '0') + '%';
        form.querySelector('[data-vc-count]').textContent = form.querySelectorAll('[name=services]:checked').length + ' dipilih';
        form.querySelector('[data-vc-preview-mode]').textContent = !form.elements.active.checked ? 'NONAKTIF · BELUM BISA DIPAKAI' : (form.elements.published.checked ? 'PUBLIK · TAMPIL DI REKOMENDASI' : 'PRIVAT · BAGIKAN KODE SENDIRI');
      };
      form.addEventListener('input', refresh); form.addEventListener('change', refresh); refresh();
    });
    document.querySelectorAll('[data-copy-voucher]').forEach(button => button.addEventListener('click', async () => {
      const result = button.parentElement.querySelector('.vc-copy-status');
      try { await navigator.clipboard.writeText(button.dataset.copyVoucher); result.textContent = 'Kode disalin. Tempel saat membeli.'; }
      catch (_) { result.textContent = 'Salin kode ini: ' + button.dataset.copyVoucher; }
    }));
  }
  window.VoucherUI = {
    setAmount(formId, amount) {
      const state = states.get(formId);
      if (!state) { const el = [...document.querySelectorAll('[data-voucher]')].find(el => el.dataset.form === formId); if (el) el.dataset.amount = String(amount); return; }
      state.amount = Math.max(0, Math.round(Number(amount) || 0));
      clearQuote(state);
      if (!state.amount) { state.input.value = ''; status(state, 'Layanan gratis, tidak memerlukan voucher.'); }
      else if (state.input.value.trim()) apply(state);
      else status(state, 'Kode opsional. Total sebelum diskon ' + money(state.amount) + '.');
    },
    code(formId) { return states.get(formId)?.input.value.trim() || ''; },
    confirm(form) {
      const state = states.get(form.id);
      const price = state?.quote ? money(state.quote.total) : money(state?.amount || 0);
      return window.confirm('Lanjutkan pembelian? Total ' + price + (state?.input.value.trim() && !state.quote ? '. Voucher akan diperiksa saat diproses.' : '.'));
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
