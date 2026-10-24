// Named disposable local DB only; every schema/data mutation rolls back, including failures.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
import {FoodMerchantWorkSchema} from '../../packages/contracts/src/mobile-v1.generated';
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55446/bitpos_w01_fixture'});
const migration='supabase/migrations/136_food_merchant_rider_summary.sql',sql=await readFile(migration,'utf8'),checks:string[]=[];
await db.connect();
try{
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_w01_fixture');
 await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='2s'");await db.query('SET LOCAL search_path=bitpos,public');await db.query(sql);
 const fixture=(await db.query(`SELECT s.id shipment,s.merchant_id merchant,s.order_id oid,a.id assignment,a.driver_id driver,q.branch_id branch,p.account_id account,p.verified_by verifier,f.issued_grant_id sponsor
 FROM food_shipments s JOIN food_assignments a ON a.id=s.active_assignment_id JOIN quote_delivery_snapshots q ON(q.merchant_id,q.quote_id)=(s.merchant_id,s.quote_id)
 JOIN driver_profiles p ON p.id=a.driver_id JOIN driver_food_service_grants f ON(f.driver_id,f.merchant_id,f.branch_id)=(a.driver_id,s.merchant_id,q.branch_id)
 WHERE q.fixture AND a.closed_at IS NULL AND p.verified_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM food_assignment_incidents i WHERE i.assignment_id=a.id AND i.blocks_duty AND i.resolved_at IS NULL)
 ORDER BY a.accepted_at DESC LIMIT 1`)).rows[0];assert.ok(fixture,'Existing synthetic current assignment required');
 const token=randomUUID(),staff=randomUUID();
 await db.query("INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,'owner')",[staff,fixture.merchant]);
 await db.query("INSERT INTO sessions VALUES($1,$2,$3,'owner',clock_timestamp()+interval '1 hour')",[token,staff,fixture.merchant]);
 await db.query("UPDATE driver_profiles SET display_name=repeat(' ',80)||'Approved fixture rider'||repeat(' ',80),status='APPROVED',license_expires_at=clock_timestamp()+interval '2 days',verified_until=clock_timestamp()+interval '1 day' WHERE id=$1",[fixture.driver]);
 await db.query("UPDATE driver_vehicles SET registration_expires_at=clock_timestamp()+interval '2 days' WHERE driver_id=$1",[fixture.driver]);
 await db.query("UPDATE mobile_accounts SET disabled_at=NULL,display_name='Wrong general account nickname' WHERE id=$1",[fixture.account]);
 await db.query("UPDATE platform_staff_role_grants SET revoked_at=NULL,expires_at=clock_timestamp()+interval '1 day' WHERE id=$1",[fixture.sponsor]);
 await db.query('UPDATE mobile_accounts SET disabled_at=NULL WHERE id=(SELECT account_id FROM platform_staff_role_grants WHERE id=$1)',[fixture.sponsor]);
 await db.query("UPDATE driver_food_service_grants SET enabled=true,valid_until=clock_timestamp()+interval '1 hour',profile_version=(SELECT version FROM driver_profiles WHERE id=$1) WHERE driver_id=$1 AND merchant_id=$2 AND branch_id=$3",[fixture.driver,fixture.merchant,fixture.branch]);
 async function work(merchant=fixture.merchant,session=token){await db.query('SELECT set_config($1,$2,true)',['bitpos.merchant',merchant]);await db.query('SET LOCAL ROLE bitpos_app');const value=FoodMerchantWorkSchema.parse((await db.query('SELECT dispatch_merchant_work($1,$2) value',[fixture.oid,session])).rows[0].value);await db.query('RESET ROLE');return value;}
 const initial=await work();assert.ok(initial.assignment);assert.equal(initial.assignment.id,fixture.assignment);assert.deepEqual(initial.assignment.rider,{displayName:'Approved fixture rider'});checks.push('Approved current assignment exposes only reviewed displayName, never general nickname or private profile');
 for(const [label,statement,args]of [
 ['suspended',"UPDATE driver_profiles SET status='SUSPENDED',verified_until=NULL WHERE id=$1",[fixture.driver]],
 ['resubmitted',"UPDATE driver_profiles SET status='SUBMITTED',verified_until=NULL,display_name='Unreviewed replacement name' WHERE id=$1",[fixture.driver]],
 ['account disabled','UPDATE mobile_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[fixture.account]],
 ['verification expired',"UPDATE driver_profiles SET verified_until=clock_timestamp()-interval '1 second' WHERE id=$1",[fixture.driver]],
 ['registration expired',"UPDATE driver_vehicles SET registration_expires_at=clock_timestamp()-interval '1 second' WHERE driver_id=$1",[fixture.driver]],
 ['service revoked','UPDATE driver_food_service_grants SET enabled=false WHERE driver_id=$1 AND merchant_id=$2 AND branch_id=$3',[fixture.driver,fixture.merchant,fixture.branch]],
 ['profile generation stale','UPDATE driver_food_service_grants SET profile_version=profile_version+1 WHERE driver_id=$1 AND merchant_id=$2 AND branch_id=$3',[fixture.driver,fixture.merchant,fixture.branch]]
 ] as const){await db.query('SAVEPOINT variant');await db.query(statement,[...args]);const value=await work();assert.ok(value.assignment);assert.equal(value.assignment.rider,null,label);assert.equal(value.assignment.id,initial.assignment.id);assert.deepEqual(value.assignment.pickupProof,initial.assignment.pickupProof);await db.query('ROLLBACK TO SAVEPOINT variant');checks.push(label+': name absent while custody/proof metadata preserved');}
 for(const [label,merchant,session]of [['wrong tenant',randomUUID(),token],['invalid session',fixture.merchant,randomUUID()]] as const){await db.query('SAVEPOINT denied');await assert.rejects(()=>work(merchant,session),/RESOURCE_NOT_FOUND|ROLE_REQUIRED/);await db.query('ROLLBACK TO SAVEPOINT denied');checks.push(label+' denied');}
 await db.query('SAVEPOINT staff');await db.query("UPDATE members SET role='staff' WHERE user_id=$1 AND merchant_id=$2",[staff,fixture.merchant]);await assert.rejects(()=>work(),/ROLE_REQUIRED/);await db.query('ROLLBACK TO SAVEPOINT staff');checks.push('Current membership downgrade denied despite owner session label');
 await db.query('ROLLBACK');
 const evidence='.omp/work/flutter-delivery-20261016/evidence/merchant-rider-summary-sql-'+new Date().toISOString().replaceAll(':','-')+'.json';
 await writeFile(evidence,JSON.stringify({status:'PASS_TRANSACTIONAL_MERCHANT_RIDER_PRIVACY',migration,sourceRawSha256:createHash('sha256').update(sql).digest('hex'),checks,cleanup:'All schema/data mutations rolled back',limits:['Named existing synthetic local fixture only','Not HTTP/UI/replacement/concurrent-lock proof','Candidate136 not admitted or deployed'],physicalTesting:'deferred_by_user_2026-10-16'},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({evidence,checks}));
}finally{await db.query('ROLLBACK');await db.end();}
