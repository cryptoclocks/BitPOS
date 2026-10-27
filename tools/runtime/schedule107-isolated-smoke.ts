import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
import {prepareFoodScheduleCandidate,releaseFoodScheduleCandidate} from '../../apps/api/src/food-schedule-candidate';
const exec=promisify(execFile),bin='/opt/homebrew/opt/postgresql@17/bin',dir=await mkdtemp(join(tmpdir(),'bitpos-schedule107-'));
const connection={host:dir,port:55442,database:'postgres'},merchant=randomUUID(),branch=randomUUID(),account=randomUUID(),session=randomUUID(),slot=randomUUID();
const source=await readFile('supabase/migrations/107_food_schedule_holds.sql','utf8');
let started=false,db:pg.Client|undefined;const checks:string[]=[];
async function client(){const c=new pg.Client(connection);await c.connect();return c;}
async function context(c:pg.Client,actor=account,sid=session,m=merchant){await c.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash','fixture-access',true),set_config('bitpos.merchant',$3,true)",[actor,sid,m]);}
async function transaction<T>(action:(c:pg.Client)=>Promise<T>){const c=await client();try{await c.query('BEGIN');await context(c);const result=await action(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{await c.end();}}
async function quote(expires=60000,owner=account){const id=randomUUID();await db!.query("INSERT INTO bitpos.order_quotes VALUES($1,$2,'online',$3,$4,$5,clock_timestamp()+($6::text||' milliseconds')::interval,'fixture-hash',true)",[merchant,id,owner,branch,JSON.stringify({serving:{kind:'pickup'}}),expires]);return id;}
try{
 await exec(join(bin,'initdb'),['-D',dir,'-A','trust','--no-locale','--encoding=UTF8']);
 await exec(join(bin,'pg_ctl'),['-D',dir,'-l',join(dir,'server.log'),'-o',`-h '' -k ${dir} -p 55442`,'-w','start']);started=true;db=await client();
 await db.query(`CREATE ROLE bitpos_app;CREATE SCHEMA bitpos;GRANT USAGE ON SCHEMA bitpos TO bitpos_app;SET search_path=bitpos,public;
 CREATE TABLE mobile_accounts(id uuid PRIMARY KEY,disabled_at timestamptz);
 CREATE TABLE mobile_sessions(id uuid PRIMARY KEY,account_id uuid REFERENCES mobile_accounts,revoked_at timestamptz,access_expires_at timestamptz,refresh_expires_at timestamptz,access_hash text);
 CREATE TABLE marketplace_branches(merchant_id uuid,id uuid,timezone text,enabled boolean,pickup_enabled boolean,delivery_enabled boolean,PRIMARY KEY(merchant_id,id));
 CREATE TABLE order_quotes(merchant_id uuid,id uuid,origin_kind text,source_account_id uuid,source_branch_id uuid,authority jsonb,valid_until timestamptz,request_hash text,configured boolean,PRIMARY KEY(merchant_id,id));
 CREATE TABLE order_authority(merchant_id uuid,quote_id uuid);
 CREATE FUNCTION immutable_authority_row()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'IMMUTABLE_AUTHORITY';END$$;
 -- Only configured-quote validation is stubbed. This is not full057/060 admission.
 CREATE FUNCTION assert_configured_quote(m uuid,q uuid)RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT 1 FROM order_quotes WHERE merchant_id=m AND id=q AND configured)THEN RAISE EXCEPTION 'CONFIGURED_OPTIONS_CHANGED';END IF;END$$;`);
 // Real current session/account/hash authorization routines, copied unmodified.
 for(const [file,name]of [['061_food_dispatch_runtime.sql','dispatch_live_actor'],['069_food_realtime.sql','dispatch_realtime_actor']]){
  const sql=await readFile('supabase/migrations/'+file,'utf8');const match=sql.match(new RegExp('CREATE FUNCTION '+name+'\\(\\)[\\s\\S]*?END \\$\\$;'));assert.ok(match,name);await db.query(match[0]);
 }
 await db.query(source);
 await db.query('INSERT INTO bitpos.mobile_accounts(id)VALUES($1)',[account]);
 await db.query("INSERT INTO bitpos.mobile_sessions VALUES($1,$2,NULL,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day','fixture-access')",[session,account]);
 await db.query("INSERT INTO bitpos.marketplace_branches VALUES($1,$2,'Asia/Bangkok',true,true,false)",[merchant,branch]);
 await db.query("INSERT INTO bitpos.schedule107_windows(id,merchant_id,branch_id,serving,timezone,starts_at,ends_at,kitchen_release_at,booking_closes_at,capacity)VALUES($1,$2,$3,'pickup','Asia/Bangkok',clock_timestamp()+interval '2 hours',clock_timestamp()+interval '2 hours 30 minutes',clock_timestamp()+interval '90 minutes',clock_timestamp()+interval '1 hour',1)",[slot,merchant,branch]);
 await assert.rejects(db.query("INSERT INTO bitpos.schedule107_windows(merchant_id,branch_id,serving,timezone,starts_at,ends_at,kitchen_release_at,booking_closes_at,capacity)SELECT merchant_id,branch_id,serving,timezone,starts_at+interval '1 minute',ends_at+interval '1 minute',kitchen_release_at,booking_closes_at,1 FROM bitpos.schedule107_windows WHERE id=$1",[slot]),/SCHEDULE_WINDOW_OVERLAP/);
 await assert.rejects(db.query("UPDATE bitpos.schedule107_windows SET capacity=2 WHERE id=$1",[slot]),/IMMUTABLE_SCHEDULE_WINDOW/);
 checks.push('Published absolute windows reject overlap and capacity mutation');
 const quotes=await Promise.all(Array.from({length:12},()=>quote()));
 const attempts=await Promise.allSettled(quotes.map(q=>transaction(c=>prepareFoodScheduleCandidate(c,slot,q,randomUUID()))));
 const wins=attempts.flatMap((r,i)=>r.status==='fulfilled'?[{receipt:r.value,index:i}]:[]);assert.equal(wins.length,1);
 assert.ok(attempts.filter(r=>r.status==='rejected').every(r=>r.status==='rejected'&&(r.reason as Error).message==='SCHEDULE_CAPACITY_EXHAUSTED'));
 const winner=wins[0].receipt;assert.equal(winner.checkoutReady,false);assert.equal(winner.state,'HELD');
 checks.push('12 concurrent canonical quote candidates: capacity1 admits exactly1');
 const command=randomUUID();await transaction(c=>releaseFoodScheduleCandidate(c,winner.id,command));
 const releases=await Promise.all(Array.from({length:8},()=>transaction(c=>releaseFoodScheduleCandidate(c,winner.id,command))));assert.ok(releases.every(r=>r.replayed&&r.state==='RELEASED'));
 const q2=await quote(),cmd2=randomUUID();const replay=await Promise.all(Array.from({length:12},()=>transaction(c=>prepareFoodScheduleCandidate(c,slot,q2,cmd2))));assert.equal(new Set(replay.map(r=>r.id)).size,1);assert.equal(replay.filter(r=>!r.replayed).length,1);
 await assert.rejects(transaction(c=>prepareFoodScheduleCandidate(c,slot,quotes[(wins[0].index+1)%quotes.length],cmd2)),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(transaction(c=>c.query('INSERT INTO bitpos.order_authority VALUES($1,$2)',[merchant,q2])),/SCHEDULE_CHECKOUT_NOT_ADMITTED/);
 await assert.rejects(db.query("UPDATE bitpos.schedule107_holds SET expires_at=expires_at+interval '1 minute'WHERE id=$1",[replay[0].id]),/IMMUTABLE_SCHEDULE_HOLD/);
 checks.push('Release/replay reclaim capacity;12 same commands produce1 hold; changed payload refused; billed gate and lease mutation refused');
 await transaction(c=>releaseFoodScheduleCandidate(c,replay[0].id,randomUUID()));
 const foreign=randomUUID();await db.query('INSERT INTO bitpos.mobile_accounts(id)VALUES($1)',[foreign]);const foreignQuote=await quote(60000,foreign);
 await assert.rejects(transaction(c=>prepareFoodScheduleCandidate(c,slot,foreignQuote,randomUUID())),/RESOURCE_NOT_FOUND/);
 await db.query('UPDATE bitpos.marketplace_branches SET enabled=false WHERE id=$1',[branch]);
 await assert.rejects(transaction(c=>prepareFoodScheduleCandidate(c,slot,quotes[0],randomUUID())),/SCHEDULE_SLOT_UNAVAILABLE/);
 await db.query('UPDATE bitpos.marketplace_branches SET enabled=true WHERE id=$1',[branch]);
 await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=clock_timestamp()WHERE id=$1',[session]);
 await assert.rejects(transaction(c=>prepareFoodScheduleCandidate(c,slot,q2,cmd2)),/AUTH_REQUIRED/);
 await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=NULL WHERE id=$1',[session]);
 checks.push('Foreign quote hidden; branch closure and real session revocation fail closed even on replay');
 const short=await quote(1200);const held=await transaction(c=>prepareFoodScheduleCandidate(c,slot,short,randomUUID()));
 await db.query('SELECT pg_sleep(1.3)');
 const sweeps=await Promise.all([transaction(c=>c.query('SELECT bitpos.schedule107_expire(50) n')),transaction(c=>c.query('SELECT bitpos.schedule107_expire(50) n'))]);
 assert.equal(sweeps.reduce((sum,r)=>sum+r.rows[0].n,0),1);
 assert.equal((await db.query('SELECT state FROM bitpos.schedule107_holds WHERE id=$1',[held.id])).rows[0].state,'EXPIRED');
 const fresh=await quote();const reclaimed=await transaction(c=>prepareFoodScheduleCandidate(c,slot,fresh,randomUUID()));assert.equal(reclaimed.state,'HELD');
 checks.push('Concurrent expiry sweeps commit exactly1 expiry and reclaim capacity');
 await db.query('SET ROLE bitpos_app');
 await assert.rejects(db.query('SELECT * FROM bitpos.schedule107_holds'),/permission denied/);
 await assert.rejects(db.query('SELECT bitpos.schedule107_hold($1,$2,$3)',[slot,q2,randomUUID()]),/permission denied/);await db.query('RESET ROLE');
 const rr=await client();try{await rr.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await context(rr);await assert.rejects(rr.query('SELECT bitpos.schedule107_expire(1)'),/SCHEDULE_READ_COMMITTED_REQUIRED/);await rr.query('ROLLBACK');}finally{await rr.end();}
 checks.push('App has no candidate table/function grant; repeatable-read mutation refused');
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/schedule107-isolated-20261021.json',JSON.stringify({status:'PASS_PRIVATE_SCHEDULING_CAPACITY_CANDIDATE',checkedAtUtc:new Date().toISOString(),migrationSha256:createHash('sha256').update(source).digest('hex'),checks,limits:['Socket-only disposable minimal schema; current real actor/session/hash functions but configured-quote helper is a double','No original fixture/actual-use installation; no public route or checkout admission','Stock/payment/order-bound schedule/kitchen/dispatch lifecycle and Flutter API joins remain open'],cleanup:'Owned PostgreSQL stopped and private directory removed in finally'},null,2)+'\n');
 console.log('PASS_PRIVATE_SCHEDULING_CAPACITY_CANDIDATE');
}finally{await db?.end();if(started)await exec(join(bin,'pg_ctl'),['-D',dir,'-m','fast','-w','stop']);await rm(dir,{recursive:true,force:true});}
