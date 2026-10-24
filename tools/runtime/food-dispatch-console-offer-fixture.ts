import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import pg from 'pg';
const evidence='.omp/work/flutter-delivery-20261016/evidence/';
const fixture=JSON.parse(await readFile(evidence+'dispatch085-console-browser-fixture-20261019.json','utf8'));
const privatePath='/tmp/bitpos-dispatch085-'+fixture.shipmentId+'.json',mode=process.argv[2];
assert.ok(['prepare','prepare-replacement','claim','cleanup'].includes(mode),'Use prepare, prepare-replacement, claim or cleanup');
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'});await db.connect();
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
async function call(path:string,token:string,method='GET',body?:unknown){const r=await fetch('http://127.0.0.1:3017/api/mobile/v1/'+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;}
async function seed(account:string){const access=randomBytes(32).toString('base64url'),refresh=randomBytes(32).toString('base64url'),session=randomUUID(),device=randomUUID();await db.query(`INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '15 minutes',clock_timestamp()+interval '15 minutes')`,[session,account,device,hash(access),hash(refresh)]);await db.query('INSERT INTO bitpos.mobile_refresh_history(token_hash,session_id) VALUES($1,$2)',[hash(refresh),session]);return {access,session};}
try{
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 assert.equal((await db.query('SELECT name FROM bitpos.merchants WHERE id=$1',[fixture.merchant])).rows[0].name,'DISPATCH066 HTTP SYNTHETIC FIXTURE');
 if(mode==='prepare'){
  const account=(await db.query('SELECT account_id FROM bitpos.driver_profiles WHERE id=$1',[fixture.driverId])).rows[0].account_id;
  const staff=await seed(fixture.accountId),driver=await seed(account);
  // Tokens are synthetic, finite and saved only outside the repository with exclusive0600 creation; never printed.
  await writeFile(privatePath,JSON.stringify({staff,driver,shipment:fixture.shipmentId}),{flag:'wx',mode:0o600});
  const revision=(await db.query('SELECT revision::text FROM bitpos.driver_food_service_grants WHERE driver_id=$1 AND merchant_id=$2 AND branch_id=$3',[fixture.driverId,fixture.merchant,fixture.branch])).rows[0]?.revision??'0';
  await call(`platform/merchants/${fixture.merchant}/branches/${fixture.branch}/drivers/${fixture.driverId}/food-service`,staff.access,'PUT',{idempotencyKey:randomUUID(),expectedVersion:revision,enabled:true,validUntil:new Date(Date.now()+600000).toISOString(),reason:'Synthetic085 actual browser offer eligibility; finite scoped staff, not real KYC'});
  const profile=await call('driver/profile',driver.access);await call('driver/availability',driver.access,'PUT',{idempotencyKey:randomUUID(),expectedVersion:profile.driver.availability.version,online:true});
  console.log(JSON.stringify({status:'FINITE_SYNTHETIC_DRIVER_READY_NOT_OFFER_ACCEPTANCE',driverId:fixture.driverId,shipment:fixture.shipmentId,privateTokens:'Outside repository0600, not printed',physicalTesting:'deferred_by_user_2026-10-16'}));
 }else{
  const privateFixture=JSON.parse(await readFile(privatePath,'utf8'));assert.equal(privateFixture.shipment,fixture.shipmentId);
  if(mode==='claim'){
   const offer=(await db.query("SELECT id,generation::text,version::text FROM bitpos.food_dispatch_offers WHERE shipment_id=$1 AND driver_id=$2 AND state='OFFERED' AND expires_at>clock_timestamp()",[fixture.shipmentId,fixture.driverId])).rows[0];assert.ok(offer,'Create live actual browser offer first');
   const claim=await call('driver/food/offers/'+offer.id+'/claim',privateFixture.driver.access,'POST',{idempotencyKey:randomUUID(),expectedVersion:offer.version,generation:offer.generation});
   await writeFile(evidence+'dispatch085-console-offer-claim-20261019.json',JSON.stringify({status:'ACTUAL_DRIVER_HTTP_CLAIM_OF_BROWSER_CREATED_OFFER',shipment:fixture.shipmentId,offerId:offer.id,claim,fixture:'Synthetic finite identity/approval/service/payment; actual browser offer and driver claim. No AVD/physical assertion.',physicalTesting:'deferred_by_user_2026-10-16'},null,2)+'\n');console.log(JSON.stringify({status:'ACTUAL_DRIVER_CLAIMED_BROWSER_OFFER',assignmentId:claim.assignmentId}));
  }else if(mode==='prepare-replacement'){
   assert.ok(!privateFixture.replacement,'Replacement already prepared');
   const account=randomUUID(),driverId=randomUUID();await db.query('BEGIN');
   await db.query('INSERT INTO bitpos.mobile_accounts(id,auth_subject) VALUES($1,$2)',[account,randomUUID()]);
   await db.query(`INSERT INTO bitpos.driver_profiles(id,account_id,display_name,license_expires_at,status,verified_until,verified_by,verification_reference)
    VALUES($1,$2,'Synthetic085 replacement',clock_timestamp()+interval '2 days','APPROVED',clock_timestamp()+interval '1 day',$3,'Synthetic documents, not real KYC')`,[driverId,account,fixture.accountId]);
   await db.query("INSERT INTO bitpos.driver_vehicles VALUES($1,'MOTORCYCLE','FIXTURE085','Fixture','Purple',clock_timestamp()+interval '1 day')",[driverId]);
   await db.query('INSERT INTO bitpos.driver_occupancy(driver_id) VALUES($1)',[driverId]);
   await db.query("INSERT INTO bitpos.driver_availability(driver_id,requested_online,heartbeat_expires_at) VALUES($1,false,clock_timestamp())",[driverId]);
   privateFixture.replacement={...await seed(account),driverId};await db.query('COMMIT');
   await writeFile(privatePath,JSON.stringify(privateFixture),{mode:0o600});
   await call(`platform/merchants/${fixture.merchant}/branches/${fixture.branch}/drivers/${driverId}/food-service`,privateFixture.staff.access,'PUT',{idempotencyKey:randomUUID(),expectedVersion:'0',enabled:true,validUntil:new Date(Date.now()+600000).toISOString(),reason:'Synthetic085 distinct replacement driver; finite scoped grant, not real KYC'});
   for(const actor of [privateFixture.driver,privateFixture.replacement]){const profile=await call('driver/profile',actor.access);await call('driver/availability',actor.access,'PUT',{idempotencyKey:randomUUID(),expectedVersion:profile.driver.availability.version,online:true});}
   await writeFile(evidence+'dispatch085-console-replacement-fixture-20261019.json',JSON.stringify({driverId,shipment:fixture.shipmentId,fixture:'Separate synthetic approved driver; actual service publication and online APIs. No tokens.',physicalTesting:'deferred_by_user_2026-10-16'},null,2)+'\n');
   console.log(JSON.stringify({status:'FINITE_DISTINCT_SYNTHETIC_REPLACEMENT_READY',driverId}));
  }else{
   for(const actor of [privateFixture.driver,privateFixture.replacement].filter(Boolean)){const profile=await call('driver/profile',actor.access);await call('driver/availability',actor.access,'PUT',{idempotencyKey:randomUUID(),expectedVersion:profile.driver.availability.version,online:false});}
   for(const actor of [privateFixture.staff,privateFixture.driver,privateFixture.replacement].filter(Boolean))await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=clock_timestamp() WHERE id=$1',[actor.session]);
   await unlink(privatePath);console.log('Synthetic085 drivers offline; private fixture sessions revoked and temporary token file removed');
  }
 }
}finally{await db.end();}
