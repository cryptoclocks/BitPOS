import {createHash} from 'node:crypto';
import type pg from 'pg';
import {PublicKey,Transaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {z} from 'zod';
import type {PaymentAsset} from '../../../packages/contracts/src/index';
import {DEVNET_GENESIS} from '../../../packages/domain/src/index';
import {assertAssetDescriptor,MAX_PAYMENT_RAW} from '../../../packages/domain/src/payment-assets';
import {createPayoutProvider,type PayoutProvider,type PayoutProviderConfig,type PayoutProviderDeps,type PreparedPayout,type ReadyPayoutProvider,type ReconcilePayoutResult} from './payout-provider';

/** This module does not read environment variables, load keys, create pools/RPC clients or perform IO on import. */
export interface DriverSettlementSql {
 query(sql:string,values?:unknown[]):Promise<{rows:Record<string,unknown>[]}>;
}
/** Resolves ONLY after COMMIT. Callbacks contain SQL and pure parsing, never provider/key/registry IO. */
export type DriverSettlementTransaction=<T>(run:(db:DriverSettlementSql)=>Promise<T>)=>Promise<T>;
export interface DriverSettlementDependencies {
 transaction:DriverSettlementTransaction;
 /** resolveAsset is deliberately supplied by this worker's narrow SQL registry entry, not by callers. */
 providerDeps:Omit<PayoutProviderDeps,'resolveAsset'>;
 providerFactory?:(config:PayoutProviderConfig,deps:PayoutProviderDeps)=>PayoutProvider;
 now?:()=>Date;
}
export type DriverSettlementConfig={kind:'unavailable'}|{
 kind:'enabled';adapterVersion:string;provider:Exclude<PayoutProviderConfig,{kind:'unavailable'}>;
 maxBatchesPerTick:number;maxTerminalAttemptsPerTick:number;
};
export interface DriverSettlementTickResult {
 status:'AVAILABLE'|'PARTIAL'|'UNAVAILABLE'|'BUSY'|'ABORTED';
 discovered:number;processed:number;allocated:number;prepared:number;submissionCommitted:number;
 broadcastSubmitted:number;broadcastUnknown:number;notBroadcast:number;unknown:number;
 finalized:number;failed:number;incidents:number;alreadyRecorded:number;
 unavailable:number;conflicts:number;errors:number;reasons:Record<string,number>;
}
export interface DriverSettlementWorker {
 tick:(signal?:AbortSignal)=>Promise<DriverSettlementTickResult>;
 /** Operator/internal recovery only. Never signs or sends, including for terminal attempts. */
 reconcileAttempts:(attemptIds:readonly string[],signal?:AbortSignal)=>Promise<DriverSettlementTickResult>;
}
class SettlementBoundaryError extends Error {
 constructor(readonly code:'INVALID_SQL_RESULT'|'IDENTITY_CONFLICT'|'PROVIDER_UNAVAILABLE'|'ASSET_UNAVAILABLE'|'INVALID_PREPARED'|'CONFIG_ERROR') {super(code);}
}
const uuid=z.string().uuid();
const integer=z.string().regex(/^[1-9][0-9]{0,18}$/).refine(value=>BigInt(value)<=9223372036854775807n);
const amount=z.string().regex(/^[1-9][0-9]{0,17}$/).refine(value=>BigInt(value)<=MAX_PAYMENT_RAW);
const hash=z.string().regex(/^[0-9a-f]{64}$/);
const key=z.string().refine(value=>{try{return new PublicKey(value).toBase58()===value;}catch{return false;}});
const owner=key.refine(value=>PublicKey.isOnCurve(new PublicKey(value).toBytes()));
const assetSchema=z.object({assetId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),symbol:z.enum(['USDG','USDC','USDT']),displayLabel:z.string().min(1).max(96),cluster:z.literal('devnet'),genesisHash:z.literal(DEVNET_GENESIS),mint:key,tokenProgram:key,decimals:z.literal(6),instructionPolicy:z.enum(['token2022_zero_fee','spl_checked']),issuerTestAsset:z.boolean()}).strict();
const earningMoney=z.object({amountMinor:integer,currency:z.enum(['USD','USDG']),decimals:z.union([z.literal(2),z.literal(4),z.literal(6)])}).strict().refine(value=>value.currency!=='USDG'||value.decimals===6);
const payoutMoney=z.object({amountMinor:amount,currency:z.enum(['USDG','USDC','USDT']),decimals:z.literal(6)}).strict();
const nonnegative=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const preparedSchema=z.object({version:z.literal(1),attemptId:uuid,batchId:uuid,amountMinor:amount,asset:assetSchema,genesisHash:z.literal(DEVNET_GENESIS),recipientOwner:owner,recipientTokenAccount:key,sourceOwner:owner,sourceTokenAccount:key,feePayerOwner:owner,blockhash:key,lastValidBlockHeight:nonnegative,preparedAtSlot:nonnegative,createRecipientAccount:z.boolean(),feeLamports:z.number().int().nonnegative().max(1_000_000),rentLamports:z.number().int().nonnegative().max(10_000_000),signedBase64:z.string().min(1).max(1644),signature:z.string().min(64).max(88),signedBytesSha256:hash,intentDigest:hash,memo:z.string().max(128),reference:key}).strict();
const attemptState=z.enum(['SIGNING','PREPARED','SUBMITTED','UNKNOWN','CONFIRMED','FAILED']);
const queueItem=z.object({
 batchId:uuid,merchantId:uuid,batchVersion:integer,state:z.enum(['RESERVED','SIGNING','PREPARED','SUBMITTED','UNKNOWN']),beneficiaryId:uuid,beneficiaryVersion:integer,
 recipientPublicKey:owner,beneficiaryState:z.enum(['PENDING','VERIFIED','SUSPENDED']),money:earningMoney,payoutMoney,asset:assetSchema,readiness:z.string().min(1).max(100),
 configId:uuid.nullable(),configVersion:integer.nullable(),adapterVersion:z.string().min(1).max(100).nullable(),providerAvailable:z.boolean(),provider:z.string().nullable(),network:z.string().nullable(),genesisHash:key.nullable(),mintPublicKey:key.nullable(),tokenProgramPublicKey:key.nullable(),senderPublicKey:owner.nullable(),feePayerPublicKey:owner.nullable(),
 attemptId:uuid.nullable(),attemptVersion:integer.nullable(),transactionId:z.string().nullable(),signedBytesHash:hash.nullable(),
 fundingEvidence:z.array(z.object({evidenceId:uuid,remaining:payoutMoney}).strict()).max(50),
}).strict();
const queueSchema=z.object({items:z.array(queueItem).max(50),nextAfterId:uuid.nullable()}).strict();
const terminalQueueSchema=z.object({items:z.array(z.object({attemptId:uuid}).strict()).max(50),nextAfterId:uuid.nullable()}).strict();
const snapshotSchema=z.object({attemptId:uuid,attemptVersion:integer,batchId:uuid,batchVersion:integer,state:attemptState,money:earningMoney,payoutMoney,asset:assetSchema,recipientPublicKey:owner,senderPublicKey:owner,prepared:preparedSchema.nullable(),receipts:z.array(z.object({receiptId:uuid,outcome:z.enum(['CONFIRMED','FAILED']),verificationHash:hash,providerEvidence:z.record(z.string(),z.unknown()),ledgerTransactionId:uuid.nullable()}).strict()).max(2)}).strict();
type QueueItem=z.infer<typeof queueItem>;
type Snapshot=z.infer<typeof snapshotSchema>;
const providerConfigSchema=z.object({kind:z.literal('solana-devnet'),sourceOwner:owner,feePayerOwner:owner,allowedAssetIds:z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).min(1).max(16),maxAmountMinor:amount,maxFeeLamports:z.number().int().min(1).max(1_000_000),maxTotalLamports:z.number().int().min(1).max(10_000_000)}).strict().refine(value=>new Set(value.allowedAssetIds).size===value.allowedAssetIds.length&&value.maxTotalLamports>=value.maxFeeLamports);
const configSchema=z.object({kind:z.literal('enabled'),adapterVersion:z.string().trim().min(1).max(100),provider:providerConfigSchema,maxBatchesPerTick:z.number().int().min(1).max(50).default(50),maxTerminalAttemptsPerTick:z.number().int().min(1).max(50).default(50)}).strict();

