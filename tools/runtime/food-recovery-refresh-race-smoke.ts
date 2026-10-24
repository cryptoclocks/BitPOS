import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import type pg from 'pg';
type Call=(path:string,method?:string,body?:unknown,token?:string,status?:number)=>Promise<any>;
export async function verifyFoodRecoveryRefreshRace(c:{db:pg.Client;base:string;shipment:string;assignment:any;driverActor:{account:string;session:string;device:string;access:string;refresh:string};call:Call}){
 const {db,base,shipment,assignment,driverActor:actor,call}=c;
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 const root='/api/mobile/v1',path=root+'/driver/food/assignments/'+assignment.assignmentId+'/withdraw';
 const work=await call(root+'/driver/food/work','GET',undefined,actor.access);
 const command={idempotencyKey:randomUUID(),expectedVersion:work.assignment.shipmentVersion,generation:assignment.generation,leaseGeneration:assignment.leaseGeneration,reason:'SAFETY'};
 const observations:unknown[]=[];
 async function rotateWhileWaiting(stage:string){
  await db.query('BEGIN');await db.query('SELECT id FROM bitpos.food_shipments WHERE id=$1 FOR UPDATE',[shipment]);
  let pending:Promise<{status:number;value:any}>|undefined;
  try{
   pending=fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+actor.access},body:JSON.stringify(command)}).then(async response=>({status:response.status,value:await response.json()}));
   // Observe the actual API SQL lock, not a delay guessed to overlap middleware.
   const deadline=Date.now()+150;let waiting=false;
   while(Date.now()<deadline){await db.query('SELECT pg_stat_clear_snapshot()');waiting=(await db.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND datname=current_database() AND wait_event_type='Lock' AND query LIKE '%dispatch_food_withdraw%') waiting")).rows[0].waiting;if(waiting)break;}
   assert.ok(waiting,'API withdrawal did not reach the held root before its bounded lock deadline');
   const rotated=await call(root+'/auth/refresh','POST',{refreshToken:actor.refresh,deviceId:actor.device});
   actor.access=rotated.accessToken;actor.refresh=rotated.refreshToken;
   await db.query('COMMIT');
   const result=await pending;assert.equal(result.status,401);assert.equal(result.value.error.code,'AUTH_REQUIRED');
   observations.push({stage,observedApiSqlRootWait:true,actualRefreshCompleted:true,status:result.status,code:result.value.error.code});
  }finally{await db.query('ROLLBACK');if(pending)await pending.catch(()=>undefined);}
 }
 await rotateWhileWaiting('fresh-command');
 const before=(await db.query("SELECT a.state,l.state lease,(SELECT count(*)::int FROM bitpos.food_dispatch_commands WHERE actor_account_id=$2 AND idempotency_key=$3) commands FROM bitpos.food_assignments a JOIN bitpos.driver_assignment_leases l ON l.id=a.lease_id WHERE a.id=$1",[assignment.assignmentId,actor.account,command.idempotencyKey])).rows[0];
 assert.deepEqual(before,{state:'ACCEPTED',lease:'ACTIVE',commands:0});
 const receipt=await call(path,'POST',command,actor.access);assert.equal(receipt.state,'RELEASED');
 await rotateWhileWaiting('committed-command-replay');
 assert.deepEqual(await call(path,'POST',command,actor.access),receipt);
 const commands=(await db.query('SELECT count(*)::int n FROM bitpos.food_dispatch_commands WHERE actor_account_id=$1 AND idempotency_key=$2',[actor.account,command.idempotencyKey])).rows[0].n;assert.equal(commands,1);
 const evidence={status:'PASS_ACTUAL_HTTP_REFRESH_DURING_ROOT_LOCK',assignmentId:assignment.assignmentId,observations,beforeFreshRetry:before,commands,fixture:'Synthetic local identity/payment; actual auth refresh endpoint and persisted authority',physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch080-refresh-http-race-20261018.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}
