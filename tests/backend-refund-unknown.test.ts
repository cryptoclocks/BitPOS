import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
// DS39 / WP3b: refund execution unknown-outcome journal, DB-backed. Uses the
// committed synthetic UNKNOWN attempts of the disposable fixture inside rolled-back
// transactions, executing the SECURITY DEFINER entry points as the refund worker
// login (session authorization), exactly the role boundary the worker runs under.
// No chain, wallet, signing or provider is involved; nothing is broadcast.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
async function inTransaction(body:(db:pg.Client,attempt:{id:string;version:string;prepared:unknown;payment_id:string})=>Promise<void>){
 const {config}=await import('../apps/api/src/config');
 const db=new pg.Client({connectionString:config.ADMIN_DATABASE_URL});await db.connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');await db.query('SET LOCAL search_path=bitpos,public');
  const attempt=(await db.query("SELECT id,version::text,prepared,payment_id FROM food_refund110_attempts WHERE state='UNKNOWN' AND prepared IS NOT NULL ORDER BY id LIMIT 1")).rows[0];
  assert.ok(attempt,'fixture needs a prepared UNKNOWN refund attempt');
  await body(db,attempt);
 }finally{await db.query('ROLLBACK').catch(()=>undefined);await db.end();}
}
const asWorker=async<T>(db:pg.Client,fn:()=>Promise<T>)=>{await db.query('SET SESSION AUTHORIZATION bitpos_refund110_fixture');try{return await fn();}finally{await db.query('RESET SESSION AUTHORIZATION');}};
const view=async(db:pg.Client,id:string)=>({attempt:(await db.query('SELECT state,version::text,prepared FROM food_refund110_attempts WHERE id=$1',[id])).rows[0],observations:(await db.query('SELECT attempt_version::text v,reason FROM food_refund110_observations WHERE attempt_id=$1 ORDER BY attempt_version,reason',[id])).rows});

test('unknown outcome keeps the exact prepared bytes, refuses a replacement signing and never reports funding or success',integration,async()=>inTransaction(async(db,a)=>{
 const snapshot=await asWorker(db,async()=>(await db.query('SELECT food_refund110_snapshot($1) s',[a.id])).rows[0].s);
 assert.equal(snapshot.state,'UNKNOWN');assert.equal(snapshot.fundingAvailable,false);assert.equal(snapshot.version,a.version);
 // A replacement signing for the same obligation is refused: prepare only works from SIGNING.
 const replaced=await asWorker(db,async()=>(await db.query('SELECT food_refund110_prepare($1,$2,$3::jsonb) ok',[a.id,a.version,JSON.stringify({attemptId:a.id,signedBase64:'AAAA'})])).rows[0].ok);
 assert.equal(replaced,false);
 const after=await view(db,a.id);assert.deepEqual(after.attempt.prepared,a.prepared);assert.equal(after.attempt.version,a.version);
 // One obligation can never have a second attempt row.
 await db.query('SAVEPOINT duplicate');
 await assert.rejects(db.query("INSERT INTO food_refund110_attempts(binding_id,case_id,payment_id)SELECT binding_id,case_id,payment_id FROM food_refund110_attempts WHERE id=$1",[a.id]),/duplicate key/);
 await db.query('ROLLBACK TO SAVEPOINT duplicate');
}));

test('recording unknown is exact-once per version: stale and repeated calls change nothing, restart replays find the same journal',integration,async()=>inTransaction(async(db,a)=>{
 const unknown=(expected:string,why:string)=>asWorker(db,()=>db.query('SELECT food_refund110_unknown($1,$2,$3)',[a.id,expected,why]));
 const base=await view(db,a.id);
 await unknown(String(BigInt(a.version)-1n),'ds39-stale');
 assert.deepEqual(await view(db,a.id),base,'stale expected version is a no-op');
 await unknown(a.version,'ds39-provider-timeout');
 const once=await view(db,a.id);
 assert.equal(once.attempt.state,'UNKNOWN');assert.equal(once.attempt.version,String(BigInt(a.version)+1n));assert.deepEqual(once.attempt.prepared,a.prepared);
 assert.equal(once.observations.filter(o=>o.reason==='ds39-provider-timeout').length,1);
 // A duplicate callback / restarted worker replaying the same expected version has no effect.
 await unknown(a.version,'ds39-provider-timeout');
 assert.deepEqual(await view(db,a.id),once);
 // A new observation at the new version is a new, separate, ordered journal entry.
 await unknown(once.attempt.version,'ds39-still-unconfirmed');
 const twice=await view(db,a.id);assert.equal(twice.observations.length,once.observations.length+1);assert.equal(twice.attempt.version,String(BigInt(once.attempt.version)+1n));
 // State can never move out of UNKNOWN by direct writes, and the journal rows are immutable.
 await db.query('SAVEPOINT back');await assert.rejects(db.query("UPDATE food_refund110_attempts SET state='SIGNING',version=version+1,prepared=NULL WHERE id=$1",[a.id]),/IMMUTABLE_REFUND_ATTEMPT/);await db.query('ROLLBACK TO SAVEPOINT back');
 await db.query('SAVEPOINT erase');await assert.rejects(db.query('DELETE FROM food_refund110_observations WHERE attempt_id=$1',[a.id]),/immutable authority record/);await db.query('ROLLBACK TO SAVEPOINT erase');
}));

test('only the refund worker role can reach the journal; app and unrelated roles are refused',integration,async()=>inTransaction(async(db,a)=>{
 await db.query('SAVEPOINT app');await db.query('SET LOCAL ROLE bitpos_app');
 await assert.rejects(db.query('SELECT food_refund110_unknown($1,$2,$3)',[a.id,a.version,'ds39-app']),/permission denied/);
 await db.query('ROLLBACK TO SAVEPOINT app');
 await db.query('SAVEPOINT direct');await db.query('SET LOCAL ROLE bitpos_app');await assert.rejects(db.query('SELECT * FROM food_refund110_attempts'),/permission denied/);await db.query('ROLLBACK TO SAVEPOINT direct');
 // Even a superuser session that is not the worker login is refused by the role check inside the function.
 await assert.rejects(db.query('SELECT food_refund110_snapshot($1)',[a.id]),/REFUND_WORKER_ROLE_REQUIRED/);
}));
