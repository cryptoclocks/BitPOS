import pg from 'pg';
import {Keypair} from '@solana/web3.js';
import {readFile,realpath,stat} from 'node:fs/promises';
import {isAbsolute,relative,sep} from 'node:path';
import {z} from 'zod';
import {createRpcConnection} from '../../api/src/rpc-resilience';
import {USDG_ASSET} from '../../../packages/domain/src/payment-assets';
import {pool,tenant,audit} from '../../api/src/db';
import {ownerRefundPolicy} from '../../api/src/order-refund-policy';
import {createPayoutProvider,payoutPreparedSchema} from './payout-provider';
import type {PayoutProvider,PayoutProviderDeps,PreparedPayout,ReconcilePayoutResult} from './payout-provider';
import {executeFoodRefundAttempt} from './food-refund-execution';
import type {RefundExecutionSnapshot,RefundExecutionStore} from './food-refund-execution';

// REAL (devnet) refunds of paid counter/table wallet orders. Reuses the vetted exact-bytes payout provider and execution coordinator of the food refunds; only the
// durable store is different (order_refunds, migration 196). Startup is opt-in (BITPOS_STORE_REFUND_ENABLED=1) and needs the shop treasury's key as an owner-only file
// OUTSIDE the working tree; the refund is refused unless the key's public address equals the refund row's source (= the shop's treasury). Importing this file touches
// no key, database or RPC.
// OWNER-SIGNED refunds (default; migration 198) need NO key here: the shop owner signed the exact transaction in their own wallet and the API stored the bytes. This lane only
// broadcasts those exact bytes and reconciles them against chain history (provider.prepare is never called for them). Turn it off with BITPOS_STORE_REFUND_OWNER_SIGNED=0.
const owner=z.string().min(32).max(44);
const publicConfig=z.object({sourceOwner:owner,feePayerOwner:owner,allowedAssetIds:z.array(z.string().min(1).max(64)).min(1).max(4),maxAmountMinor:z.string().regex(/^[1-9][0-9]{0,18}$/),
 maxFeeLamports:z.number().int().min(1).max(1_000_000),maxTotalLamports:z.number().int().min(1).max(10_000_000),maxAttemptsPerTick:z.number().int().min(1).max(10).default(3)}).strict();
export type StoreRefundPublicConfig=z.infer<typeof publicConfig>;
export interface StoreRefundTickResult{status:'AVAILABLE'|'UNAVAILABLE'|'ABORTED';processed:number;outcomes:Record<string,number>}
export interface StoreRefundWorker{tick:(signal?:AbortSignal)=>Promise<StoreRefundTickResult>}
export interface StoreRefundWorkItem{merchantId:string;id:string;mode?:'server'|'owner';sourceOwner?:string;amountMinor?:string}
const disabled:StoreRefundWorker={tick:async()=>({status:'UNAVAILABLE',processed:0,outcomes:{NOT_CONFIGURED:1}})};
type Row={id:string;order_id:string;payment_id:string;state:RefundExecutionSnapshot['state'];version:string;amount_minor:string;beneficiary_owner:string;source_owner:string;prepared:unknown};

