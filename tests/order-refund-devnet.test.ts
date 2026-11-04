import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Connection,Keypair} from '@solana/web3.js';
import {tableFixture,staffToken} from './backend-table-fixture';
import {fixturePaymentAttempt} from './backend-payment-fixture';
import {USDG_ASSET} from '../packages/domain/src/payment-assets';
// OPT-IN. Sends a REAL Solana DEVNET transfer of 2.7 test USDG (no monetary value) from the Store A treasury test wallet to Customer Alice's test wallet through the
// production store-refund worker, and checks the result on chain independently. Needs the private devnet wallet folder (outside the repository, keys never printed).
//   BITPOS_BACKEND_INTEGRATION=1 BITPOS_DEVNET_REFUND_TEST=1 [BITPOS_DEVNET_PRIVATE_DIR=...] [BITPOS_DEVNET_RPC=...] tsx --test tests/order-refund-devnet.test.ts
const run=process.env.BITPOS_BACKEND_INTEGRATION==='1'&&process.env.BITPOS_DEVNET_REFUND_TEST==='1';
const dir=process.env.BITPOS_DEVNET_PRIVATE_DIR??'/Users/cryptoclock/Desktop/BitPOS-Devnet-Private',rpc=process.env.BITPOS_DEVNET_RPC??'https://api.devnet.solana.com';
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
const wallet=(id:string)=>{const kp=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(dir,'keys',id+'.json'),'utf8'))));return {address:kp.publicKey.toBase58(),file:join(dir,'keys',id+'.json')};};

test('a paid counter order is refunded for real on devnet by the store refund worker and the chain agrees',{skip:!run,timeout:240000},async()=>{
 const treasury=wallet('merchant-a-treasury'),alice=wallet('customer-alice');
 const connection=new Connection(rpc,'confirmed');
 assert.equal(await connection.getGenesisHash(),'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','devnet only');
 const {getAssociatedTokenAddressSync,TOKEN_2022_PROGRAM_ID}=await import('@solana/spl-token');const {PublicKey}=await import('@solana/web3.js');
 const ata=(owner:string)=>getAssociatedTokenAddressSync(new PublicKey(USDG_ASSET.mint),new PublicKey(owner),false,TOKEN_2022_PROGRAM_ID);
 const balance=async(owner:string)=>BigInt((await connection.getTokenAccountBalance(ata(owner))).value.amount);
 const [treasuryBefore,aliceBefore]=[await balance(treasury.address),await balance(alice.address)];

 const f=await tableFixture();const {server}=await import('../apps/api/src/index');const {settleAttempt}=await import('../apps/api/src/orders');const {createStoreRefundRuntime}=await import('../apps/worker/src/store-refund-runtime');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const owner=await staffToken(f.pool,f.merchant,randomUUID(),'owner');
 const call=async(method:string,path:string,body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${owner}`},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 const saved={owner:process.env.BITPOS_STORE_REFUND_SOURCE_OWNER};
 try{
  const order=(await f.create(await f.quote(1))).order.id as string;
  await f.tenant(f.merchant,async db=>{await db.query('UPDATE merchants SET treasury=$2 WHERE id=$1',[f.merchant,treasury.address]).catch(()=>undefined);const a=(await fixturePaymentAttempt(db,{merchant:f.merchant,order,status:'SUBMITTED',signature:'sig'+randomUUID(),payer:alice.address})).rows[0]!;await settleAttempt(db,a,true);});
  // the treasury address of a fixture shop is set by a privileged statement (the app role cannot change it here)
  const {pool}=await import('../apps/api/src/db');void pool;
  process.env.BITPOS_STORE_REFUND_SOURCE_OWNER=treasury.address;
  const pg=await import('pg');const admin=new pg.default.Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1});await admin.query('UPDATE bitpos.merchants SET treasury=$2 WHERE id=$1',[f.merchant,treasury.address]);await admin.end();
  const req=await call('POST',`/api/bills/orders/${order}/refund`,{reason:'ทดสอบคืนเงินจริงบน devnet'});assert.equal(req.status,200,JSON.stringify(req.body));
  const refund=req.body.refund;assert.equal(refund.amountMinor,'2700000');

  const runtime=createStoreRefundRuntime({BITPOS_STORE_REFUND_ENABLED:'1',BITPOS_STORE_REFUND_RPC_URL:rpc,BITPOS_STORE_REFUND_SOURCE_KEY_PATH:treasury.file,
   BITPOS_STORE_REFUND_PUBLIC_CONFIG:JSON.stringify({sourceOwner:treasury.address,feePayerOwner:treasury.address,allowedAssetIds:[USDG_ASSET.assetId],maxAmountMinor:'10000000',maxFeeLamports:100000,maxTotalLamports:3000000,maxAttemptsPerTick:3})} as never);
  const outcomes:string[]=[];let state='SIGNING';
  for(let i=0;i<40&&state!=='FINALIZED'&&state!=='FAILED';i++){
   const r=await runtime.worker.tick();outcomes.push(Object.keys(r.outcomes).join(',')||r.status);
   state=(await call('GET',`/api/bills/orders/${order}`)).body.refund.state;
   if(state!=='FINALIZED')await new Promise(r=>setTimeout(r,4000));
  }
  console.log('refund worker outcomes:',outcomes.join(' > '));
  const done=(await call('GET',`/api/bills/orders/${order}`)).body.refund;
  assert.equal(done.state,'FINALIZED',JSON.stringify(done));assert.ok(done.signature);
  console.log('devnet refund signature:',done.signature);
  // the chain agrees, independently of what the database says
  const status=(await connection.getSignatureStatuses([done.signature],{searchTransactionHistory:true})).value[0];
  assert.ok(status&&status.confirmationStatus==='finalized'&&!status.err,JSON.stringify(status));
  assert.equal(await balance(alice.address)-aliceBefore,2700000n,'the payer got exactly the refunded amount back');
  assert.equal(treasuryBefore-await balance(treasury.address),2700000n,'the treasury paid exactly that amount');
  // a second request for the same order is a replay, never a second transfer
  assert.equal((await call('POST',`/api/bills/orders/${order}/refund`,{reason:'ทดสอบคืนเงินจริงบน devnet'})).body.replayed,true);
 }finally{if(saved.owner===undefined)delete process.env.BITPOS_STORE_REFUND_SOURCE_OWNER;else process.env.BITPOS_STORE_REFUND_SOURCE_OWNER=saved.owner;await new Promise(r=>server.close(r));}
});
