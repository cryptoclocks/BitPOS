import assert from 'node:assert/strict';
import pg from 'pg';
import {writeFile} from 'node:fs/promises';
import {createFoodDispatchWorker} from '../../apps/worker/src/food-dispatch';
import {runWorkerLanes} from '../../apps/worker/src/lanes';
const admin='postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',db=new pg.Client({connectionString:admin});await db.connect();
const role='bitpos_idle_worker_fixture_'+process.pid;let worker:ReturnType<typeof createFoodDispatchWorker>=null,wrong:ReturnType<typeof createFoodDispatchWorker>=null,driver:string|undefined;
try{
 assert.equal((await db.query('SELECT current_database() name')).rows[0].name,'bitpos_delivery_fixture');await db.query('SET search_path=bitpos,public');
 driver=(await db.query("SELECT id FROM driver_profiles WHERE display_name='Synthetic AVD idle071'")).rows[0]?.id;assert.ok(driver,'Completed dedicated AVD fixture required');assert.equal((await db.query('SELECT count(*)::int n FROM driver_food_idle_locations WHERE driver_id=$1',[driver])).rows[0].n,0);
 await db.query(`CREATE ROLE ${role} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);await db.query(`GRANT bitpos_food_dispatch_worker TO ${role}`);
 worker=createFoodDispatchWorker(`postgresql://${role}@127.0.0.1:55436/bitpos_delivery_fixture`);assert.ok(worker);assert.equal(createFoodDispatchWorker(undefined),null);assert.throws(()=>createFoodDispatchWorker('invalid'),'Invalid worker config');
 const access=new pg.Client({connectionString:`postgresql://${role}@127.0.0.1:55436/bitpos_delivery_fixture`});await access.connect();try{await assert.rejects(access.query('SELECT * FROM bitpos.driver_food_idle_locations'),/permission denied/);await assert.rejects(access.query('SELECT bitpos.food_discovery_own_snapshot()'),/permission denied/);}finally{await access.end();}
 await db.query(`INSERT INTO driver_food_idle_locations(driver_id,consent_revision,sequence,captured_at,received_at,latitude_e7,longitude_e7,accuracy_mm)
 SELECT driver_id,revision,1,clock_timestamp()-interval '121 seconds',clock_timestamp()-interval '121 seconds',137560000,1005018000,5000 FROM driver_food_discovery_consents WHERE driver_id=$1`,[driver]);
 await worker.tick();assert.equal((await db.query('SELECT count(*)::int n FROM driver_food_idle_locations WHERE driver_id=$1',[driver])).rows[0].n,0);await worker.tick();
 const idle=(await db.query("SELECT pid FROM pg_stat_activity WHERE usename=$1 AND application_name='bitpos_food_dispatch' AND state='idle'",[role])).rows[0];assert.ok(idle);await db.query('SELECT pg_terminate_backend($1)',[idle.pid]);await new Promise(resolve=>setTimeout(resolve,100));await worker.tick();
 const blocker=new pg.Client({connectionString:admin});await blocker.connect();try{
  await blocker.query('BEGIN');await blocker.query('LOCK TABLE bitpos.driver_food_idle_locations IN ACCESS EXCLUSIVE MODE');
  const failed=worker.tick().then(()=>({ok:true,error:''}),error=>({ok:false,error:String(error)}));let activePid:number|undefined;
  for(let attempt=0;attempt<100;attempt++){const active=(await db.query("SELECT pid,wait_event_type FROM pg_stat_activity WHERE usename=$1 AND application_name='bitpos_food_dispatch'",[role])).rows[0];if(active?.wait_event_type==='Lock'){activePid=active.pid;break;}await new Promise(resolve=>setTimeout(resolve,1));}
  assert.ok(activePid,'Checked-out tick must be blocked before termination');await db.query('SELECT pg_terminate_backend($1)',[activePid]);const outcome=await failed;assert.equal(outcome.ok,false);await blocker.query('ROLLBACK');await worker.tick();
 }finally{await blocker.query('ROLLBACK');await blocker.end();}
 const stop=new AbortController();let disconnected!:()=>void,continued!:()=>void;const lost=new Promise<void>(resolve=>{disconnected=resolve;}),otherContinued=new Promise<void>(resolve=>{continued=resolve;});let drained=false;
 await runWorkerLanes([
  {tick:async()=>{await worker!.tick();const live=(await db.query("SELECT pid FROM pg_stat_activity WHERE usename=$1 AND application_name='bitpos_food_dispatch' AND state='idle'",[role])).rows[0];assert.ok(live);await db.query('SELECT pg_terminate_backend($1)',[live.pid]);disconnected();await otherContinued;stop.abort();await worker!.tick();drained=true;},unavailable:'Fixture retention lane failed'},
  {tick:async()=>{await lost;assert.equal((await db.query('SELECT 7 value')).rows[0].value,7);continued();},unavailable:'Fixture independent SQL lane failed'},
 ],stop.signal);assert.equal(drained,true,'Shutdown must await the active reconnecting tick before pool close');
 wrong=createFoodDispatchWorker(admin);assert.ok(wrong);await assert.rejects(wrong.tick(),/FOOD_DISPATCH_WORKER_ROLE_REQUIRED/);
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch071-idle-worker-20261018.json',JSON.stringify({status:'PASS_BOUNDED_PRIVATE_RETENTION_WORKER',fixture:true,checks:['Separate restricted LOGIN inherits only private worker role','Raw idle table and mobile own-snapshot denied to worker','Actual worker connection removes persisted expired fixture point','Repeated tick converges with zero remaining points','Idle backend termination contained and next tick reconnects','Checked-out blocked transaction termination rejects and next tick recovers','Actual worker lanes: independent SQL continues after idle disconnect; abort drains active reconnect before pool close','Admin/overprivileged connection rejected without fallback','Missing config disabled and malformed config rejected'],limits:['Retention lane only; automatic search/offers not implemented','Temporary login dropped; no actual-use provisioning'],physicalTesting:'deferred_by_user_2026-10-16'},null,2)+'\n');console.log('PASS_BOUNDED_PRIVATE_RETENTION_WORKER');
}finally{
 await worker?.close();await wrong?.close();if(driver)await db.query('DELETE FROM bitpos.driver_food_idle_locations WHERE driver_id=$1',[driver]);await db.query(`DROP ROLE IF EXISTS ${role}`);await db.end();
}