/** No exception includes input/configuration, SQL text, keys, signed bytes or provider error messages. */
export function readDriverSettlementConfig(input:unknown=undefined):DriverSettlementConfig {
 if(input===undefined||input===null||z.object({kind:z.literal('unavailable')}).strict().safeParse(input).success)return {kind:'unavailable'};
 const result=configSchema.safeParse(input);if(!result.success)throw new SettlementBoundaryError('CONFIG_ERROR');
 return result.data;
}

/** Caller owns a dedicated pool. This adapter never creates or closes shared infrastructure. */
export function createDriverSettlementTransaction(pool:Pick<pg.Pool,'connect'>):DriverSettlementTransaction {
 return async run=>{
  const client=await pool.connect();
  try {
   await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
   await client.query("SET LOCAL statement_timeout='2000ms';SET LOCAL lock_timeout='200ms'");
   const row=(await client.query<{allowed:boolean}>(`SELECT current_user=session_user
    AND pg_has_role(session_user,'bitpos_settlement_worker','USAGE')
    AND NOT pg_has_role(session_user,'bitpos_app','MEMBER')
    AND NOT(r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls OR r.rolreplication) AS allowed
    FROM pg_roles r WHERE r.rolname=session_user`)).rows[0];
   if(row?.allowed!==true)throw new Error('SETTLEMENT_WORKER_ROLE_REQUIRED');
   const result=await run({query:async(sql,values)=>(await client.query(sql,values))});
   await client.query('COMMIT');return result;
  } catch(error) {
   try{await client.query('ROLLBACK');}catch{/* The original transaction remains unsuccessful. */}
   throw error;
  } finally {client.release();}
 };
}
const functions={queue:'settlement088_worker_queue',terminalQueue:'settlement088_worker_terminal_queue',asset:'settlement088_worker_asset',snapshot:'settlement088_worker_attempt_snapshot',prepare:'settlement088_worker_prepare',submission:'settlement088_worker_submission',reconcile:'settlement088_worker_reconcile'} as const;
async function sqlCall(transaction:DriverSettlementTransaction,operation:keyof typeof functions,args:unknown[]):Promise<unknown> {
 // Function names come only from this fixed allowlist; all values are bound parameters.
 return transaction(async db=>{
  const sql=`SELECT bitpos.${functions[operation]}(${args.map((_,index)=>'$'+(index+1)).join(',')}) AS value`;
  const result=await db.query(sql,args);
  if(result.rows.length!==1||!Object.hasOwn(result.rows[0],'value'))throw new SettlementBoundaryError('INVALID_SQL_RESULT');
  return result.rows[0].value;
 });
}
/** Actual enabled+verified registry, not USDG constants or a descriptor echoed from the queue. */
export function createDriverSettlementAssetResolver(transaction:DriverSettlementTransaction):PayoutProviderDeps['resolveAsset'] {
 return async assetId=>{
  const value=await sqlCall(transaction,'asset',[assetId]);if(value===null)return null;
  const parsed=assetSchema.safeParse(value);if(!parsed.success||parsed.data.assetId!==assetId)throw new SettlementBoundaryError('INVALID_SQL_RESULT');
  assertAssetDescriptor(parsed.data);return Object.freeze(parsed.data);
 };
}
function canonical(value:unknown):string {
 if(value===null||typeof value!=='object')return JSON.stringify(value)??'null';
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 const object=value as Record<string,unknown>;
 return '{'+Object.keys(object).sort().map(name=>JSON.stringify(name)+':'+canonical(object[name])).join(',')+'}';
}
const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
function same(a:unknown,b:unknown){return canonical(a)===canonical(b);}
/** Full domain command + CAS payload: independent processes derive the same key for the same request. */
function command(operation:string,target:string,payload:Record<string,unknown>):Record<string,unknown> {
 const bytes=createHash('sha256').update(canonical(['BitPOS/Settlement088/WorkerCommand/v1',operation,target,payload])).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|128;bytes[8]=(bytes[8]&63)|128;
 const hex=bytes.toString('hex'),idempotencyKey=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
 return {...payload,idempotencyKey};
}
function result(status:DriverSettlementTickResult['status']='AVAILABLE'):DriverSettlementTickResult {
 return {status,discovered:0,processed:0,allocated:0,prepared:0,submissionCommitted:0,broadcastSubmitted:0,broadcastUnknown:0,notBroadcast:0,unknown:0,finalized:0,failed:0,incidents:0,alreadyRecorded:0,unavailable:0,conflicts:0,errors:0,reasons:{}};
}
function note(report:DriverSettlementTickResult,reason:string){report.reasons[reason]=(report.reasons[reason]??0)+1;}
const conflictCodes:Record<string,true>={VERSION_CONFLICT:true,ATTEMPT_ALREADY_SIGNED:true,ATTEMPT_ALREADY_EXISTS_OR_BATCH_NOT_RESERVED:true,ATTEMPT_NOT_SENDABLE:true,ATTEMPT_NOT_SIGNED_OR_TERMINAL:true,ATTEMPT_TERMINAL_OR_UNFUNDED:true,RECEIPT_ALREADY_RECORDED_USE_ORIGINAL_COMMAND:true};
const unavailableCodes:Record<string,true>={PROVIDER_UNAVAILABLE:true,BENEFICIARY_PENDING:true,VERIFIED_FUNDING_REQUIRED:true,VERIFIED_FUNDING_INSUFFICIENT:true,FUNDING_RECONCILIATION_REQUIRED:true,SOURCE_RECONCILIATION_REQUIRED:true,ASSET_UNAVAILABLE:true};
function recordError(report:DriverSettlementTickResult,error:unknown) {
 const object=error as {message?:unknown;code?:unknown};
 if(Object.hasOwn(conflictCodes,String(object?.message))||['40001','40P01','55P03'].includes(String(object?.code))){report.conflicts++;note(report,'CONCURRENT_CHANGE');return;}
 if(Object.hasOwn(unavailableCodes,String(object?.message))){report.unavailable++;note(report,String(object.message));return;}
 report.errors++;note(report,error instanceof SettlementBoundaryError?error.code:'OPERATION_UNAVAILABLE');
}
function finish(report:DriverSettlementTickResult,signal?:AbortSignal) {
 if(signal?.aborted)report.status='ABORTED';
 else if(report.errors||report.unavailable)report.status=report.processed>report.errors+report.unavailable?'PARTIAL':'UNAVAILABLE';
 else if(report.conflicts)report.status='PARTIAL';
 return report;
}
function parse<T>(schema:z.ZodType<T>,value:unknown):T {
 const read=schema.safeParse(value);if(!read.success)throw new SettlementBoundaryError('INVALID_SQL_RESULT');return read.data;
}
function parseSnapshot(value:unknown):Snapshot {
 const snapshot=parse(snapshotSchema,value);assertAssetDescriptor(snapshot.asset);
 if((snapshot.state==='SIGNING')!==(snapshot.prepared===null))throw new SettlementBoundaryError('INVALID_SQL_RESULT');
 if(snapshot.asset.symbol!==snapshot.payoutMoney.currency||snapshot.asset.decimals!==snapshot.payoutMoney.decimals)throw new SettlementBoundaryError('IDENTITY_CONFLICT');
 return snapshot;
}
function assertPrepared(value:unknown,snapshot:Snapshot,policy:Exclude<PayoutProviderConfig,{kind:'unavailable'}>):PreparedPayout {
 const prepared=parse(preparedSchema,value);assertAssetDescriptor(prepared.asset);
 if(prepared.attemptId!==snapshot.attemptId||prepared.batchId!==snapshot.batchId||prepared.amountMinor!==snapshot.payoutMoney.amountMinor||!same(prepared.asset,snapshot.asset)||prepared.recipientOwner!==snapshot.recipientPublicKey||prepared.sourceOwner!==snapshot.senderPublicKey||prepared.sourceOwner!==policy.sourceOwner||prepared.feePayerOwner!==policy.feePayerOwner||!policy.allowedAssetIds.includes(prepared.asset.assetId)||BigInt(prepared.amountMinor)>BigInt(policy.maxAmountMinor)||prepared.feeLamports>policy.maxFeeLamports||prepared.feeLamports+prepared.rentLamports>policy.maxTotalLamports)throw new SettlementBoundaryError('IDENTITY_CONFLICT');
 try {
  const bytes=Buffer.from(prepared.signedBase64,'base64'),tx=Transaction.from(bytes);
  if(bytes.length>1232||bytes.toString('base64')!==prepared.signedBase64||digest(bytes)!==prepared.signedBytesSha256||!tx.verifySignatures()||!tx.signature||bs58.encode(tx.signature)!==prepared.signature||!tx.serialize().equals(bytes))throw Error();
 }catch{throw new SettlementBoundaryError('INVALID_PREPARED');}
 // The audited provider additionally rebuilds the exact instruction/ATA/memo intent before reconcile/send.
 return prepared;
}
function assertQueueIdentity(item:QueueItem,config:Extract<DriverSettlementConfig,{kind:'enabled'}>) {
 const policy=config.provider;assertAssetDescriptor(item.asset);
 if(!item.configId||!item.configVersion||item.adapterVersion!==config.adapterVersion||item.provider!=='solana-devnet'||item.network!=='solana-devnet'||item.genesisHash!==DEVNET_GENESIS||item.genesisHash!==item.asset.genesisHash||item.mintPublicKey!==item.asset.mint||item.tokenProgramPublicKey!==item.asset.tokenProgram||item.senderPublicKey!==policy.sourceOwner||item.feePayerPublicKey!==policy.feePayerOwner||item.payoutMoney.currency!==item.asset.symbol||!policy.allowedAssetIds.includes(item.asset.assetId)||BigInt(item.payoutMoney.amountMinor)>BigInt(policy.maxAmountMinor))throw new SettlementBoundaryError('PROVIDER_UNAVAILABLE');
}
function assertSnapshotIdentity(snapshot:Snapshot,item:QueueItem) {
 if(snapshot.batchId!==item.batchId||snapshot.recipientPublicKey!==item.recipientPublicKey||snapshot.senderPublicKey!==item.senderPublicKey||!same(snapshot.asset,item.asset)||!same(snapshot.money,item.money)||!same(snapshot.payoutMoney,item.payoutMoney))throw new SettlementBoundaryError('IDENTITY_CONFLICT');
}

