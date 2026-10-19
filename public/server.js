/* FARM — authoritative server. Season 2: THE REBIRTH. Run: node server.js */
'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000;
const ADMIN_CODE=process.env.ADMIN_CODE;
const SAVE_FILE='farm_save.json',SAVE_BAK='farm_save.bak.json';
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
 E('corruptionsurge','Corruption Surge',150,2,'#1a0a1a','#3a1a2a',.7,'#a02080',.4,1.15,1,{demonized:15,voidtouched:10},{corrupt:1,seasonal:2}),
];
const EV_MAP=Object.fromEntries(EVENTS.map(e=>[e.id,e]));

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
 pumpkinking:{n:'Pumpkin King'},plague:{n:'Plague Doctor'},voidreaper:{n:'Void Reaper'},eternalnight:{n:'Eternal Night'}};
const COSMETICS=[
 {id:'pumpkin_head',n:'Pumpkin Head',rar:'Rare',pr:50000},{id:'witch_hat',n:'Witch Hat',rar:'Epic',pr:75000},
 {id:'skull_mask',n:'Skull Mask',rar:'Epic',pr:100000},{id:'spectral_aura',n:'Spectral Aura',rar:'Legendary',pr:200000}];
const COS_MAP=Object.fromEntries(COSMETICS.map(c=>[c.id,c]));
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

function serializePlayer(p){return{id:p.id,name:p.name,cash:p.cash,tokens:p.tokens,relics:p.relics||0,
 plot:p.plot,expansion:p.expansion,seeds:p.seeds,produce:p.produce,gear:p.gear,eggs:p.eggs,pets:p.pets,packs:p.packs||0,
 stats:p.stats,quests:p.quests,daily:p.daily,discovered:p.discovered,
 passXP:p.passXP||0,passLevel:p.passLevel||1,freeClaimed:p.freeClaimed||[],goldOwned:!!p.goldOwned,goldClaimed:p.goldClaimed||[],
 emotes:p.emotes||{},skins:p.skins||{},activeSkin:p.activeSkin||null,
 cosmetics:p.cosmetics||{},activeCosmetic:p.activeCosmetic||null,
 lastAbility:p.lastAbility||0,relicDay:p.relicDay||'',relicDrops:p.relicDrops||0,
 bloodDrops:p.bloodDrops||0,lastAlienTry:p.lastAlienTry||0,deciderBought:!!p.deciderBought};}
