// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// AI auto-pay allowance (migration 328): setup through Stripe Checkout (setup mode), chat checkouts paid off-session
// inside the period and caps, decline fallback to the Pay button, the Muse Connector key, stop and expiry, the
// allowance lock under parallel orders, Messenger payloads and RLS. Stripe is stubbed; queries run as bitpos_app.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import pg from 'pg';
import type {MetaDb,OfferDeps} from '../apps/api/src/meta/identity';
import type {EffectiveMenu} from '../apps/api/src/offers';
import {createQuote,type AgentDeps} from '../apps/api/src/meta/agent-orders';
import {activateAutopay,autopayStatus,revokeAutopay,startAutopay,AutopayError} from '../apps/api/src/meta/autopay';
import {startCartAuto} from '../apps/api/src/meta/cart';
import {callTool} from '../apps/api/src/meta/mcp';
import {applyStripeWebhook} from '../apps/api/src/meta/tap-checkout';
import {parseMessengerWebhook} from '../apps/api/src/meta/messenger';

const url=process.env.META_TEST_DATABASE_URL;
const skip=!url&&'META_TEST_DATABASE_URL not set';
const M=randomUUID(),OTHER='00000000-0000-4000-8000-000000000002',PAGE=`9${Date.now()}`.slice(0,15),PSID=`8${Date.now()}`.slice(0,15);
let admin:pg.Pool,app:pg.Pool,db:MetaDb,deps:AgentDeps,latte:string,cake:string,link:string;
const usd=(v:string)=>({currency:'USD' as const,decimals:2 as const,amountMinor:v});
const stock=async(id:string)=>Number((await admin.query('SELECT stock FROM products WHERE id=$1',[id])).rows[0].stock);
const menu:OfferDeps['menu']=async()=>({merchant:{id:M,name:'Autopay test'},asOf:new Date().toISOString(),priceValidUntil:new Date(Date.now()+3600e3).toISOString(),menuVersion:'v',priceVersion:null,pricingRevision:'1',currency:null,decimals:null,
 products:[{id:latte,catalogKey:null,name:'ลาเต้',nameEn:'Latte',emoji:'🥛',available:await stock(latte),imageUrl:null,category:'Coffee',description:null,basePrice:usd('400'),unitPrice:usd('400'),promotion:null},
  {id:cake,catalogKey:null,name:'ชีสเค้ก',nameEn:'Cheesecake',emoji:'🍰',available:await stock(cake),imageUrl:null,category:'Desserts',description:null,basePrice:usd('650'),unitPrice:usd('650'),promotion:null}]} as unknown as EffectiveMenu);

// Stripe stub: customers, setup-mode Checkout, its lookup, off-session PaymentIntents (decline on demand), payment Checkout.
let setupDone=false,decline=false,intents=0;const RUN=Date.now();
const calls:{url:string;body:URLSearchParams}[]=[];
const ok=(b:unknown)=>new Response(JSON.stringify(b),{status:200});
const setupSession=new Map<string,{grant:string;customer:string}>();
const stripeFetch=async(u:string,init:RequestInit)=>{
 const body=new URLSearchParams(String(init.body??''));calls.push({url:u,body});
 if(u.endsWith('/v1/customers'))return ok({object:'customer',id:`cus_${body.get('metadata[bitpos_autopay]')!.replace(/-/g,'')}`,livemode:false});
 if(u.endsWith('/v1/checkout/sessions')&&body.get('mode')==='setup'){
  const id=`cs_test_setup${body.get('client_reference_id')!.replace(/-/g,'')}`;setupSession.set(id,{grant:body.get('metadata[bitpos_autopay]')!,customer:body.get('customer')!});
  return ok({object:'checkout.session',id,mode:'setup',livemode:false,url:`https://checkout.stripe.com/c/setup/${id}`,status:'open',customer:body.get('customer'),setup_intent:'seti_1',metadata:{bitpos_autopay:body.get('metadata[bitpos_autopay]'),bitpos_merchant:body.get('metadata[bitpos_merchant]')}});
 }
 const look=u.match(/\/v1\/checkout\/sessions\/(cs_test_setup[A-Za-z0-9]+)\?/);
 if(look){const s=setupSession.get(look[1])!;
  return ok({object:'checkout.session',id:look[1],mode:'setup',livemode:false,url:null,status:setupDone?'complete':'open',customer:s.customer,
   setup_intent:{id:'seti_1',status:setupDone?'succeeded':'requires_payment_method',payment_method:setupDone?{id:'pm_card4242',card:{brand:'visa',last4:'4242'}}:null},metadata:{bitpos_autopay:s.grant,bitpos_merchant:M}});}
 if(u.endsWith('/v1/payment_intents')){
  intents++;
  if(decline)return new Response(JSON.stringify({error:{type:'card_error',code:'card_declined',decline_code:'generic_decline',payment_intent:{id:`pi_declined${RUN}${intents}`}}}),{status:402});
  return ok({object:'payment_intent',id:`pi_auto${RUN}${intents}`,livemode:false,status:'succeeded',amount:Number(body.get('amount')),currency:body.get('currency'),metadata:{bitpos_checkout:body.get('metadata[bitpos_checkout]')}});
 }
 if(u.endsWith('/v1/checkout/sessions'))return ok({object:'checkout.session',id:`cs_test_pay${Date.now()}${calls.length}`,livemode:false,url:`https://checkout.stripe.com/c/pay/x${calls.length}`,amount_total:Number(body.get('line_items[0][price_data][unit_amount]')),
  currency:body.get('line_items[0][price_data][currency]'),status:'open',payment_status:'unpaid',payment_intent:null,metadata:{bitpos_order:body.get('metadata[bitpos_order]'),bitpos_merchant:M}});
 return new Response('{}',{status:404});
};
const current=async()=>(await autopayStatus(db,M,link))!;
const chat=(lines:{productId:string;quantity:number}[])=>startCartAuto(deps,M,lines,{channel:'chat',linkId:link,publicOrigin:'https://pay.example.test'});
let grantId='',agentKey='';

