/* FARM — authoritative server. Season 2: THE REBIRTH. Run: node server.js */
'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const bcrypt=require('bcryptjs');
const PORT=process.env.PORT||3000;
const ADMIN_CODE=process.env.ADMIN_CODE||'486900892414';
const SAVE_FILE='farm_save.json',SAVE_BAK='farm_save.bak.json';
const ACCOUNTS_FILE='accounts.json';
const RESEND_API_KEY=process.env.RESEND_API_KEY||'';
const EMAIL_FROM=process.env.EMAIL_FROM||'onboarding@resend.dev';
const APP_BASE_URL=process.env.APP_BASE_URL||'http://localhost:'+PORT;
const RESTOCK_MS=5*60*1000,SAVE_MS=30*1000,CINEMATIC_MS=46000;
const EMOTE_RESTOCK_MS=2*60*60*1000;
const PLOT_POS=[[-55,-55],[55,-55],[-55,55],[55,55],[-85,0],[85,0]];
const PLOT_HALF=[6,7.5,9,10.5];
const EXP_COST=[500,5000,50000];
const WORLD_R=96;
const PACK_PRICE=1000000;
const PACK_SEEDS=[['rake',1],['bloodmoonrose',9],['flamepepper',8],['dragonfruit',10],['watermelon',12],['bellpepper',15],['corn',20],['pumpkin',25]];
const RARITIES=['Common','Uncommon','Rare','Epic','Legendary','Mythical','Demon','Divine','Alienoic'];
const GOLD_PASS_COST=35,PASS_MAX=20;
const HEART_ACT1_FED=500;        /* fruit needed to unlock Decider */
const DECIDER_COST=1000000000;   /* 1B blood drops */
let WebSocketServer=null,WSS=null;try{WebSocketServer=require('ws');}catch(e){console.error('[FARM] run: npm install ws');}
const BAD=['fuck','shit','bitch','cunt','asshole','bastard','dick','piss','whore','slut','nigg','rape','retard','wank','bollock','arse','twat','cock','pussy','fag','spic','chink','kike','hitler','nazi','porn','penis','vagina','anal','jizz','dildo','orgasm','milf','cum'];
function cleanName(raw){let n=String(raw||'').replace(/[^A-Za-z0-9 _-]/g,'').trim().slice(0,16);
 const low=' '+n.toLowerCase()+' ';
 for(const w of BAD)if(low.includes(w))return null;
 if(n.length<2)return null;return n.replace(/\s+/g,' ');}

/* ===== 9-CHARACTER PUBLIC PLAYER ID =====
   Every player gets a short, human-readable ID like "F4K8X2M9Q" — 9 chars, alphanumeric.
   Used in the admin panel to identify players. Generated once and saved. */
function genPlayerId(){
 const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; /* no I,O,0,1 to avoid confusion */
 let id='';
 for(let i=0;i<9;i++)id+=chars[Math.floor(Math.random()*chars.length)];
 return id;}

/* ===== ACCOUNTS DATABASE (separate from farm_save.json) =====
   Stores: username (lowercased), passwordHash (bcrypt), email, emailVerified,
   playerId (links to farm_save.json player), createdAt, verifyToken (temp)
   Reset tokens are stored in memory (Map) — they expire in 1 hour and are single-use.
   This keeps auth data OUT of farm_save.json. */
let ACCOUNTS={}; /* {usernameLower: {username, passwordHash, email, emailVerified, playerId, createdAt, verifyToken?}} */
const resetTokens=new Map(); /* token -> {username, expires, used} */
function loadAccounts(){
 try{if(fs.existsSync(ACCOUNTS_FILE)){ACCOUNTS=JSON.parse(fs.readFileSync(ACCOUNTS_FILE,'utf8'));
   console.log('[FARM] loaded',Object.keys(ACCOUNTS).length,'accounts');}}
 catch(e){console.error('[FARM] accounts load failed:',e.message);ACCOUNTS={};}}
function saveAccounts(){
 try{fs.writeFileSync(ACCOUNTS_FILE+'.tmp',JSON.stringify(ACCOUNTS,null,2));fs.renameSync(ACCOUNTS_FILE+'.tmp',ACCOUNTS_FILE);}
 catch(e){console.error('[FARM] accounts save failed:',e.message);}}
/* ===== RESEND EMAIL ===== */
async function sendEmail(to,subject,html){
 if(!RESEND_API_KEY){console.log('[FARM-EMAIL] No RESEND_API_KEY set — skipping email to',to);return{success:false,reason:'no_api_key'};}
 try{
  const resp=await fetch('https://api.resend.com/emails',{
   method:'POST',
   headers:{'Authorization':'Bearer '+RESEND_API_KEY,'Content-Type':'application/json'},
   body:JSON.stringify({from:EMAIL_FROM,to:to,subject:subject,html:html})
  });
  const data=await resp.json();
  if(resp.ok){console.log('[FARM-EMAIL] Sent to',to,'id:',data.id);return{success:true,id:data.id};}
  else{console.error('[FARM-EMAIL] API error:',data);return{success:false,reason:data.message||'api_error'};}
 }catch(e){console.error('[FARM-EMAIL] send failed:',e.message);return{success:false,reason:e.message};}}
/* ===== TOKEN SYSTEM ===== */
function generateToken(){return crypto.randomBytes(32).toString('hex');}
function createResetToken(username){
 const token=generateToken();
 resetTokens.set(token,{username,expires:Date.now()+3600000,used:false}); /* 1 hour */
 return token;}
function validateResetToken(token){
 const t=resetTokens.get(token);
 if(!t)return{valid:false,reason:'Token not found.'};
 if(t.used)return{valid:false,reason:'Token already used.'};
 if(Date.now()>t.expires){resetTokens.delete(token);return{valid:false,reason:'Token expired.'};}
 return{valid:true,username:t.username};}
function consumeResetToken(token){const t=resetTokens.get(token);if(t){t.used=true;resetTokens.delete(token);}}
/* Clean expired tokens every 5 minutes */
setInterval(()=>{const n=Date.now();for(const[k,v]of resetTokens){if(n>v.expires||v.used)resetTokens.delete(k);}},300000);
/* ===== USERNAME VALIDATION ===== */
function usernameOK(name){
 name=String(name||'').trim();
 if(name.length<3||name.length>16)return false;
 if(!/^[A-Za-z0-9_-]+$/.test(name))return false;
 const low=name.toLowerCase();
 for(const w of BAD)if(low.includes(w))return false;
 return true;}
function findAccountByUsername(name){return ACCOUNTS[String(name||'').toLowerCase().trim()];}
function findAccountByEmail(email){email=String(email||'').toLowerCase().trim();
 for(const u in ACCOUNTS){if(ACCOUNTS[u].email&&ACCOUNTS[u].email.toLowerCase()===email)return ACCOUNTS[u];}
 return null;}

/* ================= SEEDS (51 existing + Alien Apple = 52) ================= */
const S=(id,n,rar,pr,sell,grow,fmin,fmax,wmin,wmax,type,fol,fru,reg)=>({id,n,rar,pr,sell,grow:grow*1000,fmin,fmax,wmin,wmax,type,fol,fru,reg:reg||0});
const SEEDS=[
 S('carrot','Carrot','Common',10,18,40,1,3,.1,.4,'root','#3f8f3a','#ff7b1c'),
 S('strawberry','Strawberry','Common',25,40,55,2,4,.05,.2,'berry','#3f8f3a','#e8324a',.5),
 S('potato','Potato','Common',15,26,50,2,3,.2,.7,'root','#4a8f45','#c9a566'),
 S('tomato','Tomato','Common',40,70,70,2,5,.1,.5,'bush','#3f8f3a','#e63b2a',.6),
 S('lettuce','Lettuce','Common',20,34,45,1,2,.3,1,'leaf','#6fbf4f','#9fd96a'),
 S('blueberry','Blueberry','Common',60,110,80,4,8,.02,.08,'berry','#3c7a3a','#3b5fd0',.5),
 S('radish','Radish','Common',12,22,35,1,2,.05,.25,'root','#3f8f3a','#e05575'),
 S('wheat','Wheat','Common',18,30,60,3,6,.05,.15,'stalk','#b8a84f','#e8d17a'),
 S('corn','Corn','Uncommon',130,220,100,2,3,.3,1,'stalk','#5aa04a','#f5d442'),
 S('cucumber','Cucumber','Uncommon',110,180,85,2,4,.2,.6,'vine','#4a9a4a','#4fb85f',.5),
 S('onion','Onion','Uncommon',95,160,75,1,3,.1,.5,'root','#6f9a4a','#d8c5a8'),
 S('raspberry','Raspberry','Uncommon',150,250,90,3,6,.03,.1,'berry','#3f8f3a','#d04a7a',.5),
 S('bellpepper','Bell Pepper','Uncommon',140,230,85,2,4,.1,.4,'bush','#4a8f45','#e33b2a',.6),
 S('sunflower','Sunflower','Uncommon',200,340,110,1,2,.5,2,'flower','#5a9a3a','#ffd23f'),
 S('pumpkin','Pumpkin','Uncommon',260,460,140,1,2,2,8,'vine','#4a8f3a','#f08a1c'),
 S('watermelon','Watermelon','Rare',500,900,170,1,2,3,12,'vine','#3f8f3a','#2a9a4a'),
 S('pineapple','Pineapple','Rare',550,1000,160,1,2,.8,2.5,'bush','#4a9a3a','#f0c030'),
 S('appletree','Apple Tree','Rare',900,1600,240,3,6,.15,.4,'tree','#4a7a3a','#e03b3b',.7),
 S('peachtree','Peach Tree','Rare',950,1700,250,3,6,.15,.45,'tree','#4a7a3a','#ffb07a',.7),
 S('dragonfruit','Dragon Fruit','Rare',800,1400,200,1,3,.3,1,'bush','#4a7a4a','#ff4a8a'),
 S('aloe','Aloe','Rare',600,1000,150,1,2,.2,.8,'leaf','#5a9a5a','#8fd98f'),
 S('chili','Chili Pepper','Rare',650,1150,150,2,5,.02,.08,'bush','#4a8f45','#e02020',.6),
 S('mint','Mint','Rare',500,850,130,2,4,.05,.2,'leaf','#4a9a5a','#7fd9a0',.5),
 S('mango','Mango Tree','Epic',2200,3800,300,3,5,.3,.9,'tree','#4a8a3a','#ffb02a',.7),
 S('banana','Banana Tree','Epic',2400,4200,310,3,6,.2,.6,'tree','#5a9a3a','#f5e04a',.7),
 S('cherryblossom','Cherry Blossom Tree','Epic',3000,5200,330,3,6,.05,.2,'tree','#7a6a8a','#ffaad4',.7),
 S('starfruit','Starfruit','Epic',2600,4500,290,2,4,.2,.7,'bush','#4a8a3a','#f5d02a'),
 S('flamepepper','Flame Pepper','Epic',2800,5000,300,2,4,.03,.1,'bush','#5a6a3a','#ff5a1a',.6),
 S('moonflower','Moonflower','Epic',3200,5500,340,1,3,.3,1.2,'flower','#3a5a6a','#cfe8ff'),
 S('goldenrose','Golden Rose','Epic',4000,7000,360,1,2,.1,.4,'flower','#3f7a3a','#ffd24a'),
 S('crystalberry','Crystal Berry','Legendary',9000,16000,420,3,6,.05,.2,'crystal','#5a8a7a','#8affff',.5),
 S('thundermelon','Thunder Melon','Legendary',10000,18000,440,1,2,4,15,'vine','#3a6a4b','#7ac2ff'),
 S('rainboworchid','Rainbow Orchid','Legendary',12000,21000,460,1,2,.2,.8,'flower','#4a7a5a','#ff9af0'),
 S('frostapple','Frost Apple','Legendary',13000,23000,470,3,6,.2,.5,'tree','#5a8a8a','#cfeaff',.7),
 S('solarsunflower','Solar Sunflower','Legendary',14000,25000,480,1,2,1,4,'flower','#5a8a2a','#ffcf2a'),
 S('emeraldvine','Emerald Vine','Legendary',15000,27000,500,2,5,.5,2,'vine','#2a7a4a','#2ae07a',.6),
 S('celestialpeach','Celestial Peach','Mythical',40000,70000,600,3,6,.3,.8,'tree','#4a5a8a','#ffd8f0',.7),
 S('voidtomato','Void Tomato','Mythical',45000,80000,620,2,5,.1,.5,'bush','#2a2a3a','#7a2aff',.6),
 S('phoenixpepper','Phoenix Pepper','Mythical',50000,90000,640,2,4,.05,.15,'bush','#5a3a2a','#ff8a2a',.6),
 S('galaxygrape','Galaxy Grape','Mythical',55000,95000,660,4,9,.02,.1,'vine','#3a3a5a','#c05aff',.6),
 S('dreamlily','Dream Lily','Mythical',60000,105000,680,1,3,.2,.9,'flower','#5a7a8a','#a0f0ff'),
 S('titanpumpkin','Titan Pumpkin','Mythical',70000,125000,720,1,1,20,80,'vine','#3a6a2a','#ff8a10'),
 S('demonthorn','Demon Thorn','Demon',150000,260000,800,2,4,.3,1.2,'bush','#2a1a1a','#8a1020'),
 S('hellfirepepper','Hellfire Pepper','Demon',170000,300000,830,2,5,.05,.2,'bush','#3a1a0a','#ff3a00',.6),
 S('bloodmoonrose','Blood Moon Rose','Demon',190000,330000,860,1,3,.15,.6,'flower','#2a0a0a','#c02030'),
 S('abyssalmelon','Abyssal Melon','Demon',220000,380000,900,1,2,10,40,'vine','#1a1a2a','#3a2a6a'),
 S('worldtree','World Tree','Divine',600000,1000000,1500,4,8,1,5,'tree','#4a8a3a','#ffe8a0',.8),
 S('eternallotus','Eternal Lotus','Divine',750000,1250000,1600,1,2,.5,2,'flower','#4a6a5a','#fff0d0'),
 S('cosmicdragonfruit','Cosmic Dragonfruit','Divine',900000,1500000,1800,2,4,1,4,'crystal','#3a2a5a','#ff8ae0'),
 S('primordialbloom','Primordial Bloom','Divine',1200000,2000000,2000,1,3,1,5,'flower','#5a4a2a','#ffcf8a'),
 S('rake','Rake','Divine',9999999,99999999,900,6,12,1,6,'crystal','#1a2a1a','#b0ff20'),
 /* ===== SEASON 2: THE REBIRTH ===== */
 S('alienapple','Alien Apple','Alienoic',5000000,10000000,600,3,7,.5,3,'alien','#0a2a0a','#39ff14'),
];
const SEED_MAP=Object.fromEntries(SEEDS.map(s=>[s.id,s]));

/* ================= MUTATIONS (30 existing + Alien = 31) ================= */
const M=(id,n,cat,mult,tint,glow)=>({id,n,cat,mult,tint,glow});
const MUTS=[
 M('silverleaf','Silverleaf','basic',1.4,'#d8dce0',0),M('golden','Golden','basic',2,'#ffd24a',.45),
 M('giant','Giant','basic',2.5,null,0),M('miniature','Miniature','basic',1.15,null,0),
 M('lush','Lush','basic',1.3,null,0),M('blooming','Blooming','basic',1.5,null,0),
 M('juicy','Juicy','basic',1.35,null,0),M('twisted','Twisted','basic',1.6,null,0),
 M('soaked','Soaked','weather',1.5,null,0),M('frosted','Frosted','weather',2,'#cfeaff',.2),
 M('charged','Charged','weather',3,'#ffe86a',.5),M('sunscorched','Sunscorched','weather',2,'#ff8a3a',.35),
 M('windtouched','Windtouched','weather',1.6,null,0),M('rainbow','Rainbow','weather',5,'#ff9af0',.5),
 M('moonlit','Moonlit','weather',2.5,'#cfe8ff',.4),M('meteoric','Meteoric','weather',3,'#ffbe6a',.5),
 M('eclipse','Eclipse-Touched','weather',4,'#3a2a4a',.4),M('bloomblessed','Bloomblessed','weather',2.2,'#ffd8f0',.3),
 M('crystalized','Crystalized','rare',8,'#9affff',.6),M('celestial','Celestial','rare',12,'#fff0b0',.7),
 M('voidtouched','Void-Touched','rare',10,'#5a2a9a',.6),M('prismatic','Prismatic','rare',15,'#ff6af0',.7),
 M('worldblessed','Worldblessed','rare',20,'#d8ff9a',.7),M('demonized','Demonized','rare',9,'#8a1020',.55),
 M('phoenixborn','Phoenix-Born','rare',11,'#ff5a1a',.7),M('galactic','Galactic','rare',14,'#4a3a9a',.6),
 M('ethereal','Ethereal','rare',8,'#e0f0ff',.5),M('ancient','Ancient','rare',7,'#a08050',.4),
 M('quantum','Quantum','rare',18,'#6affd0',.7),M('overgrown','Overgrown','rare',6,null,0),
 /* Season 2 */
 M('alien','Alien','alien',6,'#39ff14',.6)];
const MUT_MAP=Object.fromEntries(MUTS.map(m=>[m.id,m]));
const MUT_BASE={basic:.05,weather:.025,rare:.005,alien:.03},MUT_CAP=3,MUT_TOTAL_CAP=150;

/* ================= WEATHER (existing 34 + S2) ================= */
const E=(id,n,dur,w,sky,fog,fogFar,sun,sunI,grow,sell,boosts,x)=>Object.assign({id,n,dur:dur*1000,w,sky,fog,fogFar,sun,sunI,grow,sell,boosts},x||{});
const EVENTS=[
 E('sunny','Sunny Day',180,12,'#a8d8ff','#e8f4ff',1.6,'#fff2d0',1.25,1.15,1,{sunscorched:6,bloomblessed:4}),
 E('rain','Rainstorm',150,9,'#7a8f9a','#aebfc6',.7,'#c8d0d0',.6,1.4,1,{soaked:10},{rain:1}),
 E('thunder','Thunderstorm',140,8,'#4a5560','#78828c',.55,'#aab4b4',.45,1.4,1,{charged:14},{rain:1,lightning:1}),
 E('goldenhour','Golden Hour',120,7,'#ffca8a','#ffe0b0',1.3,'#ffc06a',1.15,1.05,1.1,{golden:8}),
 E('frostfall','Frostfall',170,7,'#c8dcec','#e4f0f8',.9,'#dce8f0',.85,.8,1,{frosted:10}),
 E('windstorm','Windstorm',130,7,'#a8c8d8','#cfe0e8',1.2,'#e0e8e0',.9,1.05,1,{windtouched:12},{wind:1}),
 E('fogbloom','Fog Bloom',150,6,'#b8c8c0','#d0dcd0',.45,'#e0e0d0',.7,1.1,1,{bloomblessed:8}),
 E('rainboww','Rainbow Weather',120,4,'#a8d0ff','#e0ecff',1.5,'#fff0d0',1.1,1.05,1.05,{rainbow:16},{rainbow:1}),
 E('meteors','Meteor Shower',160,3,'#2a3550','#4a5570',1.4,'#a0b0d0',.5,1.05,1,{meteoric:14},{meteors:1}),
 E('bloodmoon','Blood Moon',180,2,'#5a1a1a','#7a2a2a',.8,'#ff6a5a',.5,1.05,1,{demonized:12},{moon:'#ff5040'}),
 E('eclipse','Eclipse',150,2,'#2a2a3a','#4a4a5a',.9,'#8a8aa0',.4,1.05,1,{eclipse:16},{moon:'#6a5a8a'}),
 E('aurora','Aurora Night',200,2,'#1a2a4a','#2a4a5a',1.3,'#7ac2a0',.45,1.05,1,{moonlit:12},{aurora:1}),
 E('celestialsh','Celestial Shower',150,1,'#1a2240','#33405e',1.2,'#c0c8ff',.5,1.05,1,{celestial:14},{stars:1}),
 E('cosmicbloom','Cosmic Bloom',170,1,'#241a48','#3a2a5e',1.1,'#a08aff',.55,1.05,1,{galactic:14}),
 E('crystalrain','Crystal Rain',150,2,'#9ad8e8','#c0ecf4',1,'#d0f0f8',.8,1.1,1,{crystalized:14}),
 E('solarflare','Solar Flare',120,2,'#ffca5a','#ffe0a0',1.3,'#ffd04a',1.3,1.2,1,{sunscorched:12},{solar:1}),
 E('moonflower','Moonflower Night',160,2,'#1a2a4e','#2a3a5e',1.1,'#8ab0ff',.5,1.1,1,{moonlit:8,bloomblessed:8},{moon:'#cfe8ff',glowflora:1}),
 E('dreammist','Dream Mist',170,2,'#c0b8d8','#d8d0e8',.6,'#e0d8f0',.75,1.1,1,{ethereal:12}),
 E('voidrift','Void Rift',150,1,'#2a1a3a','#4a2a5a',.8,'#9a6aff',.45,1.05,1,{voidtouched:14},{rift:1}),
 E('quantumstorm','Quantum Storm',140,1,'#3a2a5a','#5a4a7a',1.1,'#6affe0',.6,1.05,1,{quantum:16},{quantum:1}),
 E('superbloom','Super Bloom',200,3,'#a8d8b0','#e0f4e0',1.5,'#fff0c0',1.15,1.25,1,{blooming:10,bloomblessed:8},{flora:1}),
 E('giantgrowth','Giant Growth',160,2,'#b0d8a0','#e0f0d0',1.4,'#fff0c0',1.1,1.5,1,{giant:14},{giant:1}),
 E('luckyharvest','Lucky Harvest',150,2,'#c0e8a0','#e8f4d0',1.4,'#fff8d0',1.1,1.05,1.15,{golden:6},{clover:1}),
 E('ancientawake','Ancient Awakening',170,1,'#8a8a6a','#b0aa90',.9,'#d0c8a0',.7,1.1,1,{ancient:14},{runes:1}),
 E('phoenixdawn','Phoenix Dawn',150,1,'#ff9a4a','#ffbe8a',1.2,'#ff8a3a',.95,1.1,1,{phoenixborn:14},{embers:1}),
 E('demonhour','Demon Hour',150,1,'#4a1018','#6a1a22',.8,'#c03a30',.5,1.05,1,{demonized:12},{moon:'#c03020',embers:1}),
 E('worldtree','World Tree Blessing',200,1,'#a0d8a0','#d8f0d0',1.4,'#e0ffb0',1.05,1.3,1,{worldblessed:16},{worldtree:1,flora:1}),
 E('harvestfest','Harvest Festival',240,2,'#f0b86a','#ffe0b0',1.4,'#ffd8a0',1.1,1.1,1.2,{golden:5},{festival:1,tokens:1}),
 E('adminchaos','Admin Chaos',120,0,'#3a2a5a','#5a4a7a',1.1,'#ff9a6a',.8,2,1.5,{prismatic:10,quantum:10,celestial:8}),
 E('converge','Supernatural Convergence',180,0,'#2a1a4e','#4a3a6e',1,'#b08aff',.6,1.4,1.2,{prismatic:8,celestial:8,galactic:8,voidtouched:8,quantum:8,worldblessed:6}),
 E('rave','Rave',300,0,'#060309','#10071a',.7,'#a06aff',.28,1.15,1.15,{moonlit:10,demonized:6},{rave:1}),
 E('spookfog','Spooky Fog',200,3,'#1a1420','#241a2c',.5,'#6a5a80',.45,1.05,1,{moonlit:6},{spfog:1,seasonal:1}),
 E('witchwind','Witching Wind',160,3,'#241a2e','#34283e',1.1,'#8a7aa0',.6,1.05,1,{windtouched:10},{wind:1,spLeaves:1,seasonal:1}),
 E('hauntrain','Haunted Rain',170,2,'#141824','#22262f',.6,'#7a8aa0',.4,1.2,1,{soaked:8,moonlit:5},{rain:1,haunted:1,seasonal:1}),
 E('ghoststorm','Ghost Storm',150,1,'#101018','#1e1e2a',.8,'#9aa0c0',.4,1.05,1,{ethereal:8},{ghosts:1,seasonal:1}),
 /* ===== SEASON 2 EVENTS ===== */
 E('alienglow','Alien Glow',180,3,'#0a2a0a','#0a1a0a',.7,'#39ff14',.3,1.3,1.1,{alien:20},{alien:1,seasonal:2}),
 E('heartbeat','Heartbeat',120,2,'#2a0a0a','#4a1010',.8,'#ff2040',.4,1.2,1.1,{demonized:8},{heart:1,seasonal:2}),
 E('corruptionsurge','Corruption Surge',150,2,'#1a1a1a','#3a1a2a',.7,'#a02080',.4,1.15,1,{demonized:15,voidtouched:10},{corrupt:1,seasonal:2}),
 /* ===== THE HAUNTED HARVEST — Pumpkin King Invasion =====
    Auto-triggers every 20 minutes. Can also be manually triggered via admin CHAOS workflow.
    Has 4 phases managed by G.hauntedHarvest state machine. */
 E('hauntedharvest','The Haunted Harvest',360,0,'#1a0a0a','#2a0a14',.5,'#ff6020',.45,1.2,1.2,{golden:8,demonized:6},{hauntedharvest:1}),
];
const EV_MAP=Object.fromEntries(EVENTS.map(e=>[e.id,e]));