function save(){try{const data={savedAt:Date.now(),nextId:G.nextId,plots:G.plots,stock:G.stock,restockAt:G.restockAt,
 season:G.season,shopConfig:G.shopConfig,emoteStock:G.emoteStock,emoteRestockAt:G.emoteRestockAt,
 maintenance:G.maintenance,s2:G.s2,
 event:G.event?{id:G.event.def.id,start:G.event.start,end:G.event.end}:null,
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
  if(!Array.isArray(G.s2.deciderWishes))G.s2.deciderWishes=[];
  if(d.event&&EV_MAP[d.event.id]&&d.event.end>Date.now())G.event={def:EV_MAP[d.event.id],start:d.event.start,end:d.event.end};
  else G.nextEventRoll=Date.now()+20000;
  for(const p of d.players||[]){
   if(p.packs===undefined)p.packs=0;if(p.bloodDrops===undefined)p.bloodDrops=0;
   if(p.lastAlienTry===undefined)p.lastAlienTry=0;if(p.deciderBought===undefined)p.deciderBought=false;
   if(!p.gear.includes('shovel'))p.gear.push('shovel');
   G.players.set(p.id,p);if(p.plot>=0&&p.plot<6)G.plots[p.plot]=p.id;}
  const el=Math.min(Date.now()-(d.savedAt||Date.now()),12*3600*1000);
  for(const pl of d.plants||[]){if(!pl.dead){pl.prog=Math.min((pl.prog||0)+el,SEED_MAP[pl.s]?SEED_MAP[pl.s].grow:1);G.plants.set(pl.id,pl);}}
  console.log('[FARM] loaded:',G.players.size,'players | S1:',G.season.status,'| S2:',G.s2.phase);}
 catch(e){console.error('[FARM] corrupt save, fresh start');G.stock=seedStockInit();G.shopConfig=defaultShopConfig();G.restockAt=Date.now()+RESTOCK_MS;rotateEmoteShop();}}
function newPlayer(id,name){let plot=G.plots.findIndex(o=>o===null);if(plot<0)plot=0;G.plots[plot]=id;
 return{id,name,cash:150,tokens:0,relics:0,plot,expansion:0,seeds:{carrot:5},produce:[],gear:['watercan','shovel'],eggs:{},pets:[],packs:0,
 stats:{plant:0,harvest:0,sell:0,buySeedType:1,mutations:0,eggsBought:0,petsHatched:0,petsEquipped:0,watered:0,weatherSeen:0,mutHarvest:0,expansion:0,earned:0,rareHarvest:0},
 quests:[],daily:{last:'',streak:0},discovered:{seeds:['carrot'],muts:[],pets:[]},
 passXP:0,passLevel:1,freeClaimed:[],goldOwned:false,goldClaimed:[],
 emotes:{},skins:{},activeSkin:null,cosmetics:{},activeCosmetic:null,
 lastAbility:0,relicDay:'',relicDrops:0,
 bloodDrops:0,lastAlienTry:0,deciderBought:false,
 x:0,z:26,ry:0,online:false};}
const now=()=>Date.now(),rand=(a,b)=>a+Math.random()*(b-a),rint=(a,b)=>Math.floor(rand(a,b+1));
function log(action,target,params){G.logs.push({t:now(),action,target:target||'global',params:params||''});
 if(G.logs.length>500)G.logs.splice(0,G.logs.length-500);}
function gearBonus(p,key){let best=0;for(const gid of p.gear){const fx=GEAR_MAP[gid]&&GEAR_MAP[gid].fx;if(fx&&fx[key])best=Math.max(best,fx[key]);}return best;}
function petBonus(p,type){let v=0;for(const pet of p.pets)if(pet.eq){const d=PET_MAP[pet.pid];if(d&&d.bt===type)v+=d.bv*(1+.05*((pet.lvl||1)-1));}return Math.min(v,.5);}
function effGrowth(p){let m=(G.event?G.event.def.grow:1)*G.growMul;
 m*=1+gearBonus(p,'grow')+petBonus(p,'growth');const spr=gearBonus(p,'sprinkler');if(spr)m*=spr;return m;}
function rollMuts(p){const muts=[],boost=(G.event&&G.event.def.boosts)||{},petM=1+petBonus(p,'mut'),beacon=gearBonus(p,'beacon')||1;
 /* Godalien passive: boosts alien mutation */
 const hasGA=(p.pets||[]).some(x=>x.pid==='godalien'&&x.eq);
 for(const m of MUTS){if(muts.length>=G.mutCap)break;
  if((m.id==='miniature'&&muts.includes('giant'))||(m.id==='giant'&&muts.includes('miniature')))continue;
  let ch=(MUT_BASE[m.cat]||.01)*(boost[m.id]||1)*petM*beacon;
  if(m.id==='alien'&&hasGA)ch*=2;   /* Godalien doubles alien odds */
  for(const pet of p.pets)if(pet.eq){const d=PET_MAP[pet.pid];if(d&&d.bt===m.id)ch*=1.8;}
  if(Math.random()<Math.min(ch,.6))muts.push(m.id);}
 return muts;}
function mutMult(muts){let t=1;for(const id of muts)t*=MUT_MAP[id]?MUT_MAP[id].mult:1;return Math.min(t,MUT_TOTAL_CAP);}
function fruitValue(sd,weight,muts,p){const wAvg=(sd.wmin+sd.wmax)/2,wf=.5+.9*(weight/wAvg);
 const sell=1+petBonus(p,'sell')+gearBonus(p,'decor')+(G.event?(G.event.def.sell-1)+gearBonus(p,'charm'):0);
 return Math.max(1,Math.round(sd.sell*wf*mutMult(muts)*sell));}
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
 for(const pl of G.plants.values()){const owner=G.players.get(pl.o);if(!owner)continue;
  let m=effGrowth(owner);if(pl.boostUntil>now())m*=gearBonus(owner,'water')||1.6;
  pl.prog=Math.min(pl.prog+dt*m,SEED_MAP[pl.s]?SEED_MAP[pl.s].grow:1);}}
