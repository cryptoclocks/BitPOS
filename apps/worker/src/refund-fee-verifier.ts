import {createHash} from 'node:crypto';
import {PublicKey,SystemProgram,SystemInstruction,TransactionInstruction} from '@solana/web3.js';
import nacl from 'tweetnacl';import bs58 from 'bs58';
import {DEVNET_GENESIS} from '../../../packages/domain/src/index';
import type {PayoutTransport} from './payout-provider';
/** Read-only finalized native SOL deposit verifier; balance alone is not credit.
 * Supports one direct System transfer only. No signing, RPC construction or IO
 * until verify is explicitly invoked. SQL global-reference admission is separate. */
export function createRefundFeeVerifier(connection?:Pick<PayoutTransport,'getGenesisHash'|'getTransaction'>){
 return {async verify(input:{signature:string;recipientOwner:string}){
  const unavailable=(reason:string)=>({status:'UNAVAILABLE' as const,reason});
  if(!connection)return unavailable('NOT_CONFIGURED');
  try{
   const recipient=new PublicKey(input.recipientOwner);if(recipient.toBase58()!==input.recipientOwner||!PublicKey.isOnCurve(recipient.toBytes())||bs58.decode(input.signature).length!==64)return unavailable('PROOF_REJECTED');
   if(await connection.getGenesisHash()!==DEVNET_GENESIS)return unavailable('PROVIDER_UNAVAILABLE');
   const tx=await connection.getTransaction(input.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});if(!tx)return unavailable('HISTORY_UNAVAILABLE');
   if(!tx.meta||tx.meta.err!==null||!Number.isSafeInteger(tx.slot)||tx.slot<0)return unavailable('PROOF_REJECTED');
   const message=tx.transaction.message,bytes=message.serialize(),keys=message.getAccountKeys({accountKeysFromLookups:tx.meta.loadedAddresses});
   if(tx.transaction.signatures[0]!==input.signature||tx.transaction.signatures.length!==message.header.numRequiredSignatures)return unavailable('PROOF_REJECTED');
   for(let i=0;i<message.header.numRequiredSignatures;i++)if(!nacl.sign.detached.verify(bytes,bs58.decode(tx.transaction.signatures[i]),keys.get(i)!.toBytes()))return unavailable('PROOF_REJECTED');
   if(message.compiledInstructions.length!==1||tx.meta.innerInstructions?.some(v=>v.instructions.length))return unavailable('PROOF_REJECTED');
   const compiled=message.compiledInstructions[0],program=keys.get(compiled.programIdIndex)!;
   if(!program.equals(SystemProgram.programId)||compiled.accountKeyIndexes.length!==2)return unavailable('PROOF_REJECTED');
   const instruction=new TransactionInstruction({programId:program,data:Buffer.from(compiled.data),keys:[...compiled.accountKeyIndexes].map(i=>({pubkey:keys.get(i)!,isSigner:message.isAccountSigner(i),isWritable:message.isAccountWritable(i)}))});
   if(SystemInstruction.decodeInstructionType(instruction)!=='Transfer')return unavailable('PROOF_REJECTED');
   const transfer=SystemInstruction.decodeTransfer(instruction),amount=BigInt(transfer.lamports),sourceIndex=compiled.accountKeyIndexes[0],destinationIndex=compiled.accountKeyIndexes[1];
   if(!transfer.toPubkey.equals(recipient)||transfer.fromPubkey.equals(recipient)||destinationIndex===0||!message.isAccountSigner(sourceIndex)||!message.isAccountWritable(destinationIndex)||amount<=0n||amount>BigInt(Number.MAX_SAFE_INTEGER))return unavailable('PROOF_REJECTED');
   const balances=[tx.meta.preBalances[sourceIndex],tx.meta.postBalances[sourceIndex],tx.meta.preBalances[destinationIndex],tx.meta.postBalances[destinationIndex],tx.meta.fee];
   if(!balances.every(n=>Number.isSafeInteger(n)&&n>=0))return unavailable('PROOF_REJECTED');
   const [preSource,postSource,preRecipient,postRecipient,fee]=balances.map(BigInt);
   if(preSource-postSource!==amount+(sourceIndex===0?fee:0n)||postRecipient-preRecipient!==amount)return unavailable('PROOF_REJECTED');
   const evidence={version:1,kind:'FINALIZED_NATIVE_FEE_FUNDING',genesisHash:DEVNET_GENESIS,signature:input.signature,slot:tx.slot,sourceOwner:transfer.fromPubkey.toBase58(),recipientOwner:recipient.toBase58(),amountLamports:amount.toString(),messageSha256:createHash('sha256').update(bytes).digest('hex')};
   return {status:'VERIFIED' as const,evidence,digest:createHash('sha256').update(JSON.stringify(['BitPOS/RefundFeeFunding/v1',evidence])).digest('hex')};
  }catch{return unavailable('PROOF_REJECTED');}
 }};
}
