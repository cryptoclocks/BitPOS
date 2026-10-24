import test from 'node:test';import assert from 'node:assert/strict';
import {Keypair,Transaction,SystemProgram} from '@solana/web3.js';import bs58 from 'bs58';
import {createRefundFeeVerifier} from '../apps/worker/src/refund-fee-verifier';import {DEVNET_GENESIS} from '../packages/domain/src/index';
test('native fee credit binds finalized signed direct deposit, recipient and exact balance deltas',async()=>{
 const source=Keypair.fromSeed(new Uint8Array(32).fill(21)),recipient=Keypair.fromSeed(new Uint8Array(32).fill(22));
 const signed=new Transaction({feePayer:source.publicKey,recentBlockhash:SystemProgram.programId.toBase58()}).add(SystemProgram.transfer({fromPubkey:source.publicKey,toPubkey:recipient.publicKey,lamports:10000}));signed.sign(source);
 const message=signed.compileMessage(),signature=bs58.encode(signed.signature!),index=message.accountKeys.findIndex(k=>k.equals(recipient.publicKey));
 const pre=message.accountKeys.map(()=>0),post=[...pre];pre[0]=100000;post[0]=85000;post[index]=10000;
 const chain={slot:10,transaction:{message,signatures:[signature]},meta:{err:null,fee:5000,preBalances:pre,postBalances:post,innerInstructions:[]}};
 let genesis=DEVNET_GENESIS;const verifier=createRefundFeeVerifier({getGenesisHash:async()=>genesis,getTransaction:async(_signature,options)=>{assert.equal(options?.commitment,'finalized');return chain as never;}});
 const input={signature,recipientOwner:recipient.publicKey.toBase58()};const result=await verifier.verify(input);assert.equal(result.status,'VERIFIED');if(result.status==='VERIFIED')assert.equal(result.evidence.amountLamports,'10000');
 post[index]=9999;assert.equal((await verifier.verify(input)).status,'UNAVAILABLE');post[index]=10000;
 assert.equal((await verifier.verify({...input,recipientOwner:source.publicKey.toBase58()})).status,'UNAVAILABLE');
 chain.meta.err='failed' as never;assert.equal((await verifier.verify(input)).status,'UNAVAILABLE');chain.meta.err=null;
 genesis='wrong-genesis';assert.equal((await verifier.verify(input)).status,'UNAVAILABLE');assert.equal((await createRefundFeeVerifier().verify(input)).status,'UNAVAILABLE');
});
