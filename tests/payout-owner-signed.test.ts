import test from 'node:test';
import assert from 'node:assert/strict';
import {ComputeBudgetProgram,Keypair,PublicKey,SystemProgram,Transaction} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {acceptOwnerSignedPayout,createPayoutProvider,type OwnerPayout,type PayoutTransport} from '../apps/worker/src/payout-provider';
import {fixture,recipient,chainReceipt} from './payout-provider.fixture';
import {USDG_ASSET} from '../packages/domain/src/payment-assets';
import {ownerRefundPolicy} from '../apps/api/src/order-refund-policy';
// Owner-signed refunds: BitPOS prepares the EXACT unsigned transaction and never touches a key; whatever the owner's wallet returns is accepted only if it is that
// message with the treasury's valid signature. Synthetic deterministic test keys and a fake chain only: no key file, no RPC.
const owner=Keypair.fromSeed(new Uint8Array(32).fill(9));
function setup(amount='5400000'){
 const f=fixture(USDG_ASSET,false,recipient.publicKey,amount,owner);f.state.balance=10_000_000n;
 // the shared fake only simulates signed transactions; an owner-mode preparation is deliberately simulated WITHOUT signatures
 const simulate=f.connection.simulateTransaction.bind(f.connection) as (tx:unknown,options:Record<string,unknown>)=>Promise<unknown>;
 (f.connection as unknown as {simulateTransaction:unknown}).simulateTransaction=async(tx:{serialize():Uint8Array},options:Record<string,unknown>)=>{if(options.sigVerify===false){const decoded=Transaction.from(Buffer.from(tx.serialize()));f.state.simulations.push({bytes:Buffer.from(tx.serialize()),query:decoded.instructions[0]?.data[0]===21,options:{...options}});return {context:{slot:10},value:{err:null,logs:[]}};}return simulate(tx,options);};
 const provider=createPayoutProvider({kind:'solana-devnet',...ownerRefundPolicy(owner.publicKey.toBase58(),amount)},{connection:f.connection as PayoutTransport,resolveAsset:async()=>USDG_ASSET,loadSigningKeys:async()=>{f.state.signs++;throw Error('no key');}});
 assert.equal(provider.kind,'ready');
 return {f,provider:provider as Extract<typeof provider,{kind:'ready'}>,amount};
}
const input=(amount:string)=>({attemptId:'refund-1',batchId:'order-1',beneficiaryOwner:recipient.publicKey.toBase58(),amountMinor:amount,asset:USDG_ASSET});
const sign=(owned:OwnerPayout,key:Keypair=owner)=>{const tx=Transaction.from(Buffer.from(owned.unsignedBase64,'base64'));tx.partialSign(key);return tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');};

test('prepareForOwner builds an unsigned transaction paid by the treasury and never loads a key',async()=>{
 const {f,provider,amount}=setup();
 const owned=await provider.prepareForOwner!(input(amount));
 assert.equal(f.state.signs,0,'no signing key was requested');
 assert.equal(owned.sourceOwner,owner.publicKey.toBase58());assert.equal(owned.feePayerOwner,owned.sourceOwner);assert.equal(owned.recipientOwner,recipient.publicKey.toBase58());
 const tx=Transaction.from(Buffer.from(owned.unsignedBase64,'base64'));
 assert.equal(tx.feePayer?.toBase58(),owner.publicKey.toBase58());assert.equal(tx.verifySignatures(),false,'nothing is signed');
 assert.ok(f.state.simulations.some(s=>s.options.sigVerify===false&&!s.query),'simulated without signatures');
 assert.ok(f.state.simulations.every(s=>s.options.sigVerify!==true));
});

test('the owner-signed bytes are accepted only when they are exactly the prepared message with the treasury signature',async()=>{
 const {f,provider,amount}=setup();
 const owned=await provider.prepareForOwner!(input(amount));const policy=ownerRefundPolicy(owned.sourceOwner,amount);
 const prepared=acceptOwnerSignedPayout(owned,sign(owned),policy);
 assert.equal(prepared.signature.length>=64,true);assert.equal(prepared.amountMinor,amount);
 // the keyless provider reconciles those exact bytes against (fake) finalized chain history
 f.state.chain=chainReceipt(prepared,'10000000');
 const r=await provider.reconcile(prepared);assert.equal(r.status,'FINALIZED');
 // not signed / signed by someone else / not the prepared message / not base64 / over policy
 assert.throws(()=>acceptOwnerSignedPayout(owned,owned.unsignedBase64,policy),/INVALID_REQUEST/,'unsigned bytes');
 const forged=Transaction.from(Buffer.from(owned.unsignedBase64,'base64'));forged.addSignature(owner.publicKey,Buffer.from(nacl.sign.detached(forged.serializeMessage(),Keypair.fromSeed(new Uint8Array(32).fill(8)).secretKey)));
 assert.throws(()=>acceptOwnerSignedPayout(owned,forged.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64'),policy),/INVALID_REQUEST/,'a signature made by another key');
 const tampered=Transaction.from(Buffer.from(owned.unsignedBase64,'base64'));tampered.add(SystemProgram.transfer({fromPubkey:owner.publicKey,toPubkey:new PublicKey('11111111111111111111111111111112'),lamports:1}));tampered.sign(owner);
 assert.throws(()=>acceptOwnerSignedPayout(owned,tampered.serialize().toString('base64'),policy),/INVALID_REQUEST/,'an added instruction');
 assert.throws(()=>acceptOwnerSignedPayout(owned,'not base64!',policy),/INVALID_REQUEST/);
 assert.throws(()=>acceptOwnerSignedPayout(owned,sign(owned),{...policy,maxAmountMinor:'1'}),/INVALID_REQUEST/,'above the allowed amount');
 assert.throws(()=>acceptOwnerSignedPayout(owned,sign(owned),{...policy,sourceOwner:recipient.publicKey.toBase58(),feePayerOwner:recipient.publicKey.toBase58()}),/INVALID_REQUEST/,'another treasury');
 assert.throws(()=>acceptOwnerSignedPayout({...owned,amountMinor:'1'},sign(owned),policy),/INVALID_REQUEST/,'an amount that does not match the signed message');
});

test('owner mode refuses a separate fee payer and a shortfall',async()=>{
 const {f,provider,amount}=setup();
 f.state.balance=1000n;await assert.rejects(provider.prepareForOwner!(input(amount)),/INSUFFICIENT_LIQUIDITY/);
 const other=Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey.toBase58();
 const split=createPayoutProvider({kind:'solana-devnet',...ownerRefundPolicy(owner.publicKey.toBase58(),amount),feePayerOwner:other},{connection:f.connection as PayoutTransport,resolveAsset:async()=>USDG_ASSET,loadSigningKeys:async()=>{throw Error('no key');}}) as Extract<ReturnType<typeof createPayoutProvider>,{kind:'ready'}>;
 f.state.balance=10_000_000n;await assert.rejects(split.prepareForOwner!(input(amount)),/CONFIG_ERROR/);
 assert.equal(bs58.encode(new Uint8Array(1)).length,1);
});

// A real wallet check on live devnet showed Phantom inserting its own SetComputeUnitLimit(200000) first when a transaction has none, which changes the message.
// Owner-mode transactions therefore already carry exactly that instruction (appended LAST so the transfer keeps its index); a wallet that still adds or reorders is refused.
test('owner mode ends the message with SetComputeUnitLimit and SetComputeUnitPrice, and a wallet that adds another compute-budget instruction is refused',async()=>{
 const {provider,amount}=setup();
 const owned=await provider.prepareForOwner!(input(amount));const policy=ownerRefundPolicy(owned.sourceOwner,amount);
 assert.equal(owned.computeUnitLimit,200_000);assert.equal(owned.computeUnitPrice,1);
 const CB='ComputeBudget111111111111111111111111111111';
 const tx=Transaction.from(Buffer.from(owned.unsignedBase64,'base64'));
 const programs=tx.instructions.map(i=>i.programId.toBase58());
 assert.deepEqual(programs.slice(-2),[CB,CB],'the two compute-budget instructions are last, so the transfer index is unchanged');
 assert.equal(programs.filter(p=>p===CB).length,2);
 const [limit,price]=tx.instructions.slice(-2) as [Transaction['instructions'][number],Transaction['instructions'][number]];
 assert.equal(limit.data[0],2,'SetComputeUnitLimit');assert.equal(limit.data.readUInt32LE(1),200_000);
 assert.equal(price.data[0],3,'SetComputeUnitPrice');assert.equal(price.data.readBigUInt64LE(1),1n);
 acceptOwnerSignedPayout(owned,sign(owned),policy); // a wallet that finds both already present signs the message untouched
 // what Phantom actually did on devnet before this change: it put its own price (375000) first
 const phantomLike=Transaction.from(Buffer.from(owned.unsignedBase64,'base64'));
 phantomLike.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({microLamports:375_000}));phantomLike.sign(owner);
 assert.throws(()=>acceptOwnerSignedPayout(owned,phantomLike.serialize().toString('base64'),policy),/INVALID_REQUEST/,'a wallet-inserted priority fee changes the message');
 const dup=Transaction.from(Buffer.from(owned.unsignedBase64,'base64'));dup.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({units:200_000}));dup.sign(owner);
 assert.throws(()=>acceptOwnerSignedPayout(owned,dup.serialize().toString('base64'),policy),/INVALID_REQUEST/,'a wallet-inserted duplicate limit is refused');
});
