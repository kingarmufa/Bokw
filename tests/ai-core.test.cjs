const test = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const ai = require('../lib/ai-core');

function makeZip(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'z-'));
  for (const [n, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, n)), { recursive: true }); fs.writeFileSync(path.join(d, n), c); }
  const out = path.join(d, 'out.zip');
  execSync(`cd ${d} && zip -qr out.zip . -x out.zip`);
  return fs.readFileSync(out);
}
test('baca file teks, lewati binary & node_modules', () => {
  const z = makeZip({ 'README.md': '# Dokumentasi\nhalo', 'src/a.js': 'console.log(1)', 'node_modules/x/i.js': 'x', 'img.png': Buffer.from([0, 1, 2, 3]) });
  const r = ai.readZipText(z);
  assert.deepStrictEqual(r.files.map(f => f.name).sort(), ['README.md', 'src/a.js']);
  assert.ok(r.skipped.includes('img.png'));
  assert.ok(ai.zipToPrompt(r, 'd.zip').includes('=== FILE: README.md ==='));
});
test('batas total karakter memotong isi', () => {
  const z = makeZip({ 'a.txt': 'x'.repeat(5000), 'b.txt': 'y'.repeat(5000) });
  const r = ai.readZipText(z, { maxTotalChars: 6000 });
  assert.ok(r.truncated);
  assert.ok(r.files.reduce((s, f) => s + f.text.length, 0) <= 6000);
});
test('bukan zip -> error', () => { assert.throws(() => ai.readZipText(Buffer.from('bukan zip sama sekali, hanya teks biasa'))); });
test('Groq endpoints normalize and legacy settings migrate once', () => {
  for(const url of ['', 'https://api.groq.com', 'https://api.groq.com/openai/v1/', 'https://console.groq.com/docs', 'https://openrouter.ai/api/v1', 'https://api.apmix.ai/v1']) assert.strictEqual(ai.normalizeBaseUrl(url),ai.DEFAULT_BASE_URL);
  const s={aiApiBaseUrl:'https://openrouter.ai/api/v1',aiApiKey:'old-key',aiModels:'old/model',aiDefaultModel:'old/model',aiBubbleEnabled:true};
  assert.strictEqual(ai.migrateLegacySettings(s),true);assert.strictEqual(s.aiApiKey,'');assert.strictEqual(s.aiDefaultModel,ai.DEFAULT_MODELS[0]);assert.strictEqual(s.aiBubbleEnabled,true);
  s.aiApiKey='groq-key';assert.strictEqual(ai.migrateLegacySettings(s),false);assert.strictEqual(s.aiApiKey,'groq-key');
  assert.strictEqual(ai.isLegacyProvider('https://openrouter.ai.evil.example'),false);
  assert.deepStrictEqual(ai.parseModelList('llama-3.3-70b-versatile,openai/gpt-oss-20b;llama-3.3-70b-versatile;<x>'),['llama-3.3-70b-versatile','openai/gpt-oss-20b']);
});
test('Groq chat sends Bearer and max_completion_tokens without provider attribution', async () => {
  let seen;const axios={post:async(url,body,config)=>{seen={url,body,config};return {data:{choices:[{message:{content:' halo '}}]}};}};
  assert.strictEqual(await ai.chatCompletion(axios,{apiKey:'test-key',model:ai.DEFAULT_MODELS[0],messages:[{role:'user',content:'hi'}],maxTokens:700,siteName:'Toko'}),'halo');
  assert.strictEqual(seen.url,'https://api.groq.com/openai/v1/chat/completions');assert.strictEqual(seen.body.max_completion_tokens,700);assert.strictEqual(seen.body.max_tokens,undefined);assert.strictEqual(seen.config.headers.Authorization,'Bearer test-key');assert.strictEqual(seen.config.headers['X-OpenRouter-Title'],undefined);
  await assert.rejects(()=>ai.chatCompletion({post:async()=>{throw Error('must not call');}},{apiKey:'',messages:[]}),e=>/API Key/.test(ai.friendlyError(e)));
  await assert.rejects(()=>ai.chatCompletion({post:async()=>({data:{error:{code:502,message:'bad provider'}}})},{apiKey:'test',messages:[]}),e=>/bermasalah/.test(ai.friendlyError(e)));
});
test('Groq model listing is authenticated, rejects malformed response and omits inactive/audio models',async()=>{
  const models=await ai.listModels({get:async(url,config)=>{assert.strictEqual(url,ai.DEFAULT_BASE_URL+'/models');assert.strictEqual(config.headers.Authorization,'Bearer test');return {data:{data:[{id:'llama-3.3-70b-versatile',active:true},{id:'retired',active:false},{id:'whisper-large-v3'},{id:'openai/gpt-oss-20b'}]}};}},{apiKey:'test'});
  assert.deepStrictEqual(models.map(m=>m.id),['llama-3.3-70b-versatile','openai/gpt-oss-20b']);assert(models.every(m=>!m.free));
  await assert.rejects(()=>ai.listModels({get:async()=>{throw Error('must not call');}},{}),e=>/API Key/.test(ai.friendlyError(e)));
  await assert.rejects(()=>ai.listModels({get:async()=>({data:{}})},{apiKey:'test'}));
});
test('Groq rate limits and invalid keys have readable messages',()=>{
  for(const [status,pattern] of [[401,/API Key/],[429,/Terlalu banyak/],[413,/terlalu besar/],[503,/Groq/]])assert.match(ai.friendlyError({response:{status}}),pattern);
});