/** Durable store for one shop. Every operation is one tenant transaction; version-checked so a lost race changes nothing. */
export function createOrderRefundStore(merchant:string,config:StoreRefundPublicConfig):RefundExecutionStore{
 const cols='id,order_id,payment_id,state,version::text,amount_minor::text,beneficiary_owner,source_owner,prepared';
 const snap=(r:Row):RefundExecutionSnapshot=>{
  if(r.source_owner!==config.sourceOwner)throw Error('STORE_REFUND_SOURCE_MISMATCH');
  return {attemptId:r.id,caseId:r.order_id,paymentId:r.payment_id,version:r.version,state:r.state,amountMinor:r.amount_minor,asset:USDG_ASSET,beneficiaryOwner:r.beneficiary_owner,sourceOwner:r.source_owner,feePayerOwner:config.feePayerOwner,
   fundingReservationId:r.id,fundingAvailable:true,maxFeeLamports:config.maxFeeLamports,maxTotalLamports:config.maxTotalLamports,prepared:r.prepared===null||r.prepared===undefined?null:payoutPreparedSchema.parse(r.prepared) as PreparedPayout};
 };
 const read=async(db:pg.PoolClient,id:string,lock=false)=>{const r=(await db.query<Row>(`SELECT ${cols} FROM order_refunds WHERE merchant_id=$1 AND id=$2${lock?' FOR UPDATE':''}`,[merchant,id])).rows[0];if(!r)throw Error('REFUND_NOT_FOUND');return r;};
 return {
  snapshot:id=>tenant(merchant,async db=>snap(await read(db,id))),
  async persistPrepared(s,prepared){
   return tenant(merchant,async db=>{
    const r=await db.query("UPDATE order_refunds SET state='PREPARED',prepared=$3::jsonb,signature=$4,version=version+1,updated_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2 AND state='SIGNING' AND version=$5::bigint",[merchant,s.attemptId,JSON.stringify(prepared),prepared.signature,s.version]);
    return r.rowCount===1;
   });
  },
  async authorizeSubmission(s){
   return tenant(merchant,async db=>{
    const r=await read(db,s.attemptId,true);
    if(!['PREPARED','UNKNOWN'].includes(r.state)||r.prepared===null||r.version!==s.version)return null;
    await db.query('UPDATE order_refunds SET submitted_at=coalesce(submitted_at,clock_timestamp()),version=version+1,updated_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2',[merchant,s.attemptId]);
    return snap(await read(db,s.attemptId));
   });
  },
  async recordUnknown(s,reason){
   await tenant(merchant,db=>db.query("UPDATE order_refunds SET state='UNKNOWN',last_reason=$3,attempts=attempts+1,version=version+1,updated_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2 AND state IN('PREPARED','UNKNOWN')",[merchant,s.attemptId,reason.slice(0,120)]));
  },
  async recordVerified(s,observation:Extract<ReconcilePayoutResult,{status:'FINALIZED'|'FAILED'}>){
   await tenant(merchant,async db=>{
    const r=await read(db,s.attemptId,true);
    const terminal=observation.status==='FINALIZED'?'FINALIZED':'FAILED';
    if(r.state===terminal)return; // the same observation again
    if(r.state==='FINALIZED'||r.state==='FAILED')throw Error('REFUND_CONTRADICTORY_TERMINAL');
    const evidence=observation.status==='FINALIZED'?observation.receipt.evidence:observation.evidence,digest=observation.status==='FINALIZED'?observation.receipt.digest:observation.digest;
    await db.query("UPDATE order_refunds SET state=$3,evidence=$4::jsonb,evidence_digest=$5,finalized_at=CASE WHEN $3='FINALIZED' THEN clock_timestamp() END,version=version+1,updated_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2",[merchant,s.attemptId,terminal,JSON.stringify(evidence),digest]);
    await audit(db,merchant,'system:refund-worker',terminal==='FINALIZED'?'order.refund.finalized':'order.refund.failed',r.order_id);
   });
  },
 };
}

export function createStoreRefundWorker(config:StoreRefundPublicConfig,provider:PayoutProvider,db:{work:(limit:number)=>Promise<StoreRefundWorkItem[]>}):StoreRefundWorker{
 return {async tick(signal){
  if(provider.kind!=='ready')return {status:'UNAVAILABLE',processed:0,outcomes:{PROVIDER_UNAVAILABLE:1}};
  const items=(await db.work(config.maxAttemptsPerTick)).filter(item=>(item.mode??'server')==='server'),outcomes:Record<string,number>={};let processed=0;
  for(const item of items){
   if(signal?.aborted)return {status:'ABORTED',processed,outcomes};
   let outcome:string;
   try{outcome=await executeFoodRefundAttempt(createOrderRefundStore(item.merchantId,config),provider,item.id,signal);}
   catch(error){
    outcome='ERROR';
    const code=(error as {code?:string}).code??(error instanceof Error?error.message:'ERROR');
    // a failed preparation (e.g. not enough funds) stays queued and visible; nothing was signed
    await tenant(item.merchantId,db=>db.query("UPDATE order_refunds SET last_reason=$3,attempts=attempts+1,updated_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2 AND state IN('SIGNING','PREPARED','UNKNOWN')",[item.merchantId,item.id,String(code).slice(0,120)])).catch(()=>undefined);
   }
   outcomes[outcome]=(outcomes[outcome]??0)+1;processed+=1;
  }
  return {status:'AVAILABLE',processed,outcomes};
 }};
}

