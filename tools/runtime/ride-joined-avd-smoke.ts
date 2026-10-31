// Local-only: real rider and driver ride screens on the AVD against the own disposable fixture
// (API 3043 on DB 55440). Seeds synthetic accounts, pinned addresses, an approved driver and an
// active fare, then runs rider REQUEST -> driver accept/arrive/PIN/complete -> rider VERIFY.
import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import pg from 'pg';

const databaseUrl=process.env.BITPOS_DELIVERY_FIXTURE_DATABASE_URL;
if(!databaseUrl)throw new Error('BITPOS_DELIVERY_FIXTURE_DATABASE_URL is required');
const parsed=new URL(databaseUrl);
if(parsed.protocol!=='postgresql:'||parsed.hostname!=='127.0.0.1'||parsed.port!=='55440'||parsed.pathname!=='/bitpos_delivery_fixture'||parsed.search||parsed.hash)throw new Error('Ride AVD smoke only accepts the own disposable loopback fixture');
const api='http://10.0.2.2:3043/api/mobile/v1/';
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const admin=new pg.Client({connectionString:databaseUrl});await admin.connect();
async function actor(name:string){
 const account=randomUUID(),session=randomUUID(),device=randomUUID(),access=randomBytes(32).toString('base64url'),refresh=randomBytes(32).toString('base64url');
 await admin.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,display_name,locale) VALUES($1,$2,$3,'en')",[account,randomUUID(),name]);
 await admin.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '20 minutes',clock_timestamp()+interval '20 minutes')",[session,account,device,digest(access),digest(refresh)]);
 const blob=Buffer.from(JSON.stringify({accountId:account,sessionId:session,accessToken:access,refreshToken:refresh,accessExpiresAt:new Date(Date.now()+1200000).toISOString(),refreshExpiresAt:new Date(Date.now()+1200000).toISOString()})).toString('base64');
 return {account,device,blob};
}
const rider=await actor('Ride AVD rider'),driver=await actor('Ride AVD driver'),staff=await actor('Ride AVD staff');
await admin.query("INSERT INTO bitpos.mobile_addresses(account_id,label,recipient_name,phone,address_text,instructions,latitude_e7,longitude_e7) VALUES($1,'Ride home','Rider','+66900000001','Synthetic home','',137560000,1005018000),($1,'Ride office','Rider','+66900000001','Synthetic office','',137600000,1005100000)",[rider.account]);
await admin.query("INSERT INTO bitpos.driver_profiles(account_id,display_name,license_expires_at,status,verified_until,verified_by,verification_reference) VALUES($1,'Synthetic ride driver',now()+interval '2 days','APPROVED',now()+interval '1 day',$2,'Synthetic fixture, not KYC')",[driver.account,staff.account]);
await admin.query("UPDATE bitpos.passenger_trips SET state='CANCELLED' WHERE state='REQUESTED'"); // stale open requests from earlier fixture runs would also be offered
await admin.query('UPDATE bitpos.ride_fare_rates SET active=false');
await admin.query("INSERT INTO bitpos.ride_fare_rates(currency,decimals,base_minor,per_km_minor,per_minute_minor,minimum_minor,shared_discount_bps,active,published_by) VALUES('THB',2,3500,600,100,5000,2500,true,$1)",[staff.account]);
const flutter='/Users/cryptoclock/development/flutter/bin/flutter';
function run(app:'mobile-customer'|'mobile-driver',file:string,defines:Record<string,string>,who:{blob:string;device:string}):Promise<string>{
 return new Promise((resolve,reject)=>{
  const args=['test',`integration_test/${file}`,'-d','emulator-5554','--dart-define=BITPOS_FIXTURE=true',`--dart-define=BITPOS_MOBILE_API=${api}`,`--dart-define=BITPOS_TEST_SESSION_BASE64=${who.blob}`,`--dart-define=BITPOS_TEST_DEVICE_ID=${who.device}`,...Object.entries(defines).map(([k,v])=>`--dart-define=${k}=${v}`)];
  const child=spawn(flutter,args,{cwd:`apps/${app}`,stdio:['ignore','pipe','pipe']});let out='';
  child.stdout.on('data',b=>{out+=b;});child.stderr.on('data',b=>{out+=b;});
  child.once('error',reject);child.once('exit',code=>{if(code!==0&&process.env.BITPOS_RIDE_AVD_LOG)writeFileSync(process.env.BITPOS_RIDE_AVD_LOG,out);code===0?resolve(out):reject(new Error(`${app} ${file} failed\n${out.slice(-1500)}`));});
 });
}
try{
 const requested=await run('mobile-customer','ride_request_root_test.dart',{BITPOS_TEST_RIDE_STAGE:'REQUEST'},rider);
 const pin=requested.match(/BITPOS_RIDE_PIN:(\d{4})/)?.[1];assert.ok(pin,'rider screen must show the PIN');
 assert.match(requested.match(/BITPOS_RIDE_FARE:(.*)/)?.[1]??'',/THB/);
 console.log('PASS rider requested trip, fare '+requested.match(/BITPOS_RIDE_FARE:(.*)/)![1].trim());
 await run('mobile-driver','driver_rides_root_test.dart',{BITPOS_TEST_RIDE_PIN:pin},driver);
 const trip=(await admin.query("SELECT state,fare_minor::text f,pin_attempts FROM bitpos.passenger_trips WHERE rider_account_id=$1",[rider.account])).rows;
 const quotedMinor=requested.match(/BITPOS_RIDE_FARE:([\d.]+) THB/)![1].replace('.','');
 assert.deepEqual(trip.map(r=>[r.state,r.f]),[['COMPLETED',quotedMinor]],'the stored fare is the fare the rider was quoted');
 console.log('PASS driver accepted, arrived, was refused a wrong PIN, started with the PIN and completed; attempts='+trip[0].pin_attempts);
 await run('mobile-customer','ride_request_root_test.dart',{BITPOS_TEST_RIDE_STAGE:'VERIFY'},rider);
 const events=(await admin.query('SELECT e.state FROM bitpos.passenger_trip_events e JOIN bitpos.passenger_trips t ON t.id=e.trip_id WHERE t.rider_account_id=$1 ORDER BY e.seq',[rider.account])).rows.map(r=>r.state);
 assert.deepEqual(events,['REQUESTED','MATCHED','ARRIVED','IN_TRIP','COMPLETED']);
 console.log('PASS_RIDE_JOINED_AVD '+events.join('>'));
}finally{
 await admin.query('UPDATE bitpos.ride_fare_rates SET active=false');
 await admin.query('UPDATE bitpos.mobile_sessions SET revoked_at=clock_timestamp() WHERE account_id=ANY($1::uuid[])',[[rider.account,driver.account,staff.account]]);
 await admin.end();
}
