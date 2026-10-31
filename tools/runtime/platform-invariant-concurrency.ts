import pg from 'pg';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';

// HISTORICAL060–082 metadata-only proof; current083/084 effects/export use their retained drivers.
// Schema-only LOCAL clone. Never copies business rows; always drops owned DB.
const base='postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture';
const bin='/opt/homebrew/opt/postgresql@17/bin/';
const root=resolve('docs/plans/database-20261017');
const name='bitpos_invariant_throwaway_'+randomUUID().replaceAll('-','');
const target=new URL(base);target.pathname='/'+name;
const admin=new pg.Client({connectionString:base});await admin.connect();
const scratch=await mkdtemp(join(tmpdir(),'bitpos-invariant-concurrency-'));
const clients:pg.Client[]=[];let created=false;
const evidence={status:'RUNNING',fixture:true,physicalTesting:'deferred_by_user_2026-10-16',copiedBusinessRows:0,checks:[] as string[],sqlAssertions:[] as {name:string;expected:string;observed:string}[],failure:null as null|string,cleanup:false};
function psql(file:string){const r=spawnSync(bin+'psql',[target.href,'-X','-q','-v','ON_ERROR_STOP=1','-f',file],{encoding:'utf8',maxBuffer:8*1024*1024});if(r.status!==0)throw Error(r.stderr+'\n'+r.stdout);}
try{
 await admin.query('CREATE DATABASE '+name);created=true;
 const schema=spawnSync(bin+'pg_dump',[base,'--schema-only','--no-owner','--no-privileges'],{encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(schema.status,0,schema.stderr);
 await writeFile(join(scratch,'schema.sql'),schema.stdout);psql(join(scratch,'schema.sql'));
 const fixtureRoot=join(root,'drafts/financial071');
 const assetMigration=await readFile(resolve('supabase/migrations/025_payment_assets.sql'),'utf8');
 const assetSeed=assetMigration.match(/INSERT INTO payment_assets VALUES[\s\S]*?;/)?.[0];assert.ok(assetSeed,'canonical static devnet asset seed');
 const seedClient=new pg.Client({connectionString:target.href});await seedClient.connect();try{await seedClient.query('SET search_path=bitpos,pg_temp');await seedClient.query(assetSeed);}finally{await seedClient.end();}
 const seedFiles=['071-fixture-base.sql','071-fixture-pickup-constructor.sql','fixture071-actors-food-payout.sql'];
 for(const file of seedFiles)await writeFile(join(scratch,file),await readFile(join(fixtureRoot,file),'utf8'));
 await writeFile(join(scratch,'074-zone-geometry.sql'),await readFile(join(root,'fixtures/074-zone-geometry.sql'),'utf8'));
 await writeFile(join(scratch,'075-privacy-authority.sql'),await readFile(join(root,'fixtures/075-privacy-authority.sql'),'utf8'));
 const drafts=(await readdir(join(root,'drafts'))).filter(n=>n.endsWith('.sql')&&Number(n.slice(0,3))<=82).sort();
 await writeFile(join(scratch,'seed.sql'),'BEGIN;\n'+drafts.map(n=>'\\ir '+join(root,'drafts',n)).join('\n')+'\n'+['071-fixture-base.sql','fixture071-actors-food-payout.sql','074-zone-geometry.sql','075-privacy-authority.sql'].map(n=>'\\ir '+join(scratch,n)).join('\n')+'\nSET CONSTRAINTS ALL IMMEDIATE;CREATE SCHEMA fixture_probe;CREATE TABLE fixture_probe.ids AS SELECT * FROM pg_temp.fixture_ids;CREATE TABLE fixture_probe.results AS SELECT * FROM pg_temp.probe_results;COMMIT;\n');psql(join(scratch,'seed.sql'));
 for(let i=0;i<3;i++){const c=new pg.Client({connectionString:target.href});await c.connect();clients.push(c);}
 const[a,b,observer]=clients;
 const ids=Object.fromEntries((await observer.query('SELECT name,id FROM fixture_probe.ids')).rows.map(r=>[r.name,r.id]));
 const behavior=await observer.query<{name:string;expected:string;observed:string}>('SELECT name,expected,observed FROM fixture_probe.results ORDER BY name');
 evidence.sqlAssertions=behavior.rows;
 try{
  await observer.query('INSERT INTO bitpos.service_zone_vertices(version_id,ordinal,latitude_e7,longitude_e7) VALUES($1,8,20,20)',[ids['geometry.concave']]);
  assert.fail('published polygon admitted a late vertex');
 }catch(error){assert.equal((error as {code?:string}).code,'23514');assert.match(String(error),/ZONE_HISTORY_IMMUTABLE/);}
 const polygon=await observer.query('SELECT count(*)::integer AS vertices FROM bitpos.service_zone_vertices WHERE version_id=$1',[ids['geometry.concave']]);
 assert.equal(polygon.rows[0].vertices,7);
 evidence.checks.push('Cross-transaction late polygon vertex rejected23514ZONE_HISTORY_IMMUTABLE; original7vertices preserved');
 // Two live owner requests race on the same one-use export token. Metadata
 // only: no archive bytes, storage provider, or customer download is implied.
 const exportId=randomUUID();
 await observer.query("INSERT INTO bitpos.privacy_exports(id,request_id,object_id,token_hash,expires_at,operator_grant_id) VALUES($1,$2,$3,$4,clock_timestamp()+interval '10 minutes',$5)",[exportId,ids['privacy.export_request'],ids['privacy.export_object'],'c'.repeat(64),ids['privacy.export_grant']]);
 const exportClaims=await Promise.allSettled([a,b].map(c=>c.query('SELECT bitpos.privacy075_claim_export($1,$2,$3) AS object_id',[exportId,ids.account,'c'.repeat(64)])));
 const exportWins=exportClaims.filter((r):r is PromiseFulfilledResult<pg.QueryResult>=>r.status==='fulfilled');
 const exportLosses=exportClaims.filter((r):r is PromiseRejectedResult=>r.status==='rejected');
 assert.equal(exportWins.length,1);assert.equal(exportLosses.length,1);
 assert.equal(exportWins[0].value.rows[0].object_id,ids['privacy.export_object']);
 assert.equal(exportLosses[0].reason.code,'42501');assert.equal(exportLosses[0].reason.message,'PRIVACY_EXPORT_UNAVAILABLE');
 const exportClaimState=await observer.query('SELECT claimed_at IS NOT NULL AS claimed,revoked_at IS NULL AS unrevoked FROM bitpos.privacy_exports WHERE id=$1',[exportId]);
 assert.deepEqual(exportClaimState.rows,[{claimed:true,unrevoked:true}]);
 evidence.checks.push('Two concurrent exact owner export-token claims: one private object admission, one42501 refusal; persisted one claimed token, no archive-byte delivery claim');
 const revokeId=randomUUID();
 await observer.query("INSERT INTO bitpos.privacy_exports(id,request_id,object_id,token_hash,expires_at,operator_grant_id) VALUES($1,$2,$3,$4,clock_timestamp()+interval '10 minutes',$5)",[revokeId,ids['privacy.export_request'],ids['privacy.export_object'],'8'.repeat(64),ids['privacy.export_grant']]);
 const pids=await Promise.all([a,b].map(async c=>(await c.query<{pid:number}>('SELECT pg_backend_pid() pid')).rows[0].pid));
 await observer.query('BEGIN');
 await observer.query('SELECT id FROM bitpos.mobile_accounts WHERE id=$1 FOR NO KEY UPDATE',[ids.driver_account]);
 const claimVersusRevoke=Promise.allSettled([
  a.query('SELECT bitpos.privacy075_claim_export($1,$2,$3) object_id',[revokeId,ids.account,'8'.repeat(64)]),
  b.query('SELECT bitpos.privacy075_revoke_export($1,$2,$3,$4) revoked',[revokeId,ids['privacy.export_grant'],ids['privacy.export_request'],ids.account])
 ]);
 let bothBlocked=false;
 for(let attempt=0;attempt<50;attempt++){
  const waiting=await observer.query<{n:number}>('SELECT count(*)::integer n FROM unnest($1::integer[]) pid WHERE cardinality(pg_blocking_pids(pid))>0',[pids]);
  if(waiting.rows[0].n===2){bothBlocked=true;break;}
  await observer.query('SELECT pg_sleep(0.01)');
 }
 assert.equal(bothBlocked,true,'both export mutations must acquire the same identity root before export rows');
 await observer.query('COMMIT');
 const [claimOutcome,revokeOutcome]=await claimVersusRevoke;
 assert.equal(revokeOutcome.status,'fulfilled');
 const wasRevoked=revokeOutcome.value.rows[0].revoked;
 if(wasRevoked){
  assert.equal(claimOutcome.status,'rejected');
  if(claimOutcome.status==='rejected'){assert.equal(claimOutcome.reason.code,'42501');assert.equal(claimOutcome.reason.message,'PRIVACY_EXPORT_UNAVAILABLE');}
 }else{
  assert.equal(claimOutcome.status,'fulfilled');
  if(claimOutcome.status==='fulfilled')assert.equal(claimOutcome.value.rows[0].object_id,ids['privacy.export_object']);
 }
 const finalExport=await observer.query('SELECT claimed_at IS NOT NULL claimed,revoked_at IS NOT NULL revoked,(SELECT count(*)::integer FROM bitpos.privacy_export_retirements WHERE export_id=$1) retirements FROM bitpos.privacy_exports WHERE id=$1',[revokeId]);
 assert.deepEqual(finalExport.rows,[{claimed:!wasRevoked,revoked:wasRevoked,retirements:wasRevoked?1:0}]);
 evidence.checks.push('Actually blocked claim-versus-revoke root-first race has one admission or one audited retirement, no40P01 and exact mutually exclusive persisted state');
 const rotatedIds=[randomUUID(),randomUUID()];
 const rotations=await Promise.allSettled([a,b].map((c,i)=>c.query("SELECT bitpos.privacy075_rotate_export($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '10 minutes') export_id",[ids['privacy.export_grant'],ids['privacy.export_request'],ids.account,rotatedIds[i],ids['privacy.export_object'],String(6+i).repeat(64)])));
 assert.equal(rotations.filter(r=>r.status==='fulfilled').length,2,'authorized distinct rotations serialize without deadlock');
 const rotatedState=await observer.query('SELECT count(*)::integer n,count(*) FILTER(WHERE revoked_at IS NULL AND claimed_at IS NULL)::integer live,count(*) FILTER(WHERE revoked_at IS NOT NULL)::integer retired,(SELECT count(*)::integer FROM bitpos.privacy_export_retirements WHERE export_id=ANY($1::uuid[])) retirement_facts FROM bitpos.privacy_exports WHERE id=ANY($1::uuid[])',[rotatedIds]);
 assert.deepEqual(rotatedState.rows,[{n:2,live:1,retired:1,retirement_facts:1}]);
 evidence.checks.push('Two concurrent authorized rotations serialize: both immutable issue histories retained, exactly one current unused token and one audited retirement');
 // Expiry must be checked after a real blocking session-row acquisition.
 const privacyBackend=(await b.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 const priorChunk=await observer.query('SELECT cursor,processed_count::text,(SELECT count(*)::text FROM bitpos.privacy_execution_audit WHERE request_id=$2) audit_count FROM bitpos.retention_jobs WHERE id=$1',[ids['privacy.job'],ids['privacy.request']]);
 for(const action of ['authority','chunk']){
 await observer.query("UPDATE bitpos.mobile_sessions SET access_expires_at=clock_timestamp()+interval '500 milliseconds' WHERE id=$1",[ids['privacy.session']]);
 await a.query('BEGIN');
 await a.query('SELECT id FROM bitpos.privacy_job_authorizations WHERE id=$1 FOR NO KEY UPDATE',[ids['privacy.worker']]);
 const waitingDelegation=(action==='authority'
  ?b.query('SELECT bitpos.privacy075_worker_require($1,$2,$3,$4)',[ids['privacy.worker'],ids['privacy.request'],'SQL_ONLY_WORKER','f'.repeat(64)])
  :b.query("UPDATE bitpos.retention_jobs SET cursor='UNAUTHORIZED_EXPIRED_CHUNK',processed_count=3 WHERE id=$1",[ids['privacy.job']])
 ).then(()=>null,error=>error as {code?:string;message?:string});
 let delegationBlocked=false;
 for(let attempt=0;attempt<50;attempt++){
  const blockers=await observer.query<{blocked:boolean}>('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[privacyBackend]);
  if(blockers.rows[0].blocked){delegationBlocked=true;break;}
  await observer.query('SELECT pg_sleep(0.01)');
 }
 assert.equal(delegationBlocked,true,'worker must wait after acquiring parent identity roots');
 await a.query('SELECT pg_sleep(0.6)');await a.query('COMMIT');
 const delegationDenial=await waitingDelegation;
 assert.equal(delegationDenial?.code,'42501');assert.match(delegationDenial?.message??'',/PRIVACY_SCOPE_REQUIRED/);
 await observer.query("UPDATE bitpos.mobile_sessions SET access_expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1",[ids['privacy.session']]);
 const afterChunk=await observer.query('SELECT cursor,processed_count::text,(SELECT count(*)::text FROM bitpos.privacy_execution_audit WHERE request_id=$2) audit_count FROM bitpos.retention_jobs WHERE id=$1',[ids['privacy.job'],ids['privacy.request']]);
 assert.deepEqual(afterChunk.rows,priorChunk.rows);
 evidence.checks.push('Session expiry across later delegation-row wait denies '+action+'42501; cursor/count/audit remain exactly unchanged after attempted operation');
 }
 await a.query('BEGIN');
 await a.query("UPDATE bitpos.mobile_sessions SET access_expires_at=clock_timestamp()+interval '100 milliseconds' WHERE id=$1",[ids['privacy.session']]);
 const waitingPrivacy=b.query('SELECT bitpos.privacy075_worker_require($1,$2,$3,$4)',[ids['privacy.worker'],ids['privacy.request'],'SQL_ONLY_WORKER','f'.repeat(64)]).then(()=>null,error=>error as {code?:string;message?:string});
 let blocked=false;
 for(let attempt=0;attempt<50;attempt++){
  const blockers=await observer.query<{blocked:boolean}>('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[privacyBackend]);
  if(blockers.rows[0].blocked){blocked=true;break;}
  await observer.query('SELECT pg_sleep(0.01)');
 }
 assert.equal(blocked,true,'privacy worker must actually wait on the held session row');
 await a.query('SELECT pg_sleep(0.15)');
 await a.query('COMMIT');
 const privacyDenial=await waitingPrivacy;
 assert.equal(privacyDenial?.code,'42501');assert.match(privacyDenial?.message??'',/PRIVACY_SCOPE_REQUIRED/);
 const unchanged=await observer.query('SELECT cursor,processed_count::text FROM bitpos.retention_jobs WHERE id=$1',[ids['privacy.job']]);
 assert.deepEqual(unchanged.rows,[{cursor:'SQL_FIXTURE_CURSOR_1',processed_count:'2'}]);
 evidence.checks.push('Session expiry across real row-lock wait denies delegated privacy execution42501; cursor/count preserved');
 // Original-unit refund-cap concurrency is owned by the ordered-chain financial
 // runner; do not retain the obsolete requested_by/mobile-only constructor here.
 evidence.status='PASS';
}catch(error){evidence.status='FAIL';evidence.failure=String(error);process.exitCode=1;}
finally{
 for(const c of clients)await c.end().catch(()=>{});
 if(created){await admin.query('DROP DATABASE '+name);const gone=await admin.query('SELECT count(*)::int n FROM pg_database WHERE datname=$1',[name]);assert.equal(gone.rows[0].n,0);}
 await admin.end();await rm(scratch,{recursive:true});evidence.cleanup=true;
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/platform-invariant-concurrency-20261017.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({...evidence,sqlAssertions:evidence.sqlAssertions.length}));
}
