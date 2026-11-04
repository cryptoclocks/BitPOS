import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import pg from 'pg';
import {Keypair,PublicKey,Transaction} from '@solana/web3.js';
import nacl from 'tweetnacl';
import {tableFixture,staffToken} from './backend-table-fixture';
import {fixturePaymentAttempt} from './backend-payment-fixture';
import {fixture as chainFixture,chainReceipt} from './payout-provider.fixture';
import {USDG_ASSET} from '../packages/domain/src/payment-assets';
// Owner-signed store refund over HTTP against real SQL and a fake chain: BitPOS holds no key. The request waits for the owner's wallet; the prepared message is
// unsigned; only bytes that are that exact message with the treasury's signature are accepted; the keyless worker lane then broadcasts and reconciles them.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
const pub=()=>Keypair.generate().publicKey.toBase58();

test('owner-signed refund: request, prepare, sign, submit, broadcast and finalize without any server key',integration,async()=>{
 const f=await tableFixture();const {server}=await import('../apps/api/src/index');const {settleAttempt}=await import('../apps/api/src/orders');
 const {refundTransport}=await import('../apps/api/src/order-refunds');const {createOwnerSignedRefundWorker}=await import('../apps/worker/src/store-refund-runtime');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const tok={owner:await staffToken(f.pool,f.merchant,randomUUID(),'owner'),manager:await staffToken(f.pool,f.merchant,randomUUID(),'manager'),staff:await staffToken(f.pool,f.merchant,randomUUID(),'staff'),other:await staffToken(f.pool,f.other,randomUUID(),'owner')};
 const call=async(who:keyof typeof tok|null,method:string,path:string,body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:`Bearer ${tok[who]}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1});
 const raw=async(fn:(db:pg.PoolClient)=>Promise<void>)=>{const c=await admin.connect();try{await c.query('BEGIN');await c.query('SET LOCAL session_replication_role=replica');await fn(c);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 const mk=async(qty:number)=>{await raw(async db=>{await db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,session_id=NULL,lease_until=NULL,screen_generation=screen_generation+1 WHERE merchant_id=$1 AND device_id=$2",[f.merchant,f.a.id]);});return (await f.create(await f.quote(qty))).order.id as string;};
 const pay=async(order:string,payer:string)=>{await f.tenant(f.merchant,async db=>{const a=(await fixturePaymentAttempt(db,{merchant:f.merchant,order,status:'SUBMITTED',signature:'sig'+randomUUID(),payer})).rows[0]!;await settleAttempt(db,a,true);});};
 const sourceBefore=process.env.BITPOS_STORE_REFUND_SOURCE_OWNER,transportBefore=refundTransport.current;
 delete process.env.BITPOS_STORE_REFUND_SOURCE_OWNER; // no server key anywhere
 const wallet=Keypair.generate(),treasury=wallet.publicKey.toBase58(),payer=new PublicKey(pub());
 const chain=chainFixture(USDG_ASSET,false,payer,'5400000',wallet);chain.state.blockHeight=50;chain.state.balance=10_000_000n;
 (chain.connection as any).isBlockhashValid=async()=>({context:{slot:11},value:true}); // the fake's default says every blockhash is expired
 const simulate=(chain.connection as any).simulateTransaction.bind(chain.connection);
 (chain.connection as any).simulateTransaction=async(tx:{serialize():Uint8Array},options:Record<string,unknown>)=>options.sigVerify===false?{context:{slot:10},value:{err:null,logs:[]}}:simulate(tx,options);
 try{
  await raw(async db=>{await db.query('UPDATE merchants SET treasury=$2 WHERE id=$1',[f.merchant,treasury]);});
  const A=await mk(2);await pay(A,payer.toBase58());
  const url=(id:string,tail='')=>`/api/bills/orders/${id}/refund${tail}`;

  // 1. the request records the intent only: AWAITING_OWNER, nothing prepared, nothing signed, no worker work
  assert.deepEqual((await call('manager','GET',`/api/bills/orders/${A}`)).body.refundable,{available:true,blocked:null});
  const req=await call('owner','POST',url(A),{reason:'ลูกค้าคืนสินค้า'});assert.equal(req.status,200);
  const refund=req.body.refund;assert.deepEqual([refund.state,refund.signingMode,refund.sourceOwner,refund.beneficiary,refund.amountMinor,refund.signature],['AWAITING_OWNER','owner',treasury,payer.toBase58(),'5400000',null]);
  const workFor=async(mode:string)=>(await f.pool.query('SELECT bitpos.order_refund_work(10,$1) value',[mode])).rows[0].value.filter((w:any)=>w.merchantId===f.merchant);
  assert.equal((await workFor('owner')).length,0,'a request that is not signed yet is not worker work');assert.equal((await workFor('server')).length,0);

  // 2. access: staff cannot prepare/submit/cancel; another shop cannot see the refund
  for(const tail of ['/prepare','/submit','/cancel'])assert.equal((await call('staff','POST',url(A,tail),{base64:'AAAA'})).status,403);
  for(const tail of ['/prepare','/submit','/cancel'])assert.equal((await call(null,'POST',url(A,tail),{base64:'AAAA'})).status,401);
  assert.equal((await call('other','POST',url(A,'/prepare'),{})).status,409,'another shop has no refund awaiting for that order');
  assert.equal((await call('owner','POST',url(A,'/submit'),{})).status,422);
  assert.equal((await call('owner','POST',url(A,'/submit'),{base64:'AAAA',x:1})).status,422);
  assert.equal((await call('owner','POST',url(A,'/submit'),{base64:'AAAA'})).status,422,'nothing was prepared yet');

  // 3. prepare: chain trouble and a shortfall are reported plainly and leave the request untouched
  refundTransport.current={...chain.connection,getGenesisHash:async()=>{throw Error('offline');}} as never;
  assert.equal((await call('owner','POST',url(A,'/prepare'),{})).status,503);
  refundTransport.current=chain.connection as never;chain.state.balance=1000n;
  assert.deepEqual([(await call('owner','POST',url(A,'/prepare'),{})).status,(await call('manager','POST',url(A,'/prepare'),{})).body.error.code],[409,'REFUND_FUNDS_INSUFFICIENT']);
  chain.state.balance=10_000_000n;
  const prep=await call('manager','POST',url(A,'/prepare'),{});assert.equal(prep.status,200);
  assert.deepEqual([prep.body.sourceOwner,prep.body.beneficiary,prep.body.amountMinor,prep.body.refundId],[treasury,payer.toBase58(),'5400000',refund.id]);
  const unsigned=Transaction.from(Buffer.from(prep.body.unsignedBase64,'base64'));assert.equal(unsigned.verifySignatures(),false);assert.equal(unsigned.feePayer?.toBase58(),treasury);
  assert.equal(chain.state.signs,0,'the server never asked for a key');
  assert.equal((await f.tenant(f.merchant,db=>db.query('SELECT count(*)::int n FROM order_refunds WHERE state=\'AWAITING_OWNER\' AND unsigned IS NOT NULL AND prepared IS NULL AND signature IS NULL'))).rows[0].n,1);

  // 4. submit: only the exact prepared message carrying the treasury's valid signature is accepted
  const signWith=(key:Keypair)=>{const tx=Transaction.from(Buffer.from(prep.body.unsignedBase64,'base64'));tx.addSignature(wallet.publicKey,Buffer.from(nacl.sign.detached(tx.serializeMessage(),key.secretKey)));return tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');};
  const good=signWith(wallet);
  assert.equal((await call('owner','POST',url(A,'/submit'),{base64:prep.body.unsignedBase64})).body.error.code,'REFUND_SIGNATURE_INVALID','unsigned');
  assert.equal((await call('owner','POST',url(A,'/submit'),{base64:signWith(Keypair.generate())})).body.error.code,'REFUND_SIGNATURE_INVALID','signed by another key');
  assert.equal((await call('owner','POST',url(A,'/submit'),{base64:'!!'})).status,422);
  chain.state.blockHeight=90;
  assert.deepEqual([(await call('owner','POST',url(A,'/submit'),{base64:good})).status,(await call('owner','POST',url(A,'/submit'),{base64:good})).body.error.code],[409,'REFUND_SIGNATURE_EXPIRED']);
  assert.equal((await f.tenant(f.merchant,db=>db.query('SELECT state FROM order_refunds WHERE id=$1',[refund.id]))).rows[0].state,'AWAITING_OWNER','an expired signature leaves the request waiting; prepare again');
  chain.state.blockHeight=50;
  const ok=await call('owner','POST',url(A,'/submit'),{base64:good});assert.equal(ok.status,200);assert.deepEqual([ok.body.refund.state,typeof ok.body.refund.signature],['PREPARED','string']);
  assert.equal((await call('owner','POST',url(A,'/submit'),{base64:good})).body.error.code,'REFUND_NOT_AWAITING','a second submit is refused');
  assert.equal((await call('owner','POST',url(A,'/prepare'),{})).body.error.code,'REFUND_NOT_AWAITING');
  assert.equal((await call('owner','POST',url(A,'/cancel'),{})).body.error.code,'REFUND_NOT_AWAITING','a signed refund cannot be cancelled');
  assert.equal((await call('owner','POST',url(A),{reason:'อีกครั้ง'})).body.replayed,true);
  await assert.rejects(f.tenant(f.merchant,db=>db.query("UPDATE order_refunds SET unsigned=NULL WHERE id=$1",[refund.id])),/frozen|immutable/);
  const signature=ok.body.refund.signature as string;

  // 5. the keyless worker lane broadcasts those exact bytes, then verifies the finalized chain transaction before the refund is marked done
  const lane=createOwnerSignedRefundWorker(chain.connection as never,{work:async limit=>(await f.pool.query('SELECT bitpos.order_refund_work($1,\'owner\') value',[limit])).rows[0].value.filter((w:any)=>w.merchantId===f.merchant)});
  assert.equal((await workFor('owner')).length,1);
  const t1=await lane.tick();assert.deepEqual([t1.status,t1.outcomes],['AVAILABLE',{SUBMITTED:1}]);
  assert.equal(chain.state.sends.length,1);assert.equal(Transaction.from(chain.state.sends[0]!).signature?.toString('base64'),Buffer.from(Transaction.from(Buffer.from(good,'base64')).signature!).toString('base64'));
  assert.equal((await call('owner','GET',`/api/bills/orders/${A}`)).body.refund.state,'PREPARED','sending is not completion');
  const row=(await f.tenant(f.merchant,db=>db.query('SELECT prepared FROM order_refunds WHERE id=$1',[refund.id]))).rows[0];
  chain.state.chain=chainReceipt(row.prepared,'10000000');
  const t2=await lane.tick();assert.deepEqual(t2.outcomes,{VERIFIED:1});
  const done=(await call('owner','GET',`/api/bills/orders/${A}`)).body.refund;assert.deepEqual([done.state,done.signature,!!done.finalizedAt],['FINALIZED',signature,true]);
  assert.equal((await workFor('owner')).length,0,'a finalized refund leaves the work list');
  assert.deepEqual((await call('owner','GET',`/api/bills/orders/${A}`)).body.refundable,{available:false,blocked:'ALREADY'});
  const actions=(await call('owner','GET','/api/activity')).body.entries.map((e:any)=>e.action);for(const a of ['order.refund.request','order.refund.signed','order.refund.finalized'])assert.ok(actions.includes(a),a);
  assert.equal((await f.tenant(f.merchant,db=>db.query('SELECT status FROM orders WHERE id=$1',[A]))).rows[0].status,'PAID','the paid order is not rewritten');

  // 6. cancel before signing: nothing was signed or sent; a new request can be made
  const B=await mk(1);await pay(B,payer.toBase58());
  const r2=await call('manager','POST',url(B),{reason:'ลองใหม่'});assert.equal(r2.body.refund.state,'AWAITING_OWNER');
  assert.equal((await call('manager','POST',url(B,'/cancel'),{})).status,200);
  assert.deepEqual((await f.tenant(f.merchant,db=>db.query('SELECT state,last_reason,signature FROM order_refunds WHERE id=$1',[r2.body.refund.id]))).rows[0],{state:'FAILED',last_reason:'CANCELLED',signature:null});
  const r3=await call('owner','POST',url(B),{reason:'ขอใหม่'});assert.deepEqual([r3.status,r3.body.replayed,r3.body.refund.state],[200,false,'AWAITING_OWNER']);
  assert.notEqual(r3.body.refund.id,r2.body.refund.id);
  assert.ok((await call('owner','GET','/api/activity')).body.entries.some((e:any)=>e.action==='order.refund.cancelled'));
 }finally{refundTransport.current=transportBefore;if(sourceBefore===undefined)delete process.env.BITPOS_STORE_REFUND_SOURCE_OWNER;else process.env.BITPOS_STORE_REFUND_SOURCE_OWNER=sourceBefore;await new Promise(r=>server.close(r));await admin.end();}
});
