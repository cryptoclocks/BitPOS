import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import {readFile,writeFile} from 'node:fs/promises';import type pg from 'pg';import {FoodChatReadReceiptSchema} from '../../packages/contracts/src/mobile-v1.generated';
type Actor={account:string;session:string;access:string};
export async function verifyChat103ReadSql(c:{db:pg.Client;assignmentId:string;customer:Actor;driverActor:Actor;outsider:Actor}){
 const {db,assignmentId}=c;assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');assert.equal((await db.query("SELECT to_regclass('bitpos.food_chat103_read_cursors') ready")).rows[0].ready,null);
 await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
 try{
  await db.query(await readFile('supabase/migrations/103_food_chat_reads.sql','utf8'));
  async function actor(who:Actor){await db.query('RESET ROLE');await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true)",[who.account,who.session,createHash('sha256').update(who.access).digest('hex')]);await db.query('SET LOCAL ROLE bitpos_app');}
  async function denied(sql:string,params:unknown[],message:string){await db.query('SAVEPOINT rejected');try{await assert.rejects(db.query(sql,params),(e:Error)=>e.message===message);}finally{await db.query('ROLLBACK TO rejected');await db.query('RELEASE rejected');}}
  const read=async(sequence:string)=>FoodChatReadReceiptSchema.parse((await db.query('SELECT bitpos.food_chat103_mark_read($1,$2::bigint) doc',[assignmentId,sequence])).rows[0].doc);
  await actor(c.customer);await db.query('SELECT bitpos.food_chat102_send($1,$2,$3)',[assignmentId,randomUUID(),'Synthetic103 customer first']);
  await actor(c.driverActor);await db.query('SELECT bitpos.food_chat102_send($1,$2,$3)',[assignmentId,randomUUID(),'Synthetic103 rider second']);
  await actor(c.customer);await db.query('SELECT bitpos.food_chat102_send($1,$2,$3)',[assignmentId,randomUUID(),'Synthetic103 customer third']);
  await actor(c.driverActor);await denied('SELECT bitpos.food_chat103_mark_read($1,$2::bigint)',[assignmentId,'0'],'INVALID_REQUEST');await denied('SELECT bitpos.food_chat103_mark_read($1,$2::bigint)',[assignmentId,'2'],'INVALID_REQUEST');await denied('SELECT bitpos.food_chat103_mark_read($1,$2::bigint)',[assignmentId,'999'],'INVALID_REQUEST');
  const first=await read('1');assert.deepEqual(await read('1'),first);
  const third=await read('3');assert.equal(third.lastReadSequence,'3');assert.deepEqual(await read('1'),third);
  await actor(c.customer);const customerSignal=(await db.query('SELECT bitpos.food_chat103_signal($1) doc',[assignmentId])).rows[0].doc;assert.equal(customerSignal.peerReadSequence,'3');assert.equal('body' in customerSignal,false);
  await read('2');await actor(c.driverActor);assert.equal((await db.query('SELECT bitpos.food_chat103_signal($1) doc',[assignmentId])).rows[0].doc.peerReadSequence,'2');
  await actor(c.outsider);await denied('SELECT bitpos.food_chat103_mark_read($1,1)',[assignmentId],'RESOURCE_NOT_FOUND');await denied('SELECT bitpos.food_chat103_signal($1)',[assignmentId],'RESOURCE_NOT_FOUND');
  await actor(c.driverActor);await db.query('SAVEPOINT revoked');await db.query('RESET ROLE');await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=clock_timestamp() WHERE id=$1',[c.driverActor.session]);await db.query('SET LOCAL ROLE bitpos_app');await denied('SELECT bitpos.food_chat103_mark_read($1,3)',[assignmentId],'AUTH_REQUIRED');await db.query('ROLLBACK TO revoked');await db.query('RELEASE revoked');
  const current=(await db.query("SELECT bitpos.dispatch_driver_work()->'assignment' doc")).rows[0].doc;
  await db.query('SELECT bitpos.dispatch_food_withdraw($1,$2::jsonb)',[assignmentId,JSON.stringify({idempotencyKey:randomUUID(),expectedVersion:current.shipmentVersion,generation:current.generation,leaseGeneration:current.leaseGeneration,reason:'SAFETY'})]);
  await actor(c.customer);await denied('SELECT bitpos.food_chat103_signal($1)',[assignmentId],'CHAT_UNAVAILABLE');await denied('SELECT bitpos.food_chat103_mark_read($1,2)',[assignmentId],'CHAT_UNAVAILABLE');
  await denied('SELECT * FROM bitpos.food_chat103_read_cursors',[],'permission denied for table food_chat103_read_cursors');await db.query('SET CONSTRAINTS ALL IMMEDIATE');
 }finally{await db.query('ROLLBACK');}
 assert.equal((await db.query("SELECT to_regclass('bitpos.food_chat103_read_cursors') ready")).rows[0].ready,null);
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/food-chat103-read-real-sql-20261020.json',JSON.stringify({status:'PASS_ACTUAL_SCHEMA_ROLLBACK_CHAT_READ_CURSOR',checks:['Valid counterpart message only; zero/missing/own message rejected','Replay preserves exact receipt/time; higher cursor advances, lower never regresses','Signal projects current counterpart read cursor without body','Actual stranger/revoked session/canonical closed assignment refused','App direct table access denied; deferred source constraints pass; rollback removes candidate DDL/effects'],limits:['Canonical local synthetic paid/assigned fixture; not real KYC/payment','Rollback SQL only, not HTTP/native visible-message acknowledgement proof']},null,2)+'\n');console.log('PASS_ACTUAL_SCHEMA_ROLLBACK_CHAT_READ_CURSOR');
}
