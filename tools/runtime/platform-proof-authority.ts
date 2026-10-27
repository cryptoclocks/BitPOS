import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import pg from 'pg';
const base='postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture';
const bin='/opt/homebrew/opt/postgresql@17/bin/';
const root=resolve('docs/plans/database-20261017');
const name='bitpos_proof_throwaway_'+randomUUID().replaceAll('-','');
const url=new URL(base);url.pathname='/'+name;
const admin=new pg.Client({connectionString:base});await admin.connect();
const scratch=await mkdtemp(join(tmpdir(),'bitpos-proof-'));
let created=false;
const evidence={status:'RUNNING',fixture:true,physicalTesting:'deferred_by_user_2026-10-16',copiedBusinessRows:0,sourceSha256:{} as Record<string,string>,output:'',failure:null as string|null,cleanup:false};
function run(binary:string,args:string[]){const r=spawnSync(bin+binary,args,{encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout;}
const clients:pg.Client[]=[];
try{
 await admin.query('CREATE DATABASE '+name);created=true;
 await writeFile(join(scratch,'schema.sql'),run('pg_dump',[base,'--schema-only','--no-owner','--no-privileges']));
 run('psql',[url.href,'-X','-q','-v','ON_ERROR_STOP=1','-f',join(scratch,'schema.sql')]);
 const assets=(await readFile(resolve('supabase/migrations/025_payment_assets.sql'),'utf8')).match(/INSERT INTO payment_assets VALUES[\s\S]*?;/)?.[0];assert.ok(assets);
 const drafts=(await readdir(join(root,'drafts'))).filter(n=>n.endsWith('.sql')).sort();
 for(const path of [...drafts.map(n=>join(root,'drafts',n)),...(await readdir(join(root,'fixtures'))).filter(n=>n.endsWith('.sql')).map(n=>join(root,'fixtures',n)),resolve('supabase/migrations/025_payment_assets.sql'),resolve('tools/runtime/platform-proof-authority.ts')])evidence.sourceSha256[path.replace(resolve('.')+'/','')]=createHash('sha256').update(await readFile(path)).digest('hex');
 await writeFile(join(scratch,'proof.sql'),'BEGIN;SET search_path=bitpos,public;\n'+assets+'\n'+drafts.map(n=>'\\ir '+join(root,'drafts',n)).join('\n')+'\nCOMMIT;\n\\ir '+join(root,'fixtures/076-proof-behavior.sql')+'\n');
 evidence.output=run('psql',[url.href,'-X','-q','-v','ON_ERROR_STOP=1','-f',join(scratch,'proof.sql')]);
 const fixture=await readFile(join(root,'fixtures/076-proof-behavior.sql'),'utf8');
 const boundary="INSERT INTO pg_temp.answers076 SELECT 'pickup1',";
 assert.equal(fixture.split(boundary).length,2);
 await writeFile(join(scratch,'persist.sql'),fixture.split(boundary)[0]+'\nSET CONSTRAINTS ALL IMMEDIATE;CREATE SCHEMA fixture_proof;CREATE TABLE fixture_proof.ids AS SELECT * FROM pg_temp.fixture_ids;COMMIT;\n');
 run('psql',[url.href,'-X','-q','-v','ON_ERROR_STOP=1','-f',join(scratch,'persist.sql')]);
 for(let i=0;i<3;i++){const c=new pg.Client({connectionString:url.href});await c.connect();await c.query('SET search_path=bitpos,public');clients.push(c);}
 const[a,b,observer]=clients;
 const ids=Object.fromEntries((await observer.query('SELECT name,id FROM fixture_proof.ids')).rows.map(r=>[r.name,r.id]));
 for(const c of [a,b])await c.query("SELECT set_config('bitpos.merchant',$1,false)",[ids.merchant]);
 const rootVersion=(await observer.query('SELECT version::text v FROM food_shipments WHERE id=$1',[ids['live.shipment']])).rows[0].v;
 const expires=(await observer.query("SELECT (clock_timestamp()+interval '10 minutes')::text at")).rows[0].at;
 const issue="WITH result AS MATERIALIZED(SELECT bitpos.proof076_issue_merchant_pickup($1,repeat('7',64),$2,ROW($3,ROW($4,$5,2,$6,8)::bitpos.proof076_fence,$7,$8)::bitpos.proof076_issue_request) answer) SELECT (answer).* FROM result";
 const args=(key:string,digest:string)=>[ids.merchant,ids['live.shipment'],key,ids['live.assignment'],rootVersion,ids['live.lease'],digest,expires];
 const pid=(await b.query<{pid:number}>('SELECT pg_backend_pid() pid')).rows[0].pid;
 await a.query('BEGIN');await b.query('BEGIN');
 const first=(await a.query(issue,args(randomUUID(),'1'.repeat(64)))).rows[0];
 const secondArgs=args(randomUUID(),'2'.repeat(64));const rotating=b.query(issue,secondArgs);
 let waited=false;
 for(let i=0;i<80;i++){if((await observer.query<{blocked:boolean}>('SELECT cardinality(pg_blocking_pids($1))>0 blocked',[pid])).rows[0].blocked){waited=true;break;}await observer.query('SELECT pg_sleep(0.01)');}
 assert.equal(waited,true,'second rotation waits at canonical root');
 await a.query('COMMIT');const second=(await rotating).rows[0];await b.query('COMMIT');
 assert.notEqual(first.proof_id,second.proof_id);
 assert.deepEqual((await observer.query("SELECT count(*)::integer n FROM fulfillment_proofs WHERE assignment_id=$1 AND kind='PICKUP' AND revoked_at IS NULL AND consumed_at IS NULL",[ids['live.assignment']])).rows,[{n:1}]);
 assert.equal((await observer.query('SELECT revoked_at IS NOT NULL revoked FROM fulfillment_proofs WHERE id=$1',[first.proof_id])).rows[0].revoked,true);
 const reconnect=new pg.Client({connectionString:url.href});await reconnect.connect();clients.push(reconnect);
 await reconnect.query("SELECT set_config('bitpos.merchant',$1,false)",[ids.merchant]);
 const replay=(await reconnect.query(issue,secondArgs)).rows[0];assert.equal(replay.proof_id,second.proof_id);assert.equal(replay.recovery_required,true);
 assert.deepEqual((await observer.query("SELECT count(*)::integer n FROM merchant_platform_commands WHERE operation='proof076.issue.pickup'")).rows,[{n:2}]);
 evidence.output+='\nPersisted competing different-key pickup rotations serialize at actual canonical root; two immutable journals, exactly one live proof, predecessor revoked; same-envelope reconnect-safe replay retains winner with no third journal.\n';
 // Actual058 account-first command contends with root/occupancy-first proof.
 await observer.query('INSERT INTO driver_availability(driver_id) VALUES($1) ON CONFLICT DO NOTHING',[ids.driver]);
 for(const c of [a,b])await c.query("SELECT set_config('bitpos.mobile_account',$1,false),set_config('bitpos.mobile_session',$2,false)",[ids.driver_account,ids['driver_account.session']]);
 const availabilityVersion=(await observer.query('SELECT version::text v FROM driver_availability WHERE driver_id=$1',[ids.driver])).rows[0].v;
 await a.query('BEGIN');await a.query("SELECT proof076_lock_food($1,ROW($2,$3,2,$4,8)::proof076_fence)",[ids['live.shipment'],ids['live.assignment'],rootVersion,ids['live.lease']]);
 await b.query('BEGIN');
 const identity=b.query("SELECT driver_identity_command('availability',NULL,$1::jsonb)",[JSON.stringify({idempotencyKey:randomUUID(),expectedVersion:availabilityVersion,online:false})]);
 waited=false;
 for(let i=0;i<80;i++){if((await observer.query<{blocked:boolean}>('SELECT cardinality(pg_blocking_pids($1))>0 blocked',[pid])).rows[0].blocked){waited=true;break;}await observer.query('SELECT pg_sleep(0.01)');}
 assert.equal(waited,true,'actual058 identity command waits on proof-held occupancy after account');
 const mobileIssue="WITH result AS MATERIALIZED(SELECT proof076_issue_customer_delivery($1,ROW($2,ROW($3,$4,2,$5,8)::proof076_fence,$6,$7)::proof076_issue_request) answer) SELECT (answer).* FROM result";
 const mobileArgs=[ids['live.shipment'],randomUUID(),ids['live.assignment'],rootVersion,ids['live.lease'],'3'.repeat(64),expires];
 const authRetry=await a.query(mobileIssue,mobileArgs).then(()=>null,e=>e as {code?:string;message?:string});
 assert.equal(authRetry?.code,'40001');assert.match(authRetry?.message??'',/PROOF076_AUTH_RETRY/);
 await a.query('ROLLBACK');await identity;await b.query('COMMIT');
 const freshDenial=await a.query(mobileIssue,mobileArgs).then(()=>null,e=>e as {code?:string;message?:string});
 assert.equal(freshDenial?.code,'42501');assert.match(freshDenial?.message??'',/PROOF076_OWNER/);
 assert.deepEqual((await observer.query("SELECT count(*)::integer n FROM merchant_platform_commands WHERE operation='proof076.issue.pickup'")).rows,[{n:2}]);
 assert.deepEqual((await observer.query("SELECT count(*)::integer n FROM platform_commands WHERE operation='proof076.issue.delivery'")).rows,[{n:0}]);
 evidence.output+='\nActual058 account-first availability blocked on proof-held occupancy: actual076 mobile issuer returns explicit40001 AUTH_RETRY, releases transaction, identity completes; exact-envelope retry reauthorizes and denies wrong owner42501, no proof/journal/custody effect.\n';
 // Explicit owner-fixture custody counterpart, not a runtime secret verifier.
 await a.query('BEGIN;SET CONSTRAINTS ALL DEFERRED');
 await a.query("SELECT proof076_lock_food($1,ROW($2,$3,2,$4,8)::proof076_fence)",[ids['live.shipment'],ids['live.assignment'],rootVersion,ids['live.lease']]);
 await a.query("UPDATE food_shipments SET state='AT_PICKUP',version=version+1 WHERE id=$1",[ids['live.shipment']]);
 await a.query("UPDATE food_assignments SET state='AT_PICKUP' WHERE id=$1",[ids['live.assignment']]);
 await b.query('BEGIN');
 const losingRotation=b.query(issue,args(randomUUID(),'4'.repeat(64))).then(()=>null,e=>e as {code?:string;message?:string});
 waited=false;
 for(let i=0;i<80;i++){if((await observer.query<{blocked:boolean}>('SELECT cardinality(pg_blocking_pids($1))>0 blocked',[pid])).rows[0].blocked){waited=true;break;}await observer.query('SELECT pg_sleep(0.01)');}
 assert.equal(waited,true,'rotation waits behind root-first custody counterpart');
 const consumed=(await a.query("UPDATE fulfillment_proofs SET consumed_at=clock_timestamp(),consumed_by=$2 WHERE id=$1 RETURNING consumed_at::text at",[second.proof_id,ids.driver_account])).rows[0].at;
 await a.query("UPDATE food_assignments SET state='PICKED_UP',picked_up_at=$2 WHERE id=$1",[ids['live.assignment'],consumed]);
 await a.query("UPDATE order_fulfillment SET status='COLLECTED',version=version+1 WHERE order_id=$1",[ids['live.order']]);
 await a.query("UPDATE food_shipments SET state='PICKED_UP',version=version+1 WHERE id=$1",[ids['live.shipment']]);
 await a.query('SET CONSTRAINTS ALL IMMEDIATE;COMMIT');
 const rotationDenial=await losingRotation;assert.equal(rotationDenial?.code,'40001');assert.match(rotationDenial?.message??'',/PROOF076_ROOT_VERSION/);await b.query('ROLLBACK');
 assert.deepEqual((await observer.query("SELECT count(*)::integer n FROM fulfillment_proofs WHERE assignment_id=$1 AND kind='PICKUP' AND consumed_at IS NOT NULL",[ids['live.assignment']])).rows,[{n:1}]);
 assert.deepEqual((await observer.query("SELECT count(*)::integer n FROM merchant_platform_commands WHERE operation='proof076.issue.pickup'")).rows,[{n:2}]);
 evidence.output+='\nRoot-first owner-fixture pickup custody wins against actual076 rotation; blocked issuer rejects stale root40001, exact one consumed pickup/two prior journals and no new issuance. This proves SQL lifecycle serialization, not runtime secret verification.\n';
 evidence.status='PASS';
}catch(error){evidence.status='FAIL';evidence.failure=String(error);process.exitCode=1;}
finally{
 for(const c of clients)await c.end();
 if(created)await admin.query('DROP DATABASE '+name+' WITH (FORCE)');
 await admin.end();await rm(scratch,{recursive:true,force:true});evidence.cleanup=true;
 await writeFile(resolve('.omp/work/flutter-delivery-20261016/evidence/proof076-authority-20261017.json'),JSON.stringify(evidence,null,2)+'\n');
 await writeFile(resolve('.omp/work/flutter-delivery-20261016/evidence/proof076-authority-'+Date.now()+'.json'),JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify(evidence));
}
