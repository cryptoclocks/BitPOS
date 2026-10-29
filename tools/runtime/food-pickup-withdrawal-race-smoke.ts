import {assertLocalFoodFixture} from './fixture/assert-local';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import type pg from 'pg';
type Call=(path:string,method?:string,body?:unknown,token?:string,status?:number)=>Promise<any>;
export async function verifyFoodPickupWithdrawalRace(c:{db:pg.Client;base:string;shipment:string;orderId:string;assignment:any;driverActor:{access:string};merchantToken:string;call:Call;pickupFirst:boolean}){
 const {db,base,shipment,orderId,assignment,driverActor,merchantToken,call,pickupFirst}=c;
 await assertLocalFoodFixture(db);
 const root='/api/mobile/v1',path=root+'/driver/food/assignments/'+assignment.assignmentId,fence={generation:assignment.generation,leaseGeneration:assignment.leaseGeneration};
 await call(path+'/arrive','POST',{...fence,stage:'PICKUP',idempotencyKey:randomUUID()},driverActor.access);
 const proof=await call('/api/orders/'+orderId+'/delivery/pickup-proof','POST',{assignmentId:assignment.assignmentId,...fence,idempotencyKey:randomUUID(),rotate:false},merchantToken);
 const work=await call(root+'/driver/food/work','GET',undefined,driverActor.access);
 const pickup={...fence,proofId:proof.proofId,idempotencyKey:randomUUID(),secret:proof.secret},withdraw={...fence,expectedVersion:work.assignment.shipmentVersion,idempotencyKey:randomUUID(),reason:'SAFETY'};
 const requests:Array<Promise<{status:number;value:any}>>=[];
 const send=(suffix:string,body:unknown)=>fetch(base+path+suffix,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+driverActor.access},body:JSON.stringify(body)}).then(async response=>({status:response.status,value:await response.json()}));
 await db.query('BEGIN');await db.query('SELECT id FROM bitpos.food_shipments WHERE id=$1 FOR UPDATE',[shipment]);
 try{
  async function waiting(count:number){
   const deadline=Date.now()+140;let observed=0;
   while(Date.now()<deadline){await db.query('SELECT pg_stat_clear_snapshot()');observed=(await db.query("SELECT count(*)::int n FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND datname=current_database() AND wait_event_type='Lock' AND query ~ 'dispatch_(food_withdraw|consume_proof)'")).rows[0].n;if(observed>=count)return;}
   assert.fail('Did not observe '+count+' concurrent API root waiters; observed '+observed);
  }
  requests.push(pickupFirst?send('/consume-proof',pickup):send('/withdraw',withdraw));await waiting(1);
  requests.push(pickupFirst?send('/withdraw',withdraw):send('/consume-proof',pickup));await waiting(2);
  await db.query('COMMIT');
  const [winner,loser]=await Promise.all(requests);assert.equal(winner.status,200);assert.equal(loser.status,409);
  if(pickupFirst){assert.equal(winner.value.accepted,true);assert.equal(loser.value.error.code,'VERSION_CONFLICT');}
  else {assert.equal(winner.value.state,'RELEASED');assert.equal(loser.value.error.code,'ASSIGNMENT_CHANGED');}
  const state=(await db.query("SELECT a.state,l.state lease,s.state shipment,f.status kitchen,p.consumed_at IS NOT NULL consumed,p.revoked_at IS NOT NULL revoked FROM bitpos.food_assignments a JOIN bitpos.driver_assignment_leases l ON l.id=a.lease_id JOIN bitpos.food_shipments s ON s.id=a.shipment_id JOIN bitpos.order_fulfillment f ON(f.merchant_id,f.order_id)=(s.merchant_id,s.order_id) JOIN bitpos.fulfillment_proofs p ON p.id=$2 WHERE a.id=$1",[assignment.assignmentId,proof.proofId])).rows[0];
  assert.deepEqual(state,pickupFirst?{state:'PICKED_UP',lease:'ACTIVE',shipment:'PICKED_UP',kitchen:'COLLECTED',consumed:true,revoked:false}:{state:'RELEASED',lease:'RELEASED',shipment:'READY_FOR_DISPATCH',kitchen:'READY',consumed:false,revoked:true});
  const evidence={status:'PASS_ACTUAL_CONCURRENT_PICKUP_WITHDRAWAL',pickupFirst,observedConcurrentApiRootWaiters:2,responses:[{status:winner.status,outcome:pickupFirst?'PICKUP_ACCEPTED':'WITHDRAWAL_RELEASED'},{status:loser.status,code:loser.value.error.code}],assignmentId:assignment.assignmentId,state,fixture:'Synthetic seeded identity/payment; actual merchant proof and concurrent HTTP requests/persisted authority',physicalTesting:'deferred_by_user_2026-10-16'};
  await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch080-'+(pickupFirst?'pickup':'withdrawal')+'-first-concurrent-http-20261018.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
 }finally{await db.query('ROLLBACK');await Promise.allSettled(requests);}
}
