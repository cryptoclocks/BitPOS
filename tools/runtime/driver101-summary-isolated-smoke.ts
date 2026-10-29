import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import pg from 'pg';
import {DriverDailyEarningsSchema} from '../../packages/contracts/src/mobile-v1.generated';
const exec=promisify(execFile),bin='/opt/homebrew/opt/postgresql@17/bin',dir=await mkdtemp(join(tmpdir(),'bitpos-summary101-isolated-'));
let started=false;let db:pg.Client|undefined;
const owner='a1000000-0000-4000-8000-000000000001',driver='a1000000-0000-4000-8000-000000000002',foreign='a1000000-0000-4000-8000-000000000003';
try{
 await exec(join(bin,'initdb'),['-D',dir,'-A','trust','--no-locale','--encoding=UTF8']);
 // Unix socket only, no second network/staging stack; directory is private mkdtemp.
 await exec(join(bin,'pg_ctl'),['-D',dir,'-l',join(dir,'server.log'),'-o',`-h '' -k ${dir} -p 55439`,'-w','start']);started=true;
 db=new pg.Client({host:dir,port:55439,database:'postgres'});await db.connect();
 await db.query(`CREATE ROLE bitpos_app;CREATE SCHEMA bitpos;SET search_path=bitpos,public;
 CREATE TABLE driver_profiles(id uuid PRIMARY KEY,account_id uuid NOT NULL);
 CREATE TABLE food_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),driver_id uuid,state text,closed_at timestamptz);
 CREATE TABLE earning_accruals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),driver_id uuid,food_assignment_id uuid,state text,created_at timestamptz);
 CREATE TABLE earning_accrual_facts(accrual_id uuid PRIMARY KEY,amount_minor bigint,currency text,decimals smallint);
 -- Explicit test doubles. These DO NOT establish real dispatch/settlement auth acceptance.
 CREATE FUNCTION settlement088_mode() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'SETTLEMENT_READ_COMMITTED_REQUIRED';END IF; END $$;
 CREATE FUNCTION settlement088_live_actor() RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN
 IF nullif(current_setting('test101.account',true),'') IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 RETURN current_setting('test101.account')::uuid;END $$;
 GRANT USAGE ON SCHEMA bitpos TO bitpos_app;`);
 await db.query(await readFile('supabase/migrations/101_driver_daily_earnings.sql','utf8'));
 await db.query('INSERT INTO bitpos.driver_profiles VALUES($1,$2),($3,$3)',[driver,owner,foreign]);
 await db.query("SELECT set_config('test101.account',$1,false)",[owner]);
 await db.query(`WITH day AS(SELECT date_trunc('day',statement_timestamp() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok' start),
 samples AS(SELECT * FROM (VALUES
 ($1::uuid,'AVAILABLE',123::bigint,'USD',2,interval '0 seconds'),
 ($1::uuid,'AVAILABLE',9007199254740993::bigint,'USD',2,interval '1 microsecond'),
 ($1::uuid,'HELD',2000000::bigint,'USDG',6,interval '0 seconds'),
 ($1::uuid,'SETTLED',300::bigint,'USD',2,interval '0 seconds'),
 ($1::uuid,'REVERSED',400::bigint,'USD',2,interval '0 seconds'),
 ($1::uuid,'AVAILABLE',777::bigint,'USD',2,interval '-1 microsecond'),
 ($1::uuid,'AVAILABLE',888::bigint,'USD',2,interval '24 hours'),
 ($2::uuid,'AVAILABLE',999::bigint,'USD',2,interval '0 seconds')
 )v(driver,state,amount,currency,decimals,offset_time)),
 ids AS(SELECT gen_random_uuid() id,* FROM samples), inserted AS(
 INSERT INTO bitpos.earning_accruals(id,driver_id,food_assignment_id,state,created_at)
 SELECT id,driver,gen_random_uuid(),state,day.start+offset_time FROM ids CROSS JOIN day RETURNING id)
 INSERT INTO bitpos.earning_accrual_facts SELECT ids.id,amount,currency,decimals FROM ids JOIN inserted USING(id)`,[driver,foreign]);
 await db.query(`WITH day AS(SELECT date_trunc('day',statement_timestamp() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok' start)
 INSERT INTO bitpos.food_assignments(driver_id,state,closed_at)
 SELECT $1::uuid,'DELIVERED',start FROM day UNION ALL SELECT $1::uuid,'DELIVERED',start-interval '1 microsecond' FROM day
 UNION ALL SELECT $1::uuid,'CANCELLED',start FROM day UNION ALL SELECT $2::uuid,'DELIVERED',start FROM day`,[driver,foreign]);
 await db.query('SET ROLE bitpos_app');
 const result=DriverDailyEarningsSchema.parse((await db.query('SELECT bitpos.driver101_daily_earnings() doc')).rows[0].doc);
 assert.equal(result.completedDeliveries,'1');assert.equal(result.groups.length,4);
 const available=result.groups.find(g=>g.state==='AVAILABLE')!;
 assert.equal(available.money.amountMinor,'9007199254741116');assert.equal(available.count,'2');
 assert.equal(result.groups.find(g=>g.state==='HELD')!.money.currency,'USDG');
 assert.equal(new Date(result.dayStart).getUTCHours(),17);
 assert.equal(Date.parse(result.dayEnd)-Date.parse(result.dayStart),86400000);
 assert.equal(result.isTransferTotal,false);
 await db.query('RESET ROLE');await db.query("SELECT set_config('test101.account',$1,false)",[foreign]);await db.query('SET ROLE bitpos_app');
 const other=DriverDailyEarningsSchema.parse((await db.query('SELECT bitpos.driver101_daily_earnings() doc')).rows[0].doc);
 assert.equal(other.groups.length,1);assert.equal(other.groups[0].money.amountMinor,'999');
 await db.query('RESET ROLE');await db.query("SELECT set_config('test101.account',$1,false)",['a1000000-0000-4000-8000-000000000099']);
 await assert.rejects(db.query('SELECT bitpos.driver101_daily_earnings()'),/ROLE_REQUIRED/);
 await db.query("SELECT set_config('test101.account','',false)");await assert.rejects(db.query('SELECT bitpos.driver101_daily_earnings()'),/AUTH_REQUIRED/);
 await db.query("SELECT set_config('test101.account',$1,false)",[owner]);
 await db.query(`INSERT INTO bitpos.earning_accruals(driver_id,food_assignment_id,state,created_at) VALUES($1,gen_random_uuid(),'AVAILABLE',clock_timestamp()-interval '1 second') RETURNING id`,[driver]).then(async r=>{await db!.query("INSERT INTO bitpos.earning_accrual_facts VALUES($1,9223372036854775807,'USD',2)",[r.rows[0].id]);});
 await assert.rejects(db.query('SELECT bitpos.driver101_daily_earnings()'),/AMOUNT_OVERFLOW/);
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/driver101-isolated-sql-20261020.json',JSON.stringify({status:'PASS_ISOLATED_POSTGRES_CALCULATION',checks:['Bangkok midnight start included, previous-day microsecond and next-day start excluded','Exact sum beyond JS safe integer, currency/state separation','Own driver filtered, delivered count excludes cancellation/foreign/previous day','Overflow refused; missing actor/profile refused using explicitly stubbed auth'],limits:['Minimal isolated tables and auth doubles; not actual schema/source constraints/session revocation or API integration proof','No existing fixture or actual-use migrations installed'],cleanup:'Disposable socket-only PostgreSQL stopped and directory removed in finally'},null,2)+'\n');
 console.log('PASS_ISOLATED_POSTGRES_CALCULATION');
}finally{
 await db?.end();if(started)await exec(join(bin,'pg_ctl'),['-D',dir,'-m','fast','-w','stop']);await rm(dir,{recursive:true,force:true});
}
