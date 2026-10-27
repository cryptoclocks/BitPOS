import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {MobileRideQuoteSchema,MobileRideRequestedSchema,MobileRideTripSchema,MobileRideOpenSchema,MobileRideShareSchema,MobileRideSharedSchema,MobileRideShareRevokedSchema,MobileRideIncidentReceiptSchema,MobileRideCurrentSchema} from '../packages/contracts/src/mobile-v1.generated';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
test('mobile ride routes: bearer required, quote/request/accept/arrive/start/complete over the route layer, unknown paths pass through',integration,async()=>{
 // Loading boundary: skipped integration never loads private runtime config.
 const {mobileRideRequest}=await import('../apps/api/src/mobile-rides');
 const {pool}=await import('../apps/api/src/db');
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 const mk=async(name:string)=>{const id=randomUUID(),token=randomBytes(32).toString('base64url');
  await admin.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,display_name,locale) VALUES($1,$2,$3,'en')",[id,randomUUID(),name]);
  await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour',now()+interval '1 hour')",[id,randomUUID(),digest(token),digest(randomBytes(8).toString('hex'))]);
  return {id,bearer:'Bearer '+token};};
 const rider=await mk('Route rider'),driver=await mk('Route driver'),staff=await mk('Route staff');
 await admin.query("INSERT INTO bitpos.driver_profiles(account_id,display_name,license_expires_at,status,verified_until,verified_by,verification_reference) VALUES($1,'Synthetic',now()+interval '2 days','APPROVED',now()+interval '1 day',$2,'Synthetic fixture, not KYC')",[driver.id,staff.id]);
 await admin.query('UPDATE bitpos.ride_fare_rates SET active=false');
 await admin.query("INSERT INTO bitpos.ride_fare_rates(currency,decimals,base_minor,per_km_minor,per_minute_minor,minimum_minor,shared_discount_bps,active,published_by) VALUES('THB',2,3500,600,100,5000,2500,true,$1)",[staff.id]);
 const call=(who:{bearer:string}|null,method:string,path:string,body?:unknown)=>mobileRideRequest(new URL('http://localhost/api/mobile/v1/rides'+path),method,body,who?.bearer) as Promise<any>;
 try{
  assert.equal(await mobileRideRequest(new URL('http://localhost/api/mobile/v1/account/profile'),'GET',undefined,rider.bearer),undefined,'other paths pass through');
  await assert.rejects(call(null,'POST','/quote',{}),/AUTH_REQUIRED|UNAUTHORI|401/i,'a bearer is required');
  await assert.rejects(call(rider,'GET','/quote'),/INVALID_REQUEST/,'wrong method');
  await assert.rejects(call(rider,'POST','/quote?x=1'.replace('?x=1',''),{distanceMetres:1,durationSeconds:1,seats:1,shared:false,extra:1}),/INVALID_REQUEST/);
  const body={distanceMetres:5000,durationSeconds:600,seats:1,shared:false};
  assert.equal(MobileRideQuoteSchema.parse(await call(rider,'POST','/quote',body)).fare.amountMinor,'7500');
  assert.equal(MobileRideCurrentSchema.parse(await call(rider,'GET','/current')).trip,null,'no unfinished trip yet');
  const made=await call(rider,'POST','',{...body,idempotencyKey:randomUUID(),pickup:{latitudeE7:137560000,longitudeE7:1005018000},dropoff:{latitudeE7:137600000,longitudeE7:1005100000}});
  assert.equal((await call(rider,'GET','/current')).trip.id,made.trip.id,'the rider sees the open trip');
  MobileRideRequestedSchema.parse(made);const id=made.trip.id;assert.match(made.pin,/^\d{4}$/);
  assert.equal(MobileRideTripSchema.parse(await call(rider,'GET','/'+id)).state,'REQUESTED');
  await assert.rejects(call(driver,'GET','/'+id),/RESOURCE_NOT_FOUND/,'an unmatched driver cannot read it directly');
  assert.ok(MobileRideOpenSchema.parse(await call(driver,'GET','/open')).trips.some((t:{id:string})=>t.id===id));
  await assert.rejects(call(rider,'GET','/open'),/DRIVER_NOT_APPROVED/);
  assert.equal((await call(driver,'POST','/'+id+'/accept')).state,'MATCHED');
  assert.equal((await call(driver,'GET','/current')).trip.state,'MATCHED','the matched driver sees the job');
  assert.equal((await call(driver,'POST','/'+id+'/arrive')).state,'ARRIVED');
  await assert.rejects(call(driver,'POST','/'+id+'/start',{}),/INVALID_REQUEST/,'start needs a PIN');
  assert.equal((await call(driver,'POST','/'+id+'/start',{pin:made.pin})).state,'IN_TRIP');
  assert.equal((await call(driver,'POST','/'+id+'/complete')).state,'COMPLETED');
  await assert.rejects(call(driver,'POST','/'+id+'/unknown'),/RESOURCE_NOT_FOUND/);
  await assert.rejects(call(rider,'POST','/'+id),/INVALID_REQUEST/,'a trip is read with GET only');
  // Safety: share link + incidents (DS48).
  const next=await call(rider,'POST','',{...body,idempotencyKey:randomUUID(),pickup:{latitudeE7:137560000,longitudeE7:1005018000},dropoff:{latitudeE7:137600000,longitudeE7:1005100000}});
  const nid=next.trip.id;
  await assert.rejects(call(driver,'POST','/'+nid+'/share'),/RESOURCE_NOT_FOUND/,'only the rider shares');
  const share=MobileRideShareSchema.parse(await call(rider,'POST','/'+nid+'/share'));
  const stored=(await admin.query('SELECT token_hash FROM bitpos.passenger_trip_shares WHERE trip_id=$1',[nid])).rows[0];
  assert.notEqual(stored.token_hash,share.token,'only a hash is stored');
  const viewShared=()=>mobileRideRequest(new URL('http://localhost/api/mobile/v1/rides/shared/'+share.token),'GET',undefined,undefined) as Promise<any>;
  const seen=MobileRideSharedSchema.parse(await viewShared());assert.equal(seen.state,'REQUESTED');
  assert.deepEqual(Object.keys(seen).sort(),['expiresAt','state','updatedAt'],'no people, places or fare are exposed');
  await assert.rejects(mobileRideRequest(new URL('http://localhost/api/mobile/v1/rides/shared/'+share.token.slice(0,-2)+'xx'),'GET',undefined,undefined),/RESOURCE_NOT_FOUND/,'a wrong token reveals nothing');
  await call(driver,'POST','/'+nid+'/accept');
  assert.equal((await viewShared()).state,'MATCHED','the share link follows the trip');
  const inc={idempotencyKey:randomUUID(),kind:'SAFETY',body:'Driver took a different route'};
  const receipt=MobileRideIncidentReceiptSchema.parse(await call(rider,'POST','/'+nid+'/incidents',inc));
  assert.equal((await call(rider,'POST','/'+nid+'/incidents',inc)).id,receipt.id,'replay returns the same incident');
  await assert.rejects(call(rider,'POST','/'+nid+'/incidents',{...inc,body:'Changed'}),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(call(rider,'POST','/'+nid+'/incidents',{idempotencyKey:randomUUID(),kind:'SAFETY',body:'   '}),/INVALID_REQUEST/);
  await assert.rejects(call(rider,'POST','/'+nid+'/incidents',{idempotencyKey:randomUUID(),kind:'MONEY',body:'x'}),/INVALID_REQUEST/);
  assert.equal(MobileRideIncidentReceiptSchema.parse(await call(driver,'POST','/'+nid+'/incidents',{idempotencyKey:randomUUID(),kind:'CONDUCT',body:'Rider was abusive'})).kind,'CONDUCT','the matched driver can report too');
  const stranger=await mk('Stranger');
  await assert.rejects(call(stranger,'POST','/'+nid+'/incidents',{idempotencyKey:randomUUID(),kind:'OTHER',body:'x'}),/RESOURCE_NOT_FOUND/,'a non-party cannot report');
  await assert.rejects(admin.query('UPDATE bitpos.passenger_trip_incidents SET body=$1',['edited']),/./,'incidents are append-only');
  assert.equal(MobileRideShareRevokedSchema.parse(await call(rider,'POST','/'+nid+'/share/revoke')).revoked,1);
  await assert.rejects(viewShared(),/RESOURCE_NOT_FOUND/,'a revoked link stops working');
  await call(driver,'POST','/'+nid+'/arrive');await call(driver,'POST','/'+nid+'/cancel');
  await assert.rejects(call(rider,'POST','/'+nid+'/share'),/TRIP_STATE_CONFLICT/,'a finished trip cannot be shared');
  // Expiry: a link past its time stops working.
  const again=await call(rider,'POST','',{...body,idempotencyKey:randomUUID(),pickup:{latitudeE7:137560000,longitudeE7:1005018000},dropoff:{latitudeE7:137600000,longitudeE7:1005100000}});
  const live=MobileRideShareSchema.parse(await call(rider,'POST','/'+again.trip.id+'/share'));
  await admin.query("UPDATE bitpos.passenger_trip_shares SET expires_at=now()-interval '1 second' WHERE trip_id=$1",[again.trip.id]);
  await assert.rejects(mobileRideRequest(new URL('http://localhost/api/mobile/v1/rides/shared/'+live.token),'GET',undefined,undefined),/RESOURCE_NOT_FOUND/,'an expired link stops working');
 }finally{await admin.query('UPDATE bitpos.ride_fare_rates SET active=false');await admin.end();await pool.end();}
});
