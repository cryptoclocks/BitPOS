// Legacy transaction encoding is isolated here for Token-2022 TransferCheckedWithFee.
// Application RPC health uses Kit; Wallet Standard handles all customer signing.
import {createSolanaRpc} from '@solana/kit';
import {Connection,PublicKey,Keypair,Transaction,TransactionInstruction,SystemProgram} from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import fs from 'node:fs';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {config} from './config';
import {MINT,TOKEN_PROGRAM,DEVNET_GENESIS,assertSettlement} from '../../../packages/domain/src/index';
export const kitRpc=createSolanaRpc(config.SOLANA_RPC);
export const chain=new Connection(config.SOLANA_RPC,'confirmed');
const mint=new PublicKey(MINT), token=new PublicKey(TOKEN_PROGRAM);
export const sponsor=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(config.DEVNET_PRIVATE_DIR+'/keys/fee-sponsor.json','utf8'))));
export const ata=(owner:string)=>spl.getAssociatedTokenAddressSync(mint,new PublicKey(owner),false,token);
export async function assertCluster(){if(await kitRpc.getGenesisHash().send()!==DEVNET_GENESIS)throw Error('Devnet genesis mismatch');}
export async function mintPolicy(){const m=await spl.getMint(chain,mint,'confirmed',token);const f=spl.getTransferFeeConfig(m),h=spl.getTransferHook(m);if(m.decimals!==6||!f||f.olderTransferFee.transferFeeBasisPoints!==0||f.newerTransferFee.transferFeeBasisPoints!==0||(h&&!h.programId.equals(SystemProgram.programId)))throw Error('USDG mint configuration changed; payment paused');}
export async function build(attempt:any){await assertCluster();await mintPolicy();const sender=new PublicKey(attempt.payer);const recipient=new PublicKey(attempt.recipient);if(sender.equals(recipient)||sender.equals(sponsor.publicKey)||recipient.equals(sponsor.publicKey))throw Error('Invalid payment participant');
 const from=ata(attempt.payer),to=ata(attempt.recipient);const account=await spl.getAccount(chain,from,'confirmed',token);if(account.isFrozen||account.amount<BigInt(attempt.amount_minor))throw Error('Insufficient or frozen USDG balance');
 const tx=new Transaction();if(!(await chain.getAccountInfo(to)))tx.add(spl.createAssociatedTokenAccountIdempotentInstruction(sponsor.publicKey,to,recipient,mint,token));
 const transfer=spl.createTransferCheckedWithFeeInstruction(from,mint,to,sender,BigInt(attempt.amount_minor),6,0n,[],token);transfer.keys.push({pubkey:new PublicKey(attempt.reference),isSigner:false,isWritable:false});tx.add(transfer);
 const block=await chain.getLatestBlockhash('confirmed');tx.feePayer=sponsor.publicKey;tx.recentBlockhash=block.blockhash;tx.partialSign(sponsor);
 const simulation=await chain.simulateTransaction(tx);if(simulation.value.err)throw Error('Payment simulation failed');
 const fee=(await chain.getFeeForMessage(tx.compileMessage(),'confirmed')).value;if(fee===null||fee>1000000)throw Error('Sponsor fee exceeds policy');
 const createdRent=tx.instructions.length>1?await chain.getMinimumBalanceForRentExemption(spl.ACCOUNT_SIZE):0;if(fee+createdRent>1000000)throw Error('Recipient account setup exceeds per-order sponsor budget; pre-create account');
 return {base64:tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64'),blockhash:block.blockhash,lastValidHeight:block.lastValidBlockHeight,fee};
}
export function validateSigned(base64:string,expectedBase64:string,payer:string){if(base64.length>8192)throw Error('Transaction too large');const signed=Transaction.from(Buffer.from(base64,'base64'));const expected=Transaction.from(Buffer.from(expectedBase64,'base64'));if(!signed.serializeMessage().equals(expected.serializeMessage()))throw Error('Transaction message was changed');if(!signed.verifySignatures())throw Error('Invalid transaction signatures');const owner=new PublicKey(payer);const sig=signed.signatures.find(s=>s.publicKey.equals(owner))?.signature;if(!sig||!nacl.sign.detached.verify(signed.serializeMessage(),sig,owner.toBytes()))throw Error('Missing customer signature');const first=signed.signatures[0]?.signature;if(!first)throw Error('Missing fee payer signature');return {bytes:signed.serialize(),signature:bs58.encode(first)};}
export async function verifyTransfer(signature:string,attempt:any,commitment:'confirmed'|'finalized'){
 const tx=await chain.getTransaction(signature,{commitment,maxSupportedTransactionVersion:0});if(!tx)return null;
 const msg=tx.transaction.message;const keys=msg.getAccountKeys();const strings=Array.from({length:keys.length},(_,i)=>keys.get(i)!.toBase58());
 const source=ata(attempt.payer).toBase58(),dest=ata(attempt.recipient).toBase58();let matched=false;
 for(const raw of msg.compiledInstructions){if(strings[raw.programIdIndex]!==TOKEN_PROGRAM)continue;const accounts=raw.accountKeyIndexes.map(i=>({pubkey:new PublicKey(strings[i]),isSigner:msg.isAccountSigner(i),isWritable:msg.isAccountWritable(i)}));try{const decoded=spl.decodeTransferCheckedWithFeeInstruction(new TransactionInstruction({programId:token,keys:accounts,data:Buffer.from(raw.data)}),token);if(decoded.keys.source.pubkey.toBase58()===source&&decoded.keys.destination.pubkey.toBase58()===dest&&decoded.keys.owner.pubkey.toBase58()===attempt.payer&&decoded.keys.mint.pubkey.toBase58()===MINT&&decoded.data.amount===BigInt(attempt.amount_minor)&&decoded.data.decimals===6&&decoded.data.fee===0n&&raw.accountKeyIndexes.some(i=>strings[i]===attempt.reference))matched=true;}catch{}}
 if(!matched)throw Error('Expected transfer/reference missing');
 const ix=strings.indexOf(dest);const pre=tx.meta?.preTokenBalances?.find(b=>b.accountIndex===ix&&b.mint===MINT);const post=tx.meta?.postTokenBalances?.find(b=>b.accountIndex===ix&&b.mint===MINT);
 if(!post||post.owner!==attempt.recipient||post.programId!==TOKEN_PROGRAM)throw Error('Wrong token destination');
 const actual=BigInt(post.uiTokenAmount.amount)-BigInt(pre?.uiTokenAmount.amount??'0');
 assertSettlement({error:tx.meta?.err,mint:post.mint,program:post.programId,recipient:post.owner,rawAmount:actual,reference:attempt.reference,payer:attempt.payer},{mint:MINT,program:TOKEN_PROGRAM,recipient:attempt.recipient,rawAmount:BigInt(attempt.amount_minor),reference:attempt.reference,payer:attempt.payer});
 return {fee:tx.meta?.fee??0,slot:tx.slot};
}
