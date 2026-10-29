import test from 'node:test';import assert from 'node:assert/strict';import {PublicKey} from '@solana/web3.js';import bs58 from 'bs58';
import {createInboundFundingVerifier} from '../apps/worker/src/payout-provider';import {source,recipient,asset,fundingFixture} from './payout-provider.fixture';import {USDG_ASSET} from '../packages/domain/src/payment-assets';
test('inbound verifier never infers liquidity from unavailable provider or a balance',async()=>{
 assert.deepEqual(await createInboundFundingVerifier().verify({signature:'unconfigured',assetId:asset.assetId,recipientOwner:recipient.publicKey.toBase58()}),{status:'UNAVAILABLE',reason:'NOT_CONFIGURED'});
 const f=await fundingFixture();f.state.chain=null;assert.deepEqual(await f.verifier.verify(f.input),{status:'UNAVAILABLE',reason:'HISTORY_UNAVAILABLE'});assert.equal(f.state.sends.length,0);
});
test('finalized inbound funding derives exact net atoms for SPL and Token2022 without signing or sending',async()=>{
 for(const selected of [asset,USDG_ASSET]){const f=await fundingFixture(selected),signs=f.state.signs,result=await f.verifier.verify(f.input);assert.equal(result.status,'VERIFIED',selected.symbol);if(result.status!=='VERIFIED')assert.fail('Expected funding evidence');assert.equal(result.evidence.amountMinor,'1000');assert.equal(result.evidence.recipientOwner,f.input.recipientOwner);assert.equal(result.evidence.sourcePostMinor,'999000');assert.equal(f.state.signs,signs);assert.equal(f.state.sends.length,0);}
});
test('inbound funding rejects wrong chain, failed tx, source debit, recipient, mint, precision, signatures and CPI',async()=>{
 for(const selected of [asset,USDG_ASSET]){
  const cases:[string,(f:Awaited<ReturnType<typeof fundingFixture>>)=>void][]=[
   ['wrong chain',f=>{f.state.genesis='wrong';}],['failed transaction',f=>{f.state.chain.meta.err={InstructionError:[0,'failure']};}],
   ['missing source debit',f=>{f.state.chain.meta.postTokenBalances[0].uiTokenAmount.amount='1000000';}],['incorrect credit',f=>{f.state.chain.meta.postTokenBalances[1].uiTokenAmount.amount='999';}],
   ['wrong recipient',f=>{f.input.recipientOwner=source.publicKey.toBase58();}],['wrong mint',f=>{f.state.chain.meta.postTokenBalances[1].mint=PublicKey.default.toBase58();}],
   ['wrong program',f=>{f.state.chain.meta.postTokenBalances[1].programId=PublicKey.default.toBase58();}],
   ['wrong decimals',f=>{f.state.chain.meta.postTokenBalances[1].uiTokenAmount.decimals=9;}],['wrong signature',f=>{f.state.chain.transaction.signatures[0]=bs58.encode(new Uint8Array(64).fill(1));}],
   ['unexpected transfer CPI',f=>{f.state.chain.meta.innerInstructions=[{index:0,instructions:[{}]}];}],
  ];
  for(const [name,alter] of cases){const f=await fundingFixture(selected);alter(f);assert.equal((await f.verifier.verify(f.input)).status,'UNAVAILABLE',selected.symbol+' '+name);assert.equal(f.state.sends.length,0);}
 }
});
