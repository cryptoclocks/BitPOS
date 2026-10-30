// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// meta-pay shop and cart orders (migration 313) and the meta-pos pages, against a disposable PostgreSQL with
// migrations 001–313 applied; Stripe and Supabase Auth are stubbed. Queries run as `bitpos_app` under RLS.
import {menuNames} from '../apps/api/src/meta/translate';
import {ownerTools} from '../apps/api/src/meta/owner-assistant';
import {listMenu} from '../apps/api/src/meta/agent-orders';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import pg from 'pg';
import type {MetaDb,OfferDeps} from '../apps/api/src/meta/identity';
import type {EffectiveMenu} from '../apps/api/src/offers';
import type {AgentDeps} from '../apps/api/src/meta/agent-orders';
import {cartForStaff,cartReceipt,handOverCart,parseCart,quoteCart,refundCart,startCart} from '../apps/api/src/meta/cart';
import {applyStripeWebhook} from '../apps/api/src/meta/tap-checkout';
import {listTapOrders,staffSignIn,type StaffDeps} from '../apps/api/src/meta/staff';
import {serveMeta,type MetaRouteDeps} from '../apps/api/src/meta/routes';
import {serveShop} from '../apps/api/src/meta/shop';
import {deviceKey,deviceView} from '../apps/api/src/meta/device';

const url=process.env.META_TEST_DATABASE_URL;
const skip=!url&&'META_TEST_DATABASE_URL not set';
const M=randomUUID(),OTHER='00000000-0000-4000-8000-000000000002',OWNER=randomUUID(),STAFF=randomUUID();
let admin:pg.Pool,app:pg.Pool,db:MetaDb,deps:AgentDeps,staffDeps:StaffDeps,latte:string,cake:string,table:string;
const usd=(v:string)=>({currency:'USD' as const,decimals:2 as const,amountMinor:v});
const menu:OfferDeps['menu']=async()=>({merchant:{id:M,name:'Muse test'},asOf:new Date().toISOString(),priceValidUntil:new Date(Date.now()+3600e3).toISOString(),menuVersion:'v',priceVersion:null,pricingRevision:'1',currency:null,decimals:null,
 products:[{id:latte,catalogKey:null,name:'ลาเต้',nameEn:'Latte',emoji:'🥛',available:Number((await admin.query('SELECT stock FROM products WHERE id=$1',[latte])).rows[0].stock),imageUrl:'/images/menu/latte.jpg',category:'Coffee',description:null,basePrice:usd('500'),unitPrice:usd('400'),
  promotion:{revision:'1',expiresAt:new Date(Date.now()+3600e3).toISOString(),discount:{kind:'percent',percent:20},priceVersion:M}},
  {id:cake,catalogKey:null,name:'ชีสเค้ก',nameEn:'Cheesecake',emoji:'🍰',available:Number((await admin.query('SELECT stock FROM products WHERE id=$1',[cake])).rows[0].stock),imageUrl:'/images/menu/cheesecake.jpg',category:'Desserts',description:null,basePrice:usd('650'),unitPrice:usd('650'),promotion:null}]} as unknown as EffectiveMenu);
