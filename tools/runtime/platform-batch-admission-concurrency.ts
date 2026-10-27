import pg from 'pg';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';

const base='postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture';
const bin='/opt/homebrew/opt/postgresql@17/bin/';
const root=resolve('docs/plans/database-20261017');
const ride=process.argv.includes('--ride');
const contender=ride?'RIDE':'SINGLE';
const claim=ride?'claim_ride':'claim_single';
const expiry=process.argv.includes('--expiry');
const publication=process.argv.includes('--publication');
const publicationHeader=process.argv.includes('--publication-header');
const name='bitpos_batch_throwaway_'+randomUUID().replaceAll('-','');
const target=new URL(base);target.pathname='/'+name;
const admin=new pg.Client({connectionString:base});await admin.connect();
const scratch=await mkdtemp(join(tmpdir(),'bitpos-batch-admission-'));
const clients:pg.Client[]=[];let created=false;
const evidence={status:'RUNNING',fixture:true,physicalTesting:'deferred_by_user_2026-10-16',copiedBusinessRows:0,checks:[] as string[],publicationOutcomes:[] as unknown[],failure:null as string|null,cleanup:false};
function psql(file:string){const r=spawnSync(bin+'psql',[target.href,'-X','-q','-v','ON_ERROR_STOP=1','-f',file],{encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);}
try{
 await admin.query('CREATE DATABASE '+name);created=true;
 const schema=spawnSync(bin+'pg_dump',[base,'--schema-only','--no-owner','--no-privileges'],{encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(schema.status,0,schema.stderr);
 await writeFile(join(scratch,'schema.sql'),schema.stdout);psql(join(scratch,'schema.sql'));
 const assets=(await readFile(resolve('supabase/migrations/025_payment_assets.sql'),'utf8')).match(/INSERT INTO payment_assets VALUES[\s\S]*?;/)?.[0];assert.ok(assets);
 const original=await readFile(join(root,'fixtures/070-batch-behavior.sql'),'utf8');
 const boundary="SET CONSTRAINTS ALL DEFERRED;\nSELECT draft070_lock_batch_admission(pg_temp.fid('batch'),1);\nUPDATE driver_occupancy SET assignment_generation=9 WHERE driver_id=pg_temp.fid('driver');";
 assert.equal(original.split(boundary).length,2,'exact initial admission boundary');
 const prefix=original.split(boundary)[0].replaceAll('pg_temp','fixture_probe').replace('CREATE TEMP TABLE probe_results','CREATE TABLE fixture_probe.probe_results').replace('CREATE TEMP TABLE fixture_ids','CREATE TABLE fixture_probe.fixture_ids').replace("interval '20 minutes'",expiry?"interval '5 seconds'":"interval '20 minutes'").replace('INSERT INTO batch_route_versions SELECT r.*;',publicationHeader?'INSERT INTO batch_route_versions SELECT r.*;\nIF rv=2 THEN PERFORM pg_advisory_xact_lock(1707002);END IF;':'INSERT INTO batch_route_versions SELECT r.*;');
 const admission=original.slice(original.indexOf(boundary),original.indexOf("SELECT pg_temp.ok('two active children share one exclusive generation9 lease'"));
 assert.ok(admission.endsWith('SET CONSTRAINTS ALL IMMEDIATE;\n'));
 const batchBody=admission.replaceAll('pg_temp','fixture_probe').replace("UPDATE driver_occupancy SET assignment_generation=9 WHERE driver_id=fixture_probe.fid('driver');","UPDATE driver_occupancy SET assignment_generation=9 WHERE driver_id=fixture_probe.fid('driver') AND assignment_generation=8;\nIF NOT FOUND THEN RAISE EXCEPTION 'OCCUPANCY_CHANGED' USING ERRCODE='40001';END IF;").replace('SELECT fixture_probe.accept_route','PERFORM fixture_probe.accept_route').replace('SELECT draft070_lock_batch_admission','PERFORM draft070_lock_batch_admission');
 const batchFunction='CREATE FUNCTION fixture_probe.claim_batch() RETURNS void LANGUAGE plpgsql SET search_path=bitpos,fixture_probe AS $race$ BEGIN\n'+batchBody+'\nEND $race$;\n';
 await writeFile(join(scratch,'proposal.sql'),prefix);
 const drafts=(await readdir(join(root,'drafts'))).filter(n=>n.endsWith('.sql')).sort();
 await writeFile(join(scratch,'seed.sql'),'BEGIN;SET search_path=bitpos,public;\n'+assets+'\n'+drafts.map(n=>'\\ir '+join(root,'drafts',n)).join('\n')+'\nCREATE SCHEMA fixture_probe;\n\\ir '+join(scratch,'proposal.sql')+'\n\\ir '+join(root,'fixtures/'+(ride?'070-ride-admission-race.sql':'070-single-admission-race.sql'))+'\n'+batchFunction+'\nCOMMIT;\n');psql(join(scratch,'seed.sql'));
 for(let i=0;i<3;i++){const c=new pg.Client({connectionString:target.href});await c.connect();clients.push(c);}
 const[a,b,observer]=clients;
 // Prove each graph is independently valid before exercising competition.
 for(const fn of ['claim_batch',claim]){
  await a.query('BEGIN;SET CONSTRAINTS ALL DEFERRED');await a.query('SELECT fixture_probe.'+fn+'()');await a.query('SET CONSTRAINTS ALL IMMEDIATE');await a.query('ROLLBACK');
  evidence.checks.push(fn+' independently valid, all effects rolled back');
 }
 if(publicationHeader){
  await observer.query('SELECT pg_advisory_lock(1707002)');
  for(const c of[a,b])await c.query("BEGIN;SET LOCAL statement_timeout='8s';SET CONSTRAINTS ALL DEFERRED");
  const ids=await Promise.all([a,b].map(async c=>(await c.query<{pid:number}>('SELECT pg_backend_pid() pid')).rows[0].pid));
  const finish=async(c:pg.Client,sql:string)=>{try{await c.query(sql);await c.query('SET CONSTRAINTS ALL IMMEDIATE');await c.query('COMMIT');return {status:'committed'};}catch(error){await c.query('ROLLBACK');return {status:'rejected',code:(error as {code?:string}).code,message:String(error)};}};
  const published=finish(a,'SELECT fixture_probe.route(2,0,1,8)');
  const waitBlocked=async(pid:number)=>{for(let i=0;i<100;i++){if((await observer.query<{blocked:boolean}>('SELECT cardinality(pg_blocking_pids($1))>0 blocked',[pid])).rows[0].blocked)return;await observer.query('SELECT pg_sleep(0.01)');}throw Error('Expected actual blocked transaction '+pid);};
  await waitBlocked(ids[0]);
  const admitted=finish(b,'SELECT fixture_probe.claim_batch()');
  await waitBlocked(ids[1]);await observer.query('SELECT pg_advisory_unlock(1707002)');
  const outcomes=await Promise.all([published,admitted]);evidence.publicationOutcomes=outcomes;
  assert.deepEqual(outcomes,[{status:'committed'},{status:'committed'}],'header/member interleaving must not deadlock');
  const rows=await observer.query("SELECT (SELECT count(*)::integer FROM bitpos.batch_route_versions) routes,(SELECT route_version::text FROM bitpos.delivery_batches) accepted_route,(SELECT count(*)::integer FROM bitpos.food_assignments) assignments,(SELECT count(*)::integer FROM bitpos.driver_assignment_leases WHERE state='ACTIVE') leases");
  assert.deepEqual(rows.rows,[{routes:2,accepted_route:'1',assignments:2,leases:1}]);
  evidence.checks.push('Publication paused after header before immediate member FKs; admission actually blocked; both complete with two proposals, route1 accepted, one lease/two children');evidence.status='PASS';
 }else if(publication){
  await a.query("BEGIN;SET LOCAL statement_timeout='5s';SET CONSTRAINTS ALL DEFERRED");
  await a.query('SELECT fixture_probe.route(2,0,1,8)');
  await b.query("BEGIN;SET LOCAL statement_timeout='5s';SET CONSTRAINTS ALL DEFERRED");
  const pid=(await b.query<{pid:number}>('SELECT pg_backend_pid() pid')).rows[0].pid;
  const acceptance=b.query('SELECT fixture_probe.claim_batch()');
  let blocked=false;
  for(let attempt=0;attempt<50;attempt++){
   if((await observer.query<{blocked:boolean}>('SELECT cardinality(pg_blocking_pids($1))>0 blocked',[pid])).rows[0].blocked){blocked=true;break;}
   await observer.query('SELECT pg_sleep(0.01)');
  }
  assert.equal(blocked,true,'admission must wait behind publication occupancy lock');
  await a.query('SET CONSTRAINTS ALL IMMEDIATE');await a.query('COMMIT');
  await acceptance;await b.query('SET CONSTRAINTS ALL IMMEDIATE');await b.query('COMMIT');
  const published=await observer.query("SELECT (SELECT count(*)::integer FROM bitpos.batch_route_versions) routes,(SELECT route_version::text FROM bitpos.delivery_batches) accepted_route,(SELECT count(*)::integer FROM bitpos.food_assignments) assignments,(SELECT count(*)::integer FROM bitpos.driver_assignment_leases WHERE state='ACTIVE') leases");
  assert.deepEqual(published.rows,[{routes:2,accepted_route:'1',assignments:2,leases:1}]);
  evidence.checks.push('Route publication versus actually blocked admission both commit without40P01; two immutable proposals retained, explicit route1 accepted, one lease/two children');evidence.status='PASS';
 }else if(expiry){
  await a.query('BEGIN');
  await a.query("SELECT id FROM bitpos.delivery_batches WHERE id=fixture_probe.fid('batch') FOR UPDATE");
  await b.query("BEGIN;SET LOCAL statement_timeout='15s';SET CONSTRAINTS ALL DEFERRED");
  const pid=(await b.query<{pid:number}>('SELECT pg_backend_pid() pid')).rows[0].pid;
  const admission=b.query('SELECT fixture_probe.claim_batch()').then(()=>null,error=>error as {code?:string;message?:string});
  let blocked=false;
  for(let attempt=0;attempt<50;attempt++){
   if((await observer.query<{blocked:boolean}>('SELECT cardinality(pg_blocking_pids($1))>0 blocked',[pid])).rows[0].blocked){blocked=true;break;}
   await observer.query('SELECT pg_sleep(0.01)');
  }
  assert.equal(blocked,true,'batch acceptance must actually wait before final server-clock validation');
  await a.query("SELECT pg_sleep(greatest(0,extract(epoch FROM(expires_at-clock_timestamp())))+0.05) FROM bitpos.batch_route_versions WHERE batch_id=fixture_probe.fid('batch') AND version=1");
  await a.query('COMMIT');
  const denied=await admission;assert.equal(denied?.code,'23514');assert.equal(denied?.message,'BATCH_ACCEPT_ROUTE_UNAVAILABLE_OR_EXPIRED');
  await b.query('ROLLBACK');
  const unchanged=await observer.query("SELECT (SELECT count(*)::int FROM bitpos.food_assignments) assignments,(SELECT count(*)::int FROM bitpos.driver_assignment_leases) leases,(SELECT assignment_generation::text FROM bitpos.driver_occupancy) generation");
  assert.deepEqual(unchanged.rows,[{assignments:0,leases:0,generation:'8'}]);
  evidence.checks.push('Route expires across actual batch-row lock wait: acceptance23514 refused; occupancy8/zero leases/zero assignments preserved');evidence.status='PASS';
 }else{
 for(const c of[a,b])await c.query("BEGIN;SET LOCAL statement_timeout='5s';SET CONSTRAINTS ALL DEFERRED");
 const outcomes=await Promise.allSettled([a.query('SELECT fixture_probe.claim_batch()').then(()=>a.query('COMMIT')),b.query('SELECT fixture_probe.'+claim+'()').then(()=>b.query('COMMIT'))]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 const losses=outcomes.filter((r):r is PromiseRejectedResult=>r.status==='rejected');assert.equal(losses.length,1);assert.equal(losses[0].reason.code,'40001');assert.equal(losses[0].reason.message,'OCCUPANCY_CHANGED');
 for(const c of[a,b])await c.query('ROLLBACK');
 const state=await observer.query("SELECT (SELECT count(*)::int FROM bitpos.driver_assignment_leases WHERE state='ACTIVE') leases,(SELECT assignment_generation::text FROM bitpos.driver_occupancy) generation,(SELECT count(*)::int FROM bitpos.food_assignments) assignments,(SELECT count(*)::int FROM bitpos.ride_assignments) rides,(SELECT count(*)::int FROM bitpos.batch_members) members");
 const winner=outcomes[0].status==='fulfilled'?'BATCH':contender;
 assert.deepEqual(state.rows,[{leases:1,generation:'9',assignments:winner==='BATCH'?2:ride?0:1,rides:winner==='RIDE'?1:0,members:winner==='BATCH'?2:0}]);
 evidence.checks.push('Concurrent individually valid BATCH versus '+contender+': '+winner+' wins; loser40001; exactly one active lease/highwater9 and only winner assignments persisted');evidence.status='PASS';
 }
}catch(error){evidence.status='FAIL';evidence.failure=String(error);process.exitCode=1;}
finally{
 for(const c of clients)await c.end().catch(()=>{});
 if(created){await admin.query('DROP DATABASE '+name);assert.equal((await admin.query('SELECT count(*)::int n FROM pg_database WHERE datname=$1',[name])).rows[0].n,0);}
 await admin.end();await rm(scratch,{recursive:true});evidence.cleanup=true;
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/platform-batch-'+(publicationHeader?'publication-header-':publication?'publication-':expiry?'expiry-':ride?'ride-':'')+'admission-concurrency-20261017.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}
