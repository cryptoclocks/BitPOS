import pg from 'pg';
import {createRpcConnection} from '../../api/src/rpc-resilience';
import {createSettlementFundingRecorder} from './settlement-funding';
import {createDriverSettlementTransaction} from './driver-settlement';
import type {PayoutProviderDeps} from './payout-provider';
/** Private operator ingestion only. No dotenv, signer, balance fallback or send dependency. */
export function createSettlementFundingRuntime(env:NodeJS.ProcessEnv=process.env,transport?:PayoutProviderDeps['connection']){
 if(env.BITPOS_SETTLEMENT_FUNDING_ENABLED!=='1')return {recorder:createSettlementFundingRecorder(),close:async()=>{}};
 const database=env.BITPOS_SETTLEMENT_FUNDING_DATABASE_URL,rpc=env.BITPOS_SETTLEMENT_RPC_URL;
 if(!database||!rpc)throw Error('SETTLEMENT_FUNDING_CONFIGURATION_REQUIRED');
 try{const url=new URL(rpc);if(url.username||url.password||!['http:','https:'].includes(url.protocol)||url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error();}catch{throw Error('SETTLEMENT_RPC_CONFIGURATION_INVALID');}
 const pool=new pg.Pool({connectionString:database,max:2,connectionTimeoutMillis:2000});
 return {recorder:createSettlementFundingRecorder({transaction:createDriverSettlementTransaction(pool),connection:transport??createRpcConnection(rpc,'finalized')}),close:()=>pool.end()};
}
