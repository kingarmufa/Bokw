const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),start=source.indexOf('function vipSign(settings)'),end=source.indexOf('// ================== AUSTIN PAY',start);
const calls=[],settings={vipApiId:'QA_ID',vipApiKey:'QA_KEY'};
const api=new Function('axios','crypto',source.slice(start,end)+';return {vipSign,vipRequest,vipWithdrawInstant,vipCheckStatus,vipServices,vipParse};')({post:async(url,body,opts)=>{calls.push({url,body:new URLSearchParams(body),opts});return {data:{result:true,data:[]}}}},crypto);
test('VIP documented endpoint, form authentication, order, status and filters',async()=>{
 await api.vipWithdrawInstant(settings,'SHNX25','087800001233');let c=calls.at(-1);
 assert.equal(c.url,'https://vip-reseller.co.id/api/prepaid');assert.equal(c.body.get('sign'),crypto.createHash('md5').update('QA_IDQA_KEY').digest('hex'));
 assert.equal(c.body.get('key'),'QA_KEY');assert.equal(c.body.get('type'),'order');assert.equal(c.body.get('service'),'SHNX25');assert.equal(c.body.get('data_no'),'087800001233');assert.match(c.opts.headers['Content-Type'],/form-urlencoded/);
 await api.vipCheckStatus(settings,'VP1',10);c=calls.at(-1);assert.equal(c.body.get('trxid'),'VP1');assert.equal(c.body.has('limit'),false);
 await api.vipCheckStatus(settings,null,10);c=calls.at(-1);assert.equal(c.body.has('trxid'),false);assert.equal(c.body.get('limit'),'10');
 await api.vipServices(settings,'brand','XL');c=calls.at(-1);assert.equal(c.body.get('type'),'services');assert.equal(c.body.get('filter_type'),'brand');assert.equal(c.body.get('filter_value'),'XL');
 await api.vipServices(settings);assert.equal(calls.at(-1).body.has('filter_type'),false);await assert.rejects(api.vipServices(settings,'unknown','x'));
});
test('VIP statuses match docs and polling selects the right transaction',()=>{
 for(const status of ['waiting','processing','success','error']){
  const p=api.vipParse({result:true,data:{trxid:'VP1',status,note:'Catatan'}});assert.equal(p.success,status==='success');assert.equal(p.failed,status==='error');assert.equal(p.pending,['waiting','processing'].includes(status));assert.match(p.message,/Catatan/);
 }
 const p=api.vipParse({result:true,data:[{trxid:'OTHER',status:'error'},{trxid:'VP1',status:'success'}]},{requestType:'status',trxid:'VP1'});assert(p.success);assert.equal(p.trxid,'VP1');
 assert(api.vipParse({result:false,message:'Order ditolak'}).failed);
 for(const data of [{result:false,message:'API key bermasalah'},{result:true,data:[]},{result:true,data:[{trxid:'OTHER',status:'error'}]},'<html>Bad Gateway</html>',null]){
  const p=api.vipParse(data,{requestType:'status',trxid:'VP1'});assert(p.pending);assert(!p.failed&&!p.success);
 }
});
test('VIP webhook verifies signature and handles mixed batches without finalizing request failures',async()=>{
 let handler;const completed=[],rejected=[];const docs=new Map(['OK','ERR','WAIT'].map(id=>[id,{_id:id,status:'pending'}]));
 const a=source.indexOf("app.post('/webhook/vipreseller'"),b=source.indexOf('// ================== MUTASI CHECKER',a);
 vm.runInNewContext(source.slice(a,b),{app:{post(url,fn){handler=fn}},getSettings:async()=>settings,vipConfigured:()=>true,vipSign:api.vipSign,vipParse:api.vipParse,crypto,Buffer,console,botManager:null,
 Transaction:{findOne:async q=>{assert.equal(q.gateway,'vipreseller');const d=docs.get(q.gatewayTrxId);return d?.status==='pending'?d:null}},
 succeedInstantWithdrawal:async wd=>{wd.status='success';completed.push(wd._id)},rejectInstantWithdrawal:async wd=>{wd.status='rejected';rejected.push(wd._id)}});
 function response(){return {code:200,status(c){this.code=c;return this},json(body){this.body=body;return this}}}
 const body={result:true,data:[{trxid:'OK',status:'success'},{trxid:'ERR',status:'error'},{trxid:'WAIT',status:'processing'}]};
 let res=response();await handler({get:()=>'',body},res);assert.equal(res.code,401);assert.equal(completed.length,0);
 res=response();await handler({get:()=>api.vipSign(settings),body},res);assert.deepEqual(completed,['OK']);assert.deepEqual(rejected,['ERR']);assert.equal(docs.get('WAIT').status,'pending');
 await handler({get:()=>api.vipSign(settings),body},response());assert.equal(completed.length,1);assert.equal(rejected.length,1);
 await handler({get:()=>api.vipSign(settings),body:{result:false,data:[{trxid:'WAIT',status:'error'}]}},response());assert.equal(docs.get('WAIT').status,'pending');
});