before(async()=>{
 if(skip)return;
 admin=new pg.Pool({connectionString:url,max:2,options:'-c search_path=bitpos,public'});
 app=new pg.Pool({connectionString:url,max:6,options:'-c search_path=bitpos,public'});
 db={query:async(sql,params)=>{const c=await app.connect();try{await c.query('SET ROLE bitpos_app');return await c.query(sql,params as any[]);}finally{await c.query('RESET ROLE');c.release();}},
  tenant:async(merchant,fn)=>{const c=await app.connect();try{await c.query('SET ROLE bitpos_app');await c.query('BEGIN');await c.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{await c.query('RESET ROLE');c.release();}}};
 await admin.query("INSERT INTO merchants(id,name,treasury) SELECT $1,'Autopay test',treasury FROM merchants WHERE id=$2",[M,OTHER]);
 latte=(await admin.query<{id:string}>(`INSERT INTO products(merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,'ลาเต้','Latte','🥛',400,50) RETURNING id`,[M])).rows[0].id;
 cake=(await admin.query<{id:string}>(`INSERT INTO products(merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,'ชีสเค้ก','Cheesecake','🍰',650,50) RETURNING id`,[M])).rows[0].id;
 await admin.query("INSERT INTO meta_messenger_pages(page_id,merchant_id,page_username) VALUES($1,$2,'autopayshop')",[PAGE,M]);
 link=(await admin.query<{id:string}>("INSERT INTO meta_customer_links(merchant_id,page_id,psid,consent_version) VALUES($1,$2,$3,'bitpos-meta-offers-v1') RETURNING id",[M,PAGE,PSID])).rows[0].id;
 deps={db,offers:{menu,router:null},stripe:{config:{secretKey:'sk_test_x',webhookSecret:'whsec_auto'},fetch:stripeFetch}};
});
after(async()=>{if(!skip){await admin.end();await app.end();}});

test('Messenger payloads: period, preset caps, status and stop; anything else is ignored',()=>{
 const ev=(payload:string)=>parseMessengerWebhook({object:'page',entry:[{id:'1234567',messaging:[{recipient:{id:'1234567'},sender:{id:'7654321'},timestamp:1,postback:{payload}}]}]})[0]?.event;
 assert.deepEqual((ev('BITPOS_AUTOPAY') as any).autopay,{step:'start'});
 assert.deepEqual((ev('BITPOS_AUTOPAY_DAYS:30') as any).autopay,{step:'days',days:30});
 assert.deepEqual((ev('BITPOS_AUTOPAY_SET:7:1000:2000') as any).autopay,{step:'set',days:7,perOrder:1000,total:2000});
 assert.deepEqual((ev('BITPOS_AUTOPAY_STOP') as any).autopay,{step:'stop'});
 for(const bad of ['BITPOS_AUTOPAY_DAYS:5','BITPOS_AUTOPAY_SET:7:-1:2000','BITPOS_AUTOPAY_SET:7:1000'])assert.equal(ev(bad),undefined,bad);
});

test('setup: preset caps only; card saved on Stripe activates once and shows the agent key once',{skip},async()=>{
 await assert.rejects(startAutopay(deps,M,link,{days:7,perOrderMinor:999,totalMinor:2000},'https://pay.example.test'),(e:unknown)=>e instanceof AutopayError&&e.code==='INVALID_INPUT');
 await assert.rejects(startAutopay(deps,M,link,{days:5,perOrderMinor:1000,totalMinor:5000},'https://pay.example.test'),(e:unknown)=>e instanceof AutopayError&&e.code==='INVALID_INPUT');
 const s=await startAutopay(deps,M,link,{days:7,perOrderMinor:1000,totalMinor:5000},'https://pay.example.test');
 grantId=s.grantId;assert.match(s.url,/^https:\/\/checkout\.stripe\.com\//);
 const setup=calls.find(c=>c.body.get('mode')==='setup')!;
 assert.equal(setup.body.get('currency'),'usd');assert.equal(setup.body.get('payment_method_types[0]'),null,'Stripe takes payment methods from the dashboard');
 assert.equal(setup.body.get('success_url'),`https://pay.example.test/meta/autopay/done?g=${grantId}&s={CHECKOUT_SESSION_ID}`);
 // Not active yet: a chat checkout still gets the Pay button.
 const before=await chat([{productId:latte,quantity:1}]);
 assert.equal(before.kind,'checkout');
 // The redirect proves nothing: Stripe says the card is not saved yet.
 assert.equal((await activateAutopay(deps,grantId))!.view.status,'SETUP');
 setupDone=true;
 const a=await activateAutopay(deps,grantId);
 assert.equal(a!.view.status,'ACTIVE');assert.equal(a!.view.cardLabel,'visa ·4242');assert.equal(a!.psid,PSID);assert.match(a!.agentKey!,/^bpa_[A-Za-z0-9_-]{32}$/);
 agentKey=a!.agentKey!;
 const again=await activateAutopay(deps,grantId);
 assert.equal(again!.agentKey,null,'the key is shown only once');
 const g=(await admin.query('SELECT expires_at-activated_at AS span,agent_key_sha256 IS NOT NULL AS hashed FROM meta_autopay_grants WHERE id=$1',[grantId])).rows[0];
 assert.equal(g.span.days,7);assert.equal(g.hashed,true);
 assert.equal(await activateAutopay(deps,'not-a-uuid'),null);
});

test('chat checkout: paid off-session inside the caps, stock taken once, receipt once; over a cap falls back to Pay',{skip},async()=>{
 const sent:string[]=[];const s0=await stock(latte);
 deps.onConfirmed=async(_m,id)=>{sent.push(id);};
 const r=await chat([{productId:latte,quantity:2}]);
 deps.onConfirmed=undefined;
 assert.equal(r.kind,'paid');
 const o=(await admin.query('SELECT status,paid_source,autopay_grant_id,amount_minor::int AS a FROM meta_cart_orders WHERE id=$1',[r.orderId])).rows[0];
 assert.deepEqual([o.status,o.paid_source,o.autopay_grant_id,o.a],['PAID','charge',grantId,800]);
 assert.equal(await stock(latte),s0-2);assert.deepEqual(sent,[r.orderId]);
 const pi=calls.filter(c=>c.url.endsWith('/v1/payment_intents')).at(-1)!;
 assert.deepEqual([pi.body.get('off_session'),pi.body.get('customer'),pi.body.get('payment_method'),pi.body.get('metadata[bitpos_autopay]')],['true',`cus_${grantId.replace(/-/g,'')}`,'pm_card4242',grantId]);
 // Stripe's webhook for the same PaymentIntent later: no second PAID, no second stock change.
 const raw=JSON.stringify({id:`evt_auto${Date.now()}`,type:'payment_intent.succeeded',livemode:false,created:1,data:{object:{object:'payment_intent',id:'pi_auto1',status:'succeeded',amount_received:800,currency:'usd',
  metadata:{bitpos_merchant:M,bitpos_order:r.orderId,bitpos_quote:r.orderId,bitpos_checkout:r.orderId}}}});
 const ts=Math.floor(Date.now()/1000);
 assert.equal(await applyStripeWebhook({db} as any,deps.stripe as any,raw,`t=${ts},v1=${createHmac('sha256','whsec_auto').update(`${ts}.${raw}`).digest('hex')}`),'ALREADY_PAID');
 assert.equal(await stock(latte),s0-2);
 assert.equal((await current()).spent,'$8.00');
 // Per-order cap $10: a $13.00 cart is not auto-paid.
 const big=await chat([{productId:cake,quantity:2}]);
 assert.equal(big.kind,'checkout');assert.equal(big.kind==='checkout'&&big.miss,'OVER_ORDER');
});

test('decline: the allowance is released and the same order gets the Pay button',{skip},async()=>{
 decline=true;
 const r=await chat([{productId:latte,quantity:1}]);
 decline=false;
 assert.equal(r.kind,'checkout');assert.equal(r.kind==='checkout'&&r.miss,'DECLINED');
 assert.equal((await admin.query('SELECT autopay_grant_id FROM meta_cart_orders WHERE id=$1',[r.orderId])).rows[0].autopay_grant_id,null);
 assert.equal((await current()).spent,'$8.00','a declined order does not use the allowance');
});

test('Muse Connector: pay_with_allowance with the customer key, once per quote; wrong key refused',{skip},async()=>{
 const q=await createQuote(deps,M,'mcp',latte,2);
 const n=intents;
 const out=await callTool(deps,M,'pay_with_allowance',{quote_id:q.quoteId,allowance_key:agentKey});
 assert.equal(out.isError,undefined);assert.equal((out.structuredContent as any).status,'CONFIRMED');
 const o=(await admin.query('SELECT link_id,autopay_grant_id FROM meta_agent_orders WHERE quote_id=$1',[q.quoteId])).rows[0];
 assert.deepEqual([o.link_id,o.autopay_grant_id],[link,grantId],'the order belongs to the customer who gave the key');
 const again=await callTool(deps,M,'pay_with_allowance',{quote_id:q.quoteId,allowance_key:agentKey});
 assert.equal((again.structuredContent as any).orderId,(out.structuredContent as any).orderId);assert.equal(intents,n+1,'no second charge');
 const wrong=await callTool(deps,M,'pay_with_allowance',{quote_id:(await createQuote(deps,M,'mcp',latte,1)).quoteId,allowance_key:`bpa_${'x'.repeat(32)}`});
 assert.equal((wrong.structuredContent as any).error,'NO_ALLOWANCE');
 assert.equal((await current()).spent,'$16.00');
 // An auto-pay charge with an unknown outcome is never paid again with a Shared Payment Token for the same quote.
 const q2=await createQuote(deps,M,'mcp',latte,1);
 await admin.query("INSERT INTO meta_agent_orders(merchant_id,quote_id,product_id,quantity,currency,amount_minor,link_id,autopay_grant_id) SELECT merchant_id,id,product_id,quantity,currency,amount_minor,$2,$3 FROM meta_quotes WHERE id=$1",[q2.quoteId,link,grantId]);
 const before=intents;
 const spt=await callTool(deps,M,'complete_checkout',{quote_id:q2.quoteId,shared_payment_token:'spt_test123'});
 assert.equal((spt.structuredContent as any).status,'PENDING');assert.equal(intents,before,'no second charge');
 await admin.query("UPDATE meta_agent_orders SET status='FAILED' WHERE quote_id=$1",[q2.quoteId]);
});

test('total cap under parallel orders: the locked allowance lets only what fits through',{skip},async()=>{
 // $34 left of $50: five parallel $8 orders → four fit ($32), one falls back.
 const rs=await Promise.all([1,2,3,4,5].map(()=>chat([{productId:latte,quantity:2}])));
 assert.equal(rs.filter(r=>r.kind==='paid').length,4);
 assert.equal(rs.filter(r=>r.kind==='checkout'&&r.miss==='OVER_TOTAL').length,1);
 assert.equal((await current()).spent,'$48.00');
});

test('stop and expiry: no more auto-pay in chat or through the key; other shops cannot see it',{skip},async()=>{
 assert.equal(await revokeAutopay(db,M,link),1);
 assert.equal((await chat([{productId:latte,quantity:1}])).kind,'checkout');
 const q=await createQuote(deps,M,'mcp',latte,1);
 assert.equal(((await callTool(deps,M,'pay_with_allowance',{quote_id:q.quoteId,allowance_key:agentKey})).structuredContent as any).error,'NO_ALLOWANCE');
 assert.equal((await autopayStatus(db,M,link))!.status,'REVOKED');
 // A second allowance that has run out of time.
 setupDone=true;
 const s=await startAutopay(deps,M,link,{days:1,perOrderMinor:1000,totalMinor:5000},'https://pay.example.test');
 await activateAutopay(deps,s.grantId);
 await admin.query("UPDATE meta_autopay_grants SET activated_at=activated_at-interval '2 days',expires_at=expires_at-interval '2 days' WHERE id=$1",[s.grantId]);
 const r=await chat([{productId:latte,quantity:1}]);
 assert.equal(r.kind==='checkout'&&r.miss,'EXPIRED');
 assert.equal((await autopayStatus(db,M,link))!.status,'EXPIRED');
 assert.equal((await db.tenant(OTHER,c=>c.query('SELECT 1 FROM meta_autopay_grants WHERE id=$1',[s.grantId]))).rowCount,0,'RLS');
});
