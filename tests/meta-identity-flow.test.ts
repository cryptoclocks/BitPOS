// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// End-to-end tap → Messenger consent → web session against a disposable PostgreSQL with migrations
// 001–302 applied. Runs only when META_TEST_DATABASE_URL points at such a database (superuser);
// application queries run as `bitpos_app` so row-level security is exercised.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv,createHmac,randomBytes} from 'node:crypto';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import pg from 'pg';
import {aesCmac,deriveTagKeys} from '../packages/meta-ai/src/ntag424';
import {consumeMagicLink,customerFromSession,handleMessengerEvents,handleTap,offerForTap,type IdentityDeps,type MetaDb,type OfferDeps} from '../apps/api/src/meta/identity';
import {invocationSink} from '../apps/api/src/meta/evidence';
import {createMetaRouter} from '../packages/meta-ai/src/router';
import type {EffectiveMenu} from '../apps/api/src/offers';
import {parseMessengerWebhook,type Outgoing} from '../apps/api/src/meta/messenger';
import {serveMeta,type MetaRouteDeps} from '../apps/api/src/meta/routes';

const url=process.env.META_TEST_DATABASE_URL;
const skip=!url&&'META_TEST_DATABASE_URL not set';
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
const DEV_A='aaaaaaaa-0000-4000-8000-00000000000a',DEV_B='bbbbbbbb-0000-4000-8000-00000000000b';
const PAGE_A='100000000001',PAGE_B='200000000002',PSID='555000111222';
const master=Buffer.from('0f1e2d3c4b5a69788796a5b4c3d2e1f0','hex');
const run=Date.now().toString(36);
const TAG_A=`flow-a-${run}`,TAG_B=`flow-b-${run}`;
const UID_A=('04'+randomBytes(6).toString('hex')).toUpperCase(),UID_B=('04'+randomBytes(6).toString('hex')).toUpperCase();

let admin:pg.Pool,app:pg.Pool,deps:IdentityDeps;

function sunParams(tagId:string,uid:string,counter:number){
 const keys=deriveTagKeys(master,tagId),u=Buffer.from(uid,'hex'),ctr=Buffer.from([counter&0xff,(counter>>8)&0xff,(counter>>16)&0xff]);
 const c=createCipheriv('aes-128-cbc',keys.metaReadKey,Buffer.alloc(16));c.setAutoPadding(false);
 const e=Buffer.concat([c.update(Buffer.concat([Buffer.from([0xc7]),u,ctr,Buffer.alloc(5,0x11)])),c.final()]).toString('hex').toUpperCase();
 const full=aesCmac(aesCmac(keys.fileReadKey,Buffer.concat([Buffer.from('3cc300010080','hex'),u,ctr])),Buffer.alloc(0));
 return {e,m:Buffer.from([1,3,5,7,9,11,13,15].map(i=>full[i])).toString('hex').toUpperCase()};
}
// Timestamps are offset per run: the event ledger persists across runs and would treat reused deliveries as duplicates.
const T0=Date.now();
const webhook=(m:Record<string,unknown>,ts:number,page=PAGE_A)=>parseMessengerWebhook({object:'page',entry:[{id:page,messaging:[{sender:{id:PSID},recipient:{id:page},timestamp:T0+ts,...m}]}]});
const outboxOf=async(e:ReturnType<typeof parseMessengerWebhook>)=>(await handleMessengerEvents(deps,e)).outbox;
const refOf=(u:string)=>new URL(u).searchParams.get('ref')!;
const magicOf=(o:Outgoing)=>{assert.equal(o.kind,'buttons');const b=(o as any).buttons.find((x:any)=>x.type==='web_url');return new URL(b.url).searchParams.get('t')!;};

