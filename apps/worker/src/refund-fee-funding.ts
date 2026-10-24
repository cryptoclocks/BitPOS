import {z}from'zod';import{PublicKey}from'@solana/web3.js';
import{DEVNET_GENESIS}from'../../../packages/domain/src/index';
import{createRefundFeeVerifier}from'./refund-fee-verifier';
import type{PayoutTransport}from'./payout-provider';import type{RefundSqlTransaction}from'./food-refund-store';
const uuid=z.string().uuid(),version=z.string().regex(/^[1-9][0-9]{0,18}$/),signature=z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
const owner=z.string().refine(v=>{try{return new PublicKey(v).toBase58()===v&&PublicKey.isOnCurve(new PublicKey(v).toBytes());}catch{return false;}});
const configSchema=z.object({policyId:uuid,configVersion:version,enabled:z.boolean(),feePayerOwner:owner,genesisHash:z.literal(DEVNET_GENESIS)}).strict();
const receiptSchema=z.object({creditId:uuid,policyId:uuid,signature,amountLamports:z.string().regex(/^[1-9][0-9]{0,15}$/).refine(v=>BigInt(v)<=9007199254740991n),verificationHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const functions={config:'food_refund113_config',lookup:'food_refund113_lookup',record:'food_refund113_record',reserve:'food_refund113_reserve'}as const;
/** Internal-only verified native credit recorder. No key loader or ambient RPC. */
export function createRefundFeeFunding(deps?:{transaction:RefundSqlTransaction;connection:Pick<PayoutTransport,'getGenesisHash'|'getTransaction'>}){
 async function call(kind:keyof typeof functions,args:unknown[]){if(!deps)throw Error('FEE_FUNDING_NOT_CONFIGURED');return deps.transaction(async db=>{const result=await db.query(`SELECT bitpos.${functions[kind]}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args);if(result.rows.length!==1||!Object.hasOwn(result.rows[0],'value'))throw Error('INVALID_FEE_SQL_RESULT');return result.rows[0].value;});}
 return{
  async record(input:unknown){
   if(!deps)return{status:'UNAVAILABLE' as const,reason:'NOT_CONFIGURED'};
   const command=z.object({policyId:uuid,expectedConfigVersion:version,signature}).strict().parse(input),config=configSchema.parse(await call('config',[command.policyId]));
   if(config.policyId!==command.policyId)throw Error('FEE_IDENTITY_CONFLICT');
   if(!config.enabled||config.configVersion!==command.expectedConfigVersion)return{status:'UNAVAILABLE' as const,reason:'CONFIGURATION_CHANGED'};
   const checked=(raw:unknown)=>{const r=receiptSchema.parse(raw);if(r.policyId!==command.policyId||r.signature!==command.signature)throw Error('FEE_IDENTITY_CONFLICT');return r;};
   const existing=await call('lookup',[command.policyId,command.signature]);if(existing!==null)return{status:'RECORDED' as const,receipt:checked(existing)};
   const proof=await createRefundFeeVerifier(deps.connection).verify({signature:command.signature,recipientOwner:config.feePayerOwner});if(proof.status!=='VERIFIED')return proof;
   let creditId:string;
   try{creditId=uuid.parse(await call('record',[command.policyId,JSON.stringify(proof.evidence),proof.digest]));}
   catch(error){let recovered:unknown;try{recovered=await call('lookup',[command.policyId,command.signature]);}catch{throw error;}if(recovered===null)throw error;const r=checked(recovered);if(r.amountLamports!==proof.evidence.amountLamports||r.verificationHash!==proof.digest)throw Error('FEE_IDENTITY_CONFLICT');return{status:'RECORDED' as const,receipt:r};}
   const receipt=checked(await call('lookup',[command.policyId,command.signature]));if(receipt.creditId!==creditId||receipt.amountLamports!==proof.evidence.amountLamports||receipt.verificationHash!==proof.digest)throw Error('FEE_IDENTITY_CONFLICT');return{status:'RECORDED' as const,receipt};
  },
  async reserve(input:unknown){if(!deps)return{status:'UNAVAILABLE' as const,reason:'NOT_CONFIGURED'};const c=z.object({creditId:uuid,attemptId:uuid}).strict().parse(input);return{status:'RESERVED' as const,amountLamports:version.parse(await call('reserve',[c.creditId,c.attemptId]))};},
 };
}
