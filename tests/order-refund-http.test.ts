import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {once} from 'node:events';
import pg from 'pg';
import bs58 from 'bs58';
import {Keypair} from '@solana/web3.js';
import {tableFixture,staffToken} from './backend-table-fixture';
import {fixturePaymentAttempt} from './backend-payment-fixture';
import {USDG_ASSET} from '../packages/domain/src/payment-assets';
import {DEVNET_GENESIS} from '../packages/domain/src/index';
// Store-side REAL refund: the request rules over HTTP and the durable store's state machine against real SQL. The on-chain transfer itself is covered by
// tests/order-refund-devnet.test.ts (opt-in: it spends devnet test USDG).
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
const pub=()=>Keypair.generate().publicKey.toBase58();
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');

test('refund request: owner/manager only, real wallet payments only, one per order, server-key mode; durable store state machine',integration,async()=>{
 const f=await tableFixture();const {server}=await import('../apps/api/src/index');const {settleAttempt}=await import('../apps/api/src/orders');const {createOrderRefundStore}=await import('../apps/worker/src/store-refund-runtime');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const tok={owner:await staffToken(f.pool,f.merchant,randomUUID(),'owner'),manager:await staffToken(f.pool,f.merchant,randomUUID(),'manager'),staff:await staffToken(f.pool,f.merchant,randomUUID(),'staff'),other:await staffToken(f.pool,f.other,randomUUID(),'owner')};
 const call=async(who:keyof typeof tok|null,method:string,path:string,body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:`Bearer ${tok[who]}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1});
 const raw=async(fn:(db:pg.PoolClient)=>Promise<void>)=>{const c=await admin.connect();try{await c.query('BEGIN');await c.query('SET LOCAL session_replication_role=replica');await fn(c);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 const mk=async(qty:number)=>{await raw(async db=>{await db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,session_id=NULL,lease_until=NULL,screen_generation=screen_generation+1 WHERE merchant_id=$1 AND device_id=$2",[f.merchant,f.a.id]);});return (await f.create(await f.quote(qty))).order.id as string;};
 const sourceBefore=process.env.BITPOS_STORE_REFUND_SOURCE_OWNER;
 const treasury=pub(),payer=pub();
 try{
  // a REAL (non-demo) settled wallet payment: the fixture attempt carries a real-looking signature and goes through the real settlement routine
  const A=await mk(2);
  await f.tenant(f.merchant,async db=>{const a=(await fixturePaymentAttempt(db,{merchant:f.merchant,order:A,status:'SUBMITTED',signature:'sig'+randomUUID(),payer})).rows[0]!;await settleAttempt(db,a,true);});
  assert.equal((await f.tenant(f.merchant,db=>db.query('SELECT status FROM orders WHERE id=$1',[A]))).rows[0].status,'PAID');
  const B=await mk(1); // unpaid
  const req=(who:keyof typeof tok|null,id:string,reason='ลูกค้าคืนสินค้า')=>call(who,'POST',`/api/bills/orders/${id}/refund`,{reason});

  // access and shape
  assert.equal((await req(null,A)).status,401);
  assert.equal((await req('staff',A)).status,403);
  assert.equal((await req('other',A)).status,404);
  assert.equal((await call('owner','POST',`/api/bills/orders/${A}/refund`,{})).status,422);
  assert.equal((await call('owner','POST',`/api/bills/orders/${A}/refund`,{reason:'ok',x:1})).status,422);
  assert.equal((await req('owner','not-a-uuid')).status,422);
  assert.equal((await req('owner',randomUUID())).status,404);
  // unpaid order
  assert.equal((await req('owner',B)).status,409);
  // the detail says why a refund is not possible yet: BitPOS does not operate this shop's treasury key
  delete process.env.BITPOS_STORE_REFUND_SOURCE_OWNER;
  assert.deepEqual((await call('owner','GET',`/api/bills/orders/${A}`)).body.refundable,{available:false,blocked:'SIGNER'});
  assert.equal((await req('owner',A)).status,409,'REFUND_UNAVAILABLE without the signer configured');
  assert.equal((await f.tenant(f.merchant,db=>db.query('SELECT count(*)::int n FROM order_refunds'))).rows[0].n,0,'a refused request leaves nothing behind');
  // configure the signer = this shop's treasury
  await raw(async db=>{await db.query('UPDATE merchants SET treasury=$2 WHERE id=$1',[f.merchant,treasury]);});
  process.env.BITPOS_STORE_REFUND_SOURCE_OWNER=pub();
  assert.deepEqual((await call('owner','GET',`/api/bills/orders/${A}`)).body.refundable,{available:true,blocked:null},'a server key for another wallet does not apply: the owner signs instead (tests/order-refund-owner-http.test.ts)');
  process.env.BITPOS_STORE_REFUND_SOURCE_OWNER=treasury;
  assert.deepEqual((await call('manager','GET',`/api/bills/orders/${A}`)).body.refundable,{available:true,blocked:null});
  assert.deepEqual((await call('staff','GET',`/api/bills/orders/${A}`)).body.refundable,{available:false,blocked:'ROLE'});

  // request: full amount actually paid, to the wallet that paid, queued for the worker (nothing is sent by the API)
  const [r1,r2]=await Promise.all([req('owner',A),req('manager',A)]);
  assert.deepEqual([r1.status,r2.status],[200,200]);assert.equal([r1,r2].filter(r=>r.body.replayed===false).length,1,'racing requests create one refund');
  const refund=r1.body.refund;assert.deepEqual([refund.state,refund.signingMode,refund.sourceOwner,refund.beneficiary,refund.amountMinor,refund.assetId,refund.signature],['SIGNING','server',treasury,payer,'5400000',USDG_ASSET.assetId,null]);
  const detail=(await call('owner','GET',`/api/bills/orders/${A}`)).body;assert.deepEqual([detail.refund.state,detail.refundable.blocked],['SIGNING','ALREADY']);
  assert.equal((await f.tenant(f.merchant,db=>db.query('SELECT count(*)::int n FROM order_refunds'))).rows[0].n,1);
  assert.equal((await req('owner',A)).body.replayed,true);

  // demo-paid and cash-like orders are never refunded for real
  const C=await mk(1);await f.tenant(f.merchant,async db=>{const a=(await fixturePaymentAttempt(db,{merchant:f.merchant,order:C,status:'SUBMITTED',signature:'demo:'+randomUUID(),payer})).rows[0]!;await settleAttempt(db,a,true);});
  assert.equal((await req('owner',C)).status,409);
  assert.equal((await call('owner','GET',`/api/bills/orders/${C}`)).body.refundable.blocked,'DEMO');

  // ---- durable store state machine (what the worker drives)
  const config={sourceOwner:treasury,feePayerOwner:treasury,allowedAssetIds:[USDG_ASSET.assetId],maxAmountMinor:'1000000000',maxFeeLamports:100000,maxTotalLamports:3000000,maxAttemptsPerTick:3};
  const store=createOrderRefundStore(f.merchant,config);
  const work=async()=>JSON.parse(JSON.stringify((await f.pool.query('SELECT bitpos.order_refund_work(10) value')).rows[0].value));
  assert.deepEqual((await work()).filter((w:any)=>w.merchantId===f.merchant).map((w:any)=>w.id),[refund.id]);
  const s0=await store.snapshot(refund.id);assert.deepEqual([s0.state,s0.prepared,s0.beneficiaryOwner,s0.sourceOwner,s0.caseId],['SIGNING',null,payer,treasury,A]);
  await assert.rejects(createOrderRefundStore(f.merchant,{...config,sourceOwner:pub()}).snapshot(refund.id),/SOURCE_MISMATCH/,'a worker holding another key refuses to act');
  const signature=bs58.encode(randomBytes(64)),bytes='AAAA';
  const prepared={version:1 as const,attemptId:refund.id,batchId:A,amountMinor:'5400000',asset:USDG_ASSET,genesisHash:DEVNET_GENESIS,recipientOwner:payer,recipientTokenAccount:pub(),sourceOwner:treasury,sourceTokenAccount:pub(),feePayerOwner:treasury,blockhash:pub(),lastValidBlockHeight:100,preparedAtSlot:10,createRecipientAccount:false,feeLamports:5000,rentLamports:0,signedBase64:bytes,signature,signedBytesSha256:sha(bytes),intentDigest:sha('intent'),memo:'refund',reference:pub()};
  assert.equal(await store.persistPrepared(s0,prepared as never),true);
  assert.equal(await store.persistPrepared(s0,prepared as never),false,'a lost race changes nothing');
  const s1=await store.snapshot(refund.id);assert.deepEqual([s1.state,s1.prepared?.signature],['PREPARED',signature]);
  // the exact prepared bytes and the signature can never be rewritten, not even by a privileged-looking update
  await assert.rejects(f.tenant(f.merchant,db=>db.query("UPDATE order_refunds SET prepared=jsonb_set(prepared,'{amountMinor}','\"1\"') WHERE id=$1",[refund.id])),/immutable/);
  await assert.rejects(f.tenant(f.merchant,db=>db.query("UPDATE order_refunds SET signature='x' WHERE id=$1",[refund.id])),/immutable/);
  await assert.rejects(f.tenant(f.merchant,db=>db.query('UPDATE order_refunds SET amount_minor=1 WHERE id=$1',[refund.id])),/permission denied/);
  await assert.rejects(f.tenant(f.merchant,db=>db.query('DELETE FROM order_refunds WHERE id=$1',[refund.id])),/immutable|permission denied/);
  const admitted=await store.authorizeSubmission(s1);assert.ok(admitted);assert.equal(await store.authorizeSubmission(s1),null,'the submission claim is version-fenced');
  await store.recordUnknown(admitted!,'SUBMISSION_AMBIGUOUS');
  assert.deepEqual([(await store.snapshot(refund.id)).state,(await f.tenant(f.merchant,db=>db.query('SELECT last_reason,attempts FROM order_refunds WHERE id=$1',[refund.id]))).rows[0]],['UNKNOWN',{last_reason:'SUBMISSION_AMBIGUOUS',attempts:1}]);
  assert.equal((await work()).filter((w:any)=>w.merchantId===f.merchant).length,1,'an unknown outcome stays on the work list');
  const receipt={digest:sha('receipt'),evidence:{version:1,provider:'solana-devnet',commitment:'finalized',genesisHash:DEVNET_GENESIS,signature,slot:5,blockTime:null,feeLamports:5000,intentDigest:prepared.intentDigest,signedBytesSha256:prepared.signedBytesSha256,attemptId:refund.id,batchId:A,amountMinor:'5400000',asset:USDG_ASSET,sourceOwner:treasury,sourceTokenAccount:prepared.sourceTokenAccount,recipientOwner:payer,recipientTokenAccount:prepared.recipientTokenAccount,memo:'refund',reference:prepared.reference,sourcePreMinor:'10',sourcePostMinor:'5',recipientPreMinor:'0',recipientPostMinor:'5'}};
  await store.recordVerified(admitted!,{status:'FINALIZED',receipt} as never);
  const done=(await call('owner','GET',`/api/bills/orders/${A}`)).body.refund;assert.deepEqual([done.state,done.signature===signature,!!done.finalizedAt],['FINALIZED',true,true]);
  await store.recordVerified(admitted!,{status:'FINALIZED',receipt} as never); // the same observation again is a no-op
  await assert.rejects(store.recordVerified(admitted!,{status:'FAILED',signature,evidence:{kind:'FINALIZED_CHAIN_FAILURE',genesisHash:DEVNET_GENESIS,slot:5,intentDigest:prepared.intentDigest,signedBytesSha256:prepared.signedBytesSha256,transactionError:{}},digest:sha('f')} as never),/CONTRADICTORY/);
  assert.equal((await work()).filter((w:any)=>w.merchantId===f.merchant).length,0,'a finalized refund leaves the work list');
  await assert.rejects(f.tenant(f.merchant,db=>db.query("UPDATE order_refunds SET state='FAILED' WHERE id=$1",[refund.id])),/immutable/);
  const actions=(await call('owner','GET','/api/activity')).body.entries.map((e:any)=>e.action);for(const a of ['order.refund.request','order.refund.finalized'])assert.ok(actions.includes(a),a);
  // the paid order itself is not rewritten by the refund, and the sales report still shows what was sold
  assert.equal((await f.tenant(f.merchant,db=>db.query('SELECT status FROM orders WHERE id=$1',[A]))).rows[0].status,'PAID');
 }finally{if(sourceBefore===undefined)delete process.env.BITPOS_STORE_REFUND_SOURCE_OWNER;else process.env.BITPOS_STORE_REFUND_SOURCE_OWNER=sourceBefore;await new Promise(r=>server.close(r));await admin.end();}
});
