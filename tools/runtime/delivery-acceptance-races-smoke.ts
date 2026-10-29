import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',ADMIN_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
const {default:pg}=await import('pg');
const {pool,tenant}=await import('../../apps/api/src/db');
const {settleAttempt}=await import('../../apps/api/src/orders');
const {decideOnlineOrder,reconcileOnlineAcceptance}=await import('../../apps/api/src/mobile-food');
const {fixturePaymentAttempt}=await import('../../tests/backend-payment-fixture');
const {staffToken}=await import('../../tests/backend-table-fixture');
const fixture=JSON.parse(await readFile('.omp/work/flutter-delivery-20261016/evidence/p1-acceptance-http.json','utf8'));assert.equal(fixture.environment,'local_disposable_fixture');
const acceptanceApiBase=process.env.BITPOS_ACCEPTANCE_API_BASE??'http://127.0.0.1:3001';if(new URL(acceptanceApiBase).hostname!=='127.0.0.1')throw new Error('Acceptance smoke only permits loopback API hosts');
const merchant=fixture.merchantId as string,actor='fa000000-0000-4000-8000-000000000010',token=randomBytes(32).toString('base64url');
const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
let assertions=0;const results:unknown[]=[];
try {
 const account=(await admin.query("SELECT id FROM bitpos.mobile_accounts WHERE auth_subject='fa000000-0000-4000-8000-000000000001'")).rows[0].id;
 await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[account,randomUUID(),createHash('sha256').update(token).digest('hex'),createHash('sha256').update(randomBytes(32)).digest('hex')]);
 async function post(path:string,body:unknown,bearer=token,status=200){const response=await fetch(acceptanceApiBase+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+bearer},body:JSON.stringify(body)});const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));assertions++;return value;}
 async function create(){const quote=await post('/api/mobile/v1/food/quotes',{branchId:fixture.branchId,serving:'pickup',items:[{lineId:randomUUID(),productId:fixture.productId,qty:1,optionVersion:null,selections:[],allergyNote:null}]});return (await post('/api/mobile/v1/food/orders',{branchId:fixture.branchId,quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:randomUUID()})).order;}
 const cases=[];
 for(const decision of ['REJECTED','TIMED_OUT'] as const)for(const winner of ['settlement','decision'] as const){const order=await create();const attempt=await tenant(merchant,async db=>(await fixturePaymentAttempt(db,{merchant,order:order.id,status:'SUBMITTED',signature:'SQL-only-lock-race-'+randomUUID()})).rows[0]);cases.push({decision,winner,order,attempt});}
 const reject=(id:string)=>({status:'REJECTED',expectedVersion:0,idempotencyKey:randomUUID(),reason:'Controlled order-lock fixture'});
 const other=randomUUID(),revokedActor=randomUUID();await pool.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Wrong tenant acceptance fixture','11111111111111111111111111111111')",[other]);
 const foreign=await staffToken(pool,other,randomUUID(),'owner');await post('/api/orders/'+cases[0].order.id+'/acceptance',reject(cases[0].order.id),foreign,404);
 const revoked=await staffToken(pool,merchant,revokedActor,'staff');await pool.query('DELETE FROM members WHERE user_id=$1 AND merchant_id=$2',[revokedActor,merchant]);await post('/api/orders/'+cases[0].order.id+'/acceptance',reject(cases[0].order.id),revoked,401);
 for(const item of cases){
  const {order,attempt,decision,winner}=item;
  const first=await pool.connect(),second=await pool.connect();
  try {
   for(const db of [first,second]){await db.query('BEGIN');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);await db.query("SET LOCAL statement_timeout='180s'");}
   const stockBefore=(await first.query('SELECT stock FROM products WHERE id=$1',[fixture.productId])).rows[0].stock;
   const decide=(db:typeof first)=>decision==='REJECTED'?decideOnlineOrder(db,merchant,actor,'owner',order.id,reject(order.id)):reconcileOnlineAcceptance(db,merchant,order.id);
   // Settlement-first timeout really settles before the immutable deadline, then
   // retains the root lock until the due worker is waiting. No timestamp rewriting.
   if(winner==='settlement')await settleAttempt(first,attempt,true);
   else {if(decision==='TIMED_OUT')await delay(Math.max(0,Date.parse(order.acceptanceDeadline)-Date.now()+30));await decide(first);}
   const pid=(await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   const pending=winner==='settlement'?decide(second):settleAttempt(second,attempt,true);void pending.catch(()=>{});
   let blocked=false;for(let n=0;n<100&&!blocked;n++){blocked=(await first.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[pid])).rows[0].blocked;if(!blocked)await first.query('SELECT pg_sleep(0.01)');}
   assert.equal(blocked,true);assertions++;
   if(decision==='TIMED_OUT'&&winner==='settlement')await delay(Math.max(0,Date.parse(order.acceptanceDeadline)-Date.now()+30));
   await first.query('COMMIT');await pending;await second.query('COMMIT');
   const state=await tenant(merchant,async db=>({payment:(await db.query('SELECT state FROM payments WHERE order_id=$1',[order.id])).rows,refunds:(await db.query('SELECT status,amount_minor::text AS amount,beneficiary,asset_descriptor->>\'assetId\' AS asset FROM refunds WHERE order_id=$1',[order.id])).rows,returns:(await db.query('SELECT count(*)::int AS n FROM online_stock_returns WHERE order_id=$1',[order.id])).rows[0].n,stock:(await db.query('SELECT stock FROM products WHERE id=$1',[fixture.productId])).rows[0].stock,decision:(await db.query('SELECT acceptance_status FROM online_food_orders WHERE order_id=$1',[order.id])).rows[0].acceptance_status}));
   assert.deepEqual(state.payment,[{state:winner==='settlement'?'SETTLED':'RECOVERY'}]);assert.deepEqual(state.refunds,[{status:'REQUESTED',amount:'2700000',beneficiary:'SQL-only-fixture-payer',asset:'usdg-devnet'}]);assert.equal(state.returns,winner==='settlement'?1:0);assert.equal(state.stock,stockBefore);assert.equal(state.decision,decision);assertions+=5;
   results.push({orderId:order.id,decision,winner,blocked,state});
  }finally{await first.query('ROLLBACK');await second.query('ROLLBACK');first.release();second.release();}
 }
 const paid=cases[0].order.id;
 const secondAttempt=await tenant(merchant,async db=>(await fixturePaymentAttempt(db,{merchant,order:paid,status:'SUBMITTED',signature:'SQL-only-extra-receipt-'+randomUUID()})).rows[0]);
 await Promise.all([tenant(merchant,db=>settleAttempt(db,secondAttempt,true)),tenant(merchant,db=>settleAttempt(db,secondAttempt,true))]);
 const multiple=await tenant(merchant,async db=>({payments:(await db.query('SELECT state FROM payments WHERE order_id=$1 ORDER BY state',[paid])).rows,refunds:(await db.query('SELECT amount_minor::text AS amount FROM refunds WHERE order_id=$1',[paid])).rows,returns:(await db.query('SELECT count(*)::int AS n FROM online_stock_returns WHERE order_id=$1',[paid])).rows[0].n,events:(await db.query("SELECT count(*)::int AS n FROM mobile_order_events WHERE order_id=$1 AND kind='REFUND'",[paid])).rows[0].n}));
 assert.deepEqual(multiple,{payments:[{state:'RECOVERY'},{state:'SETTLED'}],refunds:[{amount:'2700000'},{amount:'2700000'}],returns:1,events:2});assertions++;
 const original=await tenant(merchant,async db=>(await db.query('SELECT * FROM refunds WHERE order_id=$1 ORDER BY id LIMIT 1',[paid])).rows[0]);
 for(const change of ['id=gen_random_uuid()','amount_minor=amount_minor+1',"beneficiary='wrong fixture beneficiary'","asset_descriptor=asset_descriptor||'{\"mint\":\"wrong fixture mint\"}'::jsonb"]){await assert.rejects(tenant(merchant,db=>db.query('UPDATE refunds SET '+change+' WHERE id=$1',[original.id])),/immutable refund obligation/);assertions++;}
 assert.deepEqual(await tenant(merchant,async db=>(await db.query('SELECT * FROM refunds WHERE id=$1',[original.id])).rows[0]),original);assertions++;
 const receipt={environment:'local_disposable_fixture',assertions,merchantId:merchant,results,multiple,limits:['Actual PostgreSQL root-lock waits and canonical decision/finalization functions; SQL-only synthetic verifier receipts, no chain or transfer','HTTP wrong tenant and revoked membership exercised; no real providers','Builder publication still requires separate proof'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-acceptance-lock-races.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}catch(error){await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-acceptance-lock-races-failure.json',JSON.stringify({assertions,results,error:String(error)},null,2)+'\n');throw error;}
finally{await admin.end();await pool.end();}
