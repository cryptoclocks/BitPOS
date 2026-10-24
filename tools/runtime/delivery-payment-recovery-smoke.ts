import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {Keypair,Transaction} from '@solana/web3.js';
// Fixed disposable loopback identities only. No dotenv, private wallet files,
// RPC calls, broadcaster, worker or actual-use database is involved.
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',ADMIN_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
const {default:pg}=await import('pg');
const {pool,tenant}=await import('../../apps/api/src/db');
const {publishPrices}=await import('../../apps/api/src/catalog');
const {frozenAttempt}=await import('../../apps/api/src/payment-assets');
const {paymentInstructions,validateSigned}=await import('../../apps/api/src/payments');
const {settleAttempt}=await import('../../apps/api/src/orders');
const {MINT,TOKEN_PROGRAM}=await import('../../packages/domain/src/index');
const {MobileFoodQuoteSchema,MobileFoodOrderResultSchema}=await import('../../packages/contracts/src/mobile-v1.generated');
const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
const acceptanceApiBase=process.env.BITPOS_ACCEPTANCE_API_BASE??'http://127.0.0.1:3001';if(new URL(acceptanceApiBase).hostname!=='127.0.0.1')throw new Error('Payment recovery smoke only permits loopback API hosts');
const acceptance = process.argv.includes('--acceptance');
const merchant=randomUUID(),account=randomUUID(),branch=randomUUID(),product=randomUUID(),actor=randomUUID();
const bearer=randomBytes(32).toString('base64url');
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
let assertions=0;
const check=(value:unknown,message:string)=>{assert.ok(value,message);assertions++;};
async function post(path:string,body:unknown,authenticated=false){
 const response=await fetch(acceptanceApiBase+path,{method:'POST',headers:{'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer '+bearer}:{})},body:JSON.stringify(body)});
 return {status:response.status,value:await response.json()};
}
try{
 await pool.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'SIGNED RECOVERY LOCAL FIXTURE - no chain','11111111111111111111111111111111')",[merchant]);
 await admin.query('INSERT INTO bitpos.mobile_accounts(id,auth_subject) VALUES($1,$2)',[account,randomUUID()]);
 await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[account,randomUUID(),digest(bearer),digest(randomBytes(32).toString('base64url'))]);
 await admin.query("INSERT INTO bitpos.marketplace_branches(merchant_id,id,name,name_en,enabled,pickup_enabled) VALUES($1,$2,'ทดสอบกู้คืน','Recovery fixture',true,true)",[merchant,branch]);
 await tenant(merchant,async db=>{
  await db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'อาหารทดสอบ','Fixture food','',270,4)",[product,merchant]);
  await publishPrices(db,merchant,actor,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'LOCAL SIGNED-BYTES FIXTURE ONLY'},prices:[{productId:product,unitMinor:'270'}],settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}});
 });
 async function prepare(){
  const q=await post('/api/mobile/v1/food/quotes',{branchId:branch,serving:'pickup',items:[{lineId:randomUUID(),productId:product,qty:1,optionVersion:null,selections:[],allergyNote:null}]},true);assert.equal(q.status,200);
  const quote=MobileFoodQuoteSchema.parse(q.value);
  const created=await post('/api/mobile/v1/food/orders',{branchId:branch,quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:randomUUID()},true);assert.equal(created.status,200);
  const order=MobileFoodOrderResultSchema.parse(created.value).order;
  const payer=Keypair.generate(),sponsor=Keypair.generate(),reference=Keypair.generate().publicKey.toBase58();
  const attempt=await tenant(merchant,async db=>{
   const a=(await db.query(`INSERT INTO payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program,status)
    SELECT $1,$2,$3,$4,q.settlement->>'recipient',(q.settlement->>'amountMinor')::bigint,q.descriptor->>'mint',q.descriptor->>'tokenProgram','READY'
    FROM order_payment_selection s JOIN payment_quotes q ON q.merchant_id=s.merchant_id AND q.order_id=s.order_id AND q.id=s.quote_id
    WHERE s.merchant_id=$1 AND s.order_id=$2 RETURNING *`,[merchant,order.id,reference,payer.publicKey.toBase58()])).rows[0];
   return frozenAttempt(db,a);
  });
  const blockhash=Keypair.generate().publicKey.toBase58();
  const tx=new Transaction({feePayer:sponsor.publicKey,recentBlockhash:blockhash}).add(...paymentInstructions(attempt,sponsor.publicKey,false));
  tx.partialSign(sponsor);const unsigned=tx.serialize({requireAllSignatures:false}).toString('base64');
  tx.partialSign(payer);const base64=tx.serialize().toString('base64');
  const signature=validateSigned(base64,unsigned,attempt.payer).signature;
  await tenant(merchant,db=>db.query('UPDATE payment_attempts SET transaction_base64=$2,blockhash=$3,last_valid_height=1 WHERE id=$1',[attempt.id,unsigned,blockhash]));
  return {order,attempt,body:{attemptId:attempt.id,base64},signature,token:new URL(order.paymentUrl).pathname.split('/').at(-1)!};
 }
 const committed=await prepare(),uncommitted=await prepare();
 const original=await post('/api/pay/'+committed.token+'/submit',committed.body);
 check(original.status===200&&original.value.signature===committed.signature,'original signed bytes committed before expiry');
 if (acceptance) {
  const {staffToken}=await import('../../tests/backend-table-fixture');
  const staff=await staffToken(pool,merchant,actor,'owner');
  for (const prepared of [committed,uncommitted]) {
   const rejected=await fetch(acceptanceApiBase+'/api/orders/'+prepared.order.id+'/acceptance',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+staff},body:JSON.stringify({status:'REJECTED',expectedVersion:0,idempotencyKey:randomUUID(),reason:'Signed recovery fixture rejection'})});
   assert.equal(rejected.status,200);assertions++;
  }
 } else {
  // Discard the original response and cross the immutable server deadline.
  await delay(Math.max(0,Math.max(Date.parse(committed.order.quoteExpiresAt),Date.parse(uncommitted.order.quoteExpiresAt))-Date.now()+30));
 }
 const refused=await post('/api/pay/'+uncommitted.token+'/submit',uncommitted.body);
 check(refused.status===409&&refused.value.error?.code===(acceptance?'ACCEPTANCE_UNAVAILABLE':'QUOTE_EXPIRED'),'saved-before-first-submit authorization refused after negative decision or expiry');
 const replay=await post('/api/pay/'+committed.token+'/submit',committed.body);
 check(replay.status===200&&replay.value.signature===committed.signature,'committed original signature replays after negative decision or expiry');
 const before=await tenant(merchant,async db=>({attempts:(await db.query('SELECT id,signature,signed_base64,status FROM payment_attempts ORDER BY id')).rows,payments:(await db.query('SELECT count(*)::int AS n FROM payments')).rows[0].n}));
 check(before.attempts.length===2&&before.payments===0,'replay creates no new attempt/payment');
 check(before.attempts.find(a=>a.id===committed.attempt.id)?.signed_base64===committed.body.base64,'committed exact original bytes retained');
 check(before.attempts.find(a=>a.id===uncommitted.attempt.id)?.signature===null,'expired first submission does not acquire signature');
 // Explicit synthetic verifier result. No claim that random blockhash exists or
 // these local signatures reached/settled on devnet. Exercise durable late facts.
 await Promise.all([tenant(merchant,db=>settleAttempt(db,committed.attempt,true)),tenant(merchant,db=>settleAttempt(db,committed.attempt,true))]);
 const persisted=await tenant(merchant,async db=>({order:(await db.query('SELECT status,reservation_released FROM orders WHERE id=$1',[committed.order.id])).rows[0],stock:(await db.query('SELECT stock,reserved FROM products WHERE id=$1',[product])).rows[0],payments:(await db.query('SELECT state,amount_minor FROM payments WHERE order_id=$1',[committed.order.id])).rows,attempts:(await db.query('SELECT count(*)::int AS n FROM payment_attempts')).rows[0].n,devices:(await db.query('SELECT count(*)::int AS n FROM devices')).rows[0].n}));
 assert.deepEqual(persisted,{order:{status:'RECOVERY',reservation_released:true},stock:{stock:4,reserved:1},payments:[{state:'RECOVERY',amount_minor:'2700000'}],attempts:2,devices:0});assertions++;
 if (acceptance) {
  const refunds=await tenant(merchant,async db=>(await db.query('SELECT status,amount_minor::text AS amount FROM refunds WHERE order_id=$1',[committed.order.id])).rows);
  assert.deepEqual(refunds,[{status:'REQUESTED',amount:'2700000'}]);assertions++;
 }
 const receipt={environment:'local_disposable_fixture',mode:acceptance?'merchant_rejection':'quote_expiry',assertions,merchantId:merchant,committedOrderId:committed.order.id,uncommittedOrderId:uncommitted.order.id,persisted,limits:['Ephemeral in-memory signers and random blockhash, never broadcast; not devnet/provider proof','Initial response deliberately discarded by consumer harness; not joined browser/AVD response loss','Finalization boolean is SQL-only synthetic verifier seam; late receipt is RECOVERY, never PAID','No refund transfer/worker/provider exercised'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/'+(acceptance?'p1-rejected-signed-recovery-http.json':'p1-signed-recovery-http.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt));
}finally{await admin.end();await pool.end();}
