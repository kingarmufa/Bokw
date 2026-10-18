/* Shared preset catalogue: required by Node and loaded directly by browsers. */
(function (global) {
  'use strict';
  const templates = [
    { id: 'default', name: 'KOMIK DEFAULT', subtitle: 'Original comic energy',
      description: 'Hijau, kuning, hitam, dan putih. Ledakan POW!, BAM!, dan ZAP! melayang.',
      icon: 'burst', themeColor: 'yellow', particle: 'pow',
      palette: { black: '#171717', white: '#ffffff', yellow: '#edc531', green: '#2ecc40' },
      background: '#edc531', foreground: '#171717', dot: '#d7ae22', shadow: '#171717' },
    { id: 'halloween', name: 'KOMIK X HALLOWEEN', subtitle: 'Spooky comic night',
      description: 'Malam ungu gelap dan jingga labu. Kelelawar terbang, hantu, dan labu melayang.',
      icon: 'ghost', themeColor: 'black', particle: 'halloween',
      palette: { black: '#201428', white: '#fff5e8', yellow: '#ffab42', green: '#c9b6ff' },
      background: '#180d22', foreground: '#fff5e8', dot: '#42264f', shadow: '#a5672e' },
    { id: 'lebaran', name: 'KOMIK TEMA LEBARAN', subtitle: 'Hijau penuh keberkahan',
      description: 'Hijau zamrud, mint, dan putih suci. Ketupat, bulan sabit, dan lentera bergerak lembut.',
      icon: 'ketupat', themeColor: 'green', particle: 'lebaran',
      palette: { black: '#073d2c', white: '#f5fff7', yellow: '#a8efb7', green: '#48cf92' },
      background: '#0c754e', foreground: '#f5fff7', dot: '#239561', shadow: '#053723' },
    { id: 'imlek', name: 'KOMIK TEMA IMLEK', subtitle: 'Merah meriah, penuh berkah',
      description: 'Merah perayaan dengan aksen emas. Lampion bergoyang, angpau, dan kilau emas melayang.',
      icon: 'lantern', themeColor: 'yellow', particle: 'imlek',
      palette: { black: '#48121b', white: '#fff7e8', yellow: '#ffd56a', green: '#ffb8aa' },
      background: '#ad102b', foreground: '#fff7e8', dot: '#d74650', shadow: '#6c0618' },
    { id: 'cosmic', name: 'KOMIK COSMIC', subtitle: 'Petualangan komik luar angkasa',
      description: 'Navy gelap, cyan elektrik, dan ungu. Planet bercincin, roket, dan orbit melayang di latar website.',
      icon: 'planet', themeColor: 'black', particle: 'cosmic',
      palette: { black: '#16112f', white: '#f5f3ff', yellow: '#73e8ff', green: '#c5a0ff' },
      background: '#130f29', foreground: '#f5f3ff', dot: '#30244e', shadow: '#6945ad' },
    { id: 'sakura', name: 'KOMIK SAKURA', subtitle: 'Bunga mekar, cerita baru',
      description: 'Pink sakura, rose, dan kertas putih. Kelopak berjatuhan, bunga berputar, dan kilau komik lembut.',
      icon: 'flower', themeColor: 'white', particle: 'sakura',
      palette: { black: '#451e39', white: '#fff8fc', yellow: '#ffb6d6', green: '#e3caff' },
      background: '#f8dce9', foreground: '#451e39', dot: '#e8aac9', shadow: '#9b527b' },
    { id: 'ocean', name: 'KOMIK OCEAN', subtitle: 'Selami petualangan biru',
      description: 'Biru laut, turquoise, dan putih buih. Ikan berenang, gelembung naik, dan bintang laut berputar.',
      icon: 'wave', themeColor: 'black', particle: 'ocean',
      palette: { black: '#083848', white: '#f1fdff', yellow: '#8be8f2', green: '#a9efca' },
      background: '#07586d', foreground: '#f1fdff', dot: '#167e90', shadow: '#043748' },
    { id: 'neon', name: 'KOMIK X NEON', subtitle: 'Electric city, comic attitude',
      description: 'Malam graphite, cyan elektrik, dan pink neon. Petir menyala dan garis laser melintas seperti panel komik futuristik.',
      icon: 'neon', themeColor: 'black', particle: 'neon',
      palette: { black: '#171329', white: '#f8f5ff', yellow: '#77f4ee', green: '#ffa0dc' },
      background: '#111222', foreground: '#f8f5ff', dot: '#343052', shadow: '#554587' },
    { id: 'arcade', name: 'KOMIK X ARCADE', subtitle: 'Press play, level up!',
      description: 'Ungu game, lime, dan lavender. Gamepad dan blok pixel bergerak bertangga seperti permainan retro modern.',
      icon: 'arcade', themeColor: 'black', particle: 'arcade',
      palette: { black: '#251236', white: '#fbf8ff', yellow: '#dbfa74', green: '#c9b2ff' },
      background: '#2b1552', foreground: '#fbf8ff', dot: '#533b7c', shadow: '#745b9c' },
    { id: 'graffiti', name: 'KOMIK X GRAFFITI', subtitle: 'Street art meets digital',
      description: 'Kertas krem, coral, dan hijau acid. Stiker komik berputar dan tetesan cat jatuh dengan nuansa streetwear.',
      icon: 'graffiti', themeColor: 'white', particle: 'graffiti',
      palette: { black: '#261e20', white: '#fff8ec', yellow: '#ffa18a', green: '#d0ef75' },
      background: '#f1e9d8', foreground: '#261e20', dot: '#d7c6af', shadow: '#807264' },
    { id: 'mecha', name: 'KOMIK X MECHA', subtitle: 'Precision with a punch',
      description: 'Biru baja dengan aksen amber dan ice blue. Roda gigi berputar dan panel heksagon bergerak di atas pola sirkuit.',
      icon: 'mecha', themeColor: 'black', particle: 'mecha',
      palette: { black: '#162638', white: '#f4f9ff', yellow: '#ffd18a', green: '#9edcfa' },
      background: '#142638', foreground: '#f4f9ff', dot: '#365269', shadow: '#4b718e' },
    { id: 'aurora', name: 'KOMIK X AURORA', subtitle: 'Soft glow, bold outline',
      description: 'Hijau malam, mint, dan lilac. Pita cahaya bergelombang dan prisma mengambang untuk komik modern yang lembut.',
      icon: 'aurora', themeColor: 'black', particle: 'aurora',
      palette: { black: '#14332f', white: '#f4fffc', yellow: '#b4f4dc', green: '#e1c6ff' },
      background: '#102c2b', foreground: '#f4fffc', dot: '#2b5651', shadow: '#49756b' }

  ];
  templates.forEach(t => { Object.freeze(t.palette); Object.freeze(t); });
  Object.freeze(templates);
  const ids = Object.freeze(templates.map(t => t.id));
  function get(value) { return templates.find(t => t.id === value) || templates[0]; }
  function normalize(settings) {
    const t = get(settings && settings.themeTemplate);
    return { themeTemplate: t.id, themeColor: t.themeColor, bgStyle: 'comic',
      bgParticle: t.particle, accentColor: t.palette.yellow, bgSolidColor: t.background };
  }
  function css() {
    return templates.map(t => 'html[data-template="' + t.id + '"]{' + Object.entries({
      '--cm-ink': t.palette.black, '--cm-white': t.palette.white, '--cm-yellow': t.palette.yellow,
      '--cm-green': t.palette.green, '--cm-mint': t.palette.yellow, '--cm-bg': t.background,
      '--cm-dot': t.dot, '--cm-shadow': t.shadow, '--cm-body-fg': t.foreground,
      '--cm-body-edge': t.id === 'default' ? t.palette.black : t.palette.yellow,
      '--cm-fg': t.foreground, '--cm-edge': t.palette.black,
      '--gl-ink': t.palette.black, '--gl-tint': t.palette.yellow + '33',
      '--gl-line': t.palette.black + '66', '--gl-card-a': t.palette.white + 'f5',
      '--gl-card-b': t.palette.white + 'eb', '--gl-shadow': '0 26px 60px -14px ' + t.shadow + '66'
    }).map(([k, v]) => k + ':' + v).join(';') + '}').join('\n');
  }
  const api = Object.freeze({ templates, ids, get, normalize, css });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ComicTemplates = api;
})(typeof window !== 'undefined' ? window : globalThis);
