'use strict';
const crypto = require('node:crypto');
const SERVICES = [
  ['nokos','Nokos / Nomor OTP',['/nokos','/api/nokos']],
  ['gacha','Gacha Nokos',['/gacha-nokos','/api/gacha-nokos']],
  ['fixno','Fix No & Sender',['/fix-no','/api/fix-no']],
  ['panel','Panel Pterodactyl',['/panel','/api/pterodactyl']],
  ['premium','Aplikasi Premium',['/premium','/api/premium']],
  ['sosmed','Sosmed / SMM',['/sosmed','/api/sosmed']],
  ['produk','Produk Digital',['/produk','/api/produk']],
  ['reseller','Reseller & Kelola Panel',['/reseller','/api/panel']],
  ['adminpanel','Pembelian Admin Panel',['/admin-panel']],
  ['paket','Paket Akun',['/paket','/paket-saya']],
  ['deposit','Deposit, Top Up & Buat QRIS',['/deposit','/invoice','/merchant/topup','/api/invoice']],
  ['withdraw','Penarikan Manual & Instan',['/withdraw','/api/withdraw']],
  ['transfer','Transfer Saldo',['/transfer','/api/transfer']],
  ['social','Sosial, Postingan & Reels',['/social','/lib','/api/social']],
  ['chat','Chat Pengguna',['/chat']],
  ['ai','Asisten AI',['/ai','/api/ai','/api/ai-bubble']],
  ['game','Game Store',['/game-store','/api/game-store']],
  ['tools','Tools',['/tools']],
  ['voucher','Voucher Publik',['/voucher','/api/vouchers']]
].map(([id,name,paths])=>({id,name,paths}));
const DEFAULT_MESSAGE = 'Kami sedang melakukan perawatan agar layanan kembali lancar. Silakan coba lagi beberapa saat lagi.';
const match = (path, prefix) => path === prefix || path.startsWith(prefix + '/');
function cleanPath(value) { try { return decodeURIComponent(String(value).split('?')[0]).toLowerCase(); } catch (_) { return '/'; } }
const isDocsJson = path => /^\/docs\.json\/?$/.test(cleanPath(path));
const isDocumentation = path => match(cleanPath(path), '/docs') || isDocsJson(path);
function config(settings) {
  const m = settings && settings.maintenance || {};
  return {enabled:m.enabled === true, mode:m.mode === 'services'?'services':'website', title:String(m.title || 'Server Lagi Maintenance').slice(0,120), message:String(m.message || DEFAULT_MESSAGE).slice(0,2000), services:Array.from(m.services || []).filter(s=>SERVICES.some(x=>x.id===s.id)).map(s=>({id:s.id,message:String(s.message||'').slice(0,1000)}))};
}
function decision(settings, user, path) {
  if (user?.role === 'admin') return null;
  const m = config(settings); if (!m.enabled) return null;
  // Documentation is public: apply maintenance even without a login session.
  if (isDocumentation(path)) return {...m,scope:'Dokumentasi API'};
  if (!user) return null;
  if (m.mode === 'website') return {...m,scope:'Seluruh Website'};
  const service = SERVICES.find(s=>s.paths.some(p=>match(cleanPath(path),p)));
  const selected = service && m.services.find(s=>s.id===service.id);
  return selected ? {...m,scope:service.name,message:selected.message||m.message} : null;
}
function addSchema(schema, mongoose) {
  schema.add({maintenance:{type:new mongoose.Schema({enabled:{type:Boolean,default:false},mode:{type:String,enum:['website','services'],default:'website'},title:{type:String,default:'Server Lagi Maintenance'},message:{type:String,default:DEFAULT_MESSAGE},services:[new mongoose.Schema({id:String,message:String},{_id:false})]},{_id:false}),default:()=>({})}});
}
function exempt(path) {
  return ['/login','/logout','/register','/forgot-password','/reset-password','/webhook','/callback','/payment'].some(p=>match(cleanPath(path),p));
}
function respond(req,res,state,settings) {
  res.set('Cache-Control','no-store'); res.set('Retry-After','300'); res.status(503);
  if (isDocsJson(req.path) || req.path.startsWith('/api/') || req.xhr || !String(req.headers.accept||'').includes('text/html')) return res.json({success:false,error:state.message,code:'MAINTENANCE',maintenance:{title:state.title,scope:state.scope,mode:state.mode}});
  return res.render('maintenance',{settings,maintenance:state,retryPath:req.method==='GET'&&req.path.startsWith('/')&&!req.path.startsWith('//')?req.path:'/dashboard',preview:false});
}
function create({getSettings,getUser,Setting}) {
  async function gate(req,res,next) {
    if ((!req.session?.userId && !isDocumentation(req.path)) || exempt(req.path)) return next();
    try {
      const settings = await getSettings(); if (!config(settings).enabled) return next();
      const user = req.session?.userId ? await getUser(req.session.userId) : null;
      const state = decision(settings,user,req.path);
      if (state) return respond(req,res,state,settings);
      return next();
    } catch(e) { return res.status(503).json({success:false,error:'Status layanan belum bisa diperiksa. Coba lagi.',code:'MAINTENANCE_CHECK_FAILED'}); }
  }
  async function apiGate(req,res,next) {
    try {
      const settings=await getSettings(); if (!config(settings).enabled) return next();
      const state=decision(settings,await getUser(req.apiUser),req.path);
      if(state)return respond(req,res,state,settings);
      return next();
    }catch(e){return res.status(503).json({success:false,error:'Status layanan belum bisa diperiksa. Coba lagi.',code:'MAINTENANCE_CHECK_FAILED'});}
  }
  function mount(app,guards) {
    const admin=async(req,res,next)=>{try{const user=await getUser(req.session.userId);if(user?.role==='admin')return next();return res.status(403).send('Hanya admin website.');}catch(e){return res.status(503).send('Tidak dapat memeriksa akun admin.');}};
    app.get('/admin/maintenance',...guards,admin,async(req,res,next)=>{try{
      req.session.maintenanceCsrf ||= crypto.randomBytes(24).toString('hex');
      res.set('Cache-Control','no-store');
      res.render('admin_maintenance',{maintenance:config(await getSettings()),maintenanceServices:SERVICES,maintenanceCsrf:req.session.maintenanceCsrf});
    }catch(e){next(e);}});
    app.post('/admin/maintenance',...guards,admin,async(req,res,next)=>{try{
      if(typeof req.body.csrf!=='string'||!req.session.maintenanceCsrf||req.body.csrf!==req.session.maintenanceCsrf)return res.status(403).send('Sesi formulir habis. Muat ulang Pengaturan Maintenance.');
      const ids=Array.isArray(req.body.services)?req.body.services:req.body.services?[req.body.services]:[];
      const mode=req.body.mode;
      if(!['website','services'].includes(mode)||ids.some(id=>typeof id!=='string'||!SERVICES.some(s=>s.id===id)))return res.status(400).send('Pilihan maintenance tidak valid.');
      const text=(value,max,fallback)=>typeof value==='string'?value.trim().slice(0,max)||fallback:fallback;
      const m={enabled:req.body.enabled==='on',mode,title:text(req.body.title,120,'Server Lagi Maintenance'),message:text(req.body.message,2000,DEFAULT_MESSAGE),services:[...new Set(ids)].map(id=>({id,message:text(req.body['reason_'+id],1000,'')}))};
      if(m.enabled&&mode==='services'&&!m.services.length)return res.status(400).send('Pilih minimal satu layanan atau matikan maintenance.');
      const settings=await getSettings();
      await Setting.updateOne({_id:settings._id},{$set:{maintenance:m}});
      req.session.successMsg='Pengaturan maintenance berhasil disimpan.';
      res.redirect('/admin/maintenance');
    }catch(e){next(e);}});
    app.get('/admin/maintenance/preview',...guards,admin,async(req,res,next)=>{try{
      const settings=await getSettings(),m=config(settings),s=SERVICES.find(s=>s.id===req.query.service),selected=s&&m.services.find(x=>x.id===s.id);
      res.set('Cache-Control','no-store');res.render('maintenance',{settings,maintenance:{...m,scope:s?s.name:'Seluruh Website',message:selected?.message||m.message},retryPath:'/admin/maintenance',preview:true});
    }catch(e){next(e);}});
  }
  return {gate,apiGate,mount};
}
module.exports={SERVICES,DEFAULT_MESSAGE,config,decision,addSchema,create,exempt};
