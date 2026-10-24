import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import pg from 'pg';
const path='supabase/migrations/088_driver_settlement.sql',source=await readFile(path,'utf8'),fingerprint=createHash('sha256').update(source).digest('hex');
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',application_name:'bitpos_settlement088_rollback_smoke',statement_timeout:10000});
const output='.omp/work/flutter-delivery-20261016/evidence/settlement088-schema-smoke-20261019.json';let connected=false;
try{
 await db.connect();connected=true;assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');assert.equal((await db.query("SELECT to_regclass('bitpos.settlement088_batches') n")).rows[0].n,null,'Candidate smoke must not silently reuse existing088');
 assert.match(source,/\nBEGIN;\n/);assert.match(source,/\nCOMMIT;\s*$/);
 await db.query(source.replace(/\nCOMMIT;\s*$/,'\n-- Parent rollback smoke deliberately never commits.\n'));
 const functions=(await db.query("SELECT p.proname name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='bitpos' AND p.proname LIKE 'settlement088_%' ORDER BY p.proname")).rows.map(row=>row.name);
 for(const name of ['settlement088_driver_snapshot','settlement088_worker_submission','settlement088_worker_reconcile','settlement088_assert_batch'])assert.ok(functions.includes(name));
 const acl=(await db.query(`SELECT has_function_privilege('bitpos_app','bitpos.settlement088_driver_snapshot(uuid)','EXECUTE') public_read,
 has_function_privilege('bitpos_app','bitpos.settlement088_worker_reconcile(uuid,jsonb)','EXECUTE') forbidden_worker,
 has_table_privilege('bitpos_app','bitpos.settlement088_attempts','SELECT') forbidden_signed_read,
 has_function_privilege('bitpos_settlement_worker','bitpos.settlement088_worker_reconcile(uuid,jsonb)','EXECUTE') private_worker`)).rows[0];
 assert.deepEqual(acl,{public_read:true,forbidden_worker:false,forbidden_signed_read:false,private_worker:true});
 await db.query('SET CONSTRAINTS ALL IMMEDIATE');await db.query('ROLLBACK');assert.equal((await db.query("SELECT to_regclass('bitpos.settlement088_batches') n")).rows[0].n,null);
 const receipt={status:'PASS_CANDIDATE_DDL_AND_LEAST_PRIVILEGE_ROLLED_BACK',source:path,sha256:fingerprint,functions,acl,rollback:true,limits:['DDL compilation and default-deny ACL only; deferred function SQL paths require canonical lifecycle execution','No actual-use migration, provider configuration, funds or full settlement acceptance'],physicalTesting:'deferred_by_user_2026-10-16'};await writeFile(output,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}catch(error){if(connected)await db.query('ROLLBACK');await writeFile(output,JSON.stringify({status:'FAIL_CANDIDATE_SCHEMA_SMOKE',source:path,sha256:fingerprint,error:error instanceof Error?error.message:'Unknown error',rollback:true},null,2)+'\n');throw error;}finally{if(connected)await db.end();}
