import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {randomUUID,createHash} from 'node:crypto';import type pg from 'pg';import sharp from 'sharp';import {normalizeChatImage} from '../../apps/api/src/chat-image-normalizer';import {FoodChatMessageSchema,FoodChatPageSchema,FoodChatUploadSchema} from '../../packages/contracts/src/mobile-v1.generated';
type Actor={account:string;session:string;access:string};
export async function verifyChat105Binding(c:{db:pg.Client;assignmentId:string;customer:Actor;driverActor:Actor;outsider:Actor}){
 const {db,assignmentId}=c;assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');assert.equal((await db.query("SELECT to_regclass('bitpos.food_chat105_attachments') ready")).rows[0].ready,null);
 const source=await sharp({create:{width:24,height:16,channels:3,background:'#64188a'}}).jpeg().toBuffer(),photo=await normalizeChatImage(source,'image/jpeg');await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
 try{
  await db.query(await readFile('supabase/migrations/105_food_chat_image_messages.sql','utf8'));
  async function actor(who:Actor){await db.query('RESET ROLE');await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true)",[who.account,who.session,createHash('sha256').update(who.access).digest('hex')]);await db.query('SET LOCAL ROLE bitpos_app');}
  async function denied(sql:string,args:unknown[],message:string){await db.query('SAVEPOINT rejected');try{await assert.rejects(db.query(sql,args),(error:Error)=>error.message===message);}finally{await db.query('ROLLBACK TO rejected');await db.query('RELEASE rejected');}}
  const upload=async()=>FoodChatUploadSchema.parse((await db.query('SELECT bitpos.food_chat104_store($1,$2,$3,$4,$5,$6,$7,$8,$9) doc',[assignmentId,randomUUID(),photo.sourceSha256,source.length,'image/jpeg',photo.sha256,photo.width,photo.height,photo.bytes])).rows[0].doc);
  const send=async(key:string,body:string,images:string[])=>FoodChatMessageSchema.parse((await db.query('SELECT bitpos.food_chat105_send($1,$2,$3,$4::uuid[]) doc',[assignmentId,key,body,images])).rows[0].doc);
  await actor(c.customer);const a=await upload(),b=await upload(),d=await upload();await actor(c.driverActor);const foreign=await upload();
  await denied('SELECT * FROM bitpos.food_chat104_bytes($1,$2)',[assignmentId,a.id],'RESOURCE_NOT_FOUND');
  await actor(c.customer);const key=randomUUID(),first=await send(key,'',[a.id]);assert.equal(first.body,'');assert.deepEqual(first.attachments.map(i=>i.id),[a.id]);assert.deepEqual(await send(key,'',[a.id]),first);
  await denied('SELECT bitpos.food_chat105_send($1,$2,$3,$4::uuid[])',[assignmentId,key,'Changed caption',[a.id]],'IDEMPOTENCY_CONFLICT');
  await denied('SELECT bitpos.food_chat105_send($1,$2,$3,$4::uuid[])',[assignmentId,randomUUID(),'Reuse',[a.id]],'CHAT_IMAGE_IN_USE');
  await denied('SELECT bitpos.food_chat105_send($1,$2,$3,$4::uuid[])',[assignmentId,randomUUID(),'Duplicate',[b.id,b.id]],'INVALID_REQUEST');
  await denied('SELECT bitpos.food_chat105_send($1,$2,$3,$4::uuid[])',[assignmentId,randomUUID(),'Foreign',[foreign.id]],'RESOURCE_NOT_FOUND');
  await denied('SELECT bitpos.food_chat105_send($1,$2,$3,$4::uuid[])',[assignmentId,randomUUID(),'',[]],'INVALID_REQUEST');
  const pairKey=randomUUID(),pair=await send(pairKey,'Synthetic ordered photo pair',[b.id,d.id]);assert.deepEqual(pair.attachments.map(i=>i.id),[b.id,d.id]);
  await denied('SELECT bitpos.food_chat105_send($1,$2,$3,$4::uuid[])',[assignmentId,pairKey,'Synthetic ordered photo pair',[d.id,b.id]],'IDEMPOTENCY_CONFLICT');
  await actor(c.driverActor);assert.deepEqual((await db.query('SELECT * FROM bitpos.food_chat104_bytes($1,$2)',[assignmentId,a.id])).rows[0].body,photo.bytes);
  const page=FoodChatPageSchema.parse((await db.query('SELECT bitpos.food_chat102_recent($1,0) doc',[assignmentId])).rows[0].doc);assert.equal(page.items[0].mine,false);assert.equal(page.items[0].attachments.length,1);assert.equal(page.items[1].attachments.length,2);
  await actor(c.outsider);await denied('SELECT * FROM bitpos.food_chat104_bytes($1,$2)',[assignmentId,a.id],'RESOURCE_NOT_FOUND');
  await db.query('RESET ROLE');await db.query("UPDATE bitpos.food_chat104_uploads SET expires_at=clock_timestamp()-interval '1 second' WHERE assignment_id=$1",[assignmentId]);await db.query('SELECT bitpos.food_chat104_dispose_expired(100)');
  assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.food_chat104_uploads WHERE id=ANY($1::uuid[]) AND body IS NOT NULL',[[a.id,b.id,d.id]])).rows[0].n,3);assert.equal((await db.query('SELECT body IS NULL cleared FROM bitpos.food_chat104_uploads WHERE id=$1',[foreign.id])).rows[0].cleared,true);
  await actor(c.driverActor);assert.deepEqual((await db.query('SELECT * FROM bitpos.food_chat104_bytes($1,$2)',[assignmentId,a.id])).rows[0].body,photo.bytes);
  await actor(c.customer);assert.deepEqual(await send(key,'',[a.id]),first);
  await db.query('SAVEPOINT empty_message');await db.query('RESET ROLE');
  await db.query("INSERT INTO bitpos.food_chat102_messages(assignment_id,sender_id,sender_role,command_id,sequence,body) VALUES($1,$2,'CUSTOMER',$3,4999,'')",[assignmentId,c.customer.account,randomUUID()]);
  await assert.rejects(db.query('SET CONSTRAINTS ALL IMMEDIATE'),/EMPTY_CHAT_MESSAGE/);await db.query('ROLLBACK TO empty_message');await db.query('RELEASE empty_message');
  await actor(c.driverActor);const duty=(await db.query("SELECT bitpos.dispatch_driver_work()->'assignment' doc")).rows[0].doc;
  await db.query('SELECT bitpos.dispatch_food_withdraw($1,$2::jsonb)',[assignmentId,JSON.stringify({idempotencyKey:randomUUID(),expectedVersion:duty.shipmentVersion,generation:duty.generation,leaseGeneration:duty.leaseGeneration,reason:'SAFETY'})]);
  await denied('SELECT * FROM bitpos.food_chat104_bytes($1,$2)',[assignmentId,a.id],'CHAT_UNAVAILABLE');await db.query('SET CONSTRAINTS ALL IMMEDIATE');
 }finally{await db.query('ROLLBACK');}
 assert.equal((await db.query("SELECT to_regclass('bitpos.food_chat105_attachments') ready")).rows[0].ready,null);
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/food-chat105-binding-real-sql-20261020.json',JSON.stringify({status:'PASS_ACTUAL_SCHEMA_ROLLBACK_IMAGE_MESSAGE_BINDING',checks:['Photo-only/caption/ordered image messages atomically bind canonical private uploads','Exact replay preserves one message, changed body/order conflicts, reuse/duplicate/foreign/empty refused','Counterpart bytes unavailable before publish and available only after authorized message binding','Orphan worker clears expired unbound upload but preserves linked bytes and linked replay after upload TTL','Deferred empty-message guard rejects an invalid commit; canonical job close denies linked bytes','Generated strict message/page metadata and deferred source constraints pass; candidate DDL/data fully rolled back'],limits:['Synthetic generated images/canonical local assigned fixture, not actual-use migration','HTTP/native picker/render/durable upload draft/cache retirement still require joined acceptance']},null,2)+'\n');console.log('PASS_ACTUAL_SCHEMA_ROLLBACK_IMAGE_MESSAGE_BINDING');
}
