import type pg from 'pg';
import {z} from 'zod';
import type {PaymentAsset,Settlement,Quote} from '../../../packages/contracts/src/index';
import {assetSettlement,assertAssetDescriptor,policyForPrecision} from '../../../packages/domain/src/payment-assets';
import {fail,requireRole} from './authority';
import {audit} from './db';
import type {QuoteRow} from './types';
import {grantReviewProof,validateReviewedGrant,type ReviewedPayment} from './coffee-grant-review';
export type CollectionChoice='table'|'counter';
export interface RepeatLimit {sourceOrderId:string;asset:PaymentAsset;recipient:string;maxAtomic:string;expiresAt:string;}
interface ConstraintRow {collection:CollectionChoice;collection_policy_version:number;repeat_source_order_id:string|null;reviewed_asset:PaymentAsset|null;reviewed_settlement:Settlement|null;reviewed_grant_id:string|null;reviewed_session_id:string|null;reviewed_expires_at:Date|null;repeat_recipient:string|null;repeat_max_atomic:string|null;repeat_expires_at:Date|null;}
const atomic=z.string().regex(/^[1-9][0-9]*$/).max(20).pipe(z.string().refine(v=>BigInt(v)<=18446744073709551615n));
export const repeatRequest=z.object({sourceVisitToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/),requestId:z.string().uuid(),assetId:z.string().min(1).max(64),maxAtomic:atomic,expiresAt:z.string().datetime({offset:true}),delegation:grantReviewProof.optional(),confirmJoin:z.boolean().default(false)}).strict();
export async function collectionPolicy(db:pg.PoolClient,merchant:string){
 const row=(await db.query<{counter_enabled:boolean;version:number}>('SELECT counter_enabled,version FROM merchant_collection_policy WHERE merchant_id=$1',[merchant])).rows[0];
 return {counterEnabled:row?.counter_enabled??false,version:row?.version??1};
}
export async function collectionSettings(db:pg.PoolClient,merchant:string,actor:string,role:string,method:string,input:unknown){
 requireRole(role);
 if(method==='GET')return collectionPolicy(db,merchant);
 if(method!=='PUT')fail('RESOURCE_NOT_FOUND',404);
 const data=z.object({counterEnabled:z.boolean(),expectedVersion:z.number().int().positive()}).strict().parse(input);
 await db.query('SELECT id FROM merchants WHERE id=$1 FOR NO KEY UPDATE',[merchant]);
 const old=await collectionPolicy(db,merchant);if(old.version!==data.expectedVersion)fail('COLLECTION_POLICY_CHANGED');
 const row=(await db.query<{counter_enabled:boolean;version:number}>('INSERT INTO merchant_collection_policy(merchant_id,counter_enabled,version) VALUES($1,$2,2) ON CONFLICT(merchant_id) DO UPDATE SET counter_enabled=excluded.counter_enabled,version=merchant_collection_policy.version+1,updated_at=clock_timestamp() RETURNING counter_enabled,version',[merchant,data.counterEnabled])).rows[0];
 await audit(db,merchant,actor,'collection.configure',merchant);return {counterEnabled:row.counter_enabled,version:row.version};
}
function reviewedDenomination(q:QuoteRow,asset:PaymentAsset,policy:{id:string;numerator:string;denominator:string}){
 if(q.lines[0].unitPrice.currency==='USD')return assetSettlement(asset,q.total_minor,policyForPrecision(policy,q.lines[0].unitPrice.decimals),q.treasury);
 if(asset.assetId!=='usdg-devnet')fail('PAYMENT_ASSET_UNAVAILABLE',422);
 return assetSettlement(asset,q.total_minor,{id:'USDG_RAW_IDENTITY',numerator:'1',denominator:'1'},q.treasury);
}
export async function freezeCoffeeQuote(db:pg.PoolClient,merchant:string,q:QuoteRow,collection:CollectionChoice,repeat?:RepeatLimit,reviewed?:ReviewedPayment){
 const policy=await collectionPolicy(db,merchant);if(collection==='counter'&&!policy.counterEnabled)fail('COUNTER_COLLECTION_UNAVAILABLE',422);
 const asset=reviewed?.asset??repeat?.asset;let reviewedSettlement:Settlement|null=null;
 if(asset){
  if(repeat&&repeat.asset.assetId!==asset.assetId)fail('PAYMENT_ASSET_UNAVAILABLE',422);
  const available=(await db.query('SELECT m.policy FROM merchant_payment_assets m JOIN payment_assets r ON r.asset_id=m.asset_id WHERE m.merchant_id=$1 AND m.asset_id=$2 AND m.enabled AND r.enabled AND r.verified_at IS NOT NULL',[merchant,asset.assetId])).rows[0];
  if(!available)fail('PAYMENT_ASSET_UNAVAILABLE',422);
  reviewedSettlement=reviewedDenomination(q,asset,available.policy);if(repeat)assertRepeatLimit(repeat,reviewedSettlement);
  if(reviewed)await validateReviewedGrant(db,merchant,reviewed.grantId,reviewed.sessionId,reviewedSettlement);
 }
 await db.query('INSERT INTO quote_coffee_constraints(merchant_id,quote_id,collection,collection_policy_version,reviewed_asset,reviewed_settlement,reviewed_grant_id,reviewed_session_id,reviewed_expires_at,repeat_source_order_id,repeat_recipient,repeat_max_atomic,repeat_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[merchant,q.id,collection,policy.version,asset??null,reviewedSettlement,reviewed?.grantId??null,reviewed?.sessionId??null,reviewed?.expiresAt??null,repeat?.sourceOrderId??null,repeat?.recipient??null,repeat?.maxAtomic??null,repeat?.expiresAt??null]);
 return {kind:collection,policyVersion:policy.version};
}
export function assertRepeatLimit(limit:RepeatLimit,settlement:Settlement,now=Date.now()){
 assertAssetDescriptor(limit.asset);const asset=limit.asset;
 if(Date.parse(limit.expiresAt)<=now)fail('REPEAT_CAP_EXPIRED');
 if(settlement.assetId!==asset.assetId||settlement.genesisHash!==asset.genesisHash||settlement.mint!==asset.mint||settlement.tokenProgram!==asset.tokenProgram||settlement.recipient!==limit.recipient||settlement.decimals!==asset.decimals||BigInt(settlement.amountMinor)>BigInt(limit.maxAtomic))fail('REPEAT_CAP_EXCEEDED',422);
}
function repeatFromRow(row:ConstraintRow):RepeatLimit|null{
 if(!row.repeat_source_order_id)return null;
 if(!row.reviewed_asset||!row.repeat_recipient||!row.repeat_max_atomic||!row.repeat_expires_at)throw Error('Invalid repeat constraint');
 return {sourceOrderId:row.repeat_source_order_id,asset:row.reviewed_asset,recipient:row.repeat_recipient,maxAtomic:String(row.repeat_max_atomic),expiresAt:row.repeat_expires_at.toISOString()};
}
export async function coffeeQuoteView(db:pg.PoolClient,merchant:string,quoteId:string,quote:Quote){
 const row=(await db.query<ConstraintRow>('SELECT * FROM quote_coffee_constraints WHERE merchant_id=$1 AND quote_id=$2',[merchant,quoteId])).rows[0];
 if(!row)return quote;
 const repeat=repeatFromRow(row);
 return {...quote,collection:{kind:row.collection,policyVersion:row.collection_policy_version},...(row.reviewed_settlement?{settlement:row.reviewed_settlement}:{}),validUntil:new Date(Math.min(Date.parse(quote.validUntil),repeat?Date.parse(repeat.expiresAt):Infinity,row.reviewed_expires_at?.getTime()??Infinity)).toISOString(),...(row.reviewed_grant_id?{delegationGrantId:row.reviewed_grant_id}:{}),...(repeat?{repeatCap:{asset:repeat.asset,maxAtomic:repeat.maxAtomic,expiresAt:repeat.expiresAt}}:{})};
}
export async function validateCoffeeQuote(db:pg.PoolClient,merchant:string,q:QuoteRow){
 const row=(await db.query<ConstraintRow>('SELECT * FROM quote_coffee_constraints WHERE merchant_id=$1 AND quote_id=$2',[merchant,q.id])).rows[0];if(!row)return;
 const policy=await collectionPolicy(db,merchant);if(row.collection==='counter'&&(!policy.counterEnabled||policy.version!==row.collection_policy_version))fail('COLLECTION_POLICY_CHANGED');
 const limit=repeatFromRow(row);if(row.reviewed_asset){
  const asset=row.reviewed_asset;
  const accepted=(await db.query('SELECT m.policy,r.descriptor FROM merchant_payment_assets m JOIN payment_assets r ON r.asset_id=m.asset_id WHERE m.merchant_id=$1 AND m.asset_id=$2 AND m.enabled AND r.enabled AND r.verified_at IS NOT NULL',[merchant,asset.assetId])).rows[0];
  if(!accepted||Object.keys(asset).some(key=>accepted.descriptor[key]!==asset[key as keyof PaymentAsset]))fail('PAYMENT_ASSET_UNAVAILABLE');
  const current=reviewedDenomination(q,asset,accepted.policy);if(limit)assertRepeatLimit(limit,current);
  if(!row.reviewed_settlement||current.amountMinor!==row.reviewed_settlement.amountMinor||current.recipient!==row.reviewed_settlement.recipient)fail('PAYMENT_ASSET_VERSION_CONFLICT');
  if(row.reviewed_grant_id){if(!row.reviewed_session_id||!row.reviewed_expires_at||row.reviewed_expires_at.getTime()<=Date.now())fail('QUOTE_EXPIRED');await validateReviewedGrant(db,merchant,row.reviewed_grant_id,row.reviewed_session_id,current);}
 }
}
export async function freezeCoffeeOrder(db:pg.PoolClient,merchant:string,orderId:string,quoteId:string){
 await db.query('INSERT INTO order_coffee_constraints(merchant_id,order_id,quote_id) SELECT merchant_id,$2,quote_id FROM quote_coffee_constraints WHERE merchant_id=$1 AND quote_id=$3',[merchant,orderId,quoteId]);
 const frozen=(await db.query<ConstraintRow>('SELECT q.* FROM order_coffee_constraints o JOIN quote_coffee_constraints q USING(merchant_id,quote_id) WHERE o.merchant_id=$1 AND o.order_id=$2',[merchant,orderId])).rows[0];if(!frozen?.reviewed_asset)return;
 const previous=(await db.query('SELECT q.* FROM order_payment_selection s JOIN payment_quotes q ON q.merchant_id=s.merchant_id AND q.id=s.quote_id WHERE s.merchant_id=$1 AND s.order_id=$2',[merchant,orderId])).rows[0];
 const settlement=frozen.reviewed_settlement;if(!settlement)throw Error('Missing reviewed settlement');const limit=repeatFromRow(frozen);if(limit)assertRepeatLimit(limit,settlement);
 const selected=(await db.query('INSERT INTO payment_quotes(merchant_id,order_id,original_quote_id,price_version_id,price_currency,price_total_minor,descriptor,settlement,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',[merchant,orderId,previous.original_quote_id,previous.price_version_id,previous.price_currency,previous.price_total_minor,frozen.reviewed_asset,settlement,new Date(Math.min(new Date(previous.expires_at).getTime(),limit?Date.parse(limit.expiresAt):Infinity,frozen.reviewed_expires_at?.getTime()??Infinity))])).rows[0];
 await db.query('UPDATE order_payment_selection SET quote_id=$3 WHERE merchant_id=$1 AND order_id=$2',[merchant,orderId,selected.id]);
}
export async function orderRepeatLimit(db:pg.PoolClient|pg.Client,merchant:string,orderId:string){
 const row=(await db.query<ConstraintRow>('SELECT q.* FROM order_coffee_constraints o JOIN quote_coffee_constraints q USING(merchant_id,quote_id) WHERE o.merchant_id=$1 AND o.order_id=$2',[merchant,orderId])).rows[0];return row?repeatFromRow(row):null;
}
export async function assertOrderRepeatLimit(db:pg.PoolClient|pg.Client,merchant:string,orderId:string,settlement:Settlement){
 const limit=await orderRepeatLimit(db,merchant,orderId);if(limit)assertRepeatLimit(limit,settlement);
}
export async function coffeeOrderViews(db:pg.PoolClient,merchant:string,orderIds:readonly string[]){
 const rows=(await db.query<ConstraintRow&{order_id:string}>('SELECT o.order_id,q.* FROM order_coffee_constraints o JOIN quote_coffee_constraints q USING(merchant_id,quote_id) WHERE o.merchant_id=$1 AND o.order_id=ANY($2::uuid[])',[merchant,orderIds])).rows;
 return new Map(rows.map(row=>{
  const repeat=repeatFromRow(row);
  return [row.order_id,{collection:{kind:row.collection,policyVersion:row.collection_policy_version},...(row.reviewed_grant_id?{delegationGrantId:row.reviewed_grant_id}:{}),...(repeat?{repeatCap:{asset:repeat.asset,maxAtomic:repeat.maxAtomic,expiresAt:repeat.expiresAt}}:{})}] as const;
 }));
}
