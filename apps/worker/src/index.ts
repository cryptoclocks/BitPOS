import {pool,tenant} from '../../api/src/db';
import {chain,verifyTransfer,assertCluster,PaymentProofError} from '../../api/src/payments';
import {frozenAttempt} from '../../api/src/payment-assets';
import {settleAttempt,retireTerminalX402Settlements} from '../../api/src/orders';
import {expireUnpaidOrders} from '../../api/src/order-closure';
import type pg from 'pg';
import type {AttemptRow} from '../../api/src/types';
import {tickPromotions,tickPromotionJobs} from './promotions';
import type {PromotionJobFixture} from './promotions';
import {runWorkerLanes} from './lanes';
import {mayBroadcastGrantAttempt,finalizeGrantAttempt,maintainGrant,broadcastGrantLifecycle} from '../../api/src/delegated-payments';
import {clearTableOccupancy} from '../../api/src/table-occupancy';
import {randomUUID} from 'node:crypto';
import {reconcileOnlineAcceptance} from '../../api/src/mobile-food';
import {createFoodDispatchWorker} from './food-dispatch';
import {createMobilePushWorker} from './mobile-push';
import {createFoodSearchWorker} from './food-search';
import {readFoodNavigationConfig} from '../../api/src/food-navigation-provider';
import {createDriverSettlementRuntime} from './driver-settlement-runtime';
// Shared SQL test seam for the HTTP-submit/worker lock discipline. No RPC here.
export async function lockReconciliationAttempt(db:pg.PoolClient,orderId:string,attemptId:string):Promise<AttemptRow|null>{
 const order=(await db.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE SKIP LOCKED',[orderId])).rows[0];if(!order)return null;
 return (await db.query<AttemptRow>('SELECT * FROM payment_attempts WHERE id=$1 AND order_id=$2 FOR UPDATE',[attemptId,orderId])).rows[0]??null;
}
export async function reconcileMerchant(merchant:string){
 await tenant(merchant,async db=>{await expireUnpaidOrders(db,merchant);await retireTerminalX402Settlements(db,merchant);});
 const attempts=await tenant(merchant,async db=>(await db.query("SELECT id,order_id FROM payment_attempts WHERE status IN ('READY','SUBMITTING','SUBMITTED','CONFIRMED') OR (signature IS NOT NULL AND failure_reconciled_at IS NULL AND status<>'FINALIZED') ORDER BY CASE WHEN signature IS NOT NULL THEN 0 ELSE 1 END,created_at")).rows);
 for(const entry of attempts){try{
 const a=await tenant(merchant,async db=>{const row=await lockReconciliationAttempt(db,entry.order_id,entry.id);return row?frozenAttempt(db,row):null;});if(!a||a.status==='FINALIZED')continue;
 // Frozen payment proof/RPC uses a committed snapshot; no order or attempt lock crosses IO.
 let nextStatus:string|null=null,error:string|null=null;let failureReconciled=false;
 if(a.signature){
 if(a.status!=='CONFIRMED'){try{const confirmed=await verifyTransfer(a.signature,a,'confirmed');if(confirmed){const verifiedAt=new Date().toISOString();await tenant(merchant,db=>settleAttempt(db,a,false,verifiedAt));}}catch(error){if(!(error instanceof PaymentProofError))throw error;/* Confirmed rejection is not terminal: inspect finalized proof below. */}}
 const finalized=await verifyTransfer(a.signature,a,'finalized');if(finalized){const verifiedAt=new Date().toISOString();await tenant(merchant,db=>settleAttempt(db,a,true,verifiedAt));continue;}
 const status=(await chain.getSignatureStatuses([a.signature],{searchTransactionHistory:true})).value[0];if(status?.err&&status.confirmationStatus==='finalized'){nextStatus='FAILED';failureReconciled=true;error='Chain rejected payment';}else if(status)continue;
 }
 if(!nextStatus){const height=await chain.getBlockHeight('finalized');if(height>Number(a.last_valid_height)){
 // Finalized chain is past this blockhash validity; retain signed proof and verify no on-chain result before release.
 const finalStatus=a.signature?(await chain.getSignatureStatuses([a.signature],{searchTransactionHistory:true})).value[0]:null;
 if(finalStatus)continue;
 nextStatus='EXPIRED';failureReconciled=true;error='Transaction expired before on-chain settlement; no payment received';
 }else if(a.signature&&a.signed_base64){
 // Reconcile history before exact-byte rebroadcast; persisted signature precedes network send.
 try{await tenant(merchant,async db=>{const current=await lockReconciliationAttempt(db,a.order_id,a.id);if(!current||current.status==='FINALIZED'||current.failure_reconciled_at||!await mayBroadcastGrantAttempt(db,a.id))return;const signature=await chain.sendRawTransaction(Buffer.from(a.signed_base64!,'base64'),{skipPreflight:false,maxRetries:0});if(signature!==a.signature)throw Error('Signature mismatch');nextStatus='SUBMITTED';});}catch{error='Submission ambiguous; reconcile before retry';}
 }}
 if(nextStatus||error)await tenant(merchant,async db=>{const current=await lockReconciliationAttempt(db,a.order_id,a.id);if(!current||current.status==='FINALIZED')return;await db.query('UPDATE payment_attempts SET status=coalesce($2,status),error=$3,failure_reconciled_at=CASE WHEN $4 THEN clock_timestamp() ELSE failure_reconciled_at END WHERE id=$1',[a.id,nextStatus,error,failureReconciled]);if(failureReconciled){await finalizeGrantAttempt(db,current,'conclusive_failure');await retireTerminalX402Settlements(db,merchant);}});
 }catch(error){if(error instanceof PaymentProofError)await tenant(merchant,async db=>{const a=await lockReconciliationAttempt(db,entry.order_id,entry.id);if(a&&a.status!=='FINALIZED'){await db.query("UPDATE payment_attempts SET status='REJECTED',error='Payment proof rejected',failure_reconciled_at=clock_timestamp() WHERE id=$1",[a.id]);await finalizeGrantAttempt(db,a,'conclusive_failure');await retireTerminalX402Settlements(db,merchant);}});else console.error('Attempt reconciliation unavailable; durable state retained');}}
}
export async function tick(){
 const merchants=(await pool.query("SELECT merchant_id AS id FROM bitpos.reconciliation_queue() ORDER BY priority,merchant_id")).rows;
 if(!merchants.length)return;
 // Local unpaid expiry must release screens even when the Solana RPC is unavailable.
 try{await assertCluster();}catch(error){
  for(const merchant of merchants){try{await tenant(merchant.id,db=>expireUnpaidOrders(db,merchant.id));}catch{console.error('Local unpaid expiry unavailable; continuing other merchants');}}
  throw error;
 }
 for(const merchant of merchants){try{await reconcileMerchant(merchant.id);}catch{console.error('Merchant reconciliation unavailable; continuing other merchants');}}
}
export async function tickDelegatedGrants(){
 const grants=(await pool.query('SELECT merchant_id,grant_id FROM bitpos.delegated_work_queue()')).rows;
 for(const g of grants){try{
  await maintainGrant(g.merchant_id,g.grant_id);
  const pending=await tenant(g.merchant_id,async db=>(await db.query("SELECT kind FROM delegated_lifecycle WHERE merchant_id=$1 AND grant_id=$2 AND state='SIGNED'",[g.merchant_id,g.grant_id])).rows);
  for(const l of pending){try{await broadcastGrantLifecycle(g.merchant_id,g.grant_id,l.kind);}catch{/* A known lifecycle signature stays recoverable; no replacement authorization. */}}
 }catch{console.error('Delegated lifecycle unavailable; durable state retained');}}
}
export async function tickTableOccupancies(){
 const due=(await pool.query('SELECT * FROM bitpos.table_occupancy_work_queue()')).rows;
 for(const table of due)try{await tenant(table.merchant_id,db=>clearTableOccupancy(db,table.merchant_id,'inactivity-worker','staff',table.table_id,{expectedGeneration:table.generation,idempotencyKey:randomUUID(),confirmClear:true},'INACTIVITY'));}catch(error){
  if(!(error instanceof Error&&['TABLE_CLEAR_BLOCKED','TABLE_OCCUPANCY_CHANGED','ORDER_NOT_RELEASABLE'].includes(error.message)))console.error('Table inactivity reconciliation unavailable; durable state retained');
 }
}
export async function tickOnlineAcceptance(){
 const merchants=(await pool.query<{merchant_id:string}>('SELECT * FROM bitpos.online_acceptance_work_queue()')).rows;
 for(const {merchant_id:merchant} of merchants){
  const rows=await tenant(merchant,async db=>(await db.query<{order_id:string}>(`SELECT f.order_id FROM online_food_orders f JOIN orders o ON o.merchant_id=f.merchant_id AND o.id=f.order_id
   WHERE f.merchant_id=$1 AND ((f.acceptance_status='PENDING' AND f.acceptance_deadline<=clock_timestamp())
   OR (f.acceptance_status IN ('REJECTED','TIMED_OUT') AND (NOT o.reservation_released OR EXISTS(SELECT 1 FROM payments p WHERE p.merchant_id=f.merchant_id AND p.order_id=f.order_id AND NOT EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=p.id))))) ORDER BY f.order_id`,[merchant])).rows);
  for(const row of rows)try{await tenant(merchant,db=>reconcileOnlineAcceptance(db,merchant,row.order_id));}
  catch{console.error('Online acceptance disposition unavailable; durable state retained');}
 }
}
/** Fixture injection is test-only; production uses the private configured provider. */
export async function runWorker(signal:AbortSignal,fixture?:PromotionJobFixture){
 const dispatch=createFoodDispatchWorker(process.env.BITPOS_FOOD_DISPATCH_DATABASE_URL);
 if(!dispatch)console.error('Food discovery retention unavailable: configure dedicated BITPOS_FOOD_DISPATCH_DATABASE_URL before enabling the service');
 let search:ReturnType<typeof createFoodSearchWorker>=null;
 let push:ReturnType<typeof createMobilePushWorker>=null;
 let settlement:ReturnType<typeof createDriverSettlementRuntime>|null=null;
 let settlementStatus='';
 try{
  if(process.env.BITPOS_FOOD_SEARCH_DATABASE_URL!==undefined)search=createFoodSearchWorker(process.env.BITPOS_FOOD_SEARCH_DATABASE_URL,readFoodNavigationConfig(process.env));
  if(!search)console.error('Automatic food search unavailable: configure dedicated BITPOS_FOOD_SEARCH_DATABASE_URL before enabling the service');
  push=createMobilePushWorker(process.env.BITPOS_MOBILE_PUSH_DATABASE_URL);
  if(!push)console.error('Mobile phone notifications unavailable: configure dedicated BITPOS_MOBILE_PUSH_DATABASE_URL; no provider delivery asserted');
  try{settlement=createDriverSettlementRuntime();}catch{console.error('Driver settlement configuration unavailable; no payout signing or sending enabled');}
  await runWorkerLanes([
  {tick,unavailable:'Reconciliation unavailable; durable state retained'},
  {tick:tickOnlineAcceptance,unavailable:'Online acceptance unavailable; durable state retained'},
  {tick:tickDelegatedGrants,unavailable:'Delegated lifecycle unavailable; durable state retained'},
  {tick:tickPromotions,unavailable:'Promotion lifecycle unavailable; durable state retained'},
  {tick:tickTableOccupancies,unavailable:'Table inactivity reconciliation unavailable; durable state retained'},
  {tick:()=>tickPromotionJobs(signal,fixture),unavailable:'Promotion generation unavailable; durable state retained'},
  ...(dispatch?[{tick:dispatch.tick,unavailable:'Private food discovery maintenance unavailable'}]:[]),
  ...(search?[{tick:()=>search!.tick(signal),unavailable:'Automatic food ranking unavailable; durable search retained'}]:[]),
  ...(push?[{tick:push.tick,unavailable:'Mobile notification transport unavailable; durable opaque deliveries retained'}]:[]),
  ...(settlement?[{tick:async()=>{const result=await settlement!.worker.tick(signal),status=result.status+':'+Object.keys(result.reasons).sort().join(',');if(status!==settlementStatus){settlementStatus=status;if(result.status!=='AVAILABLE')console.error('Driver settlement: '+result.status+'; no transfer inferred; reasons='+Object.keys(result.reasons).sort().join(','));}},unavailable:'Driver settlement unavailable; durable reserves retained'}]:[]),
 ],signal);}finally{await Promise.all([search?.close(),dispatch?.close(),push?.close(),settlement?.close()]);}
}
async function run(){
 const stop=new AbortController(),shutdown=()=>stop.abort();
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
 try{await runWorker(stop.signal);}finally{process.removeListener('SIGTERM',shutdown);process.removeListener('SIGINT',shutdown);await pool.end();}
}
if(process.argv[1]?.endsWith('/worker/src/index.ts'))void run();
