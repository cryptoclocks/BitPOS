// Seed the throwaway bitpos_render_fixture database with a synthetic cafe. Idempotent per phase.
// usage: tsx seed.ts users   (merchant + owner/manager/staff + .users.json, before starting services)
//        tsx seed.ts data    (catalog, prices, stock, table, register, orders in every status; needs no running API)
import {randomUUID,createHash} from 'node:crypto';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {pool,tenant} from '../../../../../apps/api/src/db';
import {registry} from '../../../../../apps/api/src/registry';
import {publishPrices} from '../../../../../apps/api/src/catalog';
import {counterQuote,createRoutedOrder} from '../../../../../apps/api/src/orders';
import {createProduct} from '../../../../../apps/api/src/catalog-edit';
import {uploadProductImage} from '../../../../../apps/api/src/product-images';
import {fulfillmentRequest} from '../../../../../apps/api/src/fulfillment';
import {MINT,TOKEN_PROGRAM} from '../../../../../packages/domain/src/index';

const MERCHANT='7e0d0c0e-0000-4000-8000-00000000f001';
const USERS={'owner@render.invalid':'7e0d0c0e-0000-4000-8000-0000000000a1','manager@render.invalid':'7e0d0c0e-0000-4000-8000-0000000000a2','staff@render.invalid':'7e0d0c0e-0000-4000-8000-0000000000a3'};
const ROLE={'owner@render.invalid':'owner','manager@render.invalid':'manager','staff@render.invalid':'staff'} as const;
const here=new URL('.',import.meta.url).pathname;
const ACTOR=USERS['owner@render.invalid'];

import {samplePhoto} from './photo.mjs';

async function users(){
 await pool.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Render Cafe (synthetic fixture)','11111111111111111111111111111111') ON CONFLICT DO NOTHING",[MERCHANT]);
 for(const [email,id] of Object.entries(USERS))await pool.query('INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,$3) ON CONFLICT(user_id,merchant_id) DO UPDATE SET role=$3',[id,MERCHANT,ROLE[email as keyof typeof ROLE]]);
 writeFileSync(here+'.users.json',JSON.stringify(USERS));
 console.log('users ready; merchant',MERCHANT);
}
async function reg(path:string,method:string,input?:unknown,role='owner'){return tenant(MERCHANT,db=>registry(db,MERCHANT,ACTOR,role,path,method,input));}

