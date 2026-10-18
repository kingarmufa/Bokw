const test=require('node:test'),assert=require('node:assert/strict');
const m=require('../lib/maintenance');
const active={maintenance:{enabled:true,mode:'services',message:'Perbaikan utama',services:[{id:'nokos',message:'Provider OTP diperbaiki'}]}};
test('service boundaries, fresh admin role and descriptions',()=>{
  assert.equal(m.decision(active,{role:'user'},'/nokos/order').message,'Provider OTP diperbaiki');
  assert.equal(m.decision(active,{role:'user'},'/api/nokos/order').scope,'Nokos / Nomor OTP');
  assert.equal(m.decision(active,{role:'user'},'/NOKOS/').scope,'Nokos / Nomor OTP');
  assert.equal(m.decision(active,{role:'user'},'/nokos-other'),null);
  assert.equal(m.decision(active,{role:'user'},'/premium'),null);
  assert.equal(m.decision(active,{role:'admin'},'/nokos'),null);
  assert(m.decision(active,{role:'adminpanel'},'/nokos'));
  assert.equal(m.decision(active,null,'/nokos'),null);
  assert.equal(m.decision({maintenance:{...active.maintenance,enabled:false}},{role:'user'},'/nokos'),null);
});
test('website blocks logged-in pages, service catalogue paths map consistently',()=>{
  const cfg={maintenance:{enabled:true,mode:'website'}};
  assert(m.decision(cfg,{role:'user'},'/dashboard'));
  for(const service of m.SERVICES)for(const path of service.paths){
    const state=m.decision({maintenance:{enabled:true,mode:'services',services:[{id:service.id}]}},{role:'user'},path+'/order');
    assert.equal(state.scope,service.name);
  }
  for(const path of ['/login','/logout','/register','/webhook/dibanana','/callback/test','/payment/INV1'])assert(m.exempt(path));
  assert(!m.exempt('/login-fake'));
});
test('real Mongoose schema preserves maintenance configuration',()=>{
  const mongoose=require('mongoose'),schema=new mongoose.Schema({name:String});m.addSchema(schema,mongoose);
  const Model=mongoose.models.MaintenanceTest||mongoose.model('MaintenanceTest',schema);
  assert.equal(new Model().maintenance.enabled,false);
  const doc=new Model(active);assert.equal(doc.validateSync(),undefined);assert.equal(doc.maintenance.services[0].message,'Provider OTP diperbaiki');
});
test('HTTP gate blocks mutations, preserves callbacks, rejects stale admin and checks API account',async()=>{
  const express=require('express'),app=express();let writes=0;let settings={_id:'settings',...active};
  const users={member:{role:'user'},admin:{role:'admin'}};
  const sessions={member:{userId:'member'},admin:{userId:'admin',maintenanceCsrf:'csrf-test'}};
  const control=m.create({getSettings:async()=>settings,getUser:async id=>users[id],Setting:{updateOne:async(filter,patch)=>{assert.equal(filter._id,'settings');settings={...settings,...patch.$set};}}});
  app.use(express.urlencoded({extended:true}));app.use(express.json());
  app.use((req,res,next)=>{req.session=sessions[req.get('X-Test-User')]||{};res.render=(name,locals)=>res.send({view:name,maintenance:locals.maintenance});next();});
  app.use(control.gate);control.mount(app,[(req,res,next)=>req.session.userId?next():res.sendStatus(401)]);
  app.post('/nokos/order',(req,res)=>{writes++;res.json({ok:true});});
  app.get('/premium',(req,res)=>res.send('OK'));
  app.post('/webhook/dibanana',(req,res)=>res.send('CALLBACK'));
  app.get('/api/nokos/order',(req,res,next)=>{req.apiUser=req.get('X-Test-Api');next();},control.apiGate,(req,res)=>res.send('API OK'));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
  const call=(path,user,options={})=>fetch(base+path,{redirect:'manual',...options,headers:{'X-Test-User':user||'',...options.headers}});
  try{
    let r=await call('/nokos/order','member',{method:'POST'});assert.equal(r.status,503);assert.equal((await r.json()).code,'MAINTENANCE');assert.equal(writes,0);assert.equal(r.headers.get('cache-control'),'no-store');
    r=await call('/nokos/order','member',{method:'POST',headers:{Accept:'text/html'}});assert.equal((await r.json()).view,'maintenance');
    assert.equal((await call('/premium','member')).status,200);
    assert.equal((await call('/nokos/order','admin',{method:'POST'})).status,200);
    assert.equal((await call('/webhook/dibanana','member',{method:'POST'})).status,200);
    assert.equal((await call('/api/nokos/order','',{headers:{'X-Test-Api':'member'}})).status,503);
    assert.equal((await call('/api/nokos/order','',{headers:{'X-Test-Api':'admin'}})).status,200);
    assert.equal((await call('/admin/maintenance','member')).status,403);
    assert.equal((await call('/admin/maintenance','admin')).status,200);
    assert.equal((await call('/admin/maintenance','admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'website'})})).status,403);
    assert.equal((await call('/admin/maintenance','admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csrf:'csrf-test',enabled:'on',mode:'services',services:[]})})).status,400);
    r=await call('/admin/maintenance','admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csrf:'csrf-test',enabled:'on',mode:'website',title:'Update server',message:'Sedang diperbaiki'})});assert.equal(r.status,302);
    assert.equal((await call('/premium','member')).status,503);
    assert.equal((await call('/admin/maintenance','admin')).status,200);
    users.admin.role='user';assert.equal((await call('/admin/maintenance','admin')).status,503);users.admin.role='admin';
    r=await call('/admin/maintenance','admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csrf:'csrf-test',mode:'website'})});assert.equal(r.status,302);assert.equal((await call('/premium','member')).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('public API documentation follows both maintenance modes; admin bypass and reopening',async()=>{
  const express=require('express'),app=express();let enabled=true,mode='website',docReads=0,adminRole='admin';
  const control=m.create({getSettings:async()=>({maintenance:{enabled,mode,services:[{id:'nokos'}]}}),getUser:async id=>{assert(id);return {role:id==='admin'?adminRole:'user'};},Setting:{}});
  app.use((req,res,next)=>{req.session={userId:req.get('X-Test-User')};res.render=(view,locals)=>res.type('html').send(view+':'+locals.maintenance.scope);next();});app.use(control.gate);
  app.get('/docs',(req,res)=>{docReads++;res.send('PRIVATE DOCS CONTENT');});
  app.get('/docs.json',(req,res)=>{docReads++;res.json({openapi:'SPEC CONTENT'});});
  app.get('/docs-other',(req,res)=>res.send('UNRELATED'));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  const get=(path,user)=>fetch(base+path,{headers:{Accept:'text/html',...(user?{'X-Test-User':user}:{})}});
  try{
    for(mode of ['website','services']){
      for(const user of [null,'member']){
        let r=await get('/docs?tab=nokos',user);assert.equal(r.status,503);assert.equal(await r.text(),'maintenance:Dokumentasi API');
        for(const path of ['/docs.json','/docs.json/?download=1','/DOCS.JSON?download=1']){
          r=await get(path,user);assert.equal(r.status,503);assert.match(r.headers.get('content-type'),/application\/json/);assert.equal((await r.json()).code,'MAINTENANCE');assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('retry-after'),'300');
        }
      }
      assert.equal(docReads,mode==='website'?0:2);
      assert.equal((await get('/docs','admin')).status,200);assert.equal((await get('/docs.json','admin')).status,200);
    }
    assert.equal((await get('/docs-other')).status,200);
    adminRole='user';assert.equal((await get('/docs','admin')).status,503);
    enabled=false;
    for(const user of [null,'member'])for(const path of ['/docs','/docs.json?download=1'])assert.equal((await get(path,user)).status,200);
  }finally{await new Promise(r=>server.close(r));}
});
