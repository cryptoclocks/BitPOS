import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,TransactionMessage,VersionedTransaction,ComputeBudgetProgram,TransactionInstruction} from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import {assertX402Message,x402Memo,X402_NETWORK,X402_USDC,type X402Attempt} from './x402-payment';
import {ata} from './payments';
import {ExactSvmScheme} from '@x402/svm/exact/facilitator';
import type {FacilitatorSvmSigner} from '@x402/svm';
import type {Address} from '@solana/kit';
import {assetSettlement} from '../../../packages/domain/src/payment-assets';
// Offline transaction fixtures: no RPC, keys or provider calls, not devnet/Phantom evidence.
function fixture(){
 const owner=Keypair.generate(),sponsor=Keypair.generate(),recipient=Keypair.generate().publicKey.toBase58(),blockhash=Keypair.generate().publicKey.toBase58();
 const asset={assetId:'usdc-devnet',symbol:'USDC',displayLabel:'USDC devnet (Circle)',cluster:'devnet',genesisHash:'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',mint:X402_USDC,tokenProgram:spl.TOKEN_PROGRAM_ID.toBase58(),decimals:6,instructionPolicy:'spl_checked',issuerTestAsset:true} as const;
 const payer=owner.publicKey.toBase58(),feePayer=sponsor.publicKey.toBase58(),memo=x402Memo('merchant','order','attempt','reference');
 const a:X402Attempt={id:'attempt',merchant_id:'merchant',order_id:'order',reference:'reference',payer,recipient,amount_minor:'10000',mint:asset.mint,token_program:asset.tokenProgram,signature:null,signed_base64:null,transaction_base64:null,blockhash,last_valid_height:'123',status:'READY',payment:{quoteId:'quote',asset,settlement:assetSettlement(asset,'10000',{id:'fixture-raw',numerator:'1',denominator:'1'},recipient),payer,recipient,reference:'reference',expiresAt:new Date(Date.now()+60000).toISOString()},x402:{kind:'x402',merchantId:'merchant',orderId:'order',attemptId:'attempt',quoteId:'quote',owner:payer,transferAuthority:payer,resource:'https://example.test/api/pay/access/x402',memo,feePayer,blockhash,lastValidHeight:'123',requirements:{scheme:'exact',network:X402_NETWORK,asset:X402_USDC,amount:'10000',payTo:recipient,maxTimeoutSeconds:60,extra:{memo,feePayer,recentBlockhash:blockhash,lastValidBlockHeight:'123'}}}};
 const instructions=[ComputeBudgetProgram.setComputeUnitLimit({units:20000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:1}),spl.createTransferCheckedInstruction(ata(payer,asset),new PublicKey(X402_USDC),ata(recipient,asset),owner.publicKey,10000n,6),new TransactionInstruction({programId:new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),keys:[],data:Buffer.from(memo)})];
 function encode(){const tx=new VersionedTransaction(new TransactionMessage({payerKey:sponsor.publicKey,recentBlockhash:blockhash,instructions}).compileToV0Message());tx.sign([owner]);return Buffer.from(tx.serialize()).toString('base64');}
 return {a,owner,sponsor,instructions,encode};
}
test('canonical partially signed exact message accepts, sponsor signature required for finalized journal',()=>{const f=fixture();assertX402Message(f.encode(),f.a);assert.throws(()=>assertX402Message(f.encode(),f.a,true));const tx=assertX402Message(f.encode(),f.a);tx.sign([f.sponsor]);assertX402Message(Buffer.from(tx.serialize()).toString('base64'),f.a,true);});
test('changing both frozen reference fields cannot reattribute an already signed message',()=>{const f=fixture(),bytes=f.encode();f.a.reference='different-reference';f.a.payment.reference='different-reference';assert.throws(()=>assertX402Message(bytes,f.a));});
for(const defect of ['memo','amount','mint','recipient','blockhash','authority','extra instruction','payer signature'] as const)test('rejects '+defect,()=>{
 const f=fixture();let bytes:string;
 if(defect==='memo')f.instructions[3].data=Buffer.from('other-order');
 if(defect==='amount')f.instructions[2].data.writeBigUInt64LE(10001n,1);
 if(defect==='mint')f.instructions[2].keys[1].pubkey=Keypair.generate().publicKey;
 if(defect==='recipient')f.instructions[2].keys[2].pubkey=Keypair.generate().publicKey;
 if(defect==='authority')f.a.x402.transferAuthority=Keypair.generate().publicKey.toBase58();
 if(defect==='extra instruction')f.instructions.push(f.instructions[3]);
 bytes=f.encode();
 if(defect==='blockhash')f.a.x402.blockhash=Keypair.generate().publicKey.toBase58();
 if(defect==='payer signature'){const tx=VersionedTransaction.deserialize(Buffer.from(bytes,'base64'));tx.signatures[1][0]^=1;bytes=Buffer.from(tx.serialize()).toString('base64');}
 assert.throws(()=>assertX402Message(bytes,f.a));
});
test('unmodified installed SDK exact verifier accepts canonical manual fixture and rejects wrong memo',async()=>{
 const f=fixture();let simulations=0;
 const signer:FacilitatorSvmSigner={getAddresses:()=>[f.a.x402.feePayer as Address],simulateTransaction:async()=>{simulations++;},signTransaction:async()=>{throw Error('No signing in offline verifier guard');},sendTransaction:async()=>{throw Error('No broadcasting in offline guard');},confirmTransaction:async()=>{throw Error('No RPC in offline guard');}};
 const sdk=new ExactSvmScheme(signer,undefined,{enableSmartWalletVerification:false,maxComputeUnits:20000,maxPriorityFeeMicroLamports:1,maxRequiredSignatures:2});
 const payload={x402Version:2,resource:{url:f.a.x402.resource},accepted:f.a.x402.requirements,payload:{transaction:f.encode()}};
 assert.equal((await sdk.verify(payload,f.a.x402.requirements)).isValid,true);assert.equal(simulations,1);
 f.instructions[3].data=Buffer.from('wrong-order');payload.payload.transaction=f.encode();
 assert.equal((await sdk.verify(payload,f.a.x402.requirements)).isValid,false);assert.equal(simulations,1);
});
test('delegated exact preserves source owner separately from SDK payer authority',async()=>{
 const f=fixture(),delegate=Keypair.generate();f.a.x402.grantId='grant';f.a.x402.holdId='hold';f.a.x402.transferAuthority=delegate.publicKey.toBase58();
 f.instructions[2]=spl.createTransferCheckedInstruction(ata(f.a.payer,f.a.payment.asset),new PublicKey(X402_USDC),ata(f.a.recipient,f.a.payment.asset),delegate.publicKey,10000n,6);
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:f.sponsor.publicKey,recentBlockhash:f.a.x402.blockhash,instructions:f.instructions}).compileToV0Message());tx.sign([delegate]);const bytes=Buffer.from(tx.serialize()).toString('base64');
 assertX402Message(bytes,f.a);
 const signer:FacilitatorSvmSigner={getAddresses:()=>[f.a.x402.feePayer as Address],simulateTransaction:async()=>{},signTransaction:async()=>{throw Error('Offline guard');},sendTransaction:async()=>{throw Error('Offline guard');},confirmTransaction:async()=>{throw Error('Offline guard');}};
 const sdk=new ExactSvmScheme(signer,undefined,{enableSmartWalletVerification:false,maxComputeUnits:20000,maxPriorityFeeMicroLamports:1,maxRequiredSignatures:2});
 const result=await sdk.verify({x402Version:2,resource:{url:f.a.x402.resource},accepted:f.a.x402.requirements,payload:{transaction:bytes}},f.a.x402.requirements);
 assert.equal(result.isValid,true);assert.equal(result.payer,delegate.publicKey.toBase58());assert.notEqual(result.payer,f.a.payer);
 delete f.a.x402.holdId;assert.throws(()=>assertX402Message(bytes,f.a));
});
