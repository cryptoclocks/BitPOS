import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDriverSettlementWorker,type DriverSettlementTransaction,type DriverSettlementDependencies} from '../apps/worker/src/driver-settlement';
import {createPayoutProvider,type PreparedPayout,type PayoutProvider,type PayoutProviderConfig,type PayoutProviderDeps} from '../apps/worker/src/payout-provider';
import {asset,source,recipient,fixture,chainReceipt} from './payout-provider.fixture';
import {DEVNET_GENESIS} from '../packages/domain/src/index';

// Synthetic in-memory SQL/CAS adapter plus the real payout provider against the existing
// deterministic transport fixture. These tests do NOT establish PostgreSQL ledger authority.
const ids={batch:'10000000-0000-4000-8000-000000000001',merchant:'10000000-0000-4000-8000-000000000002',beneficiary:'10000000-0000-4000-8000-000000000003',config:'10000000-0000-4000-8000-000000000004',funding:'10000000-0000-4000-8000-000000000005',attempt:'10000000-0000-4000-8000-000000000006',receipt:'10000000-0000-4000-8000-000000000007',ledger:'10000000-0000-4000-8000-000000000008'};
const config={kind:'enabled',adapterVersion:'fixture-adapter-v1',provider:{kind:'solana-devnet',sourceOwner:source.publicKey.toBase58(),feePayerOwner:source.publicKey.toBase58(),allowedAssetIds:[asset.assetId],maxAmountMinor:'1000000',maxFeeLamports:10000,maxTotalLamports:3000000},maxBatchesPerTick:50,maxTerminalAttemptsPerTick:50};
type State='RESERVED'|'SIGNING'|'PREPARED'|'SUBMITTED'|'UNKNOWN'|'CONFIRMED'|'FAILED';
type Receipt={receiptId:string;outcome:'CONFIRMED'|'FAILED';verificationHash:string;providerEvidence:Record<string,unknown>;ledgerTransactionId:string|null};
function harness(){
 const transport=fixture();transport.state.blockHeight=50;
 transport.connection.isBlockhashValid=async()=>({context:{slot:11},value:true});
 const state={state:'RESERVED' as State,batchVersion:1,attemptVersion:0,prepared:null as PreparedPayout|null,receipts:[] as Receipt[],funding:true,registry:true,enabled:true,adapterVersion:config.adapterVersion,active:true,depth:0,signs:0,commits:[] as string[],commands:[] as {operation:string;payload:Record<string,unknown>}[],events:[] as string[],loseCommit:null as string|null,rejectPersist:false,abortAfterSubmission:null as AbortController|null};
 const money={amountMinor:'25',currency:'USD',decimals:2},payoutMoney={amountMinor:'1000',currency:'USDC',decimals:6};
 function snapshot(){return {attemptId:ids.attempt,attemptVersion:String(state.attemptVersion),batchId:ids.batch,batchVersion:String(state.batchVersion),state:state.state,money,payoutMoney,asset,recipientPublicKey:recipient.publicKey.toBase58(),senderPublicKey:source.publicKey.toBase58(),prepared:state.prepared,receipts:state.receipts};}
 function queue(){return {batchId:ids.batch,merchantId:ids.merchant,batchVersion:String(state.batchVersion),state:state.state,beneficiaryId:ids.beneficiary,beneficiaryVersion:'1',recipientPublicKey:recipient.publicKey.toBase58(),beneficiaryState:'VERIFIED',money,payoutMoney,asset,readiness:state.state==='RESERVED'?'VERIFIED_FUNDING_REQUIRED':state.state==='SIGNING'?'AWAITING_SIGNATURE':state.state==='PREPARED'?'READY_FOR_INITIAL_BROADCAST':'EXACT_REBROADCAST_OR_RECONCILIATION_ONLY',configId:ids.config,configVersion:'1',adapterVersion:state.adapterVersion,providerAvailable:state.enabled,provider:'solana-devnet',network:'solana-devnet',genesisHash:DEVNET_GENESIS,mintPublicKey:asset.mint,tokenProgramPublicKey:asset.tokenProgram,senderPublicKey:source.publicKey.toBase58(),feePayerPublicKey:source.publicKey.toBase58(),attemptId:state.attemptVersion?ids.attempt:null,attemptVersion:state.attemptVersion?String(state.attemptVersion):null,transactionId:state.prepared?.signature??null,signedBytesHash:state.prepared?.signedBytesSha256??null,fundingEvidence:state.funding?[{evidenceId:ids.funding,remaining:{...payoutMoney,amountMinor:'1000000'}}]:[]};}
 let operation='';
 const transaction:DriverSettlementTransaction=async run=>{
  assert.equal(state.depth,0);state.depth++;
  try{
   const output=await run({query:async(sql,args=[])=>{
    operation=sql.includes('worker_terminal_queue')?'terminalQueue':sql.includes('worker_attempt_snapshot')?'snapshot':sql.includes('worker_queue')?'queue':sql.includes('worker_asset')?'asset':sql.includes('worker_prepare')?'prepare':sql.includes('worker_submission')?'submission':sql.includes('worker_reconcile')?'reconcile':'unexpected';
    let value:unknown;const payload=args[1] as Record<string,unknown>;
    if(operation==='queue')value={items:state.active&&!['CONFIRMED','FAILED'].includes(state.state)&&args[0]===null?[queue()]:[],nextAfterId:null};
    else if(operation==='terminalQueue')value={items:['CONFIRMED','FAILED'].includes(state.state)&&args[0]===null?[{attemptId:ids.attempt}]:[],nextAfterId:null};
    else if(operation==='asset')value=state.registry?asset:null;
    else if(operation==='snapshot')value=snapshot();
    else {
     state.commands.push({operation,payload:structuredClone(payload)});
     assert.match(String(payload.idempotencyKey),/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
     if(operation==='prepare'&&payload.kind==='ALLOCATE'){
      assert.equal(state.signs,0,'exclusive durable allocation precedes any key loading');
      assert.equal(payload.expectedVersion,String(state.batchVersion));assert.equal(state.state,'RESERVED');
      state.state='SIGNING';state.batchVersion++;state.attemptVersion=1;
      value={kind:'ATTEMPT_ALLOCATED',attemptId:ids.attempt,batchId:ids.batch};
     }else if(operation==='prepare'&&payload.kind==='PERSIST_SIGNED'){
      if(state.rejectPersist)throw Error('VERSION_CONFLICT');
      assert.equal(payload.expectedVersion,String(state.batchVersion));assert.equal(payload.expectedAttemptVersion,String(state.attemptVersion));
      state.prepared=structuredClone(payload.prepared as PreparedPayout);assert.equal(state.prepared.amountMinor,'1000');
      state.state='PREPARED';state.batchVersion++;state.attemptVersion++;value={kind:'ATTEMPT_PREPARED'};
     }else if(operation==='submission'){
      assert.equal(payload.expectedVersion,String(state.attemptVersion));assert.equal(payload.signedBytesHash,state.prepared!.signedBytesSha256);
      if(state.state==='PREPARED'){state.state='SUBMITTED';state.attemptVersion++;state.batchVersion++;}
      value={kind:'EXACT_BYTES_READY',attemptId:ids.attempt,attemptVersion:String(state.attemptVersion),batchId:ids.batch,batchVersion:String(state.batchVersion),state:state.state,transactionId:state.prepared!.signature,signedBytesHash:state.prepared!.signedBytesSha256,signedBytesBase64:state.prepared!.signedBase64.match(/.{1,76}/g)!.join('\n'),prepared:state.prepared,broadcastOnlyAfterCommit:true,fundsTransferred:false};
     }else if(operation==='reconcile'){
      assert.equal(payload.expectedVersion,String(state.attemptVersion));
      if(payload.outcome==='UNKNOWN'){state.state='UNKNOWN';state.attemptVersion++;state.batchVersion++;value={kind:'ATTEMPT_UNKNOWN'};}
      else{
       assert.deepEqual(payload.money,payoutMoney,'SQL receipt uses frozen token atoms, never USD earning cents');
       assert.equal(payload.transactionId,state.prepared!.signature);assert.equal(payload.signedBytesHash,state.prepared!.signedBytesSha256);
       assert.equal(Object.hasOwn(payload,'verified'),false);
       const outcome=payload.outcome as 'CONFIRMED'|'FAILED';
       state.receipts.push({receiptId:ids.receipt,outcome,verificationHash:payload.verificationHash as string,providerEvidence:payload.providerEvidence as Record<string,unknown>,ledgerTransactionId:outcome==='CONFIRMED'?ids.ledger:null});
       if(['CONFIRMED','FAILED'].includes(state.state))value={kind:'RECONCILIATION_INCIDENT'};
       else{state.state=outcome;state.attemptVersion++;state.batchVersion++;value={kind:outcome==='CONFIRMED'?'BATCH_CONFIRMED':'BATCH_FAILED_RELEASED'};}
      }
     }else assert.fail('Unexpected SQL operation');
    }
    return {rows:[{value:structuredClone(value)}]};
   }});
   state.commits.push(operation);state.events.push('commit:'+operation);
   if(operation==='submission')state.abortAfterSubmission?.abort();
   if(operation===state.loseCommit){state.loseCommit=null;throw Error('Synthetic committed response loss');}
   return output;
  }finally{state.depth--;}
 };
 const factory=(policy:PayoutProviderConfig,deps:PayoutProviderDeps):PayoutProvider=>{
  const actual=createPayoutProvider(policy,deps);if(actual.kind!=='ready')return actual;
  return {kind:'ready',prepare:async input=>{
   assert.equal(state.depth,0);assert.equal(state.state,'SIGNING');assert.ok(state.commits.includes('prepare'));
   state.events.push('prepare');return actual.prepare(input);
  },reconcile:async prepared=>{
   assert.equal(state.depth,0);assert.deepEqual(prepared,state.prepared);state.events.push('reconcile');return actual.reconcile(prepared);
  },broadcast:async prepared=>{
   assert.equal(state.depth,0);assert.equal(state.commits.at(-1),'submission','submission COMMIT precedes any provider broadcast');
   assert.ok(state.events.lastIndexOf('reconcile')>state.events.lastIndexOf('broadcast'),'reconcile precedes each exact-byte retry');
   assert.deepEqual(prepared,state.prepared);state.events.push('broadcast');return actual.broadcast(prepared);
  }};
 };
 const dependencies:DriverSettlementDependencies={transaction,providerDeps:{connection:transport.connection,loadSigningKeys:async()=>{assert.equal(state.depth,0);state.signs++;return {source,feePayer:source};}},providerFactory:factory,now:()=>new Date('2026-10-19T00:00:00.000Z')};
 return {state,transport,dependencies,money,payoutMoney,worker:()=>createDriverSettlementWorker(config,dependencies)};
}

test('unavailable is the default and a missing provider cannot allocate, sign or broadcast',async()=>{
 const disabled=await createDriverSettlementWorker().tick();assert.equal(disabled.status,'UNAVAILABLE');assert.deepEqual(disabled.reasons,{NOT_CONFIGURED:1});
 const h=harness();h.dependencies.providerFactory=()=>({kind:'unavailable',reason:'NOT_CONFIGURED'});
 const report=await h.worker().tick();assert.equal(report.status,'UNAVAILABLE');assert.equal(report.unavailable,1);assert.equal(h.state.commands.length,0);assert.equal(h.state.signs,0);assert.equal(h.transport.state.sends.length,0);
});
test('allocation and full persistence precede submission COMMIT and exact-byte send; cents remain separate from atoms',async()=>{
 const h=harness(),report=await h.worker().tick();assert.equal(report.errors,0);assert.equal(report.allocated,1);assert.equal(report.prepared,1);assert.equal(report.broadcastSubmitted,1);assert.equal(report.finalized,0);
 assert.deepEqual(h.state.commands.map(entry=>entry.payload.kind??entry.operation),['ALLOCATE','PERSIST_SIGNED','submission']);
 assert.equal(h.state.prepared!.amountMinor,'1000');assert.deepEqual(h.money,{amountMinor:'25',currency:'USD',decimals:2});
 assert.deepEqual(h.transport.state.sends,[Buffer.from(h.state.prepared!.signedBase64,'base64')]);assert.equal(h.state.signs,1);
 const signed=h.state.commands[1].payload.prepared as PreparedPayout;assert.deepEqual(signed,h.state.prepared);assert.equal(createHash('sha256').update(h.transport.state.sends[0]).digest('hex'),signed.signedBytesSha256);
});
test('restart after ambiguous signed-persistence COMMIT never signs again and sends persisted bytes only',async()=>{
 const h=harness();h.state.loseCommit='prepare';
 // The first response loss occurs after ALLOCATE; no signing can precede its acknowledged commit.
 const first=await h.worker().tick();assert.equal(first.errors,1);assert.equal(h.state.state,'SIGNING');assert.equal(h.state.signs,0);
 // Lose the subsequent PERSIST_SIGNED response, with its immutable bytes committed.
 h.state.loseCommit='prepare';const second=await h.worker().tick();assert.equal(second.errors,1);assert.equal(h.state.state,'PREPARED');assert.equal(h.state.signs,1);assert.equal(h.transport.state.sends.length,0);
 const exact=h.state.prepared!.signedBase64;const resumed=await h.worker().tick();assert.equal(resumed.broadcastSubmitted,1);assert.equal(h.state.signs,1);assert.deepEqual(h.transport.state.sends,[Buffer.from(exact,'base64')]);
});
test('abort after submission COMMIT and restart reconcile before send without changing signed bytes',async()=>{
 const h=harness(),stop=new AbortController();h.state.abortAfterSubmission=stop;
 const first=await h.worker().tick(stop.signal);assert.equal(first.status,'ABORTED');assert.equal(first.submissionCommitted,1);assert.equal(h.state.signs,1);assert.equal(h.transport.state.sends.length,0);
 h.state.abortAfterSubmission=null;const resumed=await h.worker().tick();assert.equal(resumed.broadcastSubmitted,1);assert.equal(h.state.signs,1);assert.equal(h.transport.state.sends.length,1);
});
test('ambiguous send survives restart; exact rebroadcast is reconciled and never resigned',async()=>{
 const h=harness();h.transport.state.sendAmbiguous=true;
 const first=await h.worker().tick();assert.equal(first.broadcastUnknown,1);assert.equal(h.state.state,'UNKNOWN');assert.equal(h.state.signs,1);
 h.transport.state.sendAmbiguous=false;const second=await h.worker().tick();assert.equal(second.broadcastSubmitted,1);assert.equal(h.state.signs,1);
 assert.equal(h.transport.state.sends.length,2);assert.deepEqual(h.transport.state.sends[0],h.transport.state.sends[1]);
});
test('unknown expired history and provisional confirmation remain reserved; only finalized provider failure releases',async()=>{
 const h=harness();await h.worker().tick();h.transport.state.blockHeight=101;
 const expired=await h.worker().tick();assert.equal(expired.unknown,1);assert.equal(expired.failed,0);assert.equal(h.state.state,'UNKNOWN');assert.equal(h.transport.state.sends.length,1);
 h.transport.state.chain=chainReceipt(h.state.prepared!);h.transport.state.commitment='confirmed';
 const provisional=await h.worker().tick();assert.equal(provisional.unknown,1);assert.equal(provisional.finalized,0);assert.equal(h.state.state,'UNKNOWN');
 h.transport.state.commitment='finalized';h.transport.state.chain.meta.err={InstructionError:[0,'Custom']};
 const failure=await h.worker().tick();assert.equal(failure.failed,1);assert.equal(h.state.state,'FAILED');assert.equal(h.state.receipts[0].outcome,'FAILED');assert.equal(h.transport.state.sends.length,1);
});
test('terminal sweep records a late success incident without signing, sending, or replacing the released attempt',async()=>{
 const h=harness();await h.worker().tick();h.transport.state.chain=chainReceipt(h.state.prepared!);h.transport.state.chain.meta.err={InstructionError:[0,'Custom']};
 assert.equal((await h.worker().tick()).failed,1);const sends=h.transport.state.sends.length,signs=h.state.signs;
 h.transport.state.chain=chainReceipt(h.state.prepared!);const late=await h.worker().tick();assert.equal(late.incidents,1);assert.equal(late.finalized,0);assert.equal(h.state.state,'FAILED');assert.equal(h.state.signs,signs);assert.equal(h.transport.state.sends.length,sends);
 assert.deepEqual(h.state.receipts.map(row=>row.outcome),['FAILED','CONFIRMED']);
});
test('finalization is authoritative once, including a repeated terminal sweep after restart',async()=>{
 const h=harness();await h.worker().tick();h.transport.state.chain=chainReceipt(h.state.prepared!);
 const finalized=await h.worker().tick();assert.equal(finalized.finalized,1);assert.equal(h.state.state,'CONFIRMED');
 const again=await h.worker().tick();assert.equal(again.finalized,0);assert.equal(again.alreadyRecorded,1);assert.equal(h.state.receipts.length,1);assert.equal(h.state.signs,1);assert.equal(h.transport.state.sends.length,1);
});
test('CAS persistence loser, wrong adapter identity, absent registry and insufficient funding never broadcast',async()=>{
 const loser=harness();loser.state.rejectPersist=true;const conflict=await loser.worker().tick();assert.equal(conflict.conflicts,1);assert.equal(loser.transport.state.sends.length,0);assert.equal(loser.state.state,'SIGNING');
 const wrong=harness();wrong.state.adapterVersion='different-adapter';assert.equal((await wrong.worker().tick()).unavailable,1);assert.equal(wrong.state.signs,0);assert.equal(wrong.state.commands.length,0);
 const registry=harness();registry.state.registry=false;assert.equal((await registry.worker().tick()).unavailable,1);assert.equal(registry.state.signs,0);assert.equal(registry.state.commands.length,0);
 const funding=harness();funding.state.funding=false;assert.equal((await funding.worker().tick()).unavailable,1);assert.equal(funding.state.signs,0);assert.equal(funding.state.commands.length,0);
});
test('submission refusal after provider disable still reconciles and cannot broadcast',async()=>{
 const h=harness();await h.worker().tick();h.state.enabled=false;const count=h.transport.state.sends.length;
 const paused=await h.worker().tick();assert.equal(paused.unavailable,1);assert.equal(h.transport.state.sends.length,count);assert.equal(h.state.state,'UNKNOWN');assert.equal(h.state.signs,1);
});
test('bounded batch cursor advances past unavailable work without processing the whole queue',async()=>{
 const h=harness(),base=h.dependencies.transaction,cursors:unknown[]=[];
 h.state.funding=false;
 h.dependencies.transaction=async run=>base(db=>run({query:async(sql,args)=>{
  if(sql.includes('worker_queue')){cursors.push(args?.[0]);const reply=await db.query(sql,args);const page=reply.rows[0].value as {items:Record<string,unknown>[];nextAfterId:string|null};
   if(args?.[0]===null){page.items=[page.items[0],{...page.items[0],batchId:'20000000-0000-4000-8000-000000000001'}];}
   return reply;
  }
  return db.query(sql,args);
 }}));
 const worker=createDriverSettlementWorker({...config,maxBatchesPerTick:1},h.dependencies);
 assert.equal((await worker.tick()).processed,1);await worker.tick();assert.deepEqual(cursors,[null,ids.batch]);assert.equal(h.state.signs,0);
});
test('source reconciliation incident blocks new signing/rebroadcast but not finalized proof reconciliation',async()=>{
 const blockSource=(dependencies:DriverSettlementDependencies)=>{
  const base=dependencies.transaction;
  dependencies.transaction=async run=>base(db=>run({query:async(sql,args)=>{
   const reply=await db.query(sql,args);
   if(sql.includes('worker_queue')){
    // This is the in-process harness's own queue value, not an unvalidated runtime payload.
    const page=reply.rows[0].value as {items:Record<string,unknown>[]};
    for(const item of page.items)item.readiness='SOURCE_RECONCILIATION_REQUIRED';
   }
   return reply;
  }}));
 };
 const reserved=harness();blockSource(reserved.dependencies);
 const blocked=await reserved.worker().tick();assert.equal(blocked.unavailable,1);assert.equal(blocked.reasons.SOURCE_RECONCILIATION_REQUIRED,1);assert.equal(reserved.state.signs,0);assert.equal(reserved.state.commands.length,0);
 const signed=harness();await signed.worker().tick();const sends=signed.transport.state.sends.length;blockSource(signed.dependencies);
 const paused=await signed.worker().tick();assert.equal(paused.unavailable,1);assert.equal(signed.state.state,'UNKNOWN');assert.equal(signed.transport.state.sends.length,sends);assert.equal(signed.state.signs,1);assert.ok(signed.state.events.includes('reconcile'));
 signed.transport.state.chain=chainReceipt(signed.state.prepared!);
 const finalized=await signed.worker().tick();assert.equal(finalized.finalized,1);assert.equal(signed.transport.state.sends.length,sends);assert.equal(signed.state.signs,1);
});
test('internal recovery reports provider proof unavailability rather than a successful available status',async()=>{
 const h=harness();await h.worker().tick();h.transport.state.genesis='wrong-genesis-fixture';
 const report=await h.worker().reconcileAttempts([ids.attempt]);assert.equal(report.status,'UNAVAILABLE');assert.equal(report.unavailable,1);assert.equal(report.unknown,1);assert.equal(h.state.state,'UNKNOWN');assert.equal(h.transport.state.sends.length,1);
});
