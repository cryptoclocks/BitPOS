import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Connection,Keypair,PublicKey,Transaction} from '@solana/web3.js';
import {TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync,getAccount,getMint,getTransferFeeConfig,createTransferCheckedWithFeeInstruction} from '@solana/spl-token';
import bs58 from 'bs58';

// Two explicit, locally controlled devnet validation-fund recycle purposes.
// Neither is an application/customer refund or changes sponsor reservations.
const vault='/Users/cryptoclock/Desktop/BitPOS-Devnet-Private';
const amount=60000000n,mint=new PublicKey('4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7');
const purpose=process.env.BITPOS_RECYCLE_PURPOSE||'clean-device';assert.ok(['clean-device','latency-proof'].includes(purpose),'Only two bounded validation purposes are authorized by this lever');
const statePath=path.join(vault,'transactions',purpose+'-validation-refund.json');
const evidencePath=purpose==='clean-device'?'.omp/work/evidence/clean-devnet-funds-recycled.json':'.omp/work/evidence/latency-devnet-funds-recycled.json';
const operation=purpose+'-validation-recycle';
const chain=new Connection('https://api.devnet.solana.com','confirmed');
function privateJson(file){assert.equal(fs.statSync(file).mode&0o077,0,'Private file permissions');return JSON.parse(fs.readFileSync(file,'utf8'));}
function save(state){fs.writeFileSync(statePath,JSON.stringify(state,null,2),{mode:0o600});fs.chmodSync(statePath,0o600);}
function journal(state,type){fs.appendFileSync(path.join(vault,'activity.jsonl'),JSON.stringify({at:new Date().toISOString(),cluster:'devnet',type,operation,signature:state.signature,amountMinor:amount.toString()})+'\n',{mode:0o600});}
async function main(){
 assert.equal(path.resolve(process.env.DEVNET_PRIVATE_DIR||''),vault);
 assert.equal(await chain.getGenesisHash(),'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
 const manifest=JSON.parse(fs.readFileSync(path.join(vault,'wallets.public.json'),'utf8'));
 const sourceRole=manifest.wallets.find(role=>role.id==='merchant-a-treasury'),recipientRole=manifest.wallets.find(role=>role.id==='customer-no-sol');
 assert.ok(sourceRole&&recipientRole);
 const source=Keypair.fromSecretKey(Uint8Array.from(privateJson(path.join(vault,'keys/merchant-a-treasury.json'))));
 assert.equal(source.publicKey.toBase58(),sourceRole.address);
 const recipient=new PublicKey(recipientRole.address),from=getAssociatedTokenAddressSync(mint,source.publicKey,false,TOKEN_2022_PROGRAM_ID),to=getAssociatedTokenAddressSync(mint,recipient,false,TOKEN_2022_PROGRAM_ID);
 const account=await getAccount(chain,from,'confirmed',TOKEN_2022_PROGRAM_ID),destination=await getAccount(chain,to,'confirmed',TOKEN_2022_PROGRAM_ID);
 assert.ok(account.owner.equals(source.publicKey)&&destination.owner.equals(recipient)&&account.mint.equals(mint)&&destination.mint.equals(mint)&&!account.isFrozen&&!destination.isFrozen);
 const policy=await getMint(chain,mint,'confirmed',TOKEN_2022_PROGRAM_ID),fees=getTransferFeeConfig(policy);
 assert.equal(policy.decimals,6);assert.ok(fees&&fees.olderTransferFee.transferFeeBasisPoints===0&&fees.newerTransferFee.transferFeeBasisPoints===0);
 const journalEntries=fs.readFileSync(path.join(vault,'activity.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 let state=fs.existsSync(statePath)?privateJson(statePath):undefined;
 const instruction=createTransferCheckedWithFeeInstruction(from,mint,to,source.publicKey,amount,6,0n,[],TOKEN_2022_PROGRAM_ID);
 if(!state){
  assert.ok(account.amount>=amount);assert.ok(await chain.getBalance(source.publicKey)>=10000);assert.equal(await chain.getBalance(recipient),0);
  const block=await chain.getLatestBlockhash('confirmed');const tx=new Transaction({feePayer:source.publicKey,recentBlockhash:block.blockhash}).add(instruction);tx.sign(source);
  assert.ok(tx.verifySignatures());assert.equal((await chain.simulateTransaction(tx)).value.err,null);
  const fee=(await chain.getFeeForMessage(tx.compileMessage(),'confirmed')).value;assert.ok(fee!==null&&fee<=10000);
  state={operation,amountMinor:amount.toString(),source:sourceRole.address,recipient:recipientRole.address,blockhash:block.blockhash,lastValidHeight:block.lastValidBlockHeight,signature:bs58.encode(tx.signature),signedBase64:tx.serialize().toString('base64'),journalEntriesInspected:journalEntries.length,feeLamports:fee};
  save(state);journal(state,'signed'); // Durable signature before any submission.
 }
 assert.equal(state.operation,operation);assert.equal(state.amountMinor,amount.toString());assert.equal(state.source,sourceRole.address);assert.equal(state.recipient,recipientRole.address);
 const signed=Transaction.from(Buffer.from(state.signedBase64,'base64')),expected=new Transaction({feePayer:source.publicKey,recentBlockhash:state.blockhash}).add(instruction);
 assert.ok(signed.serializeMessage().equals(expected.serializeMessage())&&signed.verifySignatures());assert.equal(bs58.encode(signed.signature),state.signature);
 let status=(await chain.getSignatureStatuses([state.signature],{searchTransactionHistory:true})).value[0];assert.ok(!status?.err,'Recorded transfer failed; do not repeat');
 if(!status&&!state.submitAttempted){
  assert.ok(await chain.getBlockHeight('confirmed')<=state.lastValidHeight,'Recorded transfer expired; do not create another');
  state.submitAttempted=true;save(state);journal(state,'submit_attempted');
  try{assert.equal(await chain.sendRawTransaction(signed.serialize(),{skipPreflight:false,maxRetries:0}),state.signature);}catch{/* Ambiguous result is reconciled below; never blind-resend. */}
 }
 const deadline=Date.now()+180000;
 while(Date.now()<deadline){status=(await chain.getSignatureStatuses([state.signature],{searchTransactionHistory:true})).value[0];assert.ok(!status?.err,'Transfer failed');if(status?.confirmationStatus==='finalized')break;await new Promise(resolve=>setTimeout(resolve,2000));}
 assert.equal(status?.confirmationStatus,'finalized','Ambiguous/expired transfer: retain journal, never create a replacement');
 if(!state.finalizedAt){state.finalizedAt=new Date().toISOString();save(state);journal(state,'finalized');}
 const transaction=await chain.getTransaction(state.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});assert.ok(transaction&&transaction.meta?.err===null);
 const delta=(entries,address)=>BigInt(entries.find(entry=>transaction.transaction.message.accountKeys[entry.accountIndex].equals(address)).uiTokenAmount.amount);
 assert.equal(delta(transaction.meta.preTokenBalances,from)-delta(transaction.meta.postTokenBalances,from),amount);
 assert.equal(delta(transaction.meta.postTokenBalances,to)-delta(transaction.meta.preTokenBalances,to),amount);assert.equal(await chain.getBalance(recipient),0);
 const proof={origin:'live_devnet_test_asset_recycling_not_payment_refund',purpose,signature:state.signature,finalizedAt:state.finalizedAt,amountMinor:amount.toString(),feeLamports:state.feeLamports,journalEntriesInspected:state.journalEntriesInspected,customerZeroSol:true,customerUsdgMinor:(await chain.getTokenAccountBalance(to,'finalized')).value.amount,sponsorReservationUnchanged:true};
 fs.writeFileSync(evidencePath,JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
}
main().catch(error=>{console.error(JSON.stringify({status:'failed',error:error.name,message:'Devnet recycle did not complete; inspect private persisted state before any further transfer'}));process.exitCode=1;});