const calls:{url:string;body:URLSearchParams;key:string|null}[]=[];
let session:{id:string;orderId:string;amount:number;paid:boolean}|null=null;
const stripeFetch=async(u:string,init:RequestInit)=>{
 const body=new URLSearchParams(String(init.body??''));calls.push({url:u,body,key:(init.headers as Record<string,string>)['Idempotency-Key']??null});
 if(u.endsWith('/v1/balance'))return new Response(JSON.stringify({object:'balance',livemode:false,available:[{amount:1050,currency:'usd'}],pending:[{amount:500,currency:'usd'}]}),{status:200});
 if(u.includes('/v1/payouts'))return new Response(JSON.stringify({object:'list',data:[{id:'po_test123456789',livemode:false,amount:2000,currency:'usd',status:'paid',arrival_date:1793000000,automatic:true}]}),{status:200});
 if(u.endsWith('/v1/refunds'))return new Response(JSON.stringify({object:'refund',id:`re_shop${Date.now()}${calls.length}`,livemode:false,amount:Number(body.get('amount')),payment_intent:body.get('payment_intent'),status:'succeeded'}),{status:200});
 if(u.endsWith('/v1/checkout/sessions')&&init.method==='POST'){
  session={id:`cs_test_shop${calls.length}${Date.now()}`,orderId:body.get('metadata[bitpos_order]')!,amount:Number(body.get('line_items[0][price_data][unit_amount]')),paid:false};
  return new Response(JSON.stringify({object:'checkout.session',id:session.id,livemode:false,url:`https://checkout.stripe.com/c/pay/${session.id}`,amount_total:session.amount,currency:body.get('line_items[0][price_data][currency]'),status:'open',payment_status:'unpaid',payment_intent:null,
   metadata:{bitpos_order:session.orderId,bitpos_merchant:body.get('metadata[bitpos_merchant]')}}),{status:200});
 }
 if(u.includes('/v1/checkout/sessions/')&&session)return new Response(JSON.stringify({object:'checkout.session',id:session.id,livemode:false,url:null,amount_total:session.amount,currency:'usd',status:session.paid?'complete':'open',payment_status:session.paid?'paid':'unpaid',
  payment_intent:session.paid?`pi_lookup${session.orderId.replace(/-/g,'')}`:null,metadata:{bitpos_order:session.orderId,bitpos_merchant:M}}),{status:200});
 return new Response('{}',{status:404});
};
const authFetch=async(_u:string,init:RequestInit)=>{const {email}=JSON.parse(String(init.body));return new Response(JSON.stringify({access_token:'x',user:{id:email==='owner@shop.test'?OWNER:STAFF}}),{status:200});};
const stockOf=async(id:string)=>Number((await admin.query('SELECT stock FROM products WHERE id=$1',[id])).rows[0].stock);
const signedEvent=(orderId:string,amount:number,evt=`evt_shop${Date.now()}${Math.floor(Math.random()*1e6)}`)=>{
 const raw=JSON.stringify({id:evt,type:'payment_intent.succeeded',livemode:false,created:1,data:{object:{object:'payment_intent',id:`pi_shop${orderId.replace(/-/g,'')}`,status:'succeeded',amount_received:amount,currency:'usd',
  metadata:{bitpos_merchant:M,bitpos_order:orderId,bitpos_quote:orderId,bitpos_checkout:orderId}}}});
 const ts=Math.floor(Date.now()/1000);return {raw,sig:`t=${ts},v1=${createHmac('sha256','whsec_shop').update(`${ts}.${raw}`).digest('hex')}`};
};

