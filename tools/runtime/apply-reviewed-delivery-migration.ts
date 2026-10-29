import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
const [name,expected,receiptName]=process.argv.slice(2);
assert.match(name??'',/^\d{3}_[a-z0-9_]+\.sql$/);assert.match(expected??'',/^[0-9a-f]{64}$/);assert.match(receiptName??'',/^dispatch\d{3}-local-apply-\d{8}\.json$/);
const source=await readFile('supabase/migrations/'+name,'utf8'),sha=createHash('sha256').update(source).digest('hex');assert.equal(sha,expected,'Reviewed source hash drift');
// No environment/root config is loaded, and no remote target is configurable.
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'});await db.connect();
try{
 assert.equal((await db.query('SELECT current_database() n,inet_server_addr()::text host,inet_server_port() port')).rows[0].n,'bitpos_delivery_fixture');
 await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtextextended('bitpos.disposable_delivery_migrations',0))");
 const prior=(await db.query('SELECT source_sha256 FROM public.bitpos_migrations WHERE name=$1',[name])).rows[0];
 if(prior)assert.equal(prior.source_sha256,sha,'Applied source hash drift');
 else{
  const latest=(await db.query('SELECT name FROM public.bitpos_migrations ORDER BY name DESC LIMIT 1')).rows[0].name;
  assert.equal(Number(name.slice(0,3)),Number(latest.slice(0,3))+1,'Migration must follow current disposable ledger');
  // The helper owns the transaction and migration ledger atomically. A source
  // wrapper must not commit early and release our migration advisory lock.
  const body=source.replace(/\nBEGIN;\n/,'\n').replace(/\nCOMMIT;\s*$/,'\n');
  await db.query(body);await db.query('INSERT INTO public.bitpos_migrations(name,source_sha256) VALUES($1,$2)',[name,sha]);
 }
 await db.query('COMMIT');
 const evidence={status:prior?'ALREADY_APPLIED_SAME_REVIEWED_SOURCE':'APPLIED_REVIEWED_DISPOSABLE_ONLY',migration:name,sourceSha256:sha,database:'127.0.0.1:55436/bitpos_delivery_fixture',actualUseOrProduction:false,physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/'+receiptName,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
