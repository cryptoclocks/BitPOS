import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,Transaction,type VersionedTransaction,type AccountInfo} from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {createPayoutProvider,beneficiaryOwnershipChallengeMessage,verifyBeneficiaryOwnershipChallenge,type PayoutTransport,type ReadyPayoutProvider,type PreparedPayout,type BeneficiaryOwnershipChallenge} from '../apps/worker/src/payout-provider';
import {DEVNET_GENESIS} from '../packages/domain/src/index';
import {USDC_DEVNET_MINT,SPL_TOKEN_PROGRAM,USDG_ASSET} from '../packages/domain/src/payment-assets';
import type {PaymentAsset} from '../packages/contracts/src/index';
import {source,recipient,asset,fixture,chainReceipt} from './payout-provider.fixture';
test('unconfigured payouts cannot sign or send; incomplete active policy is rejected',()=>{
 assert.deepEqual(createPayoutProvider(undefined),{kind:'unavailable',reason:'NOT_CONFIGURED'});
 assert.throws(()=>createPayoutProvider({kind:'solana-devnet'}),/CONFIG_ERROR/);
});
test('canonical amount, actual liquidity and registry authority are checked before signing',async()=>{
 const f=fixture();for(const amountMinor of ['0','-1','1.0','1e3','010','1000001'])await assert.rejects(f.provider.prepare({attemptId:'a',batchId:'b',beneficiaryOwner:recipient.publicKey.toBase58(),amountMinor,asset}),/INVALID_REQUEST/);
 f.state.registry={...asset,mint:PublicKey.default.toBase58()};await assert.rejects(f.prepare(),/ASSET_POLICY/);f.state.registry=asset;
 f.state.balance=999n;await assert.rejects(f.prepare(),/INSUFFICIENT_LIQUIDITY/);assert.equal(f.state.signs,0);assert.equal(f.state.sends.length,0);
});
test('successful exact signed transfer is provisional until finalized; wrong recipient or amount cannot discharge',async()=>{
 const f=fixture(),prepared=await f.prepare(),tx=Transaction.from(Buffer.from(prepared.signedBase64,'base64'));
 assert.equal(spl.decodeTransferCheckedInstruction(tx.instructions[0]).data.amount,1000n);
 assert.equal(tx.instructions[1].data.toString(),prepared.memo);assert.equal(tx.verifySignatures(),true);
 f.state.chain=chainReceipt(prepared);f.state.commitment='confirmed';assert.equal((await f.provider.reconcile(prepared)).status,'CONFIRMED');
 f.state.commitment='finalized';const result=await f.provider.reconcile(prepared);assert.equal(result.status,'FINALIZED');if(result.status!=='FINALIZED')assert.fail('Expected final receipt');assert.equal(result.receipt.evidence.amountMinor,'1000');
 f.state.chain.meta.postTokenBalances[1].uiTokenAmount.amount='999';assert.deepEqual(await f.provider.reconcile(prepared),{status:'UNKNOWN',signature:prepared.signature,reason:'PROOF_REJECTED'});
 f.state.chain=chainReceipt(prepared);f.state.chain.meta.postTokenBalances[1].owner=source.publicKey.toBase58();assert.equal((await f.provider.reconcile(prepared)).status,'UNKNOWN');
});
test('ambiguous submission and absent expired history never authorize replacement; stored bytes cannot be tampered',async()=>{
 const f=fixture(),prepared=await f.prepare();f.connection.isBlockhashValid=async()=>({context:{slot:11},value:true});f.state.sendAmbiguous=true;
 assert.equal((await f.provider.broadcast(prepared)).status,'UNKNOWN');assert.equal((await f.provider.broadcast(prepared)).status,'UNKNOWN');assert.equal(f.state.signs,1);assert.deepEqual(f.state.sends,[Buffer.from(prepared.signedBase64,'base64'),Buffer.from(prepared.signedBase64,'base64')]);
 assert.equal((await f.provider.broadcast({...prepared,amountMinor:'1001'})).status,'NOT_BROADCAST');assert.equal(f.state.sends.length,2);
 f.connection.isBlockhashValid=async()=>({context:{slot:11},value:false});const result=await f.provider.reconcile(prepared);assert.equal(result.status,'UNKNOWN');if(result.status==='UNKNOWN'){assert.equal(result.reason,'EXPIRED_WITHOUT_COMPLETE_HISTORY');assert.equal(result.expiry?.absenceIsConclusive,false);}
 f.state.history={err:{InstructionError:[0,'Custom']},confirmationStatus:'finalized'};assert.equal((await f.provider.reconcile(prepared)).status,'UNKNOWN');
 f.state.chain=chainReceipt(prepared);f.state.chain.meta.err={InstructionError:[0,'Custom']};f.state.commitment='confirmed';assert.equal((await f.provider.reconcile(prepared)).status,'UNKNOWN');f.state.commitment='finalized';assert.equal((await f.provider.reconcile(prepared)).status,'FAILED');
});
test('beneficiary ownership signature binds exact stored account device enrollment destination and expiry',()=>{
 const challenge:BeneficiaryOwnershipChallenge={version:1,domain:'bitpos.local',tenantId:'tenant-fixture',accountId:'driver-fixture',deviceId:'device-fixture',enrollmentId:'enrollment-fixture',challengeId:'challenge-fixture',nonce:'a'.repeat(64),destinationOwner:recipient.publicKey.toBase58(),genesisHash:DEVNET_GENESIS,issuedAt:'2026-10-19T00:00:00.000Z',expiresAt:'2026-10-19T00:05:00.000Z'};
 const signature=bs58.encode(nacl.sign.detached(Buffer.from(beneficiaryOwnershipChallengeMessage(challenge)),recipient.secretKey)),now=Date.parse(challenge.issuedAt);
 assert.equal(verifyBeneficiaryOwnershipChallenge(challenge,signature,now).status,'VERIFIED');
 for(const field of ['domain','tenantId','accountId','deviceId','enrollmentId','challengeId','nonce'] as const){const altered={...challenge,[field]:field==='nonce'?'b'.repeat(64):'other-fixture'};assert.equal(verifyBeneficiaryOwnershipChallenge(altered,signature,now).status,'REJECTED');}
 assert.equal(verifyBeneficiaryOwnershipChallenge({...challenge,destinationOwner:source.publicKey.toBase58()},signature,now).status,'REJECTED');assert.equal(verifyBeneficiaryOwnershipChallenge(challenge,signature,Date.parse(challenge.expiresAt)).status,'REJECTED');
});
test('USDG zero-fee mint policy and recipient ATA creation preserve exact atoms; changed future fees or program cannot sign',async()=>{
 const f=fixture(USDG_ASSET);f.state.recipientExists=false;const prepared=await f.prepare(),tx=Transaction.from(Buffer.from(prepared.signedBase64,'base64')),transfer=spl.decodeTransferCheckedWithFeeInstruction(tx.instructions[1],spl.TOKEN_2022_PROGRAM_ID);
 assert.equal(transfer.data.amount,1000n);assert.equal(transfer.data.fee,0n);assert.equal(prepared.createRecipientAccount,true);assert.equal(prepared.rentLamports,512000,'Validated program-returned512 bytes must determine actual rent');
 assert.equal(f.state.simulations.length,2);const [sizeQuery,finalSimulation]=f.state.simulations,query=Transaction.from(sizeQuery.bytes);
 assert.equal(sizeQuery.query,true);assert.deepEqual(sizeQuery.options,{sigVerify:false,replaceRecentBlockhash:false,commitment:'confirmed',minContextSlot:10});assert.equal(query.feePayer!.toBase58(),prepared.feePayerOwner);assert.equal(query.instructions.length,1);
 assert.equal(query.instructions[0].programId.toBase58(),USDG_ASSET.tokenProgram);assert.deepEqual(query.instructions[0].data,Buffer.from([21,7,0]));assert.deepEqual(query.instructions[0].keys,[{pubkey:new PublicKey(USDG_ASSET.mint),isSigner:false,isWritable:false}]);
 assert.equal(finalSimulation.query,false);assert.deepEqual(finalSimulation.options,{sigVerify:true,replaceRecentBlockhash:false,commitment:'confirmed',minContextSlot:10});assert.deepEqual(finalSimulation.bytes,Buffer.from(prepared.signedBase64,'base64'));assert.equal(Transaction.from(finalSimulation.bytes).verifySignatures(),true);
 f.state.chain=chainReceipt(prepared);f.state.chain.meta.preTokenBalances.pop();assert.equal((await f.provider.reconcile(prepared)).status,'FINALIZED');
 const unsafe=fixture(USDG_ASSET);unsafe.state.mint.data.writeUInt16LE(1,166+110);await assert.rejects(unsafe.prepare(),/ASSET_POLICY/);assert.equal(unsafe.state.signs,0);
 const wrongProgram=fixture(USDG_ASSET);wrongProgram.state.mint.owner=spl.TOKEN_PROGRAM_ID;await assert.rejects(wrongProgram.prepare(),/PROVIDER_UNAVAILABLE/);assert.equal(wrongProgram.state.signs,0);
 const badSize=fixture(USDG_ASSET);badSize.state.recipientExists=false;badSize.state.accountSize=1n;await assert.rejects(badSize.prepare(),/ASSET_POLICY/);assert.equal(badSize.state.signs,0);
 const badProgram=fixture(USDG_ASSET);badProgram.state.recipientExists=false;badProgram.state.sizeProgram=SPL_TOKEN_PROGRAM;await assert.rejects(badProgram.prepare(),/PROVIDER_UNAVAILABLE/);assert.equal(badProgram.state.signs,0);
});
test('invalid size-query evidence and excessive actual rent fail before key loading',async()=>{
 const size=Buffer.alloc(8);size.writeBigUInt64LE(512n);
 const cases:[string,(state:ReturnType<typeof fixture>['state'])=>void][]=[
  ['simulation failure',s=>{s.sizeError={InstructionError:[0,'InvalidInstructionData']};}],
  ['missing return data',s=>{s.sizeReturnData=null;}],
  ['malformed return data',s=>{s.sizeReturnData={programId:USDG_ASSET.tokenProgram,data:['AA','base64']};}],
  ['noncanonical base64',s=>{s.sizeReturnData={programId:USDG_ASSET.tokenProgram,data:[size.toString('base64').slice(0,-1),'base64']};}],
  ['wrong encoding',s=>{s.sizeReturnData={programId:USDG_ASSET.tokenProgram,data:[size.toString('base64'),'base58']};}],
  ['oversized account',s=>{s.accountSize=10241n;}],
  ['rent exceeds total cost policy',s=>{s.rentOverride=3000000;}],
 ];
 for(const [name,alter] of cases){const f=fixture(USDG_ASSET);f.state.recipientExists=false;alter(f.state);await assert.rejects(f.prepare(),/PROVIDER_UNAVAILABLE|ASSET_POLICY|FEE_POLICY/,name);assert.equal(f.state.signs,0,name);assert.equal(f.state.sends.length,0,name);}
});
test('independently malformed transfer proofs cannot discharge SPL or Token2022 with distinct source and fee payer',async()=>{
 const cases:[string,(chain:ReturnType<typeof chainReceipt>)=>void][]=[
  ['no source debit',c=>{c.meta.postTokenBalances[0].uiTokenAmount.amount='1000000';}],
  ['wrong mint',c=>{c.meta.postTokenBalances[0].mint=PublicKey.default.toBase58();}],
  ['wrong token program',c=>{c.meta.postTokenBalances[0].programId=PublicKey.default.toBase58();}],
  ['wrong precision',c=>{c.meta.postTokenBalances[0].uiTokenAmount.decimals=9;}],
  ['wrong source owner',c=>{c.meta.postTokenBalances[0].owner=recipient.publicKey.toBase58();}],
  ['changed attribution',c=>{c.transaction.message.instructions[1].data=bs58.encode(Buffer.from('bitpos:payout:other'));}],
  ['changed reference account',c=>{c.transaction.message.instructions[0].accounts[4]=c.transaction.message.instructions[0].accounts[1];}],
  ['wrong required source signature',c=>{c.transaction.signatures[1]=bs58.encode(new Uint8Array(64).fill(1));}],
  ['missing required source signature',c=>{c.transaction.signatures.pop();}],
  ['wrong fee payer signature',c=>{c.transaction.signatures[0]=bs58.encode(new Uint8Array(64).fill(2));}],
 ];
 for(const selected of [asset,USDG_ASSET]){
  const f=fixture(selected,true),prepared=await f.prepare();assert.notEqual(prepared.feePayerOwner,prepared.sourceOwner);const valid=chainReceipt(prepared);assert.equal(valid.transaction.signatures.length,2);f.state.chain=valid;assert.equal((await f.provider.reconcile(prepared)).status,'FINALIZED',selected.symbol+' valid distinct-payer proof');
  for(const [name,alter] of cases){f.state.chain=chainReceipt(prepared);alter(f.state.chain);assert.deepEqual(await f.provider.reconcile(prepared),{status:'UNKNOWN',signature:prepared.signature,reason:'PROOF_REJECTED'},selected.symbol+' '+name);}
 }
});
