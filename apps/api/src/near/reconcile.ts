// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Reconcile lane: every live bill is re-read from the contract, so a lost answer, a closed browser or a restarted
// process never leaves a bill in the wrong state. Effects go through advanceBill, which applies each one once.
import {pool,tenant} from '../db';
import {advanceBill,billsBy,openOnChain,payoutsOf,reclaimNow,record,type NearDeps} from './bills';

const GRACE_MS=5_000;
export async function tickNear(d:NearDeps,limit=20){
 const due=(await pool.query<{merchant_id:string;bill_id:string}>('SELECT merchant_id,bill_id FROM bitpos.near_due_bills($1)',[limit])).rows;
 for(const {merchant_id:merchant,bill_id:id} of due)await tickNearBill(merchant,id,d);
 return due.length;
}
/** One bill's reconcile step. Never throws: a failure leaves the durable state and schedules another look. */
export async function tickNearBill(merchant:string,id:string,d:NearDeps){
 const now=d.now??Date.now;
 {
  try{
   const {k,payouts}=await tenant(merchant,async db=>({k:(await billsBy(db,'merchant_id=$1 AND id=$2',[merchant,id])).rows[0],payouts:await payoutsOf(db,merchant,id)}));
   if(!k)return;
   if(k.status==='OPENING'){await openOnChain(merchant,k,payouts,d);return;}
   const r=await advanceBill(merchant,id,d);
   if(r.k.status==='OPEN'){
    // Unpaid and no longer payable (expired quote or closed order): void it on chain so a late payment bounces.
    const payable=['AWAITING_WALLET','AWAITING_PAYMENT'].includes(r.order.status)&&r.k.expires_at.getTime()>now();
    if(!payable){
     const tx=await d.chain.voidBill(r.k.merchant_account,r.k.chain_bill_id).catch(()=>null);
     if(tx?.ok)await tenant(merchant,db=>record(db,merchant,id,'VOIDED',tx.hash,{reason:'NOT_PAYABLE'}));
     await advanceBill(merchant,id,d);
    }else await tenant(merchant,db=>db.query("UPDATE near_bills SET next_check_at=clock_timestamp()+interval '4 seconds' WHERE merchant_id=$1 AND id=$2 AND status='OPEN'",[merchant,id]));
   }else if(['ESCROW','PAYOUT_FAILED'].includes(r.k.status)&&r.k.paid_at&&now()>r.k.paid_at.getTime()+r.k.witness_timeout_ms+GRACE_MS){
    // The witness never confirmed (or the split failed): the money goes back to the payer by itself.
    await reclaimNow(merchant,r.k,d);
   }else if(['ESCROW','SETTLING','PAYOUT_FAILED'].includes(r.k.status)){
    await tenant(merchant,db=>db.query("UPDATE near_bills SET next_check_at=clock_timestamp()+interval '4 seconds' WHERE merchant_id=$1 AND id=$2 AND status=ANY($3)",[merchant,id,['ESCROW','SETTLING','PAYOUT_FAILED']]));
   }
  }catch(error){
   console.error('NEAR reconcile failed for one bill; durable state retained',(error as Error).message);
   await tenant(merchant,db=>db.query("UPDATE near_bills SET next_check_at=clock_timestamp()+interval '15 seconds' WHERE merchant_id=$1 AND id=$2",[merchant,id])).catch(()=>undefined);
  }
 }
}
