// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Promotion drafts, owner approval and Allow All against a disposable PostgreSQL with migrations 001–308.
// Offers are written through the real inherited productOffer() on a real price version; Muse Spark is
// stubbed (no Meta API credit). Application queries run as `bitpos_app` under row-level security.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import pg from 'pg';
import type {MetaDb} from '../apps/api/src/meta/identity';
import type {StaffView} from '../apps/api/src/meta/staff';
import {MetaRouterError} from '../packages/meta-ai/src/types';
import type {MetaRouter} from '../packages/meta-ai/src/router';

const url=process.env.META_TEST_DATABASE_URL;
const skip=!url&&'META_TEST_DATABASE_URL not set';
// offers.ts / catalog.ts read the API config at import: inert local values, like tools/meta/meta-server.ts.
if(url)Object.assign(process.env,{DATABASE_URL:url,ADMIN_DATABASE_URL:url,AUTH_URL:'http://127.0.0.1:9',AUTH_ANON_KEY:'unused',APP_SECRET:randomBytes(32).toString('hex'),PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/nonexistent'});
const B='00000000-0000-4000-8000-000000000002';
const M=randomUUID(),OWNER=randomUUID(),MANAGER=randomUUID(),STAFF=randomUUID();
const me=(userId:string,role:StaffView['role']):StaffView=>({merchantId:M,userId,role,sessionId:'s'});
let admin:pg.Pool,app:pg.Pool,db:MetaDb,mod:typeof import('../apps/api/src/meta/offer-policy'),menu:any;
let latte:string,croissant:string,muffin:string;
let reply:any=null,throwModel=false,modelCalls=0;
const router={invoke:async()=>{
 modelCalls++;if(throwModel)throw new MetaRouterError('ALL_PROVIDERS_FAILED');
 const id=randomUUID();
 await admin.query("INSERT INTO meta_ai_invocations(merchant_id,id,task,provider,model,weights,location,outcome,latency_ms,input_sha256,output_sha256,started_at) VALUES($1,$2,'promotion_copy','meta_api','muse-spark-1.3','closed','cloud','OK',1,$3,$3,clock_timestamp())",[M,id,createHash('sha256').update(id).digest('hex')]);
 return {value:reply,invocation:{id},attempts:[]};
}} as unknown as MetaRouter;
const deps=()=>({db,menu,router});
const offerRow=async(product:string)=>(await admin.query<{revision:string;enabled:boolean;base_minor:string;current_minor:string;percent:number}>(
 'SELECT o.revision::text,o.enabled,o.base_minor::text,o.current_minor::text,o.percent FROM versioned_product_offers o JOIN merchant_pricing m ON m.merchant_id=o.merchant_id AND m.active_price_version_id=o.price_version_id WHERE o.product_id=$1 ORDER BY o.revision DESC LIMIT 1',[product])).rows[0];

before(async()=>{
 if(skip)return;
 admin=new pg.Pool({connectionString:url,max:2,options:'-c search_path=bitpos,public'});
 app=new pg.Pool({connectionString:url,max:4,options:'-c search_path=bitpos,public'});
 app.on('connect',c=>{c.query('SET ROLE bitpos_app');});
 db={query:(sql,params)=>app.query(sql,params as any[]),tenant:async(merchant,fn)=>{const c=await app.connect();try{await c.query('SET ROLE bitpos_app');await c.query('BEGIN');await c.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};
 mod=await import('../apps/api/src/meta/offer-policy');
 const {effectiveCatalog}=await import('../apps/api/src/catalog');
 menu=effectiveCatalog;
 // A fresh shop per run with a real owner-configured USD (4 decimals) price version, like Purple Cafe.
 await admin.query("INSERT INTO merchants(id,name,treasury) SELECT $1,'offer policy test shop',treasury FROM merchants WHERE id=$2",[M,B]);
 const add=async(name:string,en:string,emoji:string,cat:string,minor:number,stock:number)=>(await admin.query<{id:string}>('INSERT INTO products(merchant_id,name,name_en,emoji,price_minor,stock,category) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[M,name,en,emoji,minor,stock,cat])).rows[0].id;
 latte=await add('ลาเต้','Latte','🥛','coffee',8000,40);croissant=await add('ครัวซองต์','Croissant','🥐','bakery',6500,80);muffin=await add('มัฟฟิน','Muffin','🧁','bakery',5000,20);
 const v=(await admin.query<{id:string}>("INSERT INTO catalog_price_versions(merchant_id,currency,decimals,provenance,quote_policy,configured_by) VALUES($1,'USD',4,'owner_configured','USD_FIXED4_TO_USDG_1_TO_1',$2) RETURNING id",[M,OWNER])).rows[0].id;
 for(const [p,minor] of [[latte,80000],[croissant,65000],[muffin,50000]] as const)await admin.query('INSERT INTO catalog_prices(merchant_id,price_version_id,product_id,unit_minor) VALUES($1,$2,$3,$4)',[M,v,p,minor]);
 await admin.query('INSERT INTO merchant_pricing(merchant_id,active_price_version_id,revision) VALUES($1,$2,1)',[M,v]);
});
after(async()=>{if(!skip){await admin.end();await app.end();}});

test('roles: staff cannot draft or approve; managers approve once; only the owner sets Allow All',{skip},async()=>{
 await assert.rejects(mod.draftOffer(deps(),me(STAFF,'staff')),(e:any)=>e.code==='ROLE_REQUIRED');
 await assert.rejects(mod.listOffersOverview(deps(),me(STAFF,'staff')),(e:any)=>e.code==='ROLE_REQUIRED');
 reply={productId:latte,discountPercent:20,durationHours:4,reasonTh:'ลาเต้ขายดีช่วงบ่าย',reasonEn:'Latte sells well in the afternoon'};
 const {draft,autoApplied}=await mod.draftOffer(deps(),me(MANAGER,'manager'));
 assert.deepEqual([draft.productId,draft.discountPercent,draft.durationHours,draft.chosenBy,draft.state,autoApplied],[latte,20,4,'model','DRAFT',false]);
 await assert.rejects(mod.approveDraft(deps(),me(MANAGER,'manager'),draft.id,{scope:'product',dailyLimit:3}),(e:any)=>e.code==='OWNER_REQUIRED');
 const ok=await mod.approveDraft(deps(),me(MANAGER,'manager'),draft.id);
 assert.deepEqual([ok.state,ok.approvalKind],['APPLIED','owner']);
 const o=await offerRow(latte);
 assert.deepEqual([o.enabled,o.base_minor,o.current_minor,o.percent],[true,'80000','64000',20],'written through the inherited offer command');
 assert.equal((await admin.query("SELECT count(*)::int AS n FROM audit_logs WHERE merchant_id=$1 AND actor=$2 AND action='product.offer.enable'",[M,MANAGER])).rows[0].n,1);
 await assert.rejects(mod.approveDraft(deps(),me(OWNER,'owner'),draft.id),(e:any)=>e.code==='NOT_OPEN','a draft is decided once');
});

test('model output is bounded: unsafe reasons replaced; failures fall back at no cost',{skip},async()=>{
 reply={productId:croissant,discountPercent:10,durationHours:2,reasonTh:'ลด 10% วันนี้',reasonEn:'Only ฿58'};
 const a=await mod.draftOffer(deps(),me(OWNER,'owner'));
 assert.doesNotMatch(a.draft.reasonTh+a.draft.reasonEn,/[0-9฿%]/);
 await mod.rejectDraft(deps(),me(OWNER,'owner'),a.draft.id);
 throwModel=true;
 const b=await mod.draftOffer(deps(),me(OWNER,'owner'));
 assert.deepEqual([b.draft.chosenBy,b.draft.discountPercent],['fallback',10]);
 assert.notEqual(b.draft.productId,latte,'products already on offer are not drafted again');
 await mod.rejectDraft(deps(),me(OWNER,'owner'),b.draft.id);
 throwModel=false;
});

test('Allow All: owner approves once with bounds; later drafts inside them apply automatically; outside, over the cap or after revoke they wait',{skip},async()=>{
 const owner=me(OWNER,'owner');
 reply={productId:croissant,discountPercent:20,durationHours:4,reasonTh:'ครัวซองต์เหลือเยอะ',reasonEn:'Plenty of croissants left'};
 const first=await mod.draftOffer(deps(),owner);
 assert.equal(first.autoApplied,false,'the first one always needs the owner');
 await mod.approveDraft(deps(),owner,first.draft.id,{scope:'category',dailyLimit:2});
 let {policies}=await mod.listOffersOverview(deps(),owner);
 assert.deepEqual(policies.map(p=>[p.scopeKind,p.category,p.maxDiscountPercent,p.maxDurationHours,p.dailyLimit]),[['category','bakery',20,4,2]]);
 // Stop it: the inherited offer is switched off through the same command.
 await mod.stopOffer(deps(),owner,first.draft.id);
 assert.equal((await offerRow(croissant)).enabled,false);

 reply={productId:muffin,discountPercent:15,durationHours:2,reasonTh:'มัฟฟินสดใหม่',reasonEn:'Fresh muffins'};
 const inside=await mod.draftOffer(deps(),owner);
 assert.deepEqual([inside.autoApplied,inside.draft.state,inside.draft.approvalKind],[true,'APPLIED','policy'],'same category, lower percent, shorter: automatic');
 assert.equal((await admin.query('SELECT decided_by FROM meta_offer_drafts WHERE id=$1',[inside.draft.id])).rows[0].decided_by,OWNER,'the policy owner is the actor of record');
 assert.equal((await offerRow(muffin)).percent,15);

 reply={productId:croissant,discountPercent:25,durationHours:2,reasonTh:'ลดแรง',reasonEn:'Big discount'};
 const over=await mod.draftOffer(deps(),owner);
 assert.deepEqual([over.autoApplied,over.draft.state],[false,'DRAFT'],'above the approved percent waits for the owner');
 await mod.rejectDraft(deps(),owner,over.draft.id);

 reply={productId:latte,discountPercent:5,durationHours:2,reasonTh:'กาแฟ',reasonEn:'Coffee'};
 await mod.stopOffer(deps(),owner,(await mod.listOffersOverview(deps(),owner)).drafts.find(d=>d.productId===latte&&d.state==='APPLIED')!.id);
 const otherCategory=await mod.draftOffer(deps(),owner);
 assert.equal(otherCategory.autoApplied,false,'another category is outside the policy');
 await mod.rejectDraft(deps(),owner,otherCategory.draft.id);

 await mod.stopOffer(deps(),owner,inside.draft.id);
 reply={productId:croissant,discountPercent:10,durationHours:2,reasonTh:'ครัวซองต์',reasonEn:'Croissant'};
 const second=await mod.draftOffer(deps(),owner);
 assert.equal(second.autoApplied,true,'second automatic one today (cap 2)');
 await mod.stopOffer(deps(),owner,second.draft.id);
 const third=await mod.draftOffer(deps(),owner);
 assert.equal(third.autoApplied,false,'daily cap reached');
 await mod.rejectDraft(deps(),owner,third.draft.id);

 ({policies}=await mod.listOffersOverview(deps(),owner));
 assert.equal(policies[0].usedToday,2);
 await assert.rejects(mod.revokePolicy(deps(),me(MANAGER,'manager'),policies[0].id),(e:any)=>e.code==='OWNER_REQUIRED');
 await mod.revokePolicy(deps(),owner,policies[0].id);
 assert.equal((await mod.listOffersOverview(deps(),owner)).policies.length,0);
});

test('HTTP: owner page lists drafts; staff are refused; cross-origin POSTs refused',{skip},async()=>{
 const {serveMeta}=await import('../apps/api/src/meta/routes');
 const {staffSignIn}=await import('../apps/api/src/meta/staff');
 const users:Record<string,string>={'owner@offers.test':OWNER,'staff@offers.test':STAFF};
 const authFetch=async(_u:string,init:RequestInit)=>{const {email}=JSON.parse(String(init.body));return users[email]?new Response(JSON.stringify({user:{id:users[email]}}),{status:200}):new Response('{}',{status:400});};
 await admin.query("INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,'owner'),($3,$2,'staff')",[OWNER,M,STAFF]);
 try{
  const staffDeps={db,config:{origin:'https://pos.example.test',authUrl:'http://auth.test',anonKey:'x',fetch:authFetch}};
  const routeDeps={identity:{db,masterKey:Buffer.alloc(16),publicOrigin:'https://pay.example.test'},messenger:null,offers:{menu,router},staff:staffDeps};
  const server=http.createServer(async(req,res)=>{if(!(await serveMeta(req,res,routeDeps))){res.writeHead(404);res.end();}});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try{
   const cookieOf=async(email:string)=>`bitpos_meta_staff=${((await staffSignIn(staffDeps,email,'pw')) as any).token}`;
   const owner=await cookieOf('owner@offers.test'),staff=await cookieOf('staff@offers.test');
   const page=await fetch(`${base}/meta/staff/offers`,{headers:{cookie:owner}});
   assert.equal(page.status,200);const html=await page.text();
   assert.match(html,/Allow All/);assert.match(html,/Muse Spark/);
   assert.equal((await fetch(`${base}/meta/staff/offers`,{headers:{cookie:staff}})).status,403);
   const post=(cookie:string,origin:string)=>fetch(`${base}/meta/staff/offers/draft`,{method:'POST',redirect:'manual',headers:{cookie,origin}});
   assert.equal((await post(owner,'https://evil.example')).status,403);
   const calls=modelCalls;
   reply={productId:latte,discountPercent:10,durationHours:2,reasonTh:'ลาเต้',reasonEn:'Latte'};
   const r=await post(owner,'https://pos.example.test');
   assert.equal(r.status,303);assert.match(r.headers.get('location')??'',/\/meta\/staff\/offers\?n=(drafted|auto)/);
   assert.equal(modelCalls,calls+1,'one model call per draft button press');
   const ledger=await fetch(`${base}/meta/staff/ledger`,{headers:{cookie:owner}});
   assert.equal(ledger.status,200);const lh=await ledger.text();
   assert.match(lh,/AI calls/);assert.match(lh,/promotion_copy/);assert.match(lh,/Promotion decisions/);
   assert.equal((await fetch(`${base}/meta/staff/ledger`,{headers:{cookie:staff}})).status,403);
  }finally{server.close();}
 }finally{await admin.query('DELETE FROM members WHERE user_id = ANY($1)',[[OWNER,STAFF]]);}
});
