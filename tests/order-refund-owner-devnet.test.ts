import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Connection,Keypair,PublicKey,Transaction} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {tableFixture,staffToken} from './backend-table-fixture';
import {fixturePaymentAttempt} from './backend-payment-fixture';
import {USDG_ASSET} from '../packages/domain/src/payment-assets';
// OPT-IN. The OWNER-SIGNED refund on REAL Solana DEVNET with no server key: the API prepares the unsigned transaction, this test plays the owner's wallet (it signs with
// the Store A treasury TEST key read from the private devnet folder outside the repository, in this process only, never printed or given to the server), the API accepts the
// signed bytes, the keyless worker lane broadcasts and reconciles, and the chain is checked independently. Moves 2.7 test USDG (no monetary value).
//   BITPOS_BACKEND_INTEGRATION=1 BITPOS_DEVNET_REFUND_TEST=1 [BITPOS_DEVNET_PRIVATE_DIR=...] [BITPOS_DEVNET_RPC=...] tsx --test tests/order-refund-owner-devnet.test.ts
const run=process.env.BITPOS_BACKEND_INTEGRATION==='1'&&process.env.BITPOS_DEVNET_REFUND_TEST==='1';
const dir=process.env.BITPOS_DEVNET_PRIVATE_DIR??'/Users/cryptoclock/Desktop/BitPOS-Devnet-Private',rpc=process.env.BITPOS_DEVNET_RPC??'https://api.devnet.solana.com';
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
const keypair=(id:string)=>Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(dir,'keys',id+'.json'),'utf8'))));

test('owner-signed refund: the owner wallet signs, the keyless worker sends, devnet agrees',{skip:!run,timeout:300000},async()=>{
 const treasuryKey=keypair('merchant-a-treasury'),treasury=treasuryKey.publicKey.toBase58(),alice=keypair('customer-alice').publicKey.toBase58();
 const connection=new Connection(rpc,'confirmed');
 assert.equal(await connection.getGenesisHash(),'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','devnet only');
 const ata=(owner:string)=>getAssociatedTokenAddressSync(new PublicKey(USDG_ASSET.mint),new PublicKey(owner),false,TOKEN_2022_PROGRAM_ID);
 const balance=async(owner:string)=>BigInt((await connection.getTokenAccountBalance(ata(owner))).value.amount);
 const [treasuryBefore,aliceBefore]=[await balance(treasury),await balance(alice)];
 assert.ok(treasuryBefore>=2_700_000n,'the Store A treasury test wallet needs at least 2.7 test USDG');

 const f=await tableFixture();const {server}=await import('../apps/api/src/index');const {settleAttempt}=await import('../apps/api/src/orders');const {createOwnerSignedRefundWorker}=await import('../apps/worker/src/store-refund-runtime');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const owner=await staffToken(f.pool,f.merchant,randomUUID(),'owner');
 const call=async(method:string,path:string,body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${owner}`},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 const saved=process.env.BITPOS_STORE_REFUND_SOURCE_OWNER;delete process.env.BITPOS_STORE_REFUND_SOURCE_OWNER; // no server key mode
 try{
  const order=(await f.create(await f.quote(1))).order.id as string;
  const pg=await import('pg');const admin=new pg.default.Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1});await admin.query('UPDATE bitpos.merchants SET treasury=$2 WHERE id=$1',[f.merchant,treasury]);await admin.end();
  await f.tenant(f.merchant,async db=>{const a=(await fixturePaymentAttempt(db,{merchant:f.merchant,order,status:'SUBMITTED',signature:'sig'+randomUUID(),payer:alice})).rows[0]!;await settleAttempt(db,a,true);});
  const req=await call('POST',`/api/bills/orders/${order}/refund`,{reason:'ทดสอบเจ้าของร้านเซ็นคืนเงินบน devnet'});assert.equal(req.status,200,JSON.stringify(req.body));
  assert.deepEqual([req.body.refund.state,req.body.refund.signingMode,req.body.refund.amountMinor],['AWAITING_OWNER','owner','2700000']);

  // the API prepares; the "wallet" (this test) signs the prepared bytes; the API accepts them
  const prep=await call('POST',`/api/bills/orders/${order}/refund/prepare`,{});assert.equal(prep.status,200,JSON.stringify(prep.body));
  const tx=Transaction.from(Buffer.from(prep.body.unsignedBase64,'base64'));assert.equal(tx.verifySignatures(),false);tx.partialSign(treasuryKey);
  const submitted=await call('POST',`/api/bills/orders/${order}/refund/submit`,{base64:tx.serialize().toString('base64')});assert.equal(submitted.status,200,JSON.stringify(submitted.body));
  assert.equal(submitted.body.refund.state,'PREPARED');

  // the keyless worker lane sends those exact bytes and verifies the finalized transaction
  const lane=createOwnerSignedRefundWorker(connection as never,{work:async limit=>{const {pool}=await import('../apps/api/src/db');return (await pool.query('SELECT bitpos.order_refund_work($1,\'owner\') value',[limit])).rows[0].value.filter((w:any)=>w.merchantId===f.merchant);}});
  const outcomes:string[]=[];let state='PREPARED';
  for(let i=0;i<40&&state!=='FINALIZED'&&state!=='FAILED';i++){
   const r=await lane.tick();outcomes.push(Object.keys(r.outcomes).join(',')||r.status);
   state=(await call('GET',`/api/bills/orders/${order}`)).body.refund.state;
   if(state!=='FINALIZED')await new Promise(r=>setTimeout(r,4000));
  }
  console.log('owner-signed refund lane outcomes:',outcomes.join(' > '));
  const done=(await call('GET',`/api/bills/orders/${order}`)).body.refund;
  assert.equal(done.state,'FINALIZED',JSON.stringify(done));assert.equal(done.signature,submitted.body.refund.signature);
  console.log('devnet owner-signed refund signature:',done.signature);
  const status=(await connection.getSignatureStatuses([done.signature],{searchTransactionHistory:true})).value[0];
  assert.ok(status&&status.confirmationStatus==='finalized'&&!status.err,JSON.stringify(status));
  assert.equal(await balance(alice)-aliceBefore,2700000n,'the payer got exactly the refunded amount back');
  assert.equal(treasuryBefore-await balance(treasury),2700000n,'the treasury paid exactly that amount');
  assert.equal((await call('POST',`/api/bills/orders/${order}/refund`,{reason:'ซ้ำ'})).body.replayed,true,'a second request is a replay, never a second transfer');
 }finally{if(saved===undefined)delete process.env.BITPOS_STORE_REFUND_SOURCE_OWNER;else process.env.BITPOS_STORE_REFUND_SOURCE_OWNER=saved;await new Promise(r=>server.close(r));}
});
