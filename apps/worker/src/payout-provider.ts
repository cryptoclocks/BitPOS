import {createHash} from 'node:crypto';
import {PublicKey,Transaction,TransactionInstruction,VersionedTransaction,type Connection,type Signer,type TokenBalance} from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {z} from 'zod';
import type {PaymentAsset} from '../../../packages/contracts/src/index';
import {DEVNET_GENESIS} from '../../../packages/domain/src/index';
import {assertAssetDescriptor,MAX_PAYMENT_RAW} from '../../../packages/domain/src/payment-assets';

/** No environment/config import, file access, RPC construction or IO at module load. */
export type PayoutTransport=Pick<Connection,'getGenesisHash'|'getAccountInfo'|'getLatestBlockhashAndContext'|'getFeeForMessage'|'getMinimumBalanceForRentExemption'|'getBalance'|'simulateTransaction'|'sendRawTransaction'|'getTransaction'|'getSignatureStatuses'|'getBlockHeight'|'isBlockhashValid'>;
export interface PayoutProviderDeps {
 connection:PayoutTransport;
 /** Server-owned, verified registry; never a client-supplied descriptor resolver. */
 resolveAsset:(assetId:string)=>Promise<Readonly<PaymentAsset>|null>;
 /** Runtime owner alone supplies/loads keys. This module never reads a key file. */
 loadSigningKeys:()=>Promise<{source:Signer;feePayer:Signer}>;
}
export type PayoutProviderConfig={kind:'unavailable'}|{
 kind:'solana-devnet';sourceOwner:string;feePayerOwner:string;allowedAssetIds:readonly string[];
 /** Atomic token units, not fiat cents; no implicit conversion or rounding. */
 maxAmountMinor:string;maxFeeLamports:number;maxTotalLamports:number;
};
export interface PreparePayoutInput {attemptId:string;batchId:string;beneficiaryOwner:string;amountMinor:string;asset:Readonly<PaymentAsset>;}
export interface PayoutIntent {
 version:1;attemptId:string;batchId:string;amountMinor:string;asset:Readonly<PaymentAsset>;genesisHash:string;
 recipientOwner:string;recipientTokenAccount:string;sourceOwner:string;sourceTokenAccount:string;feePayerOwner:string;
 blockhash:string;lastValidBlockHeight:number;preparedAtSlot:number;createRecipientAccount:boolean;feeLamports:number;rentLamports:number;
}
/** Persist this ENTIRE object atomically against the exclusive durable attempt BEFORE broadcast. */
export interface PreparedPayout extends PayoutIntent {
 signedBase64:string;signature:string;signedBytesSha256:string;intentDigest:string;memo:string;reference:string;
}
interface DecodedPayout {prepared:Readonly<PreparedPayout>;bytes:Buffer;signed:Transaction;}
export interface PayoutReceiptEvidence {
 version:1;provider:'solana-devnet';commitment:'confirmed'|'finalized';genesisHash:string;signature:string;
 slot:number;blockTime:number|null;feeLamports:number;intentDigest:string;signedBytesSha256:string;
 attemptId:string;batchId:string;amountMinor:string;asset:Readonly<PaymentAsset>;
 sourceOwner:string;sourceTokenAccount:string;recipientOwner:string;recipientTokenAccount:string;memo:string;reference:string;
 sourcePreMinor:string;sourcePostMinor:string;recipientPreMinor:string;recipientPostMinor:string;
}
export interface PayoutReceipt {digest:string;evidence:PayoutReceiptEvidence;}
export type BroadcastPayoutResult=
 |{status:'SUBMITTED';signature:string}
 |{status:'UNKNOWN';signature:string;reason:'SUBMISSION_AMBIGUOUS'}
 |{status:'NOT_BROADCAST';signature:string;reason:'PROVIDER_UNAVAILABLE'|'BLOCKHASH_EXPIRED'|'INVALID_PREPARED'};
export type ReconcilePayoutResult=
 |{status:'FINALIZED';receipt:PayoutReceipt}
 |{status:'CONFIRMED';receipt:PayoutReceipt}
 |{status:'FAILED';signature:string;evidence:{kind:'FINALIZED_CHAIN_FAILURE';genesisHash:string;slot:number;intentDigest:string;signedBytesSha256:string;transactionError:unknown};digest:string}
 |{status:'UNKNOWN';signature:string;reason:'PROVIDER_UNAVAILABLE'|'INVALID_PREPARED'|'HISTORY_UNAVAILABLE'|'PROOF_REJECTED'|'NOT_FINALIZED'|'EXPIRED_WITHOUT_COMPLETE_HISTORY';expiry?:{finalizedBlockHeight:number;lastValidBlockHeight:number;blockhashValid:boolean;historySearchRequested:true;absenceIsConclusive:false}};
export interface ReadyPayoutProvider {
 kind:'ready';prepare:(input:PreparePayoutInput)=>Promise<Readonly<PreparedPayout>>;
 broadcast:(prepared:PreparedPayout)=>Promise<BroadcastPayoutResult>;
 reconcile:(prepared:PreparedPayout)=>Promise<ReconcilePayoutResult>;
}
export type PayoutProvider={kind:'unavailable';reason:'NOT_CONFIGURED'}|ReadyPayoutProvider;
export class PayoutProviderError extends Error {
 constructor(public readonly code:'CONFIG_ERROR'|'INVALID_REQUEST'|'ASSET_POLICY'|'INSUFFICIENT_LIQUIDITY'|'FEE_POLICY'|'PROVIDER_UNAVAILABLE'|'SIMULATION_FAILED'){
  super(code);this.name='PayoutProviderError';
 }
}