before(async()=>{
 if(skip)return;
 admin=new pg.Pool({connectionString:url,max:2,options:'-c search_path=bitpos,public'});
 app=new pg.Pool({connectionString:url,max:4,options:'-c search_path=bitpos,public'});
 app.on('connect',c=>{c.query('SET ROLE bitpos_app');});
 const db:MetaDb={query:(sql,params)=>app.query(sql,params as any[]),tenant:async(merchant,fn)=>{const c=await app.connect();try{await c.query('SET ROLE bitpos_app');await c.query('BEGIN');await c.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};
 deps={db,masterKey:master,publicOrigin:'https://shop.example.test'};
 await admin.query(`INSERT INTO devices(merchant_id,id,label) VALUES($1,$2,'flow mini a'),($3,$4,'flow mini b') ON CONFLICT DO NOTHING`,[A,DEV_A,B,DEV_B]);
 await admin.query('INSERT INTO meta_ntag_tags(tag_id,merchant_id,device_id,uid) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',[TAG_A,A,DEV_A,UID_A,TAG_B,B,DEV_B,UID_B]);
 await admin.query(`INSERT INTO meta_messenger_pages(page_id,merchant_id,page_username) VALUES($1,$2,'bitposdemoa'),($3,$4,'bitposdemob') ON CONFLICT DO NOTHING`,[PAGE_A,A,PAGE_B,B]);
 await admin.query('UPDATE meta_customer_links SET revoked_at=clock_timestamp() WHERE psid=$1 AND revoked_at IS NULL',[PSID]);
});
after(async()=>{if(!skip){await admin.end();await app.end();}});

test('new customer: tap → Messenger consent → web session; replays and duplicates do nothing',{skip},async()=>{
 const first=sunParams(TAG_A,UID_A,1);
 const t1=await handleTap(deps,TAG_A,first.e,first.m,null);
 assert.equal(t1.kind,'messenger');
 assert.match((t1 as any).url,/^https:\/\/m\.me\/bitposdemoa\?ref=[A-Za-z0-9_-]{32}$/);
 assert.equal((await handleTap(deps,TAG_A,first.e,first.m,null)).kind,'replayed');
 assert.equal((await handleTap(deps,TAG_A,first.e,'00'.repeat(8),null)).kind,'invalid');

 const ref=refOf((t1 as any).url);
 const consent=await outboxOf(webhook({referral:{ref,source:'SHORTLINK',type:'OPEN_THREAD'}},1));
 assert.equal(consent.length,1);assert.equal(consent[0].kind,'buttons');
 const accept=(consent[0] as any).buttons[0].payload as string;
 assert.match(accept,/^BITPOS_CONSENT_ACCEPT:/);
 assert.deepEqual(await outboxOf(webhook({referral:{ref,source:'SHORTLINK',type:'OPEN_THREAD'}},1)),[],'same delivery twice');
 const reused=await outboxOf(webhook({referral:{ref}},2));
 assert.equal((reused[0] as any).text.includes('หมดอายุ'),true,'a ref is single-use');

 const welcome=await outboxOf(webhook({postback:{payload:accept}},3));
 const magic=magicOf(welcome[0]);
 assert.equal((await outboxOf(webhook({postback:{payload:accept}},4)))[0].kind,'text','consent cannot be decided twice');

 const s=await consumeMagicLink(deps,magic);
 assert.ok(s);assert.equal(s!.merchantId,A);assert.equal(s!.tapSessionId,(t1 as any).tapSessionId);
 assert.equal(await consumeMagicLink(deps,magic),null,'magic link is single-use');
 const me=await customerFromSession(deps,s!.sessionToken);
 assert.equal(me?.lastTap?.deviceId,DEV_A);

 // Returning customer with the cookie: known on the next tap without Messenger.
 const second=sunParams(TAG_A,UID_A,2);
 assert.deepEqual(await handleTap(deps,TAG_A,second.e,second.m,s!.sessionToken).then(r=>r.kind),'known');
 // The same cookie is worthless at another shop.
 const other=sunParams(TAG_B,UID_B,1);
 assert.equal((await handleTap(deps,TAG_B,other.e,other.m,s!.sessionToken)).kind,'messenger');

 // Returning customer without the cookie: Messenger recognises the PSID, no second consent.
 const third=sunParams(TAG_A,UID_A,3);
 const t3=await handleTap(deps,TAG_A,third.e,third.m,null);
 const back=await outboxOf(webhook({referral:{ref:refOf((t3 as any).url)}},5));
 assert.equal(back[0].kind,'buttons');assert.match((back[0] as any).text,/Welcome back/);

 // STOP revokes the link and every web session.
 const stop=await outboxOf(webhook({message:{mid:`stop-${run}`,text:'STOP'}},6));
 assert.match((stop[0] as any).text,/disconnected/);
 assert.equal(await customerFromSession(deps,s!.sessionToken),null);
 const fourth=sunParams(TAG_A,UID_A,4);
 assert.equal((await handleTap(deps,TAG_A,fourth.e,fourth.m,s!.sessionToken)).kind,'messenger');
});

test('declining consent stores no link',{skip},async()=>{
 const tap=sunParams(TAG_A,UID_A,10);
 const t=await handleTap(deps,TAG_A,tap.e,tap.m,null);
 const consent=await outboxOf(webhook({referral:{ref:refOf((t as any).url)}},20));
 const decline=(consent[0] as any).buttons[1].payload as string;
 assert.match(decline,/^BITPOS_CONSENT_DECLINE:/);
 const reply=await outboxOf(webhook({postback:{payload:decline}},21));
 assert.match((reply[0] as any).text,/will not remember/);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM meta_customer_links WHERE psid=$1 AND revoked_at IS NULL',[PSID])).rows[0].n,0);
});

test('HTTP: tap redirects to m.me, webhook rejects bad signatures and sends replies after commit',{skip},async()=>{
 const sent:unknown[]=[];
 const routeDeps:MetaRouteDeps={identity:deps,offers:null,messenger:{appSecret:'app-secret',verifyToken:'verify-me',pageToken:'page-token',graphVersion:'v24.0'},fetch:async(_u,init)=>{sent.push(JSON.parse(String(init.body)));return new Response('{}',{status:200});}};
 const server=http.createServer(async(req,res)=>{if(!(await serveMeta(req,res,routeDeps))){res.writeHead(404);res.end();}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 try{
  const tap=sunParams(TAG_A,UID_A,30);
  const r=await fetch(`${base}/meta/t/${TAG_A}?e=${tap.e}&m=${tap.m}`,{redirect:'manual'});
  assert.equal(r.status,303);assert.match(r.headers.get('location')??'',/^https:\/\/m\.me\/bitposdemoa\?ref=/);
  assert.equal((await fetch(`${base}/meta/t/${TAG_A}?e=${tap.e}&m=${tap.m}`)).status,409);
  assert.equal(await (await fetch(`${base}/meta/messenger/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=xyz`)).text(),'xyz');
  const body=JSON.stringify({object:'page',entry:[{id:PAGE_A,messaging:[{sender:{id:PSID},recipient:{id:PAGE_A},timestamp:T0+40,referral:{ref:refOf(r.headers.get('location')!)}}]}]});
  const bad=await fetch(`${base}/meta/messenger/webhook`,{method:'POST',body,headers:{'x-hub-signature-256':'sha256='+'0'.repeat(64)}});
  assert.equal(bad.status,401);assert.equal(sent.length,0);
  const sig='sha256='+createHmac('sha256','app-secret').update(body).digest('hex');
  const ok=await fetch(`${base}/meta/messenger/webhook`,{method:'POST',body,headers:{'x-hub-signature-256':sig}});
  assert.equal(ok.status,200);assert.equal(sent.length,1);
  assert.equal((sent[0] as any).recipient.id,PSID);
  const revoke=await fetch(`${base}/meta/me/revoke`,{method:'POST',headers:{origin:'https://evil.example'}});
  assert.equal(revoke.status,403);
 }finally{server.close();}
});

test('offer on tap: Muse Spark picks from approved offers once per tap; the call is in the ledger',{skip},async()=>{
 const products=(await admin.query<{id:string}>(`INSERT INTO products(merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,'ครัวซองต์','Croissant','🥐',6500,5),($1,'ลาเต้','Latte','☕',8000,20) RETURNING id`,[A])).rows;
 const thb=(v:string)=>({currency:'THB' as const,decimals:2 as const,amountMinor:v});
 const menu:OfferDeps['menu']=async()=>({merchant:{id:A,name:'demo'},asOf:new Date().toISOString(),priceValidUntil:new Date(Date.now()+3600e3).toISOString(),menuVersion:'v',priceVersion:null,pricingRevision:'1',currency:null,decimals:null,
  products:[
   {id:products[0].id,catalogKey:null,name:'ครัวซองต์',nameEn:'Croissant',emoji:'🥐',available:5,imageUrl:null,category:'bakery',description:null,basePrice:thb('6500'),unitPrice:thb('5200'),promotion:{revision:'3',expiresAt:new Date(Date.now()+3600e3).toISOString(),discount:{kind:'percent',percent:20},priceVersion:A}},
   {id:products[1].id,catalogKey:null,name:'ลาเต้',nameEn:'Latte',emoji:'☕',available:20,imageUrl:null,category:'drink',description:null,basePrice:thb('8000'),unitPrice:thb('7200'),promotion:{revision:'4',expiresAt:new Date(Date.now()+3600e3).toISOString(),discount:{kind:'percent',percent:10},priceVersion:A}},
  ]} as EffectiveMenu);
 let calls=0;
 const router=createMetaRouter({providers:[{id:'meta_api',baseUrl:'https://api.example.test/v1',apiKey:'k',model:'muse-spark-1.3',weights:'closed',location:'cloud',timeoutMs:5000,supportsJsonSchema:true,supportsImages:false}],record:invocationSink(deps.db),
  fetch:async(_u,init)=>{calls++;const ids=JSON.parse(JSON.parse(String(init!.body)).messages[1].content).offers.map((o:any)=>o.offerId);
   return new Response(JSON.stringify({model:'muse-spark-1.3',choices:[{finish_reason:'stop',message:{content:JSON.stringify({offerId:ids.find((i:string)=>i.includes(products[1].id)),reasonTh:'ลาเต้หอมๆ เข้ากับเช้านี้',reasonEn:'A smooth latte for your morning'})}}],usage:{prompt_tokens:10,completion_tokens:5}}),{status:200});}});
 const offers:OfferDeps={menu,router};

 const tap=sunParams(TAG_A,UID_A,50);
 const t=await handleTap(deps,TAG_A,tap.e,tap.m,null);
 const consent=await outboxOf(webhook({referral:{ref:refOf((t as any).url)}},50));
 const accepted=await handleMessengerEvents(deps,webhook({postback:{payload:(consent[0] as any).buttons[0].payload}},51));
 assert.equal(accepted.offers.length,1,'a newly bound tap asks for one offer');
 const req=accepted.offers[0];
 assert.equal(req.tapSessionId,(t as any).tapSessionId);

 const first=await offerForTap(deps,offers,req.merchantId,req.linkId,req.tapSessionId);
 assert.equal(first?.chosenBy,'model');assert.equal(first?.nameEn,'Latte');
 assert.equal(first?.price,'฿72');assert.equal(first?.basePrice,'฿80');assert.equal(first?.discountPercent,10);
 const again=await offerForTap(deps,offers,req.merchantId,req.linkId,req.tapSessionId);
 assert.deepEqual(again,first,'one offer per tap, also on webhook retry or page refresh');
 assert.equal(calls,1,'the model is not asked twice for the same tap');
 const rows=(await admin.query('SELECT i.chosen_by,a.task,a.outcome,a.provider FROM meta_offer_impressions i JOIN meta_ai_invocations a ON a.merchant_id=i.merchant_id AND a.id=i.invocation_id WHERE i.tap_session_id=$1',[req.tapSessionId])).rows;
 assert.deepEqual(rows,[{chosen_by:'model',task:'offer_selection',outcome:'OK',provider:'meta_api'}]);
 // Another customer's link cannot read or create an offer for this tap.
 assert.equal(await offerForTap(deps,offers,req.merchantId,'00000000-0000-4000-8000-0000000000ff',req.tapSessionId),null);
 // Without a model the shop still gets a deterministic pick (not the one just shown).
 const tap2=sunParams(TAG_A,UID_A,51);
 const t2=await handleTap(deps,TAG_A,tap2.e,tap2.m,null);
 const back=await handleMessengerEvents(deps,webhook({referral:{ref:refOf((t2 as any).url)}},52));
 const fallback=await offerForTap(deps,{menu,router:null},back.offers[0].merchantId,back.offers[0].linkId,back.offers[0].tapSessionId);
 assert.equal(fallback?.chosenBy,'fallback');assert.equal(fallback?.nameEn,'Croissant');
 await outboxOf(webhook({message:{mid:`stop-offer-${run}`,text:'STOP'}},53));
});
