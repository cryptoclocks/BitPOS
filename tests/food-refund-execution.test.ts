import test from 'node:test';import assert from 'node:assert/strict';import{createHash}from'node:crypto';
import {executeFoodRefundAttempt,type RefundExecutionSnapshot,type RefundExecutionStore} from '../apps/worker/src/food-refund-execution';
import type {ReadyPayoutProvider,PreparedPayout,ReconcilePayoutResult} from '../apps/worker/src/payout-provider';
import {USDG_ASSET} from '../packages/domain/src/payment-assets';
function fixture(){
 let row:RefundExecutionSnapshot={attemptId:'attempt',caseId:'case',paymentId:'payment',version:'1',state:'SIGNING',amountMinor:'3900000',asset:USDG_ASSET,beneficiaryOwner:'canonical-payer',sourceOwner:'approved-source',feePayerOwner:'approved-fee-payer',fundingReservationId:'exclusive-funding',fundingAvailable:true,maxFeeLamports:10000,maxTotalLamports:3000000,prepared:null};
 const signedBase64=Buffer.from('Synthetic signed bytes; not a real transaction').toString('base64');
 const signed:PreparedPayout={version:1,attemptId:row.attemptId,batchId:row.caseId,amountMinor:row.amountMinor,asset:USDG_ASSET,genesisHash:USDG_ASSET.genesisHash,recipientOwner:row.beneficiaryOwner,recipientTokenAccount:'synthetic-recipient-account',sourceOwner:row.sourceOwner,sourceTokenAccount:'synthetic-source-account',feePayerOwner:row.feePayerOwner,blockhash:'synthetic-blockhash',lastValidBlockHeight:100,preparedAtSlot:1,createRecipientAccount:false,feeLamports:5000,rentLamports:0,signedBase64,signature:'synthetic-signature',signedBytesSha256:createHash('sha256').update(Buffer.from(signedBase64,'base64')).digest('hex'),intentDigest:'a'.repeat(64),memo:'synthetic-refund-bound-intent',reference:'synthetic-reference'};
 const calls:string[]=[],sent:PreparedPayout[]=[];let signs=0,observation:ReconcilePayoutResult={status:'UNKNOWN',signature:signed.signature,reason:'HISTORY_UNAVAILABLE'},losePersist=false,loseSend=false,casLost=false;
 const store:RefundExecutionStore={snapshot:async()=>structuredClone(row),persistPrepared:async(_s,p)=>{calls.push('persist');if(casLost)return false;row={...row,state:'PREPARED',version:'2',prepared:structuredClone(p)};if(losePersist){losePersist=false;throw Error('Commit receipt lost');}return true;},authorizeSubmission:async()=>{calls.push('admit');row={...row,state:'UNKNOWN',version:String(Number(row.version)+1)};return structuredClone(row);},recordUnknown:async()=>{calls.push('unknown');row={...row,state:'UNKNOWN'};},recordVerified:async()=>{calls.push('verified');}};
 const provider:ReadyPayoutProvider={kind:'ready',prepare:async()=>{signs++;return structuredClone(signed);},reconcile:async()=>{calls.push('reconcile');return observation;},broadcast:async p=>{calls.push('broadcast');sent.push(structuredClone(p));if(loseSend)throw Error('Provider response lost');return{status:'SUBMITTED',signature:p.signature};}};
 return{store,provider,calls,sent,get signs(){return signs;},get row(){return row;},set row(value:RefundExecutionSnapshot){row=value;},get signed(){return signed;},set observation(value:ReconcilePayoutResult){observation=value;},set losePersist(v:boolean){losePersist=v;},set loseSend(v:boolean){loseSend=v;},set casLost(v:boolean){casLost=v;}};
}
test('refund worker persists signed intent and submission admission before broadcast; restart uses same bytes',async()=>{
 const f=fixture();assert.equal(await executeFoodRefundAttempt(f.store,f.provider,'attempt'),'SUBMITTED');assert.deepEqual(f.calls,['persist','reconcile','admit','broadcast']);
 await executeFoodRefundAttempt(f.store,f.provider,'attempt');assert.equal(f.signs,1);assert.equal(f.sent.length,2);assert.equal(f.sent[0].signedBase64,f.sent[1].signedBase64);assert.equal(f.sent[0].signature,f.sent[1].signature);
});
test('lost prepared commit response restarts without signing or broadcasting replacement',async()=>{
 const f=fixture();f.losePersist=true;await assert.rejects(executeFoodRefundAttempt(f.store,f.provider,'attempt'));assert.equal(f.sent.length,0);await executeFoodRefundAttempt(f.store,f.provider,'attempt');assert.equal(f.signs,1);assert.equal(f.sent.length,1);
});
test('ambiguous submission retains committed attempt and exact retry; unavailable provider never signs',async()=>{
 const f=fixture();f.loseSend=true;assert.equal(await executeFoodRefundAttempt(f.store,f.provider,'attempt'),'UNKNOWN');f.loseSend=false;await executeFoodRefundAttempt(f.store,f.provider,'attempt');assert.equal(f.signs,1);assert.equal(f.sent[0].signature,f.sent[1].signature);
 assert.equal(await executeFoodRefundAttempt(f.store,{kind:'unavailable',reason:'NOT_CONFIGURED'},'attempt'),'UNAVAILABLE');assert.equal(f.signs,1);
});
test('CAS loser and unavailable funding cannot broadcast',async()=>{
 const f=fixture();f.casLost=true;assert.equal(await executeFoodRefundAttempt(f.store,f.provider,'attempt'),'CAS_LOST');assert.equal(f.sent.length,0);f.row={...f.row,fundingAvailable:false};assert.equal(await executeFoodRefundAttempt(f.store,f.provider,'attempt'),'FUNDING_REQUIRED');assert.equal(f.signs,1);
});
test('expired uncertain history is not failure, replacement or financial settlement',async()=>{
 const f=fixture();f.observation={status:'UNKNOWN',signature:f.signed.signature,reason:'EXPIRED_WITHOUT_COMPLETE_HISTORY'};assert.equal(await executeFoodRefundAttempt(f.store,f.provider,'attempt'),'UNKNOWN');assert.equal(f.sent.length,0);assert.ok(!f.calls.includes('verified'));await executeFoodRefundAttempt(f.store,f.provider,'attempt');assert.equal(f.signs,1);
});
test('wrong canonical beneficiary or mutated persisted signed bytes fail before broadcast',async()=>{
 const f=fixture();f.row={...f.row,beneficiaryOwner:'different-payer'};await assert.rejects(executeFoodRefundAttempt(f.store,f.provider,'attempt'),/IDENTITY_CONFLICT/);assert.equal(f.sent.length,0);
 const g=fixture();g.row={...g.row,state:'PREPARED',prepared:{...g.signed,signedBase64:Buffer.from('tampered').toString('base64')}};await assert.rejects(executeFoodRefundAttempt(g.store,g.provider,'attempt'),/IDENTITY_CONFLICT/);assert.equal(g.sent.length,0);
});
