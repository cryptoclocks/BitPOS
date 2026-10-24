// Legacy wire encoding stays isolated; wallet signing is asset-neutral and sign-only.
import {createSolanaRpc} from '@solana/kit';
import {Connection,PublicKey,Keypair,Transaction} from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import fs from 'node:fs';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {config} from './config';
import {DEVNET_GENESIS,assertSettlement} from '../../../packages/domain/src/index';
import {USDG_ASSET,assertAssetDescriptor} from '../../../packages/domain/src/payment-assets';
import type {PaymentAsset} from '../../../packages/contracts/src/index';
import type {AttemptRow} from './types';
import type {FrozenPayment} from './payment-assets';
import {RequestError} from './authority';
import {tenant} from './db';
import {verifyX402Transfer,type X402Binding} from './x402-payment';
// Canonical finalized devnet inspection: assets-preflight.json, 2026-10-12.
// Wire ID16 is present but unnamed by the installed SDK; never treat it as absent.
export const USDG_MINT_EXTENSION_TYPES=[3,12,1,4,16,14,18,19] as const;
export const USDG_ISSUER_AUTHORITY='DFWDTsWsyGgFLbVARTS92wHDKK2hwTUNk71uPM3mf16S';
export const kitRpc=createSolanaRpc(config.SOLANA_RPC);
export const chain=new Connection(config.SOLANA_RPC,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(12_000)})});
let sponsorKey:Keypair|undefined;
export function loadSponsor(){sponsorKey??=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(config.DEVNET_PRIVATE_DIR+'/keys/fee-sponsor.json','utf8'))));return sponsorKey;}
export const ata=(owner:string,asset:PaymentAsset)=>spl.getAssociatedTokenAddressSync(new PublicKey(asset.mint),new PublicKey(owner),false,new PublicKey(asset.tokenProgram));
export async function assertCluster(){if(await kitRpc.getGenesisHash().send({abortSignal:AbortSignal.timeout(12_000)})!==DEVNET_GENESIS)throw new RequestError(503,'PAYMENT_UNAVAILABLE','Devnet genesis mismatch');}
// Shared CLI/runtime inspection seam: never accept merely a mint label or client program.
export function assertMintPolicy(asset:PaymentAsset,m:spl.Mint){
 assertAssetDescriptor(asset);
 if(m.decimals!==asset.decimals||!m.isInitialized)throw Error('Unsupported mint decimals or initialization');
 const extensions:readonly number[]=spl.getExtensionTypes(m.tlvData);
 if(asset.instructionPolicy==='spl_checked'){
  if(extensions.length||m.tlvData.length)throw Error('SPL payment mint must have no extensions');
 }else{
  if(extensions.length!==USDG_MINT_EXTENSION_TYPES.length||USDG_MINT_EXTENSION_TYPES.some(type=>!extensions.includes(type)))throw Error('Canonical USDG extension profile changed');
  const fee=spl.getTransferFeeConfig(m),hook=spl.getTransferHook(m),delegate=spl.getPermanentDelegate(m);
  if(!fee||fee.olderTransferFee.transferFeeBasisPoints!==0||fee.newerTransferFee.transferFeeBasisPoints!==0||fee.olderTransferFee.maximumFee!==0n||fee.newerTransferFee.maximumFee!==0n)throw Error('Token-2022 transfer fee is not zero');
  if(fee.transferFeeConfigAuthority?.toBase58()!==USDG_ISSUER_AUTHORITY||fee.withdrawWithheldAuthority?.toBase58()!==USDG_ISSUER_AUTHORITY||delegate?.delegate.toBase58()!==USDG_ISSUER_AUTHORITY)throw Error('Canonical USDG issuer authority changed');
  if(!hook||hook.programId.toBase58()!=='11111111111111111111111111111111'||hook.authority.toBase58()!==USDG_ISSUER_AUTHORITY)throw Error('USDG transfer hook must remain disabled');
  const pointer=spl.getExtensionData(spl.ExtensionType.MetadataPointer,m.tlvData);
  if(!pointer||pointer.length!==64||new PublicKey(pointer.subarray(32)).toBase58()!==asset.mint||new PublicKey(pointer.subarray(0,32)).toBase58()!==USDG_ISSUER_AUTHORITY)throw Error('Canonical USDG metadata pointer changed');
 }
}
export async function mintPolicy(asset:PaymentAsset=USDG_ASSET){
 try{assertAssetDescriptor(asset);const m=await spl.getMint(chain,new PublicKey(asset.mint),'confirmed',new PublicKey(asset.tokenProgram));assertMintPolicy(asset,m);return m;}
 catch{throw new RequestError(503,'PAYMENT_UNAVAILABLE','Mint owner, decimals or extension policy changed; payment paused');}
}
type FrozenAttempt=AttemptRow&{payment:FrozenPayment};
function assertFrozen(attempt:FrozenAttempt){
 const {asset,settlement,payer,recipient,reference}=attempt.payment;assertAssetDescriptor(asset);
 if(asset.mint!==attempt.mint||asset.tokenProgram!==attempt.token_program||settlement.amountMinor!==attempt.amount_minor||settlement.mint!==asset.mint||settlement.tokenProgram!==asset.tokenProgram||settlement.currency!==asset.symbol||settlement.genesisHash!==asset.genesisHash||settlement.decimals!==asset.decimals||recipient!==attempt.recipient||settlement.recipient!==recipient||payer!==attempt.payer||reference!==attempt.reference)throw Error('Frozen attempt mismatch');
}
export function paymentInstructions(attempt:FrozenAttempt,sponsor:PublicKey,createRecipient:boolean){
 assertFrozen(attempt);const asset=attempt.payment.asset,mint=new PublicKey(asset.mint),program=new PublicKey(asset.tokenProgram);
 const sender=new PublicKey(attempt.payer),recipient=new PublicKey(attempt.recipient);
 const source=ata(attempt.payer,asset),destination=ata(attempt.recipient,asset);
 const transfer=asset.instructionPolicy==='token2022_zero_fee'
  ?spl.createTransferCheckedWithFeeInstruction(source,mint,destination,sender,BigInt(attempt.amount_minor),asset.decimals,0n,[],program)
  :spl.createTransferCheckedInstruction(source,mint,destination,sender,BigInt(attempt.amount_minor),asset.decimals,[],program);
 transfer.keys.push({pubkey:new PublicKey(attempt.reference),isSigner:false,isWritable:false});
 return createRecipient?[spl.createAssociatedTokenAccountIdempotentInstruction(sponsor,destination,recipient,mint,program),transfer]:[transfer];
}
// Reconstruct the entire allowlist, not a search for one acceptable transfer among extras.
export function assertPaymentMessage(tx:Transaction,attempt:FrozenAttempt){
 if(!tx.feePayer||tx.instructions.length<1||tx.instructions.length>2)throw Error('Unexpected payment instructions');
 const payer=new PublicKey(attempt.payer),recipient=new PublicKey(attempt.recipient);
 if(payer.equals(recipient)||payer.equals(tx.feePayer)||recipient.equals(tx.feePayer))throw Error('Invalid payment participant');
 const expected=paymentInstructions(attempt,tx.feePayer,tx.instructions.length===2);
 const canonical=new Transaction({feePayer:tx.feePayer,recentBlockhash:tx.recentBlockhash}).add(...expected);
 if(!canonical.serializeMessage().equals(tx.serializeMessage()))throw Error('Noncanonical payment message');
 const reference=new PublicKey(attempt.reference);const message=tx.compileMessage();
 const ix=message.accountKeys.findIndex(k=>k.equals(reference));
 if(ix<0||message.isAccountSigner(ix)||message.isAccountWritable(ix))throw Error('Wrong payment reference');
 if(message.header.numRequiredSignatures!==2||!message.accountKeys[1]?.equals(payer))throw Error('Unexpected payment signers');
}
export interface BuiltPayment {base64:string;blockhash:string;lastValidHeight:number;fee:number;}
export async function build(attempt:FrozenAttempt){
 assertFrozen(attempt);if(Date.parse(attempt.payment.expiresAt)<=Date.now())throw new RequestError(409,'QUOTE_EXPIRED');
 const asset=attempt.payment.asset;
 const registry=await tenant(attempt.merchant_id,async db=>(await db.query('SELECT descriptor,enabled,verified_at FROM payment_assets WHERE asset_id=$1',[asset.assetId])).rows[0]);
 if(!registry?.enabled||!registry.verified_at||JSON.stringify(Object.entries(registry.descriptor).sort())!==JSON.stringify(Object.entries(asset).sort()))throw new RequestError(503,'PAYMENT_UNAVAILABLE','Frozen asset differs from server registry');
 await Promise.all([assertCluster(),mintPolicy(asset)]);
 const sponsor=loadSponsor(),program=new PublicKey(asset.tokenProgram),mint=new PublicKey(asset.mint);
 const source=ata(attempt.payer,asset),destination=ata(attempt.recipient,asset);
 let account:spl.Account;
 try{account=await spl.getAccount(chain,source,'confirmed',program);}
 catch(error){if(error instanceof spl.TokenAccountNotFoundError)throw new RequestError(409,'INSUFFICIENT_BALANCE','Selected token account does not exist');throw error;}
 if(!account.owner.equals(new PublicKey(attempt.payer))||!account.mint.equals(mint)||account.isFrozen||account.amount<BigInt(attempt.amount_minor))throw new RequestError(409,'INSUFFICIENT_BALANCE','Insufficient or frozen selected token balance');
 const exists=await chain.getAccountInfo(destination,'confirmed');
 if(exists){const to=await spl.getAccount(chain,destination,'confirmed',program);if(to.isFrozen||!to.owner.equals(new PublicKey(attempt.recipient))||!to.mint.equals(mint))throw new RequestError(503,'PAYMENT_UNAVAILABLE','Invalid recipient token account');}
 const tx=new Transaction().add(...paymentInstructions(attempt,sponsor.publicKey,!exists));
 const block=await chain.getLatestBlockhash('confirmed');tx.feePayer=sponsor.publicKey;tx.recentBlockhash=block.blockhash;assertPaymentMessage(tx,attempt);tx.partialSign(sponsor);
 const simulation=await chain.simulateTransaction(tx);if(simulation.value.err)throw Error('Payment simulation failed');
 const fee=(await chain.getFeeForMessage(tx.compileMessage(),'confirmed')).value;if(fee===null||fee>1000000)throw Error('Sponsor fee exceeds policy');
 const rent=!exists?await chain.getMinimumBalanceForRentExemption(spl.ACCOUNT_SIZE):0;
 if(fee+rent>1000000)throw Error('Recipient account setup exceeds per-order sponsor budget; pre-create account');
 return {base64:tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64'),blockhash:block.blockhash,lastValidHeight:block.lastValidBlockHeight,fee};
}
export function validateSigned(base64:string,expectedBase64:string,payer:string){
 if(base64.length>8192)throw new RequestError(422,'INVALID_TRANSACTION','Transaction too large');
 let signed:Transaction;try{signed=Transaction.from(Buffer.from(base64,'base64'));}catch{throw new RequestError(422,'INVALID_TRANSACTION','Invalid transaction encoding');}
 const expected=Transaction.from(Buffer.from(expectedBase64,'base64'));
 if(!signed.serializeMessage().equals(expected.serializeMessage()))throw Error('Transaction message was changed');
 if(!signed.verifySignatures())throw Error('Invalid transaction signatures');
 const owner=new PublicKey(payer),sig=signed.signatures.find(s=>s.publicKey.equals(owner))?.signature;
 if(!sig||!nacl.sign.detached.verify(signed.serializeMessage(),sig,owner.toBytes()))throw Error('Missing customer signature');
 const first=signed.signatures[0]?.signature,sponsored=expected.signatures[0]?.signature;
 if(!first)throw Error('Missing fee payer signature');
 if(!sponsored||!first.equals(sponsored))throw new RequestError(422,'INVALID_TRANSACTION','Sponsored signature was changed');
 return {bytes:signed.serialize(),signature:bs58.encode(first)};
}
export class PaymentProofError extends Error {}
export async function verifyTransfer(signature:string,attempt:FrozenAttempt&{x402?:X402Binding},commitment:'confirmed'|'finalized'){
 if(attempt.x402)return verifyX402Transfer(signature,{...attempt,x402:attempt.x402},commitment);
 const tx=await chain.getTransaction(signature,{commitment,maxSupportedTransactionVersion:0});if(!tx)return null;
 try{
  assertFrozen(attempt);const asset=attempt.payment.asset;
  if(!tx.meta||tx.meta.err||attempt.signature!==signature||!attempt.signed_base64||!attempt.transaction_base64)throw Error('Unrecognized payment');
  const signed=validateSigned(attempt.signed_base64,attempt.transaction_base64,attempt.payer);if(signed.signature!==signature)throw Error('Wrong signature');
  const frozen=Transaction.from(signed.bytes);assertPaymentMessage(frozen,attempt);
  if(!Buffer.from(tx.transaction.message.serialize()).equals(frozen.serializeMessage()))throw Error('Chain message differs from frozen payment');
  const msg=tx.transaction.message,keys=msg.getAccountKeys(),required=msg.header.numRequiredSignatures;
  if(tx.transaction.signatures.length!==required)throw Error('Missing signatures');
  for(let i=0;i<required;i++)if(!nacl.sign.detached.verify(frozen.serializeMessage(),bs58.decode(tx.transaction.signatures[i]),keys.get(i)!.toBytes()))throw Error('Invalid chain signature');
  const dest=ata(attempt.recipient,asset).toBase58();let destinationIndex=-1;
  for(let i=0;i<keys.length;i++)if(keys.get(i)!.toBase58()===dest)destinationIndex=i;
  const pre=tx.meta.preTokenBalances?.find(b=>b.accountIndex===destinationIndex);
  const post=tx.meta.postTokenBalances?.find(b=>b.accountIndex===destinationIndex);
  if(!post||post.owner!==attempt.recipient||post.programId!==asset.tokenProgram||post.mint!==asset.mint||post.uiTokenAmount.decimals!==asset.decimals||pre&&(pre.mint!==asset.mint||pre.owner!==attempt.recipient||pre.programId!==asset.tokenProgram||pre.uiTokenAmount.decimals!==asset.decimals))throw Error('Wrong token destination');
  const actual=BigInt(post.uiTokenAmount.amount)-BigInt(pre?.uiTokenAmount.amount??'0');
  assertSettlement({error:tx.meta.err,mint:post.mint,program:post.programId!,recipient:post.owner!,rawAmount:actual,reference:attempt.reference,payer:attempt.payer},{mint:asset.mint,program:asset.tokenProgram,recipient:attempt.recipient,rawAmount:BigInt(attempt.amount_minor),reference:attempt.reference,payer:attempt.payer});
  return {fee:tx.meta.fee,slot:tx.slot};
 }catch{throw new PaymentProofError('Payment proof rejected');}
}