before(async()=>{
 if(skip)return;
 admin=new pg.Pool({connectionString:url,max:2,options:'-c search_path=bitpos,public'});
 app=new pg.Pool({connectionString:url,max:4,options:'-c search_path=bitpos,public'});
 app.on('connect',c=>{c.query('SET ROLE bitpos_app');});
 db={query:(sql,params)=>app.query(sql,params as any[]),tenant:async(merchant,fn)=>{const c=await app.connect();try{await c.query('SET ROLE bitpos_app');await c.query('BEGIN');await c.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};
 await admin.query("INSERT INTO merchants(id,name,treasury) SELECT $1,'Muse test',treasury FROM merchants WHERE id=$2",[M,OTHER]);
 latte=(await admin.query<{id:string}>(`INSERT INTO products(merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,'ลาเต้','Latte','🥛',500,10) RETURNING id`,[M])).rows[0].id;
 cake=(await admin.query<{id:string}>(`INSERT INTO products(merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,'ชีสเค้ก','Cheesecake','🍰',650,2) RETURNING id`,[M])).rows[0].id;
 table=(await admin.query<{id:string}>("INSERT INTO merchant_tables(merchant_id,label) VALUES($1,'Table 1') RETURNING id",[M])).rows[0].id;
 await admin.query("INSERT INTO members(user_id,merchant_id,role) VALUES($1,$3,'owner'),($2,$3,'staff')",[OWNER,STAFF,M]);
 deps={db,offers:{menu,router:null},stripe:{config:{secretKey:'sk_test_x',webhookSecret:'whsec_shop'},fetch:stripeFetch}};
 staffDeps={db,config:{origin:'https://pos.example.test',authUrl:'http://auth.test',anonKey:'x',fetch:authFetch as any}};
});
after(async()=>{if(!skip){await admin.end();await app.end();}});

test('cart cookie: ids and quantities only, repeats merged, junk dropped',()=>{
 const a=randomUUID(),b=randomUUID();
 assert.deepEqual(parseCart(`${a}:2,${b}:1,${a}:3,bad:1,${b}:0,${b}:x`),[{productId:a,quantity:5},{productId:b,quantity:1}]);
 assert.deepEqual(parseCart(`${a}:99`),[{productId:a,quantity:20}]);assert.deepEqual(parseCart(null),[]);
});

test('cart: server prices with offers; paid once by signed webhook; stock per line recorded; refund returns it once',{skip},async()=>{
 const q=await quoteCart(deps,M,[{productId:latte,quantity:2},{productId:cake,quantity:1}]);
 assert.deepEqual([q.total,q.discount,q.lines[0].unit,q.lines[0].offer],['$14.50','$2.00','$4.00',true]);
 await assert.rejects(quoteCart(deps,M,[{productId:cake,quantity:3}]),/OUT_OF_STOCK/);
 await assert.rejects(quoteCart(deps,M,[]),/EMPTY/);
 await assert.rejects(startCart(deps,M,[{productId:latte,quantity:1}],{channel:'counter',publicOrigin:'https://pay.example.test'}),/INVALID_INPUT/,'counter sale needs a staff member');
 const r=await startCart(deps,M,[{productId:latte,quantity:2},{productId:cake,quantity:1}],{channel:'table',tableId:table,publicOrigin:'https://pay.example.test'});
 const create=calls.find(c=>c.url.endsWith('/v1/checkout/sessions'))!;
 assert.equal(create.body.get('line_items[0][price_data][unit_amount]'),'1450');assert.equal(create.key,`bitpos-meta-checkout-${r.orderId}`);
 assert.match(create.body.get('success_url')!,new RegExp(`^https://pay\\.example\\.test/receipt/${r.orderId}\\?a=`));
 const [l0,c0]=[await stockOf(latte),await stockOf(cake)];
 const bad=signedEvent(r.orderId,1);assert.equal(await applyStripeWebhook({db,masterKey:Buffer.alloc(16),publicOrigin:'https://pay.example.test'},deps.stripe!,bad.raw,bad.sig),'MISMATCH','wrong amount never pays');
 const ev=signedEvent(r.orderId,1450),identity={db,masterKey:Buffer.alloc(16),publicOrigin:'https://pay.example.test'};
 assert.equal(await applyStripeWebhook(identity,deps.stripe!,ev.raw,ev.sig),'PAID');
 assert.equal(await applyStripeWebhook(identity,deps.stripe!,ev.raw,ev.sig),'DUPLICATE_EVENT');
 assert.deepEqual([await stockOf(latte),await stockOf(cake)],[l0-2,c0-1]);
 assert.deepEqual((await admin.query("SELECT line,delta,reason FROM meta_stock_movements WHERE order_id=$1 ORDER BY line",[r.orderId])).rows,[{line:1,delta:-2,reason:'cart_paid'},{line:2,delta:-1,reason:'cart_paid'}]);
 const v=await cartReceipt(deps,r.orderId,r.access,null);assert.deepEqual([v?.status,v?.total,v?.tableLabel,v?.lines.length],['PAID','$14.50','Table 1',2]);
 assert.equal(await cartReceipt(deps,r.orderId,'x'.repeat(32),null),null,'wrong access token');
 const feed=await db.tenant(M,c=>c.query<{channel:string}>('SELECT channel FROM bitpos.meta_order_feed() WHERE order_id=$1',[r.orderId]));assert.equal(feed.rows[0].channel,'table');
 const listed=(await listTapOrders(staffDeps,{merchantId:M,userId:OWNER,role:'owner',sessionId:'s'})).find(o=>o.id===r.orderId);
 assert.deepEqual([listed?.channel,listed?.status,listed?.name],['table','PAID','ลาเต้ × 2, ชีสเค้ก × 1']);
 await refundCart(deps,M,r.orderId);await refundCart(deps,M,r.orderId);
 assert.equal(calls.filter(c=>c.url.endsWith('/v1/refunds')).length,1,'refund once');
 assert.deepEqual([await stockOf(latte),await stockOf(cake)],[l0,c0]);
 assert.equal((await cartForStaff(db,M,r.orderId))?.status,'CANCELLED');
 assert.equal(await handOverCart(db,M,OWNER,r.orderId),'NOT_PAID');
});

test('cart: a customer returning from Stripe is confirmed by a server lookup, not by the redirect',{skip},async()=>{
 const r=await startCart(deps,M,[{productId:latte,quantity:1}],{channel:'web',publicOrigin:'https://pay.example.test'});
 assert.equal((await cartReceipt(deps,r.orderId,r.access,session!.id))?.status,'PENDING','unpaid session stays pending');
 session!.paid=true;
 const v=await cartReceipt(deps,r.orderId,r.access,session!.id);assert.equal(v?.status,'PAID');
 assert.equal((await admin.query('SELECT paid_source FROM meta_cart_orders WHERE id=$1',[r.orderId])).rows[0].paid_source,'lookup');
 assert.equal(await handOverCart(db,M,STAFF,r.orderId),'HANDED_OVER');assert.equal(await handOverCart(db,M,STAFF,r.orderId),'ALREADY');
 await assert.rejects(refundCart(deps,M,r.orderId),/NOT_CANCELLABLE/,'no refund after hand-over');
});

test('HTTP: shop pages always offer a way on; same-origin POSTs; staff pages need a session and show the shell',{skip},async()=>{
 const routeDeps:MetaRouteDeps={identity:{db,masterKey:Buffer.alloc(16),publicOrigin:'https://pay.example.test'},messenger:null,offers:deps.offers,stripe:deps.stripe,staff:staffDeps,demoMerchant:M};
 const server=http.createServer(async(req,res)=>{if(!(await serveShop(req,res,routeDeps))&&!(await serveMeta(req,res,routeDeps))){res.writeHead(404);res.end();}});
 await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 try{
  for(const p of ['/','/menu',`/item/${latte}`,'/cart','/help']){const r=await fetch(base+p);assert.equal(r.status,200,p);const h=await r.text();assert.match(h,/class="btn/,`${p} has an onward button`);assert.doesNotMatch(h,/USDG|USDC|USDT|Solana|devnet|wallet/i,p);}
  assert.match(await (await fetch(base+'/menu')).text(),/\$4\.00 <small><s>\$5\.00/,'offer price from the server');
  assert.equal((await fetch(base+'/cart/add',{method:'POST',body:`id=${latte}&q=2`,redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'}})).status,403,'no Origin');
  const add=await fetch(base+'/cart/add',{method:'POST',body:`id=${latte}&q=2`,redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded',origin:'https://pay.example.test'}});
  assert.equal(add.status,303);const cart=add.headers.get('set-cookie')!.split(';')[0];assert.match(cart,/^bitpos_meta_cart=/);
  const page=await (await fetch(base+'/cart',{headers:{cookie:cart}})).text();assert.match(page,/\$8\.00/);assert.match(page,/action="\/checkout"/);
  const pay=await fetch(base+'/checkout',{method:'POST',redirect:'manual',headers:{cookie:cart,origin:'https://pay.example.test'}});
  assert.equal(pay.status,303);assert.match(pay.headers.get('location')!,/^https:\/\/checkout\.stripe\.com\//);
  // Old /meta pages now carry onward buttons too.
  assert.match(await (await fetch(base+'/meta/order')).text(),/href="\/help/);
  // meta-pos: sign-in page first, then the shell with the sidebar.
  assert.match(await (await fetch(base+'/meta/staff/overview',{redirect:'follow'})).text(),/name="password"/);
  const login=await fetch(base+'/meta/staff/login',{method:'POST',body:'email=owner@shop.test&password=x',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded',origin:'https://pos.example.test'}});
  assert.equal(login.status,303);const sc=login.headers.get('set-cookie')!.split(';')[0];
  for(const p of ['/meta/staff','/meta/staff/overview','/meta/staff/counter','/meta/staff/kitchen','/meta/staff/bookings','/meta/staff/menu','/meta/staff/customers','/meta/staff/connector','/meta/staff/reports','/meta/staff/settings','/meta/staff/users','/meta/staff/payouts','/meta/staff/stockcount','/meta/staff/assistant','/meta/staff/offers','/meta/staff/ledger']){
   const r=await fetch(base+p,{headers:{cookie:sc}});assert.equal(r.status,200,p);const h=await r.text();assert.match(h,/class="side"/,`${p} has the meta-pos sidebar`);assert.doesNotMatch(h,/USDG|USDC|Solana|devnet/i,p);
   // English by default with nothing Thai left (menu names in English too); Thai when chosen.
   const thai=h.match(/[\u0e00-\u0e7f][\u0e00-\u0e7f ]*/g)?.filter(x=>x!=='ไทย')??[];assert.deepEqual(thai,[],`${p} has Thai left in English`);assert.match(h,/<html lang="en">/);
   assert.match(await (await fetch(base+p,{headers:{cookie:`${sc}; bitpos_lang=th`}})).text(),/[\u0e00-\u0e7f]{3}/,`${p} in Thai`);
  }
  const po=await (await fetch(base+'/meta/staff/payouts',{headers:{cookie:sc}})).text();assert.match(po,/\$10\.50/,'available balance');assert.match(po,/\$20\.00/);assert.match(po,/Paid out/);
  assert.match(await (await fetch(base+'/meta/staff/users',{headers:{cookie:sc}})).text(),/Permissions by role/);
  assert.match(await (await fetch(base+'/menu')).text(),/class="lst"/,'desktop two-column menu');
  const bill=await fetch(base+'/meta/staff/counter',{method:'POST',body:`q_${latte}=1&q_${cake}=1`,redirect:'manual',headers:{cookie:sc,'content-type':'application/x-www-form-urlencoded',origin:'https://pos.example.test'}});
  assert.equal(bill.status,303);const qr=await (await fetch(base+bill.headers.get('location')!,{headers:{cookie:sc}})).text();assert.match(qr,/<svg/,'Stripe QR');assert.deepEqual(qr.match(/[\u0e00-\u0e7f][\u0e00-\u0e7f ]*/g)?.filter(x=>x!=='ไทย')??[],[],'bill page in English');assert.match(qr,/\$10\.50/);
  const billId=bill.headers.get('location')!.split('/').pop()!;
  const short=await fetch(`${base}/pay/${billId}`,{redirect:'manual'});assert.equal(short.status,303);assert.match(short.headers.get('location')!,/^https:\/\/checkout\.stripe\.com\//,'short QR link forwards to Stripe');
  assert.equal((await fetch(`${base}/pay/${randomUUID()}`,{redirect:'manual'})).status,410,'unknown or closed bill');
  const stock=await fetch(`${base}/meta/staff/menu/${latte}/stock`,{method:'POST',body:'stock=30',redirect:'manual',headers:{cookie:sc,'content-type':'application/x-www-form-urlencoded',origin:'https://pos.example.test'}});
  assert.equal(stock.status,303);assert.equal(await stockOf(latte),30);
  assert.equal((await admin.query("SELECT delta FROM meta_stock_movements WHERE product_id=$1 AND reason='staff_adjust' ORDER BY created_at DESC LIMIT 1",[latte])).rows[0].delta>0,true);
 }finally{server.close();}
});

test('BitPOS Mini Meta screens: device key required; idle, counter Stripe QR, paid; only device-font characters',{skip},async()=>{
 const dev=(await admin.query<{id:string}>("INSERT INTO devices(merchant_id,label,table_id) VALUES($1,'Muse Mini test',$2) RETURNING id",[M,table])).rows[0].id;
 const master=Buffer.alloc(16,7);
 const routeDeps:MetaRouteDeps={identity:{db,masterKey:master,publicOrigin:'https://pay.example.test'},messenger:null,offers:deps.offers,stripe:deps.stripe,staff:staffDeps,demoMerchant:M};
 const server=http.createServer(async(req,res)=>{if(!(await serveMeta(req,res,routeDeps))){res.writeHead(404);res.end();}});
 await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));
 const state=(key?:string)=>fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/meta/device/state?d=${dev}`,{headers:key?{authorization:`Bearer ${key}`}:{}});
 try{
  assert.equal((await state()).status,401);assert.equal((await state('A'.repeat(43))).status,401,'wrong key');
  const idle=await (await state(deviceKey(master,dev))).json();
  assert.deepEqual([idle.v,idle.screen,idle.table,idle.qr],[1,'idle','Table 1','']);
  const r=await startCart(deps,M,[{productId:cake,quantity:1}],{channel:'counter',staffUserId:OWNER,deviceId:dev,publicOrigin:'https://pay.example.test'});
  const qr=await deviceView(db,dev,'https://pay.example.test');
  assert.deepEqual([qr?.screen,qr?.big,qr?.qr],['pay_qr','$6.50',`https://pay.example.test/pay/${r.orderId}`]);
  const ev=signedEvent(r.orderId,650);assert.equal(await applyStripeWebhook({db,masterKey:master,publicOrigin:'https://pay.example.test'},deps.stripe!,ev.raw,ev.sig),'PAID');
  const paid=await deviceView(db,dev,'https://pay.example.test');assert.deepEqual([paid?.screen,paid?.tone],['paid','green']);
  // English unless the device asks for Thai (its language button).
  assert.equal(paid?.title,'Paid - thank you');assert.match(qr!.line1,/^Cheesecake x1$/);
  const th=await deviceView(db,dev,'https://pay.example.test',undefined,'th');assert.match(th!.title,/^จ่ายแล้ว/);
  for(const v of [idle,qr!,paid!])for(const f of ['table','title','line1','line2','big'] as const)assert.match((v as any)[f],/^[\x20-\x7e\u0e00-\u0e7f]*$/,`${f}: ${(v as any)[f]}`);
 }finally{server.close();}
});

test('tourist mode: names translated once per language and cached; renamed items again; prices never from the model',{skip},async()=>{
 let calls=0;
 const router={invoke:async(r:any)=>{calls++;const items=JSON.parse(r.messages[1].content).items;return {value:{names:items.map((i:any)=>({productId:i.productId,name:i.english==='Latte'?'ラテ':i.english==='Cake'?'$5 ケーキ':'名'}))},invocation:{id:randomUUID()},attempts:[]};}} as any;
 const menu=await listMenu(deps,M);
 const first=await menuNames(db,router,M,'ja',menu);assert.equal(first.get(latte),'ラテ');assert.equal(calls,1);
 assert.ok(![...first.values()].some(v=>v.includes('$')),'a name with a price is refused');
 const again=await menuNames(db,router,M,'ja',menu);assert.equal(again.get(latte),'ラテ');
 const before=calls;await menuNames(db,router,M,'ja',menu.map(i=>i.productId===latte?{...i,nameEn:'Caffe Latte'}:i));assert.ok(calls>before,'renamed item is translated again');
 assert.equal((await menuNames(db,null,M,'fr',menu)).size,0,'no model: English names stay');
});

test('owner assistant tools: read-only, this shop only, numbers from the database',{skip},async()=>{
 const log:any[]=[];const tools=ownerTools(db,M,log);
 for(const t of tools){const r=await t.run(t.name.startsWith('stock')||t.name.startsWith('offers')?{}:{days:7});assert.ok(r!==undefined,t.name);}
 assert.equal(log.length,tools.length,'every tool call is kept for the page');
 const stock=log.find(x=>x.tool==='stock_levels').result as any[];assert.ok(stock.some(s=>s.item==='Latte'),'own products');
 assert.ok(!stock.some(s=>s.item==='Other shop item'));
 assert.throws(()=>tools[0].args.parse({days:400}),'day range bounded');
});
