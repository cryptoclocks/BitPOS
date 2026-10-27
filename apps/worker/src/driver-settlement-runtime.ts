import pg from 'pg';import {Connection,Keypair} from '@solana/web3.js';import {readFile,realpath,stat} from 'node:fs/promises';import {isAbsolute,relative,sep} from 'node:path';
import {createDriverSettlementWorker,createDriverSettlementTransaction,readDriverSettlementConfig} from './driver-settlement';

/** Startup is opt-in; importing this file never accesses files, DBs, keys or RPC. */
export function createDriverSettlementRuntime(env:NodeJS.ProcessEnv=process.env){
 if(env.BITPOS_SETTLEMENT_ENABLED!=='1')return {worker:createDriverSettlementWorker(),close:async()=>{}};
 let config:ReturnType<typeof readDriverSettlementConfig>;
 try{config=readDriverSettlementConfig(JSON.parse(env.BITPOS_SETTLEMENT_PUBLIC_CONFIG??''));}catch{throw Error('SETTLEMENT_PUBLIC_CONFIGURATION_INVALID');}
 if(config.kind!=='enabled')throw Error('SETTLEMENT_PUBLIC_CONFIGURATION_INVALID');
 const database=env.BITPOS_SETTLEMENT_WORKER_DATABASE_URL,rpc=env.BITPOS_SETTLEMENT_RPC_URL,sourcePath=env.BITPOS_SETTLEMENT_SOURCE_KEY_PATH,feePath=env.BITPOS_SETTLEMENT_FEE_PAYER_KEY_PATH;
 if(!database||!rpc||!sourcePath||!feePath||!isAbsolute(sourcePath)||!isAbsolute(feePath))throw Error('SETTLEMENT_PRIVATE_CONFIGURATION_REQUIRED');
 try{const url=new URL(rpc);if(!['http:','https:'].includes(url.protocol)||url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error();}catch{throw Error('SETTLEMENT_RPC_CONFIGURATION_INVALID');}
 const pool=new pg.Pool({connectionString:database,max:2,connectionTimeoutMillis:2000}),connection=new Connection(rpc,'confirmed');
 async function load(path:string){
  const [canonical,root]=await Promise.all([realpath(path),realpath(process.cwd())]),inside=relative(root,canonical);
  if(inside.split(sep)[0]!=='..')throw Error('SETTLEMENT_PRIVATE_KEY_LOCATION_INVALID');
  const info=await stat(canonical);if(!info.isFile()||info.size>4096||(info.mode&0o077)!==0)throw Error('SETTLEMENT_PRIVATE_KEY_PERMISSIONS_INVALID');
  let bytes:unknown;try{bytes=JSON.parse(await readFile(canonical,'utf8'));}catch{throw Error('SETTLEMENT_SIGNER_UNAVAILABLE');}
  if(!Array.isArray(bytes)||bytes.length!==64||bytes.some(value=>!Number.isInteger(value)||value<0||value>255))throw Error('SETTLEMENT_SIGNER_UNAVAILABLE');
  try{return Keypair.fromSecretKey(Uint8Array.from(bytes));}catch{throw Error('SETTLEMENT_SIGNER_UNAVAILABLE');}
 }
 const worker=createDriverSettlementWorker(config,{transaction:createDriverSettlementTransaction(pool),providerDeps:{connection,loadSigningKeys:async()=>{const source=await load(sourcePath),feePayer=sourcePath===feePath?source:await load(feePath);return {source,feePayer};}}});
 return {worker,close:()=>pool.end()};
}