/* ================= HAUNTED HARVEST state machine =================
   4 phases: arrival (10s) → hunt (60s) → boss (90s) → finale (15s)
   Server-authoritative. Boss health synced to all players. */
const HH_PHASES={ARRIVAL:0,HUNT:1,BOSS:2,FINALE:3};
const HH_DURATION={arrival:10000,hunt:60000,boss:90000,finale:15000};
const HH_AUTO_INTERVAL=20*60*1000; /* 20 minutes */
function hhStatePacket(){return{
  active:!!G.hauntedHarvest.active,
  phase:G.hauntedHarvest.phase,
  phaseEnd:G.hauntedHarvest.phaseEnd,
  bossHealth:G.hauntedHarvest.bossHealth,
  bossMaxHealth:G.hauntedHarvest.bossMaxHealth,
  altarProgress:G.hauntedHarvest.altarProgress,
  altarTarget:G.hauntedHarvest.altarTarget,
  cursedSeeds:G.hauntedHarvest.cursedSeeds||{},
  pumpkins:G.hauntedHarvest.pumpkins||[],
  minions:G.hauntedHarvest.minions||[],
  treasures:G.hauntedHarvest.treasures||[],
  participants:[...(G.hauntedHarvest.participants||[])],
  serverTime:now()
};}
function hhStart(byAdmin){
 if(G.hauntedHarvest.active)return false;
 G.hauntedHarvest={
  active:true,phase:HH_PHASES.ARRIVAL,phaseEnd:now()+HH_DURATION.arrival,
  bossHealth:0,bossMaxHealth:1000,altarProgress:0,altarTarget:50,
  cursedSeeds:{},pumpkins:[],minions:[],treasures:[],
  participants:[],rewarded:[],startedBy:byAdmin?'admin':'auto',startedAt:now()
 };
 /* Spawn 8 cursed pumpkins at fixed world locations for the Hunt phase */
 const pumpkinSpots=[[-30,-30],[30,-30],[-30,30],[30,30],[0,-40],[0,40],[-40,0],[40,0]];
 G.hauntedHarvest.pumpkins=pumpkinSpots.map((p,i)=>({id:'HHp'+i,x:p[0],z:p[1],taken:false}));
 broadcast({t:'hhState',hh:hhStatePacket()});
 broadcast({t:'toast',msg:'🎃 THE HAUNTED HARVEST has begun! The Pumpkin King awakens...',kind:'event'});
 log(byAdmin?'admin:hh:start':'hh:autoStart','global','');
 G.dirty=true;
 return true;}
function hhEnd(){
 G.hauntedHarvest={active:false,phase:0,phaseEnd:0,bossHealth:0,bossMaxHealth:1000,altarProgress:0,altarTarget:50,cursedSeeds:{},pumpkins:[],minions:[],treasures:[],participants:[],rewarded:[]};
 broadcast({t:'hhState',hh:hhStatePacket()});
 G.dirty=true;}
function hhAdvancePhase(){
 if(!G.hauntedHarvest.active)return;
 const ph=G.hauntedHarvest.phase;
 if(ph===HH_PHASES.ARRIVAL){
  G.hauntedHarvest.phase=HH_PHASES.HUNT;
  G.hauntedHarvest.phaseEnd=now()+HH_DURATION.hunt;
  broadcast({t:'toast',msg:'🎃 Phase 2: THE HUNT — collect Cursed Seeds from Cursed Pumpkins!',kind:'event'});
 }else if(ph===HH_PHASES.HUNT){
  G.hauntedHarvest.phase=HH_PHASES.BOSS;
  G.hauntedHarvest.phaseEnd=now()+HH_DURATION.boss;
  G.hauntedHarvest.bossHealth=G.hauntedHarvest.bossMaxHealth;
  broadcast({t:'toast',msg:'🎃 Phase 3: THE BOSS — attack the Pumpkin King with seeds!',kind:'event'});
 }else if(ph===HH_PHASES.BOSS){
  G.hauntedHarvest.phase=HH_PHASES.FINALE;
  G.hauntedHarvest.phaseEnd=now()+HH_DURATION.finale;
  broadcast({t:'toast',msg:'🎃 Phase 4: THE FINALE — treasures appear! Collect your rewards!',kind:'event'});
  /* Spawn treasures at random locations */
  G.hauntedHarvest.treasures=[];
  for(let i=0;i<10;i++){
   const a=Math.random()*6.28,d=20+Math.random()*60;
   G.hauntedHarvest.treasures.push({id:'HHt'+i,x:Math.cos(a)*d,z:Math.sin(a)*d,taken:false,rarity:['Common','Rare','Epic','Legendary'][Math.floor(Math.random()*4)]});
  }
 }else if(ph===HH_PHASES.FINALE){
  /* End the event */
  broadcast({t:'toast',msg:'🎃 The Haunted Harvest has ended. See you next time!',kind:'info'});
  hhEnd();
  return;
 }
 broadcast({t:'hhState',hh:hhStatePacket()});
 G.dirty=true;}
/* Tick the Haunted Harvest state machine every 1 second */
setInterval(()=>{
 if(!G.hauntedHarvest||!G.hauntedHarvest.active)return;
 if(now()>=G.hauntedHarvest.phaseEnd)hhAdvancePhase();
},1000);
/* Auto-trigger every 20 minutes — only if not already active */
setInterval(()=>{
 if(G.hauntedHarvest&&G.hauntedHarvest.active)return;
 hhStart(false);
},HH_AUTO_INTERVAL);

/* ================= ROLE SHOP (purchasable roles) =================
   Players can buy these roles from the Game Shop. Each role has a price + benefits.
   - VIP: 2x speed + 2k sheckles/day for 2 relics
   - Novice: 10k sheckles/day + 0.5 relics/day for 20 relics
   - Scuba: 5x money multiplier for 1 billion sheckles (LIMITED — only available for 24 hours after first server start, then gone forever) */
const SHOP_ROLES=[
 {id:'vip',n:'VIP',icon:'◆',color:'#ffd24a',effect:'glow',
  cur:'relics',price:2,
  benefits:{speedBoost:2,cashPerDay:2000},
  desc:'2x speed boost + 2,000 sheckles/day',
  bg:'#3a2810',bgAccent:'#ffd24a'},
 {id:'novice',n:'Novice',icon:'★',color:'#a86fd6',effect:'neon',
  cur:'relics',price:20,
  benefits:{cashPerDay:10000,relicsPerDay:0.5},
  desc:'10,000 sheckles/day + 0.5 relics/day',
  bg:'#1a0a3a',bgAccent:'#a86fd6'},
 {id:'scuba',n:'Scuba',icon:'🏊',color:'#3ac0e0',effect:'ice',
  cur:'cash',price:1000000000,
  benefits:{sellBoost:5},
  desc:'5x money multiplier on all fruit sales',
  bg:'#0a2a3a',bgAccent:'#3ac0e0',
  limited:true,limitedDurationMs:24*60*60*1000 /* 24 hours */}
];
const SHOP_ROLE_MAP=Object.fromEntries(SHOP_ROLES.map(r=>[r.id,r]));
/* When the server first starts, set the Scuba limited timer */
if(!global._scubaExpiresAt){
 global._scubaExpiresAt=Date.now()+24*60*60*1000;
}
function getShopRolesState(){
 /* Returns the list of available shop roles, with Scuba's expiry timestamp if limited */
 return SHOP_ROLES.map(r=>{
  const out={...r};
  if(r.limited){
   out.expiresAt=global._scubaExpiresAt;
   out.expired=Date.now()>global._scubaExpiresAt;
  }
  return out;
 });
}

/* ================= GEAR / PETS / EGGS ================= */
const GEAR=[
 {id:'watercan',n:'Basic Watering Can',pr:100,fx:{water:1.6}},{id:'watercan2',n:'Improved Watering Can',pr:800,fx:{water:1.8}},
 {id:'watercanG',n:'Golden Watering Can',pr:2500,fx:{water:2}},{id:'shovel',n:'Shovel',pr:50,fx:{}},
 {id:'gloves',n:'Harvesting Gloves',pr:400,fx:{fruit:.25}},{id:'sprinkler',n:'Basic Sprinkler',pr:800,fx:{sprinkler:1.3}},
 {id:'sprinkler2',n:'Advanced Sprinkler',pr:3000,fx:{sprinkler:1.6}},{id:'sprinklerG',n:'Golden Sprinkler',pr:12000,fx:{sprinkler:2}},
 {id:'lamp',n:'Growth Lamp',pr:1500,fx:{grow:.1}},{id:'beacon',n:'Mutation Beacon',pr:5000,fx:{beacon:1.5}},
 {id:'basket',n:'Fruit Basket',pr:600,fx:{cap:20}},{id:'storage',n:'Storage Upgrade',pr:1500,fx:{cap:40}},
 {id:'charm',n:'Weather Charm',pr:2000,fx:{charm:.05}},{id:'toolkit',n:'Harvesting Tool',pr:250,fx:{reach:2}},
 {id:'decor',n:'Garden Decoration Pack',pr:1000,fx:{decor:.03}}];
const GEAR_MAP=Object.fromEntries(GEAR.map(g=>[g.id,g]));
const PETS=[
 ['bunny','Bunny','Common','bunny','#e8e0d0','growth',.04],['bee','Bee','Common','bee','#f0c030','mut',.02],
 ['ladybug','Ladybug','Common','bug','#e04a3a','mut',.02],['cat','Cat','Common','cat','#c8946a','sell',.03],
 ['dog','Dog','Common','dog','#a07a4a','fruit',.03],['turtle','Turtle','Common','turtle','#5a9a4a','growth',.05],
 ['fox','Fox','Uncommon','fox','#e08a3a','fruit',.05],['owl','Owl','Uncommon','owl','#8a7a5a','mut',.04],
 ['parrot','Parrot','Uncommon','parrot','#3ac0e0','token',.25],['deer','Deer','Uncommon','deer','#b08a5a','growth',.08],
 ['gbee','Golden Bee','Rare','bee','#ffd24a','golden',.5],['cfox','Crystal Fox','Rare','fox','#9affff','crystalized',.5],
 ['thawk','Thunder Hawk','Rare','hawk','#8a8a9a','charged',.5],['fwolf','Frost Wolf','Rare','wolf','#d0e8ff','frosted',.5],
 ['phoenix','Phoenix','Epic','phoenix','#ff6a2a','phoenixborn',.5],['dbat','Demon Bat','Epic','bat','#3a1a2a','demonized',.5],
 ['cdragon','Celestial Dragon','Legendary','dragon','#fff0b0','mut',.12],['vserpent','Void Serpent','Legendary','serpent','#5a2a9a','voidtouched',.6],
 ['wspirit','World Spirit','Legendary','spirit','#d8ff9a','worldblessed',.6],['cwhale','Cosmic Whale','Mythical','whale','#4a3a9a','token',1],
 ['demonimp','Demon Imp','Demon','imp','#8a1020','sell',.15],['celestialcat','Celestial Cat','Divine','cat','#fff0c8','mut',.15],
 ['emberhare','Ember Hare','Epic','bunny','#ff8a5a','sunscorched',.5],
 ['demoneye','Demon Eye','Mythical','eye','#ff2010','event',1],
 /* ===== SEASON 2 ===== */
 ['godalien','Godalien','Alienoic','alien','#39ff14','alienmut',.20]
].map(p=>({id:p[0],n:p[1],rar:p[2],form:p[3],col:p[4],bt:p[5],bv:p[6]}));
const PET_MAP=Object.fromEntries(PETS.map(p=>[p.id,p]));
const EGGS=[
 ['egg_c','Common Egg',500,[['bunny',30],['bee',30],['ladybug',25],['cat',15]]],
 ['egg_u','Uncommon Egg',1800,[['dog',30],['turtle',25],['fox',20],['owl',15],['parrot',10]]],
 ['egg_r','Rare Egg',6000,[['deer',35],['gbee',20],['cfox',18],['thawk',15],['fwolf',12]]],
 ['egg_e','Epic Egg',20000,[['phoenix',35],['dbat',35],['emberhare',30]]],
 ['egg_l','Legendary Egg',60000,[['cdragon',40],['vserpent',35],['wspirit',25]]],
 ['egg_m','Mythical Egg',200000,[['cwhale',55],['demonimp',45]]],
 ['egg_d','Demon Egg',350000,[['demonimp',60],['dbat',40]]],
 ['egg_cel','Celestial Egg',500000,[['celestialcat',55],['cdragon',45]]],
 ['egg_cos','Cosmic Egg',800000,[['celestialcat',40],['cwhale',35],['cdragon',25]]],
 ['egg_ev','Limited Event Egg',15000,[['parrot',40],['gbee',30],['phoenix',20],['wspirit',10]]]
].map(e=>({id:e[0],n:e[1],pr:e[2],rar:e[3],pool:e[4]}));
const EGG_MAP=Object.fromEntries(EGGS.map(e=>[e.id,e]));
const QUESTS=[
 ['q1','Plant your first seed','plant',1,{cash:100}],['q2','Harvest your first crop','harvest',1,{cash:150,seeds:{carrot:3}}],
 ['q3','Sell your first fruit','sell',1,{cash:100}],['q4','Buy a new seed variety','buySeedType',2,{cash:200}],
 ['q5','Grow five crops','harvest',5,{cash:300,seeds:{tomato:2}}],['q6','Earn a mutation','mutations',1,{cash:500}],
 ['q7','Purchase an egg','eggsBought',1,{cash:400}],['q8','Hatch a pet','petsHatched',1,{cash:500}],
 ['q9','Equip a pet','petsEquipped',1,{cash:300}],['q10','Water a crop','watered',1,{cash:100}],
 ['q11','Experience a weather event','weatherSeen',2,{cash:250}],['q12','Harvest a mutated fruit','mutHarvest',1,{cash:800}],
 ['q13','Expand your plot','expansion',1,{cash:1000}],['q14','Earn 5000 total sheckles','earned',5000,{cash:1500,egg:'egg_r'}],
 ['q15','Discover a rare crop','rareHarvest',1,{cash:2500,seeds:{watermelon:1}}]
].map(q=>({id:q[0],n:q[1],stat:q[2],goal:q[3],reward:q[4]}));
const DAILY=[{cash:250},{seeds:{carrot:5}},{cash:500},{seeds:{corn:3}},{cash:1000},{egg:'egg_c'},{cash:2000,egg:'egg_r'}];

/* ================= EMOTES / PASS DATA ================= */
const EMOTE_CATALOG=[
 {id:'eerie_wave',n:'Eerie Wave',rar:'Common',pr:400},{id:'ghost_nod',n:'Ghostly Nod',rar:'Common',pr:350},
 {id:'cackle',n:'Witch Cackle',rar:'Uncommon',pr:2500},{id:'pumpkin_spin',n:'Pumpkin Spin',rar:'Uncommon',pr:3500},
 {id:'zombie_walk',n:'Zombie Shamble',rar:'Rare',pr:12000},{id:'moon_bow',n:'Moonlit Bow',rar:'Rare',pr:15000},
 {id:'haunt_dance',n:'Haunting Dance',rar:'Epic',pr:60000},{id:'scare',n:'Jump Scare',rar:'Epic',pr:80000},
 {id:'reaper_spin',n:"Reaper's Waltz",rar:'Legendary',pr:300000},{id:'phantom_rise',n:'Phantom Rise',rar:'Mythical',pr:1200000}];
const EMOTE_MAP=Object.fromEntries(EMOTE_CATALOG.map(e=>[e.id,e]));
const PASS_EMOTES={pass_salute:{n:'Spooky Salute',rar:'Uncommon'},pass_drift:{n:'Spirit Drift',rar:'Rare'},
 pass_curse:{n:'Cursed Shamble',rar:'Rare'},pass_gaze:{n:'Abyssal Gaze',rar:'Epic'},pass_mimic:{n:'Shadow Mimic',rar:'Epic'},
 pass_waltz:{n:'Haunting Waltz',rar:'Epic'},pass_shriek:{n:'Banshee Shriek',rar:'Epic'},pass_reap:{n:"Reaper's Bow",rar:'Legendary'},
 pass_soul:{n:'Soul Laughter',rar:'Legendary'},pass_rise:{n:'Eternal Rise',rar:'Legendary'},pass_spin:{n:'Eternal Spiral',rar:'Mythical'}};
const SKINS={spooky:{n:'Spooky Farmer'},wraith:{n:'Wraith Farmer'},bonelord:{n:'Bone Lord'},
 pumpkinking:{n:'Pumpkin King'},plague:{n:'Plague Doctor'},voidreaper:{n:'Void Reaper'},eternalnight:{n:'Eternal Night'},
 bloodknight:{n:'Blood Knight'},shadowmage:{n:'Shadow Mage'},ghosthunter:{n:'Ghost Hunter'},witchbrew:{n:'Witch Brew'},
 candycorn:{n:'Candy Corn'},nightterror:{n:'Night Terror'},hauntedarmor:{n:'Haunted Armor'},
 cryptkeeper:{n:'Crypt Keeper'},spectralhunter:{n:'Spectral Hunter'},reaperlord:{n:'Reaper Lord'}};
const COSMETICS=[
 {id:'pumpkin_head',n:'Pumpkin Head',rar:'Rare',pr:50000},{id:'witch_hat',n:'Witch Hat',rar:'Epic',pr:75000},
 {id:'skull_mask',n:'Skull Mask',rar:'Epic',pr:100000},{id:'spectral_aura',n:'Spectral Aura',rar:'Legendary',pr:200000},
 {id:'crown',n:'Golden Crown',rar:'Legendary',pr:150000},{id:'top_hat',n:'Top Hat',rar:'Epic',pr:80000},
 {id:'halo',n:'Holy Halo',rar:'Mythical',pr:300000},{id:'demon_horns',n:'Demon Horns',rar:'Demon',pr:250000}];
