import type pg from 'pg';
import {PublicKey} from '@solana/web3.js';
import {z} from 'zod';
import {USDG_ASSET} from '../../../packages/domain/src/payment-assets';
import {acceptOwnerSignedPayout,createPayoutProvider,payoutOwnerSchema,PayoutProviderError} from '../../worker/src/payout-provider';
import type {PayoutTransport} from '../../worker/src/payout-provider';
import {fail,requireRole,uuid} from './authority';
import {audit,tenant} from './db';
import {chain} from './payments';
import {ownerRefundPolicy,OWNER_REFUND_MIN_VALID_BLOCKS} from './order-refund-policy';

// Store-side refund of a PAID counter/table wallet order. This module only RECORDS the request (and reads state); the money moves in the refund worker
// (apps/worker/src/store-refund-runtime.ts) through the exact-bytes payout provider and is marked done only by verified finalized chain evidence.
// Rules: owner/manager; full refund of what was actually paid; to the wallet that paid; one live refund per order; never for demo/cash/online orders;
// refused (REFUND_UNAVAILABLE) unless the shop has a usable treasury wallet. Two signing modes:
//  - 'server': BitPOS operates this shop's treasury key (BITPOS_STORE_REFUND_SOURCE_OWNER equals the treasury): the worker prepares, signs and sends.
//  - 'owner' (default, no key anywhere on the server): the server prepares the exact unsigned transaction, the shop owner signs it in their OWN wallet,
//    the server accepts the bytes only if they equal the prepared message with the treasury's valid signature; the keyless worker lane broadcasts and
//    reconciles. A wallet signature is never proof of the refund: only verified FINALIZED chain evidence marks it done.
const body=z.object({reason:z.string().trim().min(3).max(120)}).strict();
export interface RefundView{id:string;state:'AWAITING_OWNER'|'SIGNING'|'PREPARED'|'UNKNOWN'|'FINALIZED'|'FAILED';signingMode:'server'|'owner';sourceOwner:string;amountMinor:string;assetId:string;beneficiary:string;reason:string;requestedBy:string;requestedAt:string;signature:string|null;finalizedAt:string|null;lastReason:string}
type Row={id:string;state:RefundView['state'];signing_mode:'server'|'owner';source_owner:string;amount_minor:string;asset_id:string;beneficiary_owner:string;reason:string;requested_by:string;created_at:Date;signature:string|null;finalized_at:Date|null;last_reason:string};
const view=(r:Row):RefundView=>({id:r.id,state:r.state,signingMode:r.signing_mode,sourceOwner:r.source_owner,amountMinor:r.amount_minor,assetId:r.asset_id,beneficiary:r.beneficiary_owner,reason:r.reason,requestedBy:r.requested_by,requestedAt:r.created_at.toISOString(),signature:r.signature,finalizedAt:r.finalized_at?r.finalized_at.toISOString():null,lastReason:r.last_reason});
const COLS='id,state,signing_mode,source_owner,amount_minor::text,asset_id,beneficiary_owner,reason,requested_by,created_at,signature,finalized_at,last_reason';
export const refundSourceOwner=()=>process.env.BITPOS_STORE_REFUND_SOURCE_OWNER??'';
const onCurve=(address:string)=>{try{const key=new PublicKey(address);return key.toBase58()===address&&!key.equals(PublicKey.default)&&PublicKey.isOnCurve(key.toBytes());}catch{return false;}};
/** Which signer would sign a refund for this treasury: the server key (only when configured for exactly this treasury), the owner's own wallet, or nobody. */
export const refundMode=(treasury:string|undefined):'server'|'owner'|null=>!treasury?null:refundSourceOwner()===treasury?'server':onCurve(treasury)?'owner':null;
/** Test seam: the chain transport used to prepare owner-signed refunds. Production uses the shared devnet connection. */
export const refundTransport:{current:PayoutTransport|null}={current:null};
const transport=()=>refundTransport.current??chain;

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
   if(!refundMode(t))blocked='SIGNER';
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
 const mode=refundMode(treasury);if(!mode||!treasury)fail('REFUND_UNAVAILABLE',409);
 const r=(await db.query<Row>(`INSERT INTO order_refunds(merchant_id,order_id,payment_id,amount_minor,asset_id,beneficiary_owner,source_owner,reason,requested_by,signing_mode,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${COLS}`,
  [merchant,id.data,p.id,p.amount,USDG_ASSET.assetId,p.payer,treasury,d.data.reason,actor,mode,mode==='owner'?'AWAITING_OWNER':'SIGNING'])).rows[0]!;
 await audit(db,merchant,actor,'order.refund.request',id.data);
 return {refund:view(r),replayed:false};
}

