// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// BitPOS Muse Connector (MCP) and canonical quotes against a disposable PostgreSQL with migrations
// 001–306 applied; Stripe is stubbed. Application queries run as `bitpos_app` under row-level security.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import pg from 'pg';
import type {MetaDb,OfferDeps} from '../apps/api/src/meta/identity';
import type {EffectiveMenu} from '../apps/api/src/offers';
import {handleRpc,TOOLS} from '../apps/api/src/meta/mcp';
import type {AgentDeps} from '../apps/api/src/meta/agent-orders';
import {applyStripeWebhook} from '../apps/api/src/meta/tap-checkout';
import {handOver,staffFromSession,type StaffDeps} from '../apps/api/src/meta/staff';
import {serveMeta,type MetaRouteDeps} from '../apps/api/src/meta/routes';

const url=process.env.META_TEST_DATABASE_URL;
const skip=!url&&'META_TEST_DATABASE_URL not set';
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
let admin:pg.Pool,app:pg.Pool,db:MetaDb,deps:AgentDeps;
let latte:string,cookie:string,otherLatte:string;
let stock=5,unit='40000';
// USD with 4 decimals like the real Purple Cafe catalog: 40000 = $4.00 = 400 Stripe cents.
const usd=(v:string)=>({currency:'USD' as const,decimals:4 as const,amountMinor:v});
const menuFor=(merchant:string,id:()=>string):OfferDeps['menu']=>async()=>({merchant:{id:merchant,name:'demo'},asOf:new Date().toISOString(),priceValidUntil:new Date(Date.now()+3600e3).toISOString(),menuVersion:'v',priceVersion:null,pricingRevision:'1',currency:null,decimals:null,
 products:[{id:id(),catalogKey:null,name:'ลาเต้',nameEn:'Latte',emoji:'🥛',available:stock,imageUrl:null,category:'coffee',description:null,basePrice:usd('50000'),unitPrice:usd(unit),
  promotion:{revision:'1',expiresAt:new Date(Date.now()+3600e3).toISOString(),discount:{kind:'percent',percent:20},priceVersion:merchant}}]} as unknown as EffectiveMenu);
const calls:{url:string;body:URLSearchParams;key:string|null}[]=[];
let mode:'ok'|'decline'|'down'='ok';
const stripeFetch=async(u:string,init:RequestInit)=>{
 const body=new URLSearchParams(String(init.body??''));calls.push({url:u,body,key:(init.headers as Record<string,string>)['Idempotency-Key']??null});
 if(mode==='down')throw new TypeError('network');
 if(u.endsWith('/v1/refunds'))return new Response(JSON.stringify({object:'refund',id:`re_${Date.now()}${calls.length}x`,livemode:false,amount:Number(body.get('amount')),payment_intent:body.get('payment_intent'),status:'succeeded'}),{status:200});
 if(mode==='decline')return new Response(JSON.stringify({error:{type:'card_error',decline_code:'insufficient_funds',payment_intent:{id:`pi_declined${Date.now()}${calls.length}`}}}),{status:402});
 return new Response(JSON.stringify({object:'payment_intent',id:`pi_ok${body.get('metadata[bitpos_checkout]')!.replace(/-/g,'')}`,livemode:false,amount:Number(body.get('amount')),currency:body.get('currency'),status:'succeeded',metadata:{bitpos_checkout:body.get('metadata[bitpos_checkout]')}}),{status:200});
};
const rpc=(name:string,args:Record<string,unknown>={},merchant=A)=>handleRpc(deps,merchant,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}) as Promise<any>;
const out=(r:any)=>r.result.structuredContent;
const stockOf=async(id:string)=>Number((await admin.query('SELECT stock FROM products WHERE id=$1',[id])).rows[0].stock);
const movesOf=async(orderId:string)=>(await admin.query<{delta:number;reason:string}>('SELECT delta,reason FROM meta_stock_movements WHERE order_id=$1 ORDER BY created_at',[orderId])).rows.map(r=>`${r.reason}:${r.delta}`);

