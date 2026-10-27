import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,chainReceipt} from './payout-provider.fixture';
import {payoutPreparedSchema} from '../apps/worker/src/payout-provider';
import {executeFoodCompensation} from '../apps/worker/src/food-compensation-execution';
import type {createCompensationSqlStore} from '../apps/worker/src/food-compensation-store';
type Store=ReturnType<typeof createCompensationSqlStore>;
test('recovery reconciles stored transaction, commits unknown before send and never resigns',async()=>{
 const f=fixture(),prepared=payoutPreparedSchema.parse(await f.prepare());f.state.blockHeight=90;f.connection.isBlockhashValid=async()=>({context:{slot:11},value:true});
 let current:Awaited<ReturnType<Store['snapshot']>>={attemptId:prepared.attemptId,reservationId:prepared.batchId,recipientOwner:prepared.recipientOwner,sourceOwner:prepared.sourceOwner,feePayerOwner:prepared.feePayerOwner,amountMinor:prepared.amountMinor,asset:prepared.asset,maxFeeLamports:1000000,maxTotalLamports:3000000,submissionSequence:'0',state:'PREPARED',fundingAvailable:true,prepared};
 let crash=true,verified=0;
 const store:Store={snapshot:async()=>({...current}),persistPrepared:async()=>{throw Error('Must not reprepare');},authorizeSubmission:async(id,sequence)=>{
  assert.equal(sequence,current.submissionSequence);current={...current,state:'UNKNOWN',submissionSequence:String(BigInt(sequence)+1n)};
  if(crash){crash=false;throw Error('Simulated caller interruption after admission');}
  return {attemptId:id,sequence:current.submissionSequence,state:'UNKNOWN',signedBytesSha256:prepared.signedBytesSha256,fundsTransferred:false};
 },recordVerified:async()=>{verified++;current={...current,state:'FINALIZED'};return {receiptId:randomUUID(),postingId:randomUUID(),quarantined:false};}};
 await assert.rejects(executeFoodCompensation(store,f.provider,prepared.attemptId),/Simulated caller interruption/);assert.equal(f.state.sends.length,0);assert.equal(current.state,'UNKNOWN');
 assert.equal(await executeFoodCompensation(store,f.provider,prepared.attemptId),'SUBMITTED');assert.equal(f.state.sends.length,1);assert.equal(f.state.sends[0].toString('base64'),prepared.signedBase64);assert.equal(f.state.signs,1);
 f.state.chain=chainReceipt(prepared);assert.equal(await executeFoodCompensation(store,f.provider,prepared.attemptId),'VERIFIED');assert.equal(verified,1);assert.equal(current.state,'FINALIZED');assert.equal(f.state.sends.length,1);
 f.state.chain=null;assert.equal(await executeFoodCompensation(store,f.provider,prepared.attemptId),'TERMINAL');assert.equal(f.state.sends.length,1);
});
