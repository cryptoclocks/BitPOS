import {z} from 'zod';
import {createHash} from 'node:crypto';
import {DEVNET_GENESIS} from '../../../packages/domain/src/index';
import {createInboundFundingVerifier,type PayoutProviderDeps} from './payout-provider';
import {createDriverSettlementAssetResolver} from './driver-settlement';
import type {DriverSettlementTransaction} from './driver-settlement';
import {SettlementAssetSchema} from '../../../packages/contracts/src/mobile-v1.generated';

const request=z.object({configId:z.string().uuid(),signature:z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/),expectedConfigVersion:z.string().regex(/^[1-9][0-9]{0,18}$/)}).strict();
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function commandId(config:string,signature:string){const value=digest(['BitPOS/InboundFundingRecord/v1',config,signature]).slice(0,32);return `${value.slice(0,8)}-${value.slice(8,12)}-8${value.slice(13,16)}-a${value.slice(17,20)}-${value.slice(20)}`;}
/** Internal-only entry, not an API accepting a verified flag or a balance snapshot.
 * No signing or broadcast dependency exists. SQL calls commit before RPC work.
 */
export function createSettlementFundingRecorder(deps?:{transaction:DriverSettlementTransaction;connection:PayoutProviderDeps['connection']}){
 async function call(name:'settlement088_worker_funding_config'|'settlement088_worker_funding_lookup'|'settlement088_worker_funding_record'|'settlement088_worker_asset',args:unknown[]){
  if(!deps)throw Error('FUNDING_VERIFIER_NOT_CONFIGURED');
  return deps.transaction(async db=>(await db.query(`SELECT bitpos.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args)).rows[0]?.value);
 }
 return {async record(input:unknown){
  if(!deps)return {status:'UNAVAILABLE' as const,reason:'NOT_CONFIGURED'};
  const command=request.parse(input),config=z.object({configId:z.string().uuid(),version:z.string(),provider:z.literal('solana-devnet'),network:z.literal('solana-devnet'),enabled:z.boolean(),genesisHash:z.literal(DEVNET_GENESIS),senderPublicKey:z.string(),asset:SettlementAssetSchema}).strict().parse(await call('settlement088_worker_funding_config',[command.configId]));
  if(!config.enabled||config.version!==command.expectedConfigVersion)return {status:'UNAVAILABLE' as const,reason:'CONFIGURATION_CHANGED'};
  const existing=await call('settlement088_worker_funding_lookup',[command.configId,command.signature]);
  if(existing!==null&&existing!==undefined)return {status:'RECORDED' as const,receipt:existing};
  const verifier=createInboundFundingVerifier({connection:deps.connection,resolveAsset:createDriverSettlementAssetResolver(deps.transaction)});
  const proof=await verifier.verify({signature:command.signature,assetId:config.asset.assetId,recipientOwner:config.senderPublicKey});
  if(proof.status!=='VERIFIED')return proof;
  if(JSON.stringify(proof.evidence.asset)!==JSON.stringify(config.asset))return {status:'UNAVAILABLE' as const,reason:'ASSET_CONFIGURATION_CHANGED'};
  try{
   const receipt=await call('settlement088_worker_funding_record',[config.configId,JSON.stringify({idempotencyKey:commandId(config.configId,command.signature),expectedConfigVersion:config.version,externalReference:command.signature,money:{amountMinor:proof.evidence.amountMinor,currency:proof.evidence.asset.symbol,decimals:6},verificationHash:proof.digest,verifiedAt:new Date().toISOString(),providerEvidence:proof.evidence})]);
   return {status:'RECORDED' as const,receipt};
  }catch(error){
   // A commit response may be lost or a peer may win. Recover the immutable
   // network/reference identity instead of resubmitting a newly timestamped body.
   const recovered=await call('settlement088_worker_funding_lookup',[command.configId,command.signature]);
   if(recovered!==null&&recovered!==undefined)return {status:'RECORDED' as const,receipt:recovered};throw error;
  }
 }};
}
