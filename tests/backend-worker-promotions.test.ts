import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Keypair,Transaction} from '@solana/web3.js';
import type {VersionedTransactionResponse} from '@solana/web3.js';
import bs58 from 'bs58';
import {DEVNET_GENESIS} from '../packages/domain/src/index';
import type {PromotionJob} from '../packages/contracts/src/index';
import type {AttemptRow} from '../apps/api/src/types';
import type {PromotionProviderInput,PromotionProviderResult} from '../apps/api/src/promotion-provider';
import {PromotionProviderFailure} from '../apps/api/src/promotion-provider';
import {promotionFixture} from './backend-promotions-fixture';
import {tableFixture} from './backend-table-fixture';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1',timeout:60000};
// Skipped tests never load private runtime settings. No real provider/RPC calls.
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
async function until(check:()=>Promise<boolean>,message:string){const deadline=Date.now()+10000;while(!await check()){assert.ok(Date.now()<deadline,message);await delay(25);}}

test('production scheduler submits persisted bytes, settles once and expires local reservations while AI is held pending',integration,async t=>{
 const f=await promotionFixture(),expiry=await tableFixture(3);
 const {runWorker}=await import('../apps/worker/src/index');
 const p=await import('../apps/api/src/payments');
 const {frozenAttempt}=await import('../apps/api/src/payment-assets');
 const stopped=new AbortController(),providerEntered=deferred<void>(),providerReply=deferred<void>();
 let running:Promise<void>|undefined,providerCalls=0,providerActive=0,maxProviderActive=0,canFinalize=false,submits=0;
 try{
  const created=await f.create(await f.quote());
  const sponsor=Keypair.generate(),payer=Keypair.generate(),reference=Keypair.generate().publicKey.toBase58();
  // Ephemeral, locally signed test-wallet fixture. Never broadcast to a network.
  const attempt=await f.tenant(f.merchant,async db=>{
   const row=(await db.query<AttemptRow>(`INSERT INTO payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program,status,last_valid_height)
    SELECT $1,$2,$3,$4,q.settlement->>'recipient',(q.settlement->>'amountMinor')::bigint,q.descriptor->>'mint',q.descriptor->>'tokenProgram','BUILDING',100
    FROM order_payment_selection s JOIN payment_quotes q ON q.merchant_id=s.merchant_id AND q.id=s.quote_id
    WHERE s.merchant_id=$1 AND s.order_id=$2 RETURNING *`,[f.merchant,created.order.id,reference,payer.publicKey.toBase58()])).rows[0];
   const frozen=await frozenAttempt(db,row);
   const tx=new Transaction({feePayer:sponsor.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()}).add(...p.paymentInstructions(frozen,sponsor.publicKey,false));tx.partialSign(sponsor);
   const unsigned=tx.serialize({requireAllSignatures:false}).toString('base64');tx.partialSign(payer);const signed=tx.serialize().toString('base64'),signature=p.validateSigned(signed,unsigned,frozen.payer).signature;
   const persisted=(await db.query<AttemptRow>("UPDATE payment_attempts SET status='SUBMITTING',transaction_base64=$2,signed_base64=$3,signature=$4,blockhash=$5 WHERE id=$1 RETURNING *",[row.id,unsigned,signed,signature,tx.recentBlockhash])).rows[0];
   return {row:persisted,tx,asset:frozen.payment.asset};
  });
  const expired=await expiry.tenant(expiry.merchant,async db=>{
   const customer=(await db.query('INSERT INTO customers(merchant_id) VALUES($1) RETURNING id',[expiry.merchant])).rows[0].id;
   const order=(await db.query("INSERT INTO orders(merchant_id,customer_id,thb_minor,usdg_minor,treasury,terminal_id,idempotency_key,access_token,request_hash,quote_expires_at) VALUES($1,$2,3500,1000000,'11111111111111111111111111111111','controlled-expiry-fixture',$3,$4,'controlled-expiry-fixture',clock_timestamp()-interval '1 second') RETURNING id",[expiry.merchant,customer,randomUUID(),randomUUID()])).rows[0].id;
   await db.query("INSERT INTO order_items(merchant_id,order_id,product_id,name,name_en,qty,unit_minor) VALUES($1,$2,$3,'กาแฟ','Coffee',1,3500)",[expiry.merchant,order,expiry.product]);await db.query('UPDATE products SET reserved=1 WHERE id=$1',[expiry.product]);return order;
  });
  const first=await f.ok<{job:PromotionJob}>('/api/promotions/generate',{...f.input,idempotencyKey:randomUUID()});
  const second=await f.ok<{job:PromotionJob}>('/api/promotions/generate',{...f.input,idempotencyKey:randomUUID()});
  // Keep actual discovery SQL/RLS/transactions, but restrict this smoke to its
  // dedicated merchants so controlled RPC cannot mutate anyone else's work.
  const query=f.pool.query.bind(f.pool),merchants=[f.merchant,expiry.merchant];
  t.mock.method(f.pool,'query',async(sql:string,args:unknown[]=[])=>{
   if(sql.includes('FROM bitpos.reconciliation_queue()'))return query(sql.replace(' ORDER BY',' WHERE merchant_id=ANY($1::uuid[]) ORDER BY'),[merchants]);
   if(sql.includes('FROM bitpos.promotion_work_queue()'))return query(sql.replace('bitpos.promotion_work_queue()','bitpos.promotion_work_queue() WHERE merchant_id=ANY($1::uuid[])'),[merchants]);
   return query(sql,args);
  });
  // Only genesis uses the kit transport. Fail closed on every unexpected request.
  t.mock.method(globalThis,'fetch',async(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>{
   const body=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
   const request=JSON.parse(body);assert.equal(request.method,'getGenesisHash');return Response.json({jsonrpc:'2.0',id:request.id,result:DEVNET_GENESIS});
  });
  const message=attempt.tx.compileMessage(),index=message.accountKeys.findIndex(k=>k.equals(p.ata(attempt.row.recipient,attempt.asset)));
  const record={slot:123,blockTime:null,version:'legacy',transaction:{message,signatures:attempt.tx.signatures.map(s=>bs58.encode(s.signature!))},meta:{err:null,fee:10000,preTokenBalances:[],postTokenBalances:[{accountIndex:index,mint:attempt.asset.mint,owner:attempt.row.recipient,programId:attempt.asset.tokenProgram,uiTokenAmount:{amount:attempt.row.amount_minor,decimals:attempt.asset.decimals,uiAmount:null,uiAmountString:'2.7'}}]}} as unknown as VersionedTransactionResponse;
  t.mock.method(p.chain,'getTransaction',async(signature:string)=>{assert.equal(signature,attempt.row.signature);return canFinalize?record:null;});
  t.mock.method(p.chain,'getSignatureStatuses',async()=>({context:{slot:123},value:[null]}));
  t.mock.method(p.chain,'getBlockHeight',async()=>10);
  t.mock.method(p.chain,'sendRawTransaction',async(bytes:Uint8Array)=>{
   const persisted=(await f.inspect('SELECT signature,signed_base64 FROM payment_attempts WHERE id=$1',[attempt.row.id])).rows[0];
   assert.equal(persisted.signature,attempt.row.signature);assert.equal(Buffer.from(bytes).toString('base64'),persisted.signed_base64,'submission must use already-persisted exact bytes');submits++;return attempt.row.signature!;
  });
  running=runWorker(stopped.signal,{kind:'fixture_provider',configuration:f.config,provider:async(job:PromotionProviderInput):Promise<PromotionProviderResult>=>{
   providerCalls++;providerActive++;maxProviderActive=Math.max(maxProviderActive,providerActive);providerEntered.resolve();await providerReply.promise;providerActive--;
   return {kind:'fixture_provider',provider:new URL(f.config.url).origin,model:f.config.model,requestId:'controlled-slow-'+job.jobId,candidate:{productId:job.products[0].productId,headline:'Controlled fixture',copy:'Not actual AI',discountPercent:15,rationale:'Held provider fixture'}};
  }});
  await providerEntered.promise;
  await until(async()=>submits>0,'financial submission stalled behind provider');
  assert.equal(providerActive,1);assert.equal(providerCalls,1);
  await until(async()=>{
   const row=(await expiry.tenant(expiry.merchant,db=>db.query('SELECT status,reservation_released FROM orders WHERE id=$1',[expired]))).rows[0];return row.status==='EXPIRED'&&row.reservation_released;
  },'local unpaid expiry stalled behind provider');
  assert.deepEqual((await expiry.tenant(expiry.merchant,db=>db.query('SELECT stock,reserved FROM products WHERE id=$1',[expiry.product]))).rows[0],{stock:3,reserved:0});
  assert.deepEqual((await f.inspect('SELECT state,attempts FROM ai_generation_jobs WHERE id=$1',[second.job.id])).rows[0],{state:'QUEUED',attempts:0},'no overlapping AI jobs while first is pending');
  canFinalize=true;
  await until(async()=>(await f.inspect('SELECT status FROM orders WHERE id=$1',[created.order.id])).rows[0].status==='PAID','finalized reconciliation stalled behind provider');
  assert.equal(providerActive,1,'financial progress precedes releasing AI');
  await until(async()=>(await f.inspect("SELECT count(*)::int AS n FROM outbox_events WHERE order_id=$1 AND payload->'payload'->>'status'='PAID'",[created.order.id])).rows[0].n===1,'paid event absent');
  assert.deepEqual((await f.inspect('SELECT stock,reserved FROM products WHERE id=$1',[f.product])).rows[0],{stock:19,reserved:0});
  assert.equal((await f.inspect('SELECT count(*)::int AS n FROM payments WHERE order_id=$1',[created.order.id])).rows[0].n,1);
  // Shutdown drains the pending job; no next queued request is started.
  stopped.abort();let drained=false;void running.then(()=>{drained=true;});await delay(25);assert.equal(drained,false);providerReply.resolve();await running;
  assert.equal(maxProviderActive,1);assert.equal(providerCalls,1);
  assert.deepEqual((await f.inspect('SELECT state,attempts FROM ai_generation_jobs WHERE id=$1',[first.job.id])).rows[0],{state:'SUCCEEDED',attempts:1});
  assert.deepEqual((await f.inspect('SELECT state,attempts FROM ai_generation_jobs WHERE id=$1',[second.job.id])).rows[0],{state:'QUEUED',attempts:0});
  // Settle replay uses the same real financial tick, not a substitute assertion.
  const {tick}=await import('../apps/worker/src/index');await tick();
  assert.equal((await f.inspect('SELECT count(*)::int AS n FROM payments WHERE order_id=$1',[created.order.id])).rows[0].n,1);
  assert.equal((await f.inspect("SELECT count(*)::int AS n FROM outbox_events WHERE order_id=$1 AND payload->'payload'->>'status'='PAID'",[created.order.id])).rows[0].n,1);
 }finally{stopped.abort();providerReply.resolve();await running;t.mock.restoreAll();await f.close();}
});

test('independent lifecycle expires a held durable lease; replacement runner never repeats its ambiguous request',integration,async t=>{
 const f=await promotionFixture();
 // Intentional opt-in loading boundary: skipped smoke needs no private configuration.
 const {runWorker}=await import('../apps/worker/src/index'),{runPromotionJob}=await import('../apps/worker/src/promotions');
 const entered=deferred<void>(),reply=deferred<void>(),stop=new AbortController();
 let running:Promise<void>|undefined,calls=0;
 try{
  const first=await f.ok<{job:PromotionJob}>('/api/promotions/generate',{...f.input,idempotencyKey:randomUUID()});
  const second=await f.ok<{job:PromotionJob}>('/api/promotions/generate',{...f.input,idempotencyKey:randomUUID()});
  const query=f.pool.query.bind(f.pool);
  t.mock.method(f.pool,'query',async(sql:string,args:unknown[]=[])=>{
   if(sql.includes('FROM bitpos.reconciliation_queue()'))return query(sql.replace(' ORDER BY',' WHERE merchant_id=$1 ORDER BY'),[f.merchant]);
   if(sql.includes('FROM bitpos.promotion_work_queue()'))return query(sql.replace('bitpos.promotion_work_queue()','bitpos.promotion_work_queue() WHERE merchant_id=$1'),[f.merchant]);
   return query(sql,args);
  });
  t.mock.method(globalThis,'fetch',async()=>{throw Error('This no-payment fixture must issue no external request');});
  const fixture={kind:'fixture_provider' as const,configuration:f.config,provider:async(job:PromotionProviderInput):Promise<PromotionProviderResult>=>{
   calls++;entered.resolve();await reply.promise;
   return {kind:'fixture_provider',provider:new URL(f.config.url).origin,model:f.config.model,requestId:'controlled-lease-'+job.jobId,candidate:{productId:f.product,headline:'Late fixture',copy:'Not actual AI',discountPercent:15,rationale:'Controlled response after lease expiry'}};
  }};
  running=runWorker(stop.signal,fixture);await entered.promise;
  // Simulate a replacement worker using the very same durable claim boundary:
  // it cannot start even a different queued job while the live lease is retained.
  await runPromotionJob(f.merchant,fixture);assert.equal(calls,1);
  assert.deepEqual((await f.inspect('SELECT state,attempts,reserved_microusd::text FROM ai_generation_jobs WHERE id=$1',[first.job.id])).rows[0],{state:'RUNNING',attempts:1,reserved_microusd:'1000'});
  await f.tenant(f.merchant,db=>db.query("UPDATE ai_generation_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[first.job.id]));
  await until(async()=>(await f.inspect('SELECT state FROM ai_generation_jobs WHERE id=$1',[first.job.id])).rows[0].state==='FAILED','lifecycle reaping stalled behind pending provider');
  assert.equal(calls,1,'lease reconciliation must not execute another provider request');
  stop.abort();reply.resolve();await running;
  assert.deepEqual((await f.inspect('SELECT state,blocker,attempts,reserved_microusd::text,campaign_id FROM ai_generation_jobs WHERE id=$1',[first.job.id])).rows[0],{state:'FAILED',blocker:'PROVIDER_OUTCOME_UNKNOWN',attempts:1,reserved_microusd:'1000',campaign_id:null});
  assert.deepEqual((await f.inspect('SELECT state,attempts FROM ai_generation_jobs WHERE id=$1',[second.job.id])).rows[0],{state:'QUEUED',attempts:0});
  // A restarted worker may process NEW work; it never retries the expired job.
  await runPromotionJob(f.merchant,{...fixture,provider:async()=>{calls++;throw new PromotionProviderFailure('PROVIDER_OUTCOME_UNKNOWN');}});
  await runPromotionJob(f.merchant,fixture);assert.equal(calls,2);
  assert.deepEqual((await f.inspect('SELECT state,blocker,attempts,reserved_microusd::text FROM ai_generation_jobs WHERE id=$1',[second.job.id])).rows[0],{state:'FAILED',blocker:'PROVIDER_OUTCOME_UNKNOWN',attempts:1,reserved_microusd:'1000'});
  assert.equal((await f.inspect('SELECT count(*)::int AS n FROM promotion_campaigns WHERE merchant_id=$1',[f.merchant])).rows[0].n,0);
 }finally{stop.abort();reply.resolve();await running;t.mock.restoreAll();await f.close();}
});
