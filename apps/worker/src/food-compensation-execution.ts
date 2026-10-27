import type {createCompensationSqlStore} from './food-compensation-store';
import type {PayoutProvider} from './payout-provider';
import {validateCompensationPrepared} from './food-compensation-prepared';
type Store=ReturnType<typeof createCompensationSqlStore>;
/** Private coordinator: not registered as a worker lane. No replacement intent. */
export async function executeFoodCompensation(store:Store,provider:PayoutProvider,attemptId:string,signal?:AbortSignal){
 if(signal?.aborted)return 'ABORTED' as const;
 if(provider.kind!=='ready')return 'UNAVAILABLE' as const;
 let current=await store.snapshot(attemptId);
 if(!current.prepared){
  if(!current.fundingAvailable||current.maxFeeLamports===null||current.maxTotalLamports===null)return 'FUNDING_REQUIRED' as const;
  if(current.state!=='ALLOCATED')throw Error('COMPENSATION_PREPARED_REQUIRED');
  const prepared=await provider.prepare({attemptId:current.attemptId,batchId:current.reservationId,amountMinor:current.amountMinor,asset:current.asset,beneficiaryOwner:current.recipientOwner});
  if(signal?.aborted)return 'ABORTED' as const;
  validateCompensationPrepared({...current,maxFeeLamports:current.maxFeeLamports,maxTotalLamports:current.maxTotalLamports},prepared);
  await store.persistPrepared(attemptId,prepared);current=await store.snapshot(attemptId);
 }
 const prepared=current.prepared;if(!prepared||current.maxFeeLamports===null||current.maxTotalLamports===null)throw Error('COMPENSATION_PREPARED_REQUIRED');
 validateCompensationPrepared({...current,maxFeeLamports:current.maxFeeLamports,maxTotalLamports:current.maxTotalLamports},prepared);
 if(signal?.aborted)return 'ABORTED' as const;
 const observed=await provider.reconcile(prepared);
 if(observed.status==='FINALIZED'||observed.status==='FAILED'){await store.recordVerified(attemptId,observed);return 'VERIFIED' as const;}
 if(['FINALIZED','FAILED','RECONCILIATION_REQUIRED'].includes(current.state))return 'TERMINAL' as const;
 if(observed.status!=='UNKNOWN'||observed.reason!=='HISTORY_UNAVAILABLE')return 'UNKNOWN' as const;
 if(!current.fundingAvailable)return 'FUNDING_REQUIRED' as const;
 if(signal?.aborted)return 'ABORTED' as const;
 const admitted=await store.authorizeSubmission(attemptId,current.submissionSequence);if(!admitted)return 'CAS_LOST' as const;
 const committed=await store.snapshot(attemptId);
 if(['FINALIZED','FAILED','RECONCILIATION_REQUIRED'].includes(committed.state))return 'TERMINAL' as const;
 if(!committed.fundingAvailable)return 'FUNDING_REQUIRED' as const;
 if(committed.prepared?.signedBytesSha256!==prepared.signedBytesSha256||committed.prepared.signedBase64!==prepared.signedBase64)throw Error('COMPENSATION_PREPARED_IDENTITY_CONFLICT');
 if(signal?.aborted)return 'ABORTED' as const;
 // SQL authorization committed UNKNOWN first. Ambiguous transport never releases
 // claims or generates replacement bytes; a later run reconciles this same tx.
 const sent=await provider.broadcast(committed.prepared);return sent.status;
}
