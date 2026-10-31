import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};

test('worker retention job erases expired ride incident text and keeps young text and immutable facts (DS44)',integration,async()=>{
 const {tickRidePrivacy}=await import('../apps/worker/src/index');
 const {pool}=await import('../apps/api/src/db');
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 const acct=async()=>{const id=randomUUID();await admin.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,display_name,locale) VALUES($1,$2,'Retention','en')",[id,randomUUID()]);return id;};
 const rider=await acct();
 const trip=(await admin.query("INSERT INTO bitpos.passenger_trips(rider_account_id,idempotency_key,seats,shared,currency,decimals,fare_minor,distance_metres,duration_seconds,pickup_lat_e7,pickup_lng_e7,dropoff_lat_e7,dropoff_lng_e7,pin_salt,pin_hash,rate_id) SELECT $1,$2,1,false,'THB',2,5000,1000,60,1,1,2,2,'s','h',(SELECT id FROM bitpos.ride_fare_rates LIMIT 1) RETURNING id",[rider,randomUUID()]).catch(()=>null))?.rows[0]?.id as string|undefined;
 if(!trip){await admin.end();await pool.end();return assert.fail('fixture trip could not be inserted; ride_fare_rates row required');}
 const old=randomUUID(),young=randomUUID();
 try{
  await admin.query("INSERT INTO bitpos.passenger_trip_incidents(id,trip_id,reporter_account_id,idempotency_key,kind,body,created_at) VALUES($1,$2,$3,$4,'SAFETY','old private report',now()-interval '31 days'),($5,$2,$3,$6,'OTHER','recent private report',now()-interval '2 days')",[old,trip,rider,randomUUID(),young,randomUUID()]);
  await tickRidePrivacy();
  const body=async(id:string)=>(await admin.query('SELECT body,kind,reporter_account_id,text_redacted_at IS NOT NULL AS redacted FROM bitpos.passenger_trip_incidents WHERE id=$1',[id])).rows[0];
  assert.deepEqual(await body(old),{body:'[expired]',kind:'SAFETY',reporter_account_id:rider,redacted:true},'expired text erased, facts kept');
  assert.deepEqual(await body(young),{body:'recent private report',kind:'OTHER',reporter_account_id:rider,redacted:false},'young text untouched');
  await tickRidePrivacy();
  assert.equal((await body(old)).body,'[expired]','the job is idempotent');
 }finally{await admin.end();await pool.end();}
});
