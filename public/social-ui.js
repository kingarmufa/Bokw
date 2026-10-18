/* SOCIAL UI v2 — feed ala Instagram (postingan, like, komentar + balasan, share) + story + Reels (video vertikal) + tab Komentar.
   Bergantung pada /story-ui.js (window.Story) untuk bar story, viewer, dan composer story.
   Semua teks user dimasukkan lewat textContent / esc() (anti XSS). Semua fetch anti-eror. */
(function () {
  'use strict';
  if (window.__socialUi) return;
  window.__socialUi = true;

  var CFG = window.SG_CFG || {};
  var ME = CFG.me || {};
  var root = document.getElementById('sgRoot');
  if (!root) return;

  /* ---------- util ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function initialAvatar(name) {
    var ch = String(name || '?').charAt(0).toUpperCase().replace(/[<>&"']/g, '?');
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#edc531"/><text x="32" y="43" font-size="32" font-family="Arial" font-weight="700" text-anchor="middle" fill="#171717">' + ch + '</text></svg>');
  }
  function avatarOf(u) { return u && u.avatarUrl && String(u.avatarUrl).trim() ? u.avatarUrl : initialAvatar(u && (u.displayName || u.username)); }
  function ago(ms) {
    var s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (s < 60) return 'baru saja';
    var m = Math.floor(s / 60); if (m < 60) return m + ' mnt lalu';
    var h = Math.floor(m / 60); if (h < 24) return h + ' jam lalu';
    var d = Math.floor(h / 24); if (d < 7) return d + ' hari lalu';
    try { return new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return d + ' hari lalu'; }
  }
  function fmt(n) { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'jt' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + 'rb' : String(n); }
  function api(url, opts) {
    opts = opts || {};
    var o = { method: opts.method || 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (opts.json) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.json); }
    return fetch(url, o).then(function (r) {
      if (r.status === 401) { window.location.href = '/login'; return { success: false, message: 'Silakan login dulu.' }; }
      return r.json().catch(function () { return { success: false, message: 'Respon server tidak valid.' }; });
    }).catch(function () { return { success: false, message: 'Koneksi bermasalah, coba lagi.' }; });
  }
  var toastT;
  function toast(msg, isErr) {
    var old = document.querySelector('.sg-toast'); if (old) old.remove();
    var t = el('<div class="sg-toast' + (isErr ? ' err' : '') + '" role="status"></div>'); t.textContent = msg; document.body.appendChild(t);
    clearTimeout(toastT); toastT = setTimeout(function () { t.remove(); }, 2600);
  }
  function lockScroll(on) { document.documentElement.style.overflow = on ? 'hidden' : ''; }
  var openLayers = 0;
  function layer(node, onClose) {
    document.body.appendChild(node); openLayers++; lockScroll(true);
    var closed = false;
    function close() { if (closed) return; closed = true; node.remove(); openLayers = Math.max(0, openLayers - 1); if (!openLayers) lockScroll(false); if (onClose) onClose(); }
    node.addEventListener('click', function (e) { if (e.target === node) close(); });
    var x = node.querySelectorAll('[data-x]'); for (var i = 0; i < x.length; i++) x[i].addEventListener('click', close);
    return close;
  }
  /* tipe file dari HP kadang kosong/octet-stream -> fallback ke ekstensi */
  function ftype(f) {
    var t = String((f && f.type) || '').toLowerCase();
    if (t === 'video/x-m4v') return 'video/mp4';
    if (/^(image\/(png|jpe?g|webp|gif)|video\/(mp4|webm|quicktime))$/.test(t)) return t;
    var m = /\.([a-z0-9]+)$/i.exec((f && f.name) || ''); var e = m ? m[1].toLowerCase() : '';
    var map = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
    return map[e] || t;
  }
  function isVideoUrl(m) { return m && m.kind === 'video'; }

  /* ---------- state ---------- */
  var S = { tab: 'home', feed: [], next: 0, hasMore: false, loading: false, posts: {} };
  var feedEl, moreEl, homeEl, profEl, reelsEl, reelListEl, actEl, actListEl, actMoreEl, muteBtn;

  /* satu objek state per postingan, dipakai bersama oleh feed, Reels, modal & tab Komentar
     (kalau beda objek, like di Reels tidak terbaca updateCard -> ikon tetap putih) */
  function shared(p) {
    var cur = S.posts[p.id];
    if (cur && cur !== p) { for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) cur[k] = p[k]; return cur; }
    S.posts[p.id] = p; return p;
  }

  /* ---------- kartu postingan ---------- */
  function mediaHtml(p) {
    var slides = p.media.map(function (m) {
      return '<div class="sg-slide">' + (isVideoUrl(m)
        ? '<video src="' + esc(m.url) + '" controls playsinline preload="metadata"></video>'
        : '<img src="' + esc(m.url) + '" alt="" loading="lazy">') + '</div>';
    }).join('');
    var multi = p.media.length > 1;
    return '<div class="sg-media"><div class="sg-slides" data-slides>' + slides + '</div>' +
      (multi ? '<span class="sg-count" data-count>1/' + p.media.length + '</span>' : '') + '</div>' +
      (multi ? '<div class="sg-dots" data-dots>' + p.media.map(function (_, i) { return '<i' + (i === 0 ? ' class="on"' : '') + '></i>'; }).join('') + '</div>' : '');
  }
  function buildCard(p) {
    p = shared(p);
    var card = el('<article class="sg-card" data-id="' + esc(p.id) + '">' +
      '<div class="sg-card-top"><span class="rt-av" data-uid="' + esc(p.user.id) + '"><img class="sg-av" alt="" src="' + esc(avatarOf(p.user)) + '"><i class="rt-dot"></i></span><button type="button" class="sg-who" data-user="' + esc(p.user.id) + '"><b></b><small></small></button>' +
      ((p.mine || CFG.isAdmin) ? '<button type="button" class="sg-more" data-del aria-label="Hapus postingan"><i class="fa-solid fa-trash"></i></button>' : '') + '</div>' +
      mediaHtml(p) +
      '<div class="sg-actions">' +
        '<button type="button" class="sg-act' + (p.liked ? ' liked' : '') + '" data-like aria-label="Like"><i class="fa-' + (p.liked ? 'solid' : 'regular') + ' fa-heart"></i><span data-lc>' + fmt(p.likeCount) + '</span></button>' +
        (CFG.allowComments ? '<button type="button" class="sg-act" data-cm aria-label="Komentar"><i class="fa-regular fa-comment"></i><span data-cc>' + fmt(p.commentCount) + '</span></button>' : '') +
        '<button type="button" class="sg-act' + (p.reposted ? ' reposted' : '') + '" data-repost aria-label="Repost"><i class="fa-solid fa-retweet"></i><span data-rc>' + fmt(p.repostCount) + '</span></button>' +
        (CFG.allowShare ? '<button type="button" class="sg-act" data-share aria-label="Bagikan"><i class="fa-regular fa-paper-plane"></i><span data-sc>' + fmt(p.shareCount) + '</span></button>' : '') +
      '</div>' +
      (p.caption ? '<div class="sg-cap"><b data-cn></b><span data-ct></span></div>' : '') +
      (CFG.allowComments ? '<button type="button" class="sg-cmlink" data-cm></button>' : '<div style="height:12px"></div>') +
    '</article>');
    card.querySelector('.sg-who b').textContent = p.user.displayName || p.user.username;
    if (p.user.role === 'admin') { var r = document.createElement('span'); r.className = 'sg-role'; r.textContent = 'ADMIN'; card.querySelector('.sg-who b').appendChild(r); }
    card.querySelector('.sg-who small').textContent = '@' + p.user.username + ' · ' + ago(p.createdAt);
    var cn = card.querySelector('[data-cn]'); if (cn) { cn.textContent = p.user.displayName || p.user.username; card.querySelector('[data-ct]').textContent = p.caption; }
    paintCmLink(card, p);
    var av = card.querySelector('.sg-av'); av.addEventListener('error', function () { av.src = initialAvatar(p.user.username); }, { once: true });
    av.addEventListener('click', function () { openProfile(p.user.id); });
    var sl = card.querySelector('[data-slides]');
    if (sl && p.media.length > 1) {
      sl.addEventListener('scroll', function () {
        var i = Math.round(sl.scrollLeft / Math.max(1, sl.clientWidth));
        var c = card.querySelector('[data-count]'); if (c) c.textContent = (i + 1) + '/' + p.media.length;
        var ds = card.querySelectorAll('[data-dots] i'); for (var k = 0; k < ds.length; k++) ds[k].className = k === i ? 'on' : '';
      }, { passive: true });
    }
    return card;
  }
  function paintCmLink(card, p) {
    var b = card.querySelector('.sg-cmlink'); if (!b) return;
    b.textContent = p.commentCount > 0 ? 'Lihat ' + (p.commentCount > 1 ? 'semua ' + fmt(p.commentCount) + ' komentar' : '1 komentar') : 'Tulis komentar pertama...';
  }
  function updateCard(id) {
    var p = S.posts[id]; if (!p) return;
    var cards = document.querySelectorAll('.sg-card[data-id="' + id + '"]');
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var lk = c.querySelector('[data-like]');
      lk.className = 'sg-act' + (p.liked ? ' liked' : '');
      lk.querySelector('i').className = 'fa-' + (p.liked ? 'solid' : 'regular') + ' fa-heart';
      lk.querySelector('[data-lc]').textContent = fmt(p.likeCount);
      var cc = c.querySelector('[data-cc]'); if (cc) cc.textContent = fmt(p.commentCount);
      var sc = c.querySelector('[data-sc]'); if (sc) sc.textContent = fmt(p.shareCount);
      var rp = c.querySelector('[data-repost]'); if (rp) { rp.className = 'sg-act' + (p.reposted ? ' reposted' : ''); rp.querySelector('[data-rc]').textContent = fmt(p.repostCount); }
      paintCmLink(c, p);
    }
    var rs = document.querySelectorAll('.sg-reel[data-id="' + id + '"]');
    for (var j = 0; j < rs.length; j++) {
      var r = rs[j];
      var rl = r.querySelector('[data-like]'); rl.className = 'sg-ra' + (p.liked ? ' liked' : ''); rl.querySelector('[data-lc]').textContent = fmt(p.likeCount);
      var rc = r.querySelector('[data-cc]'); if (rc) rc.textContent = fmt(p.commentCount);
      var rsh = r.querySelector('[data-sc]'); if (rsh) rsh.textContent = fmt(p.shareCount);
      var rr = r.querySelector('[data-repost]'); if (rr) { rr.className = 'sg-ra' + (p.reposted ? ' reposted' : ''); rr.querySelector('[data-rc]').textContent = fmt(p.repostCount); }
    }
  }

  /* ---------- aksi kartu (delegasi) ---------- */
  document.addEventListener('click', function (e) {
    var card = e.target.closest && e.target.closest('.sg-card'); if (!card) return;
    var id = card.getAttribute('data-id'), p = S.posts[id]; if (!p) return;
    if (e.target.closest('[data-like]')) return toggleLike(p);
    if (e.target.closest('[data-cm]')) return openComments(p);
    if (e.target.closest('[data-repost]')) return toggleRepost(p);
    if (e.target.closest('[data-share]')) return sharePost(p);
    if (e.target.closest('[data-del]')) return delPost(p, card);
    var u = e.target.closest('[data-user]'); if (u) return openProfile(u.getAttribute('data-user'));
  });
  document.addEventListener('dblclick', function (e) {
    var m = e.target.closest && e.target.closest('.sg-media'); if (!m) return;
    var card = m.closest('.sg-card'); var p = card && S.posts[card.getAttribute('data-id')];
    if (p && !p.liked) toggleLike(p);
  });

  var likeBusy = {};
  function toggleLike(p) {
    if (likeBusy[p.id]) return; likeBusy[p.id] = true;
    var want = !p.liked;
    p.liked = want; p.likeCount = Math.max(0, p.likeCount + (want ? 1 : -1)); updateCard(p.id); // optimis
    api('/api/social/posts/' + p.id + '/like', { method: 'POST', json: { like: want } }).then(function (j) {
      likeBusy[p.id] = false;
      if (j && j.success) { p.liked = !!j.liked; p.likeCount = j.likeCount; }
      else { p.liked = !want; p.likeCount = Math.max(0, p.likeCount + (want ? -1 : 1)); toast((j && j.message) || 'Gagal memberi like.', true); }
      updateCard(p.id);
    });
  }
  /* Socket.IO: like dari user/tab lain langsung tampil (jumlah); ikon merah untuk like milik sendiri */
  if (window.RT) RT.on('post:like', function (d) {
    var p = S.posts[d.postId]; if (!p || likeBusy[p.id]) return;
    p.likeCount = Math.max(0, d.likeCount | 0);
    if (String(d.userId) === String(CFG.me.id)) p.liked = !!d.liked;
    updateCard(p.id);
  });
  var repostBusy = {};
  function toggleRepost(p) {
    if (p.mine) return toast('Postingan sendiri tidak bisa di-repost.', true);
    if (repostBusy[p.id]) return; repostBusy[p.id] = true;
    var want = !p.reposted;
    p.reposted = want; p.repostCount = Math.max(0, (p.repostCount || 0) + (want ? 1 : -1)); updateCard(p.id); // optimis
    api('/api/social/posts/' + p.id + '/repost', { method: 'POST', json: { repost: want } }).then(function (j) {
      repostBusy[p.id] = false;
      if (j && j.success) { p.reposted = !!j.reposted; p.repostCount = j.repostCount; toast(p.reposted ? 'Di-repost ke profil kamu!' : 'Repost dibatalkan.'); }
      else { p.reposted = !want; p.repostCount = Math.max(0, (p.repostCount || 0) + (want ? -1 : 1)); toast((j && j.message) || 'Gagal repost.', true); }
      updateCard(p.id);
      if (S.tab === 'profile' && profState.id === 'me') loadProfile('me', false); // daftar repost di profil ikut diperbarui
    });
  }
  function sharePost(p) {
    api('/api/social/posts/' + p.id + '/share', { method: 'POST' }).then(function (j) {
      if (!j || !j.success) return toast((j && j.message) || 'Gagal membagikan.', true);
      p.shareCount = j.shareCount; updateCard(p.id);
      var url = j.url, title = (CFG.title || 'Postingan') + ' — ' + (p.user.displayName || p.user.username);
      if (navigator.share) { navigator.share({ title: title, text: p.caption ? p.caption.slice(0, 80) : title, url: url }).catch(function () {}); return; }
      var done = function () { toast('Link postingan disalin!'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url); });
      else fallbackCopy(url);
    });
  }
  function fallbackCopy(text) {
    try { var t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); toast('Link postingan disalin!'); }
    catch (e) { window.prompt('Salin link ini:', text); }
  }
  function delPost(p, card) {
    if (!window.confirm('Hapus postingan ini?')) return;
    api('/api/social/posts/' + p.id + '/delete', { method: 'POST' }).then(function (j) {
      if (!j || !j.success) return toast((j && j.message) || 'Gagal menghapus.', true);
      delete S.posts[p.id];
      var all = document.querySelectorAll('.sg-card[data-id="' + p.id + '"], .sg-reel[data-id="' + p.id + '"]'); for (var i = 0; i < all.length; i++) all[i].remove();
      if (reelListEl && !reelListEl.querySelector('.sg-reel')) reelListEl.innerHTML = '<div class="sg-reel-msg"><b>BELUM ADA REELS</b>Tekan tombol + lalu pilih REELS untuk upload video.</div>';
      var m = document.querySelector('.sg-modal'); if (m && m.querySelector('.sg-card') === null) { var x = m.querySelector('[data-x]'); if (x) x.click(); }
      toast('Postingan dihapus.');
      if (S.tab === 'profile') loadProfile(profState.id, true);
      if (feedEl && !feedEl.children.length) showFeedEmpty();
    });
  }

  /* ---------- komentar + balasan ---------- */
  function openComments(p) {
    var bg = el('<div class="sg-sheet-bg" role="dialog" aria-modal="true" aria-label="Komentar"><div class="sg-sheet" style="height:82dvh">' +
      '<div class="sg-sheet-h"><h3>KOMENTAR</h3><button type="button" class="sg-x" data-x aria-label="Tutup"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="sg-sheet-b" data-list style="flex:1"></div>' +
      '<div class="sg-replying sg-hide" data-rbar><span></span><button type="button" data-rcancel aria-label="Batal membalas"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="sg-cm-form"><input type="text" data-in maxlength="300" placeholder="Tulis komentar..." autocomplete="off"><button type="button" class="sg-btn" data-send>KIRIM</button></div>' +
    '</div></div>');
    var close = layer(bg);
    var list = bg.querySelector('[data-list]'), input = bg.querySelector('[data-in]'), send = bg.querySelector('[data-send]'), rbar = bg.querySelector('[data-rbar]');
    var before = 0, busy = false, replying = null;

    function setReplying(target, thread) {
      replying = target ? { id: target.id, name: target.user.username, thread: thread } : null;
      rbar.classList.toggle('sg-hide', !replying);
      if (replying) { rbar.querySelector('span').textContent = 'Membalas @' + replying.name; input.placeholder = 'Balas @' + replying.name + '...'; try { input.focus(); } catch (e) {} }
      else input.placeholder = 'Tulis komentar...';
    }
    rbar.querySelector('[data-rcancel]').addEventListener('click', function () { setReplying(null); });

    function checkEmpty() { if (!list.querySelector('.sg-cm')) list.innerHTML = '<p class="sg-empty"><b>SEPI</b>Jadilah yang pertama berkomentar.</p>'; }

    function row(c, t, isReply) {
      var r = el('<div class="sg-cm' + (isReply ? ' sg-cm-reply' : '') + '" data-cid="' + esc(c.id) + '"><img class="sg-av" alt="" src="' + esc(avatarOf(c.user)) + '"><div class="sg-cm-b"><b></b><span></span><small></small>' +
        '<div class="sg-cm-a"><button type="button" data-reply>Balas</button></div></div>' +
        (c.canDelete ? '<button type="button" class="sg-cm-x" aria-label="Hapus komentar"><i class="fa-solid fa-trash"></i></button>' : '') + '</div>');
      r.querySelector('b').textContent = c.user.displayName || c.user.username;
      var sp = r.querySelector('span');
      if (isReply && c.replyTo && c.replyTo.id !== t._uid) { var m = document.createElement('em'); m.className = 'sg-mention'; m.textContent = '@' + c.replyTo.username + ' '; sp.appendChild(m); }
      sp.appendChild(document.createTextNode(c.text));
      r.querySelector('small').textContent = ago(c.createdAt);
      var av = r.querySelector('.sg-av'); av.addEventListener('error', function () { av.src = initialAvatar(c.user.username); }, { once: true });
      r.querySelector('[data-reply]').addEventListener('click', function () { setReplying(c, t); });
      var x = r.querySelector('.sg-cm-x');
      if (x) x.addEventListener('click', function () {
        api('/api/social/comments/' + c.id + '/delete', { method: 'POST' }).then(function (j) {
          if (!j || !j.success) return toast((j && j.message) || 'Gagal menghapus.', true);
          if (isReply) { r.remove(); t._n = Math.max(0, t._n - 1); t._loaded = Math.max(0, t._loaded - 1); paintTog(t); }
          else { if (replying && replying.thread === t) setReplying(null); t.remove(); }
          p.commentCount = j.commentCount; updateCard(p.id); checkEmpty();
        });
      });
      return r;
    }

    function paintTog(t) {
      var n = Math.max(0, t._n);
      t._tog.classList.toggle('sg-hide', n < 1);
      var hidden = t._rep.classList.contains('sg-hide');
      t._tog.textContent = hidden ? 'Lihat ' + fmt(n) + ' balasan' : (t._loaded < n ? 'Lihat balasan lainnya (' + fmt(n - t._loaded) + ')' : 'Sembunyikan balasan');
    }
    function loadReplies(t) {
      if (t._busy) return; t._busy = true; t._tog.disabled = true;
      api('/api/social/comments/' + t._id + '/replies?limit=10' + (t._next ? '&after=' + t._next : '')).then(function (j) {
        t._busy = false; t._tog.disabled = false;
        if (!j || !j.success) { toast('Gagal memuat balasan.', true); paintTog(t); return; }
        j.comments.forEach(function (c) { t._rep.appendChild(row(c, t, true)); });
        t._loaded += j.comments.length; t._next = j.next || t._next;
        if (!j.hasMore) t._n = t._loaded;
        paintTog(t);
      });
    }
    function toggleThread(t) {
      if (t._rep.classList.contains('sg-hide')) { t._rep.classList.remove('sg-hide'); if (!t._loaded) loadReplies(t); else paintTog(t); }
      else if (t._loaded < t._n) loadReplies(t);
      else { t._rep.classList.add('sg-hide'); paintTog(t); }
    }
    function addThread(c) {
      var t = el('<div class="sg-thread"></div>');
      t._id = c.id; t._uid = c.user.id; t._n = c.replyCount || 0; t._loaded = 0; t._next = 0; t._busy = false;
      t.appendChild(row(c, t, false));
      t._rep = el('<div class="sg-replies sg-hide"></div>'); t._tog = el('<button type="button" class="sg-rtog sg-hide"></button>');
      t.appendChild(t._rep); t.appendChild(t._tog);
      t._tog.addEventListener('click', function () { toggleThread(t); });
      paintTog(t);
      return t;
    }

    function load(prepend) {
      if (busy) return; busy = true;
      api('/api/social/posts/' + p.id + '/comments?limit=30' + (before ? '&before=' + before : '')).then(function (j) {
        busy = false;
        if (!j || !j.success) { if (!prepend) list.innerHTML = '<p class="sg-empty">Gagal memuat komentar.</p>'; return; }
        var oldMore = list.querySelector('[data-oldmore]'); if (oldMore) oldMore.parentNode.remove();
        var empty = list.querySelector('.sg-empty'); if (empty) empty.remove();
        var first = list.firstChild;
        j.comments.forEach(function (c) { list.insertBefore(addThread(c), first); });
        before = j.next || before;
        if (j.hasMore) { var b = el('<div class="sg-more-wrap"><button type="button" class="sg-btn alt" data-oldmore>Komentar sebelumnya</button></div>'); b.querySelector('button').addEventListener('click', function () { load(true); }); list.insertBefore(b, list.firstChild); }
        if (!prepend) list.scrollTop = list.scrollHeight;
        checkEmpty();
      });
    }
    function submit() {
      var text = input.value.trim(); if (!text || send.disabled) return;
      send.disabled = true;
      var target = replying;
      api('/api/social/posts/' + p.id + '/comments', { method: 'POST', json: { text: text, parentId: target ? target.id : '' } }).then(function (j) {
        send.disabled = false;
        if (!j || !j.success) return toast((j && j.message) || 'Gagal mengirim komentar.', true);
        input.value = ''; p.commentCount = j.commentCount; updateCard(p.id);
        if (target) {
          var t = target.thread; setReplying(null);
          if (!t.isConnected) return toast('Balasan terkirim.');
          if (t._loaded >= t._n) {
            var nr = row(j.comment, t, true); t._rep.appendChild(nr); t._loaded++; t._n++; t._next = j.comment.createdAt;
            t._rep.classList.remove('sg-hide'); paintTog(t); try { nr.scrollIntoView({ block: 'nearest' }); } catch (e) {}
          } else {
            t._n++;
            if (t._rep.classList.contains('sg-hide')) { t._rep.classList.remove('sg-hide'); if (!t._loaded) loadReplies(t); }
            paintTog(t); toast('Balasan terkirim.');
          }
        } else {
          var empty = list.querySelector('.sg-empty'); if (empty) empty.remove();
          list.appendChild(addThread(j.comment)); list.scrollTop = list.scrollHeight;
        }
      });
    }
    send.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    load(false);
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 250);
    return close;
  }

  /* ---------- feed ---------- */
  function showFeedEmpty() {
    feedEl.innerHTML = '<div class="sg-empty"><b>BELUM ADA POSTINGAN</b>Tekan tombol + di bawah untuk jadi yang pertama!</div>';
    moreEl.classList.add('sg-hide');
  }
  var feedSeq = 0;
  function loadFeed(reset) {
    if (S.loading && !reset) return;
    var seq = ++feedSeq; S.loading = true;
    if (reset) { S.next = 0; feedEl.innerHTML = '<div class="sg-skel"></div><div class="sg-skel"></div>'; moreEl.classList.add('sg-hide'); }
    api('/api/social/feed?limit=8' + (S.next && !reset ? '&before=' + S.next : '') + '&_=' + Date.now()).then(function (j) {
      if (seq !== feedSeq) return;   // ada permintaan yang lebih baru, abaikan hasil lama
      S.loading = false;
      if (reset) feedEl.innerHTML = '';
      if (!j || !j.success) {
        if (reset) { feedEl.innerHTML = '<div class="sg-empty"><b>GAGAL MEMUAT</b>' + esc((j && j.message) || 'Coba lagi.') + '<br><br><button type="button" class="sg-btn" data-retry>COBA LAGI</button></div>'; }
        else toast((j && j.message) || 'Gagal memuat.', true);
        return;
      }
      (j.posts || []).forEach(function (p) {
        try { feedEl.appendChild(buildCard(p)); } catch (e) { if (window.console) console.warn('[social] kartu gagal:', e); }
      });
      S.next = j.next; S.hasMore = j.hasMore;
      if (!feedEl.children.length) return showFeedEmpty();
      moreEl.classList.toggle('sg-hide', !S.hasMore);
    }).catch(function () { if (seq === feedSeq) S.loading = false; });
  }

  /* ---------- profil ---------- */
  var profState = { id: 'me' };
  function openProfile(id) { S.tab = 'profile'; profState.id = id === ME.id ? 'me' : id; paintTabs(); showView('profile'); loadProfile(profState.id, true); window.scrollTo(0, 0); }
  function loadProfile(id, showSkel) {
    if (showSkel) profEl.innerHTML = '<div class="sg-skel" style="height:140px"></div>';
    api('/api/social/users/' + encodeURIComponent(id)).then(function (j) {
      if (!j || !j.success) { profEl.innerHTML = '<div class="sg-empty"><b>OOPS</b>' + esc((j && j.message) || 'Profil tidak bisa dimuat.') + '</div>'; return; }
      renderProfile(j);
    });
  }
  function renderProfile(j) {
    var u = j.user, hasSt = !!(j.story && j.story.hasStory);
    profEl.innerHTML = ''; profState.data = j;
    if (u.bannerUrl) {
      var bn = el('<div class="sg-banner"><img alt="" src="' + esc(u.bannerUrl) + '"></div>');
      bn.querySelector('img').addEventListener('error', function () { bn.remove(); }, { once: true });
      profEl.appendChild(bn);
    }
    var head = el('<div class="sg-prof"><button type="button" class="sg-prof-av' + (hasSt ? ' ring' + (j.story.allSeen ? ' seen' : '') : '') + '" data-av aria-label="' + (hasSt ? 'Lihat story' : 'Foto profil') + '"><img alt="" src="' + esc(avatarOf(u)) + '"></button>' +
      '<div class="sg-prof-t"><h2></h2><p data-un></p><p class="rt-status" data-rt-status="' + esc(u.id) + '"></p><p data-bio></p><div class="sg-stats"><div><b>' + fmt(j.stats.posts) + '</b><span>Postingan</span></div><div><b>' + fmt(j.stats.likes) + '</b><span>Like</span></div><div><b>' + fmt(j.stats.reposts || 0) + '</b><span>Repost</span></div></div></div></div>');
    head.querySelector('h2').textContent = u.displayName || u.username;
    head.querySelector('[data-un]').textContent = '@' + u.username + (u.role === 'admin' ? ' · ADMIN' : '');
    var bio = head.querySelector('[data-bio]'); if (u.bio) bio.textContent = u.bio; else bio.remove();
    var img = head.querySelector('img'); img.addEventListener('error', function () { img.src = initialAvatar(u.username); }, { once: true });
    head.querySelector('[data-av]').addEventListener('click', function () {
      if (!hasSt || !window.Story) return;
      api('/api/users/' + u.id + '/stories').then(function (r) { if (r && r.success && r.group && r.group.stories.length) Story.openGroup(r.group, Story.startIndex(r.group)); else toast('Story sudah habis.'); });
    });
    profEl.appendChild(head);
    var act = el('<div class="sg-prof-act"></div>');
    if (j.isSelf) {
      act.appendChild(el('<a class="sg-btn" href="' + esc(CFG.editProfileUrl) + '"><i class="fa-solid fa-pen"></i> Edit Profil</a>'));
      var b = el('<button type="button" class="sg-btn alt"><i class="fa-solid fa-circle-plus"></i> Tambah</button>'); b.addEventListener('click', openAddSheet); act.appendChild(b);
    } else {
      var c = el('<a class="sg-btn" href="/chat/private"><i class="fa-solid fa-comment-dots"></i> Chat</a>'); act.appendChild(c);
    }
    profEl.appendChild(act);
    var tabs = el('<div class="sg-ptabs"><button type="button" data-ptab="posts"><i class="fa-solid fa-table-cells"></i> POSTINGAN</button><button type="button" data-ptab="reposts"><i class="fa-solid fa-retweet"></i> REPOST</button></div>');
    profEl.appendChild(tabs);
    var box = el('<div data-pbox></div>'); profEl.appendChild(box);
    function paintPTab(which) {
      profState.tab = which;
      var bs = tabs.querySelectorAll('[data-ptab]'); for (var k = 0; k < bs.length; k++) bs[k].classList.toggle('on', bs[k].getAttribute('data-ptab') === which);
      box.innerHTML = '';
      var isRp = which === 'reposts', list = isRp ? (j.reposts || []) : j.posts;
      if (!list.length) {
        box.appendChild(el('<div class="sg-empty"><b>' + (isRp ? 'BELUM ADA REPOST' : 'BELUM ADA POSTINGAN') + '</b>' + (isRp
          ? (j.isSelf ? 'Tekan ikon repost di postingan orang lain untuk menampilkannya di profilmu.' : 'User ini belum me-repost apa pun.')
          : (j.isSelf ? 'Bagikan foto pertamamu lewat tombol + di bawah.' : 'User ini belum memposting apa pun.')) + '</div>'));
        return;
      }
      var grid = el('<div class="sg-grid"></div>');
      list.forEach(function (t) {
        var b2 = document.createElement('button'); b2.type = 'button'; b2.className = 'sg-tile'; b2.setAttribute('aria-label', 'Buka postingan');
        if (t.cover) {
          if (t.cover.kind === 'video') { var v = document.createElement('video'); v.src = t.cover.url + '#t=0.1'; v.muted = true; v.playsInline = true; v.preload = 'metadata'; b2.appendChild(v); }
          else { var im = document.createElement('img'); im.src = t.cover.url; im.alt = ''; im.loading = 'lazy'; b2.appendChild(im); }
        }
        var bd = '';
        if (isRp) bd = '<i class="fa-solid fa-retweet"></i>'; else if (t.count > 1) bd = '<i class="fa-solid fa-clone"></i>'; else if (t.cover && t.cover.kind === 'video') bd = '<i class="fa-solid fa-play"></i>';
        if (bd) { var s2 = document.createElement('span'); s2.className = 'sg-tile-badge'; s2.innerHTML = bd; b2.appendChild(s2); }
        var st = document.createElement('span'); st.className = 'sg-tile-st'; st.textContent = isRp ? '@' + t.by : '♥ ' + fmt(t.likeCount) + '  💬 ' + fmt(t.commentCount); b2.appendChild(st);
        b2.addEventListener('click', function () { openPostModal(t.id); });
        grid.appendChild(b2);
      });
      box.appendChild(grid);
    }
    tabs.addEventListener('click', function (e) { var b = e.target.closest('[data-ptab]'); if (b) paintPTab(b.getAttribute('data-ptab')); });
    paintPTab(profState.keepTab === j.user.id && profState.tab ? profState.tab : 'posts');
    profState.keepTab = j.user.id;
  }

  /* ---------- modal postingan tunggal ---------- */
  function openPostModal(id) {
    var bg = el('<div class="sg-modal" role="dialog" aria-modal="true"><div class="sg-modal-in"><div class="sg-modal-top"><button type="button" class="sg-x" data-x aria-label="Tutup"><i class="fa-solid fa-xmark"></i></button></div><div data-body><div class="sg-skel"></div></div></div></div>');
    var close = layer(bg);
    api('/api/social/posts/' + id).then(function (j) {
      var body = bg.querySelector('[data-body]');
      if (!j || !j.success) { body.innerHTML = '<div class="sg-empty"><b>OOPS</b>' + esc((j && j.message) || 'Postingan tidak ditemukan.') + '</div>'; return; }
      body.innerHTML = ''; body.appendChild(buildCard(j.post));
    });
    return close;
  }

  /* ---------- tambah: pilihan Postingan / Story ---------- */
  function openAddSheet() {
    var bg = el('<div class="sg-sheet-bg" role="dialog" aria-modal="true" aria-label="Tambah"><div class="sg-sheet">' +
      '<div class="sg-sheet-h"><h3>TAMBAH APA NIH?</h3><button type="button" class="sg-x" data-x aria-label="Tutup"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="sg-sheet-b" style="padding-bottom:calc(20px + env(safe-area-inset-bottom,0px))">' +
        '<button type="button" class="sg-choice" data-c="post"><span class="sg-choice-i" style="background:#2563eb"><i class="fa-solid fa-image"></i></span><span><b>POSTINGAN</b><small>Foto / video + keterangan. Tampil di feed, bisa di-like &amp; dikomentari.</small></span></button>' +
        '<button type="button" class="sg-choice" data-c="reel"><span class="sg-choice-i" style="background:#7c3aed"><i class="fa-solid fa-film"></i></span><span><b>REELS</b><small>Khusus video (maks. 50MB). Tampil di tab Reels, scroll ala TikTok.</small></span></button>' +
        '<button type="button" class="sg-choice" data-c="story"><span class="sg-choice-i" style="background:#dc2626"><i class="fa-solid fa-bolt"></i></span><span><b>STORY</b><small>Tulisan berwarna atau foto/video. Hilang otomatis setelah 24 jam.</small></span></button>' +
      '</div></div></div>');
    var close = layer(bg);
    bg.querySelector('[data-c="post"]').addEventListener('click', function () { close(); openPostComposer(); });
    bg.querySelector('[data-c="reel"]').addEventListener('click', function () { close(); openReelComposer(); });
    bg.querySelector('[data-c="story"]').addEventListener('click', function () {
      close();
      if (window.Story && Story.openComposer) Story.openComposer(); else toast('Fitur story belum siap, muat ulang halaman.', true);
    });
  }

  /* ---------- composer postingan ---------- */
  function openPostComposer() {
    var files = [], busy = false;
    var maxN = CFG.maxMedia || 5;
    var bg = el('<div class="sg-sheet-bg" role="dialog" aria-modal="true" aria-label="Buat postingan"><div class="sg-sheet" style="max-height:92dvh">' +
      '<div class="sg-sheet-h"><h3>POSTINGAN BARU</h3><button type="button" class="sg-x" data-x aria-label="Tutup"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="sg-sheet-b">' +
        '<input type="file" class="sg-hide" data-file multiple accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime">' +
        '<button type="button" class="sg-pick" data-pick><i class="fa-solid fa-cloud-arrow-up"></i> PILIH FOTO / VIDEO</button>' +
        '<div class="sg-previews sg-hide" data-prev></div>' +
        '<div class="sg-lbl"><span>Keterangan</span><small><span data-cnt>0</span>/500</small></div>' +
        '<textarea class="sg-ta" data-cap maxlength="500" placeholder="Tulis keterangan..."></textarea>' +
        '<div class="sg-err sg-hide" data-err></div>' +
        '<div class="sg-prog sg-hide" data-prog><i></i></div>' +
        '<div style="display:flex;gap:10px;margin-top:14px"><button type="button" class="sg-btn alt" data-x style="flex:1">BATAL</button><button type="button" class="sg-btn" data-post style="flex:2" disabled>POSTING!</button></div>' +
      '</div></div></div>');
    var close = layer(bg, function () { files.forEach(function (f) { if (f._u) URL.revokeObjectURL(f._u); }); });
    var q = function (s) { return bg.querySelector(s); };
    var inp = q('[data-file]'), prev = q('[data-prev]'), err = q('[data-err]'), btn = q('[data-post]'), cap = q('[data-cap]');
    function setErr(m) { err.textContent = m || ''; err.classList.toggle('sg-hide', !m); }
    function paint() {
      prev.innerHTML = ''; prev.classList.toggle('sg-hide', !files.length);
      files.forEach(function (f, i) {
        var d = el('<div class="sg-pv"></div>');
        var m = /^video\//.test(ftype(f)) ? document.createElement('video') : document.createElement('img');
        if (!f._u) f._u = URL.createObjectURL(f);
        m.src = f._u; if (m.tagName === 'VIDEO') { m.muted = true; m.playsInline = true; } else m.alt = '';
        d.appendChild(m);
        var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Hapus'); x.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        x.addEventListener('click', function () { if (f._u) URL.revokeObjectURL(f._u); files.splice(i, 1); paint(); });
        d.appendChild(x); prev.appendChild(d);
      });
      q('[data-pick]').innerHTML = files.length ? '<i class="fa-solid fa-plus"></i> TAMBAH LAGI (' + files.length + '/' + maxN + ')' : '<i class="fa-solid fa-cloud-arrow-up"></i> PILIH FOTO / VIDEO';
      btn.disabled = busy || !files.length;
    }
    q('[data-pick]').addEventListener('click', function () { if (!busy) inp.click(); });
    inp.addEventListener('change', function () {
      setErr('');
      Array.prototype.forEach.call(inp.files || [], function (f) {
        if (files.length >= maxN) return setErr('Maksimal ' + maxN + ' foto/video per postingan.');
        if (!/^(image\/(png|jpe?g|webp|gif)|video\/(mp4|webm|quicktime))$/i.test(ftype(f))) return setErr('Format ' + (f.name || 'file') + ' tidak didukung.');
        var vid = /^video\//i.test(ftype(f)); if (f.size > (vid ? 50 : 25) * 1024 * 1024) return setErr((f.name || 'File') + ' lebih dari ' + (vid ? 50 : 25) + 'MB.');
        if (vid && files.some(function (x) { return /^video\//.test(ftype(x)); })) return setErr('Maksimal 1 video per postingan.');
        files.push(f);
      });
      inp.value = ''; paint();
    });
    cap.addEventListener('input', function () { q('[data-cnt]').textContent = cap.value.length; });
    btn.addEventListener('click', function () {
      if (busy || !files.length) return;
      busy = true; setErr(''); btn.disabled = true; btn.textContent = 'MENGIRIM...';
      var fd = new FormData(); fd.append('caption', cap.value); files.forEach(function (f) { fd.append('media', f); });
      var prog = q('[data-prog]'), bar = prog.querySelector('i'); prog.classList.remove('sg-hide'); bar.style.width = '0';
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/social/posts'); xhr.withCredentials = true; xhr.setRequestHeader('Accept', 'application/json');
      xhr.timeout = 180000;
      xhr.upload.onprogress = function (e) { if (e.lengthComputable) bar.style.width = Math.round((e.loaded / e.total) * 95) + '%'; };
      function fail(m) { busy = false; btn.textContent = 'POSTING!'; btn.disabled = !files.length; prog.classList.add('sg-hide'); setErr(m); }
      xhr.onerror = function () { fail('Koneksi bermasalah, coba lagi.'); };
      xhr.ontimeout = function () { fail('Upload terlalu lama. Coba file yang lebih kecil.'); };
      xhr.onload = function () {
        var j; try { j = JSON.parse(xhr.responseText); } catch (e) { j = null; }
        if (xhr.status === 401) { window.location.href = '/login'; return; }
        if (!j || !j.success) return fail((j && j.message) || 'Gagal membuat postingan.');
        bar.style.width = '100%'; close();
        toast('Postingan terkirim!');
        S.tab = 'home'; paintTabs(); showView('home'); loadFeed(true);
      };
      xhr.send(fd);
    });
    paint();
  }

  /* ---------- composer REELS (khusus video) ---------- */
  function openReelComposer() {
    var file = null, busy = false, url = '';
    var bg = el('<div class="sg-sheet-bg" role="dialog" aria-modal="true" aria-label="Buat reels"><div class="sg-sheet" style="max-height:92dvh">' +
      '<div class="sg-sheet-h"><h3>REELS BARU</h3><button type="button" class="sg-x" data-x aria-label="Tutup"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="sg-sheet-b">' +
        '<input type="file" class="sg-hide" data-file accept="video/mp4,video/webm,video/quicktime">' +
        '<button type="button" class="sg-pick" data-pick><i class="fa-solid fa-film"></i> PILIH VIDEO</button>' +
        '<div class="sg-reel-prev sg-hide" data-prev></div>' +
        '<div class="sg-lbl"><span>Keterangan</span><small><span data-cnt>0</span>/500</small></div>' +
        '<textarea class="sg-ta" data-cap maxlength="500" placeholder="Tulis keterangan reels..."></textarea>' +
        '<div class="sg-err sg-hide" data-err></div>' +
        '<div class="sg-prog sg-hide" data-prog><i></i></div>' +
        '<div style="display:flex;gap:10px;margin-top:14px"><button type="button" class="sg-btn alt" data-x style="flex:1">BATAL</button><button type="button" class="sg-btn" data-post style="flex:2" disabled>UPLOAD REELS!</button></div>' +
      '</div></div></div>');
    var close = layer(bg, function () { if (url) URL.revokeObjectURL(url); });
    var q = function (s2) { return bg.querySelector(s2); };
    var inp = q('[data-file]'), prev = q('[data-prev]'), err = q('[data-err]'), btn = q('[data-post]'), cap = q('[data-cap]');
    function setErr(m) { err.textContent = m || ''; err.classList.toggle('sg-hide', !m); }
    function paint() {
      prev.innerHTML = ''; prev.classList.toggle('sg-hide', !file);
      if (file) { if (!url) url = URL.createObjectURL(file); var v = document.createElement('video'); v.src = url; v.controls = true; v.muted = true; v.playsInline = true; prev.appendChild(v); }
      q('[data-pick]').innerHTML = file ? '<i class="fa-solid fa-rotate"></i> GANTI VIDEO' : '<i class="fa-solid fa-film"></i> PILIH VIDEO';
      btn.disabled = busy || !file;
    }
    q('[data-pick]').addEventListener('click', function () { if (!busy) inp.click(); });
    inp.addEventListener('change', function () {
      setErr('');
      var f = inp.files && inp.files[0]; inp.value = ''; if (!f) return;
      if (!/^video\/(mp4|webm|quicktime)$/i.test(ftype(f))) return setErr('Reels hanya menerima video MP4 / WEBM / MOV.');
      if (f.size > 50 * 1024 * 1024) return setErr('Ukuran video maksimal 50MB.');
      if (url) { URL.revokeObjectURL(url); url = ''; }
      file = f; paint();
    });
    cap.addEventListener('input', function () { q('[data-cnt]').textContent = cap.value.length; });
    btn.addEventListener('click', function () {
      if (busy || !file) return;
      busy = true; setErr(''); btn.disabled = true; btn.textContent = 'MENGIRIM...';
      var fd = new FormData(); fd.append('caption', cap.value); fd.append('video', file);
      var prog = q('[data-prog]'), bar = prog.querySelector('i'); prog.classList.remove('sg-hide'); bar.style.width = '0';
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/social/reels'); xhr.withCredentials = true; xhr.setRequestHeader('Accept', 'application/json');
      xhr.timeout = 240000;
      xhr.upload.onprogress = function (e) { if (e.lengthComputable) bar.style.width = Math.round((e.loaded / e.total) * 95) + '%'; };
      function fail(m) { busy = false; btn.textContent = 'UPLOAD REELS!'; btn.disabled = !file; prog.classList.add('sg-hide'); setErr(m); }
      xhr.onerror = function () { fail('Koneksi bermasalah, coba lagi.'); };
      xhr.ontimeout = function () { fail('Upload terlalu lama. Coba video yang lebih kecil.'); };
      xhr.onload = function () {
        var j; try { j = JSON.parse(xhr.responseText); } catch (e) { j = null; }
        if (xhr.status === 401) { window.location.href = '/login'; return; }
        if (!j || !j.success) return fail((j && j.message) || 'Gagal membuat reels.');
        bar.style.width = '100%'; close();
        toast('Reels terkirim!');
        S.tab = 'reels'; paintTabs(); showView('reels'); RS.started = true; loadReels(true);
      };
      xhr.send(fd);
    });
    paint();
  }

  /* ---------- REELS: scroll vertikal ala TikTok (khusus video) ---------- */
  var RS = { next: 0, hasMore: false, loading: false, muted: false, started: false, hinted: false };
  var reelIO = null;
  function ensureSrc(v) { if (v && !v.getAttribute('src') && v.getAttribute('data-src')) { v.preload = 'auto'; v.src = v.getAttribute('data-src'); } }
  function currentReel() {
    if (!reelListEl) return null;
    var rs = reelListEl.querySelectorAll('.sg-reel'), h = reelListEl.clientHeight || 1;
    var i = Math.round(reelListEl.scrollTop / h); return rs[i] || rs[0] || null;
  }
  function pauseAllReels() { var vs = document.querySelectorAll('.sg-reel video'); for (var i = 0; i < vs.length; i++) { try { vs[i].pause(); } catch (e) {} } }
  function paintMute() { if (muteBtn) { muteBtn.innerHTML = '<i class="fa-solid ' + (RS.muted ? 'fa-volume-xmark' : 'fa-volume-high') + '"></i>'; muteBtn.setAttribute('aria-label', RS.muted ? 'Nyalakan suara' : 'Matikan suara'); muteBtn.classList.toggle('off', RS.muted); } }
  function applySound(v) { v.volume = 1; v.muted = RS.muted; v.defaultMuted = RS.muted; }
  function setMuted(m) {
    RS.muted = !!m; paintMute();
    var vs = document.querySelectorAll('.sg-reel video'); for (var i = 0; i < vs.length; i++) applySound(vs[i]);
  }
  function playReel(r) {
    var v = r.querySelector('video'); if (!v) return;
    ensureSrc(v); applySound(v);
    var pr = v.play();
    if (pr && pr.catch) pr.catch(function () {
      // browser menolak autoplay bersuara -> putar tanpa suara, minta user ketuk untuk menyalakan
      if (!v.muted) {
        setMuted(true); v.play().catch(function () {});
        if (!RS.hinted) { RS.hinted = true; toast('Ketuk ikon suara di kanan atas untuk menyalakan suara.'); }
      }
    });
    r.classList.remove('paused');
    var nx = r.nextElementSibling; if (nx) ensureSrc(nx.querySelector('video'));
  }
  function mkReelIO() {
    if (reelIO || !('IntersectionObserver' in window)) return;
    reelIO = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        var v = en.target.querySelector('video'); if (!v) return;
        if (en.isIntersecting && en.intersectionRatio >= 0.65) {
          playReel(en.target);
          if (RS.hasMore && !RS.loading && (!en.target.nextElementSibling || !en.target.nextElementSibling.nextElementSibling)) loadReels(false);
        } else { try { v.pause(); } catch (e) {} }
      });
    }, { root: reelListEl, threshold: [0, 0.65, 1] });
  }
  function buildReel(p) {
    p = shared(p);
    var r = el('<article class="sg-reel" data-id="' + esc(p.id) + '">' +
      '<video class="sg-reel-v" loop playsinline webkit-playsinline preload="none" data-src="' + esc(p.video) + '"></video>' +
      '<div class="sg-reel-pause"><i class="fa-solid fa-play"></i></div><div class="sg-reel-heart"><i class="fa-solid fa-heart"></i></div>' +
      '<div class="sg-reel-shade"></div>' +
      '<div class="sg-reel-side">' +
        '<button type="button" class="sg-reel-av" data-user aria-label="Lihat profil"><img alt=""></button>' +
        '<button type="button" class="sg-ra' + (p.liked ? ' liked' : '') + '" data-like aria-label="Like"><i class="fa-solid fa-heart"></i><span data-lc>' + fmt(p.likeCount) + '</span></button>' +
        (CFG.allowComments ? '<button type="button" class="sg-ra" data-cm aria-label="Komentar"><i class="fa-solid fa-comment-dots"></i><span data-cc>' + fmt(p.commentCount) + '</span></button>' : '') +
        '<button type="button" class="sg-ra' + (p.reposted ? ' reposted' : '') + '" data-repost aria-label="Repost"><i class="fa-solid fa-retweet"></i><span data-rc>' + fmt(p.repostCount) + '</span></button>' +
        (CFG.allowShare ? '<button type="button" class="sg-ra" data-share aria-label="Bagikan"><i class="fa-solid fa-paper-plane"></i><span data-sc>' + fmt(p.shareCount) + '</span></button>' : '') +
        ((p.mine || CFG.isAdmin) ? '<button type="button" class="sg-ra" data-del aria-label="Hapus"><i class="fa-solid fa-trash"></i></button>' : '') +
      '</div>' +
      '<div class="sg-reel-info"><button type="button" class="sg-reel-who" data-user><b></b></button><p class="sg-reel-cap"></p><small></small></div>' +
      '<div class="sg-reel-bar"><i></i></div></article>');
    var av = r.querySelector('.sg-reel-av img'); av.src = avatarOf(p.user); av.addEventListener('error', function () { av.src = initialAvatar(p.user.username); }, { once: true });
    r.querySelector('.sg-reel-who b').textContent = '@' + p.user.username + (p.user.role === 'admin' ? ' · ADMIN' : '');
    var cp = r.querySelector('.sg-reel-cap'); if (p.caption) cp.textContent = p.caption; else cp.remove();
    r.querySelector('.sg-reel-info small').textContent = ago(p.createdAt);
    var v = r.querySelector('video'), bar = r.querySelector('.sg-reel-bar i');
    v.addEventListener('loadedmetadata', function () { if (v.videoHeight > v.videoWidth * 1.05) v.classList.add('cover'); });
    v.addEventListener('timeupdate', function () { if (v.duration) bar.style.width = Math.min(100, (v.currentTime / v.duration) * 100) + '%'; });
    v.addEventListener('error', function () { r.classList.add('broken'); }, { once: true });
    var lastTap = 0;
    r.addEventListener('click', function (e) {
      if (e.target.closest('.sg-reel-side, .sg-reel-who')) return;
      var now = Date.now();
      if (now - lastTap < 320) { lastTap = 0; if (!p.liked) toggleLike(p); var h = r.querySelector('.sg-reel-heart'); h.classList.remove('go'); void h.offsetWidth; h.classList.add('go'); return; }
      lastTap = now;
      setTimeout(function () {
        if (lastTap !== now) return;
        if (RS.muted && !v.paused) { setMuted(false); return; } // ketukan pertama saat senyap = nyalakan suara
        if (v.paused) { ensureSrc(v); applySound(v); v.play().catch(function () {}); r.classList.remove('paused'); } else { v.pause(); r.classList.add('paused'); }
      }, 330);
    });
    r.querySelector('[data-like]').addEventListener('click', function () { toggleLike(p); });
    var cm = r.querySelector('[data-cm]'); if (cm) cm.addEventListener('click', function () { openComments(p); });
    r.querySelector('[data-repost]').addEventListener('click', function () { toggleRepost(p); });
    var sh = r.querySelector('[data-share]'); if (sh) sh.addEventListener('click', function () { sharePost(p); });
    var dl = r.querySelector('[data-del]'); if (dl) dl.addEventListener('click', function () { delPost(p, r); });
    var us = r.querySelectorAll('[data-user]'); for (var i = 0; i < us.length; i++) us[i].addEventListener('click', function () { pauseAllReels(); openProfile(p.user.id); });
    return r;
  }
  function loadReels(reset) {
    if (RS.loading) return; RS.loading = true; mkReelIO();
    if (reset) { if (reelIO) reelIO.disconnect(); RS.next = 0; reelListEl.innerHTML = '<div class="sg-reel-msg">Memuat reels...</div>'; }
    api('/api/social/reels?limit=6' + (RS.next && !reset ? '&before=' + RS.next : '')).then(function (j) {
      RS.loading = false;
      if (reset) reelListEl.innerHTML = '';
      if (!j || !j.success) {
        if (reset) reelListEl.innerHTML = '<div class="sg-reel-msg"><b>GAGAL MEMUAT</b>' + esc((j && j.message) || 'Coba lagi.') + '<br><br><button type="button" class="sg-btn" data-rretry>COBA LAGI</button></div>';
        else toast((j && j.message) || 'Gagal memuat reels.', true);
        return;
      }
      j.reels.forEach(function (p) { var r = buildReel(p); reelListEl.appendChild(r); if (reelIO) reelIO.observe(r); });
      RS.next = j.next; RS.hasMore = j.hasMore;
      if (!reelListEl.querySelector('.sg-reel')) {
        if (RS.hasMore) return loadReels(false);
        reelListEl.innerHTML = '<div class="sg-reel-msg"><b>BELUM ADA REELS</b>Tekan tombol + lalu pilih REELS untuk upload video pertamamu.</div>';
      } else if (!reelIO) { playReel(reelListEl.querySelector('.sg-reel')); }
    });
  }

  /* ---------- tab KOMENTAR: komentar & balasan untuk saya ---------- */
  var AS = { tab: 'posts', next: 0, hasMore: false, loading: false };
  function activityItem(it) {
    var b = el('<button type="button" class="sg-ai"><img class="sg-av" alt="" src="' + esc(avatarOf(it.user)) + '"><span class="sg-ai-b"><span class="sg-ai-l"><b></b> <em></em></span><q></q><small></small></span></button>');
    b.querySelector('b').textContent = it.user.displayName || it.user.username;
    var kind = it.isReel ? 'reels' : 'postingan';
    b.querySelector('em').textContent = AS.tab === 'replies' ? 'membalas komentarmu' : (it.parentId ? 'membalas di ' + kind + '-mu' : 'mengomentari ' + kind + '-mu');
    b.querySelector('q').textContent = (it.replyTo && AS.tab !== 'replies' ? '@' + it.replyTo.username + ' ' : '') + it.text;
    b.querySelector('small').textContent = ago(it.createdAt);
    var av = b.querySelector('.sg-av'); av.addEventListener('error', function () { av.src = initialAvatar(it.user.username); }, { once: true });
    if (it.cover) {
      var th = document.createElement('span'); th.className = 'sg-ai-th';
      if (it.cover.kind === 'video') { var v = document.createElement('video'); v.src = it.cover.url + '#t=0.1'; v.muted = true; v.playsInline = true; v.preload = 'metadata'; th.appendChild(v); }
      else { var im = document.createElement('img'); im.src = it.cover.url; im.alt = ''; im.loading = 'lazy'; th.appendChild(im); }
      b.appendChild(th);
    }
    b.addEventListener('click', function () {
      api('/api/social/posts/' + it.postId).then(function (j) {
        if (!j || !j.success) return toast((j && j.message) || 'Postingan sudah tidak ada.', true);
        var p = shared(j.post);
        openComments(p);
      });
    });
    return b;
  }
  function loadActivity(reset) {
    if (AS.loading) return; AS.loading = true;
    if (reset) { AS.next = 0; actListEl.innerHTML = '<div class="sg-skel" style="height:90px"></div><div class="sg-skel" style="height:90px;margin-top:10px"></div>'; actMoreEl.classList.add('sg-hide'); }
    api('/api/social/activity?tab=' + AS.tab + '&limit=20' + (AS.next && !reset ? '&before=' + AS.next : '')).then(function (j) {
      AS.loading = false;
      if (reset) actListEl.innerHTML = '';
      if (!j || !j.success) {
        if (reset) actListEl.innerHTML = '<div class="sg-empty"><b>GAGAL MEMUAT</b>' + esc((j && j.message) || 'Coba lagi.') + '<br><br><button type="button" class="sg-btn" data-aretry>COBA LAGI</button></div>';
        else toast((j && j.message) || 'Gagal memuat.', true);
        return;
      }
      j.items.forEach(function (it) { actListEl.appendChild(activityItem(it)); });
      AS.next = j.next; AS.hasMore = j.hasMore;
      if (!actListEl.children.length) actListEl.innerHTML = '<div class="sg-empty"><b>' + (AS.tab === 'replies' ? 'BELUM ADA BALASAN' : 'BELUM ADA KOMENTAR') + '</b>' + (AS.tab === 'replies' ? 'Balasan orang lain untuk komentarmu akan muncul di sini.' : 'Komentar di postingan & reels-mu akan muncul di sini.') + '</div>';
      actMoreEl.classList.toggle('sg-hide', !AS.hasMore);
    });
  }

  /* ---------- tab / layout ---------- */
  function showView(v) {
    var m = { home: homeEl, reels: reelsEl, activity: actEl, profile: profEl };
    Object.keys(m).forEach(function (k) { m[k].classList.toggle('sg-hide', k !== v); });
    root.setAttribute('data-view', v);
    document.body.classList.toggle('sg-reels-on', v === 'reels');
    if (v !== 'reels') pauseAllReels();
    if (v === 'reels' && window.MediaFocus) MediaFocus.pauseAll(); // suara feed/story jangan bentrok dengan Reels
    if (v === 'reels' && !RS.started) { RS.started = true; loadReels(true); }
    if (v === 'reels' && reelListEl) { var cur = reelListEl.querySelector('.sg-reel'); if (cur && !reelIO) playReel(cur); }
    if (v === 'activity') loadActivity(true);
  }
  function paintTabs() {
    var t = document.querySelectorAll('.sg-tab[data-tab]');
    for (var i = 0; i < t.length; i++) t[i].classList.toggle('on', t[i].getAttribute('data-tab') === S.tab);
  }
  function build() {
    root.innerHTML =
      '<div class="sg-head"><a class="sg-back" href="' + esc(CFG.home) + '" aria-label="Kembali ke dashboard"><i class="fa-solid fa-arrow-left"></i></a>' +
      '<div class="sg-head-t"><h1 class="sg-title"></h1><p class="sg-sub"></p></div><span class="rt-count" style="margin-left:auto"><b data-rt-count>0</b> online</span></div>' +
      '<section data-home><div class="st-bar st-hide" id="sgStoryBar"></div><div class="sg-feed" data-feed></div><div class="sg-more-wrap sg-hide" data-more><button type="button" class="sg-btn alt" data-loadmore>MUAT LAGI</button></div></section>' +
      '<section class="sg-hide" data-prof></section>' +
      '<section class="sg-hide sg-reels-wrap" data-reels><div class="sg-reels-head"><button type="button" class="sg-reels-btn" data-rback aria-label="Kembali ke Home"><i class="fa-solid fa-arrow-left"></i></button><h2>REELS</h2><button type="button" class="sg-reels-btn" data-mute aria-label="Suara"></button></div><div class="sg-reels" data-rl></div></section>' +
      '<section class="sg-hide" data-act><div class="sg-ac-head"><h2>KOMENTAR</h2><p>Komentar &amp; balasan untukmu</p></div>' +
        '<div class="sg-atabs"><button type="button" class="on" data-atab="posts"><i class="fa-solid fa-comments"></i> DI POSTINGANKU</button><button type="button" data-atab="replies"><i class="fa-solid fa-reply"></i> BALASAN</button></div>' +
        '<div data-alist></div><div class="sg-more-wrap sg-hide" data-amore><button type="button" class="sg-btn alt">MUAT LAGI</button></div></section>';
    root.querySelector('.sg-title').textContent = CFG.title || 'Social';
    var sub = root.querySelector('.sg-sub'); if (CFG.subtitle) sub.textContent = CFG.subtitle; else sub.remove();
    homeEl = root.querySelector('[data-home]'); profEl = root.querySelector('[data-prof]');
    reelsEl = root.querySelector('[data-reels]'); reelListEl = root.querySelector('[data-rl]'); muteBtn = root.querySelector('[data-mute]');
    document.body.appendChild(reelsEl); // pindah ke <body>: <main> punya animasi transform yang membuat position:fixed tidak full-layar
    actEl = root.querySelector('[data-act]'); actListEl = root.querySelector('[data-alist]'); actMoreEl = root.querySelector('[data-amore]');
    feedEl = root.querySelector('[data-feed]'); moreEl = root.querySelector('[data-more]');
    moreEl.querySelector('button').addEventListener('click', function () { loadFeed(false); });
    feedEl.addEventListener('click', function (e) { if (e.target.closest('[data-retry]')) loadFeed(true); });
    // infinite scroll (bonus; tombol "Muat lagi" tetap ada sebagai cadangan)
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) { if (en[0].isIntersecting && S.hasMore && !S.loading && S.tab === 'home') loadFeed(false); }, { rootMargin: '400px' });
      io.observe(moreEl);
    }
    // reels: tombol kembali, suara, coba lagi
    paintMute();
    muteBtn.addEventListener('click', function () {
      setMuted(!RS.muted);
      var cur = currentReel(); if (cur) { var cv = cur.querySelector('video'); if (cv && cv.paused && !cur.classList.contains('paused')) cv.play().catch(function () {}); }
    });
    // pindah tab / kunci layar -> hentikan suara; kembali -> lanjut
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pauseAllReels();
      else if (S.tab === 'reels' && !openLayers) { var c = currentReel(); if (c && !c.classList.contains('paused')) playReel(c); }
    });
    reelsEl.querySelector('[data-rback]').addEventListener('click', function () { S.tab = 'home'; paintTabs(); showView('home'); window.scrollTo(0, 0); });
    reelListEl.addEventListener('click', function (e) { if (e.target.closest('[data-rretry]')) loadReels(true); });
    // tab komentar: 2 sub-header
    var atabs = actEl.querySelector('.sg-atabs');
    atabs.addEventListener('click', function (e) {
      var b = e.target.closest('[data-atab]'); if (!b || b.getAttribute('data-atab') === AS.tab) return;
      AS.tab = b.getAttribute('data-atab');
      var bs = atabs.querySelectorAll('[data-atab]'); for (var k = 0; k < bs.length; k++) bs[k].classList.toggle('on', bs[k] === b);
      loadActivity(true);
    });
    actMoreEl.querySelector('button').addEventListener('click', function () { loadActivity(false); });
    actListEl.addEventListener('click', function (e) { if (e.target.closest('[data-aretry]')) loadActivity(true); });
    if (window.Story && Story.mountBar) { try { Story.mountBar(document.getElementById('sgStoryBar')); } catch (e) { /* story opsional */ } }

    var bar = el('<nav class="sg-bar" aria-label="Navigasi ' + esc(CFG.title || 'Social') + '"><div class="sg-bar-in">' +
      '<button type="button" class="sg-tab on" data-tab="home"><i class="fa-solid fa-house"></i>HOME</button>' +
      '<button type="button" class="sg-tab" data-tab="reels"><i class="fa-solid fa-clapperboard"></i>REELS</button>' +
      '<button type="button" class="sg-add" data-add aria-label="Tambah postingan, reels atau story"><i class="fa-solid fa-plus"></i></button>' +
      '<button type="button" class="sg-tab" data-tab="activity"><i class="fa-solid fa-comments"></i>KOMENTAR</button>' +
      '<button type="button" class="sg-tab" data-tab="profile"><i class="fa-solid fa-user"></i>PROFIL</button>' +
    '</div></nav>');
    document.body.appendChild(bar);
    bar.querySelector('[data-add]').addEventListener('click', openAddSheet);
    bar.querySelector('[data-tab="home"]').addEventListener('click', function () {
      if (S.tab === 'home') { window.scrollTo({ top: 0, behavior: 'smooth' }); loadFeed(true); if (window.Story && Story.refresh) Story.refresh(); return; }
      S.tab = 'home'; paintTabs(); showView('home'); window.scrollTo(0, 0);
    });
    bar.querySelector('[data-tab="reels"]').addEventListener('click', function () {
      if (S.tab === 'reels') { RS.started = true; loadReels(true); return; }
      S.tab = 'reels'; paintTabs(); showView('reels');
    });
    bar.querySelector('[data-tab="activity"]').addEventListener('click', function () {
      if (S.tab === 'activity') { loadActivity(true); return; }
      S.tab = 'activity'; paintTabs(); showView('activity'); window.scrollTo(0, 0);
    });
    bar.querySelector('[data-tab="profile"]').addEventListener('click', function () { openProfile('me'); });
  }

  build();
  loadFeed(true);
  if (CFG.focusPost) openPostModal(CFG.focusPost);
})();
