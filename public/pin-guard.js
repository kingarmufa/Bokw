/* PIN keamanan 4 angka — tampilan komik (hijau / kuning / hitam).
   PinGuard.ask(purpose)  -> Promise<boolean>   minta PIN dan minta izin ke server (dipakai sebelum tarik/transfer)
   PinGuard.guardForm(form, purpose)            tahan submit form sampai PIN benar
   PinGuard.profile.{activate,change,reset,disable}()  alur di halaman Profil */
(function (global) {
  'use strict';
  var doc = document;
  var CSS = [
    '.pg-ov{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.68);display:flex;align-items:center;justify-content:center;padding:16px}',
    'html body .pg-ov,html body .pg-ov *{--cm-fg:#171717!important;color:#171717!important;-webkit-text-fill-color:#171717!important;box-sizing:border-box}',
    '.pg-card{position:relative;width:100%;max-width:340px;background:#facc15;border:4px solid #171717;border-radius:20px;box-shadow:7px 7px 0 #22c55e,11px 11px 0 #171717;padding:18px 16px 16px;text-align:center;overflow:hidden}',
    '.pg-ic{width:54px;height:54px;margin:0 auto 6px;border:4px solid #171717;border-radius:50%;background:#22c55e;display:flex;align-items:center;justify-content:center;font-size:25px;box-shadow:3px 3px 0 #171717}',
    'html body .pg-card h3{font-family:Bangers,Impact,sans-serif;font-weight:400;font-size:28px;letter-spacing:1px;margin:2px 0 2px;line-height:1.05}',
    'html body .pg-card p{font-weight:800;font-size:12.5px;margin:0 0 12px;line-height:1.35}',
    '.pg-boxes{display:flex;justify-content:center;gap:10px;margin:2px 0 8px}',
    '.pg-box{width:52px;height:60px;border:4px solid #171717;border-radius:12px;background:#fff;display:flex;align-items:center;justify-content:center;font-size:30px;line-height:1;box-shadow:3px 3px 0 #171717}',
    '.pg-box.on{background:#22c55e}',
    '.pg-err{min-height:18px;font-weight:900;font-size:12.5px;margin:0 0 8px;color:#b91c1c!important;-webkit-text-fill-color:#b91c1c!important}',
    'html body .pg-ov .pg-err{color:#b91c1c!important;-webkit-text-fill-color:#b91c1c!important}',
    '.pg-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}',
    'html body .pg-ov button.pg-key{height:52px;border:3px solid #171717!important;border-radius:12px!important;background:#fff!important;font-family:Bangers,Impact,sans-serif;font-size:25px;letter-spacing:1px;box-shadow:3px 3px 0 #171717!important;cursor:pointer;padding:0;min-height:0;transition:transform .08s,box-shadow .08s}',
    'html body .pg-ov button.pg-key:active{transform:translate(2px,2px);box-shadow:1px 1px 0 #171717!important;background:#22c55e!important}',
    'html body .pg-ov button.pg-key.alt{background:#171717!important}',
    'html body .pg-ov button.pg-key.alt,html body .pg-ov button.pg-key.alt *{color:#facc15!important;-webkit-text-fill-color:#facc15!important}',
    'html body .pg-ov button.pg-cancel{margin-top:12px;width:100%;border:3px solid #171717!important;border-radius:12px!important;background:#fff!important;font-family:Bangers,Impact,sans-serif;font-size:19px;letter-spacing:1px;padding:8px;box-shadow:3px 3px 0 #171717!important;cursor:pointer;min-height:0}',
    'html body .pg-ov input.pg-pass{width:100%;border:3px solid #171717!important;border-radius:12px!important;background:#fff!important;padding:12px 14px;font-weight:800;font-size:16px;margin-bottom:8px;outline:none}',
    'html body .pg-ov button.pg-ok{width:100%;border:3px solid #171717!important;border-radius:12px!important;background:#22c55e!important;font-family:Bangers,Impact,sans-serif;font-size:21px;letter-spacing:1px;padding:10px;box-shadow:3px 3px 0 #171717!important;cursor:pointer;min-height:0}',
    'html body .pg-ov .pg-card{background-color:#facc15!important}',
    'html body .pg-ov .pg-box{background:#fff!important}',
    'html body .pg-ov .pg-box.on{background:#22c55e!important}',
    'html body .pg-ov .pg-ic{background:#22c55e!important}',
    'html body .pg-toast{background:#22c55e!important}',
    '.pg-shake{animation:pgshake .35s}',
    '@keyframes pgshake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(9px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}',
    '.pg-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:100001;background:#22c55e;border:3px solid #171717;border-radius:12px;box-shadow:4px 4px 0 #171717;padding:10px 16px;font-weight:900;font-size:13px;max-width:90%;text-align:center}',
    'html body .pg-toast{color:#171717!important;-webkit-text-fill-color:#171717!important}'
  ].join('\n');
  function ensureCss() { if (doc.getElementById('pgCss')) return; var s = doc.createElement('style'); s.id = 'pgCss'; s.textContent = CSS; doc.head.appendChild(s); }
  function el(tag, cls, html) { var e = doc.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function toast(msg) { ensureCss(); var t = el('div', 'pg-toast'); t.textContent = msg; doc.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600); }
  function post(url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { success: false, error: 'Respon server tidak valid.' }; }); })
      .catch(function () { return { success: false, error: 'Koneksi bermasalah.' }; });
  }

  // Dialog PIN 4 kotak + keypad. verify(pin) opsional: async -> {ok:boolean,error?:string,close?:boolean}. Resolve: PIN (string) atau null.
  function enter(opts) {
    ensureCss();
    return new Promise(function (resolve) {
      var pin = '', busy = false;
      var ov = el('div', 'pg-ov'), card = el('div', 'pg-card');
      card.appendChild(el('div', 'pg-ic', '\uD83D\uDD12'));
      card.appendChild(el('h3', '', opts.title || 'MASUKKAN PIN'));
      var sub = el('p', '', ''); sub.textContent = opts.subtitle || 'PIN keamanan 4 angka'; card.appendChild(sub);
      var boxes = el('div', 'pg-boxes'), bx = [];
      for (var i = 0; i < 4; i++) { var b = el('div', 'pg-box', ''); bx.push(b); boxes.appendChild(b); }
      card.appendChild(boxes);
      var err = el('div', 'pg-err', ''); card.appendChild(err);
      var pad = el('div', 'pg-pad');
      function draw() { bx.forEach(function (b, i) { b.textContent = i < pin.length ? '\u25CF' : ''; b.classList.toggle('on', i < pin.length); }); }
      function finish(v) { doc.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); }
      function bad(msg) { err.textContent = msg || ''; pin = ''; draw(); boxes.classList.remove('pg-shake'); void boxes.offsetWidth; boxes.classList.add('pg-shake'); }
      async function press(d) {
        if (busy) return;
        if (d === 'del') { pin = pin.slice(0, -1); err.textContent = ''; draw(); return; }
        if (pin.length >= 4) return;
        pin += d; err.textContent = ''; draw();
        if (pin.length === 4) {
          if (!opts.verify) { setTimeout(function () { finish(pin); }, 120); return; }
          busy = true; err.textContent = 'Memeriksa...';
          var r = await opts.verify(pin); busy = false;
          if (r && r.ok) { err.textContent = ''; setTimeout(function () { finish(pin); }, 80); }
          else if (r && r.close) { finish(null); if (r.error) toast(r.error); }
          else bad((r && r.error) || 'PIN salah.');
        }
      }
      ['1', '2', '3', '4', '5', '6', '7', '8', '9'].forEach(function (d) { var k = el('button', 'pg-key', d); k.type = 'button'; k.onclick = function () { press(d); }; pad.appendChild(k); });
      var sp = el('div'); pad.appendChild(sp);
      var z = el('button', 'pg-key', '0'); z.type = 'button'; z.onclick = function () { press('0'); }; pad.appendChild(z);
      var dl = el('button', 'pg-key alt', '\u232B'); dl.type = 'button'; dl.setAttribute('aria-label', 'Hapus'); dl.onclick = function () { press('del'); }; pad.appendChild(dl);
      card.appendChild(pad);
      var cancel = el('button', 'pg-cancel', 'BATAL'); cancel.type = 'button'; cancel.onclick = function () { finish(null); }; card.appendChild(cancel);
      ov.appendChild(card); doc.body.appendChild(ov);
      function onKey(e) {
        if (e.key >= '0' && e.key <= '9') { e.preventDefault(); press(e.key); }
        else if (e.key === 'Backspace') { e.preventDefault(); press('del'); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      }
      doc.addEventListener('keydown', onKey, true);
    });
  }

  function askPassword(opts) {
    ensureCss();
    return new Promise(function (resolve) {
      var ov = el('div', 'pg-ov'), card = el('div', 'pg-card');
      card.appendChild(el('div', 'pg-ic', '\uD83D\uDD11'));
      card.appendChild(el('h3', '', opts.title || 'PASSWORD AKUN'));
      var sub = el('p', '', ''); sub.textContent = opts.subtitle || 'Masukkan password akun untuk melanjutkan.'; card.appendChild(sub);
      var inp = el('input', 'pg-pass'); inp.type = 'password'; inp.autocomplete = 'current-password'; inp.placeholder = 'Password akun'; card.appendChild(inp);
      var ok = el('button', 'pg-ok', 'LANJUT'); ok.type = 'button'; card.appendChild(ok);
      var cancel = el('button', 'pg-cancel', 'BATAL'); cancel.type = 'button'; card.appendChild(cancel);
      function done(v) { ov.remove(); resolve(v); }
      ok.onclick = function () { if (inp.value) done(inp.value); else inp.focus(); };
      cancel.onclick = function () { done(null); };
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') ok.onclick(); });
      ov.appendChild(card); doc.body.appendChild(ov); setTimeout(function () { inp.focus(); }, 50);
    });
  }

  // Minta PIN & izin server untuk tujuan tertentu ('withdraw' | 'transfer').
  async function ask(purpose) {
    var pin = await enter({
      title: 'MASUKKAN PIN', subtitle: purpose === 'transfer' ? 'PIN diperlukan untuk transfer saldo.' : 'PIN diperlukan untuk penarikan saldo.',
      verify: async function (p) {
        var r = await post('/api/pin/verify', { pin: p, purpose: purpose });
        return r.success ? { ok: true } : { ok: false, error: r.error, close: !!r.locked };
      }
    });
    return pin !== null;
  }

  // Tahan submit form sampai PIN benar (hanya kalau PIN aktif).
  function guardForm(form, purpose) {
    if (!form) return;
    form.addEventListener('submit', function (e) {
      if (!global.PIN_ENABLED || e.defaultPrevented || form.dataset.pinOk === '1') return;
      e.preventDefault();
      ask(purpose).then(function (ok) {
        if (!ok) return;
        form.dataset.pinOk = '1';
        if (form.requestSubmit) form.requestSubmit(); else form.submit();
      });
    });
  }

  // ---- Alur halaman Profil ----
  async function newPinTwice(titleNew) {
    var a = await enter({ title: titleNew || 'PIN BARU', subtitle: 'Pilih 4 angka yang mudah kamu ingat (bukan 1111 / 1234).' });
    if (a === null) return null;
    var b = await enter({ title: 'ULANGI PIN', subtitle: 'Masukkan PIN baru sekali lagi.' });
    if (b === null) return null;
    return { pin: a, confirm: b };
  }
  async function submitSet(payload, okMsg) {
    var r = await post('/api/pin/set', payload);
    if (!r.success) { toast(r.error || 'Gagal menyimpan PIN.'); return false; }
    toast(okMsg); setTimeout(function () { location.reload(); }, 900); return true;
  }
  var profile = {
    activate: async function () {
      var pw = await askPassword({ title: 'AKTIFKAN PIN', subtitle: 'Masukkan password akun untuk memastikan ini kamu.' }); if (pw === null) return;
      var p = await newPinTwice(); if (!p) return;
      submitSet({ password: pw, pin: p.pin, confirm: p.confirm }, 'PIN keamanan aktif!');
    },
    change: async function () {
      var old = await enter({ title: 'PIN LAMA', subtitle: 'Masukkan PIN yang sekarang.' }); if (old === null) return;
      var p = await newPinTwice(); if (!p) return;
      submitSet({ oldPin: old, pin: p.pin, confirm: p.confirm }, 'PIN berhasil diubah!');
    },
    reset: async function () {
      var pw = await askPassword({ title: 'LUPA PIN?', subtitle: 'Masukkan password akun untuk membuat PIN baru.' }); if (pw === null) return;
      var p = await newPinTwice(); if (!p) return;
      submitSet({ password: pw, pin: p.pin, confirm: p.confirm }, 'PIN baru tersimpan!');
    },
    disable: async function () {
      var out = null;
      var pin = await enter({
        title: 'NONAKTIFKAN PIN', subtitle: 'Masukkan PIN untuk mematikan keamanan PIN.',
        verify: async function (p) { var r = await post('/api/pin/disable', { pin: p }); if (r.success) { out = true; return { ok: true }; } return { ok: false, error: r.error, close: !!r.locked }; }
      });
      if (pin !== null && out) { toast('PIN keamanan dinonaktifkan.'); setTimeout(function () { location.reload(); }, 900); }
    }
  };

  global.PinGuard = { enter: enter, ask: ask, guardForm: guardForm, askPassword: askPassword, profile: profile, toast: toast };
})(window);
