import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',ADMIN_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets',BITPOS_MOBILE_ENABLED:'1'});
const {default:pg}=await import('pg');const {pool,tenant}=await import('../../apps/api/src/db');const {server}=await import('../../apps/api/src/index');
const {decideOnlineOrder}=await import('../../apps/api/src/mobile-food');const {settleAttempt,orderView}=await import('../../apps/api/src/orders');const {fixturePaymentAttempt}=await import('../../tests/backend-payment-fixture');
const {MobileFoodOrderSchema,MobileFoodRefundsSchema,MobileFoodEventsSchema}=await import('../../packages/contracts/src/mobile-v1.generated');
const fixture=JSON.parse(await readFile('.omp/work/flutter-delivery-20261016/evidence/p1-configured-food.json','utf8'));assert.equal(fixture.environment,'local_disposable_fixture');
const merchant=fixture.merchantId as string,admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port+'/api/mobile/v1/';
const passed:string[]=[];const check=(name:string,fn:()=>void)=>{fn();passed.push(name);};
async function session(account:string){const token=randomBytes(32).toString('base64url');await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[account,randomUUID(),createHash('sha256').update(token).digest('hex'),createHash('sha256').update(randomBytes(32)).digest('hex')]);return token;}
async function request(path:string,token:string,method='GET',body?:unknown){const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
try{
 const owner=(await admin.query('SELECT account_id FROM bitpos.online_food_orders WHERE merchant_id=$1 AND order_id=$2',[merchant,fixture.orderId])).rows[0].account_id;
 const foreign=(await admin.query('SELECT id FROM bitpos.mobile_accounts WHERE id<>$1 ORDER BY id LIMIT 1',[owner])).rows[0].id;
 const token=await session(owner),other=await session(foreign);
 const options=(await admin.query('SELECT active_version_id FROM bitpos.product_online_options WHERE merchant_id=$1 AND product_id=$2',[merchant,fixture.productId])).rows[0].active_version_id;
 const quoted=await request('food/quotes',token,'POST',{branchId:fixture.branchId,serving:'pickup',items:[{lineId:randomUUID(),productId:fixture.productId,qty:1,optionVersion:options,selections:[],allergyNote:null}]});assert.equal(quoted.status,200,JSON.stringify(quoted.body));
 const created=await request('food/orders',token,'POST',{branchId:fixture.branchId,quoteId:quoted.body.id,priceVersion:quoted.body.priceVersion,idempotencyKey:randomUUID()});assert.equal(created.status,200,JSON.stringify(created.body));const id=created.body.order.id;
 await tenant(merchant,db=>decideOnlineOrder(db,merchant,randomUUID(),'owner',id,{status:'REJECTED',expectedVersion:0,idempotencyKey:randomUUID(),reason:'SQL-only refund paging fixture'}));
 // SQL-only verifier seam: no RPC, signed transaction, provider or transfer.
 const delayed=await pool.connect();await delayed.query('BEGIN');await delayed.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);
 for(let n=0;n<31;n++)await tenant(merchant,async db=>{const attempt=(await fixturePaymentAttempt(db,{merchant,order:id,status:'SUBMITTED',signature:'SQL-only-refund-pages-'+randomUUID()})).rows[0];await settleAttempt(db,attempt,true);});
 const persisted=(await admin.query('SELECT id FROM bitpos.refunds WHERE merchant_id=$1 AND order_id=$2 ORDER BY created_at,id',[merchant,id])).rows.map(r=>r.id);
 check('Thirty-one distinct receipt-backed obligations persisted without transfer',()=>{assert.equal(persisted.length,31);assert.equal(new Set(persisted).size,31);});
 const detailResult=await request('food/orders/'+id,token);assert.equal(detailResult.status,200);const detail=MobileFoodOrderSchema.parse(detailResult.body);
 check('Order snapshot contains first30 and explicit continuation',()=>{assert.deepEqual(detail.refunds.map(r=>r.id),persisted.slice(0,30));assert.equal(detail.nextRefundCursor,persisted[29]);});
 const firstResult=await request('food/orders/'+id+'/refunds',token);assert.equal(firstResult.status,200);const first=MobileFoodRefundsSchema.parse(firstResult.body);
 const lastResult=await request('food/orders/'+id+'/refunds?cursor='+first.nextCursor+'&generation='+first.generation,token);assert.equal(lastResult.status,200);const last=MobileFoodRefundsSchema.parse(lastResult.body);
 check('All refund pages preserve every ID exactly once',()=>{assert.deepEqual([...first.refunds,...last.refunds].map(r=>r.id),persisted);assert.equal(last.nextCursor,null);});
 const merchantView=await tenant(merchant,async db=>orderView(db,(await db.query('SELECT * FROM orders WHERE id=$1',[id])).rows[0]));check('Shared merchant detail retains complete history',()=>assert.deepEqual(merchantView.onlineAcceptance!.refunds.map(r=>r.id),persisted));
 const eventsResult=await request('food/orders/'+id+'/events',token);assert.equal(eventsResult.status,200);const events=MobileFoodEventsSchema.parse(eventsResult.body);check('Timeline snapshot is equally bounded and complete via continuation',()=>{assert.equal(events.order.refunds.length,30);assert.equal(events.order.nextRefundCursor,persisted[29]);});
 for(const [name,path,bearer,status] of [
  ['Wrong account cannot list refund obligations','food/orders/'+id+'/refunds',other,404],
  ['Unknown order not exposed','food/orders/'+randomUUID()+'/refunds',token,404],
  ['Foreign or unknown cursor cannot select another order','food/orders/'+id+'/refunds?cursor='+randomUUID()+'&generation='+first.generation,token,404],
  ['Malformed cursor rejected','food/orders/'+id+'/refunds?cursor=bad',token,422],
  ['Duplicate cursor rejected','food/orders/'+id+'/refunds?cursor='+persisted[0]+'&cursor='+persisted[1],token,422],
 ] as const){const result=await request(path,bearer);check(name,()=>assert.equal(result.status,status,JSON.stringify(result.body)));}
 let delayedRefund:string;
 try{const attempt=(await fixturePaymentAttempt(delayed,{merchant,order:id,status:'SUBMITTED',signature:'SQL-only-delayed-refund-'+randomUUID()})).rows[0];await settleAttempt(delayed,attempt,true);delayedRefund=(await delayed.query('SELECT id FROM refunds WHERE merchant_id=$1 AND order_id=$2 AND payment_id IN (SELECT id FROM payments WHERE merchant_id=$1 AND order_id=$2 AND attempt_id=$3)',[merchant,id,attempt.id])).rows[0].id;await delayed.query('COMMIT');}finally{await delayed.query('ROLLBACK');delayed.release();}
 const oldPredicate=(await admin.query('SELECT r.id FROM bitpos.refunds r WHERE merchant_id=$1 AND order_id=$2 AND (created_at,id)>(SELECT created_at,id FROM bitpos.refunds WHERE merchant_id=$1 AND order_id=$2 AND id=$3) ORDER BY created_at,id',[merchant,id,first.nextCursor])).rows.map(r=>r.id);
 check('Reproduced old cursor predicate misses committed delayed-transaction liability',()=>{assert.equal(oldPredicate.includes(delayedRefund),false);assert.equal([...first.refunds.map(r=>r.id),...oldPredicate].includes(delayedRefund),false);});
 const stale=await request('food/orders/'+id+'/refunds?cursor='+first.nextCursor+'&generation='+first.generation,token);check('Changed generation rejects stale continuation instead of hiding liability',()=>{assert.equal(stale.status,409);assert.equal(stale.body.error.code,'REFUND_PAGE_CHANGED');});
 const recovered:string[]=[];let next:string|null=null,generation:string|undefined;
 do{const result=await request('food/orders/'+id+'/refunds'+(next===null?'':'?cursor='+next+'&generation='+generation),token);assert.equal(result.status,200);const page=MobileFoodRefundsSchema.parse(result.body);recovered.push(...page.refunds.map(r=>r.id));next=page.nextCursor;generation=page.generation;}while(next!==null);
 check('First-page recovery reaches all32 obligations including delayed insert',()=>{assert.equal(recovered.length,32);assert.equal(new Set(recovered).size,32);assert.ok(recovered.includes(delayedRefund));assert.deepEqual(new Set(recovered),new Set([...persisted,delayedRefund]));});
 const receipt={environment:'local_disposable_fixture',merchantId:merchant,orderId:id,assertions:passed.length,passed,refundIds:persisted,physicalTesting:'deferred_by_user_2026-10-16',limits:['SQL-only successful verifier seam produced real persisted refund obligations; no chain proof/provider execution/transfer','No actual-use migration or deployment']};await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-refund-pages.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}catch(error){await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-refund-pages-failure-'+Date.now()+'.json',JSON.stringify({passed,error:String(error)},null,2)+'\n');throw error;}
finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await admin.end();await pool.end();}
