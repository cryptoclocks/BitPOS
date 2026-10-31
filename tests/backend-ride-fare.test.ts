import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {MobileRideFareSchema,MobileRideFareStateSchema,MobileRideIncidentQueueSchema,MobileRideIncidentReviewedSchema} from '../packages/contracts/src/mobile-v1.generated';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
test('ride fare publication: administrators only, optimistic replacement, one active rate, quotes follow it',integration,async()=>{
 // Loading boundary: skipped integration never loads private runtime config.
 const {mobileRideRequest}=await import('../apps/api/src/mobile-rides');
 const {pool}=await import('../apps/api/src/db');
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 const mk=async(name:string)=>{const id=randomUUID(),token=randomBytes(32).toString('base64url');
  await admin.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,display_name,locale) VALUES($1,$2,$3,'en')",[id,randomUUID(),name]);
  await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour',now()+interval '1 hour')",[id,randomUUID(),digest(token),digest(randomBytes(8).toString('hex'))]);
  return {id,bearer:'Bearer '+token};};
 const boss=await mk('Admin'),dispatcher=await mk('Dispatcher'),rider=await mk('Rider');
 await admin.query("INSERT INTO bitpos.platform_staff_role_grants(account_id,role,granted_by,expires_at) VALUES($1,'administrator','Synthetic fixture',now()+interval '1 hour'),($2,'dispatcher','Synthetic fixture',now()+interval '1 hour')",[boss.id,dispatcher.id]);
 await admin.query('UPDATE bitpos.ride_fare_rates SET active=false');
 const call=(who:{bearer:string},method:string,path:string,body?:unknown)=>mobileRideRequest(new URL('http://localhost/api/mobile/v1/rides'+path),method,body,who.bearer) as Promise<any>;
 const rate={currency:'THB',decimals:2,baseMinor:'3500',perKmMinor:'600',perMinuteMinor:'100',minimumMinor:'5000',sharedDiscountBps:2500};
 try{
  await assert.rejects(call(rider,'GET','/fare'),/ROLE_REQUIRED/);
  await assert.rejects(call(dispatcher,'PUT','/fare',{expectedRateId:null,...rate}),/ROLE_REQUIRED/,'only administrators publish');
  assert.equal(MobileRideFareStateSchema.parse(await call(boss,'GET','/fare')).fare,null);
  await assert.rejects(call(rider,'POST','/quote',{distanceMetres:5000,durationSeconds:600,seats:1,shared:false}),/FARES_UNPUBLISHED/);
  for(const bad of [{...rate,currency:'EUR'},{...rate,decimals:3},{...rate,minimumMinor:'0'},{...rate,baseMinor:'-1'},{...rate,sharedDiscountBps:9500},{...rate,extra:1}])
   await assert.rejects(call(boss,'PUT','/fare',{expectedRateId:null,...bad}),/INVALID_REQUEST/);
  const first=MobileRideFareSchema.parse(await call(boss,'PUT','/fare',{expectedRateId:null,...rate}));
  assert.equal(first.minimumMinor,'5000');
  assert.equal((await call(rider,'POST','/quote',{distanceMetres:5000,durationSeconds:600,seats:1,shared:false})).fare.amountMinor,'7500');
  await assert.rejects(call(boss,'PUT','/fare',{expectedRateId:null,...rate}),/FARE_CHANGED/,'stale expectation is refused');
  const second=MobileRideFareSchema.parse(await call(boss,'PUT','/fare',{expectedRateId:first.rateId,...rate,baseMinor:'4000'}));
  assert.notEqual(second.rateId,first.rateId);
  assert.equal((await call(rider,'POST','/quote',{distanceMetres:5000,durationSeconds:600,seats:1,shared:false})).fare.amountMinor,'8000','quotes follow the new rate');
  assert.equal((await admin.query('SELECT count(*)::int n FROM bitpos.ride_fare_rates WHERE active')).rows[0].n,1,'exactly one active rate');
  assert.equal((await admin.query('SELECT count(*)::int n FROM bitpos.ride_fare_rates WHERE id=$1',[first.rateId])).rows[0].n,1,'the old rate is kept');
  assert.equal(MobileRideFareStateSchema.parse(await call(boss,'GET','/fare')).fare?.rateId,second.rateId);
  const race=await Promise.allSettled([call(boss,'PUT','/fare',{expectedRateId:second.rateId,...rate,baseMinor:'4100'}),call(boss,'PUT','/fare',{expectedRateId:second.rateId,...rate,baseMinor:'4200'})]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1,'concurrent publishers: exactly one wins');
 // Staff incident review (support/administrator only; a note, never money).
  const support=await mk('Support'),driver=await mk('Driver');
  await admin.query("INSERT INTO bitpos.platform_staff_role_grants(account_id,role,granted_by,expires_at) VALUES($1,'support','Synthetic fixture',now()+interval '1 hour')",[support.id]);
  await admin.query("INSERT INTO bitpos.driver_profiles(account_id,display_name,license_expires_at,status,verified_until,verified_by,verification_reference) VALUES($1,'Synthetic',now()+interval '2 days','APPROVED',now()+interval '1 day',$2,'Synthetic fixture, not KYC')",[driver.id,boss.id]);
  const made=await call(rider,'POST','',{distanceMetres:5000,durationSeconds:600,seats:1,shared:false,idempotencyKey:randomUUID(),pickup:{latitudeE7:137560000,longitudeE7:1005018000},dropoff:{latitudeE7:137600000,longitudeE7:1005100000}});
  await call(driver,'POST','/'+made.trip.id+'/accept');
  const rep=await call(rider,'POST','/'+made.trip.id+'/incidents',{idempotencyKey:randomUUID(),kind:'SAFETY',body:'Unsafe driving'});
  await call(driver,'POST','/'+made.trip.id+'/incidents',{idempotencyKey:randomUUID(),kind:'CONDUCT',body:'Rider refused seatbelt'});
  await assert.rejects(call(rider,'GET','/incidents'),/ROLE_REQUIRED/);await assert.rejects(call(dispatcher,'GET','/incidents'),/ROLE_REQUIRED/,'dispatchers do not review incidents');
  const queue=MobileRideIncidentQueueSchema.parse(await call(support,'GET','/incidents'));
  assert.ok(queue.incidents.some(i=>i.id===rep.id&&i.reporterRole==='RIDER'));assert.ok(queue.incidents.some(i=>i.reporterRole==='DRIVER'));
  await assert.rejects(call(rider,'POST','/incidents/'+rep.id+'/review',{outcome:'NO_ACTION',note:'x'}),/ROLE_REQUIRED/);
  await assert.rejects(call(support,'POST','/incidents/'+rep.id+'/review',{outcome:'REFUND',note:'x'}),/INVALID_REQUEST/,'no money outcomes');
  await assert.rejects(call(support,'POST','/incidents/'+rep.id+'/review',{outcome:'NO_ACTION',note:' '}),/INVALID_REQUEST/);
  await assert.rejects(call(support,'POST','/incidents/'+randomUUID()+'/review',{outcome:'NO_ACTION',note:'x'}),/RESOURCE_NOT_FOUND/);
  assert.equal(MobileRideIncidentReviewedSchema.parse(await call(support,'POST','/incidents/'+rep.id+'/review',{outcome:'FOLLOW_UP',note:'Call the rider'})).outcome,'FOLLOW_UP');
  await assert.rejects(call(boss,'POST','/incidents/'+rep.id+'/review',{outcome:'NO_ACTION',note:'again'}),/ALREADY_REVIEWED/,'one review per incident');
  assert.ok(!MobileRideIncidentQueueSchema.parse(await call(support,'GET','/incidents')).incidents.some(i=>i.id===rep.id),'reviewed incidents leave the queue');
  await assert.rejects(admin.query('UPDATE bitpos.passenger_trip_incident_reviews SET note=$1',['edited']),/./,'reviews are append-only');
 }finally{await admin.query('UPDATE bitpos.ride_fare_rates SET active=false');await admin.end();await pool.end();}
});
