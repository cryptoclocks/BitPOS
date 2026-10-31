// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Turns a server-fetched, verified PayPal result into ledger facts inside the caller's tenant transaction:
// the capture row, the checkout state and — only for a COMPLETED capture — the atomic settlement and publication.
import type pg from 'pg';
import {publishSettlementRow} from '../orders';
import type {Verdict} from './verify';
import type {PayPalCapture} from './client';

export type VerifiedVia='capture_response'|'order_lookup'|'capture_lookup';
export interface CheckoutRow {merchant_id:string;id:string;order_id:string;quote_id:string;order_version:number;amount_cents:string;currency:'USD';payee_merchant_id:string;
 create_request_id:string;capture_request_id:string;invoice_id:string;paypal_order_id:string|null;status:string;expires_at:Date;last_issue:string|null;}

const LIVE=['CREATING','CREATED','APPROVED','CAPTURING','PENDING','UNKNOWN'];
const cents=(v:bigint|null)=>v===null?null:v.toString();
/** Redacted PayPal facts kept as evidence: ids, statuses and money only — no payer identity. */
function redacted(c:PayPalCapture,via:VerifiedVia,debugId:string|null){
 return {captureId:c.id,status:c.status,reason:c.reason,currency:c.currency,value:cents(c.valueCents),gross:cents(c.grossCents),fee:cents(c.feeCents),net:cents(c.netCents),
  finalCapture:c.finalCapture,customId:c.customId,invoiceId:c.invoiceId,createTime:c.createTime,via,debugId};
}

async function storeCapture(db:pg.PoolClient,k:CheckoutRow,c:PayPalCapture,via:VerifiedVia,debugId:string|null,mismatch:string[]|null){
 const status=c.status==='COMPLETED'||c.status==='PENDING'||c.status==='REFUNDED'||c.status==='PARTIALLY_REFUNDED'||c.status==='DECLINED'?c.status:'FAILED';
 // A capture id seen before keeps its first verification; only the PayPal status can move (PENDING → COMPLETED → REFUNDED).
 await db.query(`INSERT INTO paypal_captures(merchant_id,capture_id,checkout_id,status,status_reason,gross_cents,fee_cents,net_cents,currency,payee_merchant_id,verified_via,verified,mismatch,redacted)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,'USD',$9,$10,$11,$12,$13)
  ON CONFLICT(merchant_id,capture_id) DO UPDATE SET status=EXCLUDED.status,status_reason=EXCLUDED.status_reason,updated_at=clock_timestamp()
   WHERE paypal_captures.checkout_id=EXCLUDED.checkout_id AND paypal_captures.verified AND EXCLUDED.verified`,
  [k.merchant_id,c.id,k.id,status,c.reason,(c.grossCents??c.valueCents??0n).toString(),cents(c.feeCents),cents(c.netCents),k.payee_merchant_id,via,mismatch===null,mismatch,redacted(c,via,debugId)]);
}

export type ApplyResult={outcome:'PAID'|'RECOVERY'|'ALREADY_SETTLED'|'PENDING'|'DECLINED'|'NO_CAPTURE'|'MISMATCH'|'REFUNDED';captureId:string|null};

/**
 * Applies a verdict for a locked checkout row. Must run in the tenant transaction that locked the order and checkout.
 * Callers: capture route, webhook processor and reconcile worker — all converge here, so effects happen once.
 */
export async function applyVerdict(db:pg.PoolClient,k:CheckoutRow,v:Verdict,via:VerifiedVia,debugId:string|null,occurredAt=new Date().toISOString()):Promise<ApplyResult>{
 if(v.state==='MISMATCH'){
  // Never settle and never auto-resolve: keep the evidence and stop the checkout for the merchant to review.
  if(v.capture&&v.capture.grossCents!==null)await storeCapture(db,k,v.capture,via,debugId,v.reasons);
  if(k.status!=='CAPTURED')await db.query("UPDATE paypal_checkouts SET status='MISMATCH',last_issue=$3,last_debug_id=$4 WHERE merchant_id=$1 AND id=$2",[k.merchant_id,k.id,v.reasons.join(',').slice(0,120),debugId]);
  return {outcome:'MISMATCH',captureId:v.capture?.id??null};
 }
 if(v.state==='NONE')return {outcome:'NO_CAPTURE',captureId:null};
 await storeCapture(db,k,v.capture,via,debugId,null);
 if(v.state==='PENDING'){
  if(LIVE.includes(k.status))await db.query("UPDATE paypal_checkouts SET status='PENDING',last_issue=$3,last_debug_id=$4 WHERE merchant_id=$1 AND id=$2",[k.merchant_id,k.id,v.capture.reason,debugId]);
  return {outcome:'PENDING',captureId:v.capture.id};
 }
 if(v.state==='DECLINED'){
  if(LIVE.includes(k.status))await db.query("UPDATE paypal_checkouts SET status='DECLINED',last_issue=$3,last_debug_id=$4 WHERE merchant_id=$1 AND id=$2",[k.merchant_id,k.id,v.capture.status,debugId]);
  return {outcome:'DECLINED',captureId:v.capture.id};
 }
 // COMPLETED, or REFUNDED seen before we settled: the money arrived first, so settle, then the refund is its own event.
 const row=(await db.query<Record<string,unknown>>('SELECT (r.updated_order).*,r.details AS settlement_details FROM bitpos.paypal_settle_capture($1::uuid,$2::uuid,$3::uuid,$4::text) AS r',[k.merchant_id,k.order_id,k.id,v.capture.id])).rows[0];
 if(!row)return {outcome:'ALREADY_SETTLED',captureId:v.capture.id};
 await publishSettlementRow(db,row,occurredAt);
 if(v.state==='REFUNDED')return {outcome:'REFUNDED',captureId:v.capture.id};
 return {outcome:row.status==='PAID'?'PAID':'RECOVERY',captureId:v.capture.id};
}
