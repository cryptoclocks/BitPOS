import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Connection,Keypair,PublicKey,SystemProgram,Transaction} from '@solana/web3.js';
import {ExtensionType,TOKEN_2022_PROGRAM_ID,createAssociatedTokenAccountIdempotentInstruction,createBurnCheckedInstruction,createInitializeMetadataPointerInstruction,createInitializeMintInstruction,
 createInitializeNonTransferableMintInstruction,createInitializePermanentDelegateInstruction,createMintToInstruction,getAccount,getAssociatedTokenAddressSync,getMint,getMintLen,getNonTransferable,getPermanentDelegate,
 getTokenMetadata,tokenMetadataInitializeWithRentTransfer,TokenAccountNotFoundError} from '@solana/spl-token';

// "Regulars" badge chain access, Solana DEVNET only (docs/NFT_LOYALTY_PLAN_TH.md). A badge is a Token-2022 mint with
//  NonTransferable (cannot be sold or moved), PermanentDelegate (the shop can take it back after a refund or withdrawn consent),
//  and on-mint metadata. Supply per holder is 1. Nothing here is money, a payment proof or a transferable asset.
export const DEVNET_GENESIS='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export async function assertDevnet(connection:Connection){const hash=await connection.getGenesisHash();if(hash!==DEVNET_GENESIS)throw new Error('LOYALTY_NOT_DEVNET');}

/** Reads a role key from a private directory that is OUTSIDE the repository. The key never leaves this process. */
export function loadRoleKeypair(privateDir:string,role:string){
 const repo=fs.realpathSync(fileURLToPath(new URL('../../..',import.meta.url))),dir=fs.realpathSync(privateDir);
 if(dir===repo||dir.startsWith(repo+path.sep))throw new Error('LOYALTY_KEYS_INSIDE_REPO');
 if(!/^[a-z0-9-]{1,40}$/.test(role))throw new Error('LOYALTY_BAD_ROLE');
 return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(dir,'keys',role+'.json'),'utf8'))));
}
export interface LoyaltySigners{connection:Connection;/** pays fees and rent (sponsor): customers never need SOL */payer:Keypair;/** mint authority and permanent delegate */issuer:Keypair;}
const finalized=async(c:Connection,tx:Transaction,signers:Keypair[])=>{
 const latest=await c.getLatestBlockhash('confirmed');tx.recentBlockhash=latest.blockhash;tx.feePayer=signers[0].publicKey;tx.sign(...signers);
 const signature=await c.sendRawTransaction(tx.serialize(),{skipPreflight:false,maxRetries:3});
 const result=await c.confirmTransaction({signature,blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight},'finalized');
 if(result.value.err)throw new Error('LOYALTY_TX_FAILED');
 return signature;
};

/** Admin only. Creates one tier mint; returns its address and the creation signature. */
export async function createTierMint(s:LoyaltySigners,meta:{name:string;symbol:string;uri:string}){
 await assertDevnet(s.connection);
 if(meta.name.length>32||meta.symbol.length>10||meta.uri.length>200)throw new Error('LOYALTY_BAD_METADATA');
 const mint=Keypair.generate(),extensions=[ExtensionType.NonTransferable,ExtensionType.PermanentDelegate,ExtensionType.MetadataPointer];
 const space=getMintLen(extensions),lamports=await s.connection.getMinimumBalanceForRentExemption(space);
 const create=new Transaction().add(
  SystemProgram.createAccount({fromPubkey:s.payer.publicKey,newAccountPubkey:mint.publicKey,space,lamports,programId:TOKEN_2022_PROGRAM_ID}),
  createInitializeNonTransferableMintInstruction(mint.publicKey,TOKEN_2022_PROGRAM_ID),
  createInitializePermanentDelegateInstruction(mint.publicKey,s.issuer.publicKey,TOKEN_2022_PROGRAM_ID),
  createInitializeMetadataPointerInstruction(mint.publicKey,s.issuer.publicKey,mint.publicKey,TOKEN_2022_PROGRAM_ID),
  createInitializeMintInstruction(mint.publicKey,0,s.issuer.publicKey,null,TOKEN_2022_PROGRAM_ID));
 const signature=await finalized(s.connection,create,[s.payer,mint]);
 await tokenMetadataInitializeWithRentTransfer(s.connection,s.payer,mint.publicKey,s.issuer.publicKey,s.issuer,meta.name,meta.symbol,meta.uri,[],{commitment:'finalized'},TOKEN_2022_PROGRAM_ID);
 return {mint:mint.publicKey.toBase58(),signature};
}

const ata=(mint:PublicKey,owner:PublicKey)=>getAssociatedTokenAddressSync(mint,owner,true,TOKEN_2022_PROGRAM_ID);
/** How many badge units the wallet holds (0 when it has no token account yet). Reads the chain at the given commitment. */
export async function badgeBalance(c:Connection,mint:string,wallet:string,commitment:'confirmed'|'finalized'='finalized'){
 try{return (await getAccount(c,ata(new PublicKey(mint),new PublicKey(wallet)),commitment,TOKEN_2022_PROGRAM_ID)).amount;}
 catch(error){if(error instanceof TokenAccountNotFoundError||(error as Error).name==='TokenAccountNotFoundError')return 0n;throw error;}
}
/** Issues exactly one badge. If the wallet already holds it, nothing is sent (this is what makes retries safe). */
export async function issueBadge(s:LoyaltySigners,mint:string,wallet:string):Promise<{kind:'already'}|{kind:'issued';signature:string}>{
 await assertDevnet(s.connection);
 if(await badgeBalance(s.connection,mint,wallet)>=1n)return {kind:'already'};
 const m=new PublicKey(mint),owner=new PublicKey(wallet),account=ata(m,owner);
 const tx=new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(s.payer.publicKey,account,owner,m,TOKEN_2022_PROGRAM_ID),createMintToInstruction(m,account,s.issuer.publicKey,1n,[],TOKEN_2022_PROGRAM_ID));
 return {kind:'issued',signature:await finalized(s.connection,tx,[s.payer,s.issuer])};
}
/** Takes the badge back through the permanent delegate. No-op when the wallet no longer holds it. */
export async function revokeBadge(s:LoyaltySigners,mint:string,wallet:string):Promise<{kind:'already'}|{kind:'revoked';signature:string}>{
 await assertDevnet(s.connection);
 if(await badgeBalance(s.connection,mint,wallet)<1n)return {kind:'already'};
 const m=new PublicKey(mint),account=ata(m,new PublicKey(wallet));
 const tx=new Transaction().add(createBurnCheckedInstruction(account,m,s.issuer.publicKey,1n,0,[],TOKEN_2022_PROGRAM_ID));
 return {kind:'revoked',signature:await finalized(s.connection,tx,[s.payer,s.issuer])};
}
/** Public, read-only: what a verifier can see about a tier mint on the chain. */
export async function inspectTierMint(c:Connection,mint:string){
 const key=new PublicKey(mint),info=await getMint(c,key,'finalized',TOKEN_2022_PROGRAM_ID),meta=await getTokenMetadata(c,key,'finalized',TOKEN_2022_PROGRAM_ID);
 return {mint,decimals:info.decimals,supply:info.supply.toString(),mintAuthority:info.mintAuthority?.toBase58()??null,freezeAuthority:info.freezeAuthority?.toBase58()??null,
  nonTransferable:getNonTransferable(info)!==null,permanentDelegate:getPermanentDelegate(info)?.delegate.toBase58()??null,name:meta?.name??null,symbol:meta?.symbol??null,uri:meta?.uri??null};
}
