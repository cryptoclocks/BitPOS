import type pg from'pg';import{z}from'zod';import{RequestError}from'./authority';import type{QuoteRow}from'./types';
const uuid=z.string().uuid(),reference=z.object({quoteId:uuid,sourceQuoteId:uuid,holdId:uuid,checkoutReady:z.literal(false)}).strict();
const facts=z.object({id:uuid,merchant_id:uuid,source_account_id:uuid,source_branch_id:uuid,origin_kind:z.literal('online'),coupon098_version:z.literal(1),total_minor:z.string().regex(/^[1-9][0-9]{0,17}$/),usdg_minor:z.string().regex(/^[1-9][0-9]{0,17}$/),request_hash:z.string().regex(/^[a-f0-9]{64}$/)}).passthrough();
export function boundary(error:unknown):never{
 if(error instanceof Error){const code=(error as{code?:string}).code,message=error.message;
  if(message==='AUTH_REQUIRED')throw new RequestError(401,'AUTH_REQUIRED');if(message==='RESOURCE_NOT_FOUND')throw new RequestError(404,'RESOURCE_NOT_FOUND');if(message==='IDEMPOTENCY_CONFLICT')throw new RequestError(409,'IDEMPOTENCY_CONFLICT');
  if(['55P03','57014','40001','40P01'].includes(code??''))throw new RequestError(409,'DISPATCH_AUTH_RETRY');
  if(['COUPON_PLATFORM_FUNDING_REQUIRED','COUPON_READ_COMMITTED_REQUIRED','COUPON_CHECKOUT_NOT_ADMITTED','COUPON_ZERO_ORDER_REQUIRES_COMPLETION'].includes(message)||['42501','42883'].includes(code??''))throw new RequestError(503,'CONFIGURATION_REQUIRED',message);
  if(message.startsWith('COUPON_')||message==='CONFIGURED_OPTIONS_CHANGED')throw new RequestError(409,'QUOTE_CHANGED',message,{reasonCode:message});
 }
 throw error;
}
/** Internal candidate adapter. Caller owns one transaction and authenticated
 * mobile/merchant SQL context. No public route/admission or payment is created.
 */
export async function prepareCouponQuoteCandidate(db:pg.PoolClient|pg.Client,merchant:string,sourceQuoteId:string,policyVersionId:string,commandId:string){
 uuid.parse(merchant);uuid.parse(sourceQuoteId);uuid.parse(policyVersionId);uuid.parse(commandId);
 try{
  if((await db.query("SELECT current_setting('bitpos.merchant',true)merchant")).rows[0].merchant!==merchant)throw new RequestError(404,'RESOURCE_NOT_FOUND');
  const result=reference.parse((await db.query('SELECT bitpos.coupon098_apply($1,$2,$3::jsonb)value',[sourceQuoteId,policyVersionId,JSON.stringify({commandId})])).rows[0].value);
  if(result.sourceQuoteId!==sourceQuoteId)throw Error('Coupon source receipt mismatch');
  const row=(await db.query("SELECT * FROM bitpos.order_quotes WHERE merchant_id=$1 AND id=$2 AND source_account_id=nullif(current_setting('bitpos.mobile_account',true),'')::uuid",[merchant,result.quoteId])).rows[0];
  const checked=facts.parse(row);if(checked.merchant_id!==merchant||checked.id!==result.quoteId||row.settlement?.amountMinor!==checked.usdg_minor)throw Error('Coupon quote receipt mismatch');
  return{quote:row as QuoteRow,sourceQuoteId:result.sourceQuoteId,holdId:result.holdId,checkoutReady:false as const};
 }catch(error){boundary(error);}
}
export async function validateCouponQuoteCandidate(db:pg.PoolClient|pg.Client,merchant:string,quoteId:string){
 uuid.parse(merchant);uuid.parse(quoteId);try{await db.query('SELECT bitpos.coupon098_validate_live($1,$2)',[merchant,quoteId]);}catch(error){boundary(error);}
}
