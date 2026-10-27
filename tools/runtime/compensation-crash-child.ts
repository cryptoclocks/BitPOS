import pg from 'pg';
import assert from 'node:assert/strict';
import {createCompensationSqlStore,createCompensationSqlTransaction} from '../../apps/worker/src/food-compensation-store';
import {executeFoodCompensation} from '../../apps/worker/src/food-compensation-execution';
import type {ReadyPayoutProvider} from '../../apps/worker/src/payout-provider';
const [database,attempt,mode]=process.argv.slice(2);
if(!/^bitpos_refund_commit_[a-f0-9]{12}$/.test(database??'')||!attempt||!['exit-after-send','recover'].includes(mode))throw Error('Private compensation crash fixture only');
const pool=new pg.Pool({host:'127.0.0.1',port:55446,database,user:'bitpos_compensation128_fixture',max:1});
const store=createCompensationSqlStore(createCompensationSqlTransaction(pool));
let sent=false;
const provider:ReadyPayoutProvider={kind:'ready',prepare:async()=>{throw Error('Recovery must not sign');},reconcile:async prepared=>({status:'UNKNOWN',signature:prepared.signature,reason:'HISTORY_UNAVAILABLE'}),broadcast:async prepared=>{
 sent=true;const event={event:'OFFLINE_COMPENSATION_SEND',signedBytesSha256:prepared.signedBytesSha256,signature:prepared.signature};
 await new Promise<void>((resolve,reject)=>process.stdout.write(JSON.stringify(event)+'\n',error=>error?reject(error):resolve()));
 // Deliberately exit own worker without finally/transport reply. SQL admission
 // already committed; this is offline transport observation, not an RPC send.
 if(mode==='exit-after-send')process.exit(86);
 return {status:'SUBMITTED',signature:prepared.signature};
}};
try{assert.equal(await executeFoodCompensation(store,provider,attempt),'SUBMITTED');assert.ok(sent);console.log('RECOVERED_EXACT_COMPENSATION_ATTEMPT');}finally{await pool.end();}
