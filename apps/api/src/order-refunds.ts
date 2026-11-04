import type pg from 'pg';
import {z} from 'zod';
import {USDG_ASSET} from '../../../packages/domain/src/payment-assets';
import {fail,requireRole,uuid} from './authority';
import {audit} from './db';

// Store-side refund of a PAID counter/table wallet order. This module only RECORDS the request (and reads state); the money moves in the refund worker
// (apps/worker/src/store-refund-runtime.ts) through the exact-bytes payout provider and is marked done only by verified finalized chain evidence.
// Rules: owner/manager; full refund of what was actually paid; to the wallet that paid; one live refund per order; never for demo/cash/online orders;
// refused (REFUND_UNAVAILABLE) unless BitPOS operates this shop's treasury key (BITPOS_STORE_REFUND_SOURCE_OWNER must equal the shop's treasury address).
const body=z.object({reason:z.string().trim().min(3).max(120)}).strict();
export interface RefundView{id:string;state:'SIGNING'|'PREPARED'|'UNKNOWN'|'FINALIZED'|'FAILED';amountMinor:string;assetId:string;beneficiary:string;reason:string;requestedBy:string;requestedAt:string;signature:string|null;finalizedAt:string|null;lastReason:string}
type Row={id:string;state:RefundView['state'];amount_minor:string;asset_id:string;beneficiary_owner:string;reason:string;requested_by:string;created_at:Date;signature:string|null;finalized_at:Date|null;last_reason:string};
const view=(r:Row):RefundView=>({id:r.id,state:r.state,amountMinor:r.amount_minor,assetId:r.asset_id,beneficiary:r.beneficiary_owner,reason:r.reason,requestedBy:r.requested_by,requestedAt:r.created_at.toISOString(),signature:r.signature,finalizedAt:r.finalized_at?r.finalized_at.toISOString():null,lastReason:r.last_reason});
const COLS='id,state,amount_minor::text,asset_id,beneficiary_owner,reason,requested_by,created_at,signature,finalized_at,last_reason';
export const refundSourceOwner=()=>process.env.BITPOS_STORE_REFUND_SOURCE_OWNER??'';

async function paymentOf(db:pg.PoolClient,merchant:string,order:string){
 return (await db.query<{id:string;signature:string;amount:string;state:string;payer:string;mint:string}>('SELECT p.id,p.signature,p.amount_minor::text amount,p.state,a.payer,a.mint FROM payments p JOIN payment_attempts a ON a.merchant_id=p.merchant_id AND a.id=p.attempt_id WHERE p.merchant_id=$1 AND p.order_id=$2 ORDER BY p.created_at LIMIT 1',[merchant,order])).rows[0];
}
/** What the bill detail shows: the live refund (if any) and whether one can be requested now, with the reason when not. */
export async function refundState(db:pg.PoolClient,merchant:string,role:string,orderId:string,status:string,online:boolean){
 const latest=(await db.query<Row>(`SELECT ${COLS} FROM order_refunds WHERE merchant_id=$1 AND order_id=$2 ORDER BY created_at DESC LIMIT 1`,[merchant,orderId])).rows[0];
 const live=latest&&latest.state!=='FAILED'?latest:undefined;
 let blocked:string|null=null;
 if(!['owner','manager'].includes(role))blocked='ROLE';
 else if(live)blocked='ALREADY';
 else if(status!=='PAID')blocked='NOT_PAID';
 else if(online)blocked='ONLINE';
 else{
  const p=await paymentOf(db,merchant,orderId);
  if(!p||p.state!=='SETTLED')blocked='NO_PAYMENT';
  else if(p.signature.startsWith('demo:'))blocked='DEMO';
  else if(p.mint!==USDG_ASSET.mint)blocked='ASSET';
  else{
   const t=(await db.query<{treasury:string}>('SELECT treasury FROM merchants WHERE id=$1',[merchant])).rows[0]?.treasury;
   if(!refundSourceOwner()||refundSourceOwner()!==t)blocked='SIGNER';
  }
 }
 return {refund:latest?view(latest):null,refundable:{available:blocked===null,blocked}};
}
export async function requestOrderRefund(db:pg.PoolClient,merchant:string,actor:string,role:string,orderId:unknown,input:unknown):Promise<{refund:RefundView;replayed:boolean}>{
 requireRole(role);
 const id=uuid.safeParse(orderId),d=body.safeParse(input);if(!id.success||!d.success)fail('INVALID_REQUEST',422);
 const o=(await db.query<{status:string}>('SELECT status FROM orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,id.data])).rows[0];if(!o)fail('RESOURCE_NOT_FOUND',404);
 const live=(await db.query<Row>(`SELECT ${COLS} FROM order_refunds WHERE merchant_id=$1 AND order_id=$2 AND state<>'FAILED'`,[merchant,id.data])).rows[0];
 if(live)return {refund:view(live),replayed:true};
 if(o.status!=='PAID')fail('ORDER_NOT_PAID',409);
 const online=(await db.query<{k:string|null}>('SELECT source_kind AS k FROM order_authority WHERE merchant_id=$1 AND order_id=$2',[merchant,id.data])).rows[0]?.k==='online';
 const p=await paymentOf(db,merchant,id.data);
 if(online||!p||p.state!=='SETTLED'||p.signature.startsWith('demo:')||p.mint!==USDG_ASSET.mint)fail('REFUND_NOT_ALLOWED',409);
 const treasury=(await db.query<{treasury:string}>('SELECT treasury FROM merchants WHERE id=$1',[merchant])).rows[0]?.treasury;
 if(!refundSourceOwner()||refundSourceOwner()!==treasury)fail('REFUND_UNAVAILABLE',409);
 const r=(await db.query<Row>(`INSERT INTO order_refunds(merchant_id,order_id,payment_id,amount_minor,asset_id,beneficiary_owner,source_owner,reason,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${COLS}`,
  [merchant,id.data,p.id,p.amount,USDG_ASSET.assetId,p.payer,treasury,d.data.reason,actor])).rows[0]!;
 await audit(db,merchant,actor,'order.refund.request',id.data);
 return {refund:view(r),replayed:false};
}