const MEMO_PROGRAM=new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const USDG_EXTENSION_TYPES=[3,12,1,4,16,14,18,19] as const;
const USDG_ISSUER='DFWDTsWsyGgFLbVARTS92wHDKK2hwTUNk71uPM3mf16S';
const amountSchema=z.string().regex(/^(0|[1-9][0-9]{0,17})$/);
const idSchema=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const keySchema=z.string().refine(value=>{try{return new PublicKey(value).toBase58()===value;}catch{return false;}});
const ownerSchema=keySchema.refine(value=>{try{return PublicKey.isOnCurve(new PublicKey(value).toBytes());}catch{return false;}});
const assetSchema=z.object({assetId:idSchema,symbol:z.enum(['USDG','USDC','USDT']),displayLabel:z.string().min(1).max(96),cluster:z.literal('devnet'),genesisHash:z.literal(DEVNET_GENESIS),mint:keySchema,tokenProgram:keySchema,decimals:z.literal(6),instructionPolicy:z.enum(['token2022_zero_fee','spl_checked']),issuerTestAsset:z.boolean()}).strict();
const activeConfigSchema=z.object({kind:z.literal('solana-devnet'),sourceOwner:ownerSchema,feePayerOwner:ownerSchema,allowedAssetIds:z.array(idSchema).min(1).max(16),maxAmountMinor:amountSchema,maxFeeLamports:z.number().int().min(1).max(1_000_000),maxTotalLamports:z.number().int().min(1).max(10_000_000)}).strict();
const inputSchema=z.object({attemptId:idSchema,batchId:idSchema,beneficiaryOwner:ownerSchema,amountMinor:amountSchema,asset:assetSchema}).strict();
const intentSchema=z.object({version:z.literal(1),attemptId:idSchema,batchId:idSchema,amountMinor:amountSchema,asset:assetSchema,genesisHash:z.literal(DEVNET_GENESIS),recipientOwner:ownerSchema,recipientTokenAccount:keySchema,sourceOwner:ownerSchema,sourceTokenAccount:keySchema,feePayerOwner:ownerSchema,blockhash:keySchema,lastValidBlockHeight:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),preparedAtSlot:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),createRecipientAccount:z.boolean(),feeLamports:z.number().int().nonnegative().max(1_000_000),rentLamports:z.number().int().nonnegative().max(10_000_000)}).strict();
const preparedSchema=intentSchema.extend({signedBase64:z.string().min(1).max(1644),signature:z.string().min(64).max(88),signedBytesSha256:z.string().regex(/^[a-f0-9]{64}$/),intentDigest:z.string().regex(/^[a-f0-9]{64}$/),memo:z.string().max(128),reference:keySchema}).strict();
// Shared structural boundaries; cryptographic verification remains in the provider.
export const payoutAssetSchema=assetSchema;
export const payoutPreparedSchema=preparedSchema;
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
/** Fixed-position JSON tuples are a wire format, not object insertion-order serialization. */
function assetTuple(asset:Readonly<PaymentAsset>){
 return [asset.assetId,asset.symbol,asset.displayLabel,asset.cluster,asset.genesisHash,asset.mint,asset.tokenProgram,asset.decimals,asset.instructionPolicy,asset.issuerTestAsset];
}
function intentDigest(intent:PayoutIntent){
 return sha(JSON.stringify(['BitPOS/SolanaDevnet/PayoutIntent/v1',intent.version,intent.attemptId,intent.batchId,intent.amountMinor,assetTuple(intent.asset),intent.genesisHash,intent.recipientOwner,intent.recipientTokenAccount,intent.sourceOwner,intent.sourceTokenAccount,intent.feePayerOwner,intent.blockhash,intent.lastValidBlockHeight,intent.preparedAtSlot,intent.createRecipientAccount,intent.feeLamports,intent.rentLamports]));
}
function attribution(digest:string){
 return {intentDigest:digest,memo:'bitpos:payout:v1:'+digest,reference:new PublicKey(Buffer.from(sha('BitPOS/SolanaDevnet/PayoutReference/v1\0'+digest),'hex')).toBase58()};
}
function ata(owner:string,asset:Readonly<PaymentAsset>){return spl.getAssociatedTokenAddressSync(new PublicKey(asset.mint),new PublicKey(owner),false,new PublicKey(asset.tokenProgram)).toBase58();}
function canonicalAsset(value:unknown):Readonly<PaymentAsset>{
 const asset=assetSchema.parse(value);assertAssetDescriptor(asset);return Object.freeze(asset);
}
/** Same deny-by-default policy as api/payments.ts, deliberately no API/config import. */
function assertMintPolicy(asset:Readonly<PaymentAsset>,mint:spl.Mint){
 if(!mint.isInitialized||mint.decimals!==asset.decimals)throw new PayoutProviderError('ASSET_POLICY');
 const extensions:readonly number[]=spl.getExtensionTypes(mint.tlvData);
 if(asset.instructionPolicy==='spl_checked'){
  if(extensions.length||mint.tlvData.length)throw new PayoutProviderError('ASSET_POLICY');
  return;
 }
 if(extensions.length!==USDG_EXTENSION_TYPES.length||USDG_EXTENSION_TYPES.some(type=>!extensions.includes(type)))throw new PayoutProviderError('ASSET_POLICY');
 const fee=spl.getTransferFeeConfig(mint),hook=spl.getTransferHook(mint),delegate=spl.getPermanentDelegate(mint);
 if(!fee||fee.olderTransferFee.transferFeeBasisPoints!==0||fee.newerTransferFee.transferFeeBasisPoints!==0||fee.olderTransferFee.maximumFee!==0n||fee.newerTransferFee.maximumFee!==0n)throw new PayoutProviderError('ASSET_POLICY');
 if(fee.transferFeeConfigAuthority?.toBase58()!==USDG_ISSUER||fee.withdrawWithheldAuthority?.toBase58()!==USDG_ISSUER||delegate?.delegate.toBase58()!==USDG_ISSUER)throw new PayoutProviderError('ASSET_POLICY');
 if(!hook||hook.programId.toBase58()!=='11111111111111111111111111111111'||hook.authority.toBase58()!==USDG_ISSUER)throw new PayoutProviderError('ASSET_POLICY');
 const pointer=spl.getExtensionData(spl.ExtensionType.MetadataPointer,mint.tlvData);
 if(!pointer||pointer.length!==64||new PublicKey(pointer.subarray(32)).toBase58()!==asset.mint||new PublicKey(pointer.subarray(0,32)).toBase58()!==USDG_ISSUER)throw new PayoutProviderError('ASSET_POLICY');
}
function instructions(intent:PayoutIntent,memo:string,reference:string){
 const mint=new PublicKey(intent.asset.mint),program=new PublicKey(intent.asset.tokenProgram),source=new PublicKey(intent.sourceTokenAccount),destination=new PublicKey(intent.recipientTokenAccount),owner=new PublicKey(intent.sourceOwner);
 const transfer=intent.asset.instructionPolicy==='token2022_zero_fee'
  ?spl.createTransferCheckedWithFeeInstruction(source,mint,destination,owner,BigInt(intent.amountMinor),intent.asset.decimals,0n,[],program)
  :spl.createTransferCheckedInstruction(source,mint,destination,owner,BigInt(intent.amountMinor),intent.asset.decimals,[],program);
 transfer.keys.push({pubkey:new PublicKey(reference),isSigner:false,isWritable:false});
 return [
  ...(intent.createRecipientAccount?[spl.createAssociatedTokenAccountIdempotentInstruction(new PublicKey(intent.feePayerOwner),destination,new PublicKey(intent.recipientOwner),mint,program)]:[]),
  transfer,
  new TransactionInstruction({programId:MEMO_PROGRAM,keys:[{pubkey:owner,isSigner:true,isWritable:false}],data:Buffer.from(memo,'utf8')}),
 ];
}
function transaction(intent:PayoutIntent,memo:string,reference:string){
 return new Transaction({feePayer:new PublicKey(intent.feePayerOwner),recentBlockhash:intent.blockhash}).add(...instructions(intent,memo,reference));
}
function safeLamports(value:number){if(!Number.isSafeInteger(value)||value<0)throw new PayoutProviderError('FEE_POLICY');return value;}
function tokenAccountValid(account:spl.Account,owner:string,asset:Readonly<PaymentAsset>){
 if(!account.isInitialized||account.isFrozen||account.owner.toBase58()!==owner||account.mint.toBase58()!==asset.mint)throw new PayoutProviderError('ASSET_POLICY');
}