function plantPacket(pl){return{id:pl.id,o:pl.o,s:pl.s,x:+pl.x.toFixed(2),z:+pl.z.toFixed(2),p:+Math.min(pl.prog/(SEED_MAP[pl.s]?SEED_MAP[pl.s].grow:1),1).toFixed(3)};}
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
function pushMe(p){sendTo(p.id,{t:'me',me:me(p)});G.dirty=true;}
function pushPlants(){broadcast({t:'plants',plants:[...G.plants.values()].map(plantPacket)});}
function addStat(p,k,n=1){p.stats[k]=(p.stats[k]||0)+n;}
function awardReward(p,r){if(r.cash){p.cash+=r.cash;p.stats.earned+=r.cash;}
 if(r.tokens)p.tokens+=r.tokens;if(r.relics)p.relics=(p.relics||0)+r.relics;
 if(r.seeds)for(const k in r.seeds){p.seeds[k]=(p.seeds[k]||0)+r.seeds[k];if(!p.discovered.seeds.includes(k))p.discovered.seeds.push(k);}
 if(r.egg)p.eggs[r.egg]=(p.eggs[r.egg]||0)+1;
 if(r.gear&&!p.gear.includes(r.gear))p.gear.push(r.gear);}
function cap(p){return 60+gearBonus(p,'cap');}
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
   for(let i=0;i<count;i++){let w=rand(sd.wmin,sd.wmax);const muts=rollMuts(p);
    if(muts.includes('giant')||muts.includes('overgrown'))w*=2.2;
    if(muts.includes('miniature'))w*=.5;
    for(const m of muts)if(!p.discovered.muts.includes(m))p.discovered.muts.push(m);
    if(muts.length){addStat(p,'mutations',muts.length);addStat(p,'mutHarvest');}
    const f={uid:'F'+(G.nextId++),s:sd.id,w:+w.toFixed(3),m:muts,v:fruitValue(sd,w,muts,p),t:now()};
    p.produce.push(f);fruits.push(f);}
   tryRelicDrop(p,fruits.length?fruits[0].m:[],sd);
   addStat(p,'harvest');addPassXP(p,15+(fruits.some(f=>f.m.length)?20:0));
   if(['Rare','Epic','Legendary','Mythical','Demon','Divine','Alienoic'].includes(sd.rar))addStat(p,'rareHarvest');
   if(sd.reg>0)pl.prog=sd.grow*(1-sd.reg);else G.plants.delete(pl.id);
   for(const pet of p.pets){pet.xp=(pet.xp||0)+5;pet.lvl=Math.min(10,1+Math.floor(pet.xp/100));}
   pushMe(p);pushPlants();
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
 }}
function sellFruits(p,uids){const set=new Set(uids);const sold=[];
 p.produce=p.produce.filter(f=>{if(set.has(f.uid)){sold.push(f);return false;}return true;});
 if(!sold.length)return sendTo(p.id,{t:'toast',msg:'Nothing to sell.',kind:'err'});
 let total=0;for(const f of sold)total+=f.v;
 p.cash+=total;p.stats.earned+=total;addStat(p,'sell',sold.length);
 addPassXP(p,Math.min(60,sold.length*2));
 pushMe(p);sendTo(p.id,{t:'sold',total,count:sold.length});}

