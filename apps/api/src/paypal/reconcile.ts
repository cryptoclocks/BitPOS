// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Worker pass for PayPal checkouts that are waiting on PayPal. All state is in the database and every PayPal call reuses
// the checkout's stored PayPal-Request-Id, so a crash or restart at any point resumes without a second order or capture.
//   CREATING  (create outcome unknown)  → resend create with the same request id
//   CREATED   past its quote            → EXPIRED (no PayPal call; an unapproved PayPal order simply lapses)
//   APPROVED  (approved, not captured)  → capture if the bill is still payable, else EXPIRED
//   CAPTURING/UNKNOWN                   → resend capture (same id), then settle from PayPal's answer
//   PENDING                             → look up the capture until PayPal completes or declines it
import {pool,tenant} from '../db';
import {routingLock} from '../authority';
import {promotionsRequest} from '../promotions';
import {createPayPalOrder,advanceCheckout,type PayPalDeps} from './checkout';
import {processWebhookInbox} from './webhook';

const BATCH=20;
/** Backoff after a pass that changed nothing: 15 s, 30 s … capped at 10 minutes (PENDING at 5 minutes). */
const backoff=(attempts:number,pending:boolean)=>pending?300:Math.min(600,15*2**Math.min(attempts,6));

export async function reconcilePayPalMerchant(merchant:string,d:PayPalDeps){
 const due=await tenant(merchant,async db=>(await db.query<{id:string;status:string;attempts:number;access_token:string}>(`
  SELECT c.id,c.status,c.attempts,o.access_token FROM paypal_checkouts c JOIN orders o ON o.merchant_id=c.merchant_id AND o.id=c.order_id
  WHERE c.merchant_id=$1 AND (
   c.status IN ('CREATING','APPROVED','CAPTURING','PENDING','UNKNOWN') AND (c.next_check_at IS NULL OR c.next_check_at<=clock_timestamp())
   OR c.status='CREATED' AND c.expires_at<=clock_timestamp())
  ORDER BY c.next_check_at NULLS FIRST,c.created_at LIMIT $2`,[merchant,BATCH])).rows);
 for(const k of due){
  try{
   if(k.status==='CREATED'){
    await tenant(merchant,db=>db.query("UPDATE paypal_checkouts SET status='EXPIRED',last_issue='QUOTE_EXPIRED' WHERE merchant_id=$1 AND id=$2 AND status='CREATED' AND expires_at<=clock_timestamp()",[merchant,k.id]));
    continue;
   }
   if(k.status==='CREATING'){await createPayPalOrder(k.access_token);}
   else await advanceCheckout(merchant,k.id,k.status==='PENDING'?'lookup':'capture',d,'order_lookup');
   // Still waiting (outcome unknown, PENDING review, …): schedule the next look with backoff.
   await tenant(merchant,db=>db.query(`UPDATE paypal_checkouts SET next_check_at=clock_timestamp()+($3||' seconds')::interval
    WHERE merchant_id=$1 AND id=$2 AND status IN ('CREATING','APPROVED','CAPTURING','PENDING','UNKNOWN')`,[merchant,k.id,String(backoff(k.attempts,k.status==='PENDING'))]));
  }catch(error){
   console.error('PayPal reconcile deferred',k.id,(error as Error).message);
   await tenant(merchant,db=>db.query("UPDATE paypal_checkouts SET next_check_at=clock_timestamp()+interval '60 seconds' WHERE merchant_id=$1 AND id=$2",[merchant,k.id])).catch(()=>{/* next pass */});
  }
 }
 return due.length;
}

/** Ends Copilot offers past their end time and takes sold-out offers off the menu (revokes the live campaign). */
export async function endCopilotOffers(merchant:string){
 await tenant(merchant,db=>db.query("UPDATE paypal_campaign_envelopes SET state='ENDED',ended_reason='TIME' WHERE merchant_id=$1 AND state='APPROVED' AND ends_at<=clock_timestamp()",[merchant]));
 const live=await tenant(merchant,async db=>(await db.query<{envelope:string;campaign:string;version:number}>(`SELECT e.id AS envelope,p.id AS campaign,p.version FROM paypal_campaign_envelopes e
  JOIN promotion_campaigns p ON p.merchant_id=e.merchant_id AND p.id=e.campaign_id WHERE e.merchant_id=$1 AND e.state='ENDED' AND p.state='APPROVED'`,[merchant])).rows);
 for(const x of live){
  try{await tenant(merchant,async db=>{await routingLock(db,merchant);await promotionsRequest(db,merchant,'paypal-worker','owner',`/api/promotions/${x.campaign}/revoke`,'POST',{expectedVersion:x.version,idempotencyKey:'copilot-end-'+x.envelope});});}
  catch{console.error('Copilot offer end deferred',x.envelope);}
 }
}

/** One worker pass: webhook inbox first (cheap, already verified), then due checkouts across shops. */
export async function tickPayPal(d:PayPalDeps){
 await processWebhookInbox(d);
 const merchants=(await pool.query<{merchant_id:string}>('SELECT merchant_id FROM bitpos.paypal_due_merchants()')).rows;
 for(const m of merchants){try{await reconcilePayPalMerchant(m.merchant_id,d);await endCopilotOffers(m.merchant_id);}catch{console.error('PayPal reconcile unavailable for a shop; durable state retained');}}
}
