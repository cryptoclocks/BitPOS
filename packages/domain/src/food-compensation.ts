/** Server-only calculation input. Callers must obtain facts under the shipment
 * lock from canonical custody/quote rows; this function grants no payment rights. */
export interface FoodCompensationPolicy {
 id: string;
 enabled: boolean;
 currency: string;
 decimals: number;
 returnedRateBps: number;
 maxMinor: bigint;
}
export interface ReturnedFoodCompensationFacts {
 assignmentState: string;
 shipmentState: string;
 merchantReceiptRecorded: boolean;
 blockersAcknowledged: boolean;
 ordinaryEarningExists: boolean;
 quotedDriverMinor: bigint;
 currency: string;
 decimals: number;
}
export type FoodCompensationCalculation =
 | {state:'DISABLED'|'REVIEW_REQUIRED';amountMinor:0n}
 | {state:'CALCULATED';policyId:string;amountMinor:bigint;currency:string;decimals:number};
const MAX_INT64=9223372036854775807n;
export function calculateReturnedFoodCompensation(policy:FoodCompensationPolicy,facts:ReturnedFoodCompensationFacts):FoodCompensationCalculation {
 if(!policy.id.trim()||!Number.isInteger(policy.returnedRateBps)||policy.returnedRateBps<0||policy.returnedRateBps>10000||!Number.isInteger(policy.decimals)||policy.decimals<0||policy.decimals>18||policy.maxMinor<0n||policy.maxMinor>MAX_INT64||facts.quotedDriverMinor<0n||facts.quotedDriverMinor>MAX_INT64)throw new Error('INVALID_COMPENSATION_INPUT');
 if(!policy.enabled)return {state:'DISABLED',amountMinor:0n};
 if(facts.assignmentState!=='RETURNED'||facts.shipmentState!=='FAILED'||!facts.merchantReceiptRecorded||!facts.blockersAcknowledged||facts.ordinaryEarningExists||facts.currency!==policy.currency||facts.decimals!==policy.decimals)return {state:'REVIEW_REQUIRED',amountMinor:0n};
 const calculated=facts.quotedDriverMinor*BigInt(policy.returnedRateBps)/10000n;
 return {state:'CALCULATED',policyId:policy.id,amountMinor:calculated>policy.maxMinor?policy.maxMinor:calculated,currency:policy.currency,decimals:policy.decimals};
}
