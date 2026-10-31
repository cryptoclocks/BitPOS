import type pg from 'pg';
import {z} from 'zod';
import {pool} from './db';
import {audit} from './db';
import {mobilePrincipal} from './mobile-auth';
import {fail,requireRole,RequestError} from './authority';
import {MobileRewardCatalogSchema,MobileRewardRedeemRequestSchema,MobileRewardRedemptionSchema,MobileVouchersSchema} from '../../../packages/contracts/src/mobile-v1.generated';
// DS52 demo-grade reward vouchers (migration 173). Every number here is computed by SQL; the client only names a reward and an idempotency key.
const REFUSALS:Record<string,[number,'REWARD_INSUFFICIENT_POINTS'|'REWARD_UNAVAILABLE'|'REWARD_TERMS_LOCKED'|'REWARD_PRICING_REQUIRED']>={
 REWARD_INSUFFICIENT_POINTS:[409,'REWARD_INSUFFICIENT_POINTS'],REWARD_UNAVAILABLE:[409,'REWARD_UNAVAILABLE'],REWARD_TERMS_LOCKED:[409,'REWARD_TERMS_LOCKED'],REWARD_PRICING_REQUIRED:[409,'REWARD_PRICING_REQUIRED']};
function boundary(error:unknown):never{
 if(error instanceof Error){
  const refusal=REFUSALS[error.message];if(refusal)throw new RequestError(refusal[0],refusal[1]);
  if(error.message==='AUTH_REQUIRED')throw new RequestError(401,'AUTH_REQUIRED');
  if(error.message==='RESOURCE_NOT_FOUND')throw new RequestError(404,'RESOURCE_NOT_FOUND');
  if(error.message==='IDEMPOTENCY_CONFLICT')throw new RequestError(409,'IDEMPOTENCY_CONFLICT');
  if(error.message==='INVALID_REQUEST')throw new RequestError(422,'INVALID_REQUEST');
 }
 throw error;
}
const pick=(r:any)=>({id:r.id,merchantId:r.merchantId,merchantName:r.merchantName,nameTh:r.nameTh,nameEn:r.nameEn,pointsCost:r.pointsCost,currency:r.currency,decimals:r.decimals,discountMinor:r.discountMinor,minimumSpendMinor:r.minimumSpendMinor,validityDays:r.validityDays,balance:Number(r.balance),redeemable:r.redeemable});
async function inTransaction<T>(run:(db:pg.PoolClient)=>Promise<T>){
 const db=await pool.connect();
 try{await db.query('BEGIN');const result=await run(db);await db.query('COMMIT');return result;}
 catch(error){await db.query('ROLLBACK').catch(()=>undefined);throw error;}
 finally{db.release();}
}
/** mobile_v1 routes: GET /account/rewards/catalog, POST /account/rewards/redeem, GET /account/vouchers. */
export async function mobileRewardVoucherRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const path=url.pathname;
 if(path!=='/api/mobile/v1/account/rewards/catalog'&&path!=='/api/mobile/v1/account/rewards/redeem'&&path!=='/api/mobile/v1/account/vouchers')return undefined;
 const actor=await mobilePrincipal(bearer);
 if(url.search)fail('INVALID_REQUEST',422);
 try{
  if(path.endsWith('/redeem')){
   if(method!=='POST')fail('INVALID_REQUEST',422);
   const data=MobileRewardRedeemRequestSchema.parse(input);
   const value=await inTransaction(async db=>(await db.query('SELECT bitpos.mobile_reward_redeem($1,$2,$3,$4) AS value',[actor.accountId,actor.sessionId,data.rewardId,data.idempotencyKey])).rows[0].value);
   return MobileRewardRedemptionSchema.parse({voucher:value.voucher,balance:Number(value.balance),replayed:value.replayed});
  }
  if(method!=='GET')fail('INVALID_REQUEST',422);
  if(path.endsWith('/catalog')){
   const rows=(await pool.query('SELECT bitpos.mobile_reward_catalog($1,$2) AS value',[actor.accountId,actor.sessionId])).rows[0].value as unknown[];
   return MobileRewardCatalogSchema.parse({generatedAt:new Date().toISOString(),rewards:rows.map(pick)});
  }
  const vouchers=(await pool.query('SELECT bitpos.mobile_reward_vouchers($1,$2) AS value',[actor.accountId,actor.sessionId])).rows[0].value;
  return MobileVouchersSchema.parse({generatedAt:new Date().toISOString(),vouchers});
 }catch(error){boundary(error);}
}
const text=z.string().trim().min(1).max(80).refine(v=>![...v].some(c=>c.codePointAt(0)!<32||c.codePointAt(0)===127));
const minor=z.string().regex(/^[1-9][0-9]{0,11}$/);
const rewardBody=z.object({slot:z.number().int().min(1).max(3),nameTh:text,nameEn:text,pointsCost:z.number().int().min(1).max(1000000),discountMinor:minor,minimumSpendMinor:minor,validityDays:z.number().int().min(1).max(365),enabled:z.boolean()}).strict()
 .refine(v=>BigInt(v.minimumSpendMinor)>BigInt(v.discountMinor),{message:'minimum spend must exceed the discount'});
/** Merchant setup for the 1-3 rewards: GET and PUT /api/settings/rewards. Owner/manager only; the discount terms of a slot are locked once created. */
export async function rewardSettings(db:pg.PoolClient,merchant:string,actor:string,role:string,method:string,input:unknown){
 requireRole(role);
 const view=async()=>{
  const price=(await db.query<{currency:string;decimals:number}>('SELECT v.currency,v.decimals FROM merchant_pricing m JOIN catalog_price_versions v ON v.merchant_id=m.merchant_id AND v.id=m.active_price_version_id WHERE m.merchant_id=$1',[merchant])).rows[0]??null;
  return {currency:price?.currency??null,decimals:price?.decimals??null,rewards:(await db.query('SELECT bitpos.reward173_list() AS value')).rows[0].value as unknown[]};
 };
 if(method==='GET')return view();
 if(method!=='PUT')fail('RESOURCE_NOT_FOUND',404);
 const data=rewardBody.parse(input);
 try{
  await db.query('SELECT id FROM merchants WHERE id=$1 FOR NO KEY UPDATE',[merchant]);
  await db.query('SELECT bitpos.reward173_save($1,$2,$3,$4,$5,$6,$7,$8)',[data.slot,data.nameTh,data.nameEn,data.pointsCost,data.discountMinor,data.minimumSpendMinor,data.validityDays,data.enabled]);
 }catch(error){boundary(error);}
 await audit(db,merchant,actor,'rewards.configure',merchant);
 return view();
}
