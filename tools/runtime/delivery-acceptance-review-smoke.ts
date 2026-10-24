import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',ADMIN_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
const {default:pg}=await import('pg');
const {pool,tenant}=await import('../../apps/api/src/db');
const {decideOnlineOrder}=await import('../../apps/api/src/mobile-food');
const {errorView}=await import('../../apps/api/src/authority');
const fixture=JSON.parse(await readFile('.omp/work/flutter-delivery-20261016/evidence/p1-acceptance-http.json','utf8'));
assert.equal(fixture.environment,'local_disposable_fixture');
const merchant=fixture.merchantId as string,after=process.argv.includes('--after');
const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
let assertions=0;
try {
 const original=await tenant(merchant,async db=>(await db.query('SELECT * FROM refunds WHERE order_id=$1',[fixture.orderIds.paidRejected])).rows[0]);assert.ok(original);
 let deleteBlocked=false,deleted=0;
 try {await tenant(merchant,async db=>{deleted=(await db.query('DELETE FROM refunds WHERE id=$1 RETURNING id',[original.id])).rowCount??0;throw new Error('fixture rollback');});}
 catch(error){deleteBlocked=(error as {code?:string}).code==='23514'||(error as {code?:string}).code==='42501';}
 assert.equal(deleteBlocked,after);assert.equal(deleted,after?0:1);assertions++;
 const retained=await tenant(merchant,async db=>(await db.query('SELECT * FROM refunds WHERE id=$1',[original.id])).rows[0]);assert.deepEqual(retained,original);assertions++;
 const account=(await admin.query("SELECT id FROM bitpos.mobile_accounts WHERE auth_subject='fa000000-0000-4000-8000-000000000001'")).rows[0].id;
 const token=randomBytes(32).toString('base64url');
 await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[account,randomUUID(),createHash('sha256').update(token).digest('hex'),createHash('sha256').update(randomBytes(32)).digest('hex')]);
 async function post(path:string,body:unknown){const response=await fetch('http://127.0.0.1:3001'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;}
 const quote=await post('/api/mobile/v1/food/quotes',{branchId:fixture.branchId,serving:'pickup',items:[{lineId:randomUUID(),productId:fixture.productId,qty:1,optionVersion:null,selections:[],allergyNote:null}]});
 const created=await post('/api/mobile/v1/food/orders',{branchId:fixture.branchId,quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:randomUUID()});
 const id=created.order.id;
 const state=()=>tenant(merchant,async db=>({lifecycle:(await db.query('SELECT acceptance_status,acceptance_version,decision_reason,event_sequence::text FROM online_food_orders WHERE order_id=$1',[id])).rows[0],order:(await db.query('SELECT status,version,reservation_released FROM orders WHERE id=$1',[id])).rows[0],stock:(await db.query('SELECT stock,reserved FROM products WHERE id=$1',[fixture.productId])).rows[0],journals:(await db.query('SELECT count(*)::int AS n FROM online_acceptance_requests WHERE order_id=$1',[id])).rows[0].n,refunds:(await db.query('SELECT count(*)::int AS n FROM refunds WHERE order_id=$1',[id])).rows[0].n}));
 const before=await state();let crossed=false,response;
 try {await tenant(merchant,async db=>{
  const delayed=new Proxy(db,{get(target,key){if(key==='query')return async(...args:unknown[])=>{if(typeof args[0]==='string'&&args[0].startsWith('UPDATE online_food_orders SET acceptance_status=')){crossed=true;await delay(Math.max(0,Date.parse(created.order.acceptanceDeadline)-Date.now()+40));}return (target.query as Function).apply(target,args);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  return decideOnlineOrder(delayed,merchant,'fa000000-0000-4000-8000-000000000010','owner',id,{status:'REJECTED',expectedVersion:0,idempotencyKey:randomUUID(),reason:'Controlled check-update deadline fixture'});
 });}catch(error){response=errorView(error);}
 assert.equal(crossed,true);assertions++;
 assert.equal(response?.status,after?409:500);assert.equal(response?.code,after?'ACCEPTANCE_UNAVAILABLE':'INTERNAL_ERROR');assertions++;
 assert.deepEqual(await state(),before);assertions++;
 const receipt={environment:'local_disposable_fixture',mode:after?'after':'before',assertions,merchantId:merchant,deadlineOrderId:id,refundId:original.id,deleteBlocked,deletedInRolledBackTransaction:deleted,deadlineResponse:{status:response!.status,code:response!.code},stateUnchanged:true,limits:['Controlled in-process pg query delay against actual immutable deadline; same API error mapper, not network-injected HTTP delay','Deletion baseline always rolled back; no real funds or provider calls'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-acceptance-review-'+(after?'after':'before')+'.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await admin.end();await pool.end();}
