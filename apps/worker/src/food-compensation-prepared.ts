import {validatePreparedPayout,type PreparedPayout} from './payout-provider';
import type {PaymentAsset} from '../../../packages/contracts/src/index';
export interface CompensationPreparedBinding {
 attemptId:string;reservationId:string;recipientOwner:string;sourceOwner:string;feePayerOwner:string;
 amountMinor:string;asset:Readonly<PaymentAsset>;maxFeeLamports:number;maxTotalLamports:number;
}
/** Pure verifier. No keys, network, SQL writes, signing or broadcasting. */
export function validateCompensationPrepared(binding:CompensationPreparedBinding,payload:PreparedPayout):Readonly<PreparedPayout>{
 const decoded=validatePreparedPayout(payload,{allowedAssetIds:[binding.asset.assetId],sourceOwner:binding.sourceOwner,feePayerOwner:binding.feePayerOwner,maxAmountMinor:binding.amountMinor,maxFeeLamports:binding.maxFeeLamports,maxTotalLamports:binding.maxTotalLamports});
 const value=decoded.prepared;
 const keys=['assetId','symbol','displayLabel','cluster','genesisHash','mint','tokenProgram','decimals','instructionPolicy','issuerTestAsset']as const;
 if(value.attemptId!==binding.attemptId||value.batchId!==binding.reservationId||value.recipientOwner!==binding.recipientOwner||value.amountMinor!==binding.amountMinor||keys.some(k=>value.asset[k]!==binding.asset[k]))throw Error('COMPENSATION_PREPARED_IDENTITY_CONFLICT');
 return value;
}
