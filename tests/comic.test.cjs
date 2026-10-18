const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeComicSettings,PALETTE}=require('../lib/comic-settings');
const {decorateComicHtml}=require('../lib/comic-render');
const {mapColor}=require('../public/comic-palette');
test('twelve templates own their colours and effects; old records fall back safely',()=>{
 const {TEMPLATES}=require('../lib/comic-settings');
 assert.equal(TEMPLATES.length,12);
 for(const t of TEMPLATES){
  const value=normalizeComicSettings({themeTemplate:t.id,themeColor:'white',bgParticle:'none',bgStyle:'photo'});
  assert.equal(value.themeTemplate,t.id);assert.equal(value.bgParticle,t.particle);
  assert.equal(value.accentColor,t.palette.yellow);assert.equal(value.bgSolidColor,t.background);
 }
 for(const input of [null,{}, {themeColor:'green',bgParticle:'galaxy'}, {themeTemplate:'<script>'}, {themeTemplate:['imlek']}, {themeTemplate:'__proto__'}]){
  assert.equal(normalizeComicSettings(input).themeTemplate,'default');
 }
});
test('nested surface colors have high contrast pairings',()=>{
 function luminance(hex){const a=hex.match(/\w\w/g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722;}
 for(const bg of Object.values(PALETTE)) {const fg=bg===PALETTE.black?PALETTE.white:PALETTE.black,a=luminance(bg.slice(1)),b=luminance(fg.slice(1));assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5);}
});
test('solid palette covers named, arbitrary, slash-opacity and inline paints',()=>{
 for(const color of ['#2563eb','#dc2626','#f0fdf4','#25d366','rgba(34,197,94,.12)','#ffffff90','red','orange','rgb(0 0 0 / 30%)'])assert.ok(Object.values(PALETTE).includes(mapColor(color)),color);
 assert.equal(mapColor('rgba(0,0,0,0)'),null);
 assert.equal(mapColor('#22c55e'),PALETTE.green);assert.equal(mapColor('#25d366'),PALETTE.green);assert.equal(mapColor('#facc15'),PALETTE.yellow);
});
test('all HTML entrypoints get one shared theme, without changing forms',()=>{
 const source='<html data-theme="red"><head><script src="https://cdn.tailwindcss.com"></script><link rel="stylesheet" href="/comic-theme.css"><script src="/comic-fx.js" defer></script></head><body><form method="POST" action="/login"></form></body></html>';
 const result=decorateComicHtml(source,{themeTemplate:'halloween'});
 assert.match(result,/data-theme="black"/);assert.match(result,/data-particle="halloween"/);assert.equal((result.match(/comic-theme\.css/g)||[]).length,1);
 assert.match(result,/comic-palette\.js/);assert.match(result,/method="POST" action="\/login"/);assert.doesNotMatch(result,/cdn\.tailwindcss/);
});

test('new standalone EJS pages receive utilities without a CDN tag',()=>{
 const html=decorateComicHtml('<html><head><title>New</title></head><body>New page</body></html>',{});
 assert.match(html,/comic-utilities\.css/);assert.match(html,/comic-theme\.css/);
});

test('every page loads the contrast guard once and AI bubble surfaces own their foreground',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const html=decorateComicHtml('<html><head><script src="/comic-contrast.js"></script></head><body></body></html>',{});
 assert.equal((html.match(/comic-contrast\.js/g)||[]).length,1);
 const css=fs.readFileSync(path.join(__dirname,'../public/comic-theme.css'),'utf8');
 assert.match(css,/\.aib-popup-header\{[^}]*--cm-fg:var\(--cm-white\)/);
 assert.match(css,/\.aib-popup-header\.aib-frame-comic\{[^}]*--cm-fg:var\(--cm-ink\)/);
});