// ---- owner-signed mode: prepare the unsigned transaction, accept what the owner's wallet signed, or cancel before anything is signed.
const signedBody=z.object({base64:z.string().min(1).max(1644)}).strict();
type Awaiting={id:string;version:string;source_owner:string;amount_minor:string;beneficiary_owner:string;unsigned:unknown};
async function awaiting(merchant:string,order:string):Promise<Awaiting>{
 const r=(await tenant(merchant,db=>db.query<Awaiting>("SELECT id,version::text,source_owner,amount_minor::text,beneficiary_owner,unsigned FROM order_refunds WHERE merchant_id=$1 AND order_id=$2 AND state='AWAITING_OWNER' AND signing_mode='owner'",[merchant,order]))).rows[0];
 if(!r)fail('REFUND_NOT_AWAITING',409);
 return r;
}
function chainError(error:unknown):never{
 const code=error instanceof PayoutProviderError?error.code:'';
 if(code==='INSUFFICIENT_LIQUIDITY')fail('REFUND_FUNDS_INSUFFICIENT',409);
 if(code==='INVALID_REQUEST'||code==='ASSET_POLICY'||code==='CONFIG_ERROR')fail('REFUND_NOT_ALLOWED',409);
 fail('REFUND_CHAIN_UNAVAILABLE',503);
}
/** Builds a FRESH unsigned refund transaction (new blockhash) for the owner's wallet. Safe to call again until something is signed and accepted. */
export async function prepareOwnerRefund(merchant:string,role:string,orderId:unknown){
 requireRole(role);const id=uuid.safeParse(orderId);if(!id.success)fail('INVALID_REQUEST',422);
 const row=await awaiting(merchant,id.data);
 const policy=ownerRefundPolicy(row.source_owner,row.amount_minor);
 const provider=createPayoutProvider({kind:'solana-devnet',...policy},{connection:transport(),resolveAsset:async a=>a===USDG_ASSET.assetId?USDG_ASSET:null,loadSigningKeys:async()=>{throw Error('OWNER_SIGNED_NO_SERVER_KEY');}});
 if(provider.kind!=='ready'||!provider.prepareForOwner)fail('REFUND_UNAVAILABLE',409);
 let owned;try{owned=await provider.prepareForOwner({attemptId:row.id,batchId:id.data,beneficiaryOwner:row.beneficiary_owner,amountMinor:row.amount_minor,asset:USDG_ASSET});}catch(error){chainError(error);}
 const ok=await tenant(merchant,db=>db.query("UPDATE order_refunds SET unsigned=$3::jsonb,version=version+1,updated_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2 AND state='AWAITING_OWNER' AND version=$4::bigint",[merchant,row.id,JSON.stringify(owned),row.version]));
 if(ok.rowCount!==1)fail('REFUND_NOT_AWAITING',409);
 return {refundId:row.id,sourceOwner:row.source_owner,beneficiary:row.beneficiary_owner,amountMinor:row.amount_minor,assetId:USDG_ASSET.assetId,unsignedBase64:owned.unsignedBase64,lastValidBlockHeight:owned.lastValidBlockHeight};
}
/** Accepts the bytes the owner's wallet returned. They must equal the prepared message, signed by the treasury; then they are stored as PREPARED for the worker to broadcast. */
export async function submitOwnerRefund(merchant:string,actor:string,role:string,orderId:unknown,input:unknown){
 requireRole(role);const id=uuid.safeParse(orderId),d=signedBody.safeParse(input);if(!id.success||!d.success)fail('INVALID_REQUEST',422);
 const row=await awaiting(merchant,id.data);
 if(row.unsigned===null||row.unsigned===undefined)fail('REFUND_SIGNATURE_INVALID',422);
 const unsigned=payoutOwnerSchema.safeParse(row.unsigned);if(!unsigned.success)fail('REFUND_SIGNATURE_INVALID',422);
 let prepared;try{prepared=acceptOwnerSignedPayout(unsigned.data,d.data.base64,ownerRefundPolicy(row.source_owner,row.amount_minor));}catch{fail('REFUND_SIGNATURE_INVALID',422);}
 let height:number;try{height=await transport().getBlockHeight('confirmed');}catch{fail('REFUND_CHAIN_UNAVAILABLE',503);}
 if(prepared.lastValidBlockHeight-height<OWNER_REFUND_MIN_VALID_BLOCKS)fail('REFUND_SIGNATURE_EXPIRED',409);
 return tenant(merchant,async db=>{
  const r=await db.query("UPDATE order_refunds SET state='PREPARED',prepared=$3::jsonb,signature=$4,version=version+1,updated_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2 AND state='AWAITING_OWNER' AND signing_mode='owner' AND version=$5::bigint",[merchant,row.id,JSON.stringify(prepared),prepared.signature,row.version]);
  if(r.rowCount!==1)fail('REFUND_NOT_AWAITING',409);
  await audit(db,merchant,actor,'order.refund.signed',id.data);
  const v=(await db.query<Row>(`SELECT ${COLS} FROM order_refunds WHERE merchant_id=$1 AND id=$2`,[merchant,row.id])).rows[0]!;
  return {refund:view(v)};
 });
}
/** The owner changed their mind before signing: nothing was signed or sent, a new request can be made. */
export async function cancelOwnerRefund(db:pg.PoolClient,merchant:string,actor:string,role:string,orderId:unknown){
 requireRole(role);const id=uuid.safeParse(orderId);if(!id.success)fail('INVALID_REQUEST',422);
 const r=await db.query("UPDATE order_refunds SET state='FAILED',last_reason='CANCELLED',version=version+1,updated_at=clock_timestamp() WHERE merchant_id=$1 AND order_id=$2 AND state='AWAITING_OWNER' AND signing_mode='owner' RETURNING id",[merchant,id.data]);
 if(r.rowCount!==1)fail('REFUND_NOT_AWAITING',409);
 await audit(db,merchant,actor,'order.refund.cancelled',id.data);
 return {cancelled:true};
}