const COS_MAP=Object.fromEntries(COSMETICS.map(c=>[c.id,c]));
/* ===== CHARACTER BODY SKINS (full model replacements) ===== */
const CHAR_BODIES=[
 {id:'farmer',n:'Farmer',rar:'Common',pr:0},
 {id:'skeleton',n:'Spooky Skeleton',rar:'Rare',pr:50000},
 {id:'ghost',n:'Ghost',rar:'Epic',pr:80000},
 {id:'vampire',n:'Vampire',rar:'Epic',pr:100000},
 {id:'mummy',n:'Mummy',rar:'Rare',pr:60000},
 {id:'witch',n:'Witch',rar:'Epic',pr:90000},
 {id:'zombie',n:'Zombie',rar:'Rare',pr:55000},
 {id:'reaper',n:'Grim Reaper',rar:'Legendary',pr:200000},
 {id:'frankenstein',n:'Frankenstein',rar:'Epic',pr:85000},
 {id:'pumpkinhead',n:'Pumpkin Head',rar:'Rare',pr:65000},
 {id:'batcreature',n:'Bat Creature',rar:'Epic',pr:95000},
 {id:'spider',n:'Giant Spider',rar:'Legendary',pr:180000},
 {id:'slime',n:'Slime Monster',rar:'Uncommon',pr:35000},
 {id:'scarecrow',n:'Living Scarecrow',rar:'Rare',pr:58000},
 {id:'demon',n:'Demon',rar:'Demon',pr:250000}];
const CHAR_BODY_MAP=Object.fromEntries(CHAR_BODIES.map(b=>[b.id,b]));
/* ===== PORTAL WORLD — life-sim with Rupees, houses, jobs ===== */
const HOUSE_TIERS=[
 {id:0,n:'Shack',cost:0},
 {id:1,n:'House',cost:5000},
 {id:2,n:'Mansion',cost:50000}];
const JOB_DEFS=[
 {id:'dogwalk',n:'Dog Walking',payout:100,cd:120000},
 {id:'factory',n:'Factory Work',payout:150,cd:120000},
 {id:'pizza',n:'Pizza Delivery',payout:120,cd:120000},
 {id:'farmhand',n:'Farm Hand',payout:80,cd:120000}];
const HOUSE_EGG_COST=2000;
const HOUSE_EGG_PETS=[
 {id:'puppy',n:'Puppy',rar:'Common',ch:30,boost:0},
 {id:'kitten',n:'Kitten',rar:'Common',ch:25,boost:0},
 {id:'hamster',n:'Hamster',rar:'Uncommon',ch:20,boost:0.05},
 {id:'parrot',n:'Parrot',rar:'Rare',ch:15,boost:0.10},
 {id:'minidragon',n:'Mini Dragon',rar:'Epic',ch:9,boost:0.25},
 {id:'workbear',n:'Work Work Work Bear',rar:'Mythical',ch:1,boost:9} /* 10x = +900% */
];
function defaultPortal(){return{zone:null,houseTier:0,rupees:0,lastSleep:'',
 jobCd:{},pets:[],activePet:null,visited:''};}
const FREE_REWARDS={1:{cash:500},2:{emote:'pass_salute'},3:{cash:1000},4:{cash:2500},5:{relics:1},
 6:{emote:'pass_drift'},7:{cash:5000},8:{cash:7500},9:{cash:10000},10:{pet:'demoneye'},
 11:{cash:25000},12:{relics:1},13:{emote:'pass_curse'},14:{cash:50000},15:{skin:'spooky'},
 16:{cash:100000},17:{relics:1},18:{cash:250000},19:{cash:500000},20:{relics:2,cash:1000000}};
const GOLD_REWARDS={1:{cash:50000},2:{emote:'pass_gaze'},3:{cash:100000},4:{skin:'wraith'},
 5:{cash:250000,emote:'pass_mimic'},6:{cash:500000},7:{emote:'pass_waltz'},8:{relics:1},
 9:{cash:1000000},10:{skin:'bonelord'},11:{cash:2500000,emote:'pass_shriek'},12:{emote:'pass_reap'},
 13:{cash:5000000},14:{skin:'pumpkinking'},15:{cash:10000000,emote:'pass_soul'},16:{cash:25000000},
 17:{skin:'plague',emote:'pass_rise'},18:{skin:'voidreaper'},19:{cash:50000000,emote:'pass_spin'},
 20:{skin:'eternalnight',cash:890000000}};
function passXPNeeded(lvl){return 60+(lvl-1)*35;}

/* ================= GAME STATE ================= */
const G={players:new Map(),plants:new Map(),plots:new Array(PLOT_POS.length).fill(null),stock:{},restockAt:0,
 event:null,nextEventRoll:0,recentEvents:[],paused:false,growMul:1,mutCap:MUT_CAP,
 season:{id:'SPOOKY',name:'Season 1: SPOOKY',status:'inactive',launchAt:0,cinematicAt:0,active:false},
 shopConfig:{},emoteStock:{},emoteRestockAt:0,
 maintenance:{active:false,until:0,msg:'',by:''},
 /* ===== SEASON 2: THE REBIRTH ===== */
 s2:{phase:'idle',met:null,heartFed:0,heartActive:false,act:0,deciderClaimed:null,
     totalBloodDrops:0,meteorAt:0,corruptionLevel:0,heartNearDeath:false,
     act2Launched:false,act2LaunchedAt:0,deciderWishes:[]},
 /* ===== GLOBAL COUNTDOWN TIMER ===== */
 timer:{active:false,end:0,text:'',color:'#e8a33d',event:'',by:''},
 /* ===== PORTAL VISIBILITY TOGGLE ===== */
 portalEnabled:false,
 /* ===== AUCTION HOUSE ===== */
 auction:{active:false,item:'',itemType:'',itemName:'',itemRar:'',basePrice:0,currency:'cash',
  highestBid:0,highestBidder:null,highestBidderName:'',bids:[],endAt:0,extensionsUsed:0,by:''},
 /* ===== HAUNTED HARVEST state machine (4 phases, server-authoritative) ===== */
 hauntedHarvest:{active:false,phase:0,phaseEnd:0,bossHealth:0,bossMaxHealth:1000,altarProgress:0,altarTarget:50,cursedSeeds:{},pumpkins:[],minions:[],treasures:[],participants:[],rewarded:[]},
 /* ===== CHAOS ACTIVATION state — prevents duplicate chaos triggers during cinematic ===== */
 chaosActivation:{active:false,startedAt:0,events:[],snapScheduledAt:0},
 adminSessions:new Map(),authFails:new Map(),logs:[],startedAt:Date.now(),savedAt:Date.now(),dirty:false,nextId:1};
G.maintenance={active:false,until:0,msg:'',fix:'',by:''};

function defaultMaxFor(s){return s.id==='rake'||s.id==='alienapple'?0:s.rar==='Common'?50:s.rar==='Uncommon'?25:s.rar==='Rare'?8:s.rar==='Epic'?4:s.rar==='Legendary'?2:1;}
function seedStockInit(){const st={};for(const s of SEEDS){const max=defaultMaxFor(s);st[s.id]={max,qty:max===0?0:Math.random()<.9?rint(1,max):0};}return st;}
function defaultShopConfig(){const c={};for(const s of SEEDS){c[s.id]={enabled:defaultMaxFor(s)>0,price:s.pr,weight:75,rarity:s.rar,max:defaultMaxFor(s),always:false};}return c;}
function priceMap(){const m={};for(const id in G.shopConfig)m[id]=G.shopConfig[id].price;return m;}
function rotateEmoteShop(){const pool=EMOTE_CATALOG.slice();const picked=[];
 while(picked.length<6&&pool.length)picked.push(pool.splice(rint(0,pool.length-1),1)[0]);
 G.emoteStock={};picked.forEach(e=>G.emoteStock[e.id]=rint(1,2));
 G.emoteRestockAt=now()+EMOTE_RESTOCK_MS;
 broadcast({t:'emoteStock',stock:G.emoteStock,restockAt:G.emoteRestockAt});}

function serializePlayer(p){return{id:p.id,pid:p.pid||'',name:p.name,cash:p.cash,tokens:p.tokens,relics:p.relics||0,
 plot:p.plot,expansion:p.expansion,seeds:p.seeds,produce:p.produce,gear:p.gear,eggs:p.eggs,pets:p.pets,packs:p.packs||0,
 stats:p.stats,quests:p.quests,daily:p.daily,discovered:p.discovered,
 passXP:p.passXP||0,passLevel:p.passLevel||1,freeClaimed:p.freeClaimed||[],goldOwned:!!p.goldOwned,goldClaimed:p.goldClaimed||[],
 emotes:p.emotes||{},skins:p.skins||{},activeSkin:p.activeSkin||null,
 cosmetics:p.cosmetics||{},activeCosmetic:p.activeCosmetic||null,
 charBody:p.charBody||'farmer',charHat:p.charHat||null,
 charShirt:p.charShirt||0x4f8a5c,charPants:p.charPants||0x4a5a7a,charSkinCol:p.charSkinCol||0xe8b48a,
 ownedCharBodies:p.ownedCharBodies||['farmer'],
 lastAbility:p.lastAbility||0,relicDay:p.relicDay||'',relicDrops:p.relicDrops||0,
 bloodDrops:p.bloodDrops||0,lastAlienTry:p.lastAlienTry||0,deciderBought:!!p.deciderBought,
 hhPumpkins:p.hhPumpkins||0,
 role:p.role||'player',roleColor:p.roleColor||'',roleEffect:p.roleEffect||'none',roleGlow:!!p.roleGlow,roleBenefits:p.roleBenefits||{},roleGivenBy:p.roleGivenBy||'',lastRolePay:p.lastRolePay||0,lastRolePayKey:p.lastRolePayKey||'',
 portal:p.portal||null};}
function save(){try{const data={savedAt:Date.now(),nextId:G.nextId,plots:G.plots,stock:G.stock,restockAt:G.restockAt,
 season:G.season,shopConfig:G.shopConfig,emoteStock:G.emoteStock,emoteRestockAt:G.emoteRestockAt,
 maintenance:G.maintenance,s2:G.s2,timer:G.timer,portalEnabled:G.portalEnabled,auction:G.auction,
 event:G.event?{id:G.event.def.id,start:G.event.start,end:G.event.end}:null,
 scubaExpiresAt:global._scubaExpiresAt||0, /* persist Scuba limited-time timer across server restarts */
 players:[...G.players.values()].map(serializePlayer),plants:[...G.plants.values()]};
 if(fs.existsSync(SAVE_FILE)){try{fs.copyFileSync(SAVE_FILE,SAVE_BAK);}catch(e){}}
 fs.writeFileSync(SAVE_FILE+'.tmp',JSON.stringify(data));fs.renameSync(SAVE_FILE+'.tmp',SAVE_FILE);
 G.savedAt=Date.now();G.dirty=false;}catch(e){console.error('[FARM] save failed:',e.message);}}
function load(){let raw=null;
 if(fs.existsSync(SAVE_FILE))raw=fs.readFileSync(SAVE_FILE,'utf8');
 else if(fs.existsSync(SAVE_BAK))raw=fs.readFileSync(SAVE_BAK,'utf8');
 if(!raw){G.stock=seedStockInit();G.shopConfig=defaultShopConfig();G.restockAt=Date.now()+RESTOCK_MS;rotateEmoteShop();return;}
 try{const d=JSON.parse(raw);G.nextId=d.nextId||1;
  G.plots=(d.plots||new Array(6).fill(null)).slice(0,6);while(G.plots.length<6)G.plots.push(null);
  G.stock=d.stock&&typeof d.stock==='object'&&!Array.isArray(d.stock)?d.stock:seedStockInit();
  const def=defaultShopConfig();G.shopConfig=Object.assign(def,d.shopConfig||{});
  for(const s of SEEDS){if(!G.shopConfig[s.id])G.shopConfig[s.id]=def[s.id];
   if(!G.stock[s.id]||typeof G.stock[s.id]!=='object')G.stock[s.id]={max:defaultMaxFor(s),qty:0};
   G.shopConfig[s.id].price=Math.max(0,Math.round(+G.shopConfig[s.id].price||s.pr));
   G.shopConfig[s.id].weight=Math.max(0,Math.min(100,+G.shopConfig[s.id].weight||0));
   if(!RARITIES.includes(G.shopConfig[s.id].rarity))G.shopConfig[s.id].rarity=s.rar;
   G.shopConfig[s.id].max=Math.max(1,Math.min(999,G.shopConfig[s.id].max|0||defaultMaxFor(s)));}
  G.emoteStock=d.emoteStock||{};G.emoteRestockAt=d.emoteRestockAt||0;
  if(!G.emoteRestockAt||G.emoteRestockAt<Date.now())rotateEmoteShop();
  G.restockAt=d.restockAt||Date.now()+RESTOCK_MS;
  G.season=Object.assign({id:'SPOOKY',name:'Season 1: SPOOKY',status:'inactive',launchAt:0,cinematicAt:0,active:false},d.season||{});
  G.maintenance=Object.assign({active:false,until:0,msg:'',fix:'',by:''},d.maintenance||{});
  G.s2=Object.assign({phase:'idle',met:null,heartFed:0,heartActive:false,act:0,deciderClaimed:null,totalBloodDrops:0,meteorAt:0,corruptionLevel:0,heartNearDeath:false,act2Launched:false,act2LaunchedAt:0,deciderWishes:[]},d.s2||{});
  G.timer=Object.assign({active:false,end:0,text:'',color:'#e8a33d',event:'',by:''},d.timer||{});
  G.portalEnabled=!!d.portalEnabled;
  G.auction=Object.assign({active:false,item:'',itemType:'',itemName:'',itemRar:'',basePrice:0,currency:'cash',highestBid:0,highestBidder:null,highestBidderName:'',bids:[],endAt:0,extensionsUsed:0,by:''},d.auction||{});
  if(G.auction.active)G.auction.active=false; /* Don't restore active auctions after restart */
  /* If a timer was active and expired while the server was down, clear it */
  if(G.timer.active&&G.timer.end<now()){G.timer.active=false;G.timer.end=0;}
  if(!Array.isArray(G.s2.deciderWishes))G.s2.deciderWishes=[];
  if(d.event&&EV_MAP[d.event.id]&&d.event.end>Date.now())G.event={def:EV_MAP[d.event.id],start:d.event.start,end:d.event.end};
  else G.nextEventRoll=Date.now()+20000;
  /* Restore Scuba limited-time expiry from save (so it persists across server restarts) */
  if(d.scubaExpiresAt&&d.scubaExpiresAt>Date.now()){global._scubaExpiresAt=d.scubaExpiresAt;}
  else if(d.scubaExpiresAt&&d.scubaExpiresAt<=Date.now()){global._scubaExpiresAt=d.scubaExpiresAt; /* already expired — keep it expired forever */}
  for(const p of d.players||[]){
   if(p.packs===undefined)p.packs=0;if(p.bloodDrops===undefined)p.bloodDrops=0;
   if(p.lastAlienTry===undefined)p.lastAlienTry=0;if(p.deciderBought===undefined)p.deciderBought=false;
   if(!p.charBody)p.charBody='farmer';if(!p.charHat)p.charHat=null;
   if(p.charShirt===undefined)p.charShirt=0x4f8a5c;if(p.charPants===undefined)p.charPants=0x4a5a7a;
   if(p.charSkinCol===undefined)p.charSkinCol=0xe8b48a;
   if(!p.ownedCharBodies)p.ownedCharBodies=['farmer'];
   if(!p.role)p.role='player';if(p.lastRolePay===undefined)p.lastRolePay=0;
   if(p.roleColor===undefined)p.roleColor='';if(p.roleGlow===undefined)p.roleGlow=false;
   if(p.roleEffect===undefined)p.roleEffect=p.roleGlow?'glow':'none';
   if(p.roleBenefits===undefined)p.roleBenefits={};
   if(!p.pid)p.pid=genPlayerId(); /* backfill 9-char player ID for existing saves */
   if(!p.portal)p.portal=defaultPortal();
   if(!p.gear.includes('shovel'))p.gear.push('shovel');
   G.players.set(p.id,p);if(p.plot>=0&&p.plot<6)G.plots[p.plot]=p.id;}
  const el=Math.min(Date.now()-(d.savedAt||Date.now()),12*3600*1000);
  for(const pl of d.plants||[]){if(!pl.dead){pl.prog=Math.min((pl.prog||0)+el,SEED_MAP[pl.s]?SEED_MAP[pl.s].grow:1);G.plants.set(pl.id,pl);}}
  console.log('[FARM] loaded:',G.players.size,'players | S1:',G.season.status,'| S2:',G.s2.phase);}
 catch(e){console.error('[FARM] corrupt save, fresh start');G.stock=seedStockInit();G.shopConfig=defaultShopConfig();G.restockAt=Date.now()+RESTOCK_MS;rotateEmoteShop();}}
function newPlayer(id,name){let plot=G.plots.findIndex(o=>o===null);if(plot<0)plot=0;G.plots[plot]=id;
 return{id,name,pid:genPlayerId(),cash:150,tokens:0,relics:0,plot,expansion:0,seeds:{carrot:5},produce:[],gear:['watercan','shovel'],eggs:{},pets:[],packs:0,
 stats:{plant:0,harvest:0,sell:0,buySeedType:1,mutations:0,eggsBought:0,petsHatched:0,petsEquipped:0,watered:0,weatherSeen:0,mutHarvest:0,expansion:0,earned:0,rareHarvest:0},
 quests:[],daily:{last:'',streak:0},discovered:{seeds:['carrot'],muts:[],pets:[]},
 passXP:0,passLevel:1,freeClaimed:[],goldOwned:false,goldClaimed:[],
 emotes:{},skins:{},activeSkin:null,cosmetics:{},activeCosmetic:null,
 charBody:'farmer',charHat:null,charShirt:0x4f8a5c,charPants:0x4a5a7a,charSkinCol:0xe8b48a,ownedCharBodies:['farmer'],
 lastAbility:0,relicDay:'',relicDrops:0,
 bloodDrops:0,lastAlienTry:0,deciderBought:false,
 role:'player',roleColor:'',roleEffect:'none',roleGlow:false,roleBenefits:{},roleGivenBy:'',lastRolePay:0,
 x:0,z:26,ry:0,online:false};}
const now=()=>Date.now(),rand=(a,b)=>a+Math.random()*(b-a),rint=(a,b)=>Math.floor(rand(a,b+1));
function log(action,target,params){G.logs.push({t:now(),action,target:target||'global',params:params||''});
 if(G.logs.length>500)G.logs.splice(0,G.logs.length-500);}
function gearBonus(p,key){let best=0;for(const gid of p.gear){const fx=GEAR_MAP[gid]&&GEAR_MAP[gid].fx;if(fx&&fx[key])best=Math.max(best,fx[key]);}return best;}
function petBonus(p,type){let v=0;for(const pet of p.pets)if(pet.eq){const d=PET_MAP[pet.pid];if(d&&d.bt===type)v+=d.bv*(1+.05*((pet.lvl||1)-1));}return Math.min(v,.5);}
function effGrowth(p){let m=(G.event?G.event.def.grow:1)*G.growMul;
 m*=1+gearBonus(p,'grow')+petBonus(p,'growth');const spr=gearBonus(p,'sprinkler');if(spr)m*=spr;
 /* Role benefit: growBoost (1-10x multiplier) */
 if(p.roleBenefits&&p.roleBenefits.growBoost)m*=p.roleBenefits.growBoost;
 return m;}
function rollMuts(p){const muts=[],boost=(G.event&&G.event.def.boosts)||{},petM=1+petBonus(p,'mut'),beacon=gearBonus(p,'beacon')||1;
 /* Role benefit: mutBoost (1-5x multiplier on mutation chance) */
 const roleMutBoost=(p.roleBenefits&&p.roleBenefits.mutBoost)?p.roleBenefits.mutBoost:1;
 /* Godalien passive: boosts alien mutation */
 const hasGA=(p.pets||[]).some(x=>x.pid==='godalien'&&x.eq);
 for(const m of MUTS){if(muts.length>=G.mutCap)break;
  if((m.id==='miniature'&&muts.includes('giant'))||(m.id==='giant'&&muts.includes('miniature')))continue;
  let ch=(MUT_BASE[m.cat]||.01)*(boost[m.id]||1)*petM*beacon*roleMutBoost;
  if(m.id==='alien'&&hasGA)ch*=2;   /* Godalien doubles alien odds */
  for(const pet of p.pets)if(pet.eq){const d=PET_MAP[pet.pid];if(d&&d.bt===m.id)ch*=1.8;}
  if(Math.random()<Math.min(ch,.6))muts.push(m.id);}
 return muts;}
function mutMult(muts){let t=1;for(const id of muts)t*=MUT_MAP[id]?MUT_MAP[id].mult:1;return Math.min(t,MUT_TOTAL_CAP);}
function fruitValue(sd,weight,muts,p){const wAvg=(sd.wmin+sd.wmax)/2,wf=.5+.9*(weight/wAvg);
 const sell=1+petBonus(p,'sell')+gearBonus(p,'decor')+(G.event?(G.event.def.sell-1)+gearBonus(p,'charm'):0);
 /* Role benefit: sellBoost (1-5x multiplier on sell value) */
 const roleSellBoost=(p.roleBenefits&&p.roleBenefits.sellBoost)?p.roleBenefits.sellBoost:1;
 return Math.max(1,Math.round(sd.sell*wf*mutMult(muts)*sell*roleSellBoost));}
function addPassXP(p,amt){if((p.passLevel||1)>=PASS_MAX)return;
 p.passXP=(p.passXP||0)+amt;let need=passXPNeeded(p.passLevel);
 while(p.passLevel<PASS_MAX&&p.passXP>=need){p.passXP-=need;p.passLevel++;
  sendTo(p.id,{t:'toast',msg:'Pass Level '+p.passLevel+' reached!',kind:'quest'});need=passXPNeeded(p.passLevel);}
 if(p.passLevel>=PASS_MAX)p.passXP=0;}
