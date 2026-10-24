import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
import {DriverReviewSummarySchema} from '../../packages/contracts/src/mobile-v1.generated';
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'});
await db.connect();
try{
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 await db.query('BEGIN');await db.query(await readFile('supabase/migrations/106_driver_review_summary.sql','utf8'));
 const drivers=(await db.query('SELECT d.id,d.account_id FROM bitpos.driver_profiles d JOIN bitpos.mobile_accounts m ON m.id=d.account_id WHERE m.disabled_at IS NULL AND NOT EXISTS(SELECT 1 FROM bitpos.mobile_food_reviews r WHERE r.driver_id=d.id) LIMIT 2')).rows;assert.equal(drivers.length,2);
 const [own,other]=drivers,session=randomUUID(),device=randomUUID(),access=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(access).digest('hex');
 await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours')",[session,own.account_id,device,hash,createHash('sha256').update(randomBytes(32)).digest('hex')]);
 await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true),set_config('bitpos.mobile_device',$4,true)",[own.account_id,session,hash,device]);
 async function summary(){await db.query('SET LOCAL ROLE bitpos_app');try{return DriverReviewSummarySchema.parse((await db.query('SELECT bitpos.driver106_review_summary() doc')).rows[0].doc);}finally{await db.query('RESET ROLE');}}
 const empty=await summary();assert.equal(empty.publishedCount,'0');assert.equal(empty.averageTenths,null);assert.equal(empty.driverId,own.id);
 const orders=(await db.query('SELECT f.merchant_id,f.order_id,f.branch_id FROM bitpos.online_food_orders f WHERE NOT EXISTS(SELECT 1 FROM bitpos.mobile_food_reviews r WHERE (r.merchant_id,r.order_id)=(f.merchant_id,f.order_id)) LIMIT 8')).rows;assert.equal(orders.length,8);
 const ids:string[]=[];
 for(const [index,stars] of [5,4,4,4,1,1,null,1].entries()){
  const f=orders[index],id=randomUUID();ids.push(id);
  await db.query("INSERT INTO bitpos.mobile_food_reviews(id,account_id,merchant_id,order_id,branch_id,driver_id,stars,driver_stars,body,state) VALUES($1,$2,$3,$4,$5,$6,5,$7,'Synthetic aggregate rollback fixture',$8)",[id,own.account_id,f.merchant_id,f.order_id,f.branch_id,index===7?other.id:own.id,stars,index===3?'PENDING':index===4?'REJECTED':index===5?'WITHDRAWN':'PUBLISHED']);
 }
 let value=await summary();assert.equal(value.publishedCount,'3');assert.equal(value.averageTenths,43);assert.deepEqual(Object.keys(value).sort(),['averageTenths','driverId','publishedCount','snapshotAt']);
 await db.query("UPDATE bitpos.mobile_food_reviews SET state='PUBLISHED' WHERE id=$1",[ids[3]]);value=await summary();assert.equal(value.publishedCount,'4');assert.equal(value.averageTenths,43,'4.25 rounds half-up to4.3 without float');
 await db.query('UPDATE bitpos.mobile_food_reviews SET driver_stars=4 WHERE id=$1',[ids[0]]);assert.equal((await summary()).averageTenths,40);
 await db.query("UPDATE bitpos.mobile_food_reviews SET state='WITHDRAWN' WHERE driver_id=$1",[own.id]);assert.equal((await summary()).averageTenths,null);
 await db.query('SAVEPOINT denied');await db.query('SET LOCAL ROLE bitpos_app');try{await db.query('SELECT * FROM bitpos.mobile_food_reviews');assert.fail('private table exposed');}catch(e){assert.equal((e as {code:string}).code,'42501');}await db.query('ROLLBACK TO denied');
 await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=clock_timestamp() WHERE id=$1',[session]);await db.query('SAVEPOINT revoked');await db.query('SET LOCAL ROLE bitpos_app');try{await db.query('SELECT bitpos.driver106_review_summary()');assert.fail('revoked session read');}catch(e){assert.equal((e as Error).message,'AUTH_REQUIRED');}await db.query('ROLLBACK TO revoked');
 await db.query('ROLLBACK');
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/driver106-review-summary-sql-20261020.json',JSON.stringify({status:'PASS_REAL_SCHEMA_ROLLBACK_DRIVER_RATING_AGGREGATE',checks:['Empty/null, published-only/non-null-driver-stars and current actor scope','Exact numeric rounding including4.25→4.3; moderation/edit/withdraw updates aggregate','No reviewer body/account exposed; private table denied; revoked current session denied','106 candidate DDL and all fixtures fully rolled back'],limits:['Privileged synthetic review aggregate fixtures over existing disposable order foreign keys; not new attribution/moderation HTTP acceptance','Original095 server attribution unchanged; no actual-use admission/native rating acceptance yet']},null,2)+'\n');console.log('PASS_REAL_SCHEMA_ROLLBACK_DRIVER_RATING_AGGREGATE');
}finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
