import {createHash} from 'node:crypto';
import type {PaymentAsset} from '../../../packages/contracts/src/index';
import {assertAssetDescriptor,MAX_PAYMENT_RAW} from '../../../packages/domain/src/payment-assets';
import type {PayoutProvider,PreparedPayout,ReconcilePayoutResult} from './payout-provider';
/** Private coordinator; NOT registered as a production lane. The SQL repository
 * must authorize an approved109 allocation, reserve verified funding exclusively,
 * bind the payment's immutable payer/asset/amount and commit each operation.
 * No client callback or provider submission may mark a payment refunded. */
export interface RefundExecutionSnapshot {
 attemptId:string;caseId:string;paymentId:string;version:string;
 state:'SIGNING'|'PREPARED'|'UNKNOWN'|'FINALIZED'|'FAILED';
 amountMinor:string;asset:Readonly<PaymentAsset>;beneficiaryOwner:string;
 sourceOwner:string;feePayerOwner:string;fundingReservationId:string;
 fundingAvailable:boolean;maxFeeLamports:number;maxTotalLamports:number;
 prepared:PreparedPayout|null;
}
export interface RefundExecutionStore {
 snapshot(attemptId:string):Promise<RefundExecutionSnapshot>;
 /** CAS losers return false. A successful reply means the transaction committed. */
 persistPrepared(snapshot:RefundExecutionSnapshot,prepared:PreparedPayout):Promise<boolean>;
 /** Atomically claim exact-byte submission BEFORE external broadcast. Recheck
  * allocation, funding reservation and immutable provider policy; no replacement. */
 authorizeSubmission(snapshot:RefundExecutionSnapshot):Promise<RefundExecutionSnapshot|null>;
 recordUnknown(snapshot:RefundExecutionSnapshot,reason:string):Promise<void>;
 /** Transactionally persist verified evidence + balanced ledger + execution state.
  * Must deduplicate and quarantine contradictory terminal observations. */
 recordVerified(snapshot:RefundExecutionSnapshot,observation:Extract<ReconcilePayoutResult,{status:'FINALIZED'|'FAILED'}>):Promise<void>;
}
export class RefundExecutionError extends Error{constructor(){super('REFUND_EXECUTION_IDENTITY_CONFLICT');}}
const fields=['assetId','symbol','displayLabel','cluster','genesisHash','mint','tokenProgram','decimals','instructionPolicy','issuerTestAsset']as const;
const sameAsset=(a:Readonly<PaymentAsset>,b:Readonly<PaymentAsset>)=>fields.every(key=>a[key]===b[key]);
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function validate(s:RefundExecutionSnapshot){
 if(!Number.isSafeInteger(s.maxFeeLamports)||s.maxFeeLamports<=0||!Number.isSafeInteger(s.maxTotalLamports)||s.maxTotalLamports<s.maxFeeLamports||!/^[1-9][0-9]{0,18}$/.test(s.amountMinor)||BigInt(s.amountMinor)>MAX_PAYMENT_RAW||!s.fundingReservationId)throw new RefundExecutionError();
 assertAssetDescriptor(s.asset);
}
function prepared(s:RefundExecutionSnapshot,p:PreparedPayout|null):PreparedPayout{
 validate(s);
 if(!p||!Number.isSafeInteger(p.feeLamports)||p.feeLamports<0||!Number.isSafeInteger(p.rentLamports)||p.rentLamports<0||p.attemptId!==s.attemptId||p.batchId!==s.caseId||p.amountMinor!==s.amountMinor||!sameAsset(p.asset,s.asset)||p.recipientOwner!==s.beneficiaryOwner||p.sourceOwner!==s.sourceOwner||p.feePayerOwner!==s.feePayerOwner||p.genesisHash!==s.asset.genesisHash||p.feeLamports>s.maxFeeLamports||p.feeLamports+p.rentLamports>s.maxTotalLamports||hash(Buffer.from(p.signedBase64,'base64'))!==p.signedBytesSha256)throw new RefundExecutionError();
 return p;
}
function sameIdentity(a:RefundExecutionSnapshot,b:RefundExecutionSnapshot){
 if(a.attemptId!==b.attemptId||a.caseId!==b.caseId||a.paymentId!==b.paymentId||a.amountMinor!==b.amountMinor||a.beneficiaryOwner!==b.beneficiaryOwner||a.sourceOwner!==b.sourceOwner||a.feePayerOwner!==b.feePayerOwner||a.fundingReservationId!==b.fundingReservationId||a.maxFeeLamports!==b.maxFeeLamports||a.maxTotalLamports!==b.maxTotalLamports||!sameAsset(a.asset,b.asset))throw new RefundExecutionError();
}
export async function executeFoodRefundAttempt(store:RefundExecutionStore,provider:PayoutProvider,attemptId:string,signal?:AbortSignal){
 if(provider.kind!=='ready')return 'UNAVAILABLE' as const;
 let current=await store.snapshot(attemptId);if(current.attemptId!==attemptId)throw new RefundExecutionError();validate(current);
 if(signal?.aborted)return 'ABORTED' as const;
 if(current.state==='SIGNING'){
  if(!current.fundingAvailable)return 'FUNDING_REQUIRED' as const;
  const signed=prepared(current,await provider.prepare({attemptId:current.attemptId,batchId:current.caseId,beneficiaryOwner:current.beneficiaryOwner,amountMinor:current.amountMinor,asset:current.asset}));
  if(signal?.aborted)return 'ABORTED' as const;
  if(!await store.persistPrepared(current,signed))return 'CAS_LOST' as const;
  const persisted=await store.snapshot(attemptId);sameIdentity(current,persisted);current=persisted;
 }
 const bytes=prepared(current,current.prepared);
 const observation=await provider.reconcile(bytes);if(signal?.aborted)return 'ABORTED' as const;
 if(observation.status==='FINALIZED'||observation.status==='FAILED'){
  if(observation.status==='FINALIZED'){
   const e=observation.receipt.evidence;
   if(e.commitment!=='finalized'||e.attemptId!==current.attemptId||e.batchId!==current.caseId||e.signature!==bytes.signature||e.signedBytesSha256!==bytes.signedBytesSha256||e.intentDigest!==bytes.intentDigest||e.amountMinor!==current.amountMinor||e.recipientOwner!==current.beneficiaryOwner||e.sourceOwner!==current.sourceOwner||e.genesisHash!==current.asset.genesisHash||!sameAsset(e.asset,current.asset))throw new RefundExecutionError();
  }else if(observation.signature!==bytes.signature||observation.evidence.intentDigest!==bytes.intentDigest||observation.evidence.signedBytesSha256!==bytes.signedBytesSha256||observation.evidence.genesisHash!==current.asset.genesisHash)throw new RefundExecutionError();
  await store.recordVerified(current,observation);return 'VERIFIED' as const;
 }
 // Terminal rows still reconcile contradictions but never broadcast again.
 if(current.state==='FINALIZED'||current.state==='FAILED')return 'TERMINAL' as const;
 if(observation.status==='CONFIRMED'||observation.reason!=='HISTORY_UNAVAILABLE'){
  await store.recordUnknown(current,observation.status==='CONFIRMED'?'NOT_FINALIZED':observation.reason);return 'UNKNOWN' as const;
 }
 if(!current.fundingAvailable)return 'FUNDING_REQUIRED' as const;
 const admitted=await store.authorizeSubmission(current);if(!admitted)return 'CAS_LOST' as const;
 sameIdentity(current,admitted);const committed=prepared(admitted,admitted.prepared);
 if(committed.signature!==bytes.signature||committed.signedBase64!==bytes.signedBase64||committed.intentDigest!==bytes.intentDigest||!admitted.fundingAvailable||!['PREPARED','UNKNOWN'].includes(admitted.state))throw new RefundExecutionError();
 if(signal?.aborted)return 'ABORTED' as const;
 // A thrown/unknown response leaves the committed attempt uncertain. Retry loads
 // and reconciles these same bytes; it must never allocate or sign a replacement.
 let result:Awaited<ReturnType<typeof provider.broadcast>>;
 try{result=await provider.broadcast(committed);}
 catch{await store.recordUnknown(admitted,'SUBMISSION_AMBIGUOUS');return 'UNKNOWN' as const;}
 if(result.signature!==committed.signature)throw new RefundExecutionError();
 if(result.status==='SUBMITTED')return 'SUBMITTED' as const;
 await store.recordUnknown(admitted,result.reason);return 'UNKNOWN' as const;
}
