import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {createHash} from 'node:crypto';import {readFile,writeFile} from 'node:fs/promises';import pg from 'pg';
const name='088_driver_settlement.sql',db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'});
await db.connect();
try{
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 assert.equal((await db.query("SELECT to_regclass('bitpos.settlement088_batches') n")).rows[0].n,null,'Atomicity probe must precede actual disposable application');
 const sha=createHash('sha256').update(await readFile('supabase/migrations/'+name)).digest('hex');
 await db.query(`CREATE FUNCTION public.settlement088_fixture_ledger_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'EXPECTED_FIXTURE_LEDGER_FAILURE'; END $$`);
 await db.query(`CREATE TRIGGER settlement088_fixture_ledger_failure BEFORE INSERT ON public.bitpos_migrations FOR EACH ROW WHEN (NEW.name='088_driver_settlement.sql') EXECUTE FUNCTION public.settlement088_fixture_ledger_failure()`);
 const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','tools/runtime/apply-reviewed-delivery-migration.ts',name,sha,'dispatch088-local-apply-20261019.json'],{stdio:['ignore','pipe','pipe']});
 let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=chunk.toString();});
 const [code]=await once(child,'exit');assert.notEqual(code,0);assert.match(output,/EXPECTED_FIXTURE_LEDGER_FAILURE/);
 assert.equal((await db.query("SELECT to_regclass('bitpos.settlement088_batches') n")).rows[0].n,null,'DDL must roll back with ledger failure');
 assert.equal((await db.query('SELECT count(*)::int n FROM public.bitpos_migrations WHERE name=$1',[name])).rows[0].n,0);
 const receipt={status:'PASS_ACTUAL_HELPER_LEDGER_FAILURE_ROLLS_BACK_SCHEMA',migration:name,sourceSha256:sha,fixture:'Disposable55436 only; temporary migration-name-scoped failure trigger; no actual-use or provider operation',physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/settlement088-migration-atomicity-20261019.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{
 await db.query('DROP TRIGGER IF EXISTS settlement088_fixture_ledger_failure ON public.bitpos_migrations');await db.query('DROP FUNCTION IF EXISTS public.settlement088_fixture_ledger_failure()');await db.end();
}
