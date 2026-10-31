import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
test('passenger trip: closed until fares are published, server fare, PIN start, single driver, terminal states, tenant fences',integration,async()=>{
 // Loading boundary: skipped integration never loads private runtime config.
 const svc=await import('../apps/api/src/passenger-trips');
 const {errorView}=await import('../apps/api/src/authority');
 const {pool}=await import('../apps/api/src/db');
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 const account=async(name:string)=>{const id=randomUUID();await admin.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,display_name,locale) VALUES($1,$2,$3,'en')",[id,randomUUID(),name]);return id;};
 const [rider,rider2,driverA,driverB,staff,pending]=await Promise.all(['R','R2','DA','DB','S','P'].map(account));
 const approve=(acct:string)=>admin.query("INSERT INTO bitpos.driver_profiles(account_id,display_name,license_expires_at,status,verified_until,verified_by,verification_reference) VALUES($1,'Synthetic driver',now()+interval '2 days','APPROVED',now()+interval '1 day',$2,'Synthetic fixture, not KYC')",[acct,staff]);
 await approve(driverA);await approve(driverB);
 await admin.query("INSERT INTO bitpos.driver_profiles(account_id,display_name,license_expires_at) VALUES($1,'Pending',now()+interval '2 days')",[pending]);
 await admin.query('UPDATE bitpos.ride_fare_rates SET active=false');
 const body={distanceMetres:5000,durationSeconds:600,seats:1,shared:false};
 const req=(acct:string,over:Record<string,unknown>={})=>svc.requestTrip(acct,{...body,idempotencyKey:randomUUID(),pickup:{latitudeE7:137560000,longitudeE7:1005018000},dropoff:{latitudeE7:137600000,longitudeE7:1005100000},...over});
 try{
  await assert.rejects(svc.quoteTrip(rider,body),/FARES_UNPUBLISHED/,'closed until fares are published');
  await assert.rejects(req(rider),/FARES_UNPUBLISHED/);
  await admin.query("INSERT INTO bitpos.ride_fare_rates(currency,decimals,base_minor,per_km_minor,per_minute_minor,minimum_minor,shared_discount_bps,active,published_by) VALUES('THB',2,3500,600,100,5000,2500,true,$1)",[staff]);
  assert.deepEqual((await svc.quoteTrip(rider,body)).fare,{currency:'THB',decimals:2,amountMinor:'7500'});
  assert.deepEqual((await svc.quoteTrip(rider,{...body,shared:true,seats:2})).fare.amountMinor,'11250');
  await assert.rejects(svc.quoteTrip(rider,{...body,seats:9}),/INVALID_REQUEST/);
  await assert.rejects(svc.quoteTrip(rider,{...body,fare:1}),/INVALID_REQUEST/,'a client cannot send its own fare');
  const key:string=randomUUID();
  const first=await req(rider,{idempotencyKey:key});
  assert.match(first.pin??'',/^\d{4}$/);assert.equal(first.trip.fare.amountMinor,'7500');assert.equal(first.trip.state,'REQUESTED');
  const replay=await req(rider,{idempotencyKey:key});assert.equal(replay.trip.id,first.trip.id);assert.equal(replay.pin,null,'PIN is shown once');
  await assert.rejects(req(rider,{idempotencyKey:key,seats:2}),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(req(rider,{idempotencyKey:key,pickup:{latitudeE7:137560000,longitudeE7:1005018001}}),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(req(rider,{idempotencyKey:key,dropoff:{latitudeE7:137600001,longitudeE7:1005100000}}),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(req(rider),/TRIP_STATE_CONFLICT/,'one open trip per rider');
  const stored=(await admin.query('SELECT pin_hash,pin_salt FROM bitpos.passenger_trips WHERE id=$1',[first.trip.id])).rows[0];
  assert.ok(!JSON.stringify(stored).includes(first.pin!),'only a salted hash is stored');
  await assert.rejects(admin.query("UPDATE bitpos.passenger_trips SET fare_minor=1 WHERE id=$1",[first.trip.id]),/TRIP_IMMUTABLE_FIELD/,'fare cannot be rewritten');
  for(const column of ['pickup_lat_e7','pickup_lng_e7','dropoff_lat_e7','dropoff_lng_e7']){
   await assert.rejects(admin.query(`UPDATE bitpos.passenger_trips SET ${column}=${column}+1 WHERE id=$1`,[first.trip.id]),/TRIP_IMMUTABLE_FIELD/,'requested route cannot be rewritten');
  }
  await assert.rejects(svc.getTrip(rider2,first.trip.id),/RESOURCE_NOT_FOUND/,'another rider cannot read it');
  await assert.rejects(svc.openTrips(rider),/DRIVER_NOT_APPROVED/);await assert.rejects(svc.openTrips(pending),/DRIVER_NOT_APPROVED/);
  assert.ok((await svc.openTrips(driverA)).some(t=>t.id===first.trip.id));
  await assert.rejects(svc.acceptTrip(rider,first.trip.id),/DRIVER_NOT_APPROVED/);
  const accepted=await Promise.allSettled([svc.acceptTrip(driverA,first.trip.id),svc.acceptTrip(driverB,first.trip.id)]);
  assert.equal(accepted.filter(r=>r.status==='fulfilled').length,1,'exactly one driver wins');
  const winner=(await svc.getTrip(rider,first.trip.id)).driverAccountId!;assert.ok(([driverA,driverB] as string[]).includes(winner));const other=winner===driverA?driverB:driverA;
  await assert.rejects(svc.arriveTrip(other,first.trip.id),/RESOURCE_NOT_FOUND/);
  await assert.rejects(svc.startTrip(winner,first.trip.id,first.pin),/TRIP_STATE_CONFLICT/,'cannot start before arriving');
  assert.equal((await svc.arriveTrip(winner,first.trip.id)).state,'ARRIVED');
  const wrong=first.pin==='0000'?'1111':'0000';
  await assert.rejects(svc.startTrip(winner,first.trip.id,wrong),/PIN_INVALID/);
  assert.equal((await admin.query('SELECT pin_attempts FROM bitpos.passenger_trips WHERE id=$1',[first.trip.id])).rows[0].pin_attempts,1,'wrong attempt is persisted');
  assert.equal((await svc.startTrip(winner,first.trip.id,first.pin)).state,'IN_TRIP');
  await assert.rejects(svc.cancelTrip(rider,first.trip.id),/TRIP_STATE_CONFLICT/,'no cancel while in trip');
  const done=await svc.completeTrip(winner,first.trip.id);assert.equal(done.state,'COMPLETED');assert.equal(done.fare.amountMinor,'7500');
  await assert.rejects(svc.completeTrip(winner,first.trip.id),/TRIP_STATE_CONFLICT|TRIP_TERMINAL/);
  assert.deepEqual((await admin.query('SELECT state FROM bitpos.passenger_trip_events WHERE trip_id=$1 ORDER BY seq',[first.trip.id])).rows.map(r=>r.state),['REQUESTED','MATCHED','ARRIVED','IN_TRIP','COMPLETED']);
  // PIN lock and cancel path.
  const second=await req(rider);await svc.acceptTrip(driverA,second.trip.id);await svc.arriveTrip(driverA,second.trip.id);
  const bad=second.pin==='0000'?'1111':'0000';
  await assert.rejects(svc.startTrip(driverA,second.trip.id,bad),/PIN_INVALID/);await assert.rejects(svc.startTrip(driverA,second.trip.id,bad),/PIN_INVALID/);
  await assert.rejects(svc.startTrip(driverA,second.trip.id,bad),/PIN_LOCKED/);
  await assert.rejects(svc.startTrip(driverA,second.trip.id,second.pin),/PIN_LOCKED/,'right PIN is refused once locked');
  assert.equal((await svc.cancelTrip(rider,second.trip.id)).state,'CANCELLED');
  await assert.rejects(svc.cancelTrip(rider,second.trip.id),/TRIP_STATE_CONFLICT|TRIP_TERMINAL/);
  const third=await req(rider);assert.equal((await svc.cancelTrip(rider,third.trip.id)).state,'CANCELLED','a requested trip can be cancelled before matching');
  // Synthetic lease setup bypasses the food graph only in this disposable fixture.
  const driverId=(await admin.query('SELECT id FROM bitpos.driver_profiles WHERE account_id=$1',[driverA])).rows[0].id;
  const lease=randomUUID();
  await admin.query("SET session_replication_role='replica'");
  try{await admin.query("INSERT INTO bitpos.driver_assignment_leases(id,driver_id,generation,food_assignment_id,state) VALUES($1,$2,987654321,$3,'ACTIVE')",[lease,driverId,randomUUID()]);}
  finally{await admin.query("SET session_replication_role='origin'");}
  const foodBusy=await req(rider);
  try{await assert.rejects(svc.acceptTrip(driverA,foodBusy.trip.id),(error:unknown)=>{const view=errorView(error);return view.status===409&&view.code==='DRIVER_BUSY';},'active food custody rejects a ride with a usable conflict');}
  finally{await admin.query("SET session_replication_role='replica'");try{await admin.query('DELETE FROM bitpos.driver_assignment_leases WHERE id=$1',[lease]);}finally{await admin.query("SET session_replication_role='origin'");}}
  await svc.acceptTrip(driverA,foodBusy.trip.id);
  await assert.rejects(admin.query("INSERT INTO bitpos.driver_assignment_leases(id,driver_id,generation,food_assignment_id,state) VALUES($1,$2,987654322,$3,'ACTIVE')",[randomUUID(),driverId,randomUUID()]),/DRIVER_UNAVAILABLE/,'active ride rejects a food claim before creating a lease');
  await svc.cancelTrip(rider,foodBusy.trip.id);
  // Hold the shared occupancy lock as a food claim would, then race a ride acceptance.
  const raceTrip=await req(rider),raceLease=randomUUID(),holder=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await holder.connect();
  try{
   await holder.query('BEGIN');await holder.query('SELECT 1 FROM bitpos.driver_occupancy WHERE driver_id=$1 FOR UPDATE',[driverId]);
   const accepting=svc.acceptTrip(driverA,raceTrip.trip.id).then(()=>null,e=>e);
   let waiting=false;
   for(let i=0;i<100;i++){
    const count=(await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%UPDATE passenger_trips SET state=%'")).rows[0].n;
    if(count){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert.ok(waiting,'ride acceptance waits on the occupied driver');
   await holder.query("SET LOCAL session_replication_role='replica'");
   await holder.query("INSERT INTO bitpos.driver_assignment_leases(id,driver_id,generation,food_assignment_id,state) VALUES($1,$2,987654323,$3,'ACTIVE')",[raceLease,driverId,randomUUID()]);
   await holder.query('COMMIT');
   assert.match(String(await accepting),/DRIVER_BUSY/,'ride rechecks food after the competing transaction commits');
  }finally{
   await holder.query('ROLLBACK').catch(()=>undefined);await holder.end();
   await admin.query("SET session_replication_role='replica'");try{await admin.query('DELETE FROM bitpos.driver_assignment_leases WHERE id=$1',[raceLease]);}finally{await admin.query("SET session_replication_role='origin'");}
  }
  await svc.cancelTrip(rider,raceTrip.trip.id);
  const reverseTrip=await req(rider),rideHolder=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL}),foodClaim=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});
  await rideHolder.connect();await foodClaim.connect();
  try{
   await rideHolder.query('BEGIN');
   await rideHolder.query("UPDATE bitpos.passenger_trips SET state='MATCHED',driver_account_id=$2 WHERE id=$1",[reverseTrip.trip.id,driverA]);
   const claiming=foodClaim.query("INSERT INTO bitpos.driver_assignment_leases(id,driver_id,generation,food_assignment_id,state) VALUES($1,$2,987654324,$3,'ACTIVE')",[randomUUID(),driverId,randomUUID()]).then(()=>null,e=>e);
   let waiting=false;
   for(let i=0;i<100;i++){
    const count=(await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%INSERT INTO bitpos.driver_assignment_leases%'")).rows[0].n;
    if(count){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert.ok(waiting,'food claim waits on the occupied driver');
   await rideHolder.query('COMMIT');
   assert.match(String(await claiming),/DRIVER_UNAVAILABLE/,'food rechecks ride after the competing transaction commits');
  }finally{await rideHolder.query('ROLLBACK').catch(()=>undefined);await rideHolder.end();await foodClaim.end();}
  await svc.cancelTrip(rider,reverseTrip.trip.id);
  const isolationTrip=await req(rider);
  await admin.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try{await assert.rejects(admin.query("UPDATE bitpos.passenger_trips SET state='MATCHED',driver_account_id=$2 WHERE id=$1",[isolationTrip.trip.id,driverA]),/DISPATCH_READ_COMMITTED_REQUIRED/);}
  finally{await admin.query('ROLLBACK');}
  await admin.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try{await assert.rejects(admin.query("INSERT INTO bitpos.driver_assignment_leases(id,driver_id,generation,food_assignment_id,state) VALUES($1,$2,987654325,$3,'ACTIVE')",[randomUUID(),driverId,randomUUID()]),/DISPATCH_READ_COMMITTED_REQUIRED/);}
  finally{await admin.query('ROLLBACK');}
  await svc.cancelTrip(rider,isolationTrip.trip.id);
  const concurrentKey=randomUUID();
  const same=await Promise.all([req(rider,{idempotencyKey:concurrentKey}),req(rider,{idempotencyKey:concurrentKey})]);
  assert.equal(same[0].trip.id,same[1].trip.id);assert.equal(same.filter(x=>x.pin!==null).length,1,'concurrent retries create one trip and disclose one PIN');
  await svc.cancelTrip(rider,same[0].trip.id);
  const competing=await Promise.allSettled([req(rider),req(rider)]);
  assert.equal(competing.filter(x=>x.status==='fulfilled').length,1,'distinct concurrent keys cannot create two open trips');
  assert.match(String((competing.find(x=>x.status==='rejected') as PromiseRejectedResult).reason),/TRIP_STATE_CONFLICT/);
 }finally{await admin.query('UPDATE bitpos.ride_fare_rates SET active=false');await admin.end();await pool.end();}
});