/**
 * Pure factory: no network or key loading until an operation is called.
 * Caller owns tenant authorization, exclusive payable/funding reservations, and the attempt state machine.
 * Never call prepare again for an attempt that already has signed bytes; resume only those durable bytes.
 * A token balance check is not custody, a chain-funds reservation, or proof of externally available funding.
 */

export function validatePreparedPayout(value:PreparedPayout,policy:{allowedAssetIds:readonly string[];sourceOwner:string;feePayerOwner:string;maxAmountMinor:string;maxFeeLamports:number;maxTotalLamports:number}):DecodedPayout{
 if(!Number.isSafeInteger(policy.maxFeeLamports)||policy.maxFeeLamports<=0||!Number.isSafeInteger(policy.maxTotalLamports)||policy.maxTotalLamports<policy.maxFeeLamports)throw new PayoutProviderError('CONFIG_ERROR');
 function assertPolicy(intent:PayoutIntent){
  assertAssetDescriptor(intent.asset);
  if(intent.genesisHash!==intent.asset.genesisHash||!policy.allowedAssetIds.includes(intent.asset.assetId)||intent.sourceOwner!==policy.sourceOwner||intent.feePayerOwner!==policy.feePayerOwner||intent.recipientOwner===intent.sourceOwner||intent.recipientOwner===intent.feePayerOwner||intent.sourceTokenAccount!==ata(intent.sourceOwner,intent.asset)||intent.recipientTokenAccount!==ata(intent.recipientOwner,intent.asset))throw new PayoutProviderError('INVALID_REQUEST');
  const amount=BigInt(intent.amountMinor);
  // Zero is a valid integer but not a payable transfer. The accounting layer must close zero obligations without sending.
  if(amount<=0n||amount>MAX_PAYMENT_RAW||amount>BigInt(policy.maxAmountMinor))throw new PayoutProviderError('INVALID_REQUEST');
  if(intent.feeLamports>policy.maxFeeLamports||intent.feeLamports+intent.rentLamports>policy.maxTotalLamports||(!intent.createRecipientAccount&&intent.rentLamports!==0))throw new PayoutProviderError('FEE_POLICY');
 }
 function readPrepared(value:PreparedPayout):DecodedPayout{
  const prepared=preparedSchema.parse(value);Object.freeze(prepared.asset);Object.freeze(prepared);assertPolicy(prepared);
  const expected=attribution(intentDigest(prepared));
  if(prepared.intentDigest!==expected.intentDigest||prepared.memo!==expected.memo||prepared.reference!==expected.reference)throw new PayoutProviderError('INVALID_REQUEST');
  const bytes=Buffer.from(prepared.signedBase64,'base64');
  if(bytes.length>1232||bytes.toString('base64')!==prepared.signedBase64||sha(bytes)!==prepared.signedBytesSha256)throw new PayoutProviderError('INVALID_REQUEST');
  const signed=Transaction.from(bytes),canonical=transaction(prepared,prepared.memo,prepared.reference);
  if(!signed.serializeMessage().equals(canonical.serializeMessage())||!signed.verifySignatures()||!signed.serialize().equals(bytes)||!signed.signature||bs58.encode(signed.signature)!==prepared.signature)throw new PayoutProviderError('INVALID_REQUEST');
  const message=signed.compileMessage(),referenceIndex=message.accountKeys.findIndex(key=>key.toBase58()===prepared.reference);
  if(referenceIndex<0||message.isAccountSigner(referenceIndex)||message.isAccountWritable(referenceIndex))throw new PayoutProviderError('INVALID_REQUEST');
  return {prepared,bytes,signed};
 }
 return readPrepared(value);
}
export function createPayoutProvider(config:unknown=undefined,deps?:PayoutProviderDeps):PayoutProvider {
 if(config===undefined||config===null)return {kind:'unavailable',reason:'NOT_CONFIGURED'};
 const disabled=z.object({kind:z.literal('unavailable')}).strict().safeParse(config);
 if(disabled.success)return {kind:'unavailable',reason:'NOT_CONFIGURED'};
 const parsed=activeConfigSchema.safeParse(config);
 if(!parsed.success||!deps)throw new PayoutProviderError('CONFIG_ERROR');
 const policy=Object.freeze({...parsed.data,allowedAssetIds:Object.freeze([...parsed.data.allowedAssetIds])});
 if(BigInt(policy.maxAmountMinor)===0n||BigInt(policy.maxAmountMinor)>MAX_PAYMENT_RAW||policy.maxTotalLamports<policy.maxFeeLamports||new Set(policy.allowedAssetIds).size!==policy.allowedAssetIds.length)throw new PayoutProviderError('CONFIG_ERROR');
 if(!deps.connection||typeof deps.resolveAsset!=='function'||typeof deps.loadSigningKeys!=='function')throw new PayoutProviderError('CONFIG_ERROR');
 const connection=deps.connection,resolveAsset=deps.resolveAsset,loadSigningKeys=deps.loadSigningKeys;
 async function assertGenesis(){if(await connection.getGenesisHash()!==DEVNET_GENESIS)throw new PayoutProviderError('PROVIDER_UNAVAILABLE');}
 function assertPolicy(intent:PayoutIntent){
  assertAssetDescriptor(intent.asset);
  if(intent.genesisHash!==intent.asset.genesisHash||!policy.allowedAssetIds.includes(intent.asset.assetId)||intent.sourceOwner!==policy.sourceOwner||intent.feePayerOwner!==policy.feePayerOwner||intent.recipientOwner===intent.sourceOwner||intent.recipientOwner===intent.feePayerOwner||intent.sourceTokenAccount!==ata(intent.sourceOwner,intent.asset)||intent.recipientTokenAccount!==ata(intent.recipientOwner,intent.asset))throw new PayoutProviderError('INVALID_REQUEST');
  const amount=BigInt(intent.amountMinor);
  // Zero is a valid integer but not a payable transfer. The accounting layer must close zero obligations without sending.
  if(amount<=0n||amount>MAX_PAYMENT_RAW||amount>BigInt(policy.maxAmountMinor))throw new PayoutProviderError('INVALID_REQUEST');
  if(intent.feeLamports>policy.maxFeeLamports||intent.feeLamports+intent.rentLamports>policy.maxTotalLamports||(!intent.createRecipientAccount&&intent.rentLamports!==0))throw new PayoutProviderError('FEE_POLICY');
 }
 function readPrepared(value:PreparedPayout):DecodedPayout{return validatePreparedPayout(value,policy);}
 async function prepare(value:PreparePayoutInput):Promise<Readonly<PreparedPayout>>{
  let input:z.infer<typeof inputSchema>;
  try{input=inputSchema.parse(value);}catch{throw new PayoutProviderError('INVALID_REQUEST');}
  let asset:Readonly<PaymentAsset>;
  try{
   asset=canonicalAsset(input.asset);
   if(!policy.allowedAssetIds.includes(asset.assetId))throw Error();
   const registered=canonicalAsset(await resolveAsset(asset.assetId));
   if(JSON.stringify(assetTuple(asset))!==JSON.stringify(assetTuple(registered)))throw Error();
  }catch{throw new PayoutProviderError('ASSET_POLICY');}
  const initial:PayoutIntent={version:1,attemptId:input.attemptId,batchId:input.batchId,amountMinor:input.amountMinor,asset,genesisHash:asset.genesisHash,recipientOwner:input.beneficiaryOwner,recipientTokenAccount:ata(input.beneficiaryOwner,asset),sourceOwner:policy.sourceOwner,sourceTokenAccount:ata(policy.sourceOwner,asset),feePayerOwner:policy.feePayerOwner,blockhash:PublicKey.default.toBase58(),lastValidBlockHeight:0,preparedAtSlot:0,createRecipientAccount:false,feeLamports:0,rentLamports:0};
  assertPolicy(initial);
  try{
   await assertGenesis();
   const mintKey=new PublicKey(asset.mint),program=new PublicKey(asset.tokenProgram);
   const mint=spl.unpackMint(mintKey,await connection.getAccountInfo(mintKey,'confirmed'),program);assertMintPolicy(asset,mint);
   const source=spl.unpackAccount(new PublicKey(initial.sourceTokenAccount),await connection.getAccountInfo(new PublicKey(initial.sourceTokenAccount),'confirmed'),program);tokenAccountValid(source,initial.sourceOwner,asset);
   // Point-in-time liquidity is NOT a durable reservation and cannot prevent another signer spending.
   if(source.amount<BigInt(initial.amountMinor))throw new PayoutProviderError('INSUFFICIENT_LIQUIDITY');
   const destinationInfo=await connection.getAccountInfo(new PublicKey(initial.recipientTokenAccount),'confirmed');
   if(destinationInfo)tokenAccountValid(spl.unpackAccount(new PublicKey(initial.recipientTokenAccount),destinationInfo,program),initial.recipientOwner,asset);
   const block=await connection.getLatestBlockhashAndContext('confirmed');
   let recipientAccountSize=spl.ACCOUNT_SIZE;
   if(!destinationInfo&&asset.instructionPolicy==='token2022_zero_fee'){
    // The pinned SDK cannot size USDG's observed extension16. Ask the canonical
    // token program instead; ATA creation also requires ImmutableOwner (wire7).
    const data=Buffer.alloc(3);data[0]=spl.TokenInstruction.GetAccountDataSize;data.writeUInt16LE(spl.ExtensionType.ImmutableOwner,1);
    const query=new Transaction({feePayer:new PublicKey(policy.feePayerOwner),recentBlockhash:block.value.blockhash}).add(new TransactionInstruction({programId:program,keys:[{pubkey:mintKey,isSigner:false,isWritable:false}],data}));
    const response=await connection.simulateTransaction(VersionedTransaction.deserialize(query.serialize({requireAllSignatures:false,verifySignatures:false})),{sigVerify:false,replaceRecentBlockhash:false,commitment:'confirmed',minContextSlot:block.context.slot});
    const returned=response.value.returnData;
    if(response.value.err||!returned||returned.programId!==asset.tokenProgram||returned.data[1]!=='base64')throw new PayoutProviderError('PROVIDER_UNAVAILABLE');
    const bytes=Buffer.from(returned.data[0],'base64');
    if(bytes.length!==8||bytes.toString('base64')!==returned.data[0])throw new PayoutProviderError('PROVIDER_UNAVAILABLE');
    const size=bytes.readBigUInt64LE();
    if(size<BigInt(spl.ACCOUNT_SIZE)||size>10240n)throw new PayoutProviderError('ASSET_POLICY');
    recipientAccountSize=Number(size);
   }
   const rent=destinationInfo?0:safeLamports(await connection.getMinimumBalanceForRentExemption(recipientAccountSize,'confirmed'));
   const intent:PayoutIntent={...initial,blockhash:block.value.blockhash,lastValidBlockHeight:block.value.lastValidBlockHeight,preparedAtSlot:block.context.slot,createRecipientAccount:!destinationInfo,rentLamports:rent};
   // Attribution is fixed-size: estimating with a placeholder has the same message size/signers.
   const placeholder=attribution('0'.repeat(64)),draft=transaction(intent,placeholder.memo,placeholder.reference);
   const quotedFee=(await connection.getFeeForMessage(draft.compileMessage(),'confirmed')).value;
   if(quotedFee===null)throw new PayoutProviderError('PROVIDER_UNAVAILABLE');
   intent.feeLamports=safeLamports(quotedFee);assertPolicy(intent);
   const binding=attribution(intentDigest(intent)),tx=transaction(intent,binding.memo,binding.reference);
   const exactFee=(await connection.getFeeForMessage(tx.compileMessage(),'confirmed')).value;
   if(exactFee!==intent.feeLamports)throw new PayoutProviderError('FEE_POLICY');
   if(safeLamports(await connection.getBalance(new PublicKey(intent.feePayerOwner),'confirmed'))<intent.feeLamports+intent.rentLamports)throw new PayoutProviderError('INSUFFICIENT_LIQUIDITY');
   const keys=await loadSigningKeys();
   if(keys.source.publicKey.toBase58()!==intent.sourceOwner||keys.feePayer.publicKey.toBase58()!==intent.feePayerOwner)throw new PayoutProviderError('CONFIG_ERROR');
   tx.sign(...(keys.source.publicKey.equals(keys.feePayer.publicKey)?[keys.source]:[keys.feePayer,keys.source]));
   if(!tx.verifySignatures()||!tx.signature)throw new PayoutProviderError('CONFIG_ERROR');
   const bytes=tx.serialize();if(bytes.length>1232)throw new PayoutProviderError('INVALID_REQUEST');
   // Versioned overload preserves this blockhash and verifies all signatures; legacy simulation may replace it.
   const simulation=await connection.simulateTransaction(VersionedTransaction.deserialize(bytes),{sigVerify:true,replaceRecentBlockhash:false,commitment:'confirmed',minContextSlot:intent.preparedAtSlot});
   if(simulation.value.err)throw new PayoutProviderError('SIMULATION_FAILED');
   const prepared:PreparedPayout={...intent,...binding,signedBase64:bytes.toString('base64'),signature:bs58.encode(tx.signature),signedBytesSha256:sha(bytes)};
   return readPrepared(prepared).prepared;
  }catch(error){if(error instanceof PayoutProviderError)throw error;throw new PayoutProviderError('PROVIDER_UNAVAILABLE');}
 }
 async function broadcast(value:PreparedPayout):Promise<BroadcastPayoutResult>{
  let frozen:DecodedPayout;
  try{frozen=readPrepared(value);}catch{return {status:'NOT_BROADCAST',signature:value.signature,reason:'INVALID_PREPARED'};}
  const {prepared,bytes,signed}=frozen;
  try{
   await assertGenesis();
   // A registry disable/mint change may pause NEW preparations. It must not rewrite an existing attempt.
   const valid=await connection.isBlockhashValid(prepared.blockhash,{commitment:'confirmed',minContextSlot:prepared.preparedAtSlot});
   if(!valid.value)return {status:'NOT_BROADCAST',signature:prepared.signature,reason:'BLOCKHASH_EXPIRED'};
   const fee=(await connection.getFeeForMessage(signed.compileMessage(),'confirmed')).value;
   if(fee===null||fee>policy.maxFeeLamports||fee+prepared.rentLamports>policy.maxTotalLamports)return {status:'NOT_BROADCAST',signature:prepared.signature,reason:'PROVIDER_UNAVAILABLE'};
  }catch{return {status:'NOT_BROADCAST',signature:prepared.signature,reason:'PROVIDER_UNAVAILABLE'};}
  // The caller MUST have committed prepared before this point. No callback, new signing or replacement here.
  try{
   const signature=await connection.sendRawTransaction(bytes,{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0,minContextSlot:prepared.preparedAtSlot});
   if(signature!==prepared.signature)return {status:'UNKNOWN',signature:prepared.signature,reason:'SUBMISSION_AMBIGUOUS'};
   return {status:'SUBMITTED',signature};
  }catch{return {status:'UNKNOWN',signature:prepared.signature,reason:'SUBMISSION_AMBIGUOUS'};}
 }
 async function reconcile(value:PreparedPayout):Promise<ReconcilePayoutResult>{
  let frozen:DecodedPayout;
  try{frozen=readPrepared(value);}catch{return {status:'UNKNOWN',signature:value.signature,reason:'INVALID_PREPARED'};}
  const {prepared,signed}=frozen;
  const unknown=(reason:Extract<ReconcilePayoutResult,{status:'UNKNOWN'}>['reason']):ReconcilePayoutResult=>({status:'UNKNOWN',signature:prepared.signature,reason});
  try{
   await assertGenesis();
   for(const commitment of ['finalized','confirmed'] as const){
    const chainTx=await connection.getTransaction(prepared.signature,{commitment,maxSupportedTransactionVersion:0});
    if(!chainTx)continue;
    try{
     const message=chainTx.transaction.message;
     if(!Buffer.from(message.serialize()).equals(signed.serializeMessage())||!chainTx.meta||chainTx.meta.err===undefined||!Number.isSafeInteger(chainTx.slot)||chainTx.slot<prepared.preparedAtSlot)throw Error('Proof');
     const keys=message.getAccountKeys(),required=message.header.numRequiredSignatures;
     if(chainTx.transaction.signatures.length!==required||chainTx.transaction.signatures[0]!==prepared.signature)throw Error('Signatures');
     for(let index=0;index<required;index++){
      const key=keys.get(index),chainSignature=chainTx.transaction.signatures[index],localSignature=signed.signatures[index]?.signature;
      if(!key||!localSignature||bs58.encode(localSignature)!==chainSignature||!nacl.sign.detached.verify(signed.serializeMessage(),bs58.decode(chainSignature),key.toBytes()))throw Error('Signatures');
     }
     if(chainTx.meta.err!==null){
      if(commitment!=='finalized')return unknown('NOT_FINALIZED');
      const evidence={kind:'FINALIZED_CHAIN_FAILURE' as const,genesisHash:prepared.genesisHash,slot:chainTx.slot,intentDigest:prepared.intentDigest,signedBytesSha256:prepared.signedBytesSha256,transactionError:chainTx.meta.err};
      return {status:'FAILED',signature:prepared.signature,evidence,digest:sha(JSON.stringify(['BitPOS/PayoutFailure/v1',prepared.signature,evidence]))};
     }
     // Only the canonical allowlisted programs may run; checked transfer has no hook, fee or CPI transfer.
     if(chainTx.meta.innerInstructions?.some(group=>group.index===(prepared.createRecipientAccount?1:0)&&group.instructions.length>0))throw Error('Unexpected transfer CPI');
     let sourceIndex=-1,destinationIndex=-1;
     for(let index=0;index<keys.length;index++){
      const key=keys.get(index)?.toBase58();if(key===prepared.sourceTokenAccount)sourceIndex=index;if(key===prepared.recipientTokenAccount)destinationIndex=index;
     }
     if(sourceIndex<0||destinationIndex<0)throw Error('Accounts');
     const preSource=balance(chainTx.meta.preTokenBalances,sourceIndex,prepared.sourceOwner,prepared.asset,false);
     const postSource=balance(chainTx.meta.postTokenBalances,sourceIndex,prepared.sourceOwner,prepared.asset,false);
     const preDestination=balance(chainTx.meta.preTokenBalances,destinationIndex,prepared.recipientOwner,prepared.asset,prepared.createRecipientAccount);
     const postDestination=balance(chainTx.meta.postTokenBalances,destinationIndex,prepared.recipientOwner,prepared.asset,false);
     const amount=BigInt(prepared.amountMinor);
     if(preSource-postSource!==amount||postDestination-preDestination!==amount)throw Error('Amount');
     const fee=safeLamports(chainTx.meta.fee);
     if(fee>policy.maxFeeLamports||fee+prepared.rentLamports>policy.maxTotalLamports)throw Error('Fee');
     const evidence:PayoutReceiptEvidence={version:1,provider:'solana-devnet',commitment,genesisHash:prepared.genesisHash,signature:prepared.signature,slot:chainTx.slot,blockTime:chainTx.blockTime??null,feeLamports:fee,intentDigest:prepared.intentDigest,signedBytesSha256:prepared.signedBytesSha256,attemptId:prepared.attemptId,batchId:prepared.batchId,amountMinor:prepared.amountMinor,asset:prepared.asset,sourceOwner:prepared.sourceOwner,sourceTokenAccount:prepared.sourceTokenAccount,recipientOwner:prepared.recipientOwner,recipientTokenAccount:prepared.recipientTokenAccount,memo:prepared.memo,reference:prepared.reference,sourcePreMinor:preSource.toString(),sourcePostMinor:postSource.toString(),recipientPreMinor:preDestination.toString(),recipientPostMinor:postDestination.toString()};
     const receipt={evidence,digest:payoutReceiptDigest(evidence)};
     return commitment==='finalized'?{status:'FINALIZED',receipt}:{status:'CONFIRMED',receipt};
    }catch{return unknown('PROOF_REJECTED');}
   }
   const history=await connection.getSignatureStatuses([prepared.signature],{searchTransactionHistory:true});
   if(history.value[0])return unknown('HISTORY_UNAVAILABLE'); // A status without the actual transaction is not a transfer proof.
   const height=await connection.getBlockHeight('finalized');
   if(height>prepared.lastValidBlockHeight){
    const valid=await connection.isBlockhashValid(prepared.blockhash,{commitment:'finalized',minContextSlot:prepared.preparedAtSlot});
    // Standard RPC null history is never a completeness certificate: pruning, lag and RPC failures exist.
    return {status:'UNKNOWN',signature:prepared.signature,reason:'EXPIRED_WITHOUT_COMPLETE_HISTORY',expiry:{finalizedBlockHeight:height,lastValidBlockHeight:prepared.lastValidBlockHeight,blockhashValid:valid.value,historySearchRequested:true,absenceIsConclusive:false}};
   }
   return unknown('HISTORY_UNAVAILABLE');
  }catch{return unknown('PROVIDER_UNAVAILABLE');}
 }
 return {kind:'ready',prepare,broadcast,reconcile};
}
function balance(rows:TokenBalance[]|null|undefined,index:number,owner:string,asset:Readonly<PaymentAsset>,allowMissing:boolean):bigint {
 const matches=rows?.filter(row=>row.accountIndex===index)??[];
 if(!matches.length&&allowMissing)return 0n;
 if(matches.length!==1)throw Error('Missing token evidence');
 const row=matches[0];
 if(!row||row.owner!==owner||row.programId!==asset.tokenProgram||row.mint!==asset.mint||row.uiTokenAmount.decimals!==asset.decimals||!/^\d+$/.test(row.uiTokenAmount.amount))throw Error('Token evidence mismatch');
 const value=BigInt(row.uiTokenAmount.amount);if(value>18446744073709551615n)throw Error('Token evidence amount');return value;
}
/** Recompute from stored evidence; this digest alone does not authenticate untrusted evidence. */
export function payoutReceiptDigest(e:PayoutReceiptEvidence):string {
 return sha(JSON.stringify(['BitPOS/SolanaDevnet/PayoutReceipt/v1',e.version,e.provider,e.commitment,e.genesisHash,e.signature,e.slot,e.blockTime,e.feeLamports,e.intentDigest,e.signedBytesSha256,e.attemptId,e.batchId,e.amountMinor,assetTuple(e.asset),e.sourceOwner,e.sourceTokenAccount,e.recipientOwner,e.recipientTokenAccount,e.memo,e.reference,e.sourcePreMinor,e.sourcePostMinor,e.recipientPreMinor,e.recipientPostMinor]));
}

