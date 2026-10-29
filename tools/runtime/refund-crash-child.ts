import pg from 'pg';import{writeSync}from'node:fs';import{createHash}from'node:crypto';
import{createFoodRefundSqlStore,createRefundSqlTransaction}from'../../apps/worker/src/food-refund-store';
import{executeFoodRefundAttempt}from'../../apps/worker/src/food-refund-execution';
import type{ReadyPayoutProvider}from'../../apps/worker/src/payout-provider';
const [database,attempt,mode]=process.argv.slice(2);
if(!/^bitpos_refund_commit_[a-f0-9]{12}$/.test(database)||!/^[a-f0-9-]{36}$/.test(attempt)||!['exit-after-send','recover'].includes(mode))throw Error('Invalid private child target');
const pool=new pg.Pool({host:'127.0.0.1',port:55446,database,user:'bitpos_refund110_fixture',max:1});
try{
 const store=createFoodRefundSqlStore(createRefundSqlTransaction(pool),{receipts:'112',submission:'114'});
 const provider:ReadyPayoutProvider={kind:'ready',prepare:async()=>{throw Error('Persisted attempt must never sign again');},reconcile:async p=>({status:'UNKNOWN',signature:p.signature,reason:'HISTORY_UNAVAILABLE'}),broadcast:async p=>{
  // Local transport receipt only: no network call, keys or actual transfer.
  writeSync(1,JSON.stringify({event:'OFFLINE_SEND_OBSERVED',signature:p.signature,bytesHash:createHash('sha256').update(Buffer.from(p.signedBase64,'base64')).digest('hex')})+'\n');
  if(mode==='exit-after-send')process.exit(86); // Own child exits without finally/result recording.
  return{status:'SUBMITTED',signature:p.signature};
 }};
 const result=await executeFoodRefundAttempt(store,provider,attempt);if(result!=='SUBMITTED')throw Error('Unexpected recovery outcome');writeSync(1,'RECOVERED_EXACT_ORIGINAL_ATTEMPT\n');
}finally{await pool.end();}
