const fs=require('fs'),http=require('http'),crypto=require('crypto'),assert=require('assert');
const src=fs.readFileSync(require('path').join(__dirname,'..','server.js'),'utf8');
const a=src.indexOf('const SEKALIPAY_DEFAULT_BASE'),b=src.indexOf('// ===== Dispatcher provider withdraw instan');
const block=src.slice(a,b);
// axios tiruan berbasis fetch
const axios=async({method,url,params,data,headers,timeout,validateStatus})=>{
  const u=new URL(url);if(params)Object.entries(params).forEach(([k,v])=>v!=null&&u.searchParams.set(k,v));
  const r=await fetch(u,{method,headers,body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(timeout||5000)});
  let d;const t=await r.text();try{d=JSON.parse(t)}catch(e){d=t}return {status:r.status,data:d};
};
const mod=new Function('axios','crypto','return (function(){'+block+';return {sekalipayConfigured,sekalipayValidateName,sekalipayParseCreate,sekalipayParseTrx,sekalipayExecute,sekalipayCheckStatus,sekalipayUsableMethods,findSekalipayMethod,sekalipayNameGate,findOpenMethod,sekalipayRequest}})()')(axios,crypto);
const seen=[];let mode='ok';
const srv=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  seen.push({m:req.method,u:req.url,k:req.headers['x-apikey'],b:body?JSON.parse(body):null});
  const j=(c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o))};
  if(req.url==='/v1/item/validate'){const b=JSON.parse(body);if(b.customer_id==='08111')return j(200,{message:'OK',data:{display_name:'BUDI S',account_name:'BUDI S'}});if(b.customer_id==='08000')return j(422,{message:'ACCOUNT_NOT_FOUND'});return j(500,{message:'boom'})}
  if(req.method==='POST'&&req.url==='/v1/trx'){const b=JSON.parse(body);if(mode==='hang'){return;} if(mode==='5xx')return j(502,{message:'bad gateway'});if(mode==='balance')return j(400,{message:'BALANCE_IS_INSUFFICIENT'});return j(200,{message:'OK',data:{invoice:'SPY1',ref_id:b.ref_id,status:'paid'}})}
  if(req.method==='GET'&&req.url.startsWith('/v1/trx/')){const id=decodeURIComponent(req.url.split('/v1/trx/')[1]);
    if(id.startsWith('NF'))return j(404,{message:'TRX_NOT_FOUND'});
    if(id.startsWith('OK'))return j(200,{message:'OK',data:{status:'completed'},h2h_results:[{dispatch_status:'completed',sn:'SN123',log_message:'Sukses'}]});
    if(id.startsWith('FL'))return j(200,{message:'OK',data:{status:'failed'},h2h_results:[{dispatch_status:'failed',sn:'failed: nomor salah'}]});
    if(id.startsWith('PD'))return j(200,{message:'OK',data:{status:'paid'},h2h_results:[{dispatch_status:'pending'}]});
    if(id.startsWith('MX'))return j(200,{message:'OK',data:{status:'completed'},h2h_results:[{dispatch_status:'pending'}]});
    return j(200,{message:'OK',data:{status:'paid'},h2h_results:[]});}
  j(404,{message:'x'});
});});
require('node:test')('provider Sekalipay: cek nama, order, status, ambiguitas', () => new Promise((done, fail) => srv.listen(0, async () => { try {
  const st={sekalipayApiKey:'KEY1',sekalipayBaseUrl:'http://127.0.0.1:'+srv.address().port};
  const S=mod;
  // validate
  assert.deepStrictEqual(await S.sekalipayValidateName(st,12,'08111'),{ok:true,name:'BUDI S'});
  let v=await S.sekalipayValidateName(st,12,'08000');assert(v.invalid===true&&!v.ok);
  v=await S.sekalipayValidateName(st,12,'08999');assert(v.invalid===false&&!v.ok);
  // name gate
  const m={provider:'sekalipay',openCode:'12',nameCheck:true,name:'DANA'};
  assert.strictEqual((await S.sekalipayNameGate(st,m,'08111')).name,'BUDI S');
  assert((await S.sekalipayNameGate(st,m,'08000')).error);
  assert.deepStrictEqual(await S.sekalipayNameGate(st,m,'08999'),{});
  assert.deepStrictEqual(await S.sekalipayNameGate(st,{...m,nameCheck:false},'08000'),{});
  // create ok -> pending, body benar
  let r=await S.sekalipayExecute(st,m,'08111',25000,'REF1');
  assert(r.pending&&!r.failed&&!r.success&&r.trxid==='REF1');
  const post=seen.filter(x=>x.m==='POST'&&x.u==='/v1/trx').pop();
  assert.strictEqual(post.k,'KEY1');assert.strictEqual(post.b.carts[0].item_id,12);assert.strictEqual(post.b.carts[0].quantity,1);
  assert.deepStrictEqual(JSON.parse(post.b.carts[0].note),{target:'08111',provider_qty:25000});
  // balance -> failed
  mode='balance';r=await S.sekalipayExecute(st,m,'08111',25000,'REF2');assert(r.failed&&/BALANCE/.test(r.message));
  // 5xx -> ambiguous, cek ulang 404 -> tetap pending (tidak refund)
  mode='5xx';r=await S.sekalipayExecute(st,m,'08111',25000,'NFREF');assert(r.pending&&!r.failed,'5xx harus pending');
  // 5xx lalu trx ternyata ada & completed -> success
  r=await S.sekalipayExecute(st,m,'08111',25000,'OKREF');assert(r.success,'harus success dari cek ulang');
  // status parse
  const P=async id=>S.sekalipayParseTrx(await S.sekalipayCheckStatus(st,id));
  assert((await P('OK1')).success&&(await P('OK1')).message.includes('Sukses'));
  assert((await P('FL1')).failed);assert((await P('PD1')).pending);assert((await P('MX1')).pending&&!(await P('MX1')).success);
  assert((await P('NF1')).notFound&&(await P('NF1')).pending);
  assert((await P('ZZ1')).pending);
  // metode
  const cfg={sekalipayWithdrawMethods:[{name:'DANA',wallet:'DANA',itemId:'12',min:1,max:2,fee:0,active:true},{name:'X',wallet:'X',itemId:'abc',active:true},{name:'Y',wallet:'Y',itemId:'9',active:false}]};
  assert.strictEqual(S.sekalipayUsableMethods(cfg).length,1);assert(S.findOpenMethod(cfg,'sekalipay','DANA').openCode==='12');
  srv.close(); done(); } catch (e) { srv.close(); fail(e); } })));
