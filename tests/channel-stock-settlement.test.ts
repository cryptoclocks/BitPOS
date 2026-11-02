import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
// Needs a throwaway Postgres with migrations 179, 181 and 182 applied (CHANNEL_TEST_DB). Skipped otherwise. Provider data is fixture data only.
const url=process.env.CHANNEL_TEST_DB,integration={skip:!url};
Object.assign(process.env,{DATABASE_URL:'postgres://x',ADMIN_DATABASE_URL:'postgres://x',AUTH_URL:'http://localhost:9',AUTH_ANON_KEY:'k',APP_SECRET:'a'.repeat(40),PUBLIC_URL:'http://localhost:3001',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/none',BITPOS_DEMO_QUICK_SIGNIN:'0'});
const {ingestGrabOrder,listChannelOrders}=await import('../apps/api/src/channels/grabfood-orders');
const {saveItemMap}=await import('../apps/api/src/channels/item-map');
const {settleChannelOrder}=await import('../apps/api/src/channels/settlement');
const {applyChannelStock}=await import('../apps/api/src/channels/stock');
const M=randomUUID(),STORE='STORE-1',P1=randomUUID(),P2=randomUUID();
const order=(id:string,items:{id:string;quantity:number;price:number}[],over:Record<string,unknown>={})=>({orderID:id,shortOrderNumber:'A1',merchantID:STORE,paymentType:'GRABPAY',orderTime:'2026-10-31T03:00:00Z',currency:{code:'THB',symbol:'฿',exponent:2},
 items,price:{subtotal:1000,total:1000,eaterPayment:1000,merchantEarning:{netEarning:800}},...over}) as never;
async function withDb(fn:(db:pg.PoolClient)=>Promise<void>,stock=10){
 const c=new pg.Client({connectionString:url});await c.connect();
 try{await c.query('BEGIN');await c.query('SET LOCAL search_path=bitpos,public');
  await c.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Channel test',$2)",[M,'1'.repeat(32)]);
  for(const p of [P1,P2])await c.query("INSERT INTO products(merchant_id,id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'Test','Test','x',100,$3)",[M,p,stock]);
  await saveItemMap(c as unknown as pg.PoolClient,M,'u','owner',{source:'grabfood',externalItemId:'g-latte',productId:P1});
  await fn(c as unknown as pg.PoolClient);}
 finally{await c.query('ROLLBACK');await c.end();}
}
const rows=async(db:pg.PoolClient,sql:string,a:unknown[]=[])=>(await db.query(sql,a)).rows;
const stockOf=async(db:pg.PoolClient,p=P1)=>(await rows(db,'SELECT stock FROM products WHERE id=$1',[p]))[0].stock as number;
const ledger=(db:pg.PoolClient)=>rows(db,"SELECT kind,delta,stock_before,stock_after,idempotency_key FROM stock_movements WHERE kind='CHANNEL_SALE' ORDER BY idempotency_key");

test('a received order takes no stock; acceptance takes it once, through the ledger',integration,()=>withDb(async db=>{
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o1',[{id:'g-latte',quantity:3,price:5500}]));
 assert.equal(await stockOf(db),10);assert.equal((await ledger(db)).length,0);
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o1',[{id:'g-latte',quantity:3,price:5500}],{orderState:'ACCEPTED'}));
 assert.equal(await stockOf(db),7);
 const l=await ledger(db);assert.equal(l.length,1);assert.deepEqual([l[0].delta,l[0].stock_before,l[0].stock_after],[-3,10,7]);
 // duplicate poll, later states and direct re-application never take it again
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o1',[{id:'g-latte',quantity:3,price:5500}],{orderState:'ACCEPTED'}));
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o1',[{id:'g-latte',quantity:3,price:5500}],{orderState:'COMPLETED'}));
 const id=(await rows(db,'SELECT id FROM channel_orders'))[0].id;
 assert.equal(await applyChannelStock(db,M,id),0);
 assert.equal(await stockOf(db),7);assert.equal((await ledger(db)).length,1);
}));
test('an order that first appears already accepted takes stock on arrival',integration,()=>withDb(async db=>{
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o2',[{id:'g-latte',quantity:2,price:100}],{orderState:'ACCEPTED'}));
 assert.equal(await stockOf(db),8);
}));
test('rejected and cancelled-before-accept orders never take stock',integration,()=>withDb(async db=>{
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o3',[{id:'g-latte',quantity:2,price:100}]));
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o3',[{id:'g-latte',quantity:2,price:100}],{orderState:'CANCELLED'}));
 assert.equal(await stockOf(db),10);assert.equal((await ledger(db)).length,0);
}));
test('unmapped lines are skipped, then take stock once the owner maps them',integration,()=>withDb(async db=>{
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o4',[{id:'g-latte',quantity:1,price:100},{id:'g-tea',quantity:4,price:100}],{orderState:'ACCEPTED'}));
 assert.equal(await stockOf(db),9);assert.equal(await stockOf(db,P2),10);
 await saveItemMap(db,M,'u','manager',{source:'grabfood',externalItemId:'g-tea',productId:P2});
 assert.equal(await stockOf(db,P2),6);
 // choosing again (or another product) does not take it a second time
 await saveItemMap(db,M,'u','manager',{source:'grabfood',externalItemId:'g-tea',productId:P2});
 assert.equal(await stockOf(db,P2),6);assert.equal((await ledger(db)).length,2);
}));
test('a short shelf takes only what exists and the gap is visible',integration,()=>withDb(async db=>{
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o5',[{id:'g-latte',quantity:5,price:100}],{orderState:'ACCEPTED'}));
 assert.equal(await stockOf(db),0);
 const l=await listChannelOrders(db,M,'staff','grabfood');
 assert.deepEqual(l.orders[0].lines[0].stock,{requested:5,applied:2});
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o6',[{id:'g-latte',quantity:2,price:100}],{orderState:'ACCEPTED'}));
 const s=(await rows(db,'SELECT qty_requested,qty_applied,movement_id FROM channel_stock_effects ORDER BY qty_requested DESC'));
 assert.deepEqual(s.map(x=>[x.qty_requested,x.qty_applied,x.movement_id===null]),[[5,2,false],[2,0,true]]);
},2));
test('stock never goes below reserved units',integration,()=>withDb(async db=>{
 await db.query('UPDATE products SET reserved=4 WHERE id=$1',[P1]);
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o7',[{id:'g-latte',quantity:9,price:100}],{orderState:'ACCEPTED'}));
 assert.equal(await stockOf(db),4);
}));
test('stock effects and the ledger are append-only for the app role',integration,()=>withDb(async db=>{
 await ingestGrabOrder(db,M,'sandbox',STORE,order('o8',[{id:'g-latte',quantity:1,price:100}],{orderState:'ACCEPTED'}));
 await db.query('SET LOCAL ROLE bitpos_app');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[M]);
 await db.query('SAVEPOINT a');await assert.rejects(db.query('UPDATE channel_stock_effects SET qty_applied=0'),/permission denied/);await db.query('ROLLBACK TO a');
 await assert.rejects(db.query('DELETE FROM channel_stock_effects'),/permission denied/);await db.query('ROLLBACK TO a');
 await assert.rejects(db.query("DELETE FROM stock_movements WHERE kind='CHANNEL_SALE'"),/permission denied/);await db.query('ROLLBACK TO a');
 assert.equal((await rows(db,'SELECT count(*)::int n FROM channel_stock_effects'))[0].n,1);
}));

const done=async(db:pg.PoolClient,ext:string,over:Record<string,unknown>={})=>{await ingestGrabOrder(db,M,'sandbox',STORE,order(ext,[{id:'g-latte',quantity:1,price:100}],{orderState:'COMPLETED',...over}));return (await rows(db,'SELECT id FROM channel_orders WHERE external_order_id=$1',[ext]))[0].id as string;};
test('settlement is the owner/manager bookkeeping on finished platform-paid orders only',integration,()=>withDb(async db=>{
 const id=await done(db,'s1');
 let l=await listChannelOrders(db,M,'staff','grabfood');
 assert.deepEqual(l.receivable,[{currency:{code:'THB',decimals:2},orders:1,netEarningMinor:'800',ordersWithoutNet:0}]);
 await assert.rejects(settleChannelOrder(db,M,'u','staff',id,{to:'settled'}));
 await assert.rejects(settleChannelOrder(db,M,'u','owner',id,{to:'settled',extra:1}));
 await assert.rejects(settleChannelOrder(db,M,'u','owner',id,{to:'not_applicable'}));
 assert.equal((await settleChannelOrder(db,M,'owner-1','owner',id,{to:'settled',note:'matched Oct payout'})).settlementState,'settled');
 assert.equal((await settleChannelOrder(db,M,'owner-1','owner',id,{to:'settled'})).replayed,true);
 l=await listChannelOrders(db,M,'staff','grabfood');assert.deepEqual(l.receivable,[]);
 const ev=await rows(db,"SELECT payload FROM channel_events WHERE raw_status='settlement'");
 assert.equal(ev.length,1);assert.deepEqual([ev[0].payload.from,ev[0].payload.to,ev[0].payload.by],['receivable','settled','owner-1']);
 await settleChannelOrder(db,M,'u','manager',id,{to:'disputed'});
 assert.equal((await rows(db,'SELECT settlement_state s FROM channel_orders WHERE id=$1',[id]))[0].s,'disputed');
}));
test('cash on pickup and unfinished orders cannot be settled',integration,()=>withDb(async db=>{
 const cash=await done(db,'s2',{paymentType:'CASH'});
 await assert.rejects(settleChannelOrder(db,M,'u','owner',cash,{to:'settled'}),/SETTLEMENT_NOT_READY/);
 await ingestGrabOrder(db,M,'sandbox',STORE,order('s3',[{id:'g-latte',quantity:1,price:100}],{orderState:'ACCEPTED'}));
 const open=(await rows(db,"SELECT id FROM channel_orders WHERE external_order_id='s3'"))[0].id;
 await assert.rejects(settleChannelOrder(db,M,'u','owner',open,{to:'settled'}),/SETTLEMENT_NOT_READY/);
 await assert.rejects(settleChannelOrder(db,M,'u','owner',randomUUID(),{to:'settled'}));
 assert.deepEqual((await listChannelOrders(db,M,'staff','grabfood')).receivable,[]);
}));
test('receivable totals are kept per currency and flag orders without a net amount',integration,()=>withDb(async db=>{
 await done(db,'s4');
 await done(db,'s5',{currency:{code:'USD',symbol:'$',exponent:2},price:{subtotal:500,total:500,eaterPayment:500}});
 const r=(await listChannelOrders(db,M,'owner','grabfood')).receivable;
 assert.deepEqual(r.map((x:any)=>[x.currency.code,x.orders,x.netEarningMinor,x.ordersWithoutNet]),[['THB',1,'800',0],['USD',1,'0',1]]);
}));

test('ingest, stock, item map and settlement all work as the app database role under row-level security',integration,()=>withDb(async db=>{
 await db.query('SET LOCAL ROLE bitpos_app');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[M]);
 await ingestGrabOrder(db,M,'sandbox',STORE,order('app1',[{id:'g-latte',quantity:2,price:100},{id:'g-new',quantity:1,price:100}],{orderState:'ACCEPTED'}));
 assert.equal(await stockOf(db),8);
 await saveItemMap(db,M,'u','owner',{source:'grabfood',externalItemId:'g-new',productId:P2});
 assert.equal(await stockOf(db,P2),9);
 const id=await done(db,'app2');
 assert.equal((await settleChannelOrder(db,M,'o','owner',id,{to:'settled'})).settlementState,'settled');
 assert.equal((await listChannelOrders(db,M,'staff','grabfood')).orders.length,2);
}));

