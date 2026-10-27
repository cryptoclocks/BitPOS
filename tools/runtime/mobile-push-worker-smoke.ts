import assert from 'node:assert/strict';import {randomBytes,randomUUID,createHash} from 'node:crypto';import {writeFile} from 'node:fs/promises';import pg from 'pg';
import {createMobilePushCrypto} from '../../packages/domain/src/mobile-push-crypto';import {createMobilePushWorker} from '../../apps/worker/src/mobile-push';import {createMobilePushProvider} from '../../apps/worker/src/mobile-push-provider';
type Actor={account:string;session:string;access:string;refresh?:string};
export async function verifyMobilePushWorker(c:{db:pg.Client;shipment:string;orderId:string;customer:Actor}){
 const {db}=c,role='bitpos_push087_fixture_'+process.pid,hash=(v:string)=>createHash('sha256').update(v).digest('hex'),crypto=createMobilePushCrypto({active:'fixture087',keys:{fixture087:randomBytes(32).toString('base64')}}),checks:string[]=[];
 let worker:ReturnType<typeof createMobilePushWorker>=null;const providerMessages:any[]=[];let mode:'RETRY'|'ACCEPTED'='RETRY';
 try{
  assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
  await db.query(`CREATE ROLE ${role} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);await db.query(`GRANT bitpos_mobile_push_worker TO ${role}`);
  const device=(await db.query('SELECT device_id FROM bitpos.mobile_sessions WHERE id=$1',[c.customer.session])).rows[0].device_id,proof=hash(randomUUID()),installationProof=randomBytes(32).toString('base64url'),next=hash(installationProof),endpoint=crypto.encrypt('synthetic-worker-fid-'+randomUUID(),{app:'CUSTOMER',deviceId:device});
  await db.query('BEGIN');await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_device',$3,true),set_config('bitpos.mobile_access_hash',$4,true)",[c.customer.account,c.customer.session,device,hash(c.customer.access)]);
  const binding=(await db.query("SELECT bitpos.mobile_push_binding_command('CUSTOMER',$1,$2,$3,$4,$5,$6) v",[{kind:'ENABLE',idempotencyKey:randomUUID(),expectedRevision:'0',capability:'authorized',locale:'en',platform:'android',consentVersion:'food-transactional-v1'},proof,next,endpoint.endpointHash,endpoint.ciphertext,endpoint.keyId])).rows[0].v;
  await db.query("SELECT bitpos.online_food_event(merchant_id,order_id,'KITCHEN') FROM bitpos.online_food_orders WHERE order_id=$1",[c.orderId]);await db.query('COMMIT');
  // Provider fake is explicit; actual worker transactions and restricted login connection are real.
  const provider={send:async(message:any,_signal?:AbortSignal,beforeSend?:()=>Promise<boolean>)=>{assert.ok(beforeSend);if(!await beforeSend())return{status:'UNAVAILABLE' as const,retryAfterSeconds:300};providerMessages.push(message);return mode==='RETRY'?{status:'RETRY' as const,retryAfterSeconds:30}:{status:'ACCEPTED' as const,providerMessageId:'projects/bitpos-fixture/messages/restarted.fixture'};}};
  const connection=`postgresql://${role}@127.0.0.1:55436/bitpos_delivery_fixture`;
  worker=createMobilePushWorker(connection,{}, {provider:provider as ReturnType<typeof createMobilePushProvider>,crypto});assert.ok(worker);await worker.tick();await worker.close();worker=null;
  const pending=(await db.query("SELECT d.* FROM bitpos.mobile_push_deliveries d JOIN bitpos.mobile_push_intents i ON i.id=d.intent_id WHERE i.order_id=$1 AND d.binding_id=$2",[c.orderId,binding.bindingId])).rows;assert.equal(pending.length,1);assert.equal(pending[0].state,'RETRY');assert.equal(pending[0].attempts,1);assert.equal(providerMessages.length,1);
  await db.query("UPDATE bitpos.mobile_push_deliveries SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",[pending[0].id]);mode='ACCEPTED';
  worker=createMobilePushWorker(connection,{}, {provider:provider as ReturnType<typeof createMobilePushProvider>,crypto});assert.ok(worker);await worker.tick();
  const accepted=(await db.query('SELECT state,attempts,provider_message_id FROM bitpos.mobile_push_deliveries WHERE id=$1',[pending[0].id])).rows[0];assert.deepEqual(accepted,{state:'ACCEPTED',attempts:2,provider_message_id:'projects/bitpos-fixture/messages/restarted.fixture'});await worker.tick();assert.equal(providerMessages.length,2);
  assert.equal(providerMessages[0].eventId,providerMessages[1].eventId);assert.equal(providerMessages[0].fid,providerMessages[1].fid);assert.ok(Date.parse(providerMessages[1].expiresAt)>Date.now());
  checks.push('Real dedicated non-app non-admin worker login expands committed canonical order event, decrypts endpoint, rechecks prepare before injected provider fixture and persists RETRY');
  checks.push('Closing/recreating actual worker retains same event/FID and reclaims due retry; exact provider receipt persists ACCEPTED attempts2; another tick produces no duplicate send');
  const restricted=new pg.Client({connectionString:connection});await restricted.connect();try{await assert.rejects(restricted.query('SELECT endpoint_ciphertext FROM bitpos.mobile_push_bindings'),/permission denied/);await assert.rejects(restricted.query('SELECT bitpos.mobile_push_binding_status($1,$2)',['CUSTOMER',next]),/permission denied/);}finally{await restricted.end();}
  checks.push('Worker login cannot read raw binding table or invoke mobile installation authority; separate SQL capabilities only');
  if(process.argv.includes('--push-worker-races')){
   await worker.close();worker=null;
   const {verifyPushWorkerRaces}=await import('./mobile-push-worker-races');
   assert.equal(typeof c.customer.refresh,'string');
   const rotated=await verifyPushWorkerRaces({db,connection,crypto,orderId:c.orderId,account:c.customer.account,session:c.customer.session,access:c.customer.access,refresh:c.customer.refresh!,device,key:next,installationProof,bindingId:binding.bindingId});c.customer.access=rotated.access;c.customer.refresh=rotated.refresh;
  }
  const receipt={status:'PASS_ACTUAL_RESTRICTED_PUSH_WORKER_RESTART_PERSISTENCE',checks,state:accepted,fixture:'Synthetic isolated consent/FID/keyring, injected provider result only; real canonical order event, dedicated worker login/transactions/decryption/restart/persisted receipt. No external provider requests or messages.',limits:['Not phone receipt, real provider delivery, stale-generation concurrent network case or automatic-offer/held-driver-lock evidence'],physicalTesting:'deferred_by_user_2026-10-16'};await writeFile('.omp/work/flutter-delivery-20261016/evidence/notification087-worker-restart-20261019.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
  return c.customer.access;
 }finally{await db.query('ROLLBACK');if(worker)await worker.close();await db.query(`DROP ROLE IF EXISTS ${role}`);}
}
