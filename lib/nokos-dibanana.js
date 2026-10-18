'use strict';
const crypto = require('node:crypto');
const banana = require('./dibanana');
const { publicOrder } = banana;
function createNokos(deps) {
  const { mongoose, axios, User, Order, getSettings, markup, ruleFor, vouchers, voucherLib, notify } = deps;
  const Quote = mongoose.models.NokosQuote || mongoose.model('NokosQuote', new mongoose.Schema({
    _id:String, userId:mongoose.Schema.Types.ObjectId, productId:String, server:String, service:String, country:String, name:String, cost:Number, price:Number, used:{type:Boolean,default:false}, expiresAt:{type:Date,index:{expires:0}}
  }));
  const lock = new Map();
  async function exclusive(id, fn) { if(lock.has(id)) throw new Error('Pesanan sedang diproses. Cek kembali sebentar lagi.'); lock.set(id,true); try{return await fn();}finally{lock.delete(id);} }
  async function settings() { const s=await getSettings(); if(!s.smscodeEnabled || !s.dibananaApiKey) throw new Error('Nokos Dibanana belum diaktifkan admin.'); return s; }
  async function account(id) { const u=await User.findById(id).lean(); if(!u || u.suspended) throw new Error('Akun tidak tersedia.'); return u; }
  const api = s => banana.client(axios,s);
  async function services(input) { const server=String(input.server||'ekonomi'); if(!banana.SERVERS.includes(server)) throw new Error('Server tidak valid.'); const r=await api(await settings())('GET','/services',{server}); return (r.services||[]).map(x=>({code:String(x.code),name:String(x.name)})); }
  async function prices(uid,input) {
    const sel=banana.selection(input), s=await settings(), u=await account(uid);
    const [r, feeRule, catalog]=await Promise.all([api(s)('GET','/prices',sel),ruleFor(u,'nokos'),api(s)('GET','/services',{server:sel.server})]);
    const service=(catalog.services||[]).find(x=>String(x.code)===sel.service);
    if(!service)throw new Error('Layanan tidak tersedia untuk server ini.');
    const products=(r.providers||[]).filter(p=>typeof p.id==='string' && p.id.length>0 && Number.isSafeInteger(p.price_idr) && p.price_idr>=0 && Number(p.stock)>0 && (!p.server || p.server===sel.server));
    const out=[];
    for(const p of products.slice(0,100)) {
      const price=markup(p.price_idr,s,feeRule);
      if(!Number.isSafeInteger(price)||price<0) continue;
      const q=await Quote.create({_id:crypto.randomBytes(18).toString('hex'),userId:uid,productId:p.id,...sel,name:String(service.name||sel.service),cost:p.price_idr,price,expiresAt:new Date(Date.now()+300000)});
      out.push({id:p.id,quote_id:q._id,price,stock:Number(p.stock),server:sel.server});
    }
    return out.sort((a,b)=>a.price-b.price);
  }
  // Refund receipt and balance update are one atomic user-document operation.
  // Retry after a crash can mark the order refunded without crediting twice.
  async function refund(order) {
    if(order.refunded || !order.debitApplied) return;
    await User.updateOne({_id:order.userId,nokosRefundIds:{$ne:order._id}},{$inc:{[order.debitField||'balance']:order.debitBalance||0,heldBalance:order.debitHeld||0},$addToSet:{nokosRefundIds:order._id}});
    await Order.updateOne({_id:order._id},{$set:{refunded:true}}); order.refunded=true;
  }
  async function owned(uid,id) { const o=await Order.findOne({_id:id,userId:uid}); if(!o) throw new Error('Pesanan tidak ditemukan.'); return o; }
  async function buy(uid,input,req) {
    const s=await settings(), user=await account(uid), quoteId=String(input.quote_id||'');
    if(!/^[a-f0-9]{36}$/.test(quoteId)) throw new Error('Pilih harga lagi untuk mendapat quote_id baru.');
    const localId='NOKOSB'+quoteId;
    const existing=await Order.findOne({_id:localId,userId:uid}); if(existing)return publicOrder(existing);
    const q=await Quote.findOne({_id:quoteId,userId:uid,used:false,expiresAt:{$gt:new Date()}}).lean();
    if(!q) throw new Error('Pilihan harga sudah digunakan atau kedaluwarsa. Muat ulang harga.');
    const operator=String(input.operator||'any');
    if(!banana.OPERATORS.includes(operator) || (operator!=='any'&&q.server!=='premium')) throw new Error('Pilihan operator hanya berlaku pada server premium.');
    const pricing=await vouchers.checkout(req,'nokos',q.price); if(pricing.error) throw new Error(pricing.error);
    const amount=pricing.total;
    if(!Number.isSafeInteger(amount)||amount<0) throw new Error('Harga tidak valid.');
    const balField=user.role==='merchant'?'topupBalance':'balance';
    const held=Math.min(Math.max(0,user.heldBalance||0),amount), bal=amount-held;
    if((user[balField]||0)<bal) throw new Error('Saldo tidak cukup.');
    const claimed=await Quote.findOneAndUpdate({_id:quoteId,userId:uid,used:false,expiresAt:{$gt:new Date()}},{$set:{used:true}},{new:true});
    if(!claimed) throw new Error('Pesanan ini sedang diproses. Lihat Riwayat Nokos.');
    // Persist the intended debit before touching balance or calling the provider.
    const o=await Order.create({_id:localId,...voucherLib.orderFields(pricing),userId:uid,provider:'dibanana',productId:q.productId,server:q.server,service:q.service,countryName:q.country,productName:q.name,costPrice:q.cost,sellPrice:amount,status:'ORDERING',debitField:balField,debitBalance:bal,debitHeld:held,expiresAt:new Date(Date.now()+19*60000)});
    const debited=await User.findOneAndUpdate({_id:uid,suspended:{$ne:true},nokosDebitIds:{$ne:localId},[balField]:{$gte:bal},heldBalance:{$gte:held}},{$inc:{[balField]:-bal,heldBalance:-held},$addToSet:{nokosDebitIds:localId}},{new:true});
    if(!debited){o.status='FAILED';await o.save();throw new Error('Saldo berubah atau tidak mencukupi. Pilih harga lagi.');}
    o.debitApplied=true; o.status='REVIEW'; await o.save();
    let r;
    try { r=await api(s)('POST','/order',{id:q.productId,...(q.server==='premium'?{operator}:{})}); }
    catch(e) {
      if(e.definitive) {o.status='FAILED';await o.save();await refund(o);throw e;}
      // No blind retry/refund: /order has no documented idempotency support.
      return publicOrder(o);
    }
    if(!Number.isSafeInteger(r.order_id)||!r.phone_number) return publicOrder(o);
    o.providerOrderId=r.order_id; o.phoneNumber=String(r.phone_number); o.status='ACTIVE';
    if(Number.isSafeInteger(r.price_idr))o.costPrice=r.price_idr;
    await o.save(); return publicOrder(o);
  }
  async function apply(o,r) {
    const patch=banana.remotePatch(o,r);
    // A late pending response must not overwrite a webhook's delivered OTP.
    if(patch.status==='ACTIVE' && o.status==='OTP_RECEIVED' && !o.resendCount) return o;
    if(['CANCELED','EXPIRED'].includes(patch.status) && (o.otpCode||o.resendCount))patch.status='RESEND_CANCELED';
    const updated=await Order.findOneAndUpdate({_id:o._id,status:o.status,resendCount:o.resendCount||0},{$set:patch},{new:true});
    if(!updated)return Order.findById(o._id);
    if(['CANCELED','EXPIRED'].includes(updated.status))await refund(updated);
    if(patch.status==='OTP_RECEIVED'&&!o.otpCode) { try{await notify(updated,await User.findById(o.userId).lean());}catch(_){} }
    return updated;
  }
  async function legacy(o,s,action) {
    if(action==='resend')throw new Error('OTP kedua hanya untuk pesanan Dibanana baru.');
    const c=axios.create({baseURL:s.smscodeBaseUrl||'https://api.smscode.gg/v1',headers:{Authorization:'Bearer '+(s.smscodeApiKey||'')},timeout:15000});
    if(action==='cancel')await c.post('/orders/cancel',{id:o.smscodeOrderId});
    const r=(await c.get('/orders/'+o.smscodeOrderId)).data.data;
    if(!r || !['ACTIVE','OTP_RECEIVED','COMPLETED','CANCELED','EXPIRED'].includes(r.status))throw new Error('Status pesanan lama belum tersedia.');
    o.status=r.status;if(r.otp_code)o.otpCode=r.otp_code;
    if(['CANCELED','EXPIRED'].includes(o.status)&&!o.refunded&&!o.otpCode) {
      // Old orders lack the split receipt; retain their original refund policy.
      o.debitApplied=true;o.debitField='balance';o.debitBalance=o.sellPrice;o.debitHeld=0;
      await refund(o);
    }
    await o.save();return o;
  }
  async function update(uid,id,action='status') {return exclusive(id,async()=>{
    await account(uid);const o=await owned(uid,id),s=await getSettings();
    if(o.provider!=='dibanana')return publicOrder(await legacy(o,s,action));
    if(o.status==='FAILED'){await refund(o);return publicOrder(o);}
    if(['ORDERING','REVIEW'].includes(o.status))return publicOrder(o);
    if(['CANCELED','EXPIRED','RESEND_CANCELED'].includes(o.status)){if(['CANCELED','EXPIRED'].includes(o.status))await refund(o);return publicOrder(o);}
    const call=api(s);
    if(action==='cancel') {
      if(o.otpCode||o.resendCount||o.status!=='ACTIVE')throw new banana.BananaError('CANNOT_CANCEL');
      if(Date.now()-new Date(o.createdAt).getTime()<120000)throw new banana.BananaError('TOO_EARLY');
      const r=await call('POST','/cancel',{order_id:o.providerOrderId});
      if(r.new_status!=='cancelled')throw new Error('Pembatalan belum dikonfirmasi provider.');
      return publicOrder(await apply(o,{...r,status:r.new_status}));
    }
    if(action==='resend') {
      if(o.status!=='OTP_RECEIVED'||!o.otpCode)throw new banana.BananaError('INVALID_STATUS');
      if(o.resendCount)throw new banana.BananaError('MAX_RESEND');
      // Persistent claim prevents two requests from different processes.
      const claim=await Order.findOneAndUpdate({_id:id,status:'OTP_RECEIVED',resendCount:0},{$set:{resendCount:1,status:'ACTIVE'}},{new:true});
      if(!claim)throw new banana.BananaError('MAX_RESEND');
      try{await call('POST','/resend',{order_id:o.providerOrderId});}
      catch(e){if(e.definitive && !['MAX_RESEND','INVALID_STATUS'].includes(e.code))await Order.updateOne({_id:id,status:'ACTIVE'},{$set:{resendCount:0,status:'OTP_RECEIVED'}});throw e;}
      return publicOrder(await Order.findById(id));
    }
    const r=await call('GET','/status',{order_id:o.providerOrderId});
    return publicOrder(await apply(o,r));
  });}
  const safe = fn => async(req,res)=>{try{await fn(req,res);}catch(e){res.status(400).json({success:false,error:e instanceof banana.BananaError ? e.message : (/apikey|Bearer|https?:/i.test(e.message)?'Layanan belum dapat diproses.':e.message || 'Permintaan gagal.')});}};
  const uid=req=>req.apiUser||req.session.userId;
  const ok=(res,data)=>res.json({success:true,data});
  function catalog(app,prefix,guards) {
    app.get(prefix+'/servers',...guards,safe(async(req,res)=>ok(res,banana.SERVERS)));
    app.get(prefix+'/countries',...guards,safe(async(req,res)=>ok(res,banana.COUNTRIES)));
    app.get(prefix+'/services',...guards,safe(async(req,res)=>ok(res,await services(req.query))));
    app.get(prefix+'/products',...guards,safe(async(req,res)=>ok(res,await prices(uid(req),req.query))));
  }
  function web(app,guards) {
    catalog(app,'/nokos',guards);
    app.get('/nokos',...guards,(req,res)=>res.render('nokos'));
    app.post('/nokos/order',...guards,safe(async(req,res)=>ok(res,await buy(uid(req),req.body,req))));
    app.get('/nokos/transaksi/:id',...guards,safe(async(req,res)=>res.render('nokos_transaksi',{order:await owned(uid(req),req.params.id)})));
    app.get('/nokos/riwayat',...guards,safe(async(req,res)=>res.render('nokos_riwayat',{orders:await Order.find({userId:uid(req)}).sort({createdAt:-1}).limit(100).lean()})));
    app.get('/nokos/status/:id',...guards,safe(async(req,res)=>ok(res,await update(uid(req),req.params.id))));
    for(const action of ['cancel','resend'])app.post('/nokos/'+action+'/:id',...guards,safe(async(req,res)=>ok(res,await update(uid(req),req.params.id,action))));
    app.post('/webhook/dibanana',async(req,res)=>{
      try{
        const s=await getSettings();
        if(!banana.signatureValid(req.dibananaRawBody,req.get('X-Banana-Signature'),s.dibananaWebhookSecret))return res.sendStatus(401);
        if(req.body.event!=='otp.received'||req.get('X-Banana-Event')!=='otp.received'||!Number.isSafeInteger(req.body.order_id))return res.sendStatus(400);
        const o=await Order.findOne({provider:'dibanana',providerOrderId:req.body.order_id});
        // Retry unknown IDs: provider can beat the order-persistence response.
        if(!o)return res.sendStatus(503);
        if(req.body.status!=='received'||!req.body.otp_code)return res.sendStatus(400);
        // Process the signed payload directly for a fast acknowledgement. A
        // repeated first-OTP webhook must not finish the second-SMS wait.
        await exclusive(o._id,async()=>{
          const latest=await Order.findById(o._id);
          if(!['ACTIVE','OTP_RECEIVED'].includes(latest.status))return;
          if(latest.resendCount && String(req.body.otp_code)===latest.otpCode)return;
          const remote=latest.resendCount ? {...req.body,otp_code:latest.otpCode,otp_code_2:String(req.body.otp_code),resend_count:1} : req.body;
          await apply(latest,remote);
        });
        return res.sendStatus(200);
      }catch(_){return res.sendStatus(503);}
    });
  }
  function publicApi(app,guards) {
    catalog(app,'/api/nokos',guards);
    app.post('/api/nokos/order',...guards,safe(async(req,res)=>ok(res,await buy(uid(req),req.body,req))));
    app.get('/api/nokos/order',...guards,(req,res)=>res.status(405).json({success:false,error:'Gunakan POST JSON dengan quote_id dari /api/nokos/products.'}));
    app.get('/api/nokos/status',...guards,safe(async(req,res)=>ok(res,await update(uid(req),req.query.id))));
    for(const action of ['cancel','resend'])app.post('/api/nokos/'+action,...guards,safe(async(req,res)=>ok(res,await update(uid(req),req.body.id,action))));
  }
  function admin(app,guards) {
    app.get('/admin/nokos/dibanana/balance',...guards,safe(async(req,res)=>ok(res,await api(await settings())('GET','/balance'))));
    app.get('/admin/nokos/dibanana/orders',...guards,safe(async(req,res)=>ok(res,await api(await settings())('GET','/orders',{page:Math.max(1,parseInt(req.query.page)||1),limit:20,...(['pending','received','cancelled','expired','resend_cancelled'].includes(req.query.status)?{status:req.query.status}:{})}))));
  }
  return { web,publicApi,admin,prices,buy,update,refund,apply };
}
module.exports={createNokos};