function tryRelicDrop(p,muts,sd){
 const rareMut=muts.some(m=>MUT_MAP[m]&&MUT_MAP[m].cat==='rare');
 const today=new Date().toDateString();
 if(p.relicDay!==today){p.relicDay=today;p.relicDrops=0;}
 if((rareMut||['Divine','Demon','Mythical','Alienoic'].includes(sd.rar))&&p.relicDrops<5&&Math.random()<.08){
  p.relics=(p.relics||0)+1;p.relicDrops++;sendTo(p.id,{t:'toast',msg:'You found a RELIC!',kind:'quest'});}}
function tickPlants(){if(G.paused)return;const dt=2000;
 /* If an event is active, plants get a chance to gain mutations while growing */
 const evBoosts=G.event?(G.event.def.boosts||{}):{};
 const evHasMutBoost=Object.keys(evBoosts).length>0;
 for(const pl of G.plants.values()){const owner=G.players.get(pl.o);if(!owner)continue;
  let m=effGrowth(owner);if(pl.boostUntil>now())m*=gearBonus(owner,'water')||1.6;
  pl.prog=Math.min(pl.prog+dt*m,SEED_MAP[pl.s]?SEED_MAP[pl.s].grow:1);
  /* ===== EVENT MUTATION GUARANTEE =====
     When an event is active, growing plants have a chance to gain a mutation that matches the event's boost.
     This makes events visually exciting — players SEE their plants mutating in real time. */
  if(evHasMutBoost&&pl.prog<SEED_MAP[pl.s].grow*0.98&&Math.random()<0.04){
   /* Pick a mutation from the event's boost list */
   const evMutIds=Object.keys(evBoosts);
   const mutId=evMutIds[Math.floor(Math.random()*evMutIds.length)];
   if(mutId&&MUT_MAP[mutId]){
    if(!pl.muts)pl.muts=[];
    if(!pl.muts.includes(mutId)&&pl.muts.length<3){
     pl.muts.push(mutId);
     /* Notify the owner so they see it happen */
     sendTo(owner.id,{t:'plantMutated',plantId:pl.id,mut:mutId,plantName:SEED_MAP[pl.s]?SEED_MAP[pl.s].n:'plant'});
    }
   }
  }
 }
 /* Push plant updates to clients so they re-render with mutations */
 if(evHasMutBoost)pushPlants();}
function plantPacket(pl){return{id:pl.id,o:pl.o,s:pl.s,x:+pl.x.toFixed(2),z:+pl.z.toFixed(2),p:+Math.min(pl.prog/(SEED_MAP[pl.s]?SEED_MAP[pl.s].grow:1),1).toFixed(3),muts:pl.muts||[]};}
function startEvent(def,durMs,byAdmin){if(G.event)endEvent(false);
 const dur=durMs||def.dur;G.event={def,start:now(),end:now()+dur};
 broadcast({t:'event',ev:{id:def.id,end:G.event.end,start:G.event.start}});
 broadcast({t:'toast',msg:'Event: '+def.n,kind:'event'});
 log(byAdmin?'admin:event':'event:start','global',def.id);G.dirty=true;}
function endEvent(announce=true){if(!G.event)return;
 if(announce)broadcast({t:'toast',msg:G.event.def.n+' ended.',kind:'info'});
 G.event=null;G.nextEventRoll=now()+30000+Math.random()*60000;
 broadcast({t:'event',ev:null});G.dirty=true;}
function rollEvent(){const pool=EVENTS.filter(e=>e.w>0&&(!e.seasonal||(e.seasonal===1&&G.season.active)||(e.seasonal===2&&G.s2.phase!=='idle'))&&!G.recentEvents.slice(-2).includes(e.id));
 const total=pool.reduce((a,e)=>a+e.w,0);let r=Math.random()*total;
 for(const e of pool){r-=e.w;if(r<=0){G.recentEvents.push(e.id);if(G.recentEvents.length>6)G.recentEvents.shift();startEvent(e);return;}}}
function restock(all){for(const s of SEEDS){const st=G.stock[s.id]||(G.stock[s.id]={max:defaultMaxFor(s),qty:0});const cfg=G.shopConfig[s.id];if(!cfg)continue;
  st.max=Math.max(1,cfg.max|0);if(!cfg.enabled){st.qty=0;continue;}
  if(cfg.always){st.qty=st.max;continue;}
  if(all||Math.random()*100<Math.max(0,Math.min(100,cfg.weight)))st.qty=rint(1,st.max);else st.qty=0;}
 G.restockAt=now()+RESTOCK_MS;
 broadcast(stockMsg());broadcast({t:'toast',msg:'Seed shop restocked!',kind:'shop'});G.dirty=true;}
function stockMsg(){return{t:'stock',stock:G.stock,restockAt:G.restockAt,prices:priceMap(),cfg:G.shopConfig};}
function broadcast(msg,exceptId){if(!WSS)return;const s=JSON.stringify(msg);
 for(const c of WSS.clients)if(c.readyState===1&&c._id!==exceptId)c.send(s);}
function sendTo(id,msg){if(!WSS)return;for(const c of WSS.clients)if(c._id===id&&c.readyState===1)c.send(JSON.stringify(msg));}
function me(p){return serializePlayer(p);}
function pushMe(p){sendTo(p.id,{t:'me',me:me(p)});G.dirty=true;save();}
function pushPlants(){broadcast({t:'plants',plants:[...G.plants.values()].map(plantPacket)});}
/* ===== INIT DATA HELPER ===== */
function sendInitData(sock,p){
 sock.send(JSON.stringify({t:'init',self:me(p),serverTime:now(),
  season:seasonPacket(),s2:s2Packet(),maintenance:G.maintenance,timer:G.timer,portalEnabled:G.portalEnabled,auction:G.auction,
  stickyNote:G.stickyNote,stickyNoteColor:G.stickyNoteColor,
  plants:[...G.plants.values()].map(plantPacket),stock:G.stock,restockAt:G.restockAt,
  prices:priceMap(),cfg:G.shopConfig,
  emoteStock:G.emoteStock,emoteRestockAt:G.emoteRestockAt,
  shopRoles:getShopRolesState(),
  hh:hhStatePacket(),
  chaosActivation:{active:G.chaosActivation.active,events:G.chaosActivation.events,snapScheduledAt:G.chaosActivation.snapScheduledAt},
  event:G.event?{id:G.event.def.id,end:G.event.end,start:G.event.start}:null,
  plots:G.plots,plotPos:PLOT_POS,
  players:[...G.players.values()].filter(x=>x.online).map(x=>({id:x.id,pid:x.pid||'',name:x.name,x:x.x||0,z:x.z||0,ry:0,
   cb:x.charBody||'farmer',ch:x.charHat||null,cs:x.charShirt||0x4f8a5c,cp:x.charPants||0x4a5a7a,ck:x.charSkinCol||0xe8b48a,
   ac:x.activeCosmetic||null,role:x.role||'player',roleColor:x.roleColor||'',roleEffect:x.roleEffect||'none',roleGlow:!!x.roleGlow}))}));
 broadcast({t:'pJoin',id:p.id,pid:p.pid||'',name:p.name,
  cb:p.charBody||'farmer',ch:p.charHat||null,cs:p.charShirt||0x4f8a5c,cp:p.charPants||0x4a5a7a,ck:p.charSkinCol||0xe8b48a,
  ac:p.activeCosmetic||null,role:p.role||'player',roleColor:p.roleColor||'',roleEffect:p.roleEffect||'none',roleGlow:!!p.roleGlow},p.id);pushPlants();}
function addStat(p,k,n=1){p.stats[k]=(p.stats[k]||0)+n;}
function awardReward(p,r){if(r.cash){p.cash+=r.cash;p.stats.earned+=r.cash;}
 if(r.tokens)p.tokens+=r.tokens;if(r.relics)p.relics=(p.relics||0)+r.relics;
 if(r.seeds)for(const k in r.seeds){p.seeds[k]=(p.seeds[k]||0)+r.seeds[k];if(!p.discovered.seeds.includes(k))p.discovered.seeds.push(k);}
 if(r.egg)p.eggs[r.egg]=(p.eggs[r.egg]||0)+1;
 if(r.gear&&!p.gear.includes(r.gear))p.gear.push(r.gear);}
function cap(p){let c=60+gearBonus(p,'cap');
 /* Role benefit: invCap (extra inventory slots) */
 if(p.roleBenefits&&p.roleBenefits.invCap)c+=p.roleBenefits.invCap;
 return c;}
function dist2(ax,az,bx,bz){const dx=ax-bx,dz=az-bz;return dx*dx+dz*dz;}
function seasonPacket(){return{...G.season,serverTime:now()};}
function s2Packet(){const{deciderWishes,...rest}=G.s2;return{...rest,serverTime:now()};}
function launchSeason(){
 G.season.status='cinematic';G.season.cinematicAt=now();G.season.launchAt=now();G.dirty=true;
 broadcast({t:'seasonLaunch',cinematicAt:G.season.cinematicAt,serverTime:now()});
 log('season:launch','global','');
 setTimeout(()=>{if(G.season.status==='cinematic'){
  G.season.status='active';G.season.active=true;G.dirty=true;save();
  broadcast({t:'seasonActive',serverTime:now()});
  startEvent(EV_MAP['spookfog'],240000,true);}},CINEMATIC_MS);}

/* ================= SEASON 2 ENGINE ================= */
function launchSeason2(){
 if(G.s2.phase!=='idle')return;
 G.s2.phase='meteor';G.s2.meteorAt=now();G.dirty=true;
 broadcast({t:'s2Launch',meteorAt:G.s2.meteorAt,serverTime:now()});
 log('s2:launch','global','meteor');
 /* after 45s meteor cinematic, transition to alien world */
 setTimeout(()=>{
  if(G.s2.phase==='meteor'){
   G.s2.phase='alien';G.dirty=true;save();
   broadcast({t:'s2Phase',phase:'alien',serverTime:now()});
   broadcast({t:'toast',msg:'THE ISLAND HAS BEEN INFECTED — Season 2: THE REBIRTH',kind:'event'});
   startEvent(EV_MAP['alienglow'],300000,true);
  }},46000);}
function s2StartAct(act){
 G.s2.act=act;G.dirty=true;
 if(act===1){G.s2.heartActive=true;G.s2.heartFed=0;
  broadcast({t:'s2Phase',phase:'act1',serverTime:now()});
  broadcast({t:'toast',msg:'ACT 1 — The Staircase to the Heart has opened beneath the island…',kind:'event'});}
 if(act===2){G.s2.corruptionLevel=0;
  broadcast({t:'s2Phase',phase:'act2',serverTime:now()});
  broadcast({t:'toast',msg:'ACT 2 — The Demon stirs. The Heart begins to corrupt…',kind:'event'});
  startEvent(EV_MAP['corruptionsurge'],600000,true);}
 if(act===3){G.s2.heartNearDeath=true;
  broadcast({t:'s2Phase',phase:'act3',serverTime:now()});
  broadcast({t:'toast',msg:'ACT 3 — THE HEART IS DYING. The island trembles…',kind:'event'});}}
function tickSeason2(){
 if(G.s2.phase==='idle')return;
 /* Godalien passive: every 20 min, try to apply alien mutation to a random mature plant */
 for(const p of G.players.values()){
  if(now()<(p.lastAlienTry||0)+20*60*1000)continue;
  const hasGA=(p.pets||[]).some(x=>x.pid==='godalien'&&x.eq);
  if(!hasGA)continue;
  p.lastAlienTry=now();
  const mature=[...G.plants.values()].filter(pl=>pl.o===p.id&&pl.prog>=(SEED_MAP[pl.s]?SEED_MAP[pl.s].grow:0));
  if(mature.length&&Math.random()<.20){
   const target=mature[rint(0,mature.length-1)];
   sendTo(p.id,{t:'toast',msg:'GODALIEN: Your '+SEED_MAP[target.s].n+' has been touched by alien energy!',kind:'quest'});
   log('s2:godalien',p.id,target.s);
   /* the alien mutation will roll on next harvest via boost */
   G.dirty=true;}}
 /* Act 2 corruption grows over time */
 if(G.s2.act===2){
  G.s2.corruptionLevel=Math.min(100,G.s2.corruptionLevel+0.01);
  if(G.s2.corruptionLevel>=100){
   s2StartAct(3);save();}}
 /* Act 3: violent shaking handled client-side */
 /* Heart feeding unlocks Decider */
 if(G.s2.act>=1&&G.s2.heartFed>=HEART_ACT1_FED&&!G.s2.deciderClaimed){
  broadcast({t:'toast',msg:'The Heart has been sufficiently fed. THE SEASON DECIDER is now available!',kind:'event'});
  G.s2.deciderClaimed='available';G.dirty=true;}}