export interface BeneficiaryOwnershipChallenge {
 version:1;domain:string;tenantId:string;accountId:string;deviceId:string;enrollmentId:string;challengeId:string;
 nonce:string;destinationOwner:string;genesisHash:typeof DEVNET_GENESIS;issuedAt:string;expiresAt:string;
}
const challengeSchema=z.object({version:z.literal(1),domain:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/),tenantId:idSchema,accountId:idSchema,deviceId:idSchema,enrollmentId:idSchema,challengeId:idSchema,nonce:z.string().regex(/^[a-f0-9]{64}$/),destinationOwner:ownerSchema,genesisHash:z.literal(DEVNET_GENESIS),issuedAt:z.string().datetime(),expiresAt:z.string().datetime()}).strict();
export type BeneficiaryOwnershipResult=
 |{status:'VERIFIED';destinationOwner:string;challengeId:string;messageDigest:string;signature:string;expiresAt:string}
 |{status:'REJECTED';reason:'INVALID_CHALLENGE'|'EXPIRED'|'INVALID_SIGNATURE'};
/** Construct on the server from the authenticated account/device and durable pending enrollment. */
export function beneficiaryOwnershipChallengeMessage(value:BeneficiaryOwnershipChallenge):string {
 const c=challengeSchema.parse(value);
 return JSON.stringify(['BitPOS/SolanaDevnet/PayoutBeneficiaryOwnership/v1',c.version,c.domain,c.genesisHash,c.tenantId,c.accountId,c.deviceId,c.enrollmentId,c.challengeId,c.nonce,c.destinationOwner,c.issuedAt,c.expiresAt]);
}
/** The challenge argument MUST be the server's stored challenge, never reconstructed from request fields.
 * Atomically consume challengeId/nonce with enrollment under matching account/device/tenant after verification.
 * Signature verification establishes only key possession, not account authorization or payout eligibility.
 */