/**
 * Durable CAS protocol: every external operation begins with a committed snapshot.
 * ALLOCATE commits funding/exclusive attempt -> sign UNSENT bytes -> PERSIST_SIGNED commits
 * complete immutable bytes -> reconcile -> SUBMISSION commits -> send those returned bytes.
 * A crash before persistence can rebuild unsent bytes. A crash/ambiguous commit afterwards
 * reloads the snapshot, never signs again. CAS losers return without any broadcast.
 * UNKNOWN never releases funding or authorizes a replacement. Only SQL verified outcomes
 * discharge/release earning-money and token-atom claims or record a contradictory incident.
 */
export function createDriverSettlementWorker(input:unknown=undefined,deps?:DriverSettlementDependencies):DriverSettlementWorker {
 const parsedConfig=readDriverSettlementConfig(input);
 if(parsedConfig.kind==='unavailable')return {
  tick:async()=>{const report=result('UNAVAILABLE');report.unavailable=1;note(report,'NOT_CONFIGURED');return report;},
  reconcileAttempts:async()=>{const report=result('UNAVAILABLE');report.unavailable=1;note(report,'NOT_CONFIGURED');return report;},
 };
 const config=parsedConfig;
 if(!deps||typeof deps.transaction!=='function'||!deps.providerDeps?.connection||typeof deps.providerDeps.loadSigningKeys!=='function')throw new SettlementBoundaryError('CONFIG_ERROR');
 const transaction=deps.transaction,now=deps.now??(()=>new Date()),resolveAsset=createDriverSettlementAssetResolver(transaction);
 const providerDeps:PayoutProviderDeps={...deps.providerDeps,resolveAsset};
 const factory=deps.providerFactory??createPayoutProvider;
 let batchCursor:string|null=null,terminalCursor:string|null=null,running=false;
 function provider():ReadyPayoutProvider {
  const adapter=factory(config.provider,providerDeps);
  if(adapter.kind!=='ready')throw new SettlementBoundaryError('PROVIDER_UNAVAILABLE');return adapter;
 }
 async function snapshot(attemptId:string):Promise<Snapshot> {
  const read=parseSnapshot(await sqlCall(transaction,'snapshot',[attemptId]));
  if(read.attemptId!==attemptId)throw new SettlementBoundaryError('IDENTITY_CONFLICT');return read;
 }
 async function unknown(snapshot:Snapshot,reason:string,report:DriverSettlementTickResult) {
  if(snapshot.state==='FAILED'||snapshot.state==='CONFIRMED')return;
  await sqlCall(transaction,'reconcile',[snapshot.attemptId,command('reconcile',snapshot.attemptId,{expectedVersion:snapshot.attemptVersion,outcome:'UNKNOWN',reasonCode:reason})]);
  report.unknown++;note(report,reason);
 }
 async function recordOutcome(snapshot:Snapshot,observation:Extract<ReconcilePayoutResult,{status:'FINALIZED'|'FAILED'}>,report:DriverSettlementTickResult) {
  const outcome=observation.status==='FINALIZED'?'CONFIRMED':'FAILED';
  if(snapshot.receipts.some(receipt=>receipt.outcome===outcome)){report.alreadyRecorded++;return;}
  const prepared=assertPrepared(snapshot.prepared,snapshot,config.provider);
  const proof=observation.status==='FINALIZED'?observation.receipt.evidence:observation.evidence;
  const verificationHash=observation.status==='FINALIZED'?observation.receipt.digest:observation.digest;
  if(!hash.safeParse(verificationHash).success||proof.genesisHash!==prepared.genesisHash||proof.intentDigest!==prepared.intentDigest||proof.signedBytesSha256!==prepared.signedBytesSha256||!Number.isSafeInteger(proof.slot)||proof.slot<prepared.preparedAtSlot)throw new SettlementBoundaryError('IDENTITY_CONFLICT');
  if(observation.status==='FINALIZED'){
   const evidence=observation.receipt.evidence;
   if(evidence.commitment!=='finalized'||evidence.signature!==prepared.signature||evidence.attemptId!==prepared.attemptId||evidence.batchId!==prepared.batchId||evidence.amountMinor!==prepared.amountMinor||!same(evidence.asset,prepared.asset)||evidence.sourceOwner!==prepared.sourceOwner||evidence.recipientOwner!==prepared.recipientOwner||evidence.sourceTokenAccount!==prepared.sourceTokenAccount||evidence.recipientTokenAccount!==prepared.recipientTokenAccount||evidence.memo!==prepared.memo||evidence.reference!==prepared.reference)throw new SettlementBoundaryError('IDENTITY_CONFLICT');
  }else if(observation.signature!==prepared.signature||observation.evidence.kind!=='FINALIZED_CHAIN_FAILURE'||observation.evidence.transactionError===null||observation.evidence.transactionError===undefined)throw new SettlementBoundaryError('IDENTITY_CONFLICT');
  // verifiedAt is the worker's observation time, not a client assertion or chain-finality shortcut.
  // If COMMIT is ambiguous, next invocation reads durable receipts before issuing another CAS.
  const payload=command('reconcile',snapshot.attemptId,{expectedVersion:snapshot.attemptVersion,outcome,provider:'solana-devnet',network:'solana-devnet',transactionId:prepared.signature,signedBytesHash:prepared.signedBytesSha256,recipientPublicKey:prepared.recipientOwner,money:snapshot.payoutMoney,verificationHash,verifiedAt:now().toISOString(),reasonCode:outcome==='CONFIRMED'?'FINALIZED_TRANSFER':'FINALIZED_CHAIN_FAILURE',providerEvidence:proof});
  const reply=parse(z.object({kind:z.string()}).passthrough(),await sqlCall(transaction,'reconcile',[snapshot.attemptId,payload]));
  if(reply.kind==='RECONCILIATION_INCIDENT'){report.incidents++;return;}
  if(reply.kind==='BATCH_CONFIRMED'){report.finalized++;return;}
  if(reply.kind==='BATCH_FAILED_RELEASED'){report.failed++;return;}
  throw new SettlementBoundaryError('INVALID_SQL_RESULT');
 }
 async function reconcileOnly(attemptId:string,report:DriverSettlementTickResult,signal?:AbortSignal) {
  const current=await snapshot(attemptId);if(signal?.aborted)return;
  if(current.state==='SIGNING'){report.unavailable++;note(report,'ATTEMPT_NOT_SIGNED');return;}
  const prepared=assertPrepared(current.prepared,current,config.provider),adapter=provider();
  const observation=await adapter.reconcile(prepared);if(signal?.aborted)return;
  if(observation.status==='FINALIZED'||observation.status==='FAILED')await recordOutcome(current,observation,report);
  else {
   const reason=observation.status==='CONFIRMED'?'NOT_FINALIZED':observation.reason;
   if(['PROVIDER_UNAVAILABLE','INVALID_PREPARED','PROOF_REJECTED'].includes(reason)){report.unavailable++;note(report,'RECONCILIATION_UNAVAILABLE');}
   if(current.state!=='CONFIRMED'&&current.state!=='FAILED')await unknown(current,reason,report);
   else{report.unknown++;note(report,reason);}
  }
 }
 async function process(item:QueueItem,report:DriverSettlementTickResult,signal?:AbortSignal) {
  assertQueueIdentity(item,config);
  // Establish availability BEFORE funding allocation or signing. An unavailable factory never sends.
  const adapter=provider();let attemptId=item.attemptId;
  if((item.state==='RESERVED'||item.state==='SIGNING')&&item.readiness==='SOURCE_RECONCILIATION_REQUIRED')throw new Error('SOURCE_RECONCILIATION_REQUIRED');
  if(item.state==='RESERVED'){
   if(!item.providerAvailable||item.beneficiaryState!=='VERIFIED')throw new SettlementBoundaryError('PROVIDER_UNAVAILABLE');
   const registered=await resolveAsset(item.asset.assetId);
   if(!registered||!same(registered,item.asset))throw new SettlementBoundaryError('ASSET_UNAVAILABLE');
   const funding=item.fundingEvidence.find(entry=>entry.remaining.currency===item.payoutMoney.currency&&BigInt(entry.remaining.amountMinor)>=BigInt(item.payoutMoney.amountMinor));
   if(!funding){report.unavailable++;note(report,'VERIFIED_FUNDING_REQUIRED');return;}
   if(signal?.aborted)return;
   const reply=parse(z.object({kind:z.literal('ATTEMPT_ALLOCATED'),attemptId:uuid,batchId:uuid}).passthrough(),await sqlCall(transaction,'prepare',[item.batchId,command('allocate',item.batchId,{kind:'ALLOCATE',expectedVersion:item.batchVersion,beneficiaryVersion:item.beneficiaryVersion,configId:item.configId,configVersion:item.configVersion,fundingEvidenceId:funding.evidenceId})]));
   if(reply.batchId!==item.batchId)throw new SettlementBoundaryError('IDENTITY_CONFLICT');
   attemptId=reply.attemptId;report.allocated++;
  }
  if(!attemptId)throw new SettlementBoundaryError('INVALID_SQL_RESULT');
  let current=await snapshot(attemptId);assertSnapshotIdentity(current,item);
  if(signal?.aborted)return;
  if(current.state==='SIGNING'){
   if(!item.providerAvailable||item.beneficiaryState!=='VERIFIED'||!['AWAITING_SIGNATURE','VERIFIED_FUNDING_REQUIRED'].includes(item.readiness))throw new SettlementBoundaryError('PROVIDER_UNAVAILABLE');
   // SQL immutable config and the real registry are checked again by provider.prepare before loading keys.
   const signed=assertPrepared(await adapter.prepare({attemptId:current.attemptId,batchId:current.batchId,beneficiaryOwner:current.recipientPublicKey,amountMinor:current.payoutMoney.amountMinor,asset:current.asset}),current,config.provider);
   if(signal?.aborted)return; // Signed but unsent: not durable and NEVER broadcast.
   const payload=command('persist-signed',current.batchId,{kind:'PERSIST_SIGNED',expectedVersion:current.batchVersion,attemptId:current.attemptId,expectedAttemptVersion:current.attemptVersion,prepared:signed,signedVerificationHash:digest(canonical(['BitPOS/Settlement088/PreparedAttestation/v1',config.adapterVersion,signed]))});
   await sqlCall(transaction,'prepare',[current.batchId,payload]);report.prepared++;
   // Always recover bytes from SQL, even when this process originally signed them.
   current=await snapshot(attemptId);assertSnapshotIdentity(current,item);
  }
  if(signal?.aborted)return;
  const prepared=assertPrepared(current.prepared,current,config.provider);
  // This is also required for PREPARED: it covers another process' send and ambiguous submission commits.
  const observation=await adapter.reconcile(prepared);if(signal?.aborted)return;
  if(observation.status==='FINALIZED'||observation.status==='FAILED'){await recordOutcome(current,observation,report);return;}
  if(current.state==='FAILED'||current.state==='CONFIRMED'){report.alreadyRecorded++;return;}
  if(observation.status==='CONFIRMED'){await unknown(current,'NOT_FINALIZED',report);return;}
  if(observation.reason!=='HISTORY_UNAVAILABLE'){
   await unknown(current,observation.reason,report);
   if(['PROVIDER_UNAVAILABLE','INVALID_PREPARED','PROOF_REJECTED'].includes(observation.reason)){report.unavailable++;note(report,'RECONCILIATION_UNAVAILABLE');}
   return;
  }
  if(item.readiness==='SOURCE_RECONCILIATION_REQUIRED'){await unknown(current,'SOURCE_RECONCILIATION_REQUIRED',report);report.unavailable++;return;}
  if(!item.providerAvailable){await unknown(current,'PROVIDER_UNAVAILABLE',report);report.unavailable++;return;}
  // No observed transfer is NOT failure. It permits only an exact-byte retry, never replacement/signing.
  const ready=parse(z.object({kind:z.literal('EXACT_BYTES_READY'),attemptId:uuid,attemptVersion:integer,batchId:uuid,batchVersion:integer,state:z.enum(['SUBMITTED','UNKNOWN']),transactionId:z.string(),signedBytesHash:hash,signedBytesBase64:z.string(),prepared:preparedSchema,broadcastOnlyAfterCommit:z.literal(true),fundsTransferred:z.literal(false)}).strict(),await sqlCall(transaction,'submission',[current.attemptId,command('submission',current.attemptId,{expectedVersion:current.attemptVersion,signedBytesHash:prepared.signedBytesSha256})]));
  report.submissionCommitted++;
  if(ready.attemptId!==current.attemptId||ready.batchId!==current.batchId||ready.transactionId!==prepared.signature||ready.signedBytesHash!==prepared.signedBytesSha256||!same(ready.prepared,prepared))throw new SettlementBoundaryError('IDENTITY_CONFLICT');
  // PostgreSQL encode(bytea,'base64') inserts newlines. Decode only its transport wrapper;
  // prepared.signedBase64 remains the exact persisted canonical provider object.
  const returnedBytes=Buffer.from(ready.signedBytesBase64,'base64'),persistedBytes=Buffer.from(prepared.signedBase64,'base64');
  if(!returnedBytes.equals(persistedBytes))throw new SettlementBoundaryError('INVALID_PREPARED');
  if(signal?.aborted)return;
  const sent=await adapter.broadcast(ready.prepared);
  if(sent.signature!==prepared.signature)throw new SettlementBoundaryError('IDENTITY_CONFLICT');
  if(sent.status==='SUBMITTED'){report.broadcastSubmitted++;return;}
  current=await snapshot(current.attemptId); // Fresh CAS after possible concurrent reconciliation.
  if(sent.status==='UNKNOWN'){report.broadcastUnknown++;await unknown(current,'SUBMISSION_AMBIGUOUS',report);return;}
  report.notBroadcast++;await unknown(current,sent.reason,report);
  if(sent.reason==='PROVIDER_UNAVAILABLE'||sent.reason==='INVALID_PREPARED'){report.unavailable++;note(report,'BROADCAST_UNAVAILABLE');}
 }
 async function guarded(run:(report:DriverSettlementTickResult)=>Promise<void>,signal?:AbortSignal) {
  if(running)return result('BUSY');const report=result();if(signal?.aborted)return result('ABORTED');running=true;
  try{await run(report);}catch(error){recordError(report,error);}finally{running=false;}
  return finish(report,signal);
 }
 return {
  tick:signal=>guarded(async report=>{
   // Availability is truthful even with an empty queue. No signing or RPC occurs in the factory.
   provider();
   // Each page is a committed discovery snapshot, not a lock/lease held across external IO.
   try {
    const page=parse(queueSchema,await sqlCall(transaction,'queue',[batchCursor]));
    const items=page.items.slice(0,config.maxBatchesPerTick);report.discovered+=items.length;
    for(const item of items){if(signal?.aborted)break;report.processed++;try{await process(item,report,signal);}catch(error){recordError(report,error);}}
    if(!signal?.aborted)batchCursor=items.length<page.items.length?items.at(-1)!.batchId:page.nextAfterId;
   }catch(error){recordError(report,error);}
   if(signal?.aborted)return;
   // No time window: a released attempt can receive a late success arbitrarily far in the future.
   try {
    const page=parse(terminalQueueSchema,await sqlCall(transaction,'terminalQueue',[terminalCursor]));
    const items=page.items.slice(0,config.maxTerminalAttemptsPerTick);report.discovered+=items.length;
    for(const item of items){if(signal?.aborted)break;report.processed++;try{await reconcileOnly(item.attemptId,report,signal);}catch(error){recordError(report,error);}}
    if(!signal?.aborted)terminalCursor=items.length<page.items.length?items.at(-1)!.attemptId:page.nextAfterId;
   }catch(error){recordError(report,error);}
  },signal),
  reconcileAttempts:(attemptIds,signal)=>guarded(async report=>{
   const ids=parse(z.array(uuid).max(50),[...attemptIds]);
   for(const id of new Set(ids)){if(signal?.aborted)break;report.discovered++;report.processed++;try{await reconcileOnly(id,report,signal);}catch(error){recordError(report,error);}}
  },signal),
 };
}