function handleMsg(sock,msg){const p=G.players.get(sock._id);if(!p)return;
 /* ===== MAINTENANCE GAMEPLAY BLOCK =====
   While the server is closed for maintenance, gameplay actions are rejected for everyone
   except admins (who still need to test). Read-only and social actions remain available. */
 const MAINT_GAMEPLAY=new Set(['plant','water','harvest','sell','sellAll','buySeed','buyGear','buyEgg','hatch','equipPet','buyPack','openPack','feedHeart','buyDecider','claimPass','claimDaily','expandPlot','buyEmote','buyCosmetic','equipCosmetic','equipSkin','buyGoldPass','passAbility']);
 const isAdmin=!![...G.adminSessions.values()].find(s=>s.id===p.id&&s.exp>now());
 if(G.maintenance.active&&MAINT_GAMEPLAY.has(msg.t)&&!isAdmin){
  return sendTo(p.id,{t:'maintenance',until:G.maintenance.until,msg:G.maintenance.msg,fix:G.maintenance.fix||'',by:G.maintenance.by||''});}
 switch(msg.t){
  case 'pos':{p.x=Math.max(-WORLD_R,Math.min(WORLD_R,+msg.x||0));p.z=Math.max(-WORLD_R,Math.min(WORLD_R,+msg.z||0));
   p.ry=+msg.ry||0;broadcast({t:'ppos',id:p.id,x:p.x,z:p.z,ry:p.ry},p.id);break;}
  /* ===== CHAT SYSTEM =====
     Server-side chat: validates input, filters bad words, rate-limits (1s),
     strips HTML, broadcasts to everyone (including sender for echo confirmation). */
  case 'chat':{
   if(!p._lastChat)p._lastChat=0;
   if(now()-p._lastChat<1000)return sendTo(p.id,{t:'toast',msg:'Wait a moment before sending another message.',kind:'err'});
   let text=String(msg.text||'').trim().slice(0,200);
   if(!text)return;
   /* Filter bad words */
   const low=' '+text.toLowerCase()+' ';
   for(const w of BAD){if(low.includes(w)){text='***';break;}}
   /* Strip HTML to prevent injection */
   text=text.replace(/</g,'&lt;').replace(/>/g,'&gt;');
   p._lastChat=now();
   /* Broadcast to EVERYONE with a unique message ID (prevents client-side duplicates) */
   broadcast({t:'chat',mid:'M'+(G.nextId++),id:p.id,name:p.name,text:text,role:p.role||'player'});
   break;}
  /* ===== HAUNTED HARVEST — player commands (not admin) =====
     Phase 2 (Hunt): players walk up to Cursed Pumpkins and collect them directly.
     They carry the pumpkins and deliver them to the altar (center of map) to fill the meter.
     Phase 3 (Boss): players hit the boss with their SHOVEL (press E near the boss). */
  case 'hhCollectPumpkin':{
   if(!G.hauntedHarvest.active||G.hauntedHarvest.phase!==HH_PHASES.HUNT)return;
   const pumpkin=G.hauntedHarvest.pumpkins.find(pp=>pp.id===msg.pumpkinId&&!pp.taken);
   if(!pumpkin)return;
   /* Player must be near the pumpkin (within ~12 units) */
   if(dist2(p.x,p.z,pumpkin.x,pumpkin.z)>144)return sendTo(p.id,{t:'toast',msg:'Get closer to the Cursed Pumpkin!',kind:'err'});
   /* Mark pumpkin as taken — player now carries it */
   pumpkin.taken=true;
   p.hhPumpkins=(p.hhPumpkins||0)+1;
   if(!G.hauntedHarvest.participants.includes(p.id))G.hauntedHarvest.participants.push(p.id);
   pushMe(p);
   sendTo(p.id,{t:'toast',msg:'🎃 You caught a Cursed Pumpkin! ('+p.hhPumpkins+' carried) — deliver to the altar!',kind:'quest'});
   broadcast({t:'hhState',hh:hhStatePacket()});
   break;}
  case 'hhDeliverAltar':{
   if(!G.hauntedHarvest.active||G.hauntedHarvest.phase!==HH_PHASES.HUNT)return;
   if((p.hhPumpkins||0)<1)return sendTo(p.id,{t:'toast',msg:'No Cursed Pumpkins to deliver. Catch some first!',kind:'err'});
   /* Must be near the altar (center of map) */
   if(dist2(p.x,p.z,0,0)>400)return sendTo(p.id,{t:'toast',msg:'Get closer to the altar at the center!',kind:'err'});
   const deliverAmt=p.hhPumpkins;
   p.hhPumpkins=0;
   G.hauntedHarvest.altarProgress+=deliverAmt;
   if(!G.hauntedHarvest.participants.includes(p.id))G.hauntedHarvest.participants.push(p.id);
   pushMe(p);
   sendTo(p.id,{t:'toast',msg:'🎃 Delivered '+deliverAmt+' Cursed Pumpkins to the altar! ('+G.hauntedHarvest.altarProgress+'/'+G.hauntedHarvest.altarTarget+')',kind:'quest'});
   /* If altar target reached, advance to boss phase early */
   if(G.hauntedHarvest.altarProgress>=G.hauntedHarvest.altarTarget){
    G.hauntedHarvest.phase=HH_PHASES.BOSS;
    G.hauntedHarvest.phaseEnd=now()+HH_DURATION.boss;
    G.hauntedHarvest.bossHealth=G.hauntedHarvest.bossMaxHealth;
    broadcast({t:'toast',msg:'🎃 Altar complete! The Pumpkin King rises from the ground!',kind:'event'});
   }
   broadcast({t:'hhState',hh:hhStatePacket()});
   break;}
  case 'hhAttackBoss':{
   if(!G.hauntedHarvest.active||G.hauntedHarvest.phase!==HH_PHASES.BOSS)return;
   /* Must have a shovel equipped to attack */
   if(!p.gear.includes('shovel'))return sendTo(p.id,{t:'toast',msg:'Need a Shovel equipped to hit the boss!',kind:'err'});
   /* Must be near the boss (center of map, on the ground) */
   if(dist2(p.x,p.z,0,0)>400)return sendTo(p.id,{t:'toast',msg:'Get closer to the Pumpkin King!',kind:'err'});
   /* Each hit does 15-35 damage */
   const damage=15+Math.floor(Math.random()*20);
   G.hauntedHarvest.bossHealth=Math.max(0,G.hauntedHarvest.bossHealth-damage);
   if(!G.hauntedHarvest.participants.includes(p.id))G.hauntedHarvest.participants.push(p.id);
   /* Small cash reward for each hit */
   p.cash=(p.cash||0)+100;
   pushMe(p);
   sendTo(p.id,{t:'toast',msg:'🎃 WHACK! You hit the Pumpkin King for '+damage+' damage! (+100 sheckles)',kind:'quest'});
   /* If boss defeated, advance to finale */
   if(G.hauntedHarvest.bossHealth<=0){
    G.hauntedHarvest.phase=HH_PHASES.FINALE;
    G.hauntedHarvest.phaseEnd=now()+HH_DURATION.finale;
    G.hauntedHarvest.treasures=[];
    for(let i=0;i<10;i++){
     const a=Math.random()*6.28,d=20+Math.random()*60;
     G.hauntedHarvest.treasures.push({id:'HHt'+i,x:Math.cos(a)*d,z:Math.sin(a)*d,taken:false,rarity:['Common','Rare','Epic','Legendary'][Math.floor(Math.random()*4)]});
    }
    broadcast({t:'toast',msg:'🎃 The Pumpkin King has been defeated! Treasures appear!',kind:'event'});
   }
   broadcast({t:'hhState',hh:hhStatePacket()});
   break;}
  case 'hhCollectTreasure':{
   if(!G.hauntedHarvest.active||G.hauntedHarvest.phase!==HH_PHASES.FINALE)return;
   const treasure=G.hauntedHarvest.treasures.find(t=>t.id===msg.treasureId&&!t.taken);
   if(!treasure)return;
   if(dist2(p.x,p.z,treasure.x,treasure.z)>144)return sendTo(p.id,{t:'toast',msg:'Get closer to the treasure!',kind:'err'});
   treasure.taken=true;
   if(!G.hauntedHarvest.participants.includes(p.id))G.hauntedHarvest.participants.push(p.id);
   /* Reward based on rarity */
   const rar=treasure.rarity;
   let cashReward=0,relicReward=0;
   if(rar==='Common'){cashReward=5000;}
   else if(rar==='Rare'){cashReward=50000;relicReward=1;}
   else if(rar==='Epic'){cashReward=200000;relicReward=3;}
   else{cashReward=1000000;relicReward=10;}
   const seedPool=Object.values(SEED_MAP).filter(s=>['Rare','Epic','Legendary'].includes(s.rar));
   const seedReward=seedPool[Math.floor(Math.random()*seedPool.length)];
   p.cash+=cashReward;p.relics=(p.relics||0)+relicReward;
   if(seedReward){p.seeds[seedReward.id]=(p.seeds[seedReward.id]||0)+1;
    if(!p.discovered.seeds.includes(seedReward.id))p.discovered.seeds.push(seedReward.id);}
   pushMe(p);
   sendTo(p.id,{t:'toast',msg:'🎃 Treasure! +'+cashReward+' sheckles, +'+relicReward+' relics'+(seedReward?', +1 '+seedReward.n:''),kind:'quest'});
   broadcast({t:'hhState',hh:hhStatePacket()});
   break;}
  /* ================= HEART FEEDING (Season 2) ================= */
  case 'feedHeart':{
   if(G.s2.act<1)return sendTo(p.id,{t:'toast',msg:'The Heart is not yet accessible.',kind:'err'});
   /* must be near heart (center of the map, underground) */
   if(dist2(p.x,p.z,0,0)>144)return sendTo(p.id,{t:'toast',msg:'Get closer to the Heart.',kind:'err'});
   /* MUST have produce to feed — no fruit = no blood drops */
   if(!p.produce.length)return sendTo(p.id,{t:'toast',msg:'You have NO fruit to feed! Harvest crops first, then bring them to the Heart.',kind:'err'});
   /* feed the most valuable fruit */
   let best=null,bi=-1;
   p.produce.forEach((f,i)=>{if(!best||f.v>best.v){best=f;bi=i;}});
   p.produce.splice(bi,1);
   const fedName=SEED_MAP[best.s]?SEED_MAP[best.s].n:'produce';
   const bloodGained=Math.max(1,Math.round(best.v*.25));   /* 25% of value as blood drops */
   p.bloodDrops=(p.bloodDrops||0)+bloodGained;
   G.s2.heartFed++;
   G.s2.totalBloodDrops=(G.s2.totalBloodDrops||0)+bloodGained;
   addPassXP(p,20);
   pushMe(p);G.dirty=true;
   sendTo(p.id,{t:'toast',msg:'The Heart devours your '+fedName+'… +'+bloodGained+' Blood Drops',kind:'good'});
   broadcast({t:'heartFed',fed:G.s2.heartFed,player:p.name});
   /* auto-advance acts */
   if(G.s2.act===1&&G.s2.heartFed>=HEART_ACT1_FED)s2StartAct(2),save();
   break;}
  /* ================= SEASON DECIDER ================= */
  case 'buyDecider':{
   if(G.s2.deciderClaimed!=='available')return sendTo(p.id,{t:'toast',msg:'The Season Decider is not available yet.',kind:'err'});
   if(p.deciderBought)return sendTo(p.id,{t:'toast',msg:'You already claimed this.',kind:'err'});
   if((p.bloodDrops||0)<DECIDER_COST)return sendTo(p.id,{t:'toast',msg:'Not enough Blood Drops ('+fmt(DECIDER_COST)+' needed).',kind:'err'});
   const wish=String(msg.wish||'').trim().slice(0,500);
   if(!wish)return sendTo(p.id,{t:'toast',msg:'You must write a wish for Season 2.',kind:'err'});
   p.bloodDrops-=DECIDER_COST;p.deciderBought=true;
   G.s2.deciderClaimed=p.name;G.dirty=true;save();
   /* store the wish in the admin inbox */
   G.s2.deciderWishes.push({player:p.id,name:p.name,wish:wish,at:now()});
   if(G.s2.deciderWishes.length>50)G.s2.deciderWishes.splice(0,G.s2.deciderWishes.length-50);
   pushMe(p);
   sendTo(p.id,{t:'toast',msg:'THE SEASON DECIDER IS YOURS. Your wish has been sent to the admins.',kind:'quest'});
   sendTo(p.id,{t:'deciderClaimed',wish:wish});
   /* message goes straight to admins */
   for(const [tok,sess] of G.adminSessions){
    sendTo(sess.id,{t:'announce',msg:'[SEASON DECIDER] '+p.name+' has claimed the Season Decider! Wish: "'+wish.slice(0,80)+(wish.length>80?'…':'')+'"',
     color:'#39ff14',style:'neon',dur:20});
    sendTo(sess.id,{t:'admData',kind:'deciderWishes',data:G.s2.deciderWishes});}
   broadcast({t:'announce',msg:p.name+' has claimed THE SEASON DECIDER.',color:'#39ff14',style:'neon',dur:10});
   log('s2:decider',p.id,wish.slice(0,80));
   break;}
  /* ================= EMOTES / PASS / SHOP (existing) ================= */
  case 'emote':{
   const id=String(msg.emote||'').slice(0,32);
   if(!p.emotes||!p.emotes[id])return;
   if(!EMOTE_MAP[id]&&!PASS_EMOTES[id])return;
   if(now()<(p._lastEmote||0)+1500)return;
   p._lastEmote=now();
   broadcast({t:'pemote',id:p.id,emote:id},p.id);addPassXP(p,2);break;}
  case 'claimPass':{
   const tier=Math.max(1,Math.min(PASS_MAX,+msg.tier|0));
   const track=msg.track==='gold'?'gold':'free';
   if(tier>(p.passLevel||1))return sendTo(p.id,{t:'toast',msg:'Reach pass level '+tier+' first!',kind:'err'});
   if(track==='free'){
    if((p.freeClaimed||[]).includes(tier))return sendTo(p.id,{t:'toast',msg:'Already claimed.',kind:'err'});
    const r=FREE_REWARDS[tier];if(!r)return;
    p.freeClaimed.push(tier);awardReward(p,r);
    if(r.emote)p.emotes[r.emote]=true;
    if(r.skin)p.skins[r.skin]=true;
    if(r.pet&&!p.pets.some(x=>x.pid===r.pet)){
     p.pets.push({uid:'K'+(G.nextId++),pid:r.pet,lvl:1,xp:0,eq:false});
     if(!p.discovered.pets.includes(r.pet))p.discovered.pets.push(r.pet);
     sendTo(p.id,{t:'hatched',pet:{uid:p.pets[p.pets.length-1].uid,pid:r.pet},egg:'pass'});}
    pushMe(p);save();sendTo(p.id,{t:'toast',msg:'Claimed tier '+tier+'!',kind:'quest'});}
   else{
    if(!p.goldOwned)return sendTo(p.id,{t:'toast',msg:'You need the Gold Ledger (35 relics).',kind:'err'});
    if((p.goldClaimed||[]).includes(tier))return sendTo(p.id,{t:'toast',msg:'Already claimed.',kind:'err'});
    const r=GOLD_REWARDS[tier];if(!r)return;
    p.goldClaimed.push(tier);awardReward(p,r);
    if(r.emote)p.emotes[r.emote]=true;
    if(r.skin)p.skins[r.skin]=true;
    pushMe(p);save();sendTo(p.id,{t:'toast',msg:'Gold tier '+tier+' claimed!',kind:'quest'});}
   break;}
  case 'buyGoldPass':{
   if(p.goldOwned)return sendTo(p.id,{t:'toast',msg:'You already own the Gold Ledger.',kind:'err'});
   if((p.relics||0)<GOLD_PASS_COST)return sendTo(p.id,{t:'toast',msg:'Not enough relics ('+GOLD_PASS_COST+' needed).',kind:'err'});
   p.relics-=GOLD_PASS_COST;p.goldOwned=true;
   pushMe(p);save();sendTo(p.id,{t:'toast',msg:'GOLD LEDGER unlocked!',kind:'quest'});break;}
  case 'passAbility':{
   const has=(p.pets||[]).some(x=>x.pid==='demoneye'&&x.eq);
   if(!has)return sendTo(p.id,{t:'toast',msg:'Equip the Demon Eye pet!',kind:'err'});
   if(now()<(p.lastAbility||0)+3600000){
    return sendTo(p.id,{t:'toast',msg:'Demon Eye rests… '+Math.ceil(((p.lastAbility||0)+3600000-now())/60000)+' min.',kind:'err'});}
   p.lastAbility=now();
   const pool=EVENTS.filter(e=>e.w>0);
   startEvent(pool[rint(0,pool.length-1)],0,true);
   broadcast({t:'toast',msg:p.name+'\u2019s Demon Eye stirs the skies!',kind:'event'});
   pushMe(p);break;}
  case 'buyEmote':{const e=EMOTE_MAP[msg.emoteId];if(!e)return;
   if(p.emotes[e.id])return sendTo(p.id,{t:'toast',msg:'Already known.',kind:'err'});
   if((G.emoteStock[e.id]||0)<1)return sendTo(p.id,{t:'toast',msg:'Not in stock.',kind:'err'});
   if(p.cash<e.pr)return sendTo(p.id,{t:'toast',msg:'Not enough sheckles.',kind:'err'});
   p.cash-=e.pr;G.emoteStock[e.id]--;
   p.emotes[e.id]=true;pushMe(p);
   broadcast({t:'emoteStock',stock:G.emoteStock,restockAt:G.emoteRestockAt});
   sendTo(p.id,{t:'toast',msg:'Learned: '+e.n+'!',kind:'shop'});G.dirty=true;break;}
  case 'buyCosmetic':{const c=COS_MAP[msg.cosId];if(!c)return;
   if(p.cosmetics[c.id])return sendTo(p.id,{t:'toast',msg:'Already owned.',kind:'err'});
   if(p.cash<c.pr)return sendTo(p.id,{t:'toast',msg:'Not enough sheckles.',kind:'err'});
   p.cash-=c.pr;p.cosmetics[c.id]=true;pushMe(p);save();break;}
  case 'equipCosmetic':{const id=msg.cosId||null;
   if(id&&!(p.cosmetics||{})[id])return;
   p.activeCosmetic=id;pushMe(p);G.dirty=true;break;}
  case 'equipSkin':{const id=msg.skinId||null;
   if(id&&!(p.skins||{})[id])return;
   p.activeSkin=id;pushMe(p);G.dirty=true;break;}
  /* ===== CHARACTER CUSTOMIZATION (free colors + equip body/hat) ===== */
  case 'customizeChar':{
   if(msg.shirt!==undefined)p.charShirt=Math.max(0,Math.min(0xffffff,+msg.shirt|0));
   if(msg.pants!==undefined)p.charPants=Math.max(0,Math.min(0xffffff,+msg.pants|0));
   if(msg.skinCol!==undefined)p.charSkinCol=Math.max(0,Math.min(0xffffff,+msg.skinCol|0));
   if(msg.body!==undefined){
    const b=String(msg.body).slice(0,20);
    if(CHAR_BODY_MAP[b]&&(p.ownedCharBodies||['farmer']).includes(b))p.charBody=b;
   }
   if(msg.hat!==undefined){
    const h=msg.hat?String(msg.hat).slice(0,30):null;
    if(!h||(p.cosmetics||{})[h])p.charHat=h;
   }
   pushMe(p);G.dirty=true;
   /* Broadcast the char update to all other players so they see the new model */
   broadcast({t:'pCharUpdate',id:p.id,cb:p.charBody,ch:p.charHat,cs:p.charShirt,cp:p.charPants,ck:p.charSkinCol,ac:p.activeCosmetic},p.id);
   break;}
  case 'buyCharBody':{
   const b=CHAR_BODY_MAP[msg.bodyId];if(!b)return;
   if((p.ownedCharBodies||['farmer']).includes(b.id))return sendTo(p.id,{t:'toast',msg:'Already owned.',kind:'err'});
   if(p.cash<b.pr)return sendTo(p.id,{t:'toast',msg:'Not enough sheckles.',kind:'err'});
   p.cash-=b.pr;
   if(!p.ownedCharBodies)p.ownedCharBodies=['farmer'];
   p.ownedCharBodies.push(b.id);
   p.charBody=b.id;
   pushMe(p);save();
   broadcast({t:'pCharUpdate',id:p.id,cb:p.charBody,ch:p.charHat,cs:p.charShirt,cp:p.charPants,ck:p.charSkinCol,ac:p.activeCosmetic},p.id);
   sendTo(p.id,{t:'toast',msg:'Unlocked '+b.n+'! Equipped.',kind:'quest'});break;}
  /* ===== BUY ROLE FROM GAME SHOP =====
     Players can purchase roles with relics or sheckles. Limited-time roles (Scuba) become
     unavailable forever after their timer expires. */
  case 'buyRole':{
   const r=SHOP_ROLE_MAP[msg.roleId];
   if(!r)return sendTo(p.id,{t:'toast',msg:'Role not found.',kind:'err'});
   /* Check limited-time expiry */
   if(r.limited&&Date.now()>global._scubaExpiresAt){
    return sendTo(p.id,{t:'toast',msg:'This role is no longer available — it was limited-time only.',kind:'err'});
   }
   /* Check if player already has this role */
   if(p.role===r.n)return sendTo(p.id,{t:'toast',msg:'You already have the '+r.n+' role.',kind:'err'});
   /* Check currency */
   if(r.cur==='relics'){
    if((p.relics||0)<r.price)return sendTo(p.id,{t:'toast',msg:'Need '+r.price+' relics to buy '+r.n+'.',kind:'err'});
    p.relics-=r.price;
   }else{
    if(p.cash<r.price)return sendTo(p.id,{t:'toast',msg:'Need '+r.price+' sheckles to buy '+r.n+'.',kind:'err'});
    p.cash-=r.price;
   }
   /* Apply the role */
   p.role=r.n;p.roleColor=r.color;p.roleEffect=r.effect;p.roleGlow=(r.effect!=='none');
   p.roleBenefits={...r.benefits};p.roleGivenBy='Shop Purchase';
   pushMe(p);save();
   broadcast({t:'pRoleUpdate',id:p.id,role:p.role,roleColor:p.roleColor,roleEffect:p.roleEffect,roleGlow:p.roleGlow},p.id);
   sendTo(p.id,{t:'toast',msg:'✓ You are now a '+r.n+'! '+r.desc,kind:'quest'});
   log('role:buy',p.id,r.n);
   break;}
  /* ================= EXISTING GAMEPLAY ================= */
  case 'buySeed':{const sd=SEED_MAP[msg.seedId];if(!sd)return;
   const cfg=G.shopConfig[sd.id];
   if(!cfg||!cfg.enabled)return sendTo(p.id,{t:'toast',msg:'Not available in shop.',kind:'err'});
   const qty=Math.max(1,Math.min(50,msg.qty|0));const st=G.stock[sd.id];
   if(!cfg.always&&st.qty<qty)return sendTo(p.id,{t:'toast',msg:'Not enough stock!',kind:'err'});
   const cost=cfg.price*qty;
   if(p.cash<cost)return sendTo(p.id,{t:'toast',msg:'Not enough sheckles.',kind:'err'});
   p.cash-=cost;if(!cfg.always)st.qty-=qty;
   p.seeds[sd.id]=(p.seeds[sd.id]||0)+qty;
   if(!p.discovered.seeds.includes(sd.id)){p.discovered.seeds.push(sd.id);addStat(p,'buySeedType');}
   broadcast(stockMsg());pushMe(p);pushPlants();
   sendTo(p.id,{t:'toast',msg:'Bought '+qty+'x '+sd.n+'!',kind:'shop'});break;}
  case 'plant':{const sd=SEED_MAP[msg.seedId];if(!sd)return;
   if((p.seeds[sd.id]||0)<1)return sendTo(p.id,{t:'toast',msg:'No seeds.',kind:'err'});
   const px=PLOT_POS[p.plot][0],pz=PLOT_POS[p.plot][1],half=PLOT_HALF[p.expansion],x=+msg.x,z=+msg.z;
   if(Math.abs(x-px)>half||Math.abs(z-pz)>half)return sendTo(p.id,{t:'toast',msg:'Plant inside YOUR plot!',kind:'err'});
   if(dist2(x,z,p.x,p.z)>100)return sendTo(p.id,{t:'toast',msg:'Too far.',kind:'err'});
   let count=0;
   for(const pl of G.plants.values()){if(pl.o===p.id)count++;
    if(pl.o===p.id&&dist2(pl.x,pl.z,x,z)<.81)return sendTo(p.id,{t:'toast',msg:'Too close to another plant.',kind:'err'});}
   if(count>=16+p.expansion*8)return sendTo(p.id,{t:'toast',msg:'Plot full!',kind:'err'});
   p.seeds[sd.id]--;
   const pl={id:'P'+(G.nextId++),o:p.id,s:sd.id,x,z,prog:0,boostUntil:0};
   G.plants.set(pl.id,pl);addStat(p,'plant');addPassXP(p,8);
   pushMe(p);pushPlants();sendTo(p.id,{t:'toast',msg:sd.n+' planted!',kind:'good'});break;}
  case 'water':{const pl=G.plants.get(msg.plantId);if(!pl||pl.o!==p.id)return;
   if(dist2(pl.x,pl.z,p.x,p.z)>100)return;
   if(pl.prog>=(SEED_MAP[pl.s]?SEED_MAP[pl.s].grow:0))return;
   pl.boostUntil=now()+(p.gear.includes('watercan2')?120000:p.gear.includes('watercanG')?150000:90000);
   addStat(p,'watered');addPassXP(p,3);break;}
  case 'harvest':{
   if(!p.gear.includes('shovel'))return sendTo(p.id,{t:'toast',msg:'Need a Shovel!',kind:'err'});
   const pl=G.plants.get(msg.plantId);if(!pl||pl.o!==p.id)return;
   const sd=SEED_MAP[pl.s];
   if(dist2(pl.x,pl.z,p.x,p.z)>100)return;
   if(pl.prog<sd.grow)return sendTo(p.id,{t:'toast',msg:'Not ready.',kind:'err'});
   if(p.produce.length>=cap(p))return sendTo(p.id,{t:'toast',msg:'Inventory full!',kind:'err'});
   let count=rint(sd.fmin,sd.fmax);
   if(Math.random()<gearBonus(p,'fruit')+petBonus(p,'fruit'))count++;
   count=Math.min(count,cap(p)-p.produce.length);
   const fruits=[];
   /* Carry over plant's mutations (gained during event) to ~70% of harvested fruits */
   const plantMuts=pl.muts||[];
   for(let i=0;i<count;i++){let w=rand(sd.wmin,sd.wmax);
    /* Use plant's mutations for most fruits, but roll fresh ones for some variety */
    let muts;
    if(plantMuts.length>0&&Math.random()<0.7){muts=plantMuts.slice();}
    else{muts=rollMuts(p);}
    if(muts.includes('giant')||muts.includes('overgrown'))w*=2.2;
    if(muts.includes('miniature'))w*=.5;
    for(const m of muts)if(!p.discovered.muts.includes(m))p.discovered.muts.push(m);
    if(muts.length){addStat(p,'mutations',muts.length);addStat(p,'mutHarvest');}
    const f={uid:'F'+(G.nextId++),s:sd.id,w:+w.toFixed(3),m:muts,v:fruitValue(sd,w,muts,p),t:now()};
    p.produce.push(f);fruits.push(f);}
   tryRelicDrop(p,fruits.length?fruits[0].m:[],sd);
   addStat(p,'harvest');addPassXP(p,15+(fruits.some(f=>f.m.length)?20:0));
   if(['Rare','Epic','Legendary','Mythical','Demon','Divine','Alienoic'].includes(sd.rar))addStat(p,'rareHarvest');
   if(sd.reg>0){pl.prog=sd.grow*(1-sd.reg);/* Keep mutations on regrowing plants */}
   else G.plants.delete(pl.id);
   for(const pet of p.pets){pet.xp=(pet.xp||0)+5;pet.lvl=Math.min(10,1+Math.floor(pet.xp/100));}
   pushMe(p);pushPlants();G.dirty=true;save();
   sendTo(p.id,{t:'harvested',fruits,plantId:pl.id,seed:sd.id});break;}
  case 'sell':{const uids=Array.isArray(msg.uids)?msg.uids.slice(0,200):[];sellFruits(p,uids);break;}
  case 'sellAll':{sellFruits(p,p.produce.map(f=>f.uid));break;}
  case 'buyGear':{const g=GEAR_MAP[msg.gearId];if(!g)return;
   if(p.gear.includes(g.id))return;
   if(p.cash<g.pr)return sendTo(p.id,{t:'toast',msg:'Not enough sheckles.',kind:'err'});
   p.cash-=g.pr;p.gear.push(g.id);pushMe(p);break;}
  case 'buyEgg':{const e=EGG_MAP[msg.eggId];if(!e)return;
   if(p.cash<e.pr)return;p.cash-=e.pr;p.eggs[e.id]=(p.eggs[e.id]||0)+1;
   addStat(p,'eggsBought');pushMe(p);break;}
  case 'hatch':{const e=EGG_MAP[msg.eggId];if(!e)return;
   if((p.eggs[msg.eggId]||0)<1)return;
   p.eggs[msg.eggId]--;
   let r=Math.random()*100,petId=e.pool[e.pool.length-1][0];
   for(const[pid,ch]of e.pool){r-=ch;if(r<=0){petId=pid;break;}}
   p.pets.push({uid:'K'+(G.nextId++),pid:petId,lvl:1,xp:0,eq:false});
   addStat(p,'petsHatched');addPassXP(p,10);
   if(!p.discovered.pets.includes(petId))p.discovered.pets.push(petId);
   pushMe(p);sendTo(p.id,{t:'hatched',pet:{uid:p.pets[p.pets.length-1].uid,pid:petId},egg:msg.eggId});break;}
  case 'equipPet':{const pet=p.pets.find(x=>x.uid===msg.uid);if(!pet)return;
   if(!pet.eq&&p.pets.filter(x=>x.eq).length>=3)return;
   pet.eq=!pet.eq;if(pet.eq)addStat(p,'petsEquipped');pushMe(p);break;}
  case 'buyPack':{if(p.cash<PACK_PRICE)return;
   p.cash-=PACK_PRICE;p.packs++;pushMe(p);break;}
  case 'openPack':{if((p.packs||0)<1)return;
   p.packs--;
   let r=Math.random()*100,seedId=PACK_SEEDS[PACK_SEEDS.length-1][0];
   for(const[sid,ch]of PACK_SEEDS){r-=ch;if(r<=0){seedId=sid;break;}}
   p.seeds[seedId]=(p.seeds[seedId]||0)+1;
   if(!p.discovered.seeds.includes(seedId))p.discovered.seeds.push(seedId);
   pushMe(p);addPassXP(p,15);sendTo(p.id,{t:'packResult',seed:seedId});break;}
  case 'claimQuest':{const q=QUESTS.find(x=>x.id===msg.qid);if(!q)return;
   if(p.quests.includes(q.id))return;
   if((p.stats[q.stat]||0)<q.goal)return;
   p.quests.push(q.id);awardReward(p,q.reward);pushMe(p);break;}
  case 'claimDaily':{const today=new Date().toDateString();
   if(p.daily.last===today)return;
   p.daily.streak=p.daily.last===new Date(Date.now()-864e5).toDateString()?p.daily.streak+1:1;
   p.daily.last=today;awardReward(p,DAILY[Math.min(p.daily.streak-1,6)]);pushMe(p);break;}
  case 'expandPlot':{if(p.expansion>=3)return;
   if(p.cash<EXP_COST[p.expansion])return;
   p.cash-=EXP_COST[p.expansion];p.expansion++;addStat(p,'expansion');addPassXP(p,20);
   pushMe(p);broadcast({t:'plots',plots:G.plots});break;}
  case 'leaderboard':{sendTo(p.id,{t:'leaderboard',list:[...G.players.values()]
    .map(x=>({id:x.id,name:x.name,cash:x.cash})).sort((a,b)=>b.cash-a.cash).slice(0,10)});break;}
  case 'adminAuth':{const key=sock._ip||p.id;const fails=G.authFails.get(key)||{n:0,until:0};
   if(now()<fails.until)return sendTo(p.id,{t:'adminErr',msg:'Locked.'});
   if(String(msg.code)!==ADMIN_CODE){fails.n++;if(fails.n>=5)fails.until=now()+600000;
    G.authFails.set(key,fails);return sendTo(p.id,{t:'adminErr',msg:'Invalid code.'});}
   fails.n=0;G.authFails.set(key,fails);
   const token=crypto.randomBytes(24).toString('hex');
   G.adminSessions.set(token,{id:p.id,exp:now()+3600000});
   sendTo(p.id,{t:'adminOk',token});break;}
  case 'admin':{const sess=G.adminSessions.get(msg.token);
   if(!sess||sess.exp<now()||sess.id!==p.id)return sendTo(p.id,{t:'toast',msg:'Admin session expired.',kind:'err'});
   adminCommand(p,msg);break;}
  /* ===== ROLE-ADMIN WEATHER CONTROL (no full admin session needed) ===== */
  case 'roleWeather':{
   /* Admin OR role with weatherControl benefit can use this */
   const canControl=p.role==='admin'||(p.roleBenefits&&p.roleBenefits.weatherControl)||p.roleBenefits&&p.roleBenefits.adminPowers;
   if(!canControl)return sendTo(p.id,{t:'toast',msg:'You need a role with weather control for this.',kind:'err'});
   const sub=String(msg.sub||'').slice(0,16);
   if(sub==='start'){const d=EV_MAP[String(msg.ev||'').slice(0,32)];if(d)startEvent(d,+msg.dur?+msg.dur*1000:0,true);
    sendTo(p.id,{t:'toast',msg:'Weather started: '+(d?d.n:'(invalid)'),kind:'good'});}
   else if(sub==='end'){endEvent(true);sendTo(p.id,{t:'toast',msg:'Weather ended.',kind:'good'});}
   else if(sub==='random'){const pool=EVENTS.filter(e=>e.w>0);startEvent(pool[rint(0,pool.length-1)]);
    sendTo(p.id,{t:'toast',msg:'Random weather rolled.',kind:'good'});}
   break;}
  /* ================= PORTAL WORLD ================= */
  case 'portalSelectHouse':{
   if(!p.portal)p.portal=defaultPortal();
   const zone=String(msg.zone||'').slice(0,10);
   if(!['beach','city'].includes(zone))return;
   if(p.portal.zone)return sendTo(p.id,{t:'toast',msg:'You already chose a zone.',kind:'err'});
   p.portal.zone=zone;p.portal.houseTier=0;p.portal.rupees=0;
   pushMe(p);save();
   sendTo(p.id,{t:'toast',msg:'Welcome home! Your '+zone+' shack is ready.',kind:'quest'});
   break;}
  case 'portalSleep':{
   if(!p.portal||!p.portal.zone)return sendTo(p.id,{t:'toast',msg:'Choose a house first.',kind:'err'});
   const today=new Date().toDateString();
   if(p.portal.lastSleep===today)return sendTo(p.id,{t:'toast',msg:'You already slept today. Come back tomorrow!',kind:'err'});
   p.portal.lastSleep=today;
   p.portal.rupees=(p.portal.rupees||0)+50;
   pushMe(p);save();
   sendTo(p.id,{t:'toast',msg:'You slept well. +50 Rupees!',kind:'quest'});
   sendTo(p.id,{t:'portalUpdate',portal:p.portal});
   break;}
  case 'portalJobComplete':{
   if(!p.portal||!p.portal.zone)return;
   const jobId=String(msg.jobId||'').slice(0,16);
   const job=JOB_DEFS.find(j=>j.id===jobId);
   if(!job)return;
   /* Check cooldown */
   const lastCd=p.portal.jobCd&&p.portal.jobCd[jobId]||0;
   if(now()<lastCd+job.cd)return sendTo(p.id,{t:'toast',msg:'Job still on cooldown.',kind:'err'});
   /* Calculate payout with pet boost */
   let payout=job.payout;
   if(p.portal.activePet){
    const pet=HOUSE_EGG_PETS.find(pp=>pp.id===p.portal.activePet);
    if(pet)payout=Math.round(payout*(1+pet.boost));
   }
   p.portal.rupees=(p.portal.rupees||0)+payout;
   if(!p.portal.jobCd)p.portal.jobCd={};
   p.portal.jobCd[jobId]=now();
   pushMe(p);save();
   sendTo(p.id,{t:'toast',msg:'Job done! +'+payout+' Rupees',kind:'good'});
   sendTo(p.id,{t:'portalUpdate',portal:p.portal});
   break;}
  case 'portalUpgradeHouse':{
   if(!p.portal||!p.portal.zone)return;
   const tier=p.portal.houseTier||0;
   if(tier>=2)return sendTo(p.id,{t:'toast',msg:'Already at max tier!',kind:'err'});
   const next=HOUSE_TIERS[tier+1];
   if(p.portal.rupees<next.cost)return sendTo(p.id,{t:'toast',msg:'Need '+next.cost+' Rupees.',kind:'err'});
   p.portal.rupees-=next.cost;
   p.portal.houseTier=tier+1;
   pushMe(p);save();
   sendTo(p.id,{t:'toast',msg:'Upgraded to '+next.n+'!',kind:'quest'});
   sendTo(p.id,{t:'portalUpdate',portal:p.portal});
   break;}
  case 'portalBuyEgg':{
   if(!p.portal||!p.portal.zone)return;
   if(p.portal.rupees<HOUSE_EGG_COST)return sendTo(p.id,{t:'toast',msg:'Need '+HOUSE_EGG_COST+' Rupees.',kind:'err'});
   p.portal.rupees-=HOUSE_EGG_COST;
   /* Roll a pet */
   let roll=Math.random()*100,petId=HOUSE_EGG_PETS[0].id;
   for(const pet of HOUSE_EGG_PETS){roll-=pet.ch;if(roll<=0){petId=pet.id;break;}}
   p.portal.pets=p.portal.pets||[];
   p.portal.pets.push({uid:'HP'+(G.nextId++),pid:petId});
   if(!p.portal.activePet)p.portal.activePet=petId;
   pushMe(p);save();
   const petDef=HOUSE_EGG_PETS.find(pp=>pp.id===petId);
   sendTo(p.id,{t:'toast',msg:'You hatched: '+petDef.n+' ('+petDef.rar+')!',kind:petDef.rar==='Mythical'?'quest':'good'});
   sendTo(p.id,{t:'portalHatch',petId:petId,portal:p.portal});
   break;}
  case 'portalEquipPet':{
   if(!p.portal)return;
   const pid=String(msg.pid||'').slice(0,20);
   if(!p.portal.pets.some(pp=>pp.pid===pid))return;
   p.portal.activePet=pid;
   pushMe(p);save();
   sendTo(p.id,{t:'portalUpdate',portal:p.portal});
   break;}
  case 'portalVisitFriend':{
   const friendId=String(msg.friendId||'').slice(0,32);
   const friend=G.players.get(friendId);
   if(!friend||!friend.portal||!friend.portal.zone)return sendTo(p.id,{t:'toast',msg:'Friend has no house.',kind:'err'});
   sendTo(p.id,{t:'portalVisit',friendId:friendId,friendName:friend.name,portal:friend.portal});
   break;}
  /* ===== AUCTION HOUSE — player bid ===== */
  case 'placeBid':{
   if(!G.auction.active)return sendTo(p.id,{t:'toast',msg:'No active auction.',kind:'err'});
   const bid=Math.max(0,Math.floor(+msg.amount||0));
   const minBid=Math.ceil(G.auction.highestBid*1.05);
   if(bid<minBid)return sendTo(p.id,{t:'toast',msg:'Minimum bid is '+fmt(minBid)+' '+G.auction.currency+'.',kind:'err'});
   /* Check player has enough money */
   if(G.auction.currency==='relics'){
    if((p.relics||0)<bid)return sendTo(p.id,{t:'toast',msg:'You don\'t have enough Relics!',kind:'err'});
   }else{
    if((p.cash||0)<bid)return sendTo(p.id,{t:'toast',msg:'You don\'t have enough Sheckles!',kind:'err'});
   }
   /* Valid bid — update auction */
   G.auction.highestBid=bid;
   G.auction.highestBidder=p.id;
   G.auction.highestBidderName=p.name;
   G.auction.bids.unshift({name:p.name,amount:bid,id:p.id});
   if(G.auction.bids.length>10)G.auction.bids.length=10;
   /* Anti-snipe: extend timer if bid in last 10 seconds */
   const rem=G.auction.endAt-now();
   if(rem<10000&&G.auction.extensionsUsed<3){
    G.auction.endAt+=10000;G.auction.extensionsUsed++;
   }
   G.dirty=true;save();
   broadcast({t:'auctionUpdate',auction:G.auction,serverTime:now()});
   sendTo(p.id,{t:'toast',msg:'Bid placed: '+fmt(bid)+' '+G.auction.currency,kind:'good'});
   break;}
 }
}
function sellFruits(p,uids){const set=new Set(uids);const sold=[];
 p.produce=p.produce.filter(f=>{if(set.has(f.uid)){sold.push(f);return false;}return true;});
 if(!sold.length)return sendTo(p.id,{t:'toast',msg:'Nothing to sell.',kind:'err'});
 let total=0;for(const f of sold)total+=f.v;
 p.cash+=total;p.stats.earned+=total;addStat(p,'sell',sold.length);
 addPassXP(p,Math.min(60,sold.length*2));
 pushMe(p);G.dirty=true;save();sendTo(p.id,{t:'sold',total,count:sold.length});}