export function verifyBeneficiaryOwnershipChallenge(value:BeneficiaryOwnershipChallenge,signature:string,now:number=Date.now()):BeneficiaryOwnershipResult {
 let c:z.infer<typeof challengeSchema>,message:string;
 try{
  c=challengeSchema.parse(value);message=beneficiaryOwnershipChallengeMessage(c);
  if(!Number.isSafeInteger(now)||Date.parse(c.expiresAt)<=Date.parse(c.issuedAt)||Date.parse(c.expiresAt)-Date.parse(c.issuedAt)>600_000)return {status:'REJECTED',reason:'INVALID_CHALLENGE'};
 }catch{return {status:'REJECTED',reason:'INVALID_CHALLENGE'};}
 if(now<Date.parse(c.issuedAt)||now>=Date.parse(c.expiresAt))return {status:'REJECTED',reason:'EXPIRED'};
 try{
  if(typeof signature!=='string'||signature.length<64||signature.length>88)return {status:'REJECTED',reason:'INVALID_SIGNATURE'};
  const bytes=bs58.decode(signature);
  if(bytes.length!==64||bs58.encode(bytes)!==signature||!nacl.sign.detached.verify(Buffer.from(message,'utf8'),bytes,new PublicKey(c.destinationOwner).toBytes()))return {status:'REJECTED',reason:'INVALID_SIGNATURE'};
 }catch{return {status:'REJECTED',reason:'INVALID_SIGNATURE'};}
 return {status:'VERIFIED',destinationOwner:c.destinationOwner,challengeId:c.challengeId,messageDigest:sha(message),signature,expiresAt:c.expiresAt};
}