async function data(){
 if((await pool.query('SELECT 1 FROM products WHERE merchant_id=$1 LIMIT 1',[MERCHANT])).rowCount){console.log('data already seeded (recreate the DB to reseed)');return;}
 const catalog:[string,string,string,string,number,string][]=[
  ['กาแฟลาเต้','Latte','Coffee','Espresso with steamed milk',350,'หมวดกาแฟ'],['อเมริกาโน่','Americano','Coffee','Espresso and hot water',300,''],['คาปูชิโน่','Cappuccino','Coffee','Equal parts espresso, milk and foam',350,''],
  ['ชาเขียวนม','Matcha latte','Tea','Ceremonial grade matcha',400,''],['ชาไทย','Thai tea','Tea','Sweet Thai milk tea',320,''],
  ['ครัวซองต์เนย','Butter croissant','Bakery','Baked this morning',280,''],['บราวนี่','Brownie','Bakery','Dark chocolate brownie',250,''],['แซนด์วิชไก่','Chicken sandwich','Food','Grilled chicken, lettuce',450,''],
 ];
 const ids:Record<string,string>={};
 const photoFor:Record<string,number>={Latte:0,Americano:30,'Matcha latte':60,'Butter croissant':90}; // synthetic gradients, not real photos
 for(const [th,en,cat,desc,,] of catalog){
  const imageUrl=en in photoFor?(await tenant(MERCHANT,db=>uploadProductImage(db,MERCHANT,ACTOR,'owner',samplePhoto(photoFor[en])))).path:undefined;
  const created=await tenant(MERCHANT,db=>createProduct(db,MERCHANT,ACTOR,'owner',{name:th,nameEn:en,category:cat,description:desc,...(imageUrl?{imageUrl}:{})}));
  ids[en]=created.id;
 }
 await tenant(MERCHANT,db=>db.query("UPDATE products SET stock=60 WHERE merchant_id=$1",[MERCHANT]));
 await tenant(MERCHANT,db=>db.query("UPDATE products SET stock=9,reorder_level=10 WHERE merchant_id=$1 AND name_en='Brownie'",[MERCHANT]));
 const configuration={expectedRevision:'0',catalogCurrency:'USD' as const,provenance:{kind:'demo_configured' as const,label:'RENDER FIXTURE ONLY'},prices:catalog.map(c=>({productId:ids[c[1]],unitMinor:String(c[4])})),settlement:{asset:'USDG' as const,network:'solana:devnet' as const,mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6 as const,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1' as const}};
 await tenant(MERCHANT,db=>publishPrices(db,MERCHANT,ACTOR,'owner',configuration));
 const table=await reg('/api/tables','POST',{label:'Table 4'});
 const dev=await reg('/api/devices','POST',{label:'Counter screen'});
 const tdev=await reg('/api/devices','POST',{label:'Table 4 screen',tableId:table.id});
 const register=await reg('/api/registers','POST',{label:'Register 1'});
 await reg('/api/registers/'+register.id+'/pairing','PUT',{deviceId:dev.id,expectedPairingGeneration:'1'});
 const info={merchant:MERCHANT,products:ids,table,device:dev,tableDevice:tdev,register};
 writeFileSync(here+'.fixture.json',JSON.stringify(info,null,1));
 console.log('catalog, prices, table, register ready');
}
async function orders(){
 const f=JSON.parse(readFileSync(here+'.fixture.json','utf8'));const P=f.products as Record<string,string>;
 if((await pool.query('SELECT 1 FROM orders WHERE merchant_id=$1 LIMIT 1',[MERCHANT])).rowCount){console.log('orders already seeded');return;}
 const mk=async(items:[string,number][],kind:'register'|'device'='register')=>{
  const q=await tenant(MERCHANT,db=>counterQuote(db,MERCHANT,f.register.id,{items:items.map(([n,qty])=>({productId:P[n],qty})),serving:{kind:'counter'}}));
  const made=await tenant(MERCHANT,db=>createRoutedOrder(db,MERCHANT,'register',f.register.id,{items:q.lines.map((l:{productId:string;qty:number})=>({productId:l.productId,qty:l.qty})),serving:{kind:'counter'},quoteId:q.id,priceVersion:q.priceVersion,idempotencyKey:randomUUID()}));
  await tenant(MERCHANT,db=>db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,screen_generation=screen_generation+1 WHERE device_id=$1",[f.device.id]));
  return made;
 };
 const pay=(id:string,minutesAgo:number)=>tenant(MERCHANT,db=>db.query("UPDATE orders SET status='PAID',paid_at=clock_timestamp()-($2||' minutes')::interval,payer='RenderPayer11111111111111111111111111111111',version=version+1 WHERE id=$1",[id,String(minutesAgo)]));
 const step=async(id:string,to:'PREPARING'|'READY'|'COLLECTED')=>{
  const cur=(await tenant(MERCHANT,db=>db.query('SELECT coalesce((SELECT version FROM order_fulfillment WHERE order_id=$1),0) AS v',[id]))).rows[0].v;
  await tenant(MERCHANT,db=>fulfillmentRequest(db,MERCHANT,ACTOR,'owner',id,false,{status:to,expectedVersion:cur,idempotencyKey:randomUUID()}));
  await tenant(MERCHANT,db=>db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,screen_generation=screen_generation+1 WHERE device_id=$1",[f.device.id]));
  return made;
 };
 for(const d of [f.device,f.tableDevice]){await reg('/api/devices/'+d.id+'/credential','POST',{});await tenant(MERCHANT,db=>db.query("UPDATE device_presence SET connection_generation=1,connection_id=$2,connected_until=clock_timestamp()+interval '3 hours' WHERE device_id=$1",[d.id,randomUUID()]));}
 const made:Record<string,string>={};
 const spec:[string,[string,number][],string,number][]=[
  ['paid',[['Latte',2],['Butter croissant',1]],'PAID',50],['paid2',[['Americano',1]],'PAID',42],['paid3',[['Thai tea',2],['Brownie',1]],'PAID',35],
  ['preparing',[['Cappuccino',1],['Chicken sandwich',1]],'PREPARING',28],['preparing2',[['Matcha latte',1]],'PREPARING',20],
  ['ready',[['Latte',1]],'READY',14],['ready2',[['Americano',2]],'READY',10],
  ['collected',[['Butter croissant',2],['Latte',1]],'COLLECTED',90],['collected2',[['Thai tea',1]],'COLLECTED',75],['collected3',[['Brownie',2]],'COLLECTED',200],
 ];
 for(const [name,items,st,ago] of spec){const o=await mk(items);made[name]=o.order.id;await pay(o.order.id,ago);
  if(['PREPARING','READY','COLLECTED'].includes(st))await step(o.order.id,'PREPARING');
  if(['READY','COLLECTED'].includes(st))await step(o.order.id,'READY');
  if(st==='COLLECTED')await step(o.order.id,'COLLECTED');}
 for(const n of ['awaiting','awaiting2']){const o=await mk([['Latte',1],['Brownie',1]]);made[n]=o.order.id;}
 const ex=await mk([['Americano',1]]);made.expired=ex.order.id;
 { // quote_expires_at is immutable by trigger; age this one order through the admin connection (throwaway DB only).
  const admin=new (await import('pg')).default.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
  await admin.query('SET session_replication_role=replica');await admin.query("UPDATE bitpos.orders SET quote_expires_at=clock_timestamp()-interval '30 minutes' WHERE id=$1",[ex.order.id]);await admin.end();
 }
 const {expireUnpaidOrders}=await import('../../../../../apps/api/src/order-closure');
 await tenant(MERCHANT,db=>expireUnpaidOrders(db,MERCHANT));
 writeFileSync(here+'.orders.json',JSON.stringify(made,null,1));console.log('orders',made);
}
/** Customers, suppliers, stock receipts, reward slots and promotion campaigns, written through the real API handlers (in-process server). */
async function extras(){
 const f=JSON.parse(readFileSync(here+'.fixture.json','utf8'));const P=f.products as Record<string,string>;
 const env={BITPOS_AI_PROVIDER_URL:'https://fixture-render.invalid/v1/chat/completions',BITPOS_AI_API_KEY:'fixture-not-live',BITPOS_AI_MODEL:'fixture-provider-only',BITPOS_AI_JOB_BUDGET_MICROUSD:'1000',BITPOS_AI_DAILY_BUDGET_MICROUSD:'10000'};Object.assign(process.env,env);
 const {server}=await import('../../../../../apps/api/src/index');const {runPromotionJob}=await import('../../../../../apps/worker/src/promotions');
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 const {randomBytes}=await import('node:crypto');const {hash}=await import('../../../../../packages/domain/src/index');
 const token=randomBytes(32).toString('base64url');await pool.query("INSERT INTO sessions(token_hash,user_id,merchant_id,role,expires_at) VALUES($1,$2,$3,'owner',now()+interval '1 hour')",[hash(token),ACTOR,MERCHANT]);
 const call=async(path:string,input?:unknown,method=input?'POST':'GET')=>{const r=await fetch(origin+path,{method,headers:{Authorization:'Bearer '+token,...(input?{'Content-Type':'application/json'}:{})},body:input?JSON.stringify(input):undefined});const v=await r.json();if(!r.ok)throw Error(method+' '+path+' '+r.status+' '+JSON.stringify(v));return v;};
 for(const [name,phone,email,notes] of [['Mali (synthetic)','0800000001','mali@render.invalid','Prefers oat milk'],['Somchai (synthetic)','0800000002','','Regular, morning'],['Ploy (synthetic)','','ploy@render.invalid','']])await call('/api/customers',{name,phone,email,notes});
 const customers=(await call('/api/customers')).customers as {id:string}[];
 { const admin=new (await import('pg')).default.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
  const o=JSON.parse(readFileSync(here+'.orders.json','utf8'));
  for(const [i,k] of ['collected','collected2','paid'].entries())await admin.query('UPDATE bitpos.orders SET customer_id=$1 WHERE id=$2',[customers[i%customers.length].id,o[k]]);await admin.end(); }
 for(const [name,supplies,contact,phone] of [['Bean Supply Co (synthetic)','Coffee beans, milk','Khun A','0800000010'],['Morning Bakery (synthetic)','Croissants, brownies','Khun B','0800000011']])await call('/api/suppliers',{name,supplies,contact,phone,idempotencyKey:randomUUID()});
 const stock=(await call('/api/inventory/stock')) as {stock?:{productId:string;stock:number}[]}|{productId:string;stock:number}[];
 const rows=(stock as unknown as {products:{productId:string;stock:number}[]}).products;const cur=(id:string)=>rows.find(r=>r.productId===id)?.stock??0;
 await call('/api/inventory/movements',{productId:P['Latte'],kind:'RECEIVE',delta:20,reason:'Weekly delivery',reference:'PO-RENDER-1',expectedStock:cur(P['Latte']),idempotencyKey:randomUUID()});
 await call('/api/inventory/movements',{productId:P['Brownie'],kind:'ADJUST',delta:-2,reason:'Dropped tray',reference:'',expectedStock:cur(P['Brownie']),idempotencyKey:randomUUID()});
 const now=Date.now();
 for(const [slot,th,en,pts,disc,min] of [[1,'ส่วนลด 10 บาท','Save 10',100,1000,3000],[2,'ส่วนลด 25 บาท','Save 25',250,2500,8000]] as const)await call('/api/settings/rewards',{slot,nameTh:th,nameEn:en,pointsCost:pts,discountMinor:String(disc),minimumSpendMinor:String(min),validityDays:30,enabled:true},'PUT');
 const mkCampaign=async(product:string,headline:string,copy:string,pct:number,goal:string)=>{
  const input={productIds:[P[product]],goal,audience:'daily',minimumUnitMinor:'1',daily:{timezone:'Asia/Bangkok',lookbackWeeks:6},maxDiscountPercent:20,startsAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+6*3600000*4).toISOString(),idempotencyKey:randomUUID()};
  const g=await call('/api/promotions/generate',input);
  const config={url:env.BITPOS_AI_PROVIDER_URL,key:env.BITPOS_AI_API_KEY,model:env.BITPOS_AI_MODEL,jobBudget:1000,dailyBudget:10000};
  await runPromotionJob(MERCHANT,{kind:'fixture_provider',configuration:config,provider:async job=>({kind:'fixture_provider',provider:new URL(config.url).origin,model:config.model,requestId:'render-fixture-'+job.jobId,candidate:{productId:job.products[0].productId,headline,copy,discountPercent:pct,rationale:'Fixture response for rendering, not a real model'}})});
  const job=(await call('/api/promotions/jobs/'+g.job.id)).job;return (await call('/api/promotions/'+job.campaignId)).campaign as {id:string;version:number};
 };
 const c1=await mkCampaign('Latte','Latte happy hour','Fixture campaign: iced latte this afternoon',15,'Boost afternoon coffee');
 const c2=await mkCampaign('Butter croissant','Croissant + coffee','Fixture campaign: fresh croissant',10,'Move bakery stock');
 const c3=await mkCampaign('Thai tea','Thai tea Tuesday','Fixture campaign: sweet and cold',20,'Tea promotion');
 await call('/api/promotions/'+c2.id+'/approve',{expectedVersion:c2.version,idempotencyKey:randomUUID()});
 await call('/api/promotions/'+c3.id+'/approve',{expectedVersion:c3.version,idempotencyKey:randomUUID()});
 const c3b=(await call('/api/promotions/'+c3.id)).campaign;
 await call('/api/promotions/'+c3.id+'/revoke',{expectedVersion:c3b.version,idempotencyKey:randomUUID()});
 console.log('extras done',{customers:customers.length,campaigns:[c1.id,c2.id,c3.id]});
 server.close();
}
/** Re-time the seeded orders around Asia/Bangkok midnight (idempotent, safe to repeat): two orders yesterday 23:50 and 21:00, the rest today from 00:10. */
export async function retime(){
 const o=JSON.parse(readFileSync(here+'.orders.json','utf8')) as Record<string,string>;
 const at:Record<string,string>={collected3:'-0:10',paid2:'-3:00',paid:'0:10',collected:'0:50',collected2:'6:30',paid3:'6:45',preparing:'9:00',preparing2:'9:30',ready:'12:00',ready2:'12:20',awaiting:'13:00',awaiting2:'13:10',expired:'13:20'};
 const admin=new (await import('pg')).default.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();await admin.query('SET session_replication_role=replica');
 for(const [k,t] of Object.entries(at)){const neg=t.startsWith('-');const [h,m]=t.replace('-','').split(':').map(Number);const mins=(neg?-1:1)*(h*60+m);
  await admin.query("UPDATE bitpos.orders SET created_at=(((now() AT TIME ZONE 'Asia/Bangkok')::date)::timestamp+($2||' minutes')::interval) AT TIME ZONE 'Asia/Bangkok' WHERE id=$1",[o[k],String(mins)]);}
 // A paid order is paid when it was created, except collected3: created 23:50 yesterday, paid 00:05 today (the straddler between "created" and "paid" days).
 const paidAt:Record<string,string>={collected3:'0:05'};
 for(const k of Object.keys(at)){const t=paidAt[k];if(t){const [h,m]=t.split(':').map(Number);await admin.query("UPDATE bitpos.orders SET paid_at=(((now() AT TIME ZONE 'Asia/Bangkok')::date)::timestamp+($2||' minutes')::interval) AT TIME ZONE 'Asia/Bangkok' WHERE id=$1 AND status='PAID'",[o[k],String(h*60+m)]);}
  else await admin.query("UPDATE bitpos.orders SET paid_at=created_at WHERE id=$1 AND status='PAID'",[o[k]]);}
 await admin.query("UPDATE bitpos.orders SET paid_at=created_at WHERE merchant_id='7e0d0c0e-0000-4000-8000-00000000f002' AND status='PAID'");
 await admin.end();console.log('retimed',Object.keys(at).length,'orders around Bangkok midnight');
}
/** One fresh unpaid counter bill (quotes expire within minutes, so the pay capture creates its own). */
async function fresh(){
 const f=JSON.parse(readFileSync(here+'.fixture.json','utf8'));const P=f.products as Record<string,string>;
 await tenant(MERCHANT,db=>db.query("UPDATE device_presence SET connection_generation=1,connection_id=$2,connected_until=clock_timestamp()+interval '3 hours' WHERE device_id=$1",[f.device.id,randomUUID()]));
 await tenant(MERCHANT,db=>db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,screen_generation=screen_generation+1 WHERE device_id=$1 AND kind='order'",[f.device.id]));
 const q=await tenant(MERCHANT,db=>counterQuote(db,MERCHANT,f.register.id,{items:[{productId:P['Latte'],qty:2},{productId:P['Butter croissant'],qty:1}],serving:{kind:'counter'}}));
 const o=await tenant(MERCHANT,db=>createRoutedOrder(db,MERCHANT,'register',f.register.id,{items:q.lines.map((l:{productId:string;qty:number})=>({productId:l.productId,qty:l.qty})),serving:{kind:'counter'},quoteId:q.id,priceVersion:q.priceVersion,idempotencyKey:randomUUID()}));
 await tenant(MERCHANT,db=>db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,screen_generation=screen_generation+1 WHERE device_id=$1",[f.device.id]));
 const made=JSON.parse(readFileSync(here+'.orders.json','utf8'));made.awaitingFresh=o.order.id;writeFileSync(here+'.orders.json',JSON.stringify(made,null,1));console.log('fresh awaiting bill',o.order.id.slice(0,8));
}
/** Staff-clear the seeded table through the real handler so a new guest can start a visit (one occupant at a time). */
async function cleartable(){
 const f=JSON.parse(readFileSync(here+'.fixture.json','utf8'));
 for(const d of [f.device,f.tableDevice])await tenant(MERCHANT,db=>db.query("UPDATE device_presence SET connection_generation=1,connection_id=$2,connected_until=clock_timestamp()+interval '3 hours' WHERE device_id=$1",[d.id,randomUUID()])); // table guests need a connected screen
 { // fixture only: settle left-over unpaid table bills (as if paid) so the table can be cleared
  const admin=new (await import('pg')).default.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
  await admin.query('SET search_path=bitpos,extensions,public');await admin.query("UPDATE bitpos.orders o SET status='PAID',paid_at=clock_timestamp(),version=version+1 FROM bitpos.order_authority a WHERE a.order_id=o.id AND a.serving_table_id=$1 AND o.status NOT IN ('PAID','EXPIRED')",[f.table.id]);
  await admin.query("UPDATE bitpos.device_screen_state SET kind='idle',order_id=NULL,session_id=NULL,lease_until=NULL,screen_generation=screen_generation+1 WHERE device_id=$1 AND kind='order'",[f.tableDevice.id]);await admin.end(); }
 const gen=(await tenant(MERCHANT,db=>db.query('SELECT occupancy_generation::text g FROM merchant_tables WHERE id=$1',[f.table.id]))).rows[0].g;
 const {clearTableOccupancy}=await import('../../../../../apps/api/src/table-occupancy');
 try{await tenant(MERCHANT,db=>clearTableOccupancy(db,MERCHANT,ACTOR,'owner',f.table.id,{expectedGeneration:gen,idempotencyKey:randomUUID(),confirmClear:true}));console.log("table cleared");}catch(e){console.log('table clear refused:',(e as Error).message);}
}
/** A second merchant with 230 paid orders created today (more than the 200 the orders list returns). */
async function bulk(){
 const BM='7e0d0c0e-0000-4000-8000-00000000f002',BU='7e0d0c0e-0000-4000-8000-0000000000b1';
 if((await pool.query('SELECT 1 FROM merchants WHERE id=$1',[BM])).rowCount){console.log('bulk merchant exists');return;}
 await pool.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Bulk Cafe (synthetic fixture)','11111111111111111111111111111111')",[BM]);
 await pool.query("INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,'owner')",[BU,BM]);
 const users=JSON.parse(readFileSync(here+'.users.json','utf8'));users['bulk@render.invalid']=BU;writeFileSync(here+'.users.json',JSON.stringify(users));
 const r=(path:string,method:string,input?:unknown)=>tenant(BM,db=>registry(db,BM,BU,'owner',path,method,input));
 const prod=(await tenant(BM,db=>createProduct(db,BM,BU,'owner',{name:'กาแฟ',nameEn:'Coffee',category:'Coffee',description:''}))).id;
 await tenant(BM,db=>db.query('UPDATE products SET stock=100000 WHERE id=$1',[prod]));
 await tenant(BM,db=>publishPrices(db,BM,BU,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'RENDER FIXTURE ONLY'},prices:[{productId:prod,unitMinor:'300'}],settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}}));
 const dev=await r('/api/devices','POST',{label:'Counter'});const reg2=await r('/api/registers','POST',{label:'R'});await r('/api/registers/'+reg2.id+'/pairing','PUT',{deviceId:dev.id,expectedPairingGeneration:'1'});
 await r('/api/devices/'+dev.id+'/credential','POST',{});await tenant(BM,db=>db.query("UPDATE device_presence SET connection_generation=1,connection_id=$2,connected_until=clock_timestamp()+interval '3 hours' WHERE device_id=$1",[dev.id,randomUUID()]));
 const ids:string[]=[];
 for(let i=0;i<230;i++){
  const q=await tenant(BM,db=>counterQuote(db,BM,reg2.id,{items:[{productId:prod,qty:1}],serving:{kind:'counter'}}));
  const o=await tenant(BM,db=>createRoutedOrder(db,BM,'register',reg2.id,{items:[{productId:prod,qty:1}],serving:{kind:'counter'},quoteId:q.id,priceVersion:q.priceVersion,idempotencyKey:randomUUID()}));
  await tenant(BM,db=>db.query("UPDATE orders SET status='PAID',paid_at=clock_timestamp(),payer='RenderPayer11111111111111111111111111111111',version=version+1 WHERE id=$1",[o.order.id]));
  await tenant(BM,db=>db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,screen_generation=screen_generation+1 WHERE device_id=$1",[dev.id]));ids.push(o.order.id);
 }
 const admin=new (await import('pg')).default.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();await admin.query('SET session_replication_role=replica');
 // 230 orders spread 00:00-14:50 Bangkok today (4 minutes apart), so the 30 oldest fall outside the newest-200 list.
 for(const [i,id] of ids.entries())await admin.query("UPDATE bitpos.orders SET created_at=(((now() AT TIME ZONE 'Asia/Bangkok')::date)::timestamp+($2||' minutes')::interval) AT TIME ZONE 'Asia/Bangkok' WHERE id=$1",[id,String(i*4)]);
 await admin.end();console.log('bulk merchant seeded with 230 paid orders');
}
if(process.argv[2]==='cleartable')await cleartable();else if(process.argv[2]==='fresh')await fresh();else if(process.argv[2]==='retime')await retime();else if(process.argv[2]==='bulk')await bulk();else if(process.argv[2]==='extras')await extras();else if(process.argv[2]==='users')await users();else if(process.argv[2]==='data')await data();else if(process.argv[2]==='orders')await orders();
await pool.end();
