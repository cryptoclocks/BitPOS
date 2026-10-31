import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import pg from 'pg';
const base='postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture';
const bin='/opt/homebrew/opt/postgresql@17/bin/';
const root=resolve('docs/plans/database-20261017');
const name='bitpos_location_throwaway_'+randomUUID().replaceAll('-','');
const url=new URL(base);url.pathname='/'+name;
const admin=new pg.Client({connectionString:base});await admin.connect();
const scratch=await mkdtemp(join(tmpdir(),'bitpos-location-'));
let created=false;
const evidence={status:'RUNNING',fixture:true,physicalTesting:'deferred_by_user_2026-10-16',copiedBusinessRows:0,sourceSha256:{} as Record<string,string>,output:'',failure:null as string|null,cleanup:false};
function run(binary:string,args:string[]){const r=spawnSync(bin+binary,args,{encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout;}
const clients:pg.Client[]=[];
try{
 await admin.query('CREATE DATABASE '+name);created=true;
 await writeFile(join(scratch,'schema.sql'),run('pg_dump',[base,'--schema-only','--no-owner','--no-privileges']));
 run('psql',[url.href,'-X','-q','-v','ON_ERROR_STOP=1','-f',join(scratch,'schema.sql')]);
 const original=await readFile(join(root,'fixtures/070-batch-behavior.sql'),'utf8');
 const boundary="SELECT pg_temp.ok('two active children share one exclusive generation9 lease'";
 assert.equal(original.split(boundary).length,2);
 let prefix=original.slice(0,original.indexOf(boundary));
 const constructor="CREATE FUNCTION pg_temp.new_food(label text,omit_shipment boolean DEFAULT false)";
 assert.equal(prefix.split(constructor).length,2);
 const secondCustomer=`INSERT INTO pg_temp.fixture_ids VALUES('second_account',gen_random_uuid()),('second_customer',gen_random_uuid()),('second_address',gen_random_uuid());
 INSERT INTO mobile_accounts(id,auth_subject) VALUES(pg_temp.fid('second_account'),gen_random_uuid());
 INSERT INTO customers(merchant_id,id) VALUES(pg_temp.fid('merchant'),pg_temp.fid('second_customer'));
 INSERT INTO mobile_customer_links(account_id,merchant_id,customer_id) VALUES(pg_temp.fid('second_account'),pg_temp.fid('merchant'),pg_temp.fid('second_customer'));
 INSERT INTO mobile_addresses(id,account_id,label,recipient_name,phone,address_text,instructions,latitude_e7,longitude_e7) VALUES(pg_temp.fid('second_address'),pg_temp.fid('second_account'),'second fixture','Synthetic receiver','+66912345678','Synthetic address, not a real delivery','',137560000,1005010000);
 `;
 prefix=prefix.replace(constructor,secondCustomer+constructor);
 for(const [before,after] of [
  ["ac uuid:=pg_temp.fid('account');","ac uuid:=CASE label WHEN 'b' THEN pg_temp.fid('second_account') ELSE pg_temp.fid('account') END;"],
  ["d.address_id:=pg_temp.fid('address');","d.address_id:=CASE label WHEN 'b' THEN pg_temp.fid('second_address') ELSE pg_temp.fid('address') END;"],
  ["VALUES(oid,m,pg_temp.fid('customer'),","VALUES(oid,m,CASE label WHEN 'b' THEN pg_temp.fid('second_customer') ELSE pg_temp.fid('customer') END,"],
  ["pg_temp.fid('account'),2,'GRANTED'","CASE label WHEN 'b' THEN pg_temp.fid('second_account') ELSE pg_temp.fid('account') END,2,'GRANTED'"],
 ]){assert.equal(prefix.split(before).length,2,before);prefix=prefix.replace(before,after);}
 const assets=(await readFile(resolve('supabase/migrations/025_payment_assets.sql'),'utf8')).match(/INSERT INTO payment_assets VALUES[\s\S]*?;/)?.[0];assert.ok(assets);
 const drafts=(await readdir(join(root,'drafts'))).filter(n=>n.endsWith('.sql')).sort();
 for(const file of [...drafts.map(n=>join(root,'drafts',n)),join(root,'fixtures/078-location-behavior.sql'),resolve('tools/runtime/platform-location-authority.ts')])evidence.sourceSha256[file.replace(resolve('.')+'/','')]=createHash('sha256').update(await readFile(file)).digest('hex');
 await writeFile(join(scratch,'proof.sql'),'BEGIN;SET search_path=bitpos,public;\n'+assets+'\n'+drafts.map(n=>'\\ir '+join(root,'drafts',n)).join('\n')+'\nCOMMIT;\n'+prefix+'\n\\ir '+join(root,'fixtures/078-location-behavior.sql')+'\n');
 evidence.output=run('psql',[url.href,'-X','-q','-v','ON_ERROR_STOP=1','-f',join(scratch,'proof.sql')]);
 evidence.output+=run('psql',[url.href,'-X','-q','-v','ON_ERROR_STOP=1','-c',`BEGIN ISOLATION LEVEL REPEATABLE READ;SET LOCAL search_path=bitpos,public;DO $rr$ DECLARE refused boolean:=false;BEGIN BEGIN PERFORM location078_snapshot('FOOD',gen_random_uuid(),1);EXCEPTION WHEN SQLSTATE '25001' THEN refused:=true;END;IF NOT refused THEN RAISE EXCEPTION 'REPEATABLE_READ_NOT_REFUSED';END IF;END $rr$;ROLLBACK;`]);
 const fixture=await readFile(join(root,'fixtures/078-location-behavior.sql'),'utf8');
 const sessionBoundary="SELECT pg_temp.ok('first fenced child sample accepted'";
 assert.equal(fixture.split(sessionBoundary).length,2);
 await writeFile(join(scratch,'persist.sql'),prefix+'\n'+fixture.split(sessionBoundary)[0]+'\nCREATE SCHEMA fixture_location;CREATE TABLE fixture_location.ids AS SELECT * FROM pg_temp.fixture_ids;COMMIT;\n');
 run('psql',[url.href,'-X','-q','-v','ON_ERROR_STOP=1','-f',join(scratch,'persist.sql')]);
 for(let i=0;i<3;i++){const client=new pg.Client({connectionString:url.href});await client.connect();await client.query('SET search_path=bitpos,public');clients.push(client);}
 const[a,b,observer]=clients;
 const ids=Object.fromEntries((await observer.query('SELECT name,id FROM fixture_location.ids')).rows.map(r=>[r.name,r.id]));
 async function bind(client:pg.Client,role:string){await client.query("SELECT set_config('bitpos.mobile_account',$1,false),set_config('bitpos.mobile_session',$2,false)",[ids[role==='driver'?'driver_account':'account'],ids[role+'_session']]);}
 const waitingPid=(await b.query<{pid:number}>('SELECT pg_backend_pid() pid')).rows[0].pid;
 async function blocked(){for(let i=0;i<80;i++){if((await observer.query<{yes:boolean}>('SELECT cardinality(pg_blocking_pids($1))>0 yes',[waitingPid])).rows[0].yes)return;await observer.query('SELECT pg_sleep(0.01)');}assert.fail('expected actual PostgreSQL lock wait');}
 await bind(a,'driver');await bind(b,'driver');
 const captured=(await observer.query<{at:string}>("SELECT clock_timestamp()::text at")).rows[0].at;
 const upload="SELECT location078_upload('FOOD',$1,2,9,1,$2,0,0,1000) changed";
 await a.query('BEGIN');await b.query('BEGIN');
 assert.equal((await a.query(upload,[ids['a.assignment'],captured])).rows[0].changed,true);
 const duplicate=b.query(upload,[ids['a.assignment'],captured]);
 await blocked();await a.query('COMMIT');
 assert.equal((await duplicate).rows[0].changed,false);await b.query('COMMIT');
 assert.deepEqual((await observer.query('SELECT count(*)::integer count,min(seq)::text seq FROM location_samples')).rows,[{count:1,seq:'1'}]);
 for(const ending of ['expiry','disabled']){
  await bind(b,'customer');
  await observer.query("UPDATE mobile_sessions SET access_expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1",[ids.customer_session]);
  await a.query('BEGIN');await a.query('SELECT 1 FROM driver_occupancy WHERE driver_id=$1 FOR NO KEY UPDATE',[ids.driver]);
  if(ending==='expiry')await observer.query("UPDATE mobile_sessions SET access_expires_at=clock_timestamp()+interval '300 milliseconds' WHERE id=$1",[ids.customer_session]);
  const snapshot=b.query("SELECT * FROM location078_snapshot('FOOD',$1,2)",[ids['a.assignment']]).then(()=>null,e=>e as {code?:string;message?:string});
  await blocked();
  if(ending==='expiry')await a.query('SELECT pg_sleep(0.4)');
  else await observer.query('UPDATE mobile_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[ids.account]);
  await a.query('COMMIT');const denied=await snapshot;
  assert.equal(denied?.code,'P0001');assert.match(denied?.message??'',/AUTH_REQUIRED/);
  await observer.query('UPDATE mobile_accounts SET disabled_at=NULL WHERE id=$1',[ids.account]);
 }
 assert.deepEqual((await observer.query('SELECT count(*)::integer count,min(seq)::text seq FROM location_samples')).rows,[{count:1,seq:'1'}]);
 evidence.output+='\nPersisted READ COMMITTED double-upload: one insert/one exact replay; actual occupancy-blocked expiry and account-disable snapshots refused AUTH_REQUIRED, history remains exact one seq1 row.\n';
 const dispatchGrant=randomUUID();
 await observer.query("INSERT INTO platform_staff_role_grants(id,account_id,role,granted_by,expires_at) VALUES($1,$2,'dispatcher','080 synthetic wait fixture',clock_timestamp()+interval '1 hour')",[dispatchGrant,ids.other_account]);
 await observer.query("INSERT INTO platform_role_scopes VALUES($1,'MERCHANT',$2)",[dispatchGrant,ids.merchant]);
 await b.query("SELECT set_config('bitpos.mobile_account',$1,false),set_config('bitpos.mobile_session',$2,false)",[ids.other_account,ids.alien_session]);
 await a.query('BEGIN');await a.query('SELECT 1 FROM driver_occupancy WHERE driver_id=$1 FOR NO KEY UPDATE',[ids.driver]);
 await observer.query("UPDATE platform_staff_role_grants SET expires_at=clock_timestamp()+interval '300 milliseconds' WHERE id=$1",[dispatchGrant]);
 const dispatchWait=b.query("SELECT * FROM location080_dispatch_snapshot('FOOD',$1,2,'080 actual expiry wait')",[ids['a.assignment']]).then(()=>null,e=>e as {code?:string;message?:string});
 await blocked();await a.query('SELECT pg_sleep(0.4)');await a.query('COMMIT');
 const dispatchDenial=await dispatchWait;assert.equal(dispatchDenial?.code,'42501');assert.match(dispatchDenial?.message??'',/LOCATION_SCOPE_REQUIRED/);
 assert.deepEqual((await observer.query('SELECT count(*)::integer n FROM privileged_access_audit')).rows,[{n:0}]);
 evidence.output+='\nScoped dispatcher expiry across observed occupancy wait denies42501 and leaves exact zero sensitive-access audit rows.\n';
 evidence.status='PASS';
}catch(error){evidence.status='FAIL';evidence.failure=String(error);process.exitCode=1;}
finally{
 for(const client of clients)await client.end();
 if(created)await admin.query('DROP DATABASE '+name+' WITH (FORCE)');
 await admin.end();await rm(scratch,{recursive:true,force:true});evidence.cleanup=true;
 await writeFile(resolve('.omp/work/flutter-delivery-20261016/evidence/location078-authority-20261017.json'),JSON.stringify(evidence,null,2)+'\n');
 await writeFile(resolve('.omp/work/flutter-delivery-20261016/evidence/location078-authority-'+Date.now()+'.json'),JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify(evidence));
}