function adminCommand(admin,msg){const c=msg.cmd,a=msg.args||{};
 const target=a.targetId?G.players.get(a.targetId):admin;
 switch(c){
  case 'info':sendTo(admin.id,{t:'admData',kind:'info',data:{uptime:Math.round((now()-G.startedAt)/1000),
   online:[...G.players.values()].filter(x=>x.online).length,players:G.players.size,plants:G.plants.size,
   event:G.event?G.event.def.n:'none',paused:G.paused,season:G.season.status,seasonName:G.season.name,
   s2phase:G.s2.phase,s2act:G.s2.act,s2heartFed:G.s2.heartFed}});break;
  case 'players':sendTo(admin.id,{t:'admData',kind:'players',data:[...G.players.values()].map(x=>({id:x.id,pid:x.pid||'',name:x.name,
   cash:x.cash,tokens:x.tokens,plot:x.plot,exp:x.expansion,online:!!x.online,produce:x.produce.length,pets:x.pets.length,
   role:x.role||'player',roleColor:x.roleColor||'',roleEffect:x.roleEffect||'none',roleGlow:!!x.roleGlow,roleBenefits:x.roleBenefits||{}}))});break;
  /* ===== SEASON 2 ADMIN ===== */
  case 'launchSeason2':{
   if(G.s2.phase!=='idle')return sendTo(admin.id,{t:'toast',msg:'Season 2 already started.',kind:'err'});
   launchSeason2();
   sendTo(admin.id,{t:'toast',msg:'Season 2: THE REBIRTH launching!',kind:'good'});break;}
  case 's2Act':{
   const act=Math.max(1,Math.min(3,+a.act||1));
   s2StartAct(act);save();
   sendTo(admin.id,{t:'toast',msg:'Season 2 Act '+act+' started.',kind:'good'});break;}
  case 'getShopConfig':sendTo(admin.id,{t:'admData',kind:'shopConfig',data:G.shopConfig});break;
  case 'updateSeedCfg':{
   const cfg=G.shopConfig[a.seed];if(!cfg)return;
   if(a.price!==undefined)cfg.price=Math.max(0,Math.round(+a.price||0));
   if(a.weight!==undefined)cfg.weight=Math.max(0,Math.min(100,+a.weight||0));
   if(a.rarity!==undefined&&RARITIES.includes(a.rarity))cfg.rarity=a.rarity;
   if(a.max!==undefined)cfg.max=Math.max(1,Math.min(999,+a.max||1));
   if(a.enabled!==undefined)cfg.enabled=!!a.enabled;
   if(a.always!==undefined)cfg.always=!!a.always;
   G.dirty=true;save();broadcast(stockMsg());
   sendTo(admin.id,{t:'toast',msg:'Saved '+a.seed+'.',kind:'good'});break;}
  case 'closeGame':{
   const mins=Math.max(1,Math.min(720,Math.round(+a.minutes||0)));
   if(G.maintenance.active)return sendTo(admin.id,{t:'toast',msg:'Already closed.',kind:'err'});
   G.maintenance={active:true,until:now()+mins*60000,
    msg:String(a.msg||'We are working on the island.').slice(0,200),
    fix:String(a.fix||'').slice(0,200),
    by:admin.name};
   G.dirty=true;save();
   broadcast({t:'maintenance',until:G.maintenance.until,msg:G.maintenance.msg,fix:G.maintenance.fix,by:G.maintenance.by});
   sendTo(admin.id,{t:'toast',msg:'Game closed for '+mins+' min.',kind:'good'});break;}
  case 'openServer':{
   if(!G.maintenance.active)return sendTo(admin.id,{t:'toast',msg:'Already open.',kind:'err'});
   G.maintenance={active:false,until:0,msg:'',fix:'',by:''};G.dirty=true;save();
   broadcast({t:'maintenance',until:0,msg:'',fix:'',by:''});
   sendTo(admin.id,{t:'toast',msg:'Server reopened!',kind:'good'});break;}
  /* ===== PORTAL TOGGLE — admin controls whether portal is visible ===== */
  case 'togglePortal':{
   G.portalEnabled=!G.portalEnabled;G.dirty=true;save();
   broadcast({t:'portalToggle',enabled:G.portalEnabled});
   sendTo(admin.id,{t:'toast',msg:'Portal '+(G.portalEnabled?'ENABLED':'DISABLED'),kind:'good'});break;}
  /* ===== AUCTION HOUSE — admin commands ===== */
  case 'startAuction':{
   if(G.auction.active)return sendTo(admin.id,{t:'toast',msg:'Auction already active.',kind:'err'});
   const item=String(a.item||'').slice(0,40);
   const itemType=String(a.itemType||'').slice(0,20);
   const itemName=String(a.itemName||'').slice(0,60);
   const itemRar=String(a.itemRar||'').slice(0,20);
   const basePrice=Math.max(1,+a.basePrice||100);
   const currency=(a.currency==='relics')?'relics':'cash';
   const dur=Math.max(10,Math.min(600,+a.duration||60));
   G.auction={active:true,item,itemType,itemName,itemRar,basePrice,currency,
    highestBid:basePrice,highestBidder:null,highestBidderName:'Starting bid',
    bids:[{name:'Starting bid',amount:basePrice}],endAt:now()+dur*1000,extensionsUsed:0,by:admin.name};
   G.dirty=true;save();
   broadcast({t:'auctionStart',auction:G.auction,serverTime:now()});
   log('auction:start','global',itemName+' @ '+basePrice);
   sendTo(admin.id,{t:'toast',msg:'Auction started: '+itemName,kind:'good'});break;}
  case 'cancelAuction':{
   if(!G.auction.active)return sendTo(admin.id,{t:'toast',msg:'No active auction.',kind:'err'});
   G.auction={active:false,item:'',itemType:'',itemName:'',itemRar:'',basePrice:0,currency:'cash',highestBid:0,highestBidder:null,highestBidderName:'',bids:[],endAt:0,extensionsUsed:0,by:''};
   G.dirty=true;save();
   broadcast({t:'auctionEnd',cancelled:true});
   sendTo(admin.id,{t:'toast',msg:'Auction cancelled.',kind:'good'});break;}
  case 'extendAuction':{
   if(!G.auction.active)return sendTo(admin.id,{t:'toast',msg:'No active auction.',kind:'err'});
   const ext=Math.max(10,Math.min(300,+a.seconds||30));
   G.auction.endAt+=ext*1000;G.dirty=true;save();
   broadcast({t:'auctionUpdate',auction:G.auction,serverTime:now()});
   sendTo(admin.id,{t:'toast',msg:'Extended by '+ext+'s.',kind:'good'});break;}
  case 'forceEndAuction':{
   if(!G.auction.active)return sendTo(admin.id,{t:'toast',msg:'No active auction.',kind:'err'});
   G.auction.endAt=now();G.dirty=true;save();
   sendTo(admin.id,{t:'toast',msg:'Auction force-ending...',kind:'good'});break;}
  /* ===== SEASON 1 ACT 2: THE DESCENT — admin launch ===== */
  case 'launchAct2':{
   if(G.s2.act2Launched)return sendTo(admin.id,{t:'toast',msg:'Act 2 already launched.',kind:'err'});
   G.s2.act2Launched=true;G.s2.act2LaunchedAt=now();G.s2.act=1;G.s2.heartActive=true;G.s2.heartFed=0;
   G.dirty=true;save();
   broadcast({t:'act2Launch',at:G.s2.act2LaunchedAt,serverTime:now()});
   log('act2:launch','global','');
   sendTo(admin.id,{t:'toast',msg:'Act 2: THE DESCENT launched — the island cracks open.',kind:'good'});break;}
  case 'revertAct2':{
   if(!G.s2.act2Launched)return sendTo(admin.id,{t:'toast',msg:'Act 2 not launched.',kind:'err'});
   G.s2.act2Launched=false;G.s2.act2LaunchedAt=0;G.s2.act=0;G.s2.heartActive=false;G.s2.heartFed=0;
   G.s2.deciderClaimed=null;G.s2.corruptionLevel=0;G.s2.heartNearDeath=false;
   G.dirty=true;save();
   broadcast({t:'act2Revert',serverTime:now()});
   log('act2:revert','global','');
   sendTo(admin.id,{t:'toast',msg:'Act 2 reverted — the island has healed.',kind:'good'});break;}
  case 'giveBloodDrops':{
   if(target){const amt=Math.max(0,Math.min(2000000000,+a.v||0));
    target.bloodDrops=(target.bloodDrops||0)+amt;pushMe(target);
    sendTo(admin.id,{t:'toast',msg:'Gave '+amt+' Blood Drops to '+target.name+'.',kind:'good'});}
   break;}
  /* ===== ROLES SYSTEM (custom names + colors + effects + benefits) ===== */
  case 'setRole':{
   const t2=G.players.get(a.targetId);if(!t2)return sendTo(admin.id,{t:'toast',msg:'Player not found.',kind:'err'});
   /* Allow admin to set ANY custom role name (1-16 chars, alphanumeric + space + -) */
   const role=String(a.role||'player').trim().slice(0,16);
   if(!role)return sendTo(admin.id,{t:'toast',msg:'Role name required.',kind:'err'});
   if(!/^[A-Za-z0-9 \-]+$/.test(role))return sendTo(admin.id,{t:'toast',msg:'Role name: letters/numbers/spaces only.',kind:'err'});
   /* Color: hex like #ff7020, or empty for default */
   const color=/^#[0-9a-fA-F]{6}$/.test(String(a.color||''))?String(a.color):'';
   /* Effect: none | glow | neon | spooky | rainbow */
   const validEffects=['none','glow','neon','spooky','rainbow','fire','ice'];
   let effect=String(a.effect||'none').toLowerCase();
   if(!validEffects.includes(effect))effect='none';
   /* Benefits object — admin can configure what the role offers */
   let benefits={};
   if(a.benefits&&typeof a.benefits==='object'){
    /* Cash per day (sheckles) */
    if(typeof a.benefits.cashPerDay==='number')benefits.cashPerDay=Math.max(0,Math.min(100000000,a.benefits.cashPerDay));
    /* Relics per day */
    if(typeof a.benefits.relicsPerDay==='number')benefits.relicsPerDay=Math.max(0,Math.min(100,a.benefits.relicsPerDay));
    /* Weather control (bool) */
    if(typeof a.benefits.weatherControl==='boolean')benefits.weatherControl=a.benefits.weatherControl;
    /* Admin powers (bool) — full admin */
    if(typeof a.benefits.adminPowers==='boolean')benefits.adminPowers=a.benefits.adminPowers;
    /* Growth boost (multiplier 1-10) */
    if(typeof a.benefits.growBoost==='number')benefits.growBoost=Math.max(1,Math.min(10,a.benefits.growBoost));
    /* Sell boost (multiplier 1-5) */
    if(typeof a.benefits.sellBoost==='number')benefits.sellBoost=Math.max(1,Math.min(5,a.benefits.sellBoost));
    /* Mutation boost (multiplier 1-5) */
    if(typeof a.benefits.mutBoost==='number')benefits.mutBoost=Math.max(1,Math.min(5,a.benefits.mutBoost));
    /* Inventory cap boost (extra slots) */
    if(typeof a.benefits.invCap==='number')benefits.invCap=Math.max(0,Math.min(500,a.benefits.invCap));
    /* Walk speed boost (multiplier 1-3) */
    if(typeof a.benefits.speedBoost==='number')benefits.speedBoost=Math.max(1,Math.min(3,a.benefits.speedBoost));
   }
   t2.role=role;t2.roleColor=color;t2.roleEffect=effect;t2.roleBenefits=benefits;t2.roleGivenBy=admin.name;
   /* For backward compat: roleGlow=true if effect!=='none' */
   t2.roleGlow=(effect!=='none');
   if(role==='player'){t2.lastRolePay=0;t2.roleColor='';t2.roleEffect='none';t2.roleGlow=false;t2.roleBenefits={};}
   pushMe(t2);save();
   broadcast({t:'pRoleUpdate',id:t2.id,role:t2.role,roleColor:t2.roleColor,roleEffect:t2.roleEffect,roleGlow:t2.roleGlow},t2.id);
   sendTo(admin.id,{t:'toast',msg:t2.name+' is now '+role.toUpperCase()+(color?' ('+color+')':'')+(effect!=='none'?' ['+effect.toUpperCase()+']':''),kind:'good'});
   sendTo(t2.id,{t:'toast',msg:'You are now a '+role.toUpperCase()+'.',kind:'quest'});
   log('role:set',t2.id,role+'/'+effect+(color?'/'+color:'')+' benefits:'+JSON.stringify(benefits));break;}
  case 'listRoles':{
   /* Return ALL players with their roles, IDs, effects, benefits — admin can see everyone */
   const list=[...G.players.values()].map(p=>({id:p.id,pid:p.pid||'',name:p.name,role:p.role||'player',roleColor:p.roleColor||'',roleEffect:p.roleEffect||'none',roleGlow:!!p.roleGlow,roleBenefits:p.roleBenefits||{},givenBy:p.roleGivenBy||'',online:!!p.online}));
   sendTo(admin.id,{t:'admData',kind:'roles',data:list});break;}
  case 'getDeciderWishes':{
   sendTo(admin.id,{t:'admData',kind:'deciderWishes',data:G.s2.deciderWishes||[]});break;}
  case 'clearDeciderWish':{
   const idx=G.s2.deciderWishes.findIndex(w=>w.player===a.targetId);
   if(idx>=0){G.s2.deciderWishes.splice(idx,1);G.dirty=true;save();
    sendTo(admin.id,{t:'admData',kind:'deciderWishes',data:G.s2.deciderWishes});}
   break;}
  /* ===== GLOBAL COUNTDOWN TIMER ===== */
  case 'setTimer':{
   const hours=Math.max(0,Math.min(23,+a.hours||0));
   const mins=Math.max(0,Math.min(59,+a.mins||0));
   const secs=Math.max(0,Math.min(59,+a.secs||0));
   const totalSec=hours*3600+mins*60+secs;
   if(totalSec<1)return sendTo(admin.id,{t:'toast',msg:'Timer must be at least 1 second.',kind:'err'});
   if(totalSec>86400)return sendTo(admin.id,{t:'toast',msg:'Timer max is 24 hours.',kind:'err'});
   const text=String(a.text||'').slice(0,80);
   const color=/^#[0-9a-fA-F]{6}$/.test(a.color||'')?a.color:'#e8a33d';
   const evId=String(a.event||'').slice(0,32);
   G.timer={active:true,end:now()+totalSec*1000,text,color,event:evId,by:admin.name};
   G.dirty=true;save();
   broadcast({t:'timerSet',end:G.timer.end,text:G.timer.text,color:G.timer.color,event:G.timer.event,by:G.timer.by,serverTime:now()});
   log('timer:set','global',totalSec+'s '+(evId||'no-event'));
   sendTo(admin.id,{t:'toast',msg:'Timer set for '+totalSec+'s.',kind:'good'});break;}
  case 'cancelTimer':{
   if(!G.timer.active)return sendTo(admin.id,{t:'toast',msg:'No active timer.',kind:'err'});
   G.timer={active:false,end:0,text:'',color:'#e8a33d',event:'',by:''};
   G.dirty=true;save();
   broadcast({t:'timerCancel'});
   sendTo(admin.id,{t:'toast',msg:'Timer cancelled.',kind:'good'});break;}
  /* ===== PORTAL VISIBILITY TOGGLE ===== */
  case 'togglePortal':{
   G.portalEnabled=!G.portalEnabled;G.dirty=true;save();
   broadcast({t:'portalToggle',enabled:G.portalEnabled});
   sendTo(admin.id,{t:'toast',msg:'Portal '+(G.portalEnabled?'ENABLED':'DISABLED'),kind:'good'});break;}
  case 'giveRelics':if(target){target.relics=(target.relics||0)+Math.max(0,+a.v||0);pushMe(target);}break;
  case 'rotateEmoteShop':rotateEmoteShop();break;
  case 'launchSeason':{if(G.season.active||G.season.status==='cinematic')return;
   launchSeason();sendTo(admin.id,{t:'toast',msg:'Season 1 launching!',kind:'good'});break;}
  case 'scheduleSeason':{const ts=+a.ts||0;
   if(!ts||ts<=now()+2000)return;
   G.season.status='scheduled';G.season.launchAt=ts;G.dirty=true;
   broadcast({t:'seasonState',season:seasonPacket()});
   sendTo(admin.id,{t:'toast',msg:'SPOOKY scheduled.',kind:'good'});break;}
  case 'cancelSchedule':{if(G.season.status!=='scheduled')return;
   G.season.status='inactive';G.season.launchAt=0;G.dirty=true;
   broadcast({t:'seasonState',season:seasonPacket()});break;}
  case 'resetSeason':{G.season={id:'SPOOKY',name:'Season 1: SPOOKY',status:'inactive',launchAt:0,cinematicAt:0,active:false};
   G.dirty=true;broadcast({t:'seasonReverted'});save();break;}
  case 'previewCinematic':{sendTo(admin.id,{t:'seasonPreview',cinematicAt:now(),serverTime:now()});break;}
  case 'setCash':if(target){target.cash=Math.max(0,Math.round(+a.v||0));pushMe(target);}break;
  case 'giveCash':if(target){target.cash+=Math.max(0,Math.round(+a.v||0));pushMe(target);}break;
  case 'giveSeed':if(target&&SEED_MAP[a.seed]){target.seeds[a.seed]=(target.seeds[a.seed]||0)+1;
   if(!target.discovered.seeds.includes(a.seed))target.discovered.seeds.push(a.seed);pushMe(target);}break;
  case 'givePack':if(target){target.packs++;pushMe(target);}break;
  case 'giveEgg':if(target&&EGG_MAP[a.egg]){target.eggs[a.egg]=(target.eggs[a.egg]||0)+1;pushMe(target);}break;
  case 'givePet':if(target&&PET_MAP[a.pet]){target.pets.push({uid:'K'+(G.nextId++),pid:a.pet,lvl:10,xp:900,eq:false});
   if(!target.discovered.pets.includes(a.pet))target.discovered.pets.push(a.pet);pushMe(target);}break;
  case 'giveGear':if(target&&GEAR_MAP[a.gear]&&!target.gear.includes(a.gear)){target.gear.push(a.gear);pushMe(target);}break;
  case 'restockAll':restock(true);break;
  case 'restockSeed':if(G.stock[a.seed]){G.stock[a.seed].qty=Math.max(0,+a.qty||0);broadcast(stockMsg());}break;
  case 'startEvent':{const d=EV_MAP[a.ev];if(d)startEvent(d,+a.dur?a.dur*1000:0,true);break;}
  case 'endEvent':endEvent();break;
  case 'randomEvent':{const pool=EVENTS.filter(e=>e.w>0);startEvent(pool[rint(0,pool.length-1)]);break;}
  case 'pauseGrow':G.paused=!!a.v;broadcast({t:'toast',msg:'Growth '+(G.paused?'paused':'resumed')+'.'});break;
  case 'setGrowMul':G.growMul=Math.max(.1,Math.min(10,+a.v||1));break;
  case 'matureAll':{for(const pl of G.plants.values())if(a.ownerOnly?pl.o===target.id:true)
    if(SEED_MAP[pl.s])pl.prog=SEED_MAP[pl.s].grow;
   pushPlants();break;}
  /* ===== ADMIN SPAWN PLANT IN A PLAYER'S GARDEN =====
     Args: targetId, seed (seedId), x, z, mature (bool), muts (array of mutation IDs)
     The plant spawns in the target's plot at the given coordinates with optional mutations. */
  case 'spawnPlant':{
   if(!target)return sendTo(admin.id,{t:'toast',msg:'Player not found.',kind:'err'});
   const sd=SEED_MAP[a.seed];
   if(!sd)return sendTo(admin.id,{t:'toast',msg:'Invalid seed ID.',kind:'err'});
   /* Use target's plot position */
   const tp=PLOT_POS[target.plot]||[0,0];
   const tx=+a.x||tp[0]+(Math.random()-.5)*4;
   const tz=+a.z||tp[1]+(Math.random()-.5)*4;
   /* Validate it's inside the target's plot */
   const half=PLOT_HALF[target.expansion]||6;
   if(Math.abs(tx-tp[0])>half||Math.abs(tz-tp[1])>half){
    /* If outside plot, snap to plot center */
    return sendTo(admin.id,{t:'toast',msg:'Coordinates outside player\'s plot. Use their plot area.',kind:'err'});
   }
   /* Check for collisions */
   for(const pl of G.plants.values()){
    if(pl.o===target.id&&dist2(pl.x,pl.z,tx,tz)<.81){
     return sendTo(admin.id,{t:'toast',msg:'Too close to an existing plant.',kind:'err'});
    }
   }
   /* Parse mutations — comma-separated string OR array, validated against MUT_MAP */
   let muts=[];
   if(a.muts){
    const rawMuts=Array.isArray(a.muts)?a.muts:String(a.muts).split(',');
    for(const m of rawMuts){const mt=String(m).trim();if(mt&&MUT_MAP[mt]&&!muts.includes(mt))muts.push(mt);}
    if(muts.length>3)muts=muts.slice(0,3);
   }
   /* Create the plant */
   const newPl={id:'P'+(G.nextId++),o:target.id,s:sd.id,x:tx,z:tz,prog:0,boostUntil:0,muts};
   if(a.mute){newPl.prog=0;}
   else if(a.mature||a.mature===undefined){newPl.prog=sd.grow;} /* default to mature */
   G.plants.set(newPl.id,newPl);
   pushPlants();G.dirty=true;save();
   log('admin:spawnPlant',target.id,sd.id+' muts:'+muts.join(','));
   sendTo(admin.id,{t:'toast',msg:'Spawned '+sd.n+(muts.length?(' ['+muts.join(', ')+']'):'')+' in '+target.name+'\'s garden.',kind:'good'});
   sendTo(target.id,{t:'toast',msg:'A '+sd.n+' appeared in your garden'+(muts.length?' with mutations!':'!'),kind:'quest'});
   break;}
  case 'chaos':{const map={goldenrain:'goldenhour',supergrowth:'giantgrowth',rainbowburst:'rainboww',
   meteorshower:'meteors',nightfall:'eclipse',cosmicbloom:'cosmicbloom',luckyharvest:'luckyharvest',
   worldtreeawake:'worldtree',petparade:'superbloom',crystalstorm:'crystalrain'};
   startEvent(EV_MAP[map[a.mode]||'converge'],120000,true);break;}
  /* ===== CHAOS ACTIVATION (Sammy Snap-style cinematic) =====
     Admin selects multiple events + clicks GO. Server broadcasts a synchronized cinematic
     to ALL players. After ~6 seconds (when the snap happens), the selected events start. */
  case 'chaosActivate':{
   /* Parse event list — must be an array of valid event IDs */
   let eventIds=Array.isArray(a.events)?a.events:[];
   eventIds=eventIds.map(id=>String(id).slice(0,32)).filter(id=>EV_MAP[id]);
   if(eventIds.length===0)return sendTo(admin.id,{t:'toast',msg:'Select at least one event.',kind:'err'});
   /* Limit to 5 events to avoid spam */
   if(eventIds.length>5)eventIds=eventIds.slice(0,5);
   /* Prevent duplicate activation if a cinematic is already running */
   if(G.chaosActivation.active)return sendTo(admin.id,{t:'toast',msg:'A chaos activation is already in progress.',kind:'err'});
   /* Set state — active, with the event list + snap time (6 seconds from now) */
   const snapAt=now()+6000;
   G.chaosActivation={active:true,startedAt:now(),events:eventIds,snapScheduledAt:snapAt};
   /* Broadcast the cinematic start to ALL players — they'll see the rising figure + snap animation */
   broadcast({t:'chaosCinematicStart',events:eventIds,snapAt:snapAt,serverTime:now(),adminName:admin.name});
   log('admin:chaosActivate',admin.id,eventIds.join(','));
   sendTo(admin.id,{t:'toast',msg:'Chaos cinematic started — events will trigger in 6 seconds!',kind:'good'});
   /* Schedule the actual event start at the snap moment.
      Only ONE event can be active at a time (G.event is a single slot).
      We pick the FIRST selected event to actually start; the others are shown in the cinematic title
      but don't stack. If hauntedharvest is selected, it starts the HH state machine instead. */
   setTimeout(()=>{
    /* If hauntedharvest was selected, start the HH state machine (it's a separate system) */
    if(eventIds.includes('hauntedharvest')){
     hhStart(true);
    }else{
     /* Start only the FIRST selected event — not all of them (prevents stacking) */
     const firstEvId=eventIds[0];
     const def=EV_MAP[firstEvId];
     if(def){
      startEvent(def,90000,true);
     }
    }
    /* Clear the activation state */
    G.chaosActivation={active:false,startedAt:0,events:[],snapScheduledAt:0};
    /* Broadcast that the snap happened — clients can play the shockwave effect */
    broadcast({t:'chaosSnap',serverTime:now()});
   },6000);
   break;}
  /* ===== HAUNTED HARVEST — manual start via admin ===== */
  case 'hhStart':{
   if(G.hauntedHarvest.active)return sendTo(admin.id,{t:'toast',msg:'Haunted Harvest already active.',kind:'err'});
   hhStart(true);
   sendTo(admin.id,{t:'toast',msg:'🎃 The Haunted Harvest has been started!',kind:'good'});
   break;}
  case 'teleportPlayer':if(target)sendTo(target.id,{t:'teleport',x:a.x||0,z:a.z||0});break;
  case 'kick':{const t2=G.players.get(a.targetId);if(t2){
   sendTo(t2.id,{t:'kicked',msg:a.msg||'Kicked.'});
   setTimeout(()=>{for(const c of WSS.clients)if(c._id===t2.id)c.close();},500);}break;}
  case 'notify':if(target)sendTo(target.id,{t:'toast',msg:'[Admin] '+(a.msg||''),kind:'info'});break;
  case 'announce':broadcast({t:'announce',msg:String(a.msg||'').slice(0,300),
   color:/^#[0-9a-fA-F]{6}$/.test(a.color||'')?a.color:'',
   style:['classic','spooky','neon','elegant'].includes(a.style)?a.style:'classic',
   dur:Math.max(2,Math.min(120,+a.dur||6))});break;
  case 'logs':sendTo(admin.id,{t:'admData',kind:'logs',data:G.logs.slice(-80)});break;
  case 'setDayTime':broadcast({t:'dayTime',v:+a.v||0});break;
  case 'save':save();sendTo(admin.id,{t:'toast',msg:'Saved.',kind:'good'});break;
  case 'setMutCap':G.mutCap=Math.max(1,Math.min(6,+a.v||3));break;
  case 'clearInv':if(target&&a.confirm){target.produce=[];pushMe(target);}break;
  default:sendTo(admin.id,{t:'toast',msg:'Unknown command: '+c,kind:'err'});
 }}

