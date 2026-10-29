import type pg from 'pg';
import {z} from 'zod';
import type {PaymentAsset,Settlement,PaymentAssetsView} from '../../../packages/contracts/src/index';
import {assetSettlement,assertAssetDescriptor,policyForPrecision} from '../../../packages/domain/src/payment-assets';
import {hash,liveOrder} from '../../../packages/domain/src/index';
import type {OrderRow,AttemptRow} from './types';
import {fail,requireRole} from './authority';
import {orderView,emitOrder} from './orders';
import {mintPolicy} from './payments';
import {assertOrderRepeatLimit,orderRepeatLimit} from './coffee-order-constraints';
import {readX402Binding,type X402Binding} from './x402-payment';
import {assertOnlinePaymentAuthorization} from './online-acceptance-policy';
const ratio=z.string().regex(/^[1-9][0-9]*$/).max(20).refine(v=>BigInt(v)<=18446744073709551615n);
export interface FrozenPayment {quoteId:string;asset:PaymentAsset;settlement:Settlement;payer:string;recipient:string;reference:string;expiresAt:string;}
export async function frozenAttempt(db:pg.PoolClient|pg.Client,a:AttemptRow):Promise<AttemptRow&{payment:FrozenPayment;x402?:X402Binding}>{
 const row=(await db.query('SELECT * FROM payment_attempt_assets WHERE merchant_id=$1 AND attempt_id=$2 AND order_id=$3',[a.merchant_id,a.id,a.order_id])).rows[0];
 if(!row)fail('PAYMENT_UNAVAILABLE',503);
 assertAssetDescriptor(row.descriptor);
 if(row.payer!==a.payer||row.recipient!==a.recipient||row.reference!==a.reference||row.settlement.amountMinor!==a.amount_minor||row.descriptor.mint!==a.mint||row.descriptor.tokenProgram!==a.token_program)fail('PAYMENT_UNAVAILABLE',503);
 const x402=await readX402Binding(db,a);
 return {...a,payment:{quoteId:row.quote_id,asset:row.descriptor,settlement:row.settlement,payer:row.payer,recipient:row.recipient,reference:row.reference,expiresAt:new Date(row.expires_at).toISOString()},...(x402?{x402}:{})};
}
export async function selectedQuote(db:pg.PoolClient,o:OrderRow){
 const row=(await db.query('SELECT q.*,v.decimals AS price_decimals FROM order_payment_selection s JOIN payment_quotes q ON q.merchant_id=s.merchant_id AND q.order_id=s.order_id AND q.id=s.quote_id LEFT JOIN catalog_price_versions v ON v.merchant_id=q.merchant_id AND v.id=q.price_version_id WHERE s.merchant_id=$1 AND s.order_id=$2',[o.merchant_id,o.id])).rows[0];
 if(!row)fail('PAYMENT_UNAVAILABLE',503);return row;
}
async function changeSafe(db:pg.PoolClient,o:OrderRow){return (await db.query('SELECT bitpos.payment_asset_change_safe($1,$2) AS safe',[o.merchant_id,o.id])).rows[0].safe===true;}
export async function paymentAssets(db:pg.PoolClient,o:OrderRow):Promise<PaymentAssetsView>{
 const quote=await selectedQuote(db,o);
 const repeat=await orderRepeatLimit(db,o.merchant_id,o.id);
 const rows=(await db.query('SELECT r.descriptor,m.policy FROM merchant_payment_assets m JOIN payment_assets r ON r.asset_id=m.asset_id WHERE m.merchant_id=$1 AND m.enabled AND r.enabled AND r.verified_at IS NOT NULL ORDER BY r.asset_id',[o.merchant_id])).rows;
 const assets:{asset:PaymentAsset;settlement:Settlement}[]=[];
 for(const row of rows){assertAssetDescriptor(row.descriptor);if(quote.price_currency!=='USD'){if(row.descriptor.assetId===quote.descriptor.assetId)assets.push({asset:row.descriptor,settlement:quote.settlement});continue;}
  if(repeat&&row.descriptor.assetId!==repeat.asset.assetId)continue;
  if(row.descriptor.assetId===quote.descriptor.assetId){assets.push({asset:quote.descriptor,settlement:quote.settlement});continue;}
  try{assets.push({asset:row.descriptor,settlement:assetSettlement(row.descriptor,String(quote.price_total_minor),policyForPrecision(row.policy,quote.price_decimals??2),quote.settlement.recipient)});}catch{/* An exact denomination cannot represent this bill; do not offer it. */}
 }
 return {selectedAssetId:quote.descriptor.assetId,canChange:quote.price_currency==='USD'&&await changeSafe(db,o),assets};
}
export async function selectPaymentAsset(db:pg.PoolClient,o:OrderRow,input:unknown){
 const data=z.object({assetId:z.string().min(1).max(64),expectedVersion:z.number().int().positive(),idempotencyKey:z.string().min(1).max(128)}).strict().parse(input);
 const fingerprint=hash(JSON.stringify({assetId:data.assetId,expectedVersion:data.expectedVersion}));
 const old=(await db.query('SELECT request_hash,result FROM payment_asset_requests WHERE merchant_id=$1 AND order_id=$2 AND idempotency_key=$3',[o.merchant_id,o.id,data.idempotencyKey])).rows[0];
 if(old){if(old.request_hash!==fingerprint)fail('IDEMPOTENCY_CONFLICT');return {order:old.result,replayed:true};}
 if((await db.query("SELECT 1 FROM delegated_holds WHERE merchant_id=$1 AND order_id=$2 AND state='HELD'",[o.merchant_id,o.id])).rowCount)fail('PAYMENT_PENDING');
 if(o.version!==data.expectedVersion)fail('PAYMENT_ASSET_VERSION_CONFLICT');liveOrder(o);await assertOnlinePaymentAuthorization(db,o);
 if(!await changeSafe(db,o))fail('PAYMENT_PENDING');
 const previous=await selectedQuote(db,o);if(previous.price_currency!=='USD')fail('PAYMENT_ASSET_UNAVAILABLE');
 const row=(await db.query('SELECT r.descriptor,m.policy FROM merchant_payment_assets m JOIN payment_assets r ON r.asset_id=m.asset_id WHERE m.merchant_id=$1 AND m.asset_id=$2 AND m.enabled AND r.enabled AND r.verified_at IS NOT NULL',[o.merchant_id,data.assetId])).rows[0];
 if(!row)fail('PAYMENT_ASSET_UNAVAILABLE',422);assertAssetDescriptor(row.descriptor);
 let settlement:Settlement;try{settlement=assetSettlement(row.descriptor,String(previous.price_total_minor),policyForPrecision(row.policy,previous.price_decimals??2),previous.settlement.recipient);}catch{fail('PAYMENT_ASSET_UNAVAILABLE',422);}
 await assertOrderRepeatLimit(db,o.merchant_id,o.id,settlement);
 const q=(await db.query('INSERT INTO payment_quotes(merchant_id,order_id,original_quote_id,price_version_id,price_currency,price_total_minor,descriptor,settlement,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',[o.merchant_id,o.id,previous.original_quote_id,previous.price_version_id,previous.price_currency,previous.price_total_minor,row.descriptor,settlement,previous.expires_at])).rows[0];
 await db.query('UPDATE order_payment_selection SET quote_id=$3 WHERE merchant_id=$1 AND order_id=$2',[o.merchant_id,o.id,q.id]);
 const updated=(await db.query('UPDATE orders SET version=version+1 WHERE merchant_id=$1 AND id=$2 RETURNING *',[o.merchant_id,o.id])).rows[0];
 await emitOrder(db,updated);const view=await orderView(db,updated,true);
 await db.query('INSERT INTO payment_asset_requests VALUES($1,$2,$3,$4,$5)',[o.merchant_id,o.id,data.idempotencyKey,fingerprint,view]);return {order:view,replayed:false};
}
export async function merchantPaymentAssets(db:pg.PoolClient,merchant:string,actor:string,role:string,method:string,input:unknown){
 requireRole(role);
 if(method==='GET')return {assets:(await db.query('SELECT r.descriptor AS asset,r.enabled AS registry_enabled,r.verified_at,m.enabled,m.policy AS "denominationPolicy",m.version FROM payment_assets r LEFT JOIN merchant_payment_assets m ON m.asset_id=r.asset_id AND m.merchant_id=$1 ORDER BY r.asset_id',[merchant])).rows};
 if(method!=='PUT')fail('RESOURCE_NOT_FOUND',404);
 const data=z.object({assetId:z.string().min(1).max(64),enabled:z.boolean(),expectedVersion:z.number().int().nonnegative(),denominationPolicy:z.object({id:z.string().min(1).refine(value=>Buffer.byteLength(value,'utf8')<=64,'Policy ID exceeds 64 UTF-8 bytes'),numerator:ratio,denominator:ratio}).strict()}).strict().parse(input);
 const registry=(await db.query('SELECT * FROM payment_assets WHERE asset_id=$1',[data.assetId])).rows[0];
 if(!registry||data.enabled&&(!registry.enabled||!registry.verified_at))fail('PAYMENT_ASSET_UNAVAILABLE',422);
 assertAssetDescriptor(registry.descriptor);if(data.enabled)await mintPolicy(registry.descriptor);
 // Serialize absent configuration as well as existing rows under the tenant lock.
 await db.query('SELECT id FROM merchants WHERE id=$1 FOR NO KEY UPDATE',[merchant]);
 const old=(await db.query('SELECT version FROM merchant_payment_assets WHERE merchant_id=$1 AND asset_id=$2 FOR UPDATE',[merchant,data.assetId])).rows[0];
 if((old?.version??0)!==data.expectedVersion)fail('PAYMENT_ASSET_VERSION_CONFLICT');
 const configured=(await db.query('INSERT INTO merchant_payment_assets(merchant_id,asset_id,enabled,policy) VALUES($1,$2,$3,$4) ON CONFLICT(merchant_id,asset_id) DO UPDATE SET enabled=excluded.enabled,policy=excluded.policy,version=merchant_payment_assets.version+1 RETURNING *',[merchant,data.assetId,data.enabled,data.denominationPolicy])).rows[0];
 await db.query('INSERT INTO audit_logs(merchant_id,actor,action,subject) VALUES($1,$2,$3,$4)',[merchant,actor,'payment_asset.configure',data.assetId]);return {asset:registry.descriptor,enabled:configured.enabled,denominationPolicy:configured.policy,version:configured.version};
}
