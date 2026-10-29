import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {MobileRideLocationSchema} from '../packages/contracts/src/mobile-v1.generated';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');

test('ride location is per-trip opt-in, latest-only, short-lived and removed at completion; incident text expires after 30 days',integration,async()=>{
 const {mobileRideRequest}=await import('../apps/api/src/mobile-rides');
 const {pool}=await import('../apps/api/src/db');
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 const account=async(name:string)=>{
  const id=randomUUID(),token=randomBytes(32).toString('base64url');
  await admin.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,display_name,locale) VALUES($1,$2,$3,'en')",[id,randomUUID(),name]);
  await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour',now()+interval '1 hour')",[id,randomUUID(),digest(token),digest(randomBytes(12).toString('hex'))]);
  return {id,bearer:'Bearer '+token};
 };
 const rider=await account('Location rider'),driver=await account('Location driver'),boss=await account('Location administrator'),support=await account('Location support');
 await admin.query("INSERT INTO bitpos.platform_staff_role_grants(account_id,role,granted_by,expires_at) VALUES($1,'administrator','local ride-location fixture',now()+interval '1 hour'),($2,'support','local ride-location fixture',now()+interval '1 hour')",[boss.id,support.id]);
 await admin.query("INSERT INTO bitpos.driver_profiles(account_id,display_name,license_expires_at,status,verified_until,verified_by,verification_reference) VALUES($1,'Local driver',now()+interval '2 days','APPROVED',now()+interval '1 day',$2,'Local fixture, not identity verification')",[driver.id,boss.id]);
 await admin.query('UPDATE bitpos.ride_fare_rates SET active=false');
 const call=(who:{bearer:string},method:string,path:string,body?:unknown)=>mobileRideRequest(new URL('http://localhost/api/mobile/v1/rides'+path),method,body,who.bearer) as Promise<any>;
 let tripId='';
 try{
  await call(boss,'PUT','/fare',{expectedRateId:null,currency:'THB',decimals:2,baseMinor:'3500',perKmMinor:'600',perMinuteMinor:'100',minimumMinor:'5000',sharedDiscountBps:0});
  const made=await call(rider,'POST','',{distanceMetres:5000,durationSeconds:600,seats:1,shared:false,idempotencyKey:randomUUID(),pickup:{latitudeE7:137560000,longitudeE7:1005018000},dropoff:{latitudeE7:137600000,longitudeE7:1005100000}});tripId=made.trip.id;
  await call(driver,'POST','/'+tripId+'/accept');await call(driver,'POST','/'+tripId+'/arrive');
  await assert.rejects(call(driver,'PUT','/'+tripId+'/location/consent',{enabled:true}),/TRIP_STATE_CONFLICT/);
  await call(driver,'POST','/'+tripId+'/start',{pin:made.pin});
  await assert.rejects(call(rider,'PUT','/'+tripId+'/location/consent',{enabled:true}),/RESOURCE_NOT_FOUND/,'rider cannot opt the driver in');
  assert.deepEqual(MobileRideLocationSchema.parse(await call(rider,'GET','/'+tripId+'/location')),{enabled:false,point:null,receivedAt:null,expiresAt:null});
  await assert.rejects(call(driver,'POST','/'+tripId+'/location',{latitudeE7:137570000,longitudeE7:1005020000}),/LOCATION_OPT_IN_REQUIRED/);
  assert.deepEqual(await call(driver,'PUT','/'+tripId+'/location/consent',{enabled:true}),{enabled:true});
  await call(driver,'POST','/'+tripId+'/location',{latitudeE7:137570000,longitudeE7:1005020000});
  const live=MobileRideLocationSchema.parse(await call(rider,'GET','/'+tripId+'/location'));
  assert.deepEqual(live.point,{latitudeE7:137570000,longitudeE7:1005020000});assert.equal(live.enabled,true);assert.ok(live.expiresAt);
  const shared=await call(rider,'POST','/'+tripId+'/share');const publicView=await call(rider,'GET','/shared/'+shared.token);
  assert.deepEqual(Object.keys(publicView).sort(),['expiresAt','state','updatedAt'],'public share never includes coordinates');
  await admin.query("UPDATE bitpos.passenger_trip_locations SET received_at=now()-interval '61 seconds' WHERE trip_id=$1",[tripId]);
  const stale=MobileRideLocationSchema.parse(await call(rider,'GET','/'+tripId+'/location'));assert.equal(stale.enabled,true);assert.equal(stale.point,null);assert.equal(stale.receivedAt,null);
  await call(driver,'POST','/'+tripId+'/location',{latitudeE7:137580000,longitudeE7:1005030000});
  await call(driver,'POST','/'+tripId+'/complete');
  assert.equal((await admin.query('SELECT 1 FROM bitpos.passenger_trip_locations WHERE trip_id=$1',[tripId])).rowCount,0,'terminal trip deletes the point');

  const incident=randomUUID();
  await admin.query("INSERT INTO bitpos.passenger_trip_incidents(id,trip_id,reporter_account_id,idempotency_key,kind,body,created_at) VALUES($1,$2,$3,$4,'SAFETY','private old report',now()-interval '31 days')",[incident,tripId,rider.id,randomUUID()]);
  await admin.query("INSERT INTO bitpos.passenger_trip_incident_reviews(incident_id,reviewer_account_id,outcome,note,reviewed_at) VALUES($1,$2,'NO_ACTION','private old review',now()-interval '31 days')",[incident,support.id]);
  await assert.rejects(admin.query("UPDATE bitpos.passenger_trip_incidents SET kind='OTHER' WHERE id=$1",[incident]),/IMMUTABLE_AUTHORITY_ROW/);
  const purged=(await pool.query('SELECT bitpos.ride_privacy_purge() AS count')).rows[0].count;assert.ok(Number(purged)>=2);
  assert.deepEqual((await admin.query('SELECT body,text_redacted_at IS NOT NULL AS redacted FROM bitpos.passenger_trip_incidents WHERE id=$1',[incident])).rows[0],{body:'[expired]',redacted:true});
  assert.deepEqual((await admin.query('SELECT note,text_redacted_at IS NOT NULL AS redacted FROM bitpos.passenger_trip_incident_reviews WHERE incident_id=$1',[incident])).rows[0],{note:'[expired]',redacted:true});
 }finally{
  await admin.query('UPDATE bitpos.ride_fare_rates SET active=false');
  if(tripId)await admin.query('DELETE FROM bitpos.passenger_trip_incident_reviews WHERE incident_id IN(SELECT id FROM bitpos.passenger_trip_incidents WHERE trip_id=$1)',[tripId]).catch(()=>undefined);
  await admin.end();await pool.end();
 }
});