before(async()=>{
 if(skip)return;
 admin=new pg.Pool({connectionString:url,max:2,options:'-c search_path=bitpos,public'});
 app=new pg.Pool({connectionString:url,max:4,options:'-c search_path=bitpos,public'});
 app.on('connect',c=>{c.query('SET ROLE bitpos_app');});
 db={query:(sql,params)=>app.query(sql,params as any[]),tenant:async(merchant,fn)=>{const c=await app.connect();try{await c.query('SET ROLE bitpos_app');await c.query('BEGIN');await c.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};
 latte=(await admin.query<{id:string}>(`INSERT INTO products(merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,'ลาเต้','Latte','🥛',50000,5) RETURNING id`,[A])).rows[0].id;
 otherLatte=(await admin.query<{id:string}>(`INSERT INTO products(merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,'ลาเต้','Latte','🥛',50000,5) RETURNING id`,[B])).rows[0].id;
 deps={db,offers:{menu:async(c,m)=>menuFor(m,()=>m===A?latte:otherLatte)(c,m),router:null},stripe:{config:{secretKey:'sk_test_x',webhookSecret:'whsec_mcp'},fetch:stripeFetch}};
});
after(async()=>{if(!skip){await admin.end();await app.end();}});

test('protocol: initialize, tools/list, notifications, unknown methods',{skip},async()=>{
 const init:any=await handleRpc(deps,A,{jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'t',version:'1'}}});
 assert.equal(init.result.protocolVersion,'2025-06-18');assert.ok(init.result.capabilities.tools);
 assert.equal((await handleRpc(deps,A,{jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'1999-01-01'}}) as any).result.protocolVersion,'2025-06-18');
 const list:any=await handleRpc(deps,A,{jsonrpc:'2.0',id:2,method:'tools/list'});
 assert.deepEqual(list.result.tools.map((t:any)=>t.name),TOOLS.map(t=>t.name));
 assert.equal(await handleRpc(deps,A,{jsonrpc:'2.0',method:'notifications/initialized'}),null);
 assert.equal((await handleRpc(deps,A,{jsonrpc:'2.0',id:3,method:'resources/list'}) as any).error.code,-32601);
 assert.equal((await handleRpc(deps,A,[{jsonrpc:'2.0',id:4,method:'ping'}]) as any).error.code,-32600,'no batches');
 assert.equal((await rpc('nope')).result.isError,true);
});

test('quotes: server price in Stripe cents, offer attached, invalid and short inputs refused',{skip},async()=>{
 const menu=out(await rpc('list_menu'));
 const item=menu.items.find((i:any)=>i.productId===latte);
 assert.deepEqual([item.price.amountMinor,item.price.display,item.basePrice.display,item.offer.discountPercent,item.payable],['400','$4.00','$5.00',20,true]);
 const q=out(await rpc('get_quote',{product_id:latte,quantity:2}));
 assert.deepEqual([q.amountMinor,q.total,q.unitAmountMinor,q.quantity],['800','$8.00','400',2]);
 assert.match(q.offerId,/^product:/);
 assert.equal(out(await rpc('get_quote',{product_id:latte,quantity:11})).error,'INVALID_INPUT');
 assert.equal(out(await rpc('get_quote',{product_id:latte,quantity:6})).error,'OUT_OF_STOCK');
 assert.equal(out(await rpc('get_quote',{product_id:'not-a-uuid'})).error,'INVALID_INPUT');
 assert.equal(out(await rpc('get_quote',{product_id:otherLatte})).error,'NOT_FOUND','another shop’s product');
 unit='4000';assert.equal(out(await rpc('get_quote',{product_id:latte})).error,'BELOW_MINIMUM');unit='40000';
 unit='40005';assert.equal(out(await rpc('get_quote',{product_id:latte})).error,'CURRENCY','fractions of a cent are refused');unit='40000';
 // The agent can only pass ids: a price argument is not part of the schema and is ignored.
 const forged=out(await rpc('get_quote',{product_id:latte,amount_minor:1,price:'0.01'}));
 assert.equal(forged.amountMinor,'400');
});

