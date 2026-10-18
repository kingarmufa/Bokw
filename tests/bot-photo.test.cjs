const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {TelegramBotLifecycle,botError}=require('../lib/telegram-lifecycle');
const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const start=source.indexOf('class BotManager extends TelegramBotLifecycle {'),end=source.indexOf('\n}',start)+2;
const BotManager=new Function('TelegramBotLifecycle','botError','console',source.slice(start,end)+';return BotManager;')(TelegramBotLifecycle,botError,{error(){}});
function fixture(){
 const calls=[]; const bot=new BotManager({User:{countDocuments:async()=>12}});
 bot.settings={telegramStartPhotoUrl:' https://example.test/admin-photo.jpg ',logoUrl:'https://example.test/website-logo.png',telegramChannelId:'-10012345',telegramProfileUrl:'https://example.test/profile'};
 bot.running=true;bot.bot={telegram:{sendPhoto:async(...args)=>calls.push({type:'photo',args}),sendMessage:async(...args)=>calls.push({type:'text',args})}};
 return {bot,calls};
}
test('new member notification uses admin bot photo, masked email and Website button',async()=>{
 const {bot,calls}=fixture();await bot.notifyRegisterToChannel({username:'Tester',email:'tester@example.test'});
 assert.equal(calls.length,1);assert.equal(calls[0].type,'photo');assert.equal(calls[0].args[1],'https://example.test/admin-photo.jpg');
 const opts=calls[0].args[2];assert.match(opts.caption,/SELAMAT DATANG/);assert.match(opts.caption,/tesxxx@example.test/);assert.equal(opts.parse_mode,'HTML');assert.equal(opts.reply_markup.inline_keyboard[0][0].url,bot.settings.telegramProfileUrl);
});
test('all channel receipts and bot menu/profile follow current admin URL',async()=>{
 const {bot,calls}=fixture(),user={username:'Tester',email:'test@example.test',balance:100};
 for(const name of ['notifyNokosDoneToChannel','notifyGachaNokosDoneToChannel','notifyPanelDoneToChannel','notifyPremiumDoneToChannel','notifySosmedDoneToChannel','notifyRoleDoneToChannel'])await bot[name]({},user);
 await bot.notifyGachaNokosAksesToChannel(user,10);await bot.notifyFixNoAksesToChannel(user,10);
 await bot.notifyDepositToChannel({_id:'T1',amount:10,fee:0,total:10},user);
 assert.equal(calls.length,9);assert(calls.every(c=>c.type==='photo'&&c.args[1]==='https://example.test/admin-photo.jpg'));
 bot.settings.telegramStartPhotoUrl='https://example.test/new-photo.png';
 await bot.notifyRegisterToChannel(user);assert.equal(calls.at(-1).args[1],bot.settings.telegramStartPhotoUrl);
 assert.equal(bot.getUserPhotoUrl({merchantLogoUrl:'https://example.test/merchant.png'}),bot.settings.telegramStartPhotoUrl);
 let image;await bot.sendStartMessage({replyWithPhoto:async url=>{image=url}},'Menu');assert.equal(image,bot.settings.telegramStartPhotoUrl);
});
test('blank URL produces text, failed photo preserves caption and buttons once',async()=>{
 const {bot,calls}=fixture();bot.settings.telegramStartPhotoUrl=' ';await bot.sendPhotoToChannel('Pesan');assert.equal(calls.length,1);assert.equal(calls[0].type,'text');
 bot.settings.telegramStartPhotoUrl='https://example.test/missing.jpg';let photos=0;bot.bot.telegram.sendPhoto=async()=>{photos++;throw new Error('failed')};
 await bot.sendPhotoToChannel('Teks penting');assert.equal(photos,1);assert.equal(calls.length,2);assert.equal(calls[1].args[1],'Teks penting');assert(calls[1].args[2].reply_markup);
 bot.running=false;await bot.sendPhotoToChannel('OFF');assert.equal(calls.length,2);
});