// Real concurrency: two connections commit for real (cleaned up afterwards), so the row locks and unique keys are what is tested.
test('two simultaneous polls of the same accepted order take stock exactly once',integration,async()=>{
 const m=randomUUID(),p=randomUUID(),admin=new pg.Client({connectionString:url});await admin.connect();
 const open=async()=>{const c=new pg.Client({connectionString:url});await c.connect();await c.query('SET search_path=bitpos,public');return c;};
 try{
  await admin.query('SET search_path=bitpos,public');
  await admin.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Race test',$2)",[m,'1'.repeat(32)]);
  await admin.query("INSERT INTO products(merchant_id,id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'T','T','x',100,10)",[m,p]);
  await admin.query("INSERT INTO channel_item_map(merchant_id,source,external_item_id,product_id) VALUES($1,'grabfood','g-latte',$2)",[m,p]);
  const seed=await open();await seed.query('BEGIN');await ingestGrabOrder(seed as never,m,'sandbox',STORE,order('race',[{id:'g-latte',quantity:3,price:100}]));await seed.query('COMMIT');await seed.end();
  const run=async()=>{const c=await open();try{await c.query('BEGIN');await ingestGrabOrder(c as never,m,'sandbox',STORE,order('race',[{id:'g-latte',quantity:3,price:100}],{orderState:'ACCEPTED'}));await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{await c.end();}};
  const results=await Promise.allSettled([run(),run()]);
  assert.ok(results.some(r=>r.status==='fulfilled'),'at least one poll must succeed');
  assert.equal((await admin.query('SELECT stock FROM products WHERE id=$1',[p])).rows[0].stock,7);
  assert.equal((await admin.query("SELECT count(*)::int n FROM stock_movements WHERE merchant_id=$1 AND kind='CHANNEL_SALE'",[m])).rows[0].n,1);
 }finally{
  // immutable ledger rows cannot be deleted by design; remove the whole test tenant with triggers disabled for this session only
  await admin.query("SET session_replication_role=replica");
  for(const t of ['channel_stock_effects','stock_movements','channel_events','channel_order_lines','channel_orders','channel_item_map','products'])await admin.query(`DELETE FROM ${t} WHERE merchant_id=$1`,[m]);
  await admin.query('DELETE FROM merchants WHERE id=$1',[m]);await admin.end();
 }
});