test('checkout: canonical amount, one charge per quote, stock once; decline; unknown outcome confirmed by signed webhook',{skip},async()=>{
 const q=out(await rpc('get_quote',{product_id:latte}));
 const before=await stockOf(latte);calls.length=0;
 const paid=out(await rpc('complete_checkout',{quote_id:q.quoteId,shared_payment_token:'spt_test_1'}));
 assert.equal(paid.status,'CONFIRMED');assert.match(paid.pickupCode,/^[0-9A-F]{4}$/);
 assert.equal(calls.length,1);assert.equal(calls[0].body.get('amount'),'400');assert.equal(calls[0].body.get('currency'),'usd');
 assert.equal(calls[0].key,`bitpos-meta-spt-${paid.orderId}`);assert.equal(calls[0].body.get('metadata[bitpos_quote]'),q.quoteId);
 assert.equal(await stockOf(latte),before-1);
 assert.deepEqual(await movesOf(paid.orderId),['agent_confirmed:-1'],'stock change recorded with its order');
 const again=out(await rpc('complete_checkout',{quote_id:q.quoteId,shared_payment_token:'spt_test_other'}));
 assert.deepEqual([again.orderId,again.status,calls.length],[paid.orderId,'CONFIRMED',1],'retry never charges twice');
 assert.equal(await stockOf(latte),before-1);
 assert.equal(out(await rpc('order_status',{order_id:paid.orderId},B)).error,'NOT_FOUND','another shop cannot read it');

 mode='decline';
 const q2=out(await rpc('get_quote',{product_id:latte}));
 const declined=out(await rpc('complete_checkout',{quote_id:q2.quoteId,shared_payment_token:'spt_test_2'}));
 assert.deepEqual([declined.status,declined.declineCode],['FAILED','insufficient_funds']);
 assert.equal(await stockOf(latte),before-1);

 mode='down';
 const q3=out(await rpc('get_quote',{product_id:latte}));
 const unknown=out(await rpc('complete_checkout',{quote_id:q3.quoteId,shared_payment_token:'spt_test_3'}));
 assert.equal(unknown.error,'PROVIDER_OUTCOME_UNKNOWN');
 const orderId=(await admin.query<{id:string;status:string}>('SELECT id,status FROM meta_agent_orders WHERE quote_id=$1',[q3.quoteId])).rows[0];
 assert.equal(orderId.status,'PENDING');
 mode='ok';
 const event={id:`evt_mcp${Date.now()}`,type:'payment_intent.succeeded',livemode:false,created:1,data:{object:{object:'payment_intent',id:`pi_webhook${Date.now()}`,status:'succeeded',amount_received:400,currency:'usd',
  metadata:{bitpos_merchant:A,bitpos_order:orderId.id,bitpos_quote:q3.quoteId,bitpos_checkout:orderId.id}}}};
 const raw=JSON.stringify(event),ts=Math.floor(Date.now()/1000),sig=`t=${ts},v1=${createHmac('sha256','whsec_mcp').update(`${ts}.${raw}`).digest('hex')}`;
 const identity={db,masterKey:Buffer.alloc(16),publicOrigin:'https://pay.example.test'};
 assert.equal(await applyStripeWebhook(identity,deps.stripe!,raw,sig),'PAID');
 assert.equal(await applyStripeWebhook(identity,deps.stripe!,raw,sig),'DUPLICATE_EVENT');
 assert.equal(out(await rpc('order_status',{order_id:orderId.id})).status,'CONFIRMED');
 assert.equal(await stockOf(latte),before-2);
 assert.deepEqual(await movesOf(orderId.id),['agent_confirmed:-1'],'duplicate webhook records nothing twice');
 // The platform feed lists these as Meta MCP orders, under the shop's own row-level security.
 const feed=await db.tenant(A,c=>c.query<{platform:string;channel:string;order_id:string}>('SELECT platform,channel,order_id FROM bitpos.meta_order_feed()'));
 assert.ok(feed.rows.some(r=>r.order_id===paid.orderId&&r.platform==='meta'&&r.channel==='mcp'));
 assert.ok(!(await db.tenant(B,c=>c.query('SELECT 1 FROM bitpos.meta_order_feed() WHERE order_id=$1',[paid.orderId]))).rowCount,'other shop sees nothing');
 // A forged amount on a validly signed event never confirms another quote's order.
 const q4=out(await rpc('get_quote',{product_id:latte}));
 await admin.query("INSERT INTO meta_agent_orders(merchant_id,quote_id,product_id,quantity,currency,amount_minor) SELECT merchant_id,id,product_id,quantity,currency,amount_minor FROM meta_quotes WHERE id=$1",[q4.quoteId]);
 const o4=(await admin.query<{id:string}>('SELECT id FROM meta_agent_orders WHERE quote_id=$1',[q4.quoteId])).rows[0].id;
 const bad=JSON.stringify({...event,id:`evt_bad${Date.now()}`,data:{object:{...event.data.object,id:`pi_bad${Date.now()}`,amount_received:1,metadata:{bitpos_merchant:A,bitpos_order:o4,bitpos_quote:q4.quoteId,bitpos_checkout:o4}}}});
 assert.equal(await applyStripeWebhook(identity,deps.stripe!,bad,`t=${ts},v1=${createHmac('sha256','whsec_mcp').update(`${ts}.${bad}`).digest('hex')}`),'MISMATCH');

 // Expired quotes cannot be paid.
 const q5=out(await rpc('get_quote',{product_id:latte}));
 await admin.query("UPDATE meta_quotes SET created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '10 minutes' WHERE id=$1",[q5.quoteId]);
 assert.equal(out(await rpc('complete_checkout',{quote_id:q5.quoteId,shared_payment_token:'spt_test_5'})).error,'QUOTE_EXPIRED');
});

