/* Decorative only: one canvas, no input capture, capped DPR / 30fps. */
(() => {
  'use strict';
  if (window.__comicFX) return;
  window.__comicFX = true;
  const root = document.documentElement;
  const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  let canvas, ctx, raf = 0, last = 0, width = 0, height = 0, particles = [], mode, palette, background;
  function stop() {
    cancelAnimationFrame(raf); raf = 0; last = 0;
    if (canvas) canvas.remove();
    canvas = ctx = null;
  }
  function make(initial, index) {
    const kinds = mode === 'halloween' ? ['bat', 'ghost', 'pumpkin'] : mode === 'lebaran' ? ['ketupat', 'crescent', 'lantern'] : mode === 'imlek' ? ['lantern', 'angpau', 'sparkle'] : mode === 'cosmic' ? ['planet', 'rocket', 'orbit'] : mode === 'sakura' ? ['petal', 'flower', 'sparkle'] : mode === 'ocean' ? ['fish', 'bubble', 'starfish'] : mode === 'neon' ? ['bolt', 'laser'] : mode === 'arcade' ? ['gamepad', 'pixel'] : mode === 'graffiti' ? ['sticker', 'drip'] : mode === 'mecha' ? ['gear', 'hex'] : mode === 'aurora' ? ['ribbon', 'prism'] : ['pow'];
    const kind = kinds[index % kinds.length];
    return { kind, x: (kind === 'bat' || kind === 'fish' || kind === 'laser') && !initial ? -70 : Math.random() * width,
      y: initial || kind === 'bat' || kind === 'fish' || kind === 'laser' ? Math.random() * height : (kind === 'petal' || kind === 'flower' || kind === 'drip' ? -65 : height + 65),
      size: 14 + Math.random() * 10, speed: 12 + Math.random() * 13,
      phase: Math.random() * Math.PI * 2, word: ['POW!', 'BAM!', 'ZAP!'][index % 3] };
  }
  function resize() {
    if (!canvas || !ctx) return;
    width = Math.max(1, innerWidth); height = Math.max(1, innerHeight);
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    particles = Array.from({ length: width < 640 ? (mode === 'pow' ? 5 : 9) : (mode === 'pow' ? 9 : 17) }, (_, i) => make(true, i));
  }
  function polygon(points) {
    ctx.beginPath(); points.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p[0], p[1])); ctx.closePath();
  }
  function star(radius, tips) {
    const points = [];
    for (let i = 0; i < tips * 2; i++) {
      const r = i % 2 ? radius * .48 : radius, a = i * Math.PI / tips;
      points.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    polygon(points);
  }
  function disk(x, y, r, color) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  }
  function ghost(s) {
    ctx.fillStyle = palette.white;
    ctx.beginPath(); ctx.moveTo(-s * .7, s);
    ctx.lineTo(-s * .7, 0); ctx.bezierCurveTo(-s * .7, -s * 1.35, s * .7, -s * 1.35, s * .7, 0);
    ctx.lineTo(s * .7, s); ctx.lineTo(s * .35, s * .7); ctx.lineTo(0, s); ctx.lineTo(-s * .35, s * .7); ctx.closePath(); ctx.fill(); ctx.stroke();
    disk(-s * .25, -s * .1, s * .12, palette.black); disk(s * .25, -s * .1, s * .12, palette.black);
    disk(0, s * .32, s * .12, palette.black);
  }
  function bat(s, phase) {
    const flap = Math.sin(phase * 4) * s * .4;
    ctx.fillStyle = palette.green;
    polygon([[-s * 1.7, -.8 * s + flap], [-s * .4, -.3 * s], [-s * .2, -.6 * s], [0, -.3 * s], [s * .2, -.6 * s], [s * .4, -.3 * s], [s * 1.7, -.8 * s + flap], [s * 1.3, s * .2], [s * .85, 0], [s * .5, s * .45], [0, s * .55], [-s * .5, s * .45], [-s * .85, 0], [-s * 1.3, s * .2]]);
    ctx.fill(); ctx.stroke(); disk(-s * .1, 0, s * .055, palette.black); disk(s * .1, 0, s * .055, palette.black);
  }
  function pumpkin(s) {
    ctx.fillStyle = palette.yellow; ctx.beginPath(); ctx.ellipse(0, 0, s, s * .8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, s * .45, s * .8, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = palette.green; ctx.fillRect(-3, -s - 4, 6, 9);
    ctx.fillStyle = palette.black;
    polygon([[-s * .65, 0], [-s * .4, -s * .3], [-s * .15, 0]]); ctx.fill();
    polygon([[s * .65, 0], [s * .4, -s * .3], [s * .15, 0]]); ctx.fill();
    polygon([[-s * .5, s * .2], [0, s * .35], [s * .5, s * .2], [s * .3, s * .55], [-s * .3, s * .55]]); ctx.fill();
  }
  function ketupat(s) {
    ctx.fillStyle = palette.green; polygon([[0, -s], [s, 0], [0, s], [-s, 0]]); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.clip(); ctx.strokeStyle = palette.yellow; ctx.lineWidth = 3;
    for (let n = -2; n <= 2; n++) { ctx.beginPath(); ctx.moveTo(n * s * .4, -s); ctx.lineTo(n * s * .4, s); ctx.moveTo(-s, n * s * .4); ctx.lineTo(s, n * s * .4); ctx.stroke(); }
    ctx.restore(); ctx.strokeStyle = palette.yellow;
    ctx.beginPath(); ctx.moveTo(-s * .2, s * .85); ctx.quadraticCurveTo(-s * .5, s * 1.5, -s * .2, s * 1.65);
    ctx.moveTo(s * .2, s * .85); ctx.lineTo(s * .4, s * 1.6); ctx.stroke();
  }
  function crescent(s) {
    ctx.fillStyle = palette.yellow; ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.fill();
    disk(s * .4, -s * .2, s * .85, background);
    ctx.save(); ctx.translate(s * .5, -s * .5); star(s * .23, 4); ctx.fillStyle = palette.white; ctx.fill(); ctx.restore();
  }
  function lantern(s, phase) {
    ctx.rotate(Math.sin(phase) * .16);
    ctx.strokeStyle = palette.yellow; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -s * 1.7); ctx.lineTo(0, -s); ctx.stroke();
    ctx.fillStyle = mode === 'imlek' ? '#e33743' : palette.green;
    ctx.beginPath(); ctx.ellipse(0, 0, s * .75, s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, s * .35, s, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = palette.yellow; ctx.fillRect(-s * .45, -s, s * .9, 5); ctx.fillRect(-s * .45, s - 3, s * .9, 5);
    ctx.beginPath(); ctx.moveTo(0, s); ctx.lineTo(0, s * 1.5); ctx.moveTo(-3, s * 1.35); ctx.lineTo(-3, s * 1.65); ctx.moveTo(3, s * 1.35); ctx.lineTo(3, s * 1.65); ctx.stroke();
  }
  function angpau(s) {
    ctx.fillStyle = '#e33743'; ctx.strokeStyle = palette.yellow;
    ctx.fillRect(-s * .62, -s, s * 1.24, s * 1.8); ctx.strokeRect(-s * .62, -s, s * 1.24, s * 1.8);
    ctx.beginPath(); ctx.moveTo(-s * .62, -s); ctx.lineTo(0, -s * .4); ctx.lineTo(s * .62, -s); ctx.stroke();
    disk(0, s * .08, s * .31, palette.yellow);
    ctx.fillStyle = '#e33743'; ctx.fillRect(-s * .09, -s * .01, s * .18, s * .18);
  }
  function planet(s, phase) {
    ctx.rotate(-.35 + Math.sin(phase) * .12);
    disk(0, 0, s * .72, palette.green);
    ctx.strokeStyle = palette.black; ctx.stroke();
    ctx.strokeStyle = palette.yellow; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, 0, s * 1.4, s * .36, 0, 0, Math.PI * 2); ctx.stroke();
    disk(-s * .18, -s * .28, s * .13, palette.white);
  }
  function rocket(s, phase) {
    ctx.rotate(.35);
    ctx.fillStyle = palette.yellow;
    polygon([[-s * .23, s * .65], [0, s * (1.3 + Math.sin(phase * 8) * .2)], [s * .23, s * .65]]); ctx.fill();
    ctx.fillStyle = palette.green;
    polygon([[-s * .3, s * .1], [-s * .75, s * .8], [s * .75, s * .8], [s * .3, s * .1]]); ctx.fill(); ctx.stroke();
    ctx.fillStyle = palette.white;
    ctx.beginPath(); ctx.moveTo(0, -s);
    ctx.bezierCurveTo(s * .8, -s * .35, s * .4, s * .6, s * .3, s * .7);
    ctx.lineTo(-s * .3, s * .7); ctx.bezierCurveTo(-s * .4, s * .6, -s * .8, -s * .35, 0, -s);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    disk(0, -s * .08, s * .22, palette.yellow); ctx.stroke();
  }
  function orbit(s, phase) {
    ctx.rotate(phase * .4); ctx.strokeStyle = palette.green;
    ctx.beginPath(); ctx.ellipse(0, 0, s, s * .45, -.5, 0, Math.PI * 2); ctx.stroke();
    disk(Math.cos(phase) * s, Math.sin(phase) * s * .45, s * .18, palette.yellow);
    disk(0, 0, s * .22, palette.white);
  }
  function flower(s, phase) {
    ctx.rotate(phase * .25);
    ctx.fillStyle = palette.yellow;
    for (let n = 0; n < 5; n++) {
      ctx.save(); ctx.rotate(n * Math.PI * 2 / 5);
      ctx.beginPath(); ctx.ellipse(0, -s * .5, s * .37, s * .57, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    disk(0, 0, s * .24, palette.white); ctx.stroke();
  }
  function petal(s, phase) {
    ctx.rotate(phase * .6); ctx.fillStyle = palette.yellow;
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.bezierCurveTo(s, -s * .2, s, s * .65, 0, s);
    ctx.bezierCurveTo(-s, s * .65, -s, -s * .2, 0, -s); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, s * .65); ctx.lineTo(0, -s * .2); ctx.stroke();
  }
  function fish(s, phase) {
    ctx.fillStyle = palette.green;
    polygon([[-s * .7, 0], [-s * (1.3 + Math.sin(phase * 4) * .12), -s * .6], [-s * 1.3, s * .6]]); ctx.fill(); ctx.stroke();
    ctx.fillStyle = palette.yellow; ctx.beginPath(); ctx.ellipse(0, 0, s, s * .62, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    disk(s * .4, -s * .1, s * .1, palette.black);
    ctx.beginPath(); ctx.moveTo(-s * .15, -s * .4); ctx.quadraticCurveTo(s * .15, 0, -s * .15, s * .4); ctx.stroke();
  }
  function modern(kind, s, phase) {
    if (kind === 'bolt') {
      ctx.rotate(Math.sin(phase) * .25); ctx.fillStyle = palette.yellow;
      polygon([[s * .2,-s],[-s * .7,s * .1],[-s * .05,s * .1],[-s * .3,s],[s * .75,-s * .25],[s * .12,-s * .25]]); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = palette.green; ctx.beginPath(); ctx.moveTo(-s,-s*.3); ctx.lineTo(-s*1.25,-s*.55); ctx.moveTo(s*.7,s*.55); ctx.lineTo(s,s*.8); ctx.stroke();
    } else if (kind === 'laser') {
      ctx.strokeStyle = palette.yellow; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-s * 2,0); ctx.lineTo(s,0); ctx.stroke();
      ctx.strokeStyle = palette.green; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-s * 1.3,s*.3); ctx.lineTo(s*.5,s*.3); ctx.stroke();
      disk(s,0,4,palette.white);
    } else if (kind === 'gamepad') {
      ctx.rotate(Math.sin(phase)*.12); ctx.fillStyle = palette.green;
      polygon([[-s*.75,-s*.45],[s*.75,-s*.45],[s,s*.55],[s*.55,s*.65],[s*.25,s*.15],[-s*.25,s*.15],[-s*.55,s*.65],[-s,s*.55]]); ctx.fill(); ctx.stroke();
      ctx.fillStyle = palette.black; ctx.fillRect(-s*.6,-s*.2,s*.35,s*.1); ctx.fillRect(-s*.47,-s*.32,s*.1,s*.35);
      disk(s*.45,-s*.18,s*.1,palette.yellow); disk(s*.63,s*.04,s*.1,palette.white);
    } else if (kind === 'pixel') {
      const u=s*.45; ctx.fillStyle=palette.yellow;
      [[-1,-1],[0,-1],[0,0],[1,0]].forEach(([x,y])=>{ctx.fillRect(x*u,y*u,u,u);ctx.strokeRect(x*u,y*u,u,u);});
    } else if (kind === 'sticker') {
      ctx.rotate(Math.sin(phase)*.35); ctx.fillStyle=palette.green;
      ctx.beginPath();ctx.ellipse(0,0,s*1.4,s*.85,0,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle=palette.black;ctx.font=`bold ${s*.65}px Bangers,Impact,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('FRESH',0,0);
    } else if (kind === 'drip') {
      ctx.fillStyle=palette.yellow;ctx.beginPath();ctx.moveTo(0,-s);ctx.bezierCurveTo(s*.2,-s*.5,s*.8,s*.1,s*.65,s*.55);ctx.bezierCurveTo(s*.35,s*1.15,-s*.65,s*.9,-s*.65,s*.35);ctx.bezierCurveTo(-s*.6,-s*.2,-s*.12,-s*.55,0,-s);ctx.fill();ctx.stroke();
      disk(-s*.2,s*.25,s*.12,palette.white);
    } else if (kind === 'gear') {
      ctx.rotate(phase*.3);const points=[];
      for(let n=0;n<48;n++){const r=n%4<2?s:s*.78,a=n*Math.PI/24;points.push([Math.cos(a)*r,Math.sin(a)*r]);}
      polygon(points);ctx.fillStyle=palette.yellow;ctx.fill();ctx.stroke();disk(0,0,s*.38,palette.black);disk(0,0,s*.18,palette.green);
    } else if (kind === 'hex') {
      ctx.rotate(-phase*.17);polygon(Array.from({length:6},(_,n)=>[Math.cos(n*Math.PI/3)*s,Math.sin(n*Math.PI/3)*s]));ctx.fillStyle=palette.green;ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.moveTo(-s*.4,0);ctx.lineTo(s*.4,0);ctx.moveTo(0,-s*.4);ctx.lineTo(0,s*.4);ctx.stroke();
    } else if (kind === 'ribbon') {
      ctx.rotate(Math.sin(phase*.5)*.25);
      [palette.green,palette.yellow].forEach((color,i)=>{ctx.strokeStyle=color;ctx.lineWidth=5-i;ctx.beginPath();ctx.moveTo(-s*1.6,i*7);ctx.bezierCurveTo(-s*.4,-s*Math.sin(phase)-s+i*7,s*.4,s*Math.cos(phase)+i*7,s*1.6,-s*.4+i*7);ctx.stroke();});
    } else if (kind === 'prism') {
      ctx.rotate(phase*.18);ctx.fillStyle=palette.green;polygon([[0,-s],[s*.65,0],[0,s],[-s*.65,0]]);ctx.fill();ctx.stroke();
      ctx.fillStyle=palette.yellow;polygon([[0,-s],[s*.65,0],[0,s]]);ctx.fill();ctx.stroke();
    }
  }
  function draw(time) {
    if (!ctx) return;
    raf = requestAnimationFrame(draw);
    if (time - last < 33) return;
    const dt = last ? Math.min((time - last) / 1000, .065) : 0; last = time;
    ctx.clearRect(0, 0, width, height);
    particles.forEach((p, i) => {
      p.phase += dt;
      if (p.kind === 'petal' || p.kind === 'flower' || p.kind === 'drip') { p.y += p.speed * dt; p.x += Math.sin(p.phase) * 15 * dt; }
      else if (p.kind === 'laser') p.x += p.speed * 3 * dt;
      else if (p.kind === 'bat' || p.kind === 'fish') p.x += p.speed * 2 * dt;
      else if (p.kind === 'rocket') { p.y -= p.speed * 1.8 * dt; p.x += p.speed * .65 * dt; }
      else { p.y -= p.speed * dt; p.x += Math.sin(p.phase) * 5 * dt; }
      if (p.y < -85 || p.y > height + 85 || p.x > width + 85) { particles[i] = make(false, i); return; }
      ctx.save(); ctx.translate(mode === 'arcade' ? Math.round(p.x / 5) * 5 : p.x, mode === 'arcade' ? Math.round(p.y / 5) * 5 : p.y + Math.sin(p.phase) * 7); ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.strokeStyle = palette.black; ctx.fillStyle = i % 2 ? palette.green : palette.white;
      if (['bolt','laser','gamepad','pixel','sticker','drip','gear','hex','ribbon','prism'].includes(p.kind)) modern(p.kind, p.size, p.phase);
      else if (p.kind === 'pow') {
        ctx.rotate(Math.sin(p.phase) * .13); star(p.size * 1.65, 9); ctx.fill(); ctx.stroke();
        ctx.fillStyle = palette.black; ctx.font = `${p.size}px Bangers,Impact,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.word, 0, 0);
      } else if (p.kind === 'petal') petal(p.size * .7, p.phase);
      else if (p.kind === 'flower') flower(p.size, p.phase);
      else if (p.kind === 'fish') fish(p.size, p.phase);
      else if (p.kind === 'bubble') {
        ctx.strokeStyle = palette.yellow; ctx.beginPath(); ctx.arc(0, 0, p.size * .7, 0, Math.PI * 2); ctx.stroke();
        disk(-p.size * .25, -p.size * .27, p.size * .12, palette.white);
      } else if (p.kind === 'starfish') {
        ctx.rotate(p.phase * .2); star(p.size, 5); ctx.fillStyle = palette.green; ctx.fill(); ctx.stroke();
        disk(-p.size * .17, -p.size * .08, 1.5, palette.black); disk(p.size * .17, -p.size * .08, 1.5, palette.black);
      } else if (p.kind === 'planet') planet(p.size, p.phase);
      else if (p.kind === 'rocket') rocket(p.size, p.phase);
      else if (p.kind === 'orbit') orbit(p.size, p.phase);
      else if (p.kind === 'ghost') ghost(p.size);
      else if (p.kind === 'bat') bat(p.size, p.phase);
      else if (p.kind === 'pumpkin') { ctx.rotate(Math.sin(p.phase) * .12); pumpkin(p.size); }
      else if (p.kind === 'ketupat') { ctx.rotate(Math.sin(p.phase) * .13); ketupat(p.size); }
      else if (p.kind === 'crescent') crescent(p.size);
      else if (p.kind === 'lantern') lantern(p.size, p.phase);
      else if (p.kind === 'angpau') { ctx.rotate(Math.sin(p.phase) * .25); angpau(p.size); }
      else { ctx.rotate(p.phase * .2); ctx.globalAlpha = .55 + .4 * Math.sin(p.phase) ** 2; star(p.size * .55, 4); ctx.fillStyle = palette.yellow; ctx.fill(); }
      ctx.restore();
    });
  }
  function start() {
    stop();
    const t = window.ComicTemplates && window.ComicTemplates.get(root.dataset.template);
    mode = t ? t.particle : root.dataset.particle || 'pow';
    palette = t ? t.palette : { black:'#171717', white:'#ffffff', yellow:'#edc531', green:'#2ecc40' };
    background = t ? t.background : '#edc531';
    if (reduce.matches || document.hidden || !document.body || !['pow', 'halloween', 'lebaran', 'imlek', 'cosmic', 'sakura', 'ocean', 'neon', 'arcade', 'graffiti', 'mecha', 'aurora'].includes(mode)) return;
    if (document.body.hasAttribute('data-auth') && (!t || t.id === 'default')) return;
    canvas = document.createElement('canvas'); canvas.id = 'cmFx'; canvas.dataset.template = t ? t.id : 'default'; canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
    try { ctx = canvas.getContext('2d'); } catch (_) { stop(); return; }
    if (!ctx) { stop(); return; }
    resize(); raf = requestAnimationFrame(draw);
  }
  addEventListener('resize', resize, { passive: true });
  addEventListener('comic:change', start); addEventListener('pagehide', stop); addEventListener('pageshow', start);
  if (reduce.addEventListener) reduce.addEventListener('change', start); else if (reduce.addListener) reduce.addListener(start);
  document.addEventListener('visibilitychange', start);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
