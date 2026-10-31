import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import pg from 'pg';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const loc={pickup:{latitudeE7:137560000,longitudeE7:1005018000},dropoff:{latitudeE7:137600000,longitudeE7:1005100000}};

/** Reads a share link from a brand-new Node process, i.e. nothing is cached in the API process that created it. */
function viewInFreshProcess(token:string):{ok:boolean;state?:string;error?:string}{
 const code="const {sharedTripView}=require('./apps/api/src/passenger-trips');const {pool}=require('./apps/api/src/db');sharedTripView(process.argv[1]).then(v=>console.log(JSON.stringify({ok:true,state:v.state})),e=>console.log(JSON.stringify({ok:false,error:String(e.message??e)}))).finally(()=>pool.end());";
 const out=execFileSync(process.execPath,['--import','tsx','-e',code,token],{cwd:process.cwd(),env:process.env,encoding:'utf8',timeout:60000});
 return JSON.parse(out.trim().split('\n').pop()!);
}

test('ride share links: foreign actors, revoke, expiry and a restarted process (DS48)',integration,async()=>{
 const {mobileRideRequest}=await import('../apps/api/src/mobile-rides');
 const {pool}=await import('../apps/api/src/db');
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 const mk=async(name:string)=>{const id=randomUUID(),token=randomBytes(32).toString('base64url');
  await admin.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,display_name,locale) VALUES($1,$2,$3,'en')",[id,randomUUID(),name]);
  await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour',now()+interval '1 hour')",[id,randomUUID(),digest(token),digest(randomBytes(8).toString('hex'))]);
  return {id,bearer:'Bearer '+token};};
 const rider=await mk('Share rider'),driver=await mk('Share driver'),stranger=await mk('Share stranger'),staff=await mk('Share staff');
 await admin.query("INSERT INTO bitpos.driver_profiles(account_id,display_name,license_expires_at,status,verified_until,verified_by,verification_reference) VALUES($1,'Synthetic',now()+interval '2 days','APPROVED',now()+interval '1 day',$2,'share-restart fixture')",[driver.id,staff.id]);
 await admin.query('UPDATE bitpos.ride_fare_rates SET active=false');
 await admin.query("INSERT INTO bitpos.ride_fare_rates(currency,decimals,base_minor,per_km_minor,per_minute_minor,minimum_minor,shared_discount_bps,active,published_by) VALUES('THB',2,3500,600,100,5000,2500,true,$1)",[staff.id]);
 const call=(who:{bearer:string}|null,method:string,path:string,body?:unknown)=>mobileRideRequest(new URL('http://localhost/api/mobile/v1/rides'+path),method,body,who?.bearer) as Promise<any>;
 const body={distanceMetres:5000,durationSeconds:600,seats:1,shared:false,idempotencyKey:randomUUID(),...loc};
 try{
  const made=await call(rider,'POST','',body);const id=made.trip.id;
  await assert.rejects(call(stranger,'POST','/'+id+'/share'),/RESOURCE_NOT_FOUND/,'a foreign account cannot create a link');
  const link=await call(rider,'POST','/'+id+'/share');
  await assert.rejects(call(stranger,'POST','/'+id+'/share/revoke'),/RESOURCE_NOT_FOUND/,'a foreign account cannot revoke');
  await call(driver,'POST','/'+id+'/accept');
  await assert.rejects(call(driver,'POST','/'+id+'/share/revoke'),/RESOURCE_NOT_FOUND/,'even the matched driver cannot revoke the rider link');
  assert.equal((await mobileRideRequest(new URL('http://localhost/api/mobile/v1/rides/shared/'+link.token),'GET',undefined,undefined) as any).state,'MATCHED','the link is unaffected by failed revokes');

  // Restart: the link is only database state, so a separate process sees the same trip and obeys revoke/expiry.
  assert.deepEqual(viewInFreshProcess(link.token),{ok:true,state:'MATCHED'},'a restarted process serves the same live link');
  assert.equal(viewInFreshProcess(link.token.slice(0,-2)+'xx').ok,false,'a wrong token is still refused after restart');
  assert.equal((await call(rider,'POST','/'+id+'/share/revoke')).revoked,1);
  assert.equal(viewInFreshProcess(link.token).ok,false,'a revoked link stays revoked in a restarted process');
  // A second link, expired in the database, is refused by a restarted process too.
  const second=await call(rider,'POST','/'+id+'/share');
  assert.equal(viewInFreshProcess(second.token).ok,true);
  await admin.query("UPDATE bitpos.passenger_trip_shares SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[digest(second.token)]);
  assert.equal(viewInFreshProcess(second.token).ok,false,'an expired link stays expired after restart');
  // A third link follows the trip to its end and exposes nothing beyond the state.
  const third=await call(rider,'POST','/'+id+'/share');
  await call(driver,'POST','/'+id+'/arrive');await call(driver,'POST','/'+id+'/start',{pin:made.pin});await call(driver,'POST','/'+id+'/complete');
  assert.deepEqual(viewInFreshProcess(third.token),{ok:true,state:'COMPLETED'},'the link reports the final state only');
  assert.equal((await admin.query('SELECT count(*)::int n FROM bitpos.passenger_trip_shares WHERE trip_id=$1',[id])).rows[0].n,3,'link rows are retained as audit; only hashes stored');
 }finally{await admin.query('UPDATE bitpos.ride_fare_rates SET active=false');await admin.end();await pool.end();}
});
