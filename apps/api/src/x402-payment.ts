import type pg from 'pg';
import {VersionedTransaction,TransactionMessage,ComputeBudgetProgram,PublicKey} from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {createHash} from 'node:crypto';
import type {PaymentRequirements} from '@x402/core/types';
import type {AttemptRow} from './types';
import type {FrozenPayment} from './payment-assets';
import {chain,ata,PaymentProofError} from './payments';
export const X402_NETWORK='solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as const;
export const X402_USDC='4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MEMO=new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
// The genuine SDK budgets 20k CU. Hash the full immutable attribution tuple;
// spelling every UUID/reference into Memo exhausted that budget on actual devnet.
export function x402Memo(merchantId:string,orderId:string,attemptId:string,reference:string,grantBinding:string|null=null){return 'b2:'+createHash('sha256').update(JSON.stringify([merchantId,orderId,attemptId,reference,grantBinding])).digest('base64url');}
export interface X402Binding {kind:'x402';merchantId:string;orderId:string;attemptId:string;quoteId:string;owner:string;transferAuthority:string;grantId?:string;holdId?:string;resource:string;memo:string;feePayer:string;blockhash:string;lastValidHeight:string;requirements:PaymentRequirements;}
export type X402Attempt=AttemptRow&{payment:FrozenPayment;x402:X402Binding};
export async function readX402Binding(db:pg.PoolClient|pg.Client,a:AttemptRow):Promise<X402Binding|null>{
 const r=(await db.query('SELECT binding FROM x402_attempt_bindings WHERE merchant_id=$1 AND order_id=$2 AND attempt_id=$3',[a.merchant_id,a.order_id,a.id])).rows[0];return r?.binding??null;
}
// This is stricter merchant policy in addition to (not a replacement for) SDK verification.
export function assertX402Message(base64:string,a:X402Attempt,fullySigned=false){
 const b=a.x402,p=a.payment,tx=VersionedTransaction.deserialize(Buffer.from(base64,'base64'));
 if(b.owner!==a.payer||b.transferAuthority!==b.owner&&(!b.grantId||!b.holdId)||b.merchantId!==a.merchant_id||b.orderId!==a.order_id||b.attemptId!==a.id||b.quoteId!==p.quoteId||p.asset.mint!==X402_USDC||p.asset.tokenProgram!==spl.TOKEN_PROGRAM_ID.toBase58()||p.asset.decimals!==6||p.payer!==a.payer||p.recipient!==a.recipient||p.settlement.amountMinor!==a.amount_minor||p.reference!==a.reference)throw new PaymentProofError('Binding mismatch');
 if(!b.grantId&&b.memo!==x402Memo(a.merchant_id,a.order_id,a.id,a.reference))throw new PaymentProofError('Binding mismatch');
 if(tx.version!==0||tx.message.addressTableLookups.length||tx.message.recentBlockhash!==b.blockhash||tx.message.header.numRequiredSignatures!==2)throw new PaymentProofError('Unsupported message');
 const m=TransactionMessage.decompile(tx.message);if(m.payerKey.toBase58()!==b.feePayer||m.instructions.length!==4)throw new PaymentProofError('Wrong sponsor or instructions');
 const expected=[ComputeBudgetProgram.setComputeUnitLimit({units:20000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:1}),spl.createTransferCheckedInstruction(ata(b.owner,p.asset),new PublicKey(X402_USDC),ata(a.recipient,p.asset),new PublicKey(b.transferAuthority),BigInt(a.amount_minor),6,[],spl.TOKEN_PROGRAM_ID),{programId:MEMO,keys:[],data:Buffer.from(b.memo)}];
 for(let i=0;i<expected.length;i++){const x=m.instructions[i],y=expected[i];if(!x.programId.equals(y.programId)||!x.data.equals(y.data)||x.keys.length!==y.keys.length||x.keys.some((k,j)=>!k.pubkey.equals(y.keys[j].pubkey)||k.isSigner!==y.keys[j].isSigner||k.isWritable!==y.keys[j].isWritable))throw new PaymentProofError('Instruction mismatch');}
 const bytes=tx.message.serialize();for(let i=0;i<2;i++){const key=tx.message.staticAccountKeys[i];if(i===0&&!fullySigned){if(tx.signatures[i].some(v=>v!==0))throw new PaymentProofError('Unexpected sponsor signature');continue;}if(i===1&&key.toBase58()!==b.transferAuthority||!nacl.sign.detached.verify(bytes,tx.signatures[i],key.toBytes()))throw new PaymentProofError('Invalid signature');}
 return tx;
}
export async function verifyX402Transfer(signature:string,a:X402Attempt,commitment:'confirmed'|'finalized'){
 const chainTx=await chain.getTransaction(signature,{commitment,maxSupportedTransactionVersion:0});if(!chainTx)return null;
 try{
  if(!a.signed_base64||a.signature!==signature||!chainTx.meta||chainTx.meta.err)throw Error();const signed=assertX402Message(a.signed_base64,a,true);
  if(bs58.encode(signed.signatures[0])!==signature||!Buffer.from(chainTx.transaction.message.serialize()).equals(Buffer.from(signed.message.serialize()))||chainTx.transaction.signatures.length!==2||chainTx.transaction.signatures.some((s,i)=>s!==bs58.encode(signed.signatures[i])))throw Error();
  const keys=chainTx.transaction.message.getAccountKeys();
  for(const [owner,delta] of [[a.x402.owner,-BigInt(a.amount_minor)],[a.recipient,BigInt(a.amount_minor)]] as const){
   const token=ata(owner,a.payment.asset).toBase58();let index=-1;for(let i=0;i<keys.length;i++)if(keys.get(i)?.toBase58()===token)index=i;
   const pre=chainTx.meta.preTokenBalances?.find(v=>v.accountIndex===index),post=chainTx.meta.postTokenBalances?.find(v=>v.accountIndex===index);
   if(!pre||!post||[pre,post].some(v=>v.owner!==owner||v.mint!==X402_USDC||v.programId!==spl.TOKEN_PROGRAM_ID.toBase58()||v.uiTokenAmount.decimals!==6)||BigInt(post.uiTokenAmount.amount)-BigInt(pre.uiTokenAmount.amount)!==delta)throw Error();
  }
  if(chainTx.meta.fee>1000000)throw Error();return {fee:chainTx.meta.fee,slot:chainTx.slot};
 }catch{throw new PaymentProofError('Payment proof rejected');}
}