/* ===== HTML PAGES (defined BEFORE server creation) ===== */
const RESET_PAGE_HTML=`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reset Password — FARM</title><link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700;800&family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:flex;align-items:center;justify-content:center;
background:radial-gradient(ellipse at 50% 120%,#1a3a22 0%,#0c1e14 45%,#040a06 100%);font-family:'Nunito',sans-serif;color:#f0e8d0;padding:20px}
.card{background:linear-gradient(180deg,#0e2418,#06120c);border:2px solid #2f5d3a;border-radius:20px;padding:36px 32px;width:min(440px,92vw);
box-shadow:0 30px 80px #000a,0 0 60px #2f5d3a22;text-align:center}
.brand{font-family:'Fredoka',sans-serif;font-weight:800;font-size:34px;letter-spacing:.22em;color:#80e890;
text-shadow:0 0 18px #4fae6866;margin-bottom:4px}
.tag{font-size:10px;color:#5a8a6a;letter-spacing:.3em;text-transform:uppercase;margin-bottom:22px}
h1{font-family:'Fredoka',sans-serif;font-weight:700;font-size:24px;color:#f0e8d0;margin-bottom:6px}
p{color:#9ab0a0;font-size:14px;margin-bottom:18px;line-height:1.5}
input{width:100%;background:#040a06;border:2px solid #2f5d3a55;border-radius:10px;color:#f0e8d0;padding:14px;font-size:16px;
font-family:'Nunito',sans-serif;outline:none;margin-bottom:12px;text-align:center}
input:focus{border-color:#4fae68;box-shadow:0 0 0 3px #4fae6822}
input::placeholder{color:#5a8a6a;font-weight:500}
button{width:100%;background:linear-gradient(180deg,#4f9a5c,#2f5d3a);color:#fff;font-family:'Fredoka',sans-serif;font-weight:600;font-size:16px;
padding:14px;border-radius:12px;border:2px solid #4fae6855;cursor:pointer;margin-top:6px;letter-spacing:.04em;transition:filter .15s,transform .1s}
button:hover{filter:brightness(1.12)}button:active{transform:scale(.97)}
.msg{margin-top:14px;font-size:14px;padding:12px;border-radius:8px;line-height:1.4}
.msg.ok{background:#0e2418;border:1px solid #4fae68;color:#80e890}
.msg.err{background:#2a1410;border:1px solid #c04020;color:#ff6040}
.pwShow{position:relative;width:100%;margin-bottom:12px}
.pwShow input{margin-bottom:0;padding-right:46px}
.pwShow .eye{position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#5a8a6a;
cursor:pointer;font-size:18px;padding:6px;border-radius:6px}.pwShow .eye:hover{color:#80e890;background:#ffffff11}
.hint{font-size:12px;color:#5a7060;margin-top:8px}
.doneBox{display:none;padding:32px 16px}
.doneBox .check{font-size:64px;color:#80e890;text-shadow:0 0 20px #4fae6866;margin-bottom:16px;animation:pop .5s cubic-bezier(.2,1.4,.3,1)}
@keyframes pop{from{transform:scale(0);opacity:0}}
.doneBox h2{font-family:'Fredoka',sans-serif;font-weight:700;font-size:22px;color:#80e890;margin-bottom:10px}
.doneBox p{color:#9ab0a0;font-size:15px;line-height:1.6;margin-bottom:8px}
.doneBox .leaveMsg{margin-top:20px;padding:16px;background:#0a1a14;border:1px solid #2f5d3a44;border-radius:10px;
color:#80e890;font-weight:600;font-size:15px}</style></head>
<body><div class="card"><div class="brand">FARM</div><div class="tag">grow · mutate · prosper</div>
<div id="formDiv">
<h1>Reset Your Password</h1><p>Type your username and choose a new password to update your account.</p>
 <input id="resetUser" maxlength="16" placeholder="Your username" autocomplete="off" spellcheck="false">
 <div class="pwShow"><input type="password" id="np1" placeholder="New password (min 6 chars)" autocomplete="new-password">
  <button class="eye" type="button" data-target="np1" aria-label="Show password">&#128065;</button></div>
 <div class="pwShow"><input type="password" id="np2" placeholder="Confirm new password" autocomplete="new-password">
  <button class="eye" type="button" data-target="np2" aria-label="Show password">&#128065;</button></div>
 <button id="submitBtn">SET NEW PASSWORD</button>
 <div class="hint">Tip: use 6+ characters, mix letters & numbers for a stronger password.</div>
</div>
<div id="result"></div>
<div class="doneBox" id="doneBox">
 <div class="check">&#10003;</div>
 <h2>Password Updated!</h2>
 <p>Your account has been updated successfully.</p>
 <div class="leaveMsg">You can now close this page.</div>
</div></div>
<script>
/* Toggle password visibility */
document.querySelectorAll('.eye').forEach(b=>{b.onclick=()=>{const i=document.getElementById(b.dataset.target);
  if(i.type==='password'){i.type='text';b.innerHTML='&#128064;';}else{i.type='password';b.innerHTML='&#128065;';}};});
document.getElementById('submitBtn').onclick=async()=>{
 const username=document.getElementById('resetUser').value.trim();
 const np1=document.getElementById('np1').value,np2=document.getElementById('np2').value;
 const r=document.getElementById('result');
 if(!username){r.innerHTML='<div class="msg err">Please enter your username.</div>';return;}
 if(np1.length<6){r.innerHTML='<div class="msg err">Password must be at least 6 characters.</div>';return;}
 if(np1!==np2){r.innerHTML='<div class="msg err">Passwords do not match.</div>';return;}
 r.innerHTML='<div class="msg ok">Saving your new password...</div>';
 document.getElementById('submitBtn').disabled=true;
 try{
  const resp=await fetch('/api/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({username:username,password:np1})});
  const data=await resp.json();
  if(data.success){
   document.getElementById('formDiv').style.display='none';
   r.innerHTML='';
   document.getElementById('doneBox').style.display='block';
  }else{r.innerHTML='<div class="msg err">'+data.message+'</div>';
   document.getElementById('submitBtn').disabled=false;}
 }catch(e){r.innerHTML='<div class="msg err">Network error. Please try again.</div>';document.getElementById('submitBtn').disabled=false;}};
</script></body></html>`;