/** Keyless lane for owner-signed refunds: one pure provider per refund (its treasury is the policy's source and fee payer), reconcile/broadcast only. */
export function createOwnerSignedRefundWorker(connection:PayoutProviderDeps['connection'],db:{work:(limit:number)=>Promise<StoreRefundWorkItem[]>},maxPerTick=3):StoreRefundWorker{
 return {async tick(signal){
  const items=(await db.work(maxPerTick)).filter(item=>item.mode==='owner'&&item.sourceOwner&&item.amountMinor),outcomes:Record<string,number>={};let processed=0;
  for(const item of items){
   if(signal?.aborted)return {status:'ABORTED',processed,outcomes};
   let outcome:string;
   try{
    const policy=ownerRefundPolicy(item.sourceOwner!,item.amountMinor!);
    const config:StoreRefundPublicConfig={...policy,maxAttemptsPerTick:maxPerTick};
    const deps:PayoutProviderDeps={connection,resolveAsset:async id=>id===USDG_ASSET.assetId?USDG_ASSET:null,loadSigningKeys:async()=>{throw Error('OWNER_SIGNED_NO_SERVER_KEY');}};
    const provider=createPayoutProvider({kind:'solana-devnet',...policy},deps);
    outcome=await executeFoodRefundAttempt(createOrderRefundStore(item.merchantId,config),provider,item.id,signal);
   }catch(error){
    outcome='ERROR';
    const code=(error as {code?:string}).code??(error instanceof Error?error.message:'ERROR');
    await tenant(item.merchantId,db2=>db2.query("UPDATE order_refunds SET last_reason=$3,attempts=attempts+1,updated_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2 AND state IN('PREPARED','UNKNOWN')",[item.merchantId,item.id,String(code).slice(0,120)])).catch(()=>undefined);
   }
   outcomes[outcome]=(outcomes[outcome]??0)+1;processed+=1;
  }
  return {status:'AVAILABLE',processed,outcomes};
 }};
}
function validRpc(rpc:string){
 try{const url=new URL(rpc);if(url.username||url.password||!['http:','https:'].includes(url.protocol)||url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error();}catch{throw Error('STORE_REFUND_RPC_CONFIGURATION_INVALID');}
}
const workRows=(mode:'server'|'owner')=>async(limit:number)=>{const r=await pool.query('SELECT bitpos.order_refund_work($1,$2) value',[limit,mode]);return z.array(z.object({merchantId:z.string().uuid(),id:z.string().uuid(),mode:z.enum(['server','owner']).default('server'),sourceOwner:owner.optional(),amountMinor:z.string().regex(/^[1-9][0-9]{0,18}$/).optional()})).parse(r.rows[0].value) as StoreRefundWorkItem[];};
const merge=(a:StoreRefundTickResult,b:StoreRefundTickResult):StoreRefundTickResult=>{const outcomes:Record<string,number>={...a.outcomes};for(const [k,v] of Object.entries(b.outcomes))outcomes[k]=(outcomes[k]??0)+v;return {status:a.status==='ABORTED'||b.status==='ABORTED'?'ABORTED':a.status==='AVAILABLE'||b.status==='AVAILABLE'?'AVAILABLE':'UNAVAILABLE',processed:a.processed+b.processed,outcomes};};

export function createStoreRefundRuntime(env:NodeJS.ProcessEnv=process.env){
 const serverEnabled=env.BITPOS_STORE_REFUND_ENABLED==='1',ownerEnabled=env.BITPOS_STORE_REFUND_OWNER_SIGNED!=='0';
 if(!serverEnabled&&!ownerEnabled)return {worker:disabled,close:async()=>{}};
 let serverWorker:StoreRefundWorker=disabled;
 if(serverEnabled){
  let config:StoreRefundPublicConfig;
  try{config=publicConfig.parse(JSON.parse(env.BITPOS_STORE_REFUND_PUBLIC_CONFIG??''));}catch{throw Error('STORE_REFUND_PUBLIC_CONFIGURATION_INVALID');}
  if(config.allowedAssetIds.some(id=>id!==USDG_ASSET.assetId))throw Error('STORE_REFUND_PUBLIC_CONFIGURATION_INVALID');
  const rpc=env.BITPOS_STORE_REFUND_RPC_URL,sourcePath=env.BITPOS_STORE_REFUND_SOURCE_KEY_PATH,feePath=env.BITPOS_STORE_REFUND_FEE_PAYER_KEY_PATH??sourcePath;
  if(!rpc||!sourcePath||!feePath||!isAbsolute(sourcePath)||!isAbsolute(feePath))throw Error('STORE_REFUND_PRIVATE_CONFIGURATION_REQUIRED');
  validRpc(rpc);
  const connection=createRpcConnection(rpc,'confirmed');
  async function load(path:string,expected:string){
   const [canonical,root]=await Promise.all([realpath(path),realpath(process.cwd())]),inside=relative(root,canonical);
   if(inside.split(sep)[0]!=='..')throw Error('STORE_REFUND_PRIVATE_KEY_LOCATION_INVALID');
   const info=await stat(canonical);if(!info.isFile()||info.size>4096||(info.mode&0o077)!==0)throw Error('STORE_REFUND_PRIVATE_KEY_PERMISSIONS_INVALID');
   let bytes:unknown;try{bytes=JSON.parse(await readFile(canonical,'utf8'));}catch{throw Error('STORE_REFUND_SIGNER_UNAVAILABLE');}
   if(!Array.isArray(bytes)||bytes.length!==64||bytes.some(v=>!Number.isInteger(v)||v<0||v>255))throw Error('STORE_REFUND_SIGNER_UNAVAILABLE');
   let key:Keypair;try{key=Keypair.fromSecretKey(Uint8Array.from(bytes));}catch{throw Error('STORE_REFUND_SIGNER_UNAVAILABLE');}
   if(key.publicKey.toBase58()!==expected)throw Error('STORE_REFUND_SIGNER_IDENTITY_MISMATCH');
   return key;
  }
  const deps:PayoutProviderDeps={connection,resolveAsset:async id=>id===USDG_ASSET.assetId?USDG_ASSET:null,loadSigningKeys:async()=>{const source=await load(sourcePath,config.sourceOwner),feePayer=sourcePath===feePath?source:await load(feePath,config.feePayerOwner);return {source,feePayer};}};
  const provider=createPayoutProvider({kind:'solana-devnet',sourceOwner:config.sourceOwner,feePayerOwner:config.feePayerOwner,allowedAssetIds:config.allowedAssetIds,maxAmountMinor:config.maxAmountMinor,maxFeeLamports:config.maxFeeLamports,maxTotalLamports:config.maxTotalLamports},deps);
  serverWorker=createStoreRefundWorker(config,provider,{work:workRows('server')});
 }
 let ownerWorker:StoreRefundWorker|null=null;
 if(ownerEnabled){
  const rpc=env.BITPOS_STORE_REFUND_RPC_URL??env.SOLANA_RPC??'https://api.devnet.solana.com';validRpc(rpc);
  ownerWorker=createOwnerSignedRefundWorker(createRpcConnection(rpc,'confirmed'),{work:workRows('owner')});
 }
 const idle:StoreRefundTickResult={status:'UNAVAILABLE',processed:0,outcomes:{}};
 const worker:StoreRefundWorker={async tick(signal){
  const a=serverEnabled?await serverWorker.tick(signal):idle,b=ownerWorker?await ownerWorker.tick(signal):idle;
  return merge(a,b);
 }};
 return {worker,close:async()=>{}};
}
