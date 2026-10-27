import assert from 'node:assert/strict';import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {FoodChatPageSchema,FoodChatMessageSchema} from '../../packages/contracts/src/mobile-v1.generated';
const exec=promisify(execFile),bin='/opt/homebrew/opt/postgresql@17/bin',dir=await mkdtemp(join(tmpdir(),'bitpos-chat102-isolated-'));let started=false;let db:pg.Client|undefined;let listener:pg.Client|undefined;
const customer=randomUUID(),rider=randomUUID(),stranger=randomUUID(),driver=randomUUID(),assignment=randomUUID(),shipment=randomUUID();
try{
 await exec(join(bin,'initdb'),['-D',dir,'-A','trust','--no-locale','--encoding=UTF8']);
 await exec(join(bin,'pg_ctl'),['-D',dir,'-l',join(dir,'server.log'),'-o',`-h '' -k ${dir} -p 55439`,'-w','start']);started=true;
 db=new pg.Client({host:dir,port:55439,database:'postgres'});await db.connect();
 await db.query(`CREATE ROLE bitpos_app;CREATE SCHEMA bitpos;SET search_path=bitpos,public;
 CREATE TABLE mobile_accounts(id uuid PRIMARY KEY);
 CREATE TABLE driver_profiles(id uuid PRIMARY KEY,account_id uuid);
 CREATE TABLE food_shipments(id uuid PRIMARY KEY,account_id uuid,active_assignment_id uuid,generation bigint);
 CREATE TABLE food_assignments(id uuid PRIMARY KEY,shipment_id uuid,driver_id uuid,generation bigint,state text,closed_at timestamptz,lease_id uuid,lease_generation bigint);
 CREATE TABLE driver_assignment_leases(id uuid,driver_id uuid,generation bigint,food_assignment_id uuid,state text);
 CREATE FUNCTION food_driver_authority(driver uuid,shipment uuid) RETURNS text LANGUAGE sql AS $$ SELECT CASE WHEN current_setting('test102.restricted',true)='yes' THEN 'DRIVER_SUSPENDED' ELSE NULL END $$;
 -- Minimal identity/root doubles for SQL protocol tests, NOT real dispatch authority proof.
 CREATE FUNCTION dispatch_live_actor() RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN
 IF nullif(current_setting('test102.actor',true),'') IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;RETURN current_setting('test102.actor')::uuid;END $$;
 CREATE FUNCTION dispatch_realtime_actor() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM dispatch_live_actor();END $$;
 CREATE FUNCTION dispatch_lock_root(target uuid) RETURNS food_shipments LANGUAGE plpgsql AS $$ DECLARE s food_shipments;BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED';END IF;
 SELECT * INTO STRICT s FROM food_shipments WHERE id=target FOR UPDATE;RETURN s;END $$;
 GRANT USAGE ON SCHEMA bitpos TO bitpos_app;`);
 await db.query(await readFile('supabase/migrations/102_food_assignment_chat.sql','utf8'));
 await db.query('INSERT INTO bitpos.mobile_accounts SELECT unnest($1::uuid[])',[[customer,rider,stranger]]);
 await db.query('INSERT INTO bitpos.driver_profiles VALUES($1,$2)',[driver,rider]);
 await db.query('INSERT INTO bitpos.food_shipments VALUES($1,$2,$3,1)',[shipment,customer,assignment]);
 await db.query("INSERT INTO bitpos.food_assignments VALUES($1,$2,$3,1,'ACCEPTED',NULL,$1,1)",[assignment,shipment,driver]);
 await db.query("INSERT INTO bitpos.driver_assignment_leases VALUES($1,$2,1,$1,'ACTIVE')",[assignment,driver]);
 const actor=async(id:string)=>{await db!.query('RESET ROLE');await db!.query("SELECT set_config('test102.actor',$1,false)",[id]);await db!.query('SET ROLE bitpos_app');};
 const page=async(after='0')=>FoodChatPageSchema.parse((await db!.query('SELECT bitpos.food_chat102_page($1,$2::bigint) doc',[assignment,after])).rows[0].doc);
 const send=async(command:string,body:string)=>FoodChatMessageSchema.parse((await db!.query('SELECT bitpos.food_chat102_send($1,$2,$3) doc',[assignment,command,body])).rows[0].doc);
 await actor(customer);assert.equal((await page()).items.length,0);
 const key=randomUUID(),first=await send(key,'Hello สวัสดี');assert.equal(first.mine,true);assert.equal(first.senderRole,'CUSTOMER');assert.equal(first.sequence,'1');
 assert.equal((await send(key,'Hello สวัสดี')).id,first.id);await assert.rejects(send(key,'Changed text'),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(send(randomUUID(),'   '),/INVALID_REQUEST/);await assert.rejects(send(randomUUID(),'x'.repeat(4001)),/INVALID_REQUEST/);
 await actor(rider);const seen=await page();assert.equal(seen.myRole,'DRIVER');assert.equal(seen.items[0].mine,false);
 await send(randomUUID(),'On my way');await actor(customer);assert.equal((await page()).items[1].mine,false);
 await actor(stranger);await assert.rejects(page(),/RESOURCE_NOT_FOUND/);await assert.rejects(send(randomUUID(),'No'),/RESOURCE_NOT_FOUND/);
 await actor(customer);await assert.rejects(page('999'),/INVALID_REQUEST/);
 for(let n=0;n<49;n++)await send(randomUUID(),'Synthetic page message '+n);
 const firstPage=await page();assert.equal(firstPage.items.length,50);assert.equal(firstPage.nextAfterSequence,'50');
 const secondPage=await page(firstPage.nextAfterSequence!);assert.equal(secondPage.items.length,1);assert.equal(secondPage.items[0].sequence,'51');assert.equal(secondPage.nextAfterSequence,null);
 const recent=FoodChatPageSchema.parse((await db.query('SELECT bitpos.food_chat102_recent($1,0) doc',[assignment])).rows[0].doc);
 assert.equal(recent.items.length,50);assert.equal(recent.items[0].sequence,'2');assert.equal(recent.items.at(-1)!.sequence,'51');assert.equal(recent.nextBeforeSequence,'2');
 const oldest=FoodChatPageSchema.parse((await db.query('SELECT bitpos.food_chat102_recent($1,$2::bigint) doc',[assignment,recent.nextBeforeSequence])).rows[0].doc);
 assert.equal(oldest.items.length,1);assert.equal(oldest.items[0].sequence,'1');assert.equal(oldest.nextBeforeSequence,null);
 const signal=(await db.query('SELECT bitpos.food_chat102_signal($1) doc',[assignment])).rows[0].doc;
 assert.deepEqual(Object.keys(signal).sort(),['assignmentId','latestSequence','serverTime']);assert.equal(signal.latestSequence,'51');
 // Concurrent retry of one command must produce exactly one durable message.
 const concurrentKey=randomUUID();
 const results=await Promise.all(Array.from({length:12},async()=>{
  const connection=new pg.Client({host:dir,port:55439,database:'postgres'});await connection.connect();
  try{
   await connection.query("SELECT set_config('test102.actor',$1,false)",[customer]);await connection.query('SET ROLE bitpos_app');
   for(let attempt=0;attempt<100;attempt++){
    try{return FoodChatMessageSchema.parse((await connection.query('SELECT bitpos.food_chat102_send($1,$2,$3) doc',[assignment,concurrentKey,'Concurrent original'])).rows[0].doc);}
    catch(error){if((error as Error).message!=='CHAT_RETRY')throw error;await new Promise(resolve=>setTimeout(resolve,20));}
   }
   throw Error('Concurrent chat retry budget exhausted');
  }finally{await connection.end();}
 }));
 assert.equal(new Set(results.map(r=>r.id)).size,1);
 await db.query('RESET ROLE');assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.food_chat102_messages WHERE command_id=$1',[concurrentKey])).rows[0].n,1);
 await actor(customer);
 await db.query("SELECT set_config('test102.restricted','yes',false)");await assert.rejects(page(),/CHAT_UNAVAILABLE/);await db.query("SELECT set_config('test102.restricted','no',false)");
 await db.query('RESET ROLE');await db.query("UPDATE bitpos.driver_assignment_leases SET state='RELEASED'");await actor(customer);await assert.rejects(page(),/CHAT_UNAVAILABLE/);await db.query('RESET ROLE');await db.query("UPDATE bitpos.driver_assignment_leases SET state='ACTIVE'");await actor(customer);
 // Notifications are commit-only hints, with no text, IDs or recipient data in payload.
 listener=new pg.Client({host:dir,port:55439,database:'postgres'});await listener.connect();
 const notifications:string[]=[];listener.on('notification',message=>notifications.push(message.payload??''));await listener.query('LISTEN bitpos_food_realtime');
 await db.query('BEGIN');await send(randomUUID(),'Rolled back private text');await new Promise(resolve=>setTimeout(resolve,30));assert.equal(notifications.length,0);await db.query('ROLLBACK');
 await new Promise(resolve=>setTimeout(resolve,30));assert.equal(notifications.length,0);
 await send(randomUUID(),'Committed private text');for(let n=0;n<20&&notifications.length===0;n++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.ok(notifications.length>0);assert.ok(notifications.every(payload=>payload===''));
 // Current assignment/generation fences apply even to replay, no disclosure after closure.
 await db.query('RESET ROLE');await db.query('UPDATE bitpos.food_shipments SET generation=2 WHERE id=$1',[shipment]);await actor(customer);await assert.rejects(page(),/CHAT_UNAVAILABLE/);await assert.rejects(send(key,'Hello สวัสดี'),/CHAT_UNAVAILABLE/);
 await db.query('RESET ROLE');await db.query('UPDATE bitpos.food_shipments SET generation=1 WHERE id=$1',[shipment]);await db.query("UPDATE bitpos.food_assignments SET closed_at=clock_timestamp(),state='DELIVERED' WHERE id=$1",[assignment]);await actor(rider);await assert.rejects(page(),/CHAT_UNAVAILABLE/);
 // App cannot bypass entrypoints and directly fetch stored message plaintext.
 await assert.rejects(db.query('SELECT * FROM bitpos.food_chat102_messages'),/permission denied/);
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/food-chat102-isolated-20261020.json',JSON.stringify({status:'PASS_ISOLATED_POSTGRES_CHAT_PROTOCOL',checks:['Two participant roles, mine flag, Unicode text, exact replay one message, conflicting replay refusal','Blank/oversize body refusal, stranger refusal, foreign cursor rejection','50+1 ascending and newest/older sequence windows without duplicate anchor','Realtime signal contains assignment/sequence/server time only, no plaintext','Empty NOTIFY hints delivered only after commit, rollback sends none','12 concurrent same-command sends/retries produce one message','Generation change, authority restriction, released lease and closure deny reads/replay; app direct table denied'],limits:['Minimal identity/root doubles, not actual dispatch auth/lease/source schema or HTTP/AVD/attachments/calls proof','102 not installed in original fixture or actual-use'],cleanup:'Own socket-only disposable server stopped and directory removed in finally'},null,2)+'\n');
 console.log('PASS_ISOLATED_POSTGRES_CHAT_PROTOCOL');
}finally{await listener?.end();await db?.end();if(started)await exec(join(bin,'pg_ctl'),['-D',dir,'-m','fast','-w','stop']);await rm(dir,{recursive:true,force:true});}
