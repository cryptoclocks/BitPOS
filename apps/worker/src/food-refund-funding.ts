import {z} from 'zod';
import {assertAssetDescriptor} from '../../../packages/domain/src/payment-assets';
import {PublicKey} from '@solana/web3.js';
import {createInboundFundingVerifier,payoutAssetSchema,type PayoutProviderDeps} from './payout-provider';
import type {RefundSqlTransaction} from './food-refund-store';
const uuid=z.string().uuid(),version=z.string().regex(/^[1-9][0-9]{0,18}$/).refine(v=>BigInt(v)<=9223372036854775807n),signature=z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
const owner=z.string().refine(v=>{try{return new PublicKey(v).toBase58()===v&&PublicKey.isOnCurve(new PublicKey(v).toBytes());}catch{return false;}});
const request=z.object({policyId:uuid,expectedConfigVersion:version,signature}).strict();
const configuration=z.object({policyId:uuid,configVersion:version,enabled:z.boolean(),senderPublicKey:owner,asset:payoutAssetSchema,registryAsset:payoutAssetSchema.nullable()}).strict();
const receiptSchema=z.object({creditId:uuid,policyId:uuid,signature,amountMinor:z.string().regex(/^[1-9][0-9]{0,17}$/),assetId:z.string(),verificationHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const functions={config:'food_refund111_config',lookup:'food_refund111_lookup',record:'food_refund111_record',reserve:'food_refund111_reserve'}as const;
export class RefundFundingError extends Error{constructor(){super('REFUND_FUNDING_IDENTITY_CONFLICT');}}
/** Internal read-only chain verifier. No wallet/key loader, API registration,
 * config discovery, RPC construction or network calls at import/factory time. */
export function createFoodRefundFunding(deps?:{transaction:RefundSqlTransaction;connection:PayoutProviderDeps['connection']}){
 async function call(kind:keyof typeof functions,args:unknown[]){
  if(!deps)throw new RefundFundingError();
  return deps.transaction(async db=>{const result=await db.query(`SELECT bitpos.${functions[kind]}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args);if(result.rows.length!==1||!Object.hasOwn(result.rows[0],'value'))throw new RefundFundingError();return result.rows[0].value;});
 }
 return{
  async record(input:unknown){
   if(!deps)return {status:'UNAVAILABLE' as const,reason:'NOT_CONFIGURED'};
   const command=request.parse(input),config=configuration.parse(await call('config',[command.policyId]));
   if(config.policyId!==command.policyId)throw new RefundFundingError();assertAssetDescriptor(config.asset);
   if(!config.enabled||config.configVersion!==command.expectedConfigVersion||!config.registryAsset||JSON.stringify(config.asset)!==JSON.stringify(config.registryAsset))return {status:'UNAVAILABLE' as const,reason:'CONFIGURATION_CHANGED'};
   function checked(value:unknown){const receipt=receiptSchema.parse(value);if(receipt.policyId!==command.policyId||receipt.signature!==command.signature||receipt.assetId!==config.asset.assetId)throw new RefundFundingError();return receipt;}
   const existing=await call('lookup',[command.policyId,command.signature]);if(existing!==null)return {status:'RECORDED' as const,receipt:checked(existing)};
   const verifier=createInboundFundingVerifier({connection:deps.connection,resolveAsset:async assetId=>{
    const fresh=configuration.parse(await call('config',[command.policyId]));
    if(!fresh.enabled||fresh.policyId!==config.policyId||fresh.configVersion!==config.configVersion||fresh.senderPublicKey!==config.senderPublicKey||assetId!==config.asset.assetId||!fresh.registryAsset||JSON.stringify(fresh.asset)!==JSON.stringify(config.asset)||JSON.stringify(fresh.registryAsset)!==JSON.stringify(config.asset))return null;
    return fresh.registryAsset;
   }});
   const proof=await verifier.verify({signature:command.signature,assetId:config.asset.assetId,recipientOwner:config.senderPublicKey});if(proof.status!=='VERIFIED')return proof;
   if(proof.evidence.signature!==command.signature||proof.evidence.recipientOwner!==config.senderPublicKey||JSON.stringify(payoutAssetSchema.parse(proof.evidence.asset))!==JSON.stringify(config.asset))throw new RefundFundingError();
   let recordedId:string|undefined;
   try{recordedId=uuid.parse(await call('record',[command.policyId,JSON.stringify(proof.evidence),proof.digest]));}
   catch(error){let recovered:unknown;try{recovered=await call('lookup',[command.policyId,command.signature]);}catch{throw error;}if(recovered===null)throw error;const receipt=checked(recovered);if(receipt.verificationHash!==proof.digest||receipt.amountMinor!==proof.evidence.amountMinor)throw new RefundFundingError();return {status:'RECORDED' as const,receipt};}
   const receipt=checked(await call('lookup',[command.policyId,command.signature]));if(receipt.creditId!==recordedId||receipt.verificationHash!==proof.digest||receipt.amountMinor!==proof.evidence.amountMinor)throw new RefundFundingError();
   return {status:'RECORDED' as const,receipt};
  },
  async reserve(input:unknown){if(!deps)return {status:'UNAVAILABLE' as const,reason:'NOT_CONFIGURED'};const data=z.object({creditId:uuid,caseId:uuid,paymentId:uuid}).strict().parse(input);return {status:'RESERVED' as const,attemptId:uuid.parse(await call('reserve',[data.creditId,data.caseId,data.paymentId]))};},
 };
}