test('cancel: full refund and stock back before hand-over; not after; idempotent',{skip},async()=>{
 const q=out(await rpc('get_quote',{product_id:latte}));
 const paid=out(await rpc('complete_checkout',{quote_id:q.quoteId,shared_payment_token:'spt_test_c'}));
 const s=await stockOf(latte);calls.length=0;
 const cancelled=out(await rpc('cancel_order',{order_id:paid.orderId}));
 assert.equal(cancelled.status,'CANCELLED');
 assert.equal(calls[0].body.get('amount'),'400');assert.equal(calls[0].key,`bitpos-meta-refund-${paid.orderId}`);
 assert.equal(await stockOf(latte),s+1);
 assert.equal(out(await rpc('cancel_order',{order_id:paid.orderId})).status,'CANCELLED');
 assert.equal(await stockOf(latte),s+1,'second cancel changes nothing');
 assert.deepEqual(await movesOf(paid.orderId),['agent_confirmed:-1','agent_refunded:1']);
 // Staff hand-over closes the cancellation window.
 const q2=out(await rpc('get_quote',{product_id:latte}));
 const p2=out(await rpc('complete_checkout',{quote_id:q2.quoteId,shared_payment_token:'spt_test_d'}));
 const staffUser='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
 const sd:StaffDeps={db,config:{origin:'https://pos.example.test',authUrl:'http://auth.test',anonKey:'x'}};
 assert.equal(await handOver(sd,{merchantId:A,userId:staffUser,role:'staff',sessionId:'s'},p2.orderId),'HANDED_OVER');
 assert.equal(out(await rpc('cancel_order',{order_id:p2.orderId})).error,'NOT_CANCELLABLE');
 assert.equal(typeof staffFromSession,'function');
});

test('HTTP: POST only, no browser origins, unknown merchant 404',{skip},async()=>{
 const routeDeps:MetaRouteDeps={identity:{db,masterKey:Buffer.alloc(16),publicOrigin:'https://pay.example.test'},messenger:null,offers:deps.offers,stripe:deps.stripe};
 const server=http.createServer(async(req,res)=>{if(!(await serveMeta(req,res,routeDeps))){res.writeHead(404);res.end();}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const post=(path:string,body:unknown,headers:Record<string,string>={})=>fetch(base+path,{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json',...headers}});
 try{
  const r=await post(`/meta/mcp/${A}`,{jsonrpc:'2.0',id:1,method:'tools/list'});
  assert.equal(r.status,200);assert.equal((await r.json() as any).result.tools.length,TOOLS.length);
  assert.equal((await post(`/meta/mcp/${A}`,{jsonrpc:'2.0',method:'notifications/initialized'})).status,202);
  assert.equal((await post(`/meta/mcp/${A}`,{jsonrpc:'2.0',id:1,method:'tools/list'},{origin:'https://evil.example'})).status,403);
  assert.equal((await fetch(`${base}/meta/mcp/${A}`)).status,405);
  assert.equal((await post('/meta/mcp/99999999-9999-4999-8999-999999999999',{jsonrpc:'2.0',id:1,method:'tools/list'})).status,404);
  assert.equal((await post(`/meta/mcp/${A}`,{jsonrpc:'2.0',id:1,method:'tools/list'},{'mcp-protocol-version':'1999-01-01'})).status,400);
 }finally{server.close();}
});
