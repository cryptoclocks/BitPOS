import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',ADMIN_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
const {default:pg}=await import('pg');
const {pool,tenant}=await import('../../apps/api/src/db');
const {publishPrices}=await import('../../apps/api/src/catalog');
const {settleAttempt}=await import('../../apps/api/src/orders');
const {staffToken}=await import('../../tests/backend-table-fixture');
const {fixturePaymentAttempt}=await import('../../tests/backend-payment-fixture');
const {MINT,TOKEN_PROGRAM}=await import('../../packages/domain/src/index');
const {MobileFoodQuoteSchema,MobileFoodOrderResultSchema,MobileFoodEventsSchema,MobileMenuSchema,MobileBranchesSchema}=await import('../../packages/contracts/src/mobile-v1.generated');
const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
const merchant=randomUUID(),other=randomUUID(),branch=randomUUID(),hidden=randomUUID(),pickupDisabled=randomUUID(),product=randomUUID(),actor=randomUUID();
let assertions=0;const check=(value:unknown,message:string)=>{assert.ok(value,message);assertions++;};
async function request(path:string,method='GET',body?:unknown,token?:string,expected=200){
 const response=await fetch('http://127.0.0.1:3001'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));assertions++;return value;
}
try{
 await pool.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Food HTTP fixture','11111111111111111111111111111111'),($2,'Foreign food fixture','11111111111111111111111111111111')",[merchant,other]);
 await admin.query("INSERT INTO bitpos.marketplace_branches(merchant_id,id,name,name_en,enabled,pickup_enabled) VALUES($1,$2,'ร้านทดสอบ','Food HTTP fixture',true,true),($1,$3,'Hidden fixture','Hidden fixture',false,true),($4,$5,'Pickup disabled fixture','Pickup disabled fixture',true,false)",[merchant,branch,hidden,other,pickupDisabled]);
 await tenant(merchant,async db=>{
  await db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'อาหารทดสอบ','Fixture food','',270,2)",[product,merchant]);
  await publishPrices(db,merchant,actor,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'LOCAL HTTP FIXTURE ONLY'},prices:[{productId:product,unitMinor:'270'}],settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}});
 });
 const first=await request('/api/mobile/v1/auth/verify','POST',{phone:'+66900000001',code:'123456',deviceId:randomUUID()});
 const second=await request('/api/mobile/v1/auth/verify','POST',{phone:'+66900000002',code:'123456',deviceId:randomUUID()});
 check(first.accountId!==second.accountId,'provider fixtures are separate account subjects');
 const removedActor=randomUUID(),staff=await staffToken(pool,merchant,actor,'staff'),foreign=await staffToken(pool,other,randomUUID(),'owner'),removedMember=await staffToken(pool,merchant,removedActor,'staff');
 await pool.query('DELETE FROM members WHERE merchant_id=$1 AND user_id=$2',[merchant,removedActor]);
 let cursor:string|null=null,found=false;
 do{const page=MobileBranchesSchema.parse(await request('/api/mobile/v1/branches'+(cursor?'?cursor='+cursor:'')));check(!page.branches.some(b=>b.id===hidden),'disabled branch is not discoverable');found ||= page.branches.some(b=>b.id===branch);cursor=page.nextCursor;}while(cursor);
 check(found,'enabled fixture branch is discoverable');
 await request('/api/mobile/v1/branches/'+hidden+'/menu','GET',undefined,undefined,404);
 const menu=MobileMenuSchema.parse(await request('/api/mobile/v1/branches/'+branch+'/menu'));check(menu.branch.merchantId===merchant&&menu.products[0].id===product&&menu.products[0].unitPrice?.amountMinor==='270','public menu uses canonical merchant catalog');
 const draft={branchId:branch,serving:'pickup',items:[{lineId:randomUUID(),productId:product,qty:1,optionVersion:null,selections:[],allergyNote:null}]};
 await request('/api/mobile/v1/food/quotes','POST',draft,undefined,401);
 await request('/api/mobile/v1/food/quotes','POST',{...draft,accountId:second.accountId},first.accessToken,422);
 await request('/api/mobile/v1/food/quotes','POST',{...draft,items:[{...draft.items[0],unitMinor:'1'}]},first.accessToken,422);
 await request('/api/mobile/v1/food/quotes','POST',{...draft,branchId:pickupDisabled},first.accessToken,409);
 const quote=MobileFoodQuoteSchema.parse(await request('/api/mobile/v1/food/quotes','POST',draft,first.accessToken));
 check(quote.total.amountMinor==='270'&&quote.settlement.money.amountMinor==='2700000'&&quote.fees.amountMinor==='0'&&quote.tax.amountMinor==='0','catalog and token amounts are distinct integer minor units');
 const command={branchId:branch,quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:randomUUID()};
 await request('/api/mobile/v1/food/orders','POST',command,second.accessToken,404);
 const duplicate=await Promise.all([request('/api/mobile/v1/food/orders','POST',command,first.accessToken),request('/api/mobile/v1/food/orders','POST',command,first.accessToken)]);
 const a=MobileFoodOrderResultSchema.parse(duplicate[0]),b=MobileFoodOrderResultSchema.parse(duplicate[1]),order=a.order;
 check(a.order.id===b.order.id&&a.replayed!==b.replayed,'double tap creates one order and one replay');
 await request('/api/mobile/v1/food/orders/'+order.id,'GET',undefined,second.accessToken,404);
 await request('/api/mobile/v1/food/orders/'+order.id+'/events','GET',undefined,second.accessToken,404);
 await request('/api/orders/'+order.id+'/acceptance','POST',{status:'ACCEPTED',expectedVersion:0,idempotencyKey:randomUUID(),preparationMinutes:23},first.accessToken,401);
 await request('/api/orders/'+order.id+'/acceptance','POST',{status:'ACCEPTED',expectedVersion:0,idempotencyKey:randomUUID(),preparationMinutes:23},foreign,404);
 await request('/api/orders/'+order.id+'/acceptance','POST',{status:'ACCEPTED',expectedVersion:0,idempotencyKey:randomUUID(),preparationMinutes:23},removedMember,401);
 await request('/api/orders/'+order.id+'/fulfillment','POST',{status:'PREPARING',expectedVersion:0,idempotencyKey:randomUUID()},staff,409);
 const acceptance={status:'ACCEPTED',expectedVersion:0,idempotencyKey:randomUUID(),preparationMinutes:23};
 const accepted=await request('/api/orders/'+order.id+'/acceptance','POST',acceptance,staff);
 assert.deepEqual(await request('/api/orders/'+order.id+'/acceptance','POST',acceptance,staff),accepted);assertions++;
 await request('/api/orders/'+order.id+'/acceptance','POST',{...acceptance,expectedVersion:1},staff,409);
 // Two live quotes compete for the final unit under canonical product locks.
 const lastQuotes=await Promise.all([request('/api/mobile/v1/food/quotes','POST',draft,second.accessToken),request('/api/mobile/v1/food/quotes','POST',draft,second.accessToken)]);
 const outcomes=await Promise.all(lastQuotes.map(async q=>{
  const response=await fetch('http://127.0.0.1:3001/api/mobile/v1/food/orders',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+second.accessToken},body:JSON.stringify({branchId:branch,quoteId:q.id,priceVersion:q.priceVersion,idempotencyKey:randomUUID()})});return {status:response.status,value:await response.json()};
 }));
 check(outcomes.filter(r=>r.status===200).length===1&&outcomes.filter(r=>r.status===409&&r.value.error.code==='STOCK_UNAVAILABLE').length===1,'last-stock concurrency has exactly one winner');
 const last=MobileFoodOrderResultSchema.parse(outcomes.find(r=>r.status===200)!.value).order;
 async function syntheticSettle(id:string){
  const attempt=await tenant(merchant,async db=>(await fixturePaymentAttempt(db,{merchant,order:id,status:'SUBMITTED',signature:'SQL-only-HTTP-fixture-'+randomUUID()})).rows[0]);assert.ok(attempt);
  await Promise.all([tenant(merchant,db=>settleAttempt(db,attempt,true)),tenant(merchant,db=>settleAttempt(db,attempt,true))]);
 }
 await syntheticSettle(last.id);
 const refusal=await request('/api/orders/'+last.id+'/fulfillment','POST',{status:'PREPARING',expectedVersion:0,idempotencyKey:randomUUID()},staff,409);check(refusal.error.code==='MERCHANT_ACCEPTANCE_REQUIRED','payment does not replace merchant acceptance');
 await syntheticSettle(order.id);
 for(const [version,status] of ['PREPARING','READY','COLLECTED'].entries()){
  const result=await request('/api/orders/'+order.id+'/fulfillment','POST',{status,expectedVersion:version,idempotencyKey:randomUUID()},staff);check(result.fulfillment.status===status&&result.fulfillment.target===null&&result.fulfillment.notification===null,'device-free kitchen transition '+status);
  const snapshot=await request('/api/mobile/v1/food/orders/'+order.id,'GET',undefined,first.accessToken);check(snapshot.fulfillmentStatus===status,'customer observes persisted kitchen '+status);
 }
 await request('/api/orders/'+order.id+'/notification/retry','POST',{expectedVersion:3,idempotencyKey:randomUUID(),targetDeviceId:randomUUID(),assignmentGeneration:'1',confirmTarget:true},staff,422);
 const timeline=MobileFoodEventsSchema.parse(await request('/api/mobile/v1/food/orders/'+order.id+'/events','GET',undefined,first.accessToken));
 check(timeline.order.fulfillmentStatus==='COLLECTED'&&timeline.events.some(e=>e.kind==='ACCEPTANCE')&&timeline.events.some(e=>e.paymentStatus==='PAID')&&timeline.events.at(-1)?.fulfillmentStatus==='COLLECTED','durable timeline joins separate payment/acceptance/kitchen states');
 check(timeline.events.every((e,i)=>e.sequence===String(i+1)),'timeline cursor is contiguous per order');
 const recovered=MobileFoodEventsSchema.parse(await request('/api/mobile/v1/food/orders/'+order.id+'/events?cursor='+timeline.events[1].sequence,'GET',undefined,first.accessToken));
 assert.deepEqual(recovered.events,timeline.events.slice(2));assertions++;
 const history=await request('/api/mobile/v1/food/orders','GET',undefined,first.accessToken);check(history.orders.some((o:{id:string})=>o.id===order.id)&&!history.orders.some((o:{id:string})=>o.id===last.id),'global history remains account-owned');
 // Response-loss replay remains valid after quote lease expiry; do not rewrite
 // immutable quote evidence to shortcut the actual wall-clock boundary.
 await sleep(Math.max(0,Date.parse(quote.validUntil)-Date.now()+20));
 const replay=MobileFoodOrderResultSchema.parse(await request('/api/mobile/v1/food/orders','POST',command,first.accessToken));check(replay.replayed&&replay.order.id===order.id,'committed order replays after quote expiry');
 const persisted=await tenant(merchant,async db=>({stock:(await db.query('SELECT stock,reserved FROM products WHERE id=$1',[product])).rows[0],orders:(await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n,links:(await db.query('SELECT count(*)::int AS n FROM mobile_customer_links')).rows[0].n,payments:(await db.query('SELECT count(*)::int AS n FROM payments')).rows[0].n,devices:(await db.query('SELECT count(*)::int AS n FROM devices')).rows[0].n,notices:(await db.query('SELECT count(*)::int AS n FROM pickup_notifications')).rows[0].n,deviceEvents:(await db.query('SELECT count(*)::int AS n FROM outbox_events')).rows[0].n}));
 assert.deepEqual(persisted,{stock:{stock:0,reserved:0},orders:2,links:2,payments:2,devices:0,notices:0,deviceEvents:0});assertions++;
 const receipt={environment:'local_disposable_fixture',assertions,merchantId:merchant,branchId:branch,orderId:order.id,productId:product,persisted,timelineKinds:timeline.events.map(e=>e.kind),limits:['OTP loopback provider fixtures; no SMS','Payment uses SQL-only synthetic verifier seam, not chain/provider proof','HTTP/persisted state only; joined AVD/merchant-web ordering not yet exercised','Merchant rejection/timeouts/refunds and device push not completed'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-food-http-smoke.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await admin.end();await pool.end();}
