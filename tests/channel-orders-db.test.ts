import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
// Needs a throwaway Postgres with migration 179 applied (see docs/ORDER_CHANNELS_PLAN_TH.md). Skipped otherwise.
// Provider traffic is a FAKE fetch: nothing here is evidence from Grab's sandbox.
const url=process.env.CHANNEL_TEST_DB,integration={skip:!url};
Object.assign(process.env,{DATABASE_URL:'postgres://x',ADMIN_DATABASE_URL:'postgres://x',AUTH_URL:'http://localhost:9',AUTH_ANON_KEY:'k',APP_SECRET:'a'.repeat(40),PUBLIC_URL:'http://localhost:3001',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/none',BITPOS_DEMO_QUICK_SIGNIN:'0'});
const {ingestGrabOrder,syncGrabOrders,grabOrderCommand,listChannelOrders}=await import('../apps/api/src/channels/grabfood-orders');
const {sealSecrets}=await import('../apps/api/src/channel-connections');
const M=randomUUID(),N=randomUUID(),STORE='STORE-1';
const PRODUCT=randomUUID();
const order=(id:string,over:Record<string,unknown>={})=>({orderID:id,shortOrderNumber:'A12',merchantID:STORE,paymentType:'GRABPAY',orderTime:'2026-10-31T03:00:00Z',currency:{code:'THB',symbol:'฿',exponent:2},
 items:[{id:PRODUCT,quantity:2,price:5500,tax:360,modifiers:[]},{id:'grab-only-item',quantity:1,price:3000}],price:{subtotal:14000,total:14000,eaterPayment:14000,merchantEarning:{netEarning:11000}},...over}) as never;
async function withDb(fn:(db:pg.PoolClient)=>Promise<void>){
 const c=new pg.Client({connectionString:url});await c.connect();
 try{await c.query('BEGIN');await c.query('SET LOCAL search_path=bitpos,public');
  for(const m of [M,N])await c.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Channel test',$2)",[m,'1'.repeat(32)]);
  await c.query("INSERT INTO products(merchant_id,id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'Test','Test','x',100,10)",[M,PRODUCT]);
  await c.query("INSERT INTO channel_connections(merchant_id,source,environment,state,external_store_id,client_id,secret_ciphertext,has_client_secret,updated_by) VALUES($1,'grabfood','sandbox','linked',$2,'cid',$3,true,'u')",[M,STORE,sealSecrets({clientSecret:'s',webhookSecret:''},M,'grabfood','sandbox')]);
  await fn(c as unknown as pg.PoolClient);}
 finally{await c.query('ROLLBACK');await c.end();}
}
const rows=async(db:pg.PoolClient,sql:string,a:unknown[]=[])=>(await db.query(sql,a)).rows;

test('ingest stores money as the provider stated it and maps lines by product id only',integration,()=>withDb(async db=>{
 const r=await ingestGrabOrder(db,M,'sandbox',STORE,order('o1'));assert.deepEqual(r,{inserted:true,duplicate:false,rejected:false});
 const [o]=await rows(db,"SELECT * FROM channel_orders WHERE external_order_id='o1'");
 assert.deepEqual([o.currency_code,o.currency_exponent,o.subtotal_minor,o.status,o.payment_collector,o.settlement_state],['THB',2,'14000','received','platform','receivable']);
 const lines=await rows(db,'SELECT external_item_id,mapped_product_id FROM channel_order_lines ORDER BY line_no');
 assert.deepEqual(lines.map(l=>[l.external_item_id,l.mapped_product_id]),[[PRODUCT,PRODUCT],['grab-only-item',null]]);
}));
test('cash orders are collected by the shop, not receivable from the platform',integration,()=>withDb(async db=>{
 await ingestGrabOrder(db,M,'sandbox',STORE,order('c1',{paymentType:'CASH'}));
 const [o]=await rows(db,"SELECT payment_collector,settlement_state FROM channel_orders WHERE external_order_id='c1'");assert.deepEqual([o.payment_collector,o.settlement_state],['cash_on_pickup','not_applicable']);
}));
test('a repeated poll is a no-op and out-of-order states never move an order back',integration,()=>withDb(async db=>{
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o2'));
 assert.equal((await ingestGrabOrder(db,M,'sandbox',STORE,order('o2'))).duplicate,true);
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o2',{orderState:'COMPLETED'}));
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o2',{orderState:'ACCEPTED'}));
 const [o]=await rows(db,"SELECT status,raw_status FROM channel_orders WHERE external_order_id='o2'");assert.equal(o.status,'completed');
 assert.equal((await rows(db,"SELECT count(*)::int n FROM channel_orders WHERE external_order_id='o2'"))[0].n,1);
 assert.equal((await rows(db,'SELECT count(*)::int n FROM channel_order_lines'))[0].n,2);
}));
test('orders for another store ID or with bad money are rejected, not stored',integration,()=>withDb(async db=>{
 assert.equal((await ingestGrabOrder(db,M,'sandbox',STORE,order('x1',{merchantID:'OTHER'}))).rejected,true);
 assert.equal((await ingestGrabOrder(db,M,'sandbox',STORE,order('x2',{currency:{code:'thb',exponent:2}}))).rejected,true);
 assert.equal((await ingestGrabOrder(db,M,'sandbox',STORE,order('x3',{price:{subtotal:1.5}}))).rejected,true);
 assert.equal((await rows(db,'SELECT count(*)::int n FROM channel_orders'))[0].n,0);
}));
test('the order snapshot is immutable',integration,()=>withDb(async db=>{
 await ingestGrabOrder(db,M,'sandbox',STORE,order('s1'));
 await assert.rejects(db.query("UPDATE channel_orders SET snapshot='{}'::jsonb WHERE external_order_id='s1'"),/immutable/);
}));
test('tenant isolation: another merchant sees nothing (RLS as the app role)',integration,()=>withDb(async db=>{
 await ingestGrabOrder(db,M,'sandbox',STORE,order('t1'));
 await db.query('SET LOCAL ROLE bitpos_app');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[N]);
 assert.equal((await rows(db,'SELECT count(*)::int n FROM channel_orders'))[0].n,0);
 await db.query("SELECT set_config('bitpos.merchant',$1,true)",[M]);
 assert.equal((await rows(db,'SELECT count(*)::int n FROM channel_orders'))[0].n,1);
}));

function fakeGrab(state:{ordersByCall?:unknown[];command?:number|'throw';calls:string[]}){
 return (async(url:string,init:{method:string;body?:string})=>{
  state.calls.push(init.method+' '+url.replace(/^https:\/\/[^/]+/,'')+(init.body&&!url.includes('oauth')?' '+init.body:''));
  const res=(status:number,body?:unknown)=>({status,headers:{get:()=>null},text:async()=>body===undefined?'':JSON.stringify(body)});
  if(url.includes('oauth2'))return res(200,{access_token:'t',expires_in:100000});
  if(url.includes('/partner/v1/orders?'))return res(200,{orders:state.ordersByCall??[],more:false});
  if(state.command==='throw')throw new Error('timeout');
  return res(state.command??200);
 }) as never;
}
test('accept → accepted; provider rejection reverts; unknown outcome stays pending and blocks a second command',integration,()=>withDb(async db=>{
 await ingestGrabOrder(db,M,'sandbox',STORE,order('k1'));
 const id=(await rows(db,"SELECT id FROM channel_orders WHERE external_order_id='k1'"))[0].id;
 const calls:string[]=[];
 let r=await grabOrderCommand(db,M,'u','staff',id,{command:'accept'},fakeGrab({command:400,calls}));assert.equal(r.outcome,'failed');
 assert.equal((await rows(db,'SELECT status,pending_command FROM channel_orders'))[0].status,'received');
 r=await grabOrderCommand(db,M,'u','staff',id,{command:'accept'},fakeGrab({command:'throw',calls}));assert.equal(r.outcome,'unknown');
 let o=(await rows(db,'SELECT status,pending_command FROM channel_orders'))[0];assert.deepEqual([o.status,o.pending_command],['accept_pending','accept']);
 await assert.rejects(grabOrderCommand(db,M,'u','staff',id,{command:'accept'},fakeGrab({calls})));
 // A later poll in which Grab shows ACCEPTED settles the pending command without re-sending anything.
 await ingestGrabOrder(db,M,'sandbox',STORE,order('k1',{orderState:'ACCEPTED'}));
 o=(await rows(db,'SELECT status,pending_command FROM channel_orders'))[0];assert.deepEqual([o.status,o.pending_command],['accepted',null]);
 r=await grabOrderCommand(db,M,'u','staff',id,{command:'ready'},fakeGrab({command:200,calls}));assert.equal(r.outcome,'done');
 assert.equal((await rows(db,'SELECT status FROM channel_orders'))[0].status,'ready');
 assert.ok(calls.some(c=>c.includes('/partner/v1/orders/mark')&&c.includes('"markStatus":1')));
 assert.equal(calls.filter(c=>c.includes('order/prepare')).length,2);
}));
test('commands need a staff-level role and a valid transition',integration,()=>withDb(async db=>{
 await ingestGrabOrder(db,M,'sandbox',STORE,order('r1'));
 const id=(await rows(db,'SELECT id FROM channel_orders'))[0].id;
 await assert.rejects(grabOrderCommand(db,M,'u','customer',id,{command:'accept'},fakeGrab({calls:[]})));
 await assert.rejects(grabOrderCommand(db,M,'u','staff',id,{command:'ready'},fakeGrab({calls:[]})));
 await assert.rejects(grabOrderCommand(db,N,'u','staff',id,{command:'accept'},fakeGrab({calls:[]})));
}));
test('sync inserts polled orders, is rate-limited, and the list never exposes secrets',integration,()=>withDb(async db=>{
 const calls:string[]=[];const now=new Date('2026-10-31T05:00:00Z');
 let s=await syncGrabOrders(db,M,'u','staff',fakeGrab({ordersByCall:[order('p1'),order('p2')],calls}),now);
 assert.deepEqual([s.inserted,s.skipped,s.result],[2,false,'ok']);
 assert.ok(calls.some(c=>c.includes('date=2026-10-31')));
 s=await syncGrabOrders(db,M,'u','staff',fakeGrab({ordersByCall:[order('p3')],calls}),new Date(now.getTime()+3000));assert.equal(s.skipped,true);
 await db.query("UPDATE channel_settings SET last_sync_at=last_sync_at-interval '1 minute'");
 s=await syncGrabOrders(db,M,'u','staff',fakeGrab({ordersByCall:[order('p1'),order('p3')],calls}),new Date(now.getTime()+20000));assert.deepEqual([s.inserted,s.updated],[1,0]);
 const l=await listChannelOrders(db,M,'staff','grabfood');
 assert.equal(l.orders.length,3);assert.ok(!JSON.stringify(l).includes('secret'));
 assert.equal(l.orders[0].currency.code,'THB');
 const other=await listChannelOrders(db,N,'staff','grabfood');assert.equal(other.orders.length,0);
}));
test('kitchen "preparing" is a local step: no provider call, only from accepted, and a later poll never moves it back',integration,()=>withDb(async db=>{
 await ingestGrabOrder(db,M,'sandbox',STORE,order('p1'));
 const id=(await rows(db,"SELECT id FROM channel_orders WHERE external_order_id='p1'"))[0].id;
 const calls:string[]=[];
 await assert.rejects(grabOrderCommand(db,M,'u','staff',id,{command:'preparing'},fakeGrab({calls})));
 await ingestGrabOrder(db,M,'sandbox',STORE,order('p1',{orderState:'ACCEPTED'}));
 await assert.rejects(grabOrderCommand(db,M,'u','customer',id,{command:'preparing'},fakeGrab({calls})));
 const r=await grabOrderCommand(db,M,'u','staff',id,{command:'preparing'},fakeGrab({calls}));
 assert.deepEqual([r.outcome,calls.length],['done',0]);
 assert.equal((await rows(db,'SELECT status FROM channel_orders'))[0].status,'preparing');
 await ingestGrabOrder(db,M,'sandbox',STORE,order('p1',{orderState:'ACCEPTED'}));
 assert.equal((await rows(db,'SELECT status FROM channel_orders'))[0].status,'preparing');
 await assert.rejects(grabOrderCommand(db,M,'u','staff',id,{command:'preparing'},fakeGrab({calls})));
 assert.equal((await grabOrderCommand(db,M,'u','staff',id,{command:'ready'},fakeGrab({command:200,calls}))).outcome,'done');
 assert.equal((await rows(db,"SELECT count(*)::int n FROM channel_events WHERE raw_status='local'"))[0].n,1);
}));
