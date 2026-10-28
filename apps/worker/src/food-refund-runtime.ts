import pg from 'pg';import {Keypair} from '@solana/web3.js';
import {createRpcConnection} from '../../api/src/rpc-resilience';import {readFile,realpath,stat} from 'node:fs/promises';import {isAbsolute,relative,sep} from 'node:path';
import {z} from 'zod';
import {USDG_ASSET} from '../../../packages/domain/src/payment-assets';
import {createFoodRefundSqlStore,createRefundSqlTransaction} from './food-refund-store';
import type {RefundSqlTransaction} from './food-refund-store';
import {executeFoodRefundAttempt} from './food-refund-execution';
import {createPayoutProvider} from './payout-provider';
import type {PayoutProvider,PayoutProviderDeps} from './payout-provider';

const owner=z.string().min(32).max(44);
const publicConfig=z.object({
 sourceOwner:owner,feePayerOwner:owner,allowedAssetIds:z.array(z.string().min(1).max(64)).min(1).max(4),
 maxAmountMinor:z.string().regex(/^[1-9][0-9]{0,18}$/),maxFeeLamports:z.number().int().min(1).max(1_000_000),maxTotalLamports:z.number().int().min(1).max(10_000_000),
 maxAttemptsPerTick:z.number().int().min(1).max(10).default(3),
}).strict();
export type FoodRefundPublicConfig=z.infer<typeof publicConfig>;
export interface FoodRefundTickResult{status:'AVAILABLE'|'UNAVAILABLE'|'ABORTED';processed:number;outcomes:Record<string,number>;}
export interface FoodRefundWorker{tick:(signal?:AbortSignal)=>Promise<FoodRefundTickResult>;}
const disabled:FoodRefundWorker={tick:async()=>({status:'UNAVAILABLE',processed:0,outcomes:{NOT_CONFIGURED:1}})};

/** Drives only attempts the SQL work function lists. Every money step stays inside executeFoodRefundAttempt:
 * funding/fee reservations, exact-byte submission claim, finalized chain verification and the receipt ledger. */
export function createFoodRefundWorker(config:FoodRefundPublicConfig,deps:{transaction:RefundSqlTransaction;provider:PayoutProvider}):FoodRefundWorker{
 const store=createFoodRefundSqlStore(deps.transaction,{receipts:'112',submission:'114'});
 return{async tick(signal){
  if(deps.provider.kind!=='ready')return{status:'UNAVAILABLE',processed:0,outcomes:{PROVIDER_UNAVAILABLE:1}};
  const ids=z.array(z.string().uuid()).parse(await deps.transaction(async db=>{
   const result=await db.query('SELECT bitpos.food_refund161_work($1) value',[config.maxAttemptsPerTick]);
   if(result.rows.length!==1)throw Error('REFUND_WORK_INVALID');return result.rows[0].value;
  }));
  const outcomes:Record<string,number>={};let processed=0;
  for(const id of ids){
   if(signal?.aborted)return{status:'ABORTED',processed,outcomes};
   let outcome:string;
   try{outcome=await executeFoodRefundAttempt(store,deps.provider,id,signal);}catch{outcome='ERROR';}
   outcomes[outcome]=(outcomes[outcome]??0)+1;processed+=1;
  }
  return{status:'AVAILABLE',processed,outcomes};
 }};
}

/** Startup is opt-in; importing this file never accesses files, DBs, keys or RPC. Keys must live outside the
 * working tree with owner-only permissions, and the database login must be the restricted refund worker. */
export function createFoodRefundRuntime(env:NodeJS.ProcessEnv=process.env){
 if(env.BITPOS_FOOD_REFUND_ENABLED!=='1')return{worker:disabled,close:async()=>{}};
 let config:FoodRefundPublicConfig;
 try{config=publicConfig.parse(JSON.parse(env.BITPOS_FOOD_REFUND_PUBLIC_CONFIG??''));}catch{throw Error('FOOD_REFUND_PUBLIC_CONFIGURATION_INVALID');}
 if(config.allowedAssetIds.some(id=>id!==USDG_ASSET.assetId))throw Error('FOOD_REFUND_PUBLIC_CONFIGURATION_INVALID');
 const database=env.BITPOS_FOOD_REFUND_WORKER_DATABASE_URL,rpc=env.BITPOS_FOOD_REFUND_RPC_URL,sourcePath=env.BITPOS_FOOD_REFUND_SOURCE_KEY_PATH,feePath=env.BITPOS_FOOD_REFUND_FEE_PAYER_KEY_PATH;
 if(!database||!rpc||!sourcePath||!feePath||!isAbsolute(sourcePath)||!isAbsolute(feePath))throw Error('FOOD_REFUND_PRIVATE_CONFIGURATION_REQUIRED');
 try{const url=new URL(rpc);if(url.username||url.password||!['http:','https:'].includes(url.protocol)||url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error();}catch{throw Error('FOOD_REFUND_RPC_CONFIGURATION_INVALID');}
 const pool=new pg.Pool({connectionString:database,max:2,connectionTimeoutMillis:2000}),connection=createRpcConnection(rpc,'confirmed');
 async function load(path:string){
  const [canonical,root]=await Promise.all([realpath(path),realpath(process.cwd())]),inside=relative(root,canonical);
  if(inside.split(sep)[0]!=='..')throw Error('FOOD_REFUND_PRIVATE_KEY_LOCATION_INVALID');
  const info=await stat(canonical);if(!info.isFile()||info.size>4096||(info.mode&0o077)!==0)throw Error('FOOD_REFUND_PRIVATE_KEY_PERMISSIONS_INVALID');
  let bytes:unknown;try{bytes=JSON.parse(await readFile(canonical,'utf8'));}catch{throw Error('FOOD_REFUND_SIGNER_UNAVAILABLE');}
  if(!Array.isArray(bytes)||bytes.length!==64||bytes.some(value=>!Number.isInteger(value)||value<0||value>255))throw Error('FOOD_REFUND_SIGNER_UNAVAILABLE');
  try{return Keypair.fromSecretKey(Uint8Array.from(bytes));}catch{throw Error('FOOD_REFUND_SIGNER_UNAVAILABLE');}
 }
 const deps:PayoutProviderDeps={connection,resolveAsset:async id=>id===USDG_ASSET.assetId?USDG_ASSET:null,loadSigningKeys:async()=>{const source=await load(sourcePath),feePayer=sourcePath===feePath?source:await load(feePath);return{source,feePayer};}};
 const provider=createPayoutProvider({kind:'solana-devnet',sourceOwner:config.sourceOwner,feePayerOwner:config.feePayerOwner,allowedAssetIds:config.allowedAssetIds,maxAmountMinor:config.maxAmountMinor,maxFeeLamports:config.maxFeeLamports,maxTotalLamports:config.maxTotalLamports},deps);
 return{worker:createFoodRefundWorker(config,{transaction:createRefundSqlTransaction(pool),provider}),close:()=>pool.end()};
}
