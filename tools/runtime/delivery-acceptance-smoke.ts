import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',ADMIN_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
const {default:pg}=await import('pg');
const {pool,tenant}=await import('../../apps/api/src/db');
const {publishPrices}=await import('../../apps/api/src/catalog');
const {settleAttempt}=await import('../../apps/api/src/orders');
const {tickOnlineAcceptance}=await import('../../apps/worker/src/index');
const {staffToken}=await import('../../tests/backend-table-fixture');
const {fixturePaymentAttempt}=await import('../../tests/backend-payment-fixture');
const {MINT,TOKEN_PROGRAM}=await import('../../packages/domain/src/index');
const {MobileFoodOrderResultSchema,MobileFoodOrderSchema,MobileFoodEventsSchema}=await import('../../packages/contracts/src/mobile-v1.generated');
const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
const acceptanceApiBase=process.env.BITPOS_ACCEPTANCE_API_BASE??'http://127.0.0.1:3001';if(new URL(acceptanceApiBase).hostname!=='127.0.0.1')throw new Error('Acceptance smoke only permits loopback API hosts');
const merchant=randomUUID(),branch=randomUUID(),product=randomUUID(),actor='fa000000-0000-4000-8000-000000000010',token=randomBytes(32).toString('base64url');
let assertions=0;const ids:Record<string,string>={};
const check=(value:unknown,message:string)=>{assert.ok(value,message);assertions++;};
async function request(path:string,method='GET',body?:unknown,bearer?:string,expected=200){
 const response=await fetch(acceptanceApiBase+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(bearer?{Authorization:'Bearer '+bearer}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));assertions++;return value;
}
try{
 await pool.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Acceptance HTTP fixture','11111111111111111111111111111111')",[merchant]);
 await admin.query("INSERT INTO bitpos.marketplace_branches(merchant_id,id,name,name_en,enabled,pickup_enabled) VALUES($1,$2,'ทดสอบการปฏิเสธ','Acceptance HTTP fixture',true,true)",[merchant,branch]);
 let account=(await admin.query("SELECT id FROM bitpos.mobile_accounts WHERE auth_subject='fa000000-0000-4000-8000-000000000001'")).rows[0]?.id;
 if(!account){account=randomUUID();await admin.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject) VALUES($1,'fa000000-0000-4000-8000-000000000001')",[account]);}
 await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[account,randomUUID(),createHash('sha256').update(token).digest('hex'),createHash('sha256').update(randomBytes(32)).digest('hex')]);
 await tenant(merchant,async db=>{
  await db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'อาหารทดสอบการปฏิเสธ','Acceptance fixture food','',270,40)",[product,merchant]);
  await publishPrices(db,merchant,actor,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'LOCAL ACCEPTANCE FIXTURE ONLY'},prices:[{productId:product,unitMinor:'270'}],settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}});
 });
 const staff=await staffToken(pool,merchant,actor,'owner');
 async function order(name:string){
  const q=await request('/api/mobile/v1/food/quotes','POST',{branchId:branch,serving:'pickup',items:[{lineId:randomUUID(),productId:product,qty:1,optionVersion:null,selections:[],allergyNote:null}]},token);
  const result=MobileFoodOrderResultSchema.parse(await request('/api/mobile/v1/food/orders','POST',{branchId:branch,quoteId:q.id,priceVersion:q.priceVersion,idempotencyKey:randomUUID()},token));ids[name]=result.order.id;return result.order;
 }
 const decision=(id:string,body:unknown,status=200)=>request('/api/orders/'+id+'/acceptance','POST',body,staff,status);
 const snapshot=(id:string)=>request('/api/mobile/v1/food/orders/'+id,'GET',undefined,token).then(v=>MobileFoodOrderSchema.parse(v));
 const persisted=(id:string)=>tenant(merchant,async db=>({order:(await db.query('SELECT status,reservation_released,closure_reason FROM orders WHERE id=$1',[id])).rows[0],stock:(await db.query('SELECT stock,reserved FROM products WHERE id=$1',[product])).rows[0],refunds:(await db.query('SELECT status,amount_minor::text AS amount FROM refunds WHERE order_id=$1 ORDER BY id',[id])).rows,returns:(await db.query('SELECT count(*)::int AS n FROM online_stock_returns WHERE order_id=$1',[id])).rows[0].n,payments:(await db.query('SELECT state FROM payments WHERE order_id=$1 ORDER BY id',[id])).rows}));
 async function issued(id:string){return tenant(merchant,async db=>(await fixturePaymentAttempt(db,{merchant,order:id,status:'SUBMITTED',signature:'SQL-only-acceptance-'+randomUUID()})).rows[0]);}
 const unpaid=await order('unpaidRejected'),reject={status:'REJECTED',expectedVersion:0,idempotencyKey:randomUUID(),reason:'Fixture kitchen unavailable'};
 await request('/api/orders/'+unpaid.id+'/acceptance','POST',reject,token,401);
 await decision(unpaid.id,{...reject,reason:' '},422);
 const rejected=await decision(unpaid.id,reject);assert.deepEqual(await decision(unpaid.id,reject),rejected);assertions++;
 await decision(unpaid.id,{...reject,reason:'Changed reason'},409);
 let state=await persisted(unpaid.id);check(state.order.status==='EXPIRED'&&state.order.reservation_released&&state.stock.stock===40&&state.stock.reserved===0&&state.refunds.length===0,'unpaid rejection closes once without money/stock movement');
 const paid=await order('paidRejected'),paidAttempt=await issued(paid.id);await tenant(merchant,db=>settleAttempt(db,paidAttempt,true));
 check((await persisted(paid.id)).stock.stock===39,'ordinary received payment consumes one unit before rejection');
 await decision(paid.id,{...reject,idempotencyKey:randomUUID()});
 await Promise.all([tenant(merchant,db=>settleAttempt(db,paidAttempt,true)),tickOnlineAcceptance()]);
 state=await persisted(paid.id);check(state.order.status==='PAID'&&state.stock.stock===40&&state.returns===1&&state.refunds.length===1&&state.refunds[0].amount==='2700000'&&state.refunds[0].status==='REQUESTED','paid-first rejection preserves received payment, creates obligation and returns stock once');
 const paidView=await snapshot(paid.id);check(paidView.refunds[0].money.currency==='USDG'&&paidView.refunds[0].money.amountMinor==='2700000'&&paidView.acceptanceReason===reject.reason,'owned API projects canonical token refund obligation separately');
 const ambiguous=await order('ambiguousRejected'),attempt=await issued(ambiguous.id);
 await decision(ambiguous.id,{...reject,idempotencyKey:randomUUID()});
 state=await persisted(ambiguous.id);check(!state.order.reservation_released&&state.stock.reserved===1&&state.refunds.length===0,'issued unresolved payment retains reservation and does not invent received money');
 await Promise.all([tenant(merchant,db=>settleAttempt(db,attempt,true)),tenant(merchant,db=>settleAttempt(db,attempt,true))]);
 state=await persisted(ambiguous.id);check(state.order.status==='RECOVERY'&&state.order.reservation_released&&state.stock.stock===40&&state.stock.reserved===0&&state.returns===0&&state.refunds.length===1&&state.payments.length===1&&state.payments[0].state==='RECOVERY','rejection-first duplicate finalization is one recovery receipt/obligation without consuming or returning stock');
 const failed=await order('conclusiveFailure'),failedAttempt=await issued(failed.id);await tenant(merchant,db=>settleAttempt(db,failedAttempt,false));
 await decision(failed.id,{...reject,idempotencyKey:randomUUID()});
 await tenant(merchant,async db=>{await db.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE',[failed.id]);await db.query("UPDATE payment_attempts SET status='FAILED',failure_reconciled_at=clock_timestamp() WHERE id=$1",[failedAttempt.id]);});
 await tickOnlineAcceptance();state=await persisted(failed.id);check(state.order.status==='EXPIRED'&&state.order.reservation_released&&state.stock.reserved===0,'restart-capable lane closes terminal CONFIRMING only after conclusive failed proof');
 const race=await order('decisionRace');
 const raceResults=await Promise.all(['ACCEPTED','REJECTED'].map(async status=>{const response=await fetch(acceptanceApiBase+'/api/orders/'+race.id+'/acceptance',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+staff},body:JSON.stringify({status,expectedVersion:0,idempotencyKey:randomUUID(),...(status==='REJECTED'?{reason:'Race fixture'}:{preparationMinutes:23})})});return response.status;}));
 check(raceResults.filter(s=>s===200).length===1&&raceResults.filter(s=>s===409).length===1,'accept/reject concurrent commands have one winner');
 const due=await order('deadlineUnpaid'),duePaid=await order('deadlinePaid'),duePaidAttempt=await issued(duePaid.id);await tenant(merchant,db=>settleAttempt(db,duePaidAttempt,true));
 await sleep(Math.max(0,Date.parse(duePaid.acceptanceDeadline)-Date.now()+30));
 const capabilities=await tenant(merchant,async db=>(await db.query('SELECT access_token FROM orders WHERE id=$1',[due.id])).rows[0]);
 const refusal=await request('/api/pay/'+capabilities.access_token+'/challenge','POST',{address:'11111111111111111111111111111111'},undefined,409);check(refusal.error.code==='ACCEPTANCE_UNAVAILABLE','overdue pending blocks authorization before worker and before payment expiry');
 await Promise.all([tickOnlineAcceptance(),tickOnlineAcceptance()]);
 check((await snapshot(due.id)).acceptanceStatus==='TIMED_OUT','duplicate local deadline lane records timeout');
 state=await persisted(duePaid.id);check(state.order.status==='PAID'&&state.refunds.length===1&&state.returns===1,'paid deadline timeout creates one refund obligation and one stock return');
 assert.deepEqual(await decision(unpaid.id,reject),rejected);assertions++;
 const timeline=MobileFoodEventsSchema.parse(await request('/api/mobile/v1/food/orders/'+duePaid.id+'/events','GET',undefined,token));
 check(timeline.events.filter(e=>e.kind==='ACCEPTANCE').length===1&&timeline.events.filter(e=>e.kind==='REFUND').length===1,'durable timeline has one decision and one separate refund event');
 check(BigInt(timeline.order.eventSequence)===BigInt(timeline.events.at(-1)!.sequence),'snapshot freshness includes refund event sequence');
 const zeroDevices=await tenant(merchant,async db=>(await db.query('SELECT (SELECT count(*) FROM devices)::int AS devices,(SELECT count(*) FROM outbox_events)::int AS effects')).rows[0]);check(zeroDevices.devices===0&&zeroDevices.effects===0,'online negative decisions never target Mini');
 const receipt={environment:'local_disposable_fixture',assertions,merchantId:merchant,branchId:branch,productId:product,orderIds:ids,paidTimeout:state,timelineKinds:timeline.events.map(e=>e.kind),limits:['Direct isolated fixture sessions, not OTP/provider evidence','SQL-only synthetic verifier seam; no chain transfer or real refund','HTTP/persisted state; current AVD/merchant-browser join pending','Builder publication and terminal issued-byte recovery race not yet covered by this lever'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-acceptance-http.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}catch(error){await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-acceptance-http-failure.json',JSON.stringify({merchantId:merchant,orderIds:ids,assertions,error:String(error),physicalTesting:'deferred_by_user_2026-10-16'},null,2)+'\n');throw error;}
finally{await admin.end();await pool.end();}
