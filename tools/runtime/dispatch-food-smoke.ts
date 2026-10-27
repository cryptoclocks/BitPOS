import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'});
await db.connect();const passed:string[]=[];
try{
 await db.query('BEGIN');await db.query('SET LOCAL search_path=bitpos,public');
 const source=await readFile('supabase/migrations/061_food_dispatch_runtime.sql','utf8');
 if(!(await db.query("SELECT to_regclass('bitpos.food_dispatch_offers') AS installed")).rows[0].installed)await db.query(source);
 else await db.query(source.slice(source.indexOf('CREATE FUNCTION dispatch_live_actor')).replaceAll('CREATE FUNCTION ','CREATE OR REPLACE FUNCTION '));
 const account=randomUUID(),session=randomUUID(),merchant=randomUUID(),shipment=randomUUID();
 await db.query('INSERT INTO mobile_accounts(id,auth_subject) VALUES($1,$2)',[account,randomUUID()]);
 const hash=()=>createHash('sha256').update(randomBytes(32)).digest('hex');
 await db.query("INSERT INTO mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[session,account,randomUUID(),hash(),hash()]);
 await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true)",[account,session]);
 await db.query('SET LOCAL ROLE bitpos_app');
 async function denied(name:string,expected:string,sql:string,args:unknown[]){await db.query('SAVEPOINT negative');let message='';try{await db.query(sql,args);}catch(error){message=(error as Error).message;}finally{await db.query('ROLLBACK TO SAVEPOINT negative');await db.query('RELEASE SAVEPOINT negative');}assert.equal(message,expected,name);passed.push(name);}
 await denied('Unknown shipment has no offer authority','RESOURCE_NOT_FOUND','SELECT dispatch_food_offer($1,$2,$3::jsonb)',[shipment,randomUUID(),JSON.stringify({idempotencyKey:randomUUID(),expectedVersion:'1'})]);
 await denied('Unknown offer cannot create an assignment','RESOURCE_NOT_FOUND','SELECT dispatch_food_claim($1,$2::jsonb)',[randomUUID(),JSON.stringify({idempotencyKey:randomUUID(),expectedVersion:'1',generation:'1'})]);
 await denied('Application role cannot directly create leases','permission denied for table driver_assignment_leases',"INSERT INTO driver_assignment_leases(id,driver_id,generation,food_assignment_id,state) VALUES($1,$2,1,$3,'ACTIVE')",[randomUUID(),randomUUID(),randomUUID()]);
 await db.query('RESET ROLE');
 const acl=(await db.query("SELECT proname,has_function_privilege('public',p.oid,'EXECUTE') AS public_execute,has_function_privilege('bitpos_app',p.oid,'EXECUTE') AS app_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='bitpos' AND proname LIKE 'dispatch_%' ORDER BY proname")).rows;
 assert.ok(acl.every(row=>!row.public_execute));assert.ok(acl.every(row=>row.app_execute===['dispatch_food_offer','dispatch_food_claim','dispatch_food_arrive','dispatch_issue_proof','dispatch_food_location','dispatch_food_tracking','dispatch_consume_proof','dispatch_driver_work','dispatch_merchant_work','dispatch_merchant_issue_proof'].includes(row.proname)));passed.push('Only exact dispatch commands granted; private helpers deny application/public execution');
 const receipt={status:'PASS',passed,acl,rollback:true,limits:['Command compile and denied admission/ACL only; successful offer/claim/concurrency/custody/location/earnings not yet exercised'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch061-admission-smoke-20261018.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await db.query('ROLLBACK');await db.end();}