const VERIFY_OK_HTML=`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email Verified — FARM</title><link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700;800&family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:flex;align-items:center;justify-content:center;
background:radial-gradient(ellipse at 50% 120%,#1a3a22 0%,#0a1a14 45%,#020804 100%);font-family:'Nunito',sans-serif;color:#80e890}
.card{background:linear-gradient(180deg,#0a1a14,#020804);border:2px solid #4fae6844;border-radius:20px;padding:40px;width:min(440px,92vw);
box-shadow:0 30px 80px #000a,0 0 60px #4fae6822;text-align:center}
.brand{font-family:'Fredoka',sans-serif;font-weight:800;font-size:30px;letter-spacing:.22em;color:#80e890;
text-shadow:0 0 18px #4fae6866;margin-bottom:4px}
.tag{font-size:10px;color:#5a8a6a;letter-spacing:.3em;text-transform:uppercase;margin-bottom:22px}
h1{font-family:'Fredoka',sans-serif;font-weight:700;font-size:24px;color:#80e890;margin-bottom:12px}
p{color:#60a070;font-size:15px;margin-bottom:18px;line-height:1.5}
a{display:inline-block;margin-top:14px;background:linear-gradient(180deg,#4f9a5c,#2f5d3a);color:#fff;
padding:14px 28px;border-radius:12px;text-decoration:none;font-family:'Fredoka';font-weight:600;font-size:16px;border:2px solid #4fae6855}
a:hover{filter:brightness(1.12)}</style></head>
<body><div class="card"><div class="brand">FARM</div><div class="tag">grow · mutate · prosper</div>
<h1>&#10003; Email Verified</h1><p>Your email has been verified successfully.</p>
<p>You can now use the forgot password feature if you ever lose access.</p>
<a href="/">&#8594; CONTINUE TO LOGIN</a></div></body></html>`;

const VERIFY_FAIL_HTML=`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verification Failed — FARM</title><link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700;800&family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:flex;align-items:center;justify-content:center;
background:radial-gradient(ellipse at 50% 120%,#2a0a0a 0%,#1a0606 45%,#0a0202 100%);font-family:'Nunito',sans-serif;color:#ff6040}
.card{background:linear-gradient(180deg,#1a0606,#0a0202);border:2px solid #c0402044;border-radius:20px;padding:40px;width:min(440px,92vw);
box-shadow:0 30px 80px #000a,0 0 60px #c0402022;text-align:center}
.brand{font-family:'Fredoka',sans-serif;font-weight:800;font-size:30px;letter-spacing:.22em;color:#ff6040;
text-shadow:0 0 18px #c0402066;margin-bottom:4px}
.tag{font-size:10px;color:#8a5a5a;letter-spacing:.3em;text-transform:uppercase;margin-bottom:22px}
h1{font-family:'Fredoka',sans-serif;font-weight:700;font-size:24px;color:#ff4030;margin-bottom:12px}
p{color:#a06050;font-size:15px;margin-bottom:18px;line-height:1.5}
a{display:inline-block;margin-top:14px;background:linear-gradient(180deg,#a04030,#5a1a10);color:#ffd0a0;
padding:14px 28px;border-radius:12px;text-decoration:none;font-family:'Fredoka';font-weight:600;font-size:16px;border:2px solid #c0402055}
a:hover{filter:brightness(1.12)}</style></head>
<body><div class="card"><div class="brand">FARM</div><div class="tag">grow · mutate · prosper</div>
<h1>Verification Failed</h1><p>The verification link is invalid, expired, or has already been used.</p>
<a href="/">&#8594; BACK TO LOGIN</a></div></body></html>`;

const server=http.createServer((req,res)=>{
 const fullUrl=req.url||'/';
 const url=fullUrl.split('?')[0].replace(/\/+/g,'/'); /* normalize double slashes */
 /* Route: Reset password page */
 if(url==='/reset-password'){
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(RESET_PAGE_HTML);return;}
 /* Route: Reset password API — accepts {username, password}, updates accounts.json directly */
 if(url==='/api/reset-password'&&req.method==='POST'){
  let body='';req.on('data',c=>body+=c);req.on('end',()=>{
   try{
    const data=JSON.parse(body);
    const username=String(data.username||'').trim();
    const password=String(data.password||'');
    if(!username||password.length<6)return res.writeHead(400).end(JSON.stringify({success:false,message:'Username and a 6+ char password are required.'}));
    const acc=findAccountByUsername(username);
    if(!acc)return res.writeHead(400).end(JSON.stringify({success:false,message:'No account found with that username.'}));
    bcrypt.hash(password,10,(e,hash)=>{
     if(e)return res.writeHead(500).end(JSON.stringify({success:false,message:'Server error.'}));
     acc.passwordHash=hash;saveAccounts();
     console.log('[FARM] Password reset for',acc.username);
     res.writeHead(200,{'Content-Type':'application/json'});
     res.end(JSON.stringify({success:true}));});
   }catch(e){res.writeHead(400).end(JSON.stringify({success:false,message:'Invalid request.'}));}});
  return;}
 /* Route: Verify email */
 if(url==='/verify-email'){
  const token=new URL(fullUrl,'http://localhost').searchParams.get('token');
  if(token){
   const acc=Object.values(ACCOUNTS).find(a=>a.verifyToken===token);
   if(acc){acc.emailVerified=true;acc.verifyToken=undefined;saveAccounts();
    console.log('[FARM] Email verified for',acc.username);
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(VERIFY_OK_HTML);return;}
  }
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(VERIFY_FAIL_HTML);return;}
 /* Route: Main game */
 if(url==='/'||url==='/index.html'){
  fs.readFile(path.join(__dirname,'index.html'),(e,buf)=>{
   if(e){res.writeHead(500);return res.end('index.html missing');}
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(buf);});return;}
 const fp=path.join(__dirname,path.normalize(url).replace(/^([/\\]|\.\.)+/g,''));
 if(fp.startsWith(__dirname)&&fs.existsSync(fp)&&fs.statSync(fp).isFile()){
  const ext=path.extname(fp).toLowerCase();
  const mime={'.js':'text/javascript','.html':'text/html; charset=utf-8','.css':'text/css',
   '.ico':'image/x-icon','.png':'image/png','.jpg':'image/jpeg','.json':'application/json'}[ext]||'application/octet-stream';
  fs.readFile(fp,(e,buf)=>{if(e){res.writeHead(500);return res.end();}
   res.writeHead(200,{'Content-Type':mime});res.end(buf);});return;}
 res.writeHead(404);res.end();});

if(WebSocketServer){
 const wss=new WebSocketServer.Server({server});WSS=wss;
 wss.on('connection',(sock,req)=>{
  sock._id=null;sock._ip=req.socket.remoteAddress;sock._bucket={n:0,t:now()};let joined=false;
  sock.on('message',raw=>{
   if(raw.length>32768)return;
   const b=sock._bucket,t=now();if(t-b.t>5000){b.t=t;b.n=0;}
   let msg;try{msg=JSON.parse(raw);}catch(e){return;}
   b.n+=msg.t==='pos'?.2:1;if(b.n>40)return;
   if(!joined){
    /* ===== ACCOUNT AUTHENTICATION ===== */
    if(msg.t==='signup'){
     const username=String(msg.username||'').trim();
     const password=String(msg.password||'');
     const email=String(msg.email||'').trim().toLowerCase();
     if(!usernameOK(username))return sock.send(JSON.stringify({t:'authError',msg:'Username must be 3-16 chars, letters/numbers/_- only, no bad words.'}));
     if(password.length<6)return sock.send(JSON.stringify({t:'authError',msg:'Password must be at least 6 characters.'}));
     if(findAccountByUsername(username))return sock.send(JSON.stringify({t:'authError',msg:'That username is taken.'}));
     const lowUser=username.toLowerCase();
     bcrypt.hash(password,10,(e,hash)=>{
      if(e)return sock.send(JSON.stringify({t:'authError',msg:'Server error. Try again.'}));
      const id='U'+crypto.randomBytes(6).toString('hex');
      const p=newPlayer(id,username);p.online=true;G.players.set(p.id,p);
      ACCOUNTS[lowUser]={username:lowUser,passwordHash:hash,email:email,emailVerified:false,playerId:id,createdAt:Date.now()};
      saveAccounts();
      /* Send verification email if email provided and Resend is configured */
      if(email&&RESEND_API_KEY){
       const vToken=generateToken();
       ACCOUNTS[lowUser].verifyToken=vToken;saveAccounts();
       const vUrl=APP_BASE_URL.replace(/\/$/,'')+'/verify-email?token='+vToken;
       sendEmail(email,'Welcome to FARM — Verify Your Email',
        '<div style="max-width:560px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background:#f7f0e0;border-radius:16px;overflow:hidden;border:3px solid #2f5d3a">'+
        '<div style="background:linear-gradient(135deg,#2f5d3a,#3f7a4a);padding:32px 24px;text-align:center">'+
        '<h1 style="color:#f7f0e0;font-size:36px;margin:0;letter-spacing:.2em">FARM</h1>'+
        '<p style="color:#b8d8a0;font-size:13px;letter-spacing:.3em;text-transform:uppercase;margin:6px 0 0">grow · mutate · prosper</p></div>'+
        '<div style="padding:32px 24px">'+
        '<h2 style="color:#2f5d3a;font-size:24px;margin:0 0 12px">Welcome to the FARM community!</h2>'+
        '<p style="color:#3a3226;font-size:16px;line-height:1.6;margin:0 0 20px">Thanks for joining FARM. Verify your email address to activate your account.</p>'+
        '<a href="'+vUrl+'" style="display:inline-block;background:linear-gradient(180deg,#4f9a5c,#2f5d3a);color:#fff;font-size:18px;font-weight:700;padding:14px 36px;border-radius:10px;text-decoration:none;margin:8px 0 20px">Verify My Email</a>'+
        '<p style="color:#8a8270;font-size:13px;margin:12px 0 0">If you didn\'t create this account, ignore this email.</p>'+
        '<p style="color:#8a8270;font-size:12px;margin:16px 0 0">Or copy this link: '+vUrl+'</p>'+
        '</div></div>');
      }
      sock._id=p.id;joined=true;
      sendInitData(sock,p);
     });
     return;}
    if(msg.t==='login'){
     const username=String(msg.username||'').trim();
     const password=String(msg.password||'');
     const acc=findAccountByUsername(username);
     if(!acc)return sock.send(JSON.stringify({t:'authError',msg:'Invalid username or password.'}));
     bcrypt.compare(password,acc.passwordHash,(e,match)=>{
      if(e||!match)return sock.send(JSON.stringify({t:'authError',msg:'Invalid username or password.'}));
      let p=G.players.get(acc.playerId);
      if(!p){p=newPlayer(acc.playerId,acc.username||username);G.players.set(p.id,p);}
      /* Force-close any stale connection from a previous session */
      if(p.online){for(const c of WSS.clients){if(c._id===p.id&&c.readyState===1)c.close();}}
      p.online=true;if(p.packs===undefined)p.packs=0;if(p.bloodDrops===undefined)p.bloodDrops=0;
      p.username=acc.username;p.email=acc.email;p.emailVerified=acc.emailVerified;
      sock._id=p.id;joined=true;
      sendInitData(sock,p);
     });
     return;}
    if(msg.t==='forgotPassword'){
     const email=String(msg.email||'').trim().toLowerCase();
     const acc=findAccountByEmail(email);
     /* Always show same message — don't reveal if email exists */
     if(acc&&acc.emailVerified){
      const rUrl=APP_BASE_URL.replace(/\/$/,'')+'/reset-password';
      sendEmail(acc.email,'FARM — Reset Your Password',
       '<div style="max-width:560px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background:#f7f0e0;border-radius:16px;overflow:hidden;border:3px solid #2f5d3a">'+
        '<div style="background:linear-gradient(135deg,#2f5d3a,#3f7a4a);padding:32px 24px;text-align:center">'+
        '<h1 style="color:#f7f0e0;font-size:36px;margin:0;letter-spacing:.2em">FARM</h1>'+
        '<p style="color:#b8d8a0;font-size:13px;letter-spacing:.3em;text-transform:uppercase;margin:6px 0 0">grow · mutate · prosper</p></div>'+
        '<div style="padding:32px 24px">'+
        '<h2 style="color:#2f5d3a;font-size:24px;margin:0 0 12px">Reset Your FARM Password</h2>'+
        '<p style="color:#3a3226;font-size:16px;line-height:1.6;margin:0 0 20px">We received a request to reset your password. Click the button below to open the reset page, then type your username and choose a new password.</p>'+
        '<a href="'+rUrl+'" style="display:inline-block;background:linear-gradient(180deg,#4f9a5c,#2f5d3a);color:#fff;font-size:18px;font-weight:700;padding:14px 36px;border-radius:10px;text-decoration:none;margin:8px 0 20px">Reset My Password</a>'+
        '<p style="color:#8a8270;font-size:13px;margin:12px 0 0">You will need your username to complete the reset.</p>'+
        '<p style="color:#8a8270;font-size:13px;margin:8px 0 0">If you didn\'t request this, ignore this email.</p>'+
        '<p style="color:#8a8270;font-size:12px;margin:16px 0 0">Or copy this link: '+rUrl+'</p>'+
        '</div></div>');
     }
     sock.send(JSON.stringify({t:'authInfo',msg:'If an account exists for that email, a reset link has been sent.'}));
     return;}
    /* Legacy 'join' still works (for older clients) — auto-creates a player without an account */
    if(msg.t==='join'){
     const clean=cleanName(msg.name);
     if(!clean)return sock.send(JSON.stringify({t:'nameRejected',msg:'Bad name.'}));
     const id='U'+crypto.randomBytes(6).toString('hex');
     let p=[...G.players.values()].find(x=>x.name===clean&&!x.online);
     if(p){p.online=true;if(p.packs===undefined)p.packs=0;if(p.bloodDrops===undefined)p.bloodDrops=0;}
     else{p=newPlayer(id,clean);p.online=true;G.players.set(p.id,p);}
     sock._id=p.id;joined=true;
     sendInitData(sock,p);
     return;}
    /* Ignore any other message type until joined */
    return;
   }
   try{handleMsg(sock,msg);}catch(e){console.error('[FARM] handler:',e.message);}});
  sock.on('close',()=>{if(!sock._id)return;const p=G.players.get(sock._id);if(p){p.online=false;save();}
   broadcast({t:'pLeft',id:sock._id});});});
 setInterval(()=>{tickPlants();tickSeason2();
  if(G.event&&now()>G.event.end)endEvent();
  if(!G.event&&now()>G.nextEventRoll){G.nextEventRoll=now()+60000;if(Math.random()<.65)rollEvent();}
  if(now()>G.restockAt)restock(false);
  if(now()>G.emoteRestockAt)rotateEmoteShop();
  if(G.maintenance.active&&now()>G.maintenance.until){
   G.maintenance={active:false,until:0,msg:'',fix:'',by:''};G.dirty=true;
   broadcast({t:'maintenance',until:0,msg:'',fix:'',by:''});}
  if(G.season.status==='scheduled'&&G.season.launchAt&&now()>=G.season.launchAt)launchSeason();
  /* ===== DAILY ROLE PAYMENTS =====
     Special role gets 1M sheckles/day (legacy default).
     Custom roles with roleBenefits.cashPerDay / relicsPerDay also pay out daily. */
  const dayKey=new Date().toDateString();
  for(const p of G.players.values()){
   if(p.lastRolePayKey===dayKey)continue;
   let payCash=0,payRelics=0,msgs=[];
   /* Legacy: 'special' role = 1M sheckles/day */
   if(p.role==='special'){payCash+=1000000;msgs.push('+1,000,000 sheckles (Special Role)');}
   /* Custom role benefits */
   if(p.roleBenefits&&typeof p.roleBenefits==='object'){
    if(p.roleBenefits.cashPerDay){payCash+=p.roleBenefits.cashPerDay;msgs.push('+'+p.roleBenefits.cashPerDay+' sheckles');}
    if(p.roleBenefits.relicsPerDay){payRelics+=p.roleBenefits.relicsPerDay;msgs.push('+'+p.roleBenefits.relicsPerDay+' relics');}
   }
   if(payCash||payRelics){
    p.cash=(p.cash||0)+payCash;p.relics=(p.relics||0)+payRelics;
    p.lastRolePayKey=dayKey;G.dirty=true;
    if(p.online){pushMe(p);sendTo(p.id,{t:'toast',msg:'☕ Daily '+p.role+' bonus: '+msgs.join(', '),kind:'quest'});}
   }
  }
 },2000);
 /* ===== AUCTION TICK — checks every 1s if auction ended, awards item to winner ===== */
 setInterval(()=>{
  if(!G.auction.active)return;
  if(now()<G.auction.endAt)return;
  /* Auction ended — find winner (highest bidder who can still afford it) */
  G.auction.active=false;
  let winner=null,winnerName='',winAmount=0;
  if(G.auction.bids.length>0){
   for(const b of G.auction.bids){
    if(b.id){
     const bp=G.players.get(b.id);
     if(!bp)continue;
     const bal=G.auction.currency==='relics'?(bp.relics||0):(bp.cash||0);
     if(bal>=b.amount){winner=bp;winnerName=bp.name;winAmount=b.amount;break;}
    }
   }
  }
  if(winner){
   /* Deduct payment (10% tax = economy sink) */
   const tax=Math.floor(winAmount*0.1);
   const payout=winAmount-tax;
   if(G.auction.currency==='relics'){winner.relics=(winner.relics||0)-winAmount;}
   else{winner.cash=(winner.cash||0)-winAmount;}
   /* Award item */
   const it=G.auction.itemType;
   const itemId=G.auction.item;
   if(it==='pet'){winner.pets.push({uid:'K'+(G.nextId++),pid:itemId,lvl:1,xp:0,eq:false});
    if(!winner.discovered.pets.includes(itemId))winner.discovered.pets.push(itemId);}
   else if(it==='egg'){winner.eggs[itemId]=(winner.eggs[itemId]||0)+1;}
   else if(it==='seed'){winner.seeds[itemId]=(winner.seeds[itemId]||0)+1;
    if(!winner.discovered.seeds.includes(itemId))winner.discovered.seeds.push(itemId);}
   else if(it==='gear'){if(!winner.gear.includes(itemId))winner.gear.push(itemId);}
   else if(it==='cosmetic'){winner.cosmetics[itemId]=true;}
   else if(it==='goldpass'){winner.goldOwned=true;}
   else if(it==='relics'){winner.relics=(winner.relics||0)+parseInt(itemId)||0;}
   else if(it==='cash'){winner.cash=(winner.cash||0)+parseInt(itemId)||0;}
   else if(it==='pack'){winner.packs=(winner.packs||0)+1;}
   pushMe(winner);save();
   broadcast({t:'auctionEnd',winner:winnerName,amount:winAmount,currency:G.auction.currency,
    item:G.auction.itemName,itemType:it,itemId:itemId});
   log('auction:end',winner.id,G.auction.itemName+' @ '+winAmount);
  }else{
   broadcast({t:'auctionEnd',cancelled:false,noWinner:true});
   log('auction:end','global','no winner');
  }
  G.auction={active:false,item:'',itemType:'',itemName:'',itemRar:'',basePrice:0,currency:'cash',highestBid:0,highestBidder:null,highestBidderName:'',bids:[],endAt:0,extensionsUsed:0,by:''};
  G.dirty=true;save();
 },1000);
 /* ===== TIMER TICK — checks every 250ms for smooth 3-2-1 countdown + fires event on expiry ===== */
 setInterval(()=>{
  if(!G.timer.active)return;
  const rem=G.timer.end-now();
  if(rem<=0){
   /* Timer expired — fire the event if one was selected */
   const evId=G.timer.event;
   G.timer={active:false,end:0,text:'',color:'#e8a33d',event:'',by:''};
   G.dirty=true;save();
   broadcast({t:'timerEnd',event:evId,serverTime:now()});
   if(evId&&EV_MAP[evId]){
    startEvent(EV_MAP[evId],0,true);
    log('timer:event','global',evId);
   }else{
    broadcast({t:'toast',msg:'Timer ended.',kind:'event'});
   }
  }
 },250);
 setInterval(()=>{broadcast({t:'seasonState',season:seasonPacket()});
  broadcast({t:'s2State',s2:s2Packet()});},5000);
 setInterval(pushPlants,5000);
 setInterval(save,SAVE_MS);
 setInterval(()=>{broadcast({t:'plots',plots:G.plots});
  broadcast({t:'leaderboard',list:[...G.players.values()].map(x=>({id:x.id,name:x.name,cash:x.cash})).sort((a,b)=>b.cash-a.cash).slice(0,10)});},20000);
 load();
 loadAccounts();
 process.on('SIGINT',()=>{console.log('\n[FARM] saving…');save();saveAccounts();process.exit(0);});
 server.listen(PORT,()=>console.log('[FARM] http://localhost:'+PORT));
}else{server.listen(PORT,()=>console.log('[FARM] HTTP only. npm install ws'));}
function fmt(n){return n>=1e9?(n/1e9).toFixed(1)+'B':n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e4?(n/1e3).toFixed(1)+'K':String(Math.round(n));}