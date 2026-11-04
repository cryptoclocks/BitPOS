import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
// M12: the read-only channel reconciliation and the provider-readiness list. Needs a throwaway Postgres with migrations through 182 (CHANNEL_TEST_DB);
// every test runs in a rolled-back transaction. Provider traffic is never involved: orders are fed to the real ingest function as plain objects.
const url=process.env.CHANNEL_TEST_DB,integration={skip:!url};
Object.assign(process.env,{DATABASE_URL:'postgres://x',ADMIN_DATABASE_URL:'postgres://x',AUTH_URL:'http://localhost:9',AUTH_ANON_KEY:'k',APP_SECRET:'a'.repeat(40),PUBLIC_URL:'http://localhost:3001',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/none',BITPOS_DEMO_QUICK_SIGNIN:'0'});
const {ingestGrabOrder}=await import('../apps/api/src/channels/grabfood-orders');
const {channelReconciliation,channelProviders,providers}=await import('../apps/api/src/channels/reconciliation');
const M=randomUUID(),N=randomUUID(),STORE='STORE-1',PRODUCT=randomUUID();
const order=(id:string,over:Record<string,unknown>={})=>({orderID:id,shortOrderNumber:id.slice(-3),merchantID:STORE,paymentType:'GRABPAY',orderTime:'2026-10-31T03:00:00Z',currency:{code:'THB',symbol:'฿',exponent:2},
 items:[{id:PRODUCT,quantity:2,price:5500,tax:0,modifiers:[]},{id:'grab-only-item',quantity:1,price:3000}],price:{subtotal:14000,total:14000,eaterPayment:14000,merchantEarning:{netEarning:11000}},...over}) as never;
async function withDb(fn:(db:pg.PoolClient)=>Promise<void>){
 const c=new pg.Client({connectionString:url});await c.connect();
 try{await c.query('BEGIN');await c.query('SET LOCAL search_path=bitpos,public');
  for(const m of [M,N])await c.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Recon test',$2)",[m,'1'.repeat(32)]);
  await c.query("INSERT INTO products(merchant_id,id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'Test','Test','x',100,10)",[M,PRODUCT]);
  await c.query("INSERT INTO channel_connections(merchant_id,source,environment,state,external_store_id,client_id,has_client_secret,updated_by) VALUES($1,'grabfood','sandbox','linked',$2,'cid',true,'u')",[M,STORE]);
  await fn(c as unknown as pg.PoolClient);}
 finally{await c.query('ROLLBACK');await c.end();}
}
const recon=(db:pg.PoolClient,over:{merchant?:string;role?:string;source?:unknown}={})=>channelReconciliation(db,over.merchant??M,over.role??'owner','source' in over?over.source:'grabfood');
const codes=(r:{issues:{code:string}[]})=>r.issues.map(i=>i.code).sort();
const one=(r:Awaited<ReturnType<typeof recon>>,code:string)=>r.issues.find(i=>i.code===code)!;

test('an empty channel is clean; access is owner/manager only; bad source refused; another shop and the other provider see nothing',integration,()=>withDb(async db=>{
 const r=await recon(db);assert.deepEqual([r.clean,r.issues,r.statusCounts,r.events,r.linked,r.environment],[true,[],{},{total:0,poll:0,command:0},true,'sandbox']);
 await ingestGrabOrder(db,M,'sandbox',STORE,order('A01'));
 for(const role of ['staff','nobody'])await assert.rejects(recon(db,{role}),(e:any)=>e.status===403);
 for(const source of [undefined,null,'',"grabfood' OR 1=1",'wongnai'])await assert.rejects(recon(db,{source}),(e:any)=>e.status===422,String(source));
 assert.deepEqual((await recon(db,{merchant:N})).statusCounts,{});
 assert.deepEqual((await recon(db,{source:'lineman'})).statusCounts,{});
 assert.deepEqual((await recon(db)).statusCounts,{received:1});
}));

test('unmapped items on an accepted order, short shelf, and stock already taken for a cancelled order are named with the order and the fact',integration,()=>withDb(async db=>{
 // not accepted yet: nothing to reconcile even though one item is unmapped
 await ingestGrabOrder(db,M,'sandbox',STORE,order('B01'));
 assert.deepEqual(codes(await recon(db)),[]);
 // accepted: the mapped line takes stock, the unmapped item is reported with its partner-side id
 await ingestGrabOrder(db,M,'sandbox',STORE,order('B01',{orderState:'ACCEPTED'}));
 let r=await recon(db);assert.deepEqual(codes(r),['UNMAPPED_LINES']);
 assert.deepEqual([one(r,'UNMAPPED_LINES').count,one(r,'UNMAPPED_LINES').sample[0]!.detail,one(r,'UNMAPPED_LINES').sample[0]!.externalOrderId],[1,'grab-only-item','B01']);
 assert.equal((await db.query('SELECT stock FROM products WHERE id=$1',[PRODUCT])).rows[0].stock,8);
 // a second accepted order wants more than is on the shelf (8 left, wants 15): the gap is reported
 await ingestGrabOrder(db,M,'sandbox',STORE,order('B02',{orderState:'ACCEPTED',items:[{id:PRODUCT,quantity:15,price:100,tax:0}],price:{subtotal:1500,total:1500,eaterPayment:1500,merchantEarning:{netEarning:1200}}}));
 r=await recon(db);assert.deepEqual(codes(r),['STOCK_SHORT','UNMAPPED_LINES']);assert.deepEqual([one(r,'STOCK_SHORT').count,one(r,'STOCK_SHORT').sample[0]!.detail],[1,'7']);
 // the provider then cancels B01: stock was taken and is not returned automatically — information, not an error
 await ingestGrabOrder(db,M,'sandbox',STORE,order('B01',{orderState:'CANCELLED'}));
 r=await recon(db);assert.deepEqual(codes(r),['CANCELLED_STOCK_TAKEN','STOCK_SHORT']);assert.deepEqual([one(r,'CANCELLED_STOCK_TAKEN').severity,one(r,'CANCELLED_STOCK_TAKEN').sample[0]!.detail],['info','2']);
 assert.equal(r.clean,false,'a short shelf still needs a person');
 assert.deepEqual(r.statusCounts,{accepted:1,cancelled:1});assert.ok(r.events.poll>=3);
}));

test('stock not yet applied, unknown payout, stuck commands and failed/stale syncs are flagged; fresh pending commands and info-only issues are not errors',integration,()=>withDb(async db=>{
 // committed order whose stock effect never happened (status set directly, as a stalled sync would leave it)
 await ingestGrabOrder(db,M,'sandbox',STORE,order('C01'));
 await db.query("UPDATE channel_orders SET status='accepted' WHERE external_order_id='C01'");
 // finished platform-collected order without a payout figure
 await ingestGrabOrder(db,M,'sandbox',STORE,order('C02',{orderState:'COMPLETED',items:[{id:'x-only',quantity:1,price:100}],price:{subtotal:100,total:100,eaterPayment:100}}));
 // one command stuck for 20 minutes, one pending only a moment
 await ingestGrabOrder(db,M,'sandbox',STORE,order('C03',{items:[{id:'y-only',quantity:1,price:100}],price:{subtotal:100,total:100}}));
 await ingestGrabOrder(db,M,'sandbox',STORE,order('C04',{items:[{id:'z-only',quantity:1,price:100}],price:{subtotal:100,total:100}}));
 await db.query("UPDATE channel_orders SET pending_command='accept',last_command_error='GRAB_TIMEOUT',updated_at=clock_timestamp()-interval '20 minutes' WHERE external_order_id='C03'");
 await db.query("UPDATE channel_orders SET pending_command='accept',updated_at=clock_timestamp() WHERE external_order_id='C04'");
 let r=await recon(db);
 assert.deepEqual(codes(r),['NET_UNKNOWN','PENDING_COMMAND','STOCK_NOT_APPLIED','UNMAPPED_LINES']);
 assert.deepEqual(one(r,'PENDING_COMMAND').sample.map(s=>[s.externalOrderId,s.detail]),[['C03','accept:GRAB_TIMEOUT']],'only the stuck one');
 assert.deepEqual([one(r,'NET_UNKNOWN').count,one(r,'NET_UNKNOWN').sample[0]!.detail],[1,'THB']);
 assert.equal(one(r,'STOCK_NOT_APPLIED').sample[0]!.externalOrderId,'C01');
 // a failed sync is an error; an old successful one is only information
 await db.query("INSERT INTO channel_settings(merchant_id,source,active_environment,last_sync_at,last_sync_result,updated_by) VALUES($1,'grabfood','sandbox',clock_timestamp()-interval '5 minutes','GRAB_UNKNOWN_ERROR','u')",[M]);
 r=await recon(db);assert.deepEqual([one(r,'SYNC_FAILED').severity,one(r,'SYNC_FAILED').sample[0]!.detail,r.sync.lastResult,r.sync.ageMinutes],['attention','GRAB_UNKNOWN_ERROR','GRAB_UNKNOWN_ERROR',5]);
 await db.query("UPDATE channel_settings SET last_sync_result='ok',last_sync_at=clock_timestamp()-interval '3 hours' WHERE merchant_id=$1",[M]);
 r=await recon(db);assert.ok(!codes(r).includes('SYNC_FAILED'));assert.deepEqual([one(r,'SYNC_STALE').severity,r.sync.ageMinutes],['info',180]);
 // only information left → the channel counts as clean
 await db.query("UPDATE channel_orders SET pending_command=NULL WHERE external_order_id='C03'");
}));

test('the sample is capped at 20 while the count is exact; everything is scoped to this shop and this provider',integration,()=>withDb(async db=>{
 for(let i=0;i<25;i++)await ingestGrabOrder(db,M,'sandbox',STORE,order('D'+String(i).padStart(2,'0'),{orderState:'ACCEPTED'}));
 const r=await recon(db);const u=one(r,'UNMAPPED_LINES');assert.deepEqual([u.count,u.sample.length,new Set(u.sample.map(s=>s.id)).size],[25,20,20]);
 // the same order ids in another shop (no connection there) never leak
 await db.query("INSERT INTO channel_orders(merchant_id,source,environment,external_order_id,external_store_id,status,payment_collector,settlement_state,currency_code,currency_exponent,subtotal_minor,order_time,snapshot) VALUES($1,'lineman','sandbox','L1','s','needs_attention','platform','receivable','THB',2,1,now(),'{}')",[M]);
 assert.deepEqual(codes(await recon(db,{source:'lineman'})),['NEEDS_ATTENTION']);
 assert.equal(one(await recon(db),'UNMAPPED_LINES').count,25,'lineman rows are not mixed into grabfood');
 assert.deepEqual((await recon(db,{merchant:N})).issues,[]);
}));

test('providers: each outside channel states what it is waiting for; no mock is offered; staff cannot read it',integration,()=>withDb(async()=>{
 const p=channelProviders('manager').providers;assert.equal(p,providers);
 const by=Object.fromEntries(p.map(x=>[x.id,x]));
 assert.deepEqual([by.grabfood.state,by.grabfood.needs],['adapter_unverified','live_sandbox_check']);
 assert.deepEqual([by.lineman.state,by.lineman.needs],['credentials_only','official_api_access']);
 for(const id of ['wongnai','pos_pay','promptpay','stripe'])assert.equal(by[id].state,'blocked_external',id);
 assert.ok(!p.some(x=>/mock|fake|test/i.test(x.id)));
 assert.throws(()=>channelProviders('staff'),(e:any)=>e.status===403);
}));

test('only information-level findings leave the channel clean; the cancelled order is still listed',integration,()=>withDb(async db=>{
 const one=order('E01',{orderState:'ACCEPTED',items:[{id:PRODUCT,quantity:1,price:5500,tax:0}],price:{subtotal:5500,total:5500,eaterPayment:5500,merchantEarning:{netEarning:4000}}});
 await ingestGrabOrder(db,M,'sandbox',STORE,one);
 assert.deepEqual([(await recon(db)).clean,codes(await recon(db))],[true,[]]);
 await ingestGrabOrder(db,M,'sandbox',STORE,order('E01',{orderState:'CANCELLED',items:[{id:PRODUCT,quantity:1,price:5500,tax:0}],price:{subtotal:5500,total:5500,eaterPayment:5500,merchantEarning:{netEarning:4000}}}));
 const r=await recon(db);assert.deepEqual([r.clean,codes(r),r.issues[0]!.severity],[true,['CANCELLED_STOCK_TAKEN'],'info']);
}));
