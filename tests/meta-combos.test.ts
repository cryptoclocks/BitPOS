// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Two-item offers (migration 322) and offer animations: the GIF encoder round-trips, the cart prices a live pair
// once per pair, owners/managers decide, and the animation cache answers the second time without re-rendering.
// Needs META_TEST_DATABASE_URL (migrations 001–322); the GIF render test also needs @resvg/resvg-js (META_RESVG_MODULE).
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import type {MetaDb,OfferDeps} from '../apps/api/src/meta/identity';
import type {EffectiveMenu} from '../apps/api/src/offers';
import type {AgentDeps} from '../apps/api/src/meta/agent-orders';
import {encodeGif} from '../apps/api/src/meta/gif';
import {quoteCart} from '../apps/api/src/meta/cart';
import {ComboError,comboAnimation,decideCombo,draftCombo,listCombos} from '../apps/api/src/meta/combos';
import {deviceView} from '../apps/api/src/meta/device';

const url=process.env.META_TEST_DATABASE_URL;
const skip=!url&&'META_TEST_DATABASE_URL not set';
const M=randomUUID(),OTHER='00000000-0000-4000-8000-000000000002',OWNER=randomUUID();
let admin:pg.Pool,app:pg.Pool,db:MetaDb,deps:AgentDeps,latte:string,cake:string;
const usd=(v:string)=>({currency:'USD' as const,decimals:2 as const,amountMinor:v});
const menu:OfferDeps['menu']=async()=>({merchant:{id:M,name:'Muse test'},asOf:new Date().toISOString(),priceValidUntil:new Date(Date.now()+3600e3).toISOString(),menuVersion:'v',priceVersion:null,pricingRevision:'1',currency:null,decimals:null,
 products:[{id:latte,catalogKey:null,name:'ลาเต้',nameEn:'Latte',emoji:'🥛',available:10,imageUrl:'/images/menu/latte.jpg',category:'Coffee',description:null,basePrice:usd('500'),unitPrice:usd('500'),promotion:null},
  {id:cake,catalogKey:null,name:'ชีสเค้ก',nameEn:'Cheesecake',emoji:'🍰',available:10,imageUrl:'/images/menu/cheesecake.jpg',category:'Desserts',description:null,basePrice:usd('650'),unitPrice:usd('650'),promotion:null}]} as unknown as EffectiveMenu);

/** A minimal GIF decoder (global palette, full frames) to check the encoder's LZW output. */
function decodeGif(buf:Buffer):{w:number;h:number;frames:Uint8Array[]}{
 const w=buf.readUInt16LE(6),h=buf.readUInt16LE(8);let p=13+3*(2<<(buf[10]&7));const frames:Uint8Array[]=[];
 while(p<buf.length){
  const b=buf[p];
  if(b===0x3B)break;
  if(b===0x21){p+=2;while(buf[p])p+=buf[p]+1;p++;continue;}
  assert.equal(b,0x2C);p+=10;const min=buf[p++];const data:number[]=[];while(buf[p]){data.push(...buf.subarray(p+1,p+1+buf[p]));p+=buf[p]+1;}p++;
  const clear=1<<min,eoi=clear+1,out:number[]=[];let size=min+1,dict:number[][]=[],prev:number[]|null=null,bit=0;
  const reset=()=>{dict=Array.from({length:clear},(_,i)=>[i]);dict.push([],[]);size=min+1;prev=null;};reset();
  for(;;){
   let code=0;for(let i=0;i<size;i++,bit++)code|=((data[bit>>3]>>(bit&7))&1)<<i;
   if(code===clear){reset();continue;}if(code===eoi)break;
   const entry:number[]=code<dict.length?dict[code]:[...prev!,prev![0]];
   out.push(...entry);if(prev)dict.push([...prev,entry[0]]);prev=entry;
   if(dict.length===(1<<size)&&size<12)size++;
  }
  frames.push(Uint8Array.from(out));
 }
 return {w,h,frames};
}

