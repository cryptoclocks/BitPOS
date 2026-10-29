import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',ADMIN_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
const {pool,tenant}=await import('../../apps/api/src/db');
if(process.argv.includes('--child')){
 let blockedExternalCalls=0;
 globalThis.fetch=(async()=>{blockedExternalCalls++;throw Error('FIXTURE all external providers unavailable');}) as typeof fetch;
 const {runWorker}=await import('../../apps/worker/src/index');const stop=new AbortController();const timer=setTimeout(()=>stop.abort(),1700);
 try{await runWorker(stop.signal);console.log(JSON.stringify({environment:'local_disposable_fixture',blockedExternalCalls,externalCallsSent:0,workerStopped:true}));}
 finally{clearTimeout(timer);await pool.end();}
}else{
 const fixture=JSON.parse(await readFile('.omp/work/flutter-delivery-20261016/evidence/p1-acceptance-review-after.json','utf8'));assert.equal(fixture.environment,'local_disposable_fixture');
 const state=()=>tenant(fixture.merchantId,async db=>({order:(await db.query('SELECT status,reservation_released FROM orders WHERE id=$1',[fixture.deadlineOrderId])).rows[0],lifecycle:(await db.query('SELECT acceptance_status,acceptance_version,event_sequence::text FROM online_food_orders WHERE order_id=$1',[fixture.deadlineOrderId])).rows[0],events:(await db.query('SELECT kind,sequence::text FROM mobile_order_events WHERE order_id=$1 ORDER BY sequence',[fixture.deadlineOrderId])).rows,refunds:(await db.query('SELECT count(*)::int AS n FROM refunds WHERE order_id=$1',[fixture.deadlineOrderId])).rows[0].n}));
 async function startFreshWorker(){return new Promise<{pid:number;receipt:Record<string,unknown>;errors:string}>((resolve,reject)=>{const child=spawn(process.execPath,[...process.execArgv,'tools/runtime/delivery-acceptance-worker-smoke.ts','--child'],{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']});let output='',errors='';child.stdout.on('data',v=>output+=String(v));child.stderr.on('data',v=>errors+=String(v));child.on('error',reject);child.on('exit',code=>{if(code!==0)return reject(Error('Fixture worker exit '+code+': '+errors));const line=output.split('\n').find(v=>v.startsWith('{'));if(!line)return reject(Error('No worker receipt'));resolve({pid:child.pid!,receipt:JSON.parse(line),errors});});});}
 try{
  const before=await state();assert.equal(before.lifecycle.acceptance_status,'PENDING');
  const first=await startFreshWorker(),after=await state();assert.equal(Number(first.receipt.blockedExternalCalls)>0,true);assert.deepEqual(after.order,{status:'EXPIRED',reservation_released:true});assert.equal(after.lifecycle.acceptance_status,'TIMED_OUT');assert.equal(after.lifecycle.acceptance_version,1);assert.equal(after.events.filter(e=>e.kind==='ACCEPTANCE').length,1);assert.equal(after.refunds,0);
  const restarted=await startFreshWorker();assert.notEqual(first.pid,restarted.pid);assert.deepEqual(await state(),after);
  const receipt={environment:'local_disposable_fixture',assertions:9,orderId:fixture.deadlineOrderId,before,after,workers:[first,restarted],limits:['Two fresh actual worker processes and all normal lanes, every provider fetch forced unavailable; no external calls sent','Restart after committed first-process closure, not a mid-transaction OS crash','Disposable fixture data only; no chain or refund transfer'],physicalTesting:'deferred_by_user_2026-10-16'};
  await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-acceptance-worker-restart.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 }finally{await pool.end();}
}