function adminCommand(admin,msg){const c=msg.cmd,a=msg.args||{};
 const target=a.targetId?G.players.get(a.targetId):admin;
 switch(c){
  case 'info':sendTo(admin.id,{t:'admData',kind:'info',data:{uptime:Math.round((now()-G.startedAt)/1000),
   online:[...G.players.values()].filter(x=>x.online).length,players:G.players.size,plants:G.plants.size,
   event:G.event?G.event.def.n:'none',paused:G.paused,season:G.season.status,seasonName:G.season.name,
   s2phase:G.s2.phase,s2act:G.s2.act,s2heartFed:G.s2.heartFed}});break;
  case 'players':sendTo(admin.id,{t:'admData',kind:'players',data:[...G.players.values()].map(x=>({id:x.id,name:x.name,
   cash:x.cash,tokens:x.tokens,plot:x.plot,exp:x.expansion,online:!!x.online,produce:x.produce.length,pets:x.pets.length}))});break;
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
  case 'getDeciderWishes':{
   sendTo(admin.id,{t:'admData',kind:'deciderWishes',data:G.s2.deciderWishes||[]});break;}
  case 'clearDeciderWish':{
   const idx=G.s2.deciderWishes.findIndex(w=>w.player===a.targetId);
   if(idx>=0){G.s2.deciderWishes.splice(idx,1);G.dirty=true;save();
    sendTo(admin.id,{t:'admData',kind:'deciderWishes',data:G.s2.deciderWishes});}
   break;}
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
  case 'chaos':{const map={goldenrain:'goldenhour',supergrowth:'giantgrowth',rainbowburst:'rainboww',
   meteorshower:'meteors',nightfall:'eclipse',cosmicbloom:'cosmicbloom',luckyharvest:'luckyharvest',
   worldtreeawake:'worldtree',petparade:'superbloom',crystalstorm:'crystalrain'};
   startEvent(EV_MAP[map[a.mode]||'converge'],120000,true);break;}
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

const server=http.createServer((req,res)=>{
 const url=(req.url||'/').split('?')[0];
 if(url==='/'||url==='/index.html'){
  fs.readFile(path.join(__dirname,'index.html'),(e,buf)=>{
   if(e){res.writeHead(500);return res.end('index.html missing');}
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(buf);});return;}
 const isModel=path.extname(url).toLowerCase()==='.glb';
 const fp=isModel
  ?path.join(path.dirname(__dirname),path.basename(url))
  :path.join(__dirname,path.normalize(url).replace(/^([/\\]|\.\.)+/g,''));
 if((isModel?path.dirname(fp)===path.dirname(__dirname):fp.startsWith(__dirname))&&fs.existsSync(fp)&&fs.statSync(fp).isFile()){
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
    if(msg.t!=='join')return;
    const clean=cleanName(msg.name);
    if(!clean)return sock.send(JSON.stringify({t:'nameRejected',msg:'Bad name.'}));
    const id='U'+crypto.randomBytes(6).toString('hex');
    let p=[...G.players.values()].find(x=>x.name===clean&&!x.online);
    if(p){p.online=true;if(p.packs===undefined)p.packs=0;if(p.bloodDrops===undefined)p.bloodDrops=0;}
    else{p=newPlayer(id,clean);p.online=true;G.players.set(p.id,p);}
    sock._id=p.id;joined=true;
    sock.send(JSON.stringify({t:'init',self:me(p),serverTime:now(),
     season:seasonPacket(),s2:s2Packet(),maintenance:G.maintenance,
     plants:[...G.plants.values()].map(plantPacket),stock:G.stock,restockAt:G.restockAt,
     prices:priceMap(),cfg:G.shopConfig,
     emoteStock:G.emoteStock,emoteRestockAt:G.emoteRestockAt,
     event:G.event?{id:G.event.def.id,end:G.event.end,start:G.event.start}:null,
     plots:G.plots,plotPos:PLOT_POS,
     players:[...G.players.values()].filter(x=>x.online).map(x=>({id:x.id,name:x.name,x:x.x||0,z:x.z||0,ry:0}))}));
    broadcast({t:'pJoin',id:p.id,name:p.name},p.id);pushPlants();return;}
   try{handleMsg(sock,msg);}catch(e){console.error('[FARM] handler:',e.message);}});
  sock.on('close',()=>{if(!sock._id)return;const p=G.players.get(sock._id);if(p)p.online=false;
   broadcast({t:'pLeft',id:sock._id});save();});});
 setInterval(()=>{tickPlants();tickSeason2();
  if(G.event&&now()>G.event.end)endEvent();
  if(!G.event&&now()>G.nextEventRoll){G.nextEventRoll=now()+60000;if(Math.random()<.65)rollEvent();}
  if(now()>G.restockAt)restock(false);
  if(now()>G.emoteRestockAt)rotateEmoteShop();
  if(G.maintenance.active&&now()>G.maintenance.until){
   G.maintenance={active:false,until:0,msg:'',fix:'',by:''};G.dirty=true;
   broadcast({t:'maintenance',until:0,msg:'',fix:'',by:''});}
  if(G.season.status==='scheduled'&&G.season.launchAt&&now()>=G.season.launchAt)launchSeason();},2000);
 setInterval(()=>{broadcast({t:'seasonState',season:seasonPacket()});
  broadcast({t:'s2State',s2:s2Packet()});},5000);
 setInterval(pushPlants,5000);
 setInterval(save,SAVE_MS);
 setInterval(()=>{broadcast({t:'plots',plots:G.plots});
  broadcast({t:'leaderboard',list:[...G.players.values()].map(x=>({id:x.id,name:x.name,cash:x.cash})).sort((a,b)=>b.cash-a.cash).slice(0,10)});},20000);
 load();
 process.on('SIGINT',()=>{console.log('\n[FARM] saving…');save();process.exit(0);});
 server.listen(PORT,()=>console.log('[FARM] http://localhost:'+PORT));
}else{server.listen(PORT,()=>console.log('[FARM] HTTP only. npm install ws'));}
function fmt(n){return n>=1e9?(n/1e9).toFixed(1)+'B':n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e4?(n/1e3).toFixed(1)+'K':String(Math.round(n));}