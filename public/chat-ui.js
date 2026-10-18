/* Chat UI engine — Room Publik, Chat Private (thread) & Inbox.
   Realtime lewat SSE (/chat/stream), polling hanya cadangan. Kirim pesan optimistic (langsung tampil). */
(function () {
  'use strict';
  const CFG = window.CHAT_CFG;
  if (!CFG) return;

  const ME = String(CFG.me.id);
  const MODE = CFG.mode; // 'room' | 'private' | 'inbox'
  const PEER = CFG.peer ? String(CFG.peer.id) : '';
  const KEY = PEER ? [ME, PEER].sort().join('_') : '';
  const $ = (id) => document.getElementById(id);
  const coarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  const tf = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function linkify(escaped) {
    return escaped.replace(/(https?:\/\/[^\s<]+[^\s<.,!?;:)\]])/g, (u) => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>');
  }
  function initialAvatar(name) {
    const ch = esc(String(name || '?').trim().charAt(0).toUpperCase() || '?');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#edc531"/><text x="32" y="43" font-size="32" font-family="Arial,sans-serif" font-weight="800" text-anchor="middle" fill="#171717">' + ch + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function avatarOf(u) { return u && u.avatarUrl && String(u.avatarUrl).trim() ? u.avatarUrl : initialAvatar(u && u.username); }
  function dayKey(d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function dayLabel(d) {
    const now = new Date();
    if (dayKey(d) === dayKey(now)) return 'Hari ini';
    const y = new Date(now.getTime() - 86400000);
    if (dayKey(d) === dayKey(y)) return 'Kemarin';
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function previewOf(t, fileType) {
    if (t) return t;
    if (fileType === 'image') return '📷 Foto';
    if (fileType === 'video') return '🎥 Video';
    if (fileType) return '📎 File';
    return '';
  }

  /* ---------- toast ---------- */
  let toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'cu-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    requestAnimationFrame(() => toastEl.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  /* ---------- badge tab Private ---------- */
  const badgeEl = $('cuTabBadge');
  let unread = CFG.unread || 0;
  function setBadge(n) {
    unread = Math.max(0, n);
    if (!badgeEl) return;
    const was = badgeEl.classList.contains('show');
    badgeEl.textContent = unread > 99 ? '99+' : String(unread);
    badgeEl.classList.remove('show');
    if (unread > 0) { void badgeEl.offsetWidth; badgeEl.classList.add('show'); }
    else if (was) badgeEl.classList.remove('show');
  }
  setBadge(unread);

  /* ---------- realtime (SSE) ---------- */
  const handlers = {};
  let sseOpen = false, firstReady = true;
  function connect() {
    if (window.AVERPAY_SERVERLESS || !window.EventSource) return;
    const es = new EventSource('/chat/stream');
    es.addEventListener('ready', () => {
      sseOpen = true;
      if (!firstReady && handlers.resync) handlers.resync();
      firstReady = false;
    });
    ['room', 'room-del', 'room-clear', 'pm', 'pm-read'].forEach((ev) => {
      es.addEventListener(ev, (e) => {
        let d; try { d = JSON.parse(e.data); } catch (x) { return; }
        if (ev === 'pm' && String(d.toId) === ME && !(MODE === 'private' && String(d.userId) === PEER)) setBadge(unread + 1);
        if (handlers[ev]) handlers[ev](d);
      });
    });
    es.onerror = () => { sseOpen = false; };
  }

  /* ============================================================
     THREAD (room publik & chat private)
     ============================================================ */
  function initThread() {
    const list = $('cuList'), form = $('cuForm'), ta = $('cuText'), fileIn = $('cuFile');
    const previewEl = $('cuPreview'), replyEl = $('cuReply'), jumpEl = $('cuJump');
    const EP = MODE === 'room'
      ? { list: '/chat/room/messages', send: '/chat/room/send' }
      : { list: '/chat/private/' + PEER + '/messages', send: '/chat/private/' + PEER + '/send', read: '/chat/private/' + PEER + '/read' };

    const store = Object.create(null); // id -> data pesan
    const seen = Object.create(null);
    let lastTs = null, oldestTs = null, hasMore = !!CFG.hasMore, loadingOlder = false;
    let stuck = true, newCount = 0, replyTo = null, pendingFile = null, tmpSeq = 0;

    /* ----- build ----- */
    function quoteHtml(rt) {
      if (!rt || !rt.msgId) return '';
      const who = String(rt.userId) === ME ? 'Kamu' : (rt.username || (CFG.peer && CFG.peer.username) || '');
      return '<div class="cu-quote" data-goto="' + esc(rt.msgId) + '"><b>' + esc(who) + '</b><span>' + esc(previewOf(rt.text, rt.fileType)) + '</span></div>';
    }
    function attachHtml(m) {
      if (!m.fileUrl) return '';
      if (m.fileType === 'image') return '<div class="cu-attach"><img src="' + esc(m.fileUrl) + '" alt="" loading="lazy" decoding="async" data-zoom></div>';
      if (m.fileType === 'video') return '<div class="cu-attach"><video src="' + esc(m.fileUrl) + '" controls preload="metadata" playsinline></video></div>';
      return '<a class="cu-file" href="' + esc(m.fileUrl) + '" target="_blank" rel="noopener"><i class="fa-solid fa-file-arrow-down"></i> ' + esc(m.fileName || 'File') + '</a>';
    }
    function tickHtml(m, mine) {
      if (MODE !== 'private' || !mine) return '';
      if (m._pending) return '<i class="fa-regular fa-clock cu-tick"></i>';
      return m.readAt ? '<i class="fa-solid fa-check-double cu-tick read"></i>' : '<i class="fa-solid fa-check cu-tick"></i>';
    }
    function build(m) {
      const mine = String(m.userId) === ME, priv = MODE === 'private';
      const el = document.createElement('div');
      el.className = 'cu-msg' + (mine ? ' me' : '') + (priv ? ' priv' : '') + (m._pending ? ' pending' : '');
      el.dataset.id = m._id;
      el.dataset.uid = String(m.userId);
      const d = new Date(m.createdAt);
      el.dataset.ts = String(d.getTime());
      el.dataset.day = dayKey(d);
      let h = '';
      if (!priv) h += '<img class="cu-av" src="' + esc(avatarOf(m)) + '" alt="" loading="lazy" decoding="async">';
      h += '<div class="cu-col">';
      if (!priv) h += '<div class="cu-meta"><span class="cu-name">' + esc(m.username) + '</span><span class="cu-role ' + esc(m.role || 'user') + '">' + esc(m.role || 'user') + '</span></div>';
      h += '<div class="cu-row"><div class="cu-bubble">' + quoteHtml(m.replyTo);
      if (m.text) h += '<span class="cu-text">' + linkify(esc(m.text)) + '</span>';
      h += attachHtml(m);
      h += '<div class="cu-foot"><time>' + tf.format(d) + '</time>' + tickHtml(m, mine) + '</div></div>';
      if (!m._pending) {
        h += '<div class="cu-acts"><button type="button" class="cu-act" data-reply title="Balas"><i class="fa-solid fa-reply"></i></button>';
        if (CFG.admin && MODE === 'room') h += '<button type="button" class="cu-act del" data-del title="Hapus"><i class="fa-solid fa-trash"></i></button>';
        h += '</div>';
      }
      h += '</div></div>';
      el.innerHTML = h;
      return el;
    }

    /* ----- penempatan + pengelompokan ----- */
    function lastMsgEl() {
      let n = list.lastElementChild;
      while (n && !(n.classList.contains('cu-msg') && !n.classList.contains('cu-out'))) n = n.previousElementSibling;
      return n;
    }
    function isCont(el, prev) {
      return !!prev && prev.dataset.uid === el.dataset.uid && prev.dataset.day === el.dataset.day &&
        Math.abs(Number(el.dataset.ts) - Number(prev.dataset.ts)) < 300000;
    }
    function dayEl(label) { const s = document.createElement('div'); s.className = 'cu-day'; s.innerHTML = '<span>' + esc(label) + '</span>'; return s; }
    function removeEmpty() { const e = $('cuEmpty'); if (e) e.remove(); }
    function showEmptyIfNone() {
      if (list.querySelector('.cu-msg')) return;
      list.innerHTML = '<div class="cu-empty" id="cuEmpty"><i class="fa-solid fa-comment-slash"></i>' +
        (MODE === 'room' ? 'Belum ada pesan di Room Chat.<br>Jadilah yang pertama menyapa!' : 'Belum ada pesan.<br>Mulai obrolan dengan ' + esc(CFG.peer.username) + '!') + '</div>';
    }
    function remember(m) {
      store[m._id] = m; seen[m._id] = true;
      if (!m._pending) {
        if (!lastTs || new Date(m.createdAt) > new Date(lastTs)) lastTs = m.createdAt;
        if (!oldestTs || new Date(m.createdAt) < new Date(oldestTs)) oldestTs = m.createdAt;
      }
    }
    function appendEl(el, container) {
      const prev = container === list ? lastMsgEl() : container.lastElementChild;
      if (!prev || prev.dataset.day !== el.dataset.day) {
        container.appendChild(dayEl(dayLabel(new Date(Number(el.dataset.ts)))));
      } else if (isCont(el, prev)) el.classList.add('cont');
      container.appendChild(el);
    }

    /* ----- scroll ----- */
    const nearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 90;
    function scrollBottom(smooth) {
      requestAnimationFrame(() => {
        if (list.scrollTo) list.scrollTo({ top: list.scrollHeight, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' });
        else list.scrollTop = list.scrollHeight;
      });
    }
    function updateJump() {
      if (nearBottom()) { newCount = 0; jumpEl.classList.remove('show'); }
      else if (list.scrollHeight - list.scrollTop - list.clientHeight > 260 || newCount) {
        jumpEl.querySelector('span').textContent = newCount ? newCount + ' pesan baru' : 'Terbaru';
        jumpEl.classList.add('show');
      }
    }
    list.addEventListener('scroll', () => {
      stuck = nearBottom();
      updateJump();
      if (list.scrollTop < 80 && hasMore && !loadingOlder) loadOlder();
    }, { passive: true });
    list.addEventListener('load', () => { if (stuck) scrollBottom(false); }, true); // gambar selesai dimuat
    jumpEl.addEventListener('click', () => { newCount = 0; scrollBottom(true); });

    /* ----- masuk pesan ----- */
    function incoming(m, animate) {
      if (seen[m._id]) return;
      removeEmpty();
      const mine = String(m.userId) === ME;
      const wasStuck = stuck || nearBottom();
      const el = build(m);
      if (animate !== false) el.classList.add('cu-new');
      appendEl(el, list);
      remember(m);
      if (mine || wasStuck) { stuck = true; scrollBottom(true); }
      else { newCount++; updateJump(); }
    }

    function initialRender() {
      const frag = document.createDocumentFragment();
      (CFG.messages || []).forEach((m) => { const el = build(m); appendEl(el, frag); remember(m); });
      list.innerHTML = '';
      list.appendChild(frag);
      showEmptyIfNone();
      list.scrollTop = list.scrollHeight;
      stuck = true;
    }

    function loadOlder() {
      if (!oldestTs) return;
      loadingOlder = true;
      fetch(EP.list + '?before=' + encodeURIComponent(oldestTs) + '&limit=50', { credentials: 'same-origin' })
        .then((r) => r.json()).then((d) => {
          hasMore = !!d.hasMore;
          const msgs = (d.messages || []).filter((m) => !seen[m._id]);
          if (!msgs.length) return;
          const frag = document.createDocumentFragment();
          msgs.forEach((m) => { const el = build(m); appendEl(el, frag); remember(m); });
          const first = list.querySelector('.cu-msg');
          const lastOfBatch = frag.lastElementChild;
          const firstDay = list.querySelector('.cu-day');
          if (firstDay && lastOfBatch && lastOfBatch.dataset && lastOfBatch.dataset.day && first && first.dataset.day === lastOfBatch.dataset.day && firstDay === list.firstElementChild) firstDay.remove();
          const prevH = list.scrollHeight;
          list.insertBefore(frag, list.firstChild);
          list.scrollTop += list.scrollHeight - prevH;
        }).catch(() => {}).then(() => { loadingOlder = false; });
    }

    /* ----- hapus ----- */
    function removeMsg(id) {
      const el = list.querySelector('.cu-msg[data-id="' + id + '"]');
      delete store[id]; delete seen[id];
      if (!el) return;
      el.style.maxHeight = el.offsetHeight + 'px';
      void el.offsetWidth;
      el.classList.add('cu-out');
      setTimeout(() => { el.remove(); cleanupDays(); showEmptyIfNone(); }, reduceMotion ? 0 : 380);
    }
    function cleanupDays() { // buang pemisah tanggal yang sudah tidak punya pesan
      list.querySelectorAll('.cu-day').forEach((d) => {
        const n = d.nextElementSibling;
        if (!n || !n.classList.contains('cu-msg')) d.remove();
      });
    }

    /* ----- modal konfirmasi ----- */
    let modal, modalCb;
    function confirmBox(o, cb) {
      if (!modal) {
        modal = document.createElement('div');
        modal.className = 'cu-modal';
        modal.innerHTML = '<div class="cu-modal-card"><i class="fa-solid big"></i><h3></h3><p></p><div class="cu-modal-actions"><button type="button" class="cu-m-cancel">Batal</button><button type="button" class="cu-m-ok"></button></div></div>';
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });
        modal.querySelector('.cu-m-cancel').addEventListener('click', () => modal.classList.remove('show'));
        modal.querySelector('.cu-m-ok').addEventListener('click', () => { modal.classList.remove('show'); if (modalCb) modalCb(); });
      }
      modal.querySelector('i.big').className = 'fa-solid big ' + o.icon;
      modal.querySelector('h3').textContent = o.title;
      modal.querySelector('p').textContent = o.text;
      modal.querySelector('.cu-m-ok').textContent = o.ok;
      modalCb = cb;
      requestAnimationFrame(() => modal.classList.add('show'));
    }
    function delMsg(id) {
      confirmBox({ icon: 'fa-trash', title: 'Hapus pesan?', text: 'Pesan dan lampirannya dihapus permanen dari Room Chat.', ok: 'Hapus' }, () => {
        fetch('/admin/chat/delete/' + id, { method: 'POST', headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' })
          .then((r) => r.json()).then((d) => { if (d.success) removeMsg(id); else toast(d.message || 'Gagal menghapus pesan'); })
          .catch(() => toast('Gagal menghapus pesan. Periksa koneksi.'));
      });
    }
    window.ChatUI = {
      clearAll() {
        confirmBox({ icon: 'fa-broom', title: 'Bersihkan semua?', text: 'Semua pesan & lampiran di Room Chat dihapus permanen untuk semua user.', ok: 'Bersihkan' }, () => {
          fetch('/admin/chat/clear', { method: 'POST', headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' })
            .then((r) => r.json()).then((d) => { if (!d.success) toast(d.message || 'Gagal membersihkan Room Chat'); })
            .catch(() => toast('Gagal membersihkan Room Chat. Periksa koneksi.'));
        });
      }
    };

    /* ----- reply ----- */
    function whoOf(m) { return String(m.userId) === ME ? 'Kamu' : (m.username || (CFG.peer && CFG.peer.username) || ''); }
    function setReply(m) {
      replyTo = m;
      replyEl.querySelector('.cu-reply-txt b').textContent = 'Membalas ' + whoOf(m);
      replyEl.querySelector('.cu-reply-txt span').textContent = previewOf(m.text, m.fileType);
      replyEl.classList.add('show');
      ta.focus();
    }
    function clearReply() { replyTo = null; replyEl.classList.remove('show'); }
    $('cuReplyX').addEventListener('click', clearReply);

    function gotoMsg(id) {
      const el = list.querySelector('.cu-msg[data-id="' + id + '"]');
      if (!el) { toast('Pesan asli sudah tidak ada'); return; }
      el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1200);
    }

    /* ----- klik delegasi ----- */
    list.addEventListener('click', (e) => {
      const t = e.target;
      const msgEl = t.closest && t.closest('.cu-msg');
      if (t.closest('[data-reply]') && msgEl) { const m = store[msgEl.dataset.id]; if (m) setReply(m); return; }
      if (t.closest('[data-del]') && msgEl) { delMsg(msgEl.dataset.id); return; }
      if (MODE === 'room' && msgEl && t.closest('.cu-av, .cu-name') && window.Story && Story.userMenu) { Story.userMenu(msgEl.dataset.uid); return; }
      const q = t.closest('.cu-quote'); if (q) { gotoMsg(q.dataset.goto); return; }
      if (t.matches && t.matches('img[data-zoom]')) { openLightbox(t.src); return; }
      if (t.closest('.cu-fail') && msgEl) retry(msgEl);
    });
    list.addEventListener('dblclick', (e) => { // dobel-tap = balas
      const msgEl = e.target.closest && e.target.closest('.cu-msg');
      if (!msgEl || e.target.closest('a,button,video,img')) return;
      const m = store[msgEl.dataset.id]; if (m && !m._pending) setReply(m);
    });

    /* swipe kanan untuk reply */
    let sx = 0, sy = 0, sRow = null, sMsg = null, swiping = false, hit = false;
    list.addEventListener('touchstart', (e) => {
      const msgEl = e.target.closest && e.target.closest('.cu-msg');
      if (!msgEl || msgEl.classList.contains('pending') || e.touches.length !== 1) { sMsg = null; return; }
      sMsg = msgEl; sRow = msgEl.querySelector('.cu-row'); sx = e.touches[0].clientX; sy = e.touches[0].clientY; swiping = false; hit = false;
      if (sRow) sRow.style.transition = 'none';
    }, { passive: true });
    list.addEventListener('touchmove', (e) => {
      if (!sMsg || !sRow) return;
      const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
      if (!swiping && Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) { sMsg = null; sRow.style.transform = ''; sRow.style.transition = ''; return; }
      if (dx > 10) {
        swiping = true;
        const x = Math.min(dx, 72) * 0.85;
        sRow.style.transform = 'translate3d(' + x + 'px,0,0)';
        if (dx > 56 && !hit) { hit = true; if (navigator.vibrate) navigator.vibrate(12); }
      }
    }, { passive: true });
    const endSwipe = () => {
      if (!sMsg || !sRow) return;
      sRow.style.transition = ''; sRow.style.transform = '';
      if (hit) { const m = store[sMsg.dataset.id]; if (m) setReply(m); }
      sMsg = null; sRow = null; swiping = false; hit = false;
    };
    list.addEventListener('touchend', endSwipe, { passive: true });
    list.addEventListener('touchcancel', endSwipe, { passive: true });

    /* ----- lightbox ----- */
    let lb;
    function openLightbox(src) {
      if (!lb) {
        lb = document.createElement('div'); lb.className = 'cu-lb'; lb.innerHTML = '<img alt="">';
        lb.addEventListener('click', () => lb.classList.remove('show'));
        document.body.appendChild(lb);
      }
      lb.querySelector('img').src = src;
      requestAnimationFrame(() => lb.classList.add('show'));
    }

    /* ----- composer ----- */
    function autosize() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; }
    ta.addEventListener('input', autosize);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.isComposing) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : sendNow(); }
    });
    ta.addEventListener('paste', (e) => {
      const f = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0];
      if (f) { e.preventDefault(); setFile(f); }
    });
    let previewUrl = null;
    function setFile(f) {
      if (!f) return;
      if (f.size > 25 * 1024 * 1024) { toast('File terlalu besar (maks 25MB)'); return; }
      pendingFile = f;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = /^image\//.test(f.type) ? URL.createObjectURL(f) : null;
      previewEl.innerHTML = (previewUrl ? '<img src="' + previewUrl + '" alt="">' : '<i class="fa-solid fa-file"></i>') +
        '<span class="nm">' + esc(f.name) + '</span><button type="button" class="cu-x" id="cuPrevX"><i class="fa-solid fa-xmark"></i></button>';
      previewEl.classList.add('show');
      $('cuPrevX').addEventListener('click', clearFile);
    }
    function clearFile() {
      pendingFile = null; fileIn.value = '';
      previewEl.classList.remove('show'); previewEl.innerHTML = '';
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    }
    fileIn.addEventListener('change', () => { if (fileIn.files && fileIn.files[0]) setFile(fileIn.files[0]); });

    /* ----- kirim (optimistic) ----- */
    form.addEventListener('submit', (e) => { e.preventDefault(); sendNow(); });
    function sendNow() {
      const text = ta.value.trim();
      const file = pendingFile;
      if (!text && !file) return;
      const rt = replyTo;
      const fake = {
        _id: 'tmp' + (++tmpSeq), userId: ME, username: CFG.me.username, role: CFG.me.role, avatarUrl: CFG.me.avatarUrl || '',
        text: text, fileUrl: '', fileType: '', fileName: file ? file.name : '', readAt: null,
        replyTo: rt ? { msgId: rt._id, userId: rt.userId, username: rt.username || '', text: (rt.text || '').slice(0, 140), fileType: rt.fileType || '' } : null,
        createdAt: new Date().toISOString(), _pending: true, _file: file, _replyId: rt ? rt._id : ''
      };
      if (file) {
        fake.fileType = /^image\//.test(file.type) ? 'image' : (/^video\//.test(file.type) ? 'video' : 'file');
        if (fake.fileType !== 'file') fake.fileUrl = URL.createObjectURL(file);
      }
      removeEmpty();
      const el = build(fake);
      el.classList.add('cu-new');
      el._fake = fake;
      store[fake._id] = fake;
      appendEl(el, list);
      stuck = true; scrollBottom(true);
      ta.value = ''; autosize(); clearReply();
      pendingFile = null; fileIn.value = ''; previewEl.classList.remove('show'); previewEl.innerHTML = '';
      if (previewUrl) previewUrl = null; // objectURL milik bubble pending, jangan direvoke dulu
      post(el);
    }
    function post(el) {
      const fake = el._fake;
      const fd = new FormData();
      fd.append('text', fake.text);
      if (fake._file) fd.append('attachment', fake._file);
      if (fake._replyId) fd.append('replyTo', fake._replyId);
      fetch(EP.send, { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
        .then((r) => r.json())
        .then((d) => { if (d.success) finalize(el, d.message); else fail(el, d.message || 'Gagal mengirim pesan'); })
        .catch(() => fail(el, 'Koneksi bermasalah. Ketuk untuk kirim ulang.'));
    }
    function finalize(el, msg) {
      const fake = el._fake;
      if (fake && fake.fileUrl && fake.fileUrl.indexOf('blob:') === 0) setTimeout(() => URL.revokeObjectURL(fake.fileUrl), 4000);
      delete store[fake._id];
      if (seen[msg._id]) { el.remove(); cleanupDays(); return; } // SSE sudah mengantar duluan
      const real = build(msg);
      real.className = el.className.replace(' pending', '').replace(' failed', '').replace(' cu-new', '');
      remember(msg);
      el.parentNode.replaceChild(real, el);
    }
    function fail(el, msg) {
      el.classList.remove('pending'); el.classList.add('failed');
      const col = el.querySelector('.cu-col');
      if (col && !col.querySelector('.cu-fail')) {
        const f = document.createElement('div'); f.className = 'cu-fail';
        f.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Gagal kirim — ketuk untuk kirim ulang';
        col.appendChild(f);
      }
      toast(msg);
    }
    function retry(el) {
      const f = el.querySelector('.cu-fail'); if (f) f.remove();
      el.classList.remove('failed'); el.classList.add('pending');
      post(el);
    }

    /* ----- realtime handlers ----- */
    function markRead() {
      if (MODE !== 'private' || document.hidden) return;
      fetch(EP.read, { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    }
    function resync() {
      const url = EP.list + (lastTs ? '?after=' + encodeURIComponent(lastTs) : '');
      fetch(url, { credentials: 'same-origin' }).then((r) => r.json()).then((d) => {
        (d.messages || []).forEach((m) => incoming(m, true));
        if (MODE === 'private' && (d.messages || []).some((m) => String(m.userId) !== ME)) markRead();
      }).catch(() => {});
    }
    handlers.resync = resync;
    if (MODE === 'room') {
      handlers.room = (m) => incoming(m, true);
      handlers['room-del'] = (d) => removeMsg(d.id);
      handlers['room-clear'] = () => {
        list.querySelectorAll('.cu-msg,.cu-day').forEach((n) => n.classList.add('cu-out'));
        setTimeout(() => { list.innerHTML = ''; Object.keys(store).forEach((k) => delete store[k]); Object.keys(seen).forEach((k) => delete seen[k]); lastTs = null; oldestTs = null; showEmptyIfNone(); }, reduceMotion ? 0 : 350);
      };
    } else {
      handlers.pm = (m) => {
        if (m.convKey !== KEY) return;
        incoming(m, true);
        if (String(m.userId) !== ME) markRead();
      };
      handlers['pm-read'] = (d) => {
        if (String(d.by) !== PEER) return; // lawan bicara sudah membaca pesan kita
        list.querySelectorAll('.cu-msg.me .cu-tick:not(.read)').forEach((t) => { t.className = 'fa-solid fa-check-double cu-tick read'; });
        Object.keys(store).forEach((k) => { if (store[k].readAt === null) store[k].readAt = new Date().toISOString(); });
      };
    }

    // cadangan polling saat SSE tidak tersambung
    setInterval(() => { if (!sseOpen && !document.hidden) resync(); }, 6000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { resync(); markRead(); } });

    initialRender();
    autosize();
    if (MODE === 'private') markRead();
  }

  /* ============================================================
     INBOX chat private
     ============================================================ */
  function initInbox() {
    const convEl = $('cuConvs'), resEl = $('cuResults'), searchEl = $('cuSearch'), adminBox = $('cuAdmins');
    function timeLabel(iso) {
      const d = new Date(iso), now = new Date();
      return dayKey(d) === dayKey(now) ? tf.format(d) : d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit' });
    }
    function userItem(u, idx) {
      return '<a class="cu-item" style="animation-delay:' + Math.min(idx, 8) * 30 + 'ms" href="/chat/private/' + esc(u.id) + '"><span class="rt-av" data-uid="' + esc(u.id) + '"><img src="' + esc(avatarOf(u)) + '" alt="" loading="lazy" decoding="async"><i class="rt-dot"></i></span>' +
        '<div class="mid"><div class="top"><span class="nm">' + esc(u.username) + '</span><span class="cu-role ' + esc(u.role) + '">' + esc(u.role) + '</span></div></div><i class="fa-solid fa-chevron-right"></i></a>';
    }
    function convItem(c, idx) {
      const pv = (c.last.fromMe ? 'Kamu: ' : '') + previewOf(c.last.text, c.last.fileType);
      return '<a class="cu-item' + (c.unread ? ' unread' : '') + '" style="animation-delay:' + Math.min(idx, 8) * 30 + 'ms" href="/chat/private/' + esc(c.peer.id) + '"><span class="rt-av" data-uid="' + esc(c.peer.id) + '"><img src="' + esc(avatarOf(c.peer)) + '" alt="" loading="lazy" decoding="async"><i class="rt-dot"></i></span>' +
        '<div class="mid"><div class="top"><span class="nm">' + esc(c.peer.username) + '</span><span class="cu-role ' + esc(c.peer.role) + '">' + esc(c.peer.role) + '</span></div><div class="pv">' + esc(pv) + '</div></div>' +
        '<div class="rt"><span class="tm">' + timeLabel(c.last.createdAt) + '</span>' + (c.unread ? '<span class="cu-badge show">' + (c.unread > 99 ? '99+' : c.unread) + '</span>' : '') + '</div></a>';
    }
    function renderConvs(cs) {
      convEl.innerHTML = cs.length ? cs.map(convItem).join('') :
        '<div class="cu-state"><i class="fa-regular fa-comments" style="font-size:26px;display:block;margin-bottom:6px"></i>Belum ada percakapan.<br>Cari user di atas atau chat admin.</div>';
    }
    function renderAdmins(list) {
      if (!adminBox) return;
      adminBox.style.display = list.length ? '' : 'none';
      adminBox.querySelector('.items').innerHTML = list.map(userItem).join('');
    }
    renderConvs(CFG.conversations || []);
    renderAdmins(CFG.admins || []);

    let timer, seq = 0;
    searchEl.addEventListener('input', () => {
      clearTimeout(timer);
      const q = searchEl.value.trim();
      if (q.length < 2) { resEl.style.display = 'none'; resEl.innerHTML = ''; return; }
      timer = setTimeout(() => {
        const my = ++seq;
        fetch('/chat/private/search?q=' + encodeURIComponent(q), { credentials: 'same-origin' }).then((r) => r.json()).then((d) => {
          if (my !== seq) return;
          resEl.style.display = '';
          resEl.innerHTML = '<div class="cu-sec">Hasil pencarian</div>' + ((d.users || []).length ? d.users.map(userItem).join('') : '<div class="cu-state">User tidak ditemukan.</div>');
        }).catch(() => {});
      }, 250);
    });

    let busy = false;
    function refresh() {
      if (busy) return; busy = true;
      fetch('/chat/private/list', { credentials: 'same-origin' }).then((r) => r.json()).then((d) => {
        if (d.success) { renderConvs(d.conversations); setBadge(d.unread); }
      }).catch(() => {}).then(() => { setTimeout(() => { busy = false; }, 300); });
    }
    handlers.pm = refresh;
    handlers['pm-read'] = refresh;
    handlers.resync = refresh;
    setInterval(() => { if (!sseOpen && !document.hidden) refresh(); }, 8000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }

  if (MODE === 'inbox') initInbox(); else initThread();
  connect();
})();
