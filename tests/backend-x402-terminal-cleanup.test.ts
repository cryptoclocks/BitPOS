import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tableFixture} from './backend-table-fixture';
import {fixturePaymentAttempt} from './backend-payment-fixture';
import type {OrderRow} from '../apps/api/src/types';

test('terminal SDK cleanup preserves unknown signed recovery and immutable financial history',{skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1',timeout:60000},async()=>{
 // SQL verifier fixture only. No wallet, transaction dispatch or chain proof.
 // Intentional loading boundary: skipped integration never loads private config.
 const {retireTerminalX402Settlements,settleAttempt}=await import('../apps/api/src/orders');
 const {selectPaymentAsset}=await import('../apps/api/src/payment-assets');
 const f=await tableFixture(4),created=await f.create(await f.quote());
 const db=await f.pool.connect();
 try{
  await db.query('BEGIN');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[f.merchant]);
  await db.query("INSERT INTO merchant_payment_assets(merchant_id,asset_id,enabled,policy) VALUES($1,'usdc-devnet',true,$2)",[f.merchant,{id:'USD_CENTS_TO_USDC_1_TO_1',numerator:'10000',denominator:'1'}]);
  const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[f.merchant,created.order.id])).rows[0];
  const selected=await selectPaymentAsset(db,o,{assetId:'usdc-devnet',expectedVersion:o.version,idempotencyKey:randomUUID()});
  const a=(await fixturePaymentAttempt(db,{merchant:f.merchant,order:o.id,status:'SUBMITTED',signature:randomUUID()})).rows[0];
  const quote=(await db.query('SELECT quote_id FROM order_payment_selection WHERE merchant_id=$1 AND order_id=$2',[f.merchant,o.id])).rows[0].quote_id;
  const blockhash='SQL-only-expiry-fixture',memo='SQL-only-no-broadcast';
  const binding={kind:'x402',merchantId:f.merchant,orderId:o.id,attemptId:a.id,quoteId:quote,owner:a.payer,transferAuthority:a.payer,resource:'https://fixture.invalid/pay',memo,feePayer:'SQL-only-sponsor',blockhash,lastValidHeight:'1',requirements:{scheme:'exact',network:'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',asset:'4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',amount:a.amount_minor,payTo:a.recipient,maxTimeoutSeconds:60,extra:{feePayer:'SQL-only-sponsor',memo,recentBlockhash:blockhash,lastValidBlockHeight:'1'}}};
  await db.query('INSERT INTO x402_attempt_bindings(merchant_id,order_id,attempt_id,quote_id,binding) VALUES($1,$2,$3,$4,$5)',[f.merchant,o.id,a.id,quote,binding]);
  const pending=()=>db.query('SELECT signature FROM x402_pending_settlements WHERE merchant_id=$1 AND attempt_id=$2',[f.merchant,a.id]);
  await db.query('INSERT INTO x402_pending_settlements(merchant_id,attempt_id,message_hash,signature) VALUES($1,$2,$3,$4)',[f.merchant,a.id,'SQL-only-message-hash',a.signature]);
  const original=(await db.query('SELECT signature,signed_base64,transaction_base64 FROM payment_attempts WHERE merchant_id=$1 AND id=$2',[f.merchant,a.id])).rows[0];
  for(const status of ['SUBMITTED','EXPIRED','FAILED','REJECTED']){
   await db.query('UPDATE payment_attempts SET status=$3 WHERE merchant_id=$1 AND id=$2',[f.merchant,a.id,status]);
   await retireTerminalX402Settlements(db,f.merchant);
   assert.deepEqual((await pending()).rows,[{signature:a.signature}],status+' without authoritative reconciliation remains unknown');
  }
  await db.query('SAVEPOINT conclusive_expiry');
  await db.query("UPDATE payment_attempts SET status='EXPIRED',failure_reconciled_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2",[f.merchant,a.id]);
  await retireTerminalX402Settlements(db,f.merchant);assert.equal((await pending()).rowCount,0);
  assert.deepEqual((await db.query('SELECT signature,signed_base64,transaction_base64 FROM payment_attempts WHERE merchant_id=$1 AND id=$2',[f.merchant,a.id])).rows[0],original);
  await db.query('ROLLBACK TO SAVEPOINT conclusive_expiry');
  await db.query("UPDATE payment_attempts SET status='SUBMITTED' WHERE merchant_id=$1 AND id=$2",[f.merchant,a.id]);
  await settleAttempt(db,a,false);assert.equal((await pending()).rowCount,1,'confirmed is not finalized truth');
  await settleAttempt(db,a,true);assert.equal((await pending()).rowCount,0,'finalized settlement retires sidecar in the same transaction');
  await settleAttempt(db,a,true);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM payments WHERE merchant_id=$1 AND order_id=$2 AND state='SETTLED'",[f.merchant,o.id])).rows[0].n,1);
  assert.deepEqual((await db.query('SELECT stock,reserved FROM products WHERE merchant_id=$1 AND id=$2',[f.merchant,f.product])).rows[0],{stock:3,reserved:0});
  assert.deepEqual((await db.query('SELECT signature,signed_base64,transaction_base64 FROM payment_attempts WHERE merchant_id=$1 AND id=$2',[f.merchant,a.id])).rows[0],original);
  await db.query('INSERT INTO x402_pending_settlements(merchant_id,attempt_id,message_hash,signature) VALUES($1,$2,$3,$4)',[f.merchant,a.id,'SQL-only-crash-retained-hash',a.signature]);
  assert.equal((await db.query('SELECT priority FROM bitpos.reconciliation_queue() WHERE merchant_id=$1',[f.merchant])).rows[0]?.priority,3,'terminal crash sidecar must remain discoverable without unresolved payment/order');
  await retireTerminalX402Settlements(db,f.merchant);assert.equal((await pending()).rowCount,0);
  assert.equal((await db.query('SELECT 1 FROM bitpos.reconciliation_queue() WHERE merchant_id=$1',[f.merchant])).rowCount,0,'drained terminal sidecar must leave the work queue');
  assert.equal(selected.order.settlement.amountMinor,'2700000');
 }finally{await db.query('ROLLBACK');db.release();}
});