export interface InboundFundingEvidence {
 version:1;kind:'FINALIZED_INBOUND_FUNDING';genesisHash:string;signature:string;slot:number;asset:Readonly<PaymentAsset>;
 amountMinor:string;sourceOwner:string;sourceTokenAccount:string;recipientOwner:string;recipientTokenAccount:string;
 sourcePreMinor:string;sourcePostMinor:string;recipientPreMinor:string;recipientPostMinor:string;messageSha256:string;
}
export type InboundFundingResult={status:'VERIFIED';evidence:InboundFundingEvidence;digest:string}|{status:'UNAVAILABLE';reason:'NOT_CONFIGURED'|'PROVIDER_UNAVAILABLE'|'HISTORY_UNAVAILABLE'|'PROOF_REJECTED'};
/** Read-only inbound verifier. A wallet balance or outbound receipt is not funding.
 * Deliberately supports a direct checked transfer into an existing canonical ATA;
 * opaque CPI/swap/ATA-creation transactions remain unavailable, never guessed.
 */
export function createInboundFundingVerifier(deps?:Pick<PayoutProviderDeps,'connection'|'resolveAsset'>){
 return {async verify(input:{signature:string;assetId:string;recipientOwner:string}):Promise<InboundFundingResult>{
  if(!deps)return {status:'UNAVAILABLE',reason:'NOT_CONFIGURED'};
  const unavailable=(reason:Extract<InboundFundingResult,{status:'UNAVAILABLE'}>['reason']):InboundFundingResult=>({status:'UNAVAILABLE',reason});
  try{
   if(await deps.connection.getGenesisHash()!==DEVNET_GENESIS)return unavailable('PROVIDER_UNAVAILABLE');
   const asset=canonicalAsset(await deps.resolveAsset(input.assetId)),recipient=ownerSchema.parse(input.recipientOwner);
   if(bs58.decode(input.signature).length!==64)return unavailable('PROOF_REJECTED');
   const tx=await deps.connection.getTransaction(input.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
   if(!tx)return unavailable('HISTORY_UNAVAILABLE');
   try{
    if(!tx.meta||tx.meta.err!==null||!Number.isSafeInteger(tx.slot)||tx.slot<0)throw Error('Unsuccessful funding');
    const message=tx.transaction.message,bytes=message.serialize(),keys=message.getAccountKeys({accountKeysFromLookups:tx.meta.loadedAddresses});
    if(tx.transaction.signatures.length!==message.header.numRequiredSignatures||tx.transaction.signatures[0]!==input.signature)throw Error('Funding signature');
    for(let index=0;index<message.header.numRequiredSignatures;index++){
     if(!nacl.sign.detached.verify(bytes,bs58.decode(tx.transaction.signatures[index]),keys.get(index)!.toBytes()))throw Error('Funding signature');
    }
    const mintInfo=await deps.connection.getAccountInfo(new PublicKey(asset.mint),'finalized');
    if(!mintInfo||!mintInfo.owner.equals(new PublicKey(asset.tokenProgram)))throw Error('Funding mint program');
    assertMintPolicy(asset,spl.unpackMint(new PublicKey(asset.mint),mintInfo,new PublicKey(asset.tokenProgram)));
    let transferIndex=-1,sourceIndex=-1,destinationIndex=-1,sourceOwner='',amount=0n;
    for(const [index,compiled] of message.compiledInstructions.entries()){
     const program=keys.get(compiled.programIdIndex)!;
     if(program.toBase58()==='ComputeBudget111111111111111111111111111111'||program.equals(MEMO_PROGRAM))continue;
     if(!program.equals(new PublicKey(asset.tokenProgram))||transferIndex!==-1)throw Error('Unsupported funding instructions');
     const instruction=new TransactionInstruction({programId:program,data:Buffer.from(compiled.data),keys:[...compiled.accountKeyIndexes].map(i=>({pubkey:keys.get(i)!,isSigner:message.isAccountSigner(i),isWritable:message.isAccountWritable(i)}))});
     const decoded=asset.instructionPolicy==='token2022_zero_fee'?spl.decodeTransferCheckedWithFeeInstruction(instruction,program):spl.decodeTransferCheckedInstruction(instruction,program);
     const authority='authority' in decoded.keys?decoded.keys.authority:decoded.keys.owner;
     if(instruction.keys.length!==4||!authority.isSigner||!decoded.keys.mint.pubkey.equals(new PublicKey(asset.mint))||decoded.data.decimals!==asset.decimals||('fee' in decoded.data&&decoded.data.fee!==0n))throw Error('Funding transfer');
     sourceOwner=authority.pubkey.toBase58();amount=decoded.data.amount;
     if(sourceOwner===recipient||amount<=0n||amount>MAX_PAYMENT_RAW||decoded.keys.source.pubkey.toBase58()!==ata(sourceOwner,asset)||decoded.keys.destination.pubkey.toBase58()!==ata(recipient,asset))throw Error('Funding destination');
     transferIndex=index;sourceIndex=compiled.accountKeyIndexes[0];destinationIndex=compiled.accountKeyIndexes[2];
    }
    if(transferIndex<0||tx.meta.innerInstructions?.some(group=>group.index===transferIndex&&group.instructions.length))throw Error('Funding CPI');
    const preSource=balance(tx.meta.preTokenBalances,sourceIndex,sourceOwner,asset,false),postSource=balance(tx.meta.postTokenBalances,sourceIndex,sourceOwner,asset,false);
    const preDestination=balance(tx.meta.preTokenBalances,destinationIndex,recipient,asset,false),postDestination=balance(tx.meta.postTokenBalances,destinationIndex,recipient,asset,false);
    if(preSource-postSource!==amount||postDestination-preDestination!==amount)throw Error('Funding amount');
    const evidence:InboundFundingEvidence={version:1,kind:'FINALIZED_INBOUND_FUNDING',genesisHash:DEVNET_GENESIS,signature:input.signature,slot:tx.slot,asset,amountMinor:amount.toString(),sourceOwner,sourceTokenAccount:ata(sourceOwner,asset),recipientOwner:recipient,recipientTokenAccount:ata(recipient,asset),sourcePreMinor:preSource.toString(),sourcePostMinor:postSource.toString(),recipientPreMinor:preDestination.toString(),recipientPostMinor:postDestination.toString(),messageSha256:sha(bytes)};
    return {status:'VERIFIED',evidence,digest:sha(JSON.stringify(['BitPOS/InboundFunding/v1',evidence]))};
   }catch{return unavailable('PROOF_REJECTED');}
  }catch{return unavailable('PROVIDER_UNAVAILABLE');}
 }};
}
