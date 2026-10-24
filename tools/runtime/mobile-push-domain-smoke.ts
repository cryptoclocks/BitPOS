import assert from 'node:assert/strict';import {randomBytes,randomUUID,createHash} from 'node:crypto';import {writeFile} from 'node:fs/promises';import type pg from 'pg';
type Actor={account:string;session:string;access:string};
export async function verifyMobilePushDomain(c:{db:pg.Client;shipment:string;orderId:string;driver:string;assignment:any;driverActor:Actor;customer:Actor}){
 const {db}=c,checks:string[]=[],hash=(v:string)=>createHash('sha256').update(v).digest('hex');assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');await db.query('BEGIN');
 try{
  async function bind(who:Actor,app:string){const device=(await db.query('SELECT device_id FROM bitpos.mobile_sessions WHERE id=$1',[who.session])).rows[0].device_id;await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_device',$3,true),set_config('bitpos.mobile_access_hash',$4,true)",[who.account,who.session,device,hash(who.access)]);
   const key=hash(randomBytes(32).toString('hex')),next=hash(randomBytes(32).toString('hex')),payload={kind:'ENABLE',idempotencyKey:randomUUID(),expectedRevision:'0',capability:'authorized',locale:'en',platform:'android',consentVersion:'food-transactional-v1'};
   const receipt=(await db.query('SELECT bitpos.mobile_push_binding_command($1,$2,$3,$4,$5,$6,$7) v',[app,payload,key,next,hash(randomUUID()),'synthetic-internal-ciphertext-not-provider-config','fixture087'])).rows[0].v;return{receipt,key:next};
  }
  const driverBinding=await bind(c.driverActor,'DRIVER');await bind(c.customer,'CUSTOMER');
  const before=(await db.query('SELECT event_sequence FROM bitpos.online_food_orders WHERE order_id=$1',[c.orderId])).rows[0].event_sequence;
  await db.query("SELECT bitpos.online_food_event(merchant_id,order_id,'KITCHEN') FROM bitpos.online_food_orders WHERE order_id=$1",[c.orderId]);
  await db.query("SELECT bitpos.dispatch_event($1,'INCIDENT_ACKNOWLEDGED',jsonb_build_object('assignmentId',$2::uuid))",[c.shipment,c.assignment.assignmentId]);
  const intents=(await db.query('SELECT * FROM bitpos.mobile_push_intents WHERE shipment_id=$1 OR order_id=$2 ORDER BY occurred_at,id',[c.shipment,c.orderId])).rows;
  assert.equal(intents.filter(i=>i.source_kind==='ORDER'&&i.order_sequence===String(BigInt(before)+1n)).length,1);assert.ok(intents.some(i=>i.app==='DRIVER'&&i.assignment_id===c.assignment.assignmentId));
  await db.query('SELECT bitpos.mobile_push_expand(100)');
  const deliveries=(await db.query('SELECT d.*,i.app FROM bitpos.mobile_push_deliveries d JOIN bitpos.mobile_push_intents i ON i.id=d.intent_id WHERE i.shipment_id=$1 OR i.order_id=$2',[c.shipment,c.orderId])).rows;assert.equal(deliveries.length,3);
  await db.query('SELECT bitpos.mobile_push_expand(100)');assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.mobile_push_deliveries WHERE intent_id=ANY($1::uuid[])',[intents.map(i=>i.id)])).rows[0].n,3);
  checks.push('Actual immutable order and shipment event producers create customer and current-assignment-driver intents transactionally; repeated fanout creates one delivery per binding generation');
  for(const delivery of deliveries){await db.query("UPDATE bitpos.mobile_push_deliveries SET state='LEASED',lease_id=$2,lease_until=clock_timestamp()+interval '30 seconds',attempts=1 WHERE id=$1",[delivery.id,randomUUID()]);}
  const target=deliveries.find(d=>d.app==='DRIVER')!,lease=(await db.query('SELECT lease_id FROM bitpos.mobile_push_deliveries WHERE id=$1',[target.id])).rows[0].lease_id;
  const prepared=(await db.query('SELECT bitpos.mobile_push_prepare($1,$2) v',[target.id,lease])).rows[0].v;assert.equal(prepared.bindingId,driverBinding.receipt.bindingId);assert.ok(Date.parse(prepared.expiresAt)>Date.now());
  assert.equal((await db.query("SELECT bitpos.mobile_push_finish($1,$2,'ACCEPTED','projects/bitpos-fixture/messages/fixture.id',1) v",[target.id,randomUUID()])).rows[0].v,false);
  await db.query('SAVEPOINT authority_denial');await db.query("UPDATE bitpos.driver_profiles SET status='SUSPENDED',verified_until=NULL WHERE id=$1",[c.driver]);
  assert.equal((await db.query('SELECT bitpos.mobile_push_prepare($1,$2) v',[target.id,lease])).rows[0].v,null);await db.query('ROLLBACK TO SAVEPOINT authority_denial');await db.query('RELEASE SAVEPOINT authority_denial');
  assert.equal((await db.query("SELECT bitpos.mobile_push_finish($1,$2,'ACCEPTED','projects/bitpos-fixture/messages/fixture.id',1) v",[target.id,lease])).rows[0].v,true);
  const accepted=(await db.query('SELECT state,provider_message_id FROM bitpos.mobile_push_deliveries WHERE id=$1',[target.id])).rows[0];assert.deepEqual(accepted,{state:'ACCEPTED',provider_message_id:'projects/bitpos-fixture/messages/fixture.id'});
  assert.equal((await db.query("SELECT bitpos.mobile_push_finish($1,$2,'TOKEN_INVALID',NULL,1) v",[target.id,lease])).rows[0].v,false);
  checks.push('Actual current driver assignment prepare returns canonical expiry; professional suspension suppresses prepare; wrong lease cannot finish; exact period-containing provider receipt persists ACCEPTED once, not phone delivery');
  const retry=deliveries.find(d=>d.app==='CUSTOMER')!,retryLease=(await db.query('SELECT lease_id FROM bitpos.mobile_push_deliveries WHERE id=$1',[retry.id])).rows[0].lease_id;
  assert.equal((await db.query("SELECT bitpos.mobile_push_finish($1,$2,'RETRY',NULL,1) v",[retry.id,retryLease])).rows[0].v,true);assert.equal((await db.query('SELECT state FROM bitpos.mobile_push_deliveries WHERE id=$1',[retry.id])).rows[0].state,'RETRY');
  await db.query("UPDATE bitpos.mobile_push_deliveries SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",[retry.id]);
  const claimed=(await db.query('SELECT bitpos.mobile_push_claim(20) v')).rows[0].v;assert.ok(claimed.some((v:any)=>v.deliveryId===retry.id));const newLease=claimed.find((v:any)=>v.deliveryId===retry.id).leaseId;assert.notEqual(newLease,retryLease);
  assert.equal((await db.query("SELECT bitpos.mobile_push_finish($1,$2,'ACCEPTED','projects/bitpos-fixture/messages/stale',1) v",[retry.id,retryLease])).rows[0].v,false);
  checks.push('Durable RETRY becomes due and is reclaimed with new lease; superseded lease cannot record provider outcome');
  await db.query('SET CONSTRAINTS ALL IMMEDIATE');const receipt={status:'PASS_ROLLBACK_CANONICAL_EVENT_PUSH_FANOUT_LEASE_SUBUNIT',checks,fixture:'Canonical persisted assigned-food fixture; internal notification ciphertext marker, synthetic provider acceptance result only. Domain events emitted through actual producers inside rollback; no provider calls/messages.',limits:['No actual provider worker-network run or two-connection lock/concurrency/automatic-offer regressions in this probe'],physicalTesting:'deferred_by_user_2026-10-16'};await writeFile('.omp/work/flutter-delivery-20261016/evidence/notification087-domain-sql-20261019.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 }finally{await db.query('ROLLBACK');}
}
