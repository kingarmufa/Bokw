'use strict';
const { serverless } = require('./vercel-runtime');
const mongoose = require('mongoose');
const multer = require('multer');
const crypto = require('crypto');
const { Schema } = mongoose;
const Category = mongoose.model('GameCategory', new Schema({ name: String, description: String, image: String }, { timestamps: true }));
const Listing = mongoose.model('GameListing', new Schema({ owner: { type: Schema.Types.ObjectId, ref: 'User', index: true }, seller: String, category: { type: Schema.Types.ObjectId, ref: 'GameCategory', index: true }, name: String, gameId: String, description: String, price: Number, photos: [String], contact: String, channel: String }, { timestamps: true }));
const Comment = mongoose.model('GameComment', new Schema({ listing: { type: Schema.Types.ObjectId, index: true }, owner: Schema.Types.ObjectId, author: String, text: String, parent: { type: Schema.Types.ObjectId, default: null } }, { timestamps: true }));
const Config = mongoose.model('GameStoreConfig', new Schema({ key: { type: String, unique: true }, mediator: { type: String, default: '' } }));
const validId = x => /^[a-f0-9]{24}$/i.test(String(x || ''));
function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
function field(x, label, max, optional = false) { if (typeof x !== 'string' || !x.trim()) { if (optional) return ''; fail(label + ' wajib diisi.'); } x = x.trim(); if (x.length > max) fail(label + ' terlalu panjang.'); return x; }
function contact(channel, raw) {
  let x = field(raw, 'Kontak', 150);
  if (channel === 'wa') { x = x.replace(/^(https?:\/\/)?wa\.me\//i, '').replace(/[\s()+-]/g, ''); if (x.startsWith('0')) x = '62' + x.slice(1); if (!/^[1-9]\d{7,14}$/.test(x)) fail('Nomor WhatsApp tidak valid. Gunakan kode negara, contoh 628123456789.'); return 'https://wa.me/' + x; }
  if (channel === 'telegram') { x = x.replace(/^(https?:\/\/)?t\.me\//i, '').replace(/^@/, ''); if (!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(x)) fail('Username Telegram tidak valid (5–32 karakter).'); return 'https://t.me/' + x; }
  fail('Pilih WhatsApp atau Telegram.');
}
function mediator(raw) { const x = field(raw, 'Kontak admin penengah', 500, true); if (!x) return ''; if (/^[+\d\s()-]+$/.test(x) || /^(https?:\/\/)?wa\.me\//i.test(x)) return contact('wa', x); if (/^(https?:\/\/)?t\.me\//i.test(x)) return contact('telegram', x); try { const u = new URL(x); if (u.protocol === 'https:' && !u.username && !u.password) return u.href; } catch {} fail('Isi nomor WhatsApp, t.me/username, atau URL HTTPS admin.'); }
function imageType(b) { if (b.length > 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return ['.jpg', 'image/jpeg']; if (b.length > 8 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return ['.png','image/png']; if (b.length > 12 && b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP') return ['.webp','image/webp']; fail('Foto harus berupa file JPG, PNG, atau WebP asli.'); }
function install({ app, isAuth, isAdmin, social, getSettings }) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: serverless ? Math.floor(3.8*1024*1024) : 5*1024*1024, files: 10, fields: 15, fieldSize: 12000 } });
  const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
  const token = (req,res,next) => { if (!req.session.gameCsrf) req.session.gameCsrf = crypto.randomBytes(32).toString('hex'); res.locals.gameCsrf = req.session.gameCsrf; next(); };
  const csrf = (req,res,next) => { if (!req.session.gameCsrf || req.body._csrf !== req.session.gameCsrf) return res.status(403).send('Sesi formulir kedaluwarsa. Muat ulang halaman.'); next(); };
  // Verify before reading multipart bytes; query contains only a random CSRF token, never a credential.
  const multipartCsrf = (req,res,next) => { if (!req.session.gameCsrf || req.query.csrf !== req.session.gameCsrf) return res.status(403).send('Sesi formulir kedaluwarsa. Muat ulang halaman.'); next(); };
  const uploadGate = require('express-rate-limit').rateLimit({ windowMs: 60000, limit: 6, standardHeaders: true, legacyHeaders: false, message: 'Terlalu banyak upload. Coba lagi satu menit.' });
  app.use(['/game-store','/admin/game-store'], token);
  const cleanup = async urls => { for (const url of urls) { try { await social.removeMedia(url); } catch {} } };
  async function photos(files, min, max, owner) {
    if (!files || files.length < min || files.length > max) fail(`Wajib upload ${min === max ? min : min + '–' + max} foto.`);
    const types = files.map(f => imageType(f.buffer));
    const urls = [];
    try { for (let i=0; i<files.length; i++) { const r = await social.pool.upload(files[i].buffer, { folder: 'game-store', ownerId: owner, ext: types[i][0], contentType: types[i][1], remoteOnly: true, provider: 'github' }); if (!r.ok) fail('Upload GitHub gagal. Periksa penyimpanan GitHub di Admin Avergram, lalu coba lagi.', 503); urls.push(r.url); } return urls; } catch(e) { await cleanup(urls); throw e; }
  }
  const config = async () => await Config.findOne({key:'main'}).lean() || {mediator:''};
  const render = async (req,res,extra={}) => res.render('game_store', { tab:'home', categories:await Category.find().sort({name:1}).lean(), cfg:await config(), listings:[], listing:null, comments:[], page:1, hasMore:false, filter:'', query:'', sort:'newest', total:0, ...extra });
  app.get('/game-store', wrap(async(req,res) => {
    const query = String(req.query.q || '').slice(0,80); const filter = validId(req.query.category) ? req.query.category : '';
    const where = {}; if(filter) where.category=filter; if(query) where.name = { $regex: query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), $options:'i' };
    const page = Math.max(1,Math.min(10000,parseInt(req.query.page,10)||1));
    const sort = ['price_asc','price_desc'].includes(req.query.sort) ? req.query.sort : 'newest';
    const order = sort==='price_asc' ? {price:1,_id:-1} : sort==='price_desc' ? {price:-1,_id:-1} : {createdAt:-1,_id:-1};
    const [rows,total] = await Promise.all([Listing.find(where).sort(order).skip((page-1)*24).limit(25).lean(), Listing.countDocuments(where)]);
    await render(req,res,{listings:rows.slice(0,24),hasMore:rows.length>24,page,filter,query,sort,total});
  }));
  app.get('/game-store/new', isAuth, wrap((req,res) => render(req,res,{tab:'new'})));
  app.get('/game-store/mine', isAuth, wrap(async(req,res) => { const page=Math.max(1,parseInt(req.query.page,10)||1); const rows=await Listing.find({owner:req.session.userId}).sort({createdAt:-1}).skip((page-1)*24).limit(25).lean(); const total=await Listing.countDocuments({owner:req.session.userId}); return render(req,res,{tab:'mine',listings:rows.slice(0,24),page,hasMore:rows.length>24,total}); }));
  app.post('/game-store/new', isAuth, multipartCsrf, uploadGate, upload.array('photos',10), wrap(async(req,res) => {
    const b=req.body, name=field(b.name,'Nama akun',120), description=field(b.description,'Deskripsi',5000), gameId=field(b.gameId,'ID game',100,true), link=contact(b.channel,b.contact);
    const price=Number(b.price); if(!/^\d+$/.test(String(b.price)) || !Number.isSafeInteger(price) || price<1 || price>100000000000) fail('Harga harus berupa rupiah bulat antara 1 dan 100 miliar.');
    if(!validId(b.category) || !await Category.exists({_id:b.category})) fail('Pilih kategori game yang tersedia.');
    const urls=await photos(req.files,2,10,req.session.userId);
    let item; try { item=await Listing.create({owner:req.session.userId,seller:res.locals.user?.username || 'User',category:b.category,name,description,gameId,price,photos:urls,contact:link,channel:b.channel}); } catch(e) { await cleanup(urls); throw e; }
    res.redirect('/game-store/item/'+item._id);
  }));
  app.get('/game-store/item/:id', wrap(async(req,res) => { if(!validId(req.params.id)) fail('Postingan tidak ditemukan.',404); const listing=await Listing.findById(req.params.id).lean(); if(!listing) fail('Postingan tidak ditemukan.',404); const comments=await Comment.find({listing:listing._id}).sort({createdAt:1}).limit(500).lean(); await render(req,res,{tab:'detail',listing,comments}); }));
  app.post('/game-store/item/:id/delete', isAuth, csrf, wrap(async(req,res) => { if(!validId(req.params.id)) fail('Postingan tidak ditemukan.',404); const item=await Listing.findOneAndDelete({_id:req.params.id,owner:req.session.userId}); if(!item) fail('Hanya pemilik yang dapat menghapus postingan.',403); await Comment.deleteMany({listing:item._id}); await cleanup(item.photos); res.redirect('/game-store/mine'); }));
  const commentGate = require('express-rate-limit').rateLimit({windowMs:60000,limit:20,standardHeaders:true,legacyHeaders:false});
  app.post('/game-store/item/:id/comments', isAuth, csrf, commentGate, wrap(async(req,res) => { if(!validId(req.params.id) || !await Listing.exists({_id:req.params.id})) fail('Postingan tidak ditemukan.',404); const text=field(req.body.text,'Komentar',1000); let parent=null; if(req.body.parent) { if(!validId(req.body.parent) || !await Comment.exists({_id:req.body.parent,listing:req.params.id,parent:null})) fail('Komentar tujuan tidak ditemukan.'); parent=req.body.parent; } await Comment.create({listing:req.params.id,owner:req.session.userId,author:res.locals.user?.username || 'User',text,parent}); res.redirect('/game-store/item/'+req.params.id+'#comments'); }));
  app.get('/admin/game-store', isAuth, isAdmin, wrap(async(req,res) => res.render('admin_game_store',{cfg:await config(),categories:await Category.find().sort({name:1}).lean()})));
  app.post('/admin/game-store/settings', isAuth, isAdmin, csrf, wrap(async(req,res) => { const name=field(req.body.name,'Nama aplikasi',60), link=mediator(req.body.mediator); const s=await getSettings(); s.name=name; await s.save(); await Config.findOneAndUpdate({key:'main'},{$set:{mediator:link}},{upsert:true}); req.session.successMsg='Pengaturan store berhasil disimpan.'; res.redirect('/admin/game-store'); }));
  app.post('/admin/game-store/categories', isAuth, isAdmin, multipartCsrf, uploadGate, upload.array('photos',1), wrap(async(req,res) => { const name=field(req.body.name,'Nama game',80),description=field(req.body.description,'Deskripsi game',1000); const urls=await photos(req.files,1,1,req.session.userId); try { await Category.create({name,description,image:urls[0]}); } catch(e) { await cleanup(urls); throw e; } res.redirect('/admin/game-store'); }));
  app.post('/admin/game-store/categories/:id/delete', isAuth, isAdmin, csrf, wrap(async(req,res) => { if(!validId(req.params.id)) fail('Kategori tidak ditemukan.'); if(await Listing.exists({category:req.params.id})) fail('Kategori masih digunakan postingan.'); const c=await Category.findByIdAndDelete(req.params.id); if(c) await cleanup([c.image]); res.redirect('/admin/game-store'); }));
  app.use(['/game-store','/admin/game-store'],(err,req,res,next) => { console.error('[game-store]',err.name); const message=err instanceof multer.MulterError ? 'Upload ditolak: maksimal 10 foto akun / 1 foto kategori, ukuran 5 MB per foto.' : err.status ? err.message : 'Terjadi kendala server. Silakan coba lagi.'; res.status(err.status || (err instanceof multer.MulterError ? 400 : 500)).render('game_store_error',{message}); });
}
module.exports={install,contact,mediator,imageType,validId,field,Category,Listing,Comment};
