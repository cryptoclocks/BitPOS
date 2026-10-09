import {setTimeout as delay} from 'node:timers/promises';
import {pool,tenant} from '../../api/src/db';
import {chain,verifyTransfer,assertCluster,mintPolicy,PaymentProofError} from '../../api/src/payments';
import {settleAttempt} from '../../api/src/orders';
import {expireUnpaidOrders} from '../../api/src/order-closure';
import type pg from 'pg';
import type {AttemptRow} from '../../api/src/types';
// Shared SQL test seam for the HTTP-submit/worker lock discipline. No RPC here.
export async function lockReconciliationAttempt(db:pg.PoolClient,orderId:string,attemptId:string):Promise<AttemptRow|null>{
 const order=(await db.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE SKIP LOCKED',[orderId])).rows[0];if(!order)return null;
 return (await db.query<AttemptRow>('SELECT * FROM payment_attempts WHERE id=$1 AND order_id=$2 FOR UPDATE',[attemptId,orderId])).rows[0]??null;
}
export async function reconcileMerchant(merchant:string){
 await tenant(merchant,db=>expireUnpaidOrders(db,merchant));
 const attempts=await tenant(merchant,async db=>(await db.query("SELECT id,order_id FROM payment_attempts WHERE status IN ('READY','SUBMITTING','SUBMITTED','CONFIRMED') OR (status='EXPIRED' AND signature IS NOT NULL AND failure_reconciled_at IS NULL) ORDER BY CASE WHEN status IN ('SUBMITTING','SUBMITTED','CONFIRMED') THEN 0 ELSE 1 END,created_at")).rows);
 for(const entry of attempts){try{
 const a=await tenant(merchant,db=>lockReconciliationAttempt(db,entry.order_id,entry.id));if(!a||!['READY','SUBMITTING','SUBMITTED','CONFIRMED','EXPIRED'].includes(a.status))continue;
 // Frozen payment proof/RPC uses a committed snapshot; no order or attempt lock crosses IO.
 let nextStatus:string|null=null,error:string|null=null;let failureReconciled=false;
 if(a.signature){
 if(a.status!=='CONFIRMED'){const confirmed=await verifyTransfer(a.signature,a,'confirmed');if(confirmed){const verifiedAt=new Date().toISOString();await tenant(merchant,db=>settleAttempt(db,a,false,verifiedAt));}}
 const finalized=await verifyTransfer(a.signature,a,'finalized');if(finalized){const verifiedAt=new Date().toISOString();await tenant(merchant,db=>settleAttempt(db,a,true,verifiedAt));continue;}
 const status=(await chain.getSignatureStatuses([a.signature],{searchTransactionHistory:true})).value[0];if(status?.err){nextStatus='FAILED';error='Chain rejected payment';}else if(status)continue;
 }
 if(!nextStatus){const height=await chain.getBlockHeight('finalized');if(height>Number(a.last_valid_height)){
 // Finalized chain is past this blockhash validity; retain signed proof and verify no on-chain result before release.
 const finalStatus=a.signature?(await chain.getSignatureStatuses([a.signature],{searchTransactionHistory:true})).value[0]:null;
 if(finalStatus)continue;
 nextStatus='EXPIRED';failureReconciled=true;error='Transaction expired before on-chain settlement; no payment received';
 }else if(a.signature&&a.signed_base64){
 // Reconcile history before exact-byte rebroadcast; persisted signature precedes network send.
 try{const signature=await chain.sendRawTransaction(Buffer.from(a.signed_base64,'base64'),{skipPreflight:false,maxRetries:0});if(signature!==a.signature)throw Error('Signature mismatch');nextStatus='SUBMITTED';}catch{error='Submission ambiguous; reconcile before retry';}
 }}
 if(nextStatus||error)await tenant(merchant,async db=>{const current=await lockReconciliationAttempt(db,a.order_id,a.id);if(!current||!['READY','SUBMITTING','SUBMITTED','EXPIRED'].includes(current.status))return;await db.query('UPDATE payment_attempts SET status=coalesce($2,status),error=$3,failure_reconciled_at=CASE WHEN $4 THEN clock_timestamp() ELSE failure_reconciled_at END WHERE id=$1',[a.id,nextStatus,error,failureReconciled]);});
 }catch(error){if(error instanceof PaymentProofError)await tenant(merchant,async db=>{const a=await lockReconciliationAttempt(db,entry.order_id,entry.id);if(a&&['READY','SUBMITTING','SUBMITTED','CONFIRMED','EXPIRED'].includes(a.status))await db.query("UPDATE payment_attempts SET status='REJECTED',error='Payment proof rejected' WHERE id=$1",[a.id]);});else console.error('Attempt reconciliation unavailable; durable state retained');}}
}
export async function tick(){
 const merchants=(await pool.query("SELECT merchant_id AS id FROM bitpos.reconciliation_queue() ORDER BY priority,merchant_id")).rows;
 if(!merchants.length)return;
 // Local unpaid expiry must release screens even when the Solana RPC is unavailable.
 try{await assertCluster();await mintPolicy();}catch(error){
  for(const merchant of merchants){try{await tenant(merchant.id,db=>expireUnpaidOrders(db,merchant.id));}catch{console.error('Local unpaid expiry unavailable; continuing other merchants');}}
  throw error;
 }
 for(const merchant of merchants){try{await reconcileMerchant(merchant.id);}catch{console.error('Merchant reconciliation unavailable; continuing other merchants');}}
}
let stopping=false;process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
async function run(){while(!stopping){try{await tick();}catch{console.error('Reconciliation unavailable; durable state retained');}await delay(750);}await pool.end();}
if(process.argv[1]?.endsWith('/worker/src/index.ts'))void run();