before(async()=>{
 if(skip)return;
 admin=new pg.Pool({connectionString:url,max:2,options:'-c search_path=bitpos,public'});
 app=new pg.Pool({connectionString:url,max:4,options:'-c search_path=bitpos,public'});
 db={query:(sql,params)=>app.query(sql,params as any[]),tenant:async(merchant,fn)=>{const c=await app.connect();try{await c.query('SET ROLE bitpos_app');await c.query('BEGIN');await c.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};
 await admin.query("INSERT INTO merchants(id,name,treasury) SELECT $1,'Muse test',treasury FROM merchants WHERE id=$2",[M,OTHER]);
 latte=(await admin.query<{id:string}>(`INSERT INTO products(merchant_id,name,name_en,emoji,price_minor,stock,image_url) VALUES($1,'ลาเต้','Latte','🥛',500,10,'/images/menu/latte.jpg') RETURNING id`,[M])).rows[0].id;
 cake=(await admin.query<{id:string}>(`INSERT INTO products(merchant_id,name,name_en,emoji,price_minor,stock,image_url) VALUES($1,'ชีสเค้ก','Cheesecake','🍰',650,10,'/images/menu/cheesecake.jpg') RETURNING id`,[M])).rows[0].id;
 deps={db,offers:{menu,router:null},stripe:null};
});
after(async()=>{if(!skip){await admin.end();await app.end();}});

test('GIF encoder: header, loop, and LZW that decodes back to the same palette indices (past the 4096-code reset)',()=>{
 const w=96,h=80,levels=(n:number,k:number)=>Math.round(k*255/(n-1));
 const frame=(seed:number)=>{const f=new Uint8Array(w*h*4),idx:number[]=[];let s=seed;
  for(let i=0;i<w*h;i++){s=(s*1103515245+12345)>>>0;const r=(s>>8)&7,g=(s>>12)&7,b=(s>>16)&3;idx.push(r*32+g*4+b);f.set([levels(8,r),levels(8,g),levels(4,b),255],i*4);}
  return {f,idx};};
 const a=frame(1),b=frame(2),gif=encodeGif(w,h,[a.f,b.f],12);
 assert.equal(gif.subarray(0,6).toString('ascii'),'GIF89a');assert.ok(gif.includes(Buffer.from('NETSCAPE2.0')));assert.equal(gif[gif.length-1],0x3B);
 const d=decodeGif(gif);
 assert.deepEqual([d.w,d.h,d.frames.length],[w,h,2]);
 assert.deepEqual([...d.frames[0]],a.idx);assert.deepEqual([...d.frames[1]],b.idx);
});

test('two-item offer: drafted, approved by the owner, priced once per pair by the server, stopped',{skip},async()=>{
 const id=await draftCombo(deps,null,M,OWNER);
 let [c]=await listCombos(db,M);
 assert.deepEqual([c.id,c.state,c.chosenBy,c.live,c.a.id,c.b.id,c.discountPercent],[id,'DRAFT','fallback',false,latte,cake,10]);
 let q=await quoteCart(deps,M,[{productId:latte,quantity:2},{productId:cake,quantity:1}]);
 assert.deepEqual([q.total,q.comboDiscount],['$16.50',null]);
 await decideCombo(db,M,OWNER,id,'approve');
 [c]=await listCombos(db,M,true);assert.equal(c.live,true);assert.ok(c.expiresAt);
 // One pair (latte + cheesecake) gets 10% off both: (5.00 + 6.50) × 10% = 1.15; the second latte is full price.
 q=await quoteCart(deps,M,[{productId:latte,quantity:2},{productId:cake,quantity:1}]);
 assert.deepEqual([q.total,q.comboDiscount,q.discount],['$15.35','$1.15','$1.15']);
 q=await quoteCart(deps,M,[{productId:latte,quantity:1}]);assert.equal(q.comboDiscount,null);
 await assert.rejects(decideCombo(db,M,OWNER,id,'approve'),(e:unknown)=>e instanceof ComboError&&e.code==='NOT_OPEN');
 await decideCombo(db,M,OWNER,id,'stop');
 q=await quoteCart(deps,M,[{productId:latte,quantity:1},{productId:cake,quantity:1}]);assert.equal(q.comboDiscount,null);
 assert.deepEqual(await listCombos(db,M,true),[]);
 // Another shop cannot see it (RLS).
 assert.deepEqual(await listCombos(db,OTHER),[]);
});

test('animation: a live pair renders a looping 240 px GIF once and is then served from the cache; the device gets its path',{skip:skip||(!process.env.META_RESVG_MODULE&&'META_RESVG_MODULE not set')},async()=>{
 const id=await draftCombo(deps,null,M,OWNER);
 assert.equal(await comboAnimation(deps,M,id,240),null);// not live yet
 await decideCombo(db,M,OWNER,id,'approve');
 const t0=Date.now(),a=await comboAnimation(deps,M,id,240);const first=Date.now()-t0,gif=a?.gif;
 assert.ok(gif&&gif.subarray(0,6).toString('ascii')==='GIF89a'&&gif.readUInt16LE(6)===240&&gif.length<600_000,'GIF under the device limit');
 const t1=Date.now(),again=await comboAnimation(deps,M,id,240);
 assert.ok(again?.gif.equals(gif!));assert.match(a!.tag,/^[0-9a-f]{8}$/);assert.equal(again?.tag,a!.tag);assert.ok(Date.now()-t1<first,'second answer comes from the cache');
 assert.equal(Number((await admin.query('SELECT count(*) FROM meta_offer_animations WHERE merchant_id=$1',[M])).rows[0].count),1);
 const dev=(await admin.query<{id:string}>("INSERT INTO devices(merchant_id,label) VALUES($1,'Mini anim test') RETURNING id",[M])).rows[0].id;
 const v=await deviceView(db,dev,'https://pay.example.test',async()=>`/meta/anim/combo/${id}/240-${a!.tag}.gif`);
 assert.deepEqual([v?.screen,v?.anim],['idle',`/meta/anim/combo/${id}/240-${a!.tag}.gif`]);
 const bad=await deviceView(db,dev,'https://pay.example.test',async()=>'https://evil.example/x.gif');assert.equal(bad?.anim,'');
 await decideCombo(db,M,OWNER,id,'stop');
});
