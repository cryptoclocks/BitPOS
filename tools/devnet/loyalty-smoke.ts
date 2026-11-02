// Real Solana DEVNET run of the "Regulars" badge lifecycle. Keys are read from the private directory outside this repository
// (BITPOS_DEVNET_KEY_DIR, default ~/Desktop/BitPOS-Devnet-Private); only public addresses and signatures are printed.
//   create a throwaway tier mint -> issue to a test customer wallet -> verify -> prove it cannot be transferred -> issue again (no-op) -> revoke -> verify gone
import os from 'node:os';
import path from 'node:path';
import {Connection,Keypair,PublicKey,Transaction} from '@solana/web3.js';
import {TOKEN_2022_PROGRAM_ID,createAssociatedTokenAccountIdempotentInstruction,createTransferCheckedInstruction,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {assertDevnet,badgeBalance,createTierMint,inspectTierMint,issueBadge,loadRoleKeypair,revokeBadge} from '../../apps/api/src/loyalty-chain';
const dir=process.env.BITPOS_DEVNET_KEY_DIR??path.join(os.homedir(),'Desktop','BitPOS-Devnet-Private');
const connection=new Connection('https://api.devnet.solana.com','confirmed');
const issuer=loadRoleKeypair(dir,'reward-issuer'),payer=loadRoleKeypair(dir,'fee-sponsor'),alice=loadRoleKeypair(dir,'customer-alice'),bob=loadRoleKeypair(dir,'customer-bob');
const signers={connection,payer,issuer};
const out:Record<string,unknown>={cluster:'devnet',issuer:issuer.publicKey.toBase58(),payer:payer.publicKey.toBase58(),holder:alice.publicKey.toBase58()};
await assertDevnet(connection);
const {mint,signature}=await createTierMint(signers,{name:'BitPOS Regulars - Smoke',symbol:'REG',uri:'https://pay.cashlessthailand.com/loyalty/badge-1.json'});
out.mint=mint;out.createSignature=signature;out.inspect=await inspectTierMint(connection,mint);
const first=await issueBadge(signers,mint,alice.publicKey.toBase58());out.issue=first;
out.balanceAfterIssue=(await badgeBalance(connection,mint,alice.publicKey.toBase58())).toString();
const again=await issueBadge(signers,mint,alice.publicKey.toBase58());out.issueAgain=again;
// The holder tries to give the badge to someone else: the chain must refuse.
let transferRefused=false;
try{
 const m=new PublicKey(mint),from=getAssociatedTokenAddressSync(m,alice.publicKey,true,TOKEN_2022_PROGRAM_ID),to=getAssociatedTokenAddressSync(m,bob.publicKey,true,TOKEN_2022_PROGRAM_ID);
 const tx=new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(payer.publicKey,to,bob.publicKey,m,TOKEN_2022_PROGRAM_ID),createTransferCheckedInstruction(from,m,to,alice.publicKey,1n,0,[],TOKEN_2022_PROGRAM_ID));
 const latest=await connection.getLatestBlockhash();tx.recentBlockhash=latest.blockhash;tx.feePayer=payer.publicKey;tx.sign(payer,alice);
 await connection.simulateTransaction(tx).then(r=>{if(r.value.err===null)throw new Error('TRANSFER_UNEXPECTEDLY_ALLOWED');transferRefused=true;out.transferRefusal={err:r.value.err,log:(r.value.logs??[]).filter(l=>/transfer|non/i.test(l)).slice(-3)};});
}catch(e){if((e as Error).message==='TRANSFER_UNEXPECTEDLY_ALLOWED')throw e;transferRefused=true;}
out.transferRefused=transferRefused;
const revoked=await revokeBadge(signers,mint,alice.publicKey.toBase58());out.revoke=revoked;
out.balanceAfterRevoke=(await badgeBalance(connection,mint,alice.publicKey.toBase58())).toString();
out.revokeAgain=await revokeBadge(signers,mint,alice.publicKey.toBase58());
console.log(JSON.stringify(out,null,1));
