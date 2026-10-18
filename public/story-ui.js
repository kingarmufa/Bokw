/* ============ STORY UI v1 — story ala IG, tampilan komik ============
   API: Story.mountBar(el) | Story.mountMine(el) | Story.openGroup(group, index)
        Story.openComposer() | Story.peerMenu(peer) | Story.peerRing(peerId, imgEl) | Story.renderThumbs(el, group, opts)
   Semua teks user dirender lewat esc()/textContent (aman dari HTML injection). */
(function () {
  'use strict';
  if (window.Story) return;

  var BG_COLORS = ['#edc531', '#171717', '#ffffff', '#dc2626', '#1d4ed8', '#15803d', '#7e22ce', '#db2777', '#ea580c', '#0f766e', '#38bdf8', '#a3e635'];
  var FG_COLORS = ['#171717', '#ffffff', '#edc531', '#dc2626', '#1d4ed8', '#15803d', '#7e22ce', '#db2777'];
  var MIN_RATIO = 4.5;          // sama dengan server & contrast guard tema
  var MAX_VIDEO_SEC = 30;
  var MAX_IMAGE = 25 * 1024 * 1024;   // foto -> GitHub
  var MAX_VIDEO = 50 * 1024 * 1024;   // video -> Supabase
  var ME = window.STORY_ME || null;

  var state = { me: null, groups: [], loaded: false, loading: null };
  var bars = [], mines = [];
  var V = null;   // viewer aktif
  var CP = null;  // composer aktif

  /* ---------- util ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function node(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function initialAvatar(name) {
    var ch = String(name || '?').charAt(0).toUpperCase().replace(/[<>&"']/g, '?');
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#edc531"/><text x="32" y="43" font-size="32" font-family="Arial,sans-serif" font-weight="800" text-anchor="middle" fill="#171717">' + ch + '</text></svg>');
  }
  function avatarOf(u) { return u && u.avatarUrl && String(u.avatarUrl).trim() ? u.avatarUrl : initialAvatar(u && (u.displayName || u.username)); }
  function ago(ms) {
    var m = Math.floor((Date.now() - ms) / 60000);
    if (m < 1) return 'baru saja';
    if (m < 60) return m + ' mnt lalu';
    return Math.floor(m / 60) + ' jam lalu';
  }
  function lum(hex) {
    var n = parseInt(hex.slice(1), 16), a = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function isMine(user) { return !!(ME && user && String(user.id) === String(ME.id)); }
  function colorVars(elm, s) { elm.style.setProperty('--st-bg', s.bgColor); elm.style.setProperty('--st-fg', s.textColor); }
  function post(url) { return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).catch(function () { return { success: false }; }); }

  /* ---------- data ---------- */
  function load(force) {
    if (state.loading && !force) return state.loading;
    state.loading = fetch('/api/stories', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.success) { state.me = j.me; state.groups = j.groups || []; state.loaded = true; if (!ME) ME = { id: j.me.user.id, role: j.me.user.role, username: j.me.user.username }; }
        return state;
      })
      .catch(function () { return state; });
    return state.loading;
  }
  function refresh() { return load(true).then(function () { bars.forEach(renderBar); mines.forEach(renderMine); }); }

  /* ---------- kartu story (dipakai viewer, preview, thumbnail) ---------- */
  function buildCard(s, small) {
    if (s.type === 'media') {
      var box = document.createElement('div');
      box.style.cssText = 'position:absolute;inset:0';
      if (s.mediaKind === 'video') { var v = document.createElement('video'); v.src = s.mediaUrl + (small ? '#t=0.1' : ''); v.muted = !!small; v.playsInline = true; v.preload = 'metadata'; box.appendChild(v); }
      else { var im = document.createElement('img'); im.src = s.mediaUrl; im.alt = ''; box.appendChild(im); }
      return box;
    }
    var card = node('<div class="st-tcard"></div>');
    colorVars(card, s);
    if (s.topic) { var t = node('<span class="st-topic"></span>'); t.textContent = '#' + s.topic; card.appendChild(t); }
    var p = node('<p class="st-ttext"></p>'); p.textContent = s.text; if ((s.text || '').length > 120) p.className += ' sm';
    card.appendChild(p);
    return card;
  }

  /* ---------- bar story (dashboard) ---------- */
  function mountBar(root) {
    if (!root || bars.indexOf(root) >= 0) return;
    bars.push(root);
    root.innerHTML = '<div class="st-bar-head"><span class="st-title">STORY</span><span class="st-hint">geser &rarr; lihat story teman</span></div><div class="st-row"><span class="st-skel"></span></div>';
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]'); if (!t) return;
      var act = t.getAttribute('data-act');
      if (act === 'add') return openComposer();
      var q = queueForBar(); var i = parseInt(t.getAttribute('data-i'), 10) || 0;
      if (act === 'me') { if (state.me && state.me.stories.length) openViewer(q, 0, 0, {}); else openComposer(); }
      else if (act === 'g') { var off = (state.me && state.me.stories.length) ? 1 : 0; openViewer(q, i + off, startIndex(q[i + off]), {}); }
    });
    load().then(function () { renderBar(root); });
  }
  function queueForBar() { return ((state.me && state.me.stories.length) ? [state.me] : []).concat(state.groups); }
  function startIndex(g) { for (var i = 0; i < g.stories.length; i++) if (!g.stories[i].seen) return i; return 0; }
  function renderBar(root) {
    if (!state.loaded || !state.me) { root.classList.add('st-hide'); return; }
    root.classList.remove('st-hide');
    var me = state.me, has = me.stories.length > 0, allSeen = true;
    var h = '<div class="st-item"><div class="st-avwrap"><button type="button" class="st-av' + (has ? ' ring seen' : ' empty') + '" data-act="me" aria-label="Story kamu"><img src="' + esc(avatarOf(me.user)) + '" alt=""></button>' +
      '<button type="button" class="st-plus" data-act="add" aria-label="Buat story">+</button></div><span class="st-name">Story kamu</span></div>';
    state.groups.forEach(function (g, i) {
      allSeen = g.stories.every(function (s) { return s.seen; });
      h += '<button type="button" class="st-item" data-act="g" data-i="' + i + '"><span class="st-av ring' + (allSeen ? ' seen' : '') + '"><img src="' + esc(avatarOf(g.user)) + '" alt="" loading="lazy"></span><span class="st-name">' + esc(g.user.displayName) + '</span></button>';
    });
    root.querySelector('.st-row').innerHTML = h;
    var hint = root.querySelector('.st-hint'); if (hint) hint.classList.toggle('st-hide', !state.groups.length);
  }

  /* ---------- thumbnail story (profil) ---------- */
  function renderThumbs(container, group, opts) {
    opts = opts || {};
    container.innerHTML = '';
    group.stories.forEach(function (s, i) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'st-thumb'; b.setAttribute('aria-label', 'Lihat story ' + (i + 1));
      b.appendChild(buildCard(s, true));
      if (typeof s.views === 'number') { var tv = document.createElement('span'); tv.className = 'st-tv'; tv.textContent = s.views + ' dilihat'; b.appendChild(tv); }
      b.addEventListener('click', function () { openViewer([group], 0, i, {}); });
      container.appendChild(b);
    });
    if (opts.add) {
      var a = document.createElement('button'); a.type = 'button'; a.className = 'st-add'; a.innerHTML = '<b>+</b><span>Buat</span>';
      a.addEventListener('click', function () { openComposer(); });
      container.appendChild(a);
    }
  }
  function mountMine(root) {
    if (!root || mines.indexOf(root) >= 0) return;
    mines.push(root);
    root.innerHTML = '<div class="st-mine-head"><span class="st-title">STORY SAYA</span></div><div class="st-mine-grid"></div><p class="st-empty"></p>';
    load().then(function () { renderMine(root); });
  }
  function renderMine(root) {
    if (!state.me) return;
    var grid = root.querySelector('.st-mine-grid');
    renderThumbs(grid, state.me, { add: true });
    root.querySelector('.st-empty').textContent = state.me.stories.length ? 'Story otomatis hilang setelah 24 jam. Ketuk story untuk melihat / menghapus.' : 'Belum ada story aktif. Ketuk + untuk membuat story pertamamu.';
  }

  /* ---------- viewer ---------- */
  function closeViewer() {
    if (!V) return;
    cancelAnimationFrame(V.raf);
    document.removeEventListener('keydown', V.onKey);
    closeSheet();
    if (V.video) { try { V.video.pause(); } catch (e) {} }
    V.ov.remove();
    document.body.style.overflow = '';
    var changed = V.changed; V = null;
    if (changed) refresh();
  }
  function openViewer(queue, gi, si, opts) {
    if (!queue || !queue[gi] || !queue[gi].stories.length) return;
    closeViewer();
    var ov = node('<div class="st-ov" role="dialog" aria-modal="true" aria-label="Story"><div class="st-stage">' +
      '<div class="st-prog"></div><div class="st-top"></div><div class="st-body"></div>' +
      '<div class="st-zone st-zl"></div><div class="st-zone st-zr"></div><div class="st-foot"></div></div></div>');
    document.body.appendChild(ov); document.body.style.overflow = 'hidden';
    V = { ov: ov, stage: ov.firstChild, queue: queue, gi: gi, si: si || 0, paused: false, hold: false, wait: false, elapsed: 0, last: 0, dur: 5000, video: null, raf: 0, changed: false, sheet: null };
    V.onKey = function (e) {
      if (e.key === 'Escape') { if (V.sheet) closeSheet(); else closeViewer(); }
      else if (e.key === 'ArrowRight') next(); else if (e.key === 'ArrowLeft') prev();
      else if (e.key === ' ') { e.preventDefault(); setPaused(!V.paused); }
    };
    document.addEventListener('keydown', V.onKey);
    bindGestures();
    show();
  }
  function cur() { var g = V.queue[V.gi]; return { g: g, s: g.stories[V.si] }; }
  function setPaused(p) {
    if (!V) return; V.paused = p;
    if (V.video) { try { p ? V.video.pause() : V.video.play(); } catch (e) {} }
    var badge = V.stage.querySelector('.st-pause');
    if (p && V.hold && !badge) V.stage.appendChild(node('<span class="st-pause">PAUSE!</span>'));
    if (!p && badge) badge.remove();
  }
  function setProg(p) { var f = V.stage.querySelectorAll('.st-seg')[V.si]; if (f) f.firstChild.style.width = Math.max(0, Math.min(1, p)) * 100 + '%'; }
  function tick(ts) {
    if (!V) return;
    if (V.video) {
      var d = V.video.duration || 0; if (d && !V.paused) setProg(V.video.currentTime / d);
    } else if (!V.paused && !V.wait) {
      if (!V.last) V.last = ts; V.elapsed += ts - V.last; setProg(V.elapsed / V.dur);
      if (V.elapsed >= V.dur) { V.last = 0; return next(); }
    }
    V.last = ts;
    V.raf = requestAnimationFrame(tick);
  }
  function show() {
    cancelAnimationFrame(V.raf);
    if (V.video) { try { V.video.pause(); } catch (e) {} }
    V.video = null; V.elapsed = 0; V.last = 0; V.wait = false;
    var c = cur(), g = c.g, s = c.s, mine = isMine(g.user);
    // progress
    var prog = V.stage.querySelector('.st-prog'); prog.innerHTML = '';
    g.stories.forEach(function (_, i) { var seg = node('<span class="st-seg' + (i < V.si ? ' done' : '') + '"><i></i></span>'); prog.appendChild(seg); });
    // header
    var top = V.stage.querySelector('.st-top');
    top.innerHTML = '<button type="button" class="st-who" data-who><img src="' + esc(avatarOf(g.user)) + '" alt=""><span class="st-who-t"><span class="st-who-n">' + esc(g.user.displayName) + '</span><span class="st-who-s">@' + esc(g.user.username) + ' &middot; ' + esc(ago(s.createdAt)) + '</span></span></button>' +
      '<span class="st-tools">' + ((mine || (ME && ME.role === 'admin')) ? '<button type="button" class="st-tool" data-del aria-label="Hapus story"><i class="fa-solid fa-trash"></i></button>' : '') + '<button type="button" class="st-tool" data-close aria-label="Tutup"><i class="fa-solid fa-xmark"></i></button></span>';
    // body
    var body = V.stage.querySelector('.st-body'); body.innerHTML = '';
    var old = V.stage.querySelectorAll('.st-cap,.st-mtopic'); old.forEach(function (n) { n.remove(); });
    if (s.type === 'media') {
      if (s.mediaKind === 'video') {
        var v = document.createElement('video'); v.src = s.mediaUrl; v.playsInline = true; v.autoplay = true; v.controls = false;
        v.addEventListener('ended', function () { next(); });
        v.addEventListener('error', function () { V.video = null; V.dur = 4000; });
        body.appendChild(v); V.video = v;
        var pr = v.play(); if (pr && pr.catch) pr.catch(function () { v.muted = true; v.play().catch(function () {}); });
      } else {
        var im = document.createElement('img'); im.alt = ''; V.wait = true;
        im.addEventListener('load', function () { if (V) V.wait = false; }); im.addEventListener('error', function () { if (V) V.wait = false; });
        im.src = s.mediaUrl; body.appendChild(im); V.dur = 5500;
      }
      if (s.topic) { var mt = node('<span class="st-topic st-mtopic"></span>'); mt.textContent = '#' + s.topic; V.stage.appendChild(mt); }
      if (s.text) { var cap = node('<div class="st-cap"></div>'); cap.textContent = s.text; V.stage.appendChild(cap); }
    } else {
      body.appendChild(buildCard(s, false));
      V.dur = Math.min(9000, 3500 + (s.text || '').length * 45);
    }
    // footer (jumlah dilihat, hanya untuk story sendiri)
    V.stage.querySelector('.st-foot').innerHTML = mine ? '<span class="st-views"><i class="fa-solid fa-eye"></i> ' + (s.views || 0) + ' dilihat</span>' : '';
    // tandai sudah dilihat
    if (!mine && !s.seen) { s.seen = true; V.changed = true; post('/api/stories/' + encodeURIComponent(s.id) + '/view'); }
    V.raf = requestAnimationFrame(tick);
  }
  function next() {
    if (!V) return;
    var g = V.queue[V.gi];
    if (V.si < g.stories.length - 1) { V.si++; show(); }
    else if (V.gi < V.queue.length - 1) { V.gi++; V.si = 0; show(); }
    else closeViewer();
  }
  function prev() {
    if (!V) return;
    if (V.elapsed > 1500 && !V.video) { V.elapsed = 0; V.last = 0; return; }
    if (V.si > 0) { V.si--; show(); } else if (V.gi > 0) { V.gi--; V.si = 0; show(); } else { show(); }
  }
  function jumpGroup(dir) {
    var n = V.gi + dir;
    if (n < 0) return show();
    if (n >= V.queue.length) return closeViewer();
    V.gi = n; V.si = 0; show();
  }
  function bindGestures() {
    var st = V.stage, sx = 0, sy = 0, t0 = 0, moved = false, holdTimer = 0, active = false;
    st.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button,a')) return;
      active = true; moved = false; sx = e.clientX; sy = e.clientY; t0 = Date.now();
      holdTimer = setTimeout(function () { if (active && !moved && V) { V.hold = true; setPaused(true); } }, 220);
    });
    st.addEventListener('pointermove', function (e) { if (active && (Math.abs(e.clientX - sx) > 12 || Math.abs(e.clientY - sy) > 12)) moved = true; });
    function end(e) {
      if (!active) return; active = false; clearTimeout(holdTimer);
      if (!V) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (V.hold) { V.hold = false; setPaused(false); return; }
      if (dy > 90 && Math.abs(dy) > Math.abs(dx)) return closeViewer();
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) return jumpGroup(dx < 0 ? 1 : -1);
      if (!moved && Date.now() - t0 < 300) {
        var r = st.getBoundingClientRect();
        if (e.clientX - r.left < r.width * 0.33) prev(); else next();
      }
    }
    st.addEventListener('pointerup', end);
    st.addEventListener('pointercancel', function () { active = false; clearTimeout(holdTimer); if (V && V.hold) { V.hold = false; setPaused(false); } });
    st.addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t) return;
      if (t.hasAttribute('data-close')) closeViewer();
      else if (t.hasAttribute('data-who')) openSheet(cur().g.user, cur().g);
      else if (t.hasAttribute('data-del')) delCurrent();
    });
    V.ov.addEventListener('click', function (e) { if (e.target === V.ov) closeViewer(); });
  }
  function delCurrent() {
    var c = cur(); setPaused(true);
    if (!window.confirm('Hapus story ini?')) return setPaused(false);
    post('/api/stories/' + encodeURIComponent(c.s.id) + '/delete').then(function (j) {
      if (!j || !j.success) { window.alert((j && j.message) || 'Gagal menghapus story.'); return setPaused(false); }
      V.changed = true;
      c.g.stories.splice(V.si, 1);
      if (!c.g.stories.length) {
        V.queue.splice(V.gi, 1);
        if (!V.queue.length) return closeViewer();
        if (V.gi >= V.queue.length) V.gi = V.queue.length - 1;
        V.si = 0;
      } else if (V.si >= c.g.stories.length) V.si = c.g.stories.length - 1;
      V.paused = false; show();
    });
  }

  /* ---------- sheet profil (dari viewer / dari chat) ---------- */
  function closeSheet() {
    var sh = document.querySelector('.st-sheet-bg'); if (sh) sh.remove();
    if (V) { V.sheet = null; if (V.paused) { V.hold = false; setPaused(false); } }
  }
  function sheetHtml(u, extra) {
    var self = isMine(u);
    return '<div class="st-sheet" role="dialog" aria-label="Profil"><img class="st-sheet-av' + (extra.ring ? ' ring' : '') + '" src="' + esc(avatarOf(u)) + '" alt="">' +
      '<h3 class="st-sheet-name">' + esc(u.displayName || u.username) + '</h3><p class="st-sheet-user">@' + esc(u.username) + '</p>' +
      '<span class="st-role ' + esc(u.role) + '">' + esc(u.role) + '</span>' +
      (u.bio ? '<p class="st-bio">' + esc(u.bio) + '</p>' : '') +
      '<div class="st-acts">' + (extra.actions || '') + '</div>' +
      '<button type="button" class="st-close-x" data-shclose>Tutup</button></div>';
  }
  function openSheet(user, group) {
    if (!V) return;
    setPaused(true); V.hold = false;
    var self = isMine(user);
    var bg = node('<div class="st-sheet-bg">' + sheetHtml(user, {
      ring: true,
      actions: '<a class="st-act" href="/u/' + esc(user.id) + '"><i class="fa-solid fa-user"></i> Profil</a>' + (self ? '' : '<a class="st-act alt" href="/chat/private/' + esc(user.id) + '"><i class="fa-solid fa-comment-dots"></i> Chat</a>')
    }) + '</div>');
    bg.addEventListener('click', function (e) { if (e.target === bg || e.target.hasAttribute('data-shclose')) closeSheet(); });
    document.body.appendChild(bg); V.sheet = bg;
  }
  // Menu di header chat private: dua pilihan -> Story & Profil
  function peerMenu(peer, opts) {
    var chatBtn = (opts && opts.chat) ? '<a class="st-act alt" href="/chat/private/' + esc(peer.id) + '"><i class="fa-solid fa-comment-dots"></i> Chat</a>' : '';
    var bg = node('<div class="st-sheet-bg">' + sheetHtml(peer, {
      ring: false,
      actions: '<button type="button" class="st-act off" data-pstory disabled><i class="fa-solid fa-circle-play"></i> Story</button><a class="st-act alt" href="/u/' + esc(peer.id) + '"><i class="fa-solid fa-user"></i> Profil</a>' + chatBtn
    }) + '</div>');
    var btn = bg.querySelector('[data-pstory]'), group = null;
    bg.addEventListener('click', function (e) {
      if (e.target === bg || e.target.hasAttribute('data-shclose')) return bg.remove();
      if (e.target.closest('[data-pstory]') && group) { bg.remove(); openViewer([group], 0, startIndex(group), {}); }
    });
    document.body.appendChild(bg);
    fetch('/api/users/' + encodeURIComponent(peer.id) + '/stories', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.success && j.group && j.group.stories.length) {
          group = j.group; btn.disabled = false; btn.classList.remove('off');
          bg.querySelector('.st-sheet-av').classList.add('ring');
        } else { btn.innerHTML = '<i class="fa-solid fa-circle-play"></i> Belum ada story'; }
      }).catch(function () {});
  }
  // Dari room chat: klik avatar/nama -> ambil data user (nama, @username, bio) lalu buka menu profil
  function userMenu(userId) {
    fetch('/api/users/' + encodeURIComponent(userId) + '/stories', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.success || !j.group || !j.group.user) return;
        var u = j.group.user;
        peerMenu(u, { chat: !isMine(u) });
      }).catch(function () {});
  }
  function peerRing(peerId, img) {
    if (!img) return;
    fetch('/api/users/' + encodeURIComponent(peerId) + '/stories', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.success && j.group && j.group.stories.length) img.classList.add('hasstory'); })
      .catch(function () {});
  }

  /* ---------- composer ---------- */
  function closeComposer() {
    if (!CP) return;
    if (CP.url) URL.revokeObjectURL(CP.url);
    CP.root.remove(); document.body.style.overflow = ''; CP = null;
  }
  function swatchHtml(list, key) {
    return list.map(function (c) { return '<button type="button" data-k="' + key + '" data-c="' + c + '" aria-label="Warna ' + c + '"></button>'; }).join('') +
      '<label class="custom" title="Warna lain"><input type="color" data-k="' + key + '" value="' + (key === 'bg' ? '#edc531' : '#171717') + '"></label>';
  }
  function openComposer() {
    closeViewer(); closeComposer();
    var root = node('<div class="st-cp" role="dialog" aria-modal="true" aria-label="Buat story"><div class="st-cp-box">' +
      '<div class="st-cp-head"><h3>BUAT STORY</h3><button type="button" class="st-x" data-x aria-label="Tutup"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="st-cp-body">' +
        '<div class="st-mode"><button type="button" data-mode="text" class="on"><i class="fa-solid fa-pen"></i> Tulisan</button><button type="button" data-mode="media"><i class="fa-solid fa-image"></i> Foto / Video</button></div>' +
        '<div class="st-prev" data-prev></div>' +
        '<div data-p-text>' +
          '<div class="st-lbl">Tulisan <small><span data-cnt>0</span>/280</small></div><textarea data-text rows="3" maxlength="280" placeholder="Tulis sesuatu..."></textarea>' +
          '<div class="st-lbl">Warna background</div><div class="st-sw" data-sw-bg>' + swatchHtml(BG_COLORS, 'bg') + '</div>' +
          '<div class="st-lbl">Warna tulisan</div><div class="st-sw" data-sw-fg>' + swatchHtml(FG_COLORS, 'fg') + '</div>' +
          '<div class="st-ct" data-ct></div>' +
        '</div>' +
        '<div class="st-hide" data-p-media>' +
          '<input type="file" class="st-hide" data-file accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime">' +
          '<button type="button" class="st-pick" data-pick><i class="fa-solid fa-cloud-arrow-up"></i> Pilih foto / video</button>' +
          '<div class="st-lbl">Keterangan <small>opsional &middot; <span data-ccnt>0</span>/120</small></div><input type="text" data-cap maxlength="120" placeholder="Tulis keterangan...">' +
          '<p class="st-empty">Foto: JPG/PNG/WEBP/GIF. Video: MP4/WEBM/MOV, maks. ' + MAX_VIDEO_SEC + ' detik &amp; 50MB.</p>' +
        '</div>' +
        '<div class="st-lbl">Topik <small>opsional &middot; <span data-tcnt>0</span>/30</small></div><input type="text" data-topic maxlength="30" placeholder="contoh: promo, curhat, info">' +
      '</div>' +
      '<div class="st-cp-foot"><p class="st-err" data-err></p><button type="button" class="st-post" data-post>POSTING!</button></div>' +
    '</div></div>');
    document.body.appendChild(root); document.body.style.overflow = 'hidden';
    var q = function (s) { return root.querySelector(s); };
    var S = CP = { root: root, mode: 'text', bg: '#edc531', fg: '#171717', file: null, url: null, busy: false, mediaOk: false };

    root.querySelectorAll('.st-sw button').forEach(function (b) { b.style.setProperty('--sw', b.getAttribute('data-c')); });
    root.querySelectorAll('.st-sw label.custom').forEach(function (l) { l.style.setProperty('--sw', 'transparent'); });

    function paint() {
      var prev = q('[data-prev]'); prev.innerHTML = '';
      if (S.mode === 'text') {
        var txt = q('[data-text]').value.trim(), topic = cleanTopic(q('[data-topic]').value);
        prev.appendChild(buildCard({ type: 'text', text: txt || 'Tulisan story kamu di sini...', topic: topic, bgColor: S.bg, textColor: S.fg }, false));
      } else if (S.url) {
        var isVid = S.file && /^video\//.test(S.file.type), m = document.createElement(isVid ? 'video' : 'img');
        m.src = S.url; if (isVid) { m.muted = true; m.autoplay = true; m.loop = true; m.playsInline = true; }
        prev.appendChild(m);
        var cp = q('[data-cap]').value.trim(); if (cp) { var cd = node('<div class="st-cap"></div>'); cd.textContent = cp; prev.appendChild(cd); }
      } else prev.appendChild(node('<div class="st-prev-empty">Belum ada foto / video dipilih</div>'));
      root.querySelectorAll('.st-sw button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-c') === S[b.getAttribute('data-k')]); });
      validate();
    }
    function cleanTopic(v) { return String(v || '').replace(/[<>]/g, '').replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, 30); }
    function problem() {
      if (S.mode === 'text') {
        if (!q('[data-text]').value.trim()) return 'Tulis dulu isi story-nya.';
        if (S.bg.toLowerCase() === S.fg.toLowerCase()) return 'Warna tulisan tidak boleh sama dengan warna background.';
        if (ratio(S.bg, S.fg) < MIN_RATIO) return 'Warna tulisan terlalu mirip dengan background. Pilih warna yang lebih kontras.';
        return '';
      }
      if (!S.file || !S.mediaOk) return 'Pilih foto atau video dulu.';
      return '';
    }
    function validate() {
      var ct = q('[data-ct]'), pb = problem();
      if (S.mode === 'text') {
        var r = ratio(S.bg, S.fg);
        var same = S.bg.toLowerCase() === S.fg.toLowerCase();
        ct.className = 'st-ct ' + (same || r < MIN_RATIO ? 'bad' : 'ok');
        ct.textContent = same ? 'Warna tulisan sama dengan background. Ganti salah satunya!' : (r < MIN_RATIO ? 'Terlalu mirip (kontras ' + r.toFixed(1) + ':1, minimal ' + MIN_RATIO + ':1). Pilih warna lain.' : 'Kontras aman \u2713 (' + r.toFixed(1) + ':1)');
      }
      q('[data-post]').disabled = S.busy || !!pb;
    }
    function setErr(m) { q('[data-err]').textContent = m || ''; }

    root.addEventListener('click', function (e) {
      if (e.target === root || e.target.closest('[data-x]')) return closeComposer();
      var m = e.target.closest('[data-mode]');
      if (m) {
        S.mode = m.getAttribute('data-mode');
        root.querySelectorAll('[data-mode]').forEach(function (b) { b.classList.toggle('on', b === m); });
        q('[data-p-text]').classList.toggle('st-hide', S.mode !== 'text'); q('[data-p-media]').classList.toggle('st-hide', S.mode !== 'media');
        setErr(''); return paint();
      }
      var sw = e.target.closest('.st-sw button');
      if (sw) { S[sw.getAttribute('data-k')] = sw.getAttribute('data-c'); setErr(''); return paint(); }
      if (e.target.closest('[data-pick]')) return q('[data-file]').click();
      if (e.target.closest('[data-post]')) submit();
    });
    root.addEventListener('input', function (e) {
      var t = e.target;
      if (t.type === 'color') { S[t.getAttribute('data-k')] = t.value; t.parentNode.style.setProperty('--sw', t.value); return paint(); }
      if (t.hasAttribute('data-text')) q('[data-cnt]').textContent = t.value.length;
      if (t.hasAttribute('data-cap')) q('[data-ccnt]').textContent = t.value.length;
      if (t.hasAttribute('data-topic')) q('[data-tcnt]').textContent = t.value.length;
      setErr(''); paint();
    });
    q('[data-file]').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      if (S.url) { URL.revokeObjectURL(S.url); S.url = null; }
      S.file = null; S.mediaOk = false; setErr('');
      var isVid = /^video\//i.test(f.type);
      if (f.size > (isVid ? MAX_VIDEO : MAX_IMAGE)) { setErr(isVid ? 'Ukuran video maksimal 50MB.' : 'Ukuran foto maksimal 25MB.'); e.target.value = ''; return paint(); }
      var url = URL.createObjectURL(f);
      if (/^video\//.test(f.type)) {
        var probe = document.createElement('video'); probe.preload = 'metadata';
        probe.onloadedmetadata = function () {
          if (probe.duration > MAX_VIDEO_SEC + 0.5) { URL.revokeObjectURL(url); setErr('Video maksimal ' + MAX_VIDEO_SEC + ' detik.'); e.target.value = ''; return paint(); }
          S.file = f; S.url = url; S.mediaOk = true; CP && paint();
        };
        probe.onerror = function () { URL.revokeObjectURL(url); setErr('Video tidak bisa dibaca di perangkat ini.'); e.target.value = ''; paint(); };
        probe.src = url;
      } else { S.file = f; S.url = url; S.mediaOk = true; paint(); }
    });

    function submit() {
      var pb = problem(); if (pb) return setErr(pb);
      S.busy = true; validate(); setErr('');
      var btn = q('[data-post]'); btn.textContent = 'MENGIRIM...';
      var fd = new FormData();
      fd.append('type', S.mode); fd.append('topic', cleanTopic(q('[data-topic]').value));
      if (S.mode === 'text') { fd.append('text', q('[data-text]').value); fd.append('bgColor', S.bg); fd.append('textColor', S.fg); }
      else { fd.append('text', q('[data-cap]').value); fd.append('media', S.file); }
      fetch('/api/stories', { method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json().catch(function () { return { success: false, message: 'Respon server tidak valid.' }; }); })
        .then(function (j) {
          if (!j.success) { S.busy = false; btn.textContent = 'POSTING!'; setErr(j.message || 'Gagal membuat story.'); return validate(); }
          closeComposer(); refresh();
        })
        .catch(function () { S.busy = false; btn.textContent = 'POSTING!'; setErr('Koneksi bermasalah, coba lagi.'); validate(); });
    }
    paint();
  }

  window.Story = {
    mountBar: mountBar, mountMine: mountMine, renderThumbs: renderThumbs, refresh: refresh,
    openGroup: function (group, idx) { openViewer([group], 0, idx || 0, {}); },
    startIndex: startIndex, openComposer: openComposer, peerMenu: peerMenu, userMenu: userMenu, peerRing: peerRing
  };
})();