test('every template preserves readable panel and background colour pairs',()=>{
 const {TEMPLATES}=require('../lib/comic-settings');
 function lum(hex){const a=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722;}
 function contrast(a,b){a=lum(a);b=lum(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
 for(const t of TEMPLATES){
  for(const bg of [t.palette.white,t.palette.yellow,t.palette.green]) assert.ok(contrast(bg,t.palette.black)>=4.5,t.id+' panel');
  assert.ok(contrast(t.background,t.foreground)>=4.5,t.id+' body');
 }
});
test('renderer is idempotent and template assets are local',()=>{
 const source='<html><head></head><body><form method="POST" action="/admin/settings"></form></body></html>';
 const settings={themeTemplate:'imlek'};
 const html=decorateComicHtml(decorateComicHtml(source,settings),settings);
 for(const asset of ['comic-templates.js','comic-templates.css','comic-palette.js','comic-fx.js','comic-contrast.js']) assert.equal(html.split(asset).length-1,1,asset);
 assert.equal((html.match(/id="cmTemplateTokens"/g)||[]).length,1);
 assert.match(html, /data-template="imlek"/);
 assert.doesNotMatch(decorateComicHtml(source,{themeTemplate:'"><script>alert(1)</script>'}),/alert\(1\)/);
});
test('seasonal auth and game store keep their forms and dedicated styles',()=>{
 for(const body of ['data-auth="login"','data-game-store="true"']){
  const html=decorateComicHtml('<html><head><link href="/game-store.css" rel="stylesheet"></head><body '+body+'><form action="/login" method="POST"><input name="password" type="password"></form></body></html>',{themeTemplate:'lebaran'});
  assert.match(html,/data-template="lebaran"/);assert.match(html,/comic-fx\.js/);
  assert.doesNotMatch(html,/comic-palette\.js|comic-theme\.css/);
  assert.match(html,/input name="password" type="password"/);
 }
});

test('admin save handler persists each preset in the real settings schema',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),mongoose=require('mongoose');
 const {TEMPLATES,TEMPLATE_IDS,PARTICLES}=require('../lib/comic-settings');
 const aiCore=require('../lib/ai-core'),seoLib=require('../lib/seo');
 const source=fs.readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8');
 const schemaStart=source.indexOf('const settingSchema = new mongoose.Schema(');
 const schemaEnd=source.indexOf("const Setting = mongoose.model('Setting', settingSchema);",schemaStart);
 const schema=new Function('mongoose','PALETTE','TEMPLATE_IDS','PARTICLES','aiCore','seoLib',source.slice(schemaStart,schemaEnd)+'\nreturn settingSchema;')(mongoose,PALETTE,TEMPLATE_IDS,PARTICLES,aiCore,seoLib);
 const Model=mongoose.models.ComicSettingsTest||mongoose.model('ComicSettingsTest',schema);
 let saved=new Model({}),handler,writes=0;
 const routeStart=source.indexOf("app.post('/admin/settings', isAuth, isAdmin,");
 const routeEnd=source.indexOf('\n// ================== AI ASSISTANT',routeStart);
 vm.runInNewContext(source.slice(routeStart,routeEnd),{
  app:{post(path,...functions){assert.equal(path,'/admin/settings');handler=functions.at(-1)}},isAuth(){},isAdmin(){},
  normalizeComicSettings,cleanInstantWithdrawMethods:items=>items,aiCore,botManager:null,startChecker(){},console,
  Setting:{async updateOne(query,values){saved.set(values);await saved.validate();writes++},async findOne(){return saved}}
 });
 for(const t of TEMPLATES){
  const req={body:{themeTemplate:t.id,name:'Averpay'},session:{}};
  let redirect;
  await handler(req,{locals:{settings:saved},redirect:path=>{redirect=path}});
  assert.equal(req.session.errorMsg,undefined);assert.equal(redirect,'/admin/settings');
  assert.equal(saved.themeTemplate,t.id);assert.equal(saved.bgParticle,t.particle);assert.ok(req.session.successMsg);
  const html=decorateComicHtml('<html><head></head><body></body></html>',saved);
  assert.ok(html.includes('data-template="'+t.id+'"'));
 }
 assert.equal(writes,12);
 // Saving unrelated settings without a radio field retains the current template.
 await handler({body:{name:'Averpay'},session:{}},{locals:{settings:saved},redirect(){}});
 assert.equal(saved.themeTemplate,'aurora');
 // Only the twelve allowlisted presets can reach MongoDB or rendered attributes.
 await handler({body:{themeTemplate:'__proto__'},session:{}},{locals:{settings:saved},redirect(){}});
 assert.equal(saved.themeTemplate,'default');
});
