import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {randomUUID,createHash} from 'node:crypto';import type pg from 'pg';
import {DriverDailyEarningsSchema,FoodChatMessageSchema,FoodChatPageSchema} from '../../packages/contracts/src/mobile-v1.generated';
type Actor={account:string;session:string;access:string};
export async function verifyChat102RealSchema(c:{db:pg.Client;assignmentId:string;driverId:string;merchant:string;customer:Actor;driverActor:Actor;outsider:Actor}){
 const {db,assignmentId,driverId}=c;
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 const before=(await db.query('SELECT to_jsonb(a) doc FROM bitpos.food_assignments a WHERE id=$1',[assignmentId])).rows[0].doc;
 const wasInstalled=!!(await db.query("SELECT to_regclass('bitpos.food_chat102_threads') ready")).rows[0].ready;
 assert.equal(wasInstalled,false,'Rollback acceptance must run before102 fixture admission');
 await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
 try{
  await db.query(await readFile('supabase/migrations/101_driver_daily_earnings.sql','utf8'));
  await db.query(await readFile('supabase/migrations/102_food_assignment_chat.sql','utf8'));
  await db.query("SET LOCAL statement_timeout='4s';SET LOCAL lock_timeout='200ms'");
  async function actor(who:Actor){
   await db.query('RESET ROLE');const row=(await db.query('SELECT device_id FROM bitpos.mobile_sessions WHERE id=$1',[who.session])).rows[0];assert.ok(row);
   await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true),set_config('bitpos.mobile_device',$4,true),set_config('bitpos.merchant',$5,true)",[who.account,who.session,createHash('sha256').update(who.access).digest('hex'),row.device_id,c.merchant]);await db.query('SET LOCAL ROLE bitpos_app');
  }
  async function refused(sql:string,params:unknown[],message:string){await db.query('SAVEPOINT refusal');try{await assert.rejects(db.query(sql,params),(error:Error)=>error.message===message);}finally{await db.query('ROLLBACK TO refusal');await db.query('RELEASE refusal');}}
  await actor(c.driverActor);
  const daily=DriverDailyEarningsSchema.parse((await db.query('SELECT bitpos.driver101_daily_earnings() doc')).rows[0].doc);
  await db.query('RESET ROLE');
  const totals=(await db.query(`SELECT e.state,count(*)::text count,f.currency,f.decimals,sum(f.amount_minor)::text amount FROM bitpos.earning_accruals e JOIN bitpos.earning_accrual_facts f ON f.accrual_id=e.id WHERE e.driver_id=$1 AND e.food_assignment_id IS NOT NULL AND e.created_at >= $2::timestamptz AND e.created_at < $3::timestamptz AND e.created_at <= $4::timestamptz GROUP BY e.state,f.currency,f.decimals ORDER BY f.currency,f.decimals,e.state`,[driverId,daily.dayStart,daily.dayEnd,daily.snapshotAt])).rows;
  assert.deepEqual(daily.groups,totals.map(row=>({state:row.state,count:row.count,money:{currency:row.currency,decimals:row.decimals,amountMinor:row.amount}})));
  await actor(c.driverActor);
  for(const [key,value]of [['bitpos.mobile_access_hash','0'.repeat(64)],['bitpos.mobile_device',randomUUID()]]){
   await db.query('SAVEPOINT bad_actor');await db.query('SELECT set_config($1,$2,true)',[key,value]);await refused('SELECT bitpos.driver101_daily_earnings()',[],'AUTH_REQUIRED');await db.query('ROLLBACK TO bad_actor');await db.query('RELEASE bad_actor');
  }
  await actor(c.customer);await refused('SELECT bitpos.driver101_daily_earnings()',[],'ROLE_REQUIRED');
  const key=randomUUID(),text='Synthetic102 customer message',first=FoodChatMessageSchema.parse((await db.query('SELECT bitpos.food_chat102_send($1,$2,$3) doc',[assignmentId,key,text])).rows[0].doc);
  assert.equal(first.mine,true);assert.equal(first.senderRole,'CUSTOMER');
  assert.deepEqual((await db.query('SELECT bitpos.food_chat102_send($1,$2,$3) doc',[assignmentId,key,text])).rows[0].doc,first);
  await refused('SELECT bitpos.food_chat102_send($1,$2,$3)',[assignmentId,key,'Changed body'],'IDEMPOTENCY_CONFLICT');
  await actor(c.driverActor);const seen=FoodChatPageSchema.parse((await db.query('SELECT bitpos.food_chat102_recent($1,0) doc',[assignmentId])).rows[0].doc);assert.equal(seen.items[0].mine,false);assert.equal(seen.myRole,'DRIVER');
  await db.query('SELECT bitpos.food_chat102_send($1,$2,$3)',[assignmentId,randomUUID(),'Synthetic102 rider reply']);
  await actor(c.outsider);for(const fn of ['food_chat102_signal','food_chat102_recent'])await refused('SELECT bitpos.'+fn+'($1)',[assignmentId],'RESOURCE_NOT_FOUND');
  await actor(c.driverActor);
  // Real revocation on the original source tables, inside a reversible savepoint.
  await db.query('SAVEPOINT revoked');await db.query('RESET ROLE');await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=clock_timestamp() WHERE id=$1',[c.driverActor.session]);await db.query('SET LOCAL ROLE bitpos_app');
  await refused('SELECT bitpos.food_chat102_signal($1)',[assignmentId],'AUTH_REQUIRED');await refused('SELECT bitpos.driver101_daily_earnings()',[],'AUTH_REQUIRED');await db.query('ROLLBACK TO revoked');await db.query('RELEASE revoked');
  // Use canonical recovery, never forge lease/assignment rows or suppress source guards.
  await actor(c.driverActor);const version=(await db.query('SELECT (bitpos.dispatch_driver_work()->\'assignment\'->>\'shipmentVersion\') version')).rows[0].version;assert.ok(version);
  await db.query('SELECT bitpos.dispatch_food_withdraw($1,$2::jsonb)',[assignmentId,JSON.stringify({idempotencyKey:randomUUID(),expectedVersion:version,generation:before.generation.toString(),leaseGeneration:before.lease_generation.toString(),reason:'SAFETY'})]);
  await actor(c.customer);await refused('SELECT bitpos.food_chat102_signal($1)',[assignmentId],'CHAT_UNAVAILABLE');await refused('SELECT bitpos.food_chat102_send($1,$2,$3)',[assignmentId,key,text],'CHAT_UNAVAILABLE');
  await db.query('SET CONSTRAINTS ALL IMMEDIATE');
 }finally{await db.query('ROLLBACK');}
 assert.equal((await db.query("SELECT to_regclass('bitpos.food_chat102_threads') ready")).rows[0].ready,null);
 assert.deepEqual((await db.query('SELECT to_jsonb(a) doc FROM bitpos.food_assignments a WHERE id=$1',[assignmentId])).rows[0].doc,before);
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/chat102-daily101-real-schema-rollback-20261020.json',JSON.stringify({status:'PASS_ACTUAL_SCHEMA_AUTH_ROLLBACK_CHAT_AND_DAILY',checks:['Real062/088/078/061 source schema and strict generated outputs; daily groups match direct SQL','Real access-hash and device mismatch denied; non-driver summary denied','Actual customer/rider text replay/conflict, recent page, stranger denial','Real source session revocation denies chat and daily','Canonical pre-pickup withdrawal denies chat/replay; all deferred source constraints pass','Rollback removes candidate DDL/messages/recovery and preserves exact source assignment'],limits:['Fresh canonical HTTP assignment with synthetic identity/document/payment verifier; not real KYC/payment','This test is rollback SQL, not new routes HTTP/AVD or full privacy/attachments proof'],physicalTesting:'deferred_by_user_2026-10-16'},null,2)+'\n');
 console.log('PASS_ACTUAL_SCHEMA_AUTH_ROLLBACK_CHAT_AND_DAILY');
}
