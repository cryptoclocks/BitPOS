import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{writeFile}from'node:fs/promises';import type pg from'pg';import{assertLocalFoodFixture}from'./fixture/assert-local';
type Actor={account:string;session:string;access:string};type Call=(path:string,method?:string,body?:unknown,token?:string,status?:number)=>Promise<any>;
export async function verifyFoodReplacementCurrent(c:{db:pg.Client;shipment:string;orderId:string;merchant:string;branch:string;assignment:any;driverActor:Actor;dispatcher:Actor;customerToken:string;merchantToken:string;call:Call;seedActor:()=>Promise<Actor>}){
 const{db,shipment,orderId,merchant,branch,assignment,driverActor,dispatcher,customerToken,merchantToken,call,seedActor}=c;await assertLocalFoodFixture(db);
 const root='/api/mobile/v1',oldPath=root+'/driver/food/assignments/'+assignment.assignmentId,oldFence={generation:assignment.generation,leaseGeneration:assignment.leaseGeneration};
 const current=await call(root+'/driver/food/work','GET',undefined,driverActor.access);
 await call(oldPath+'/withdraw','POST',{...oldFence,idempotencyKey:randomUUID(),expectedVersion:current.assignment.shipmentVersion,reason:'VEHICLE'},driverActor.access);
 const second=await seedActor(),driver=randomUUID();
 try{
 await db.query("INSERT INTO bitpos.driver_profiles(id,account_id,display_name,license_expires_at,status,verified_until,verified_by,verification_reference)VALUES($1,$2,'W02 replacement synthetic driver',clock_timestamp()+interval '2 days','APPROVED',clock_timestamp()+interval '1 day',$3,'Synthetic document fixture, not KYC')",[driver,second.account,dispatcher.account]);
 await db.query("INSERT INTO bitpos.driver_vehicles VALUES($1,'MOTORCYCLE','FIXTURE-REPLACEMENT','Fixture','Purple',clock_timestamp()+interval '1 day')",[driver]);
 await db.query('INSERT INTO bitpos.driver_occupancy(driver_id)VALUES($1)',[driver]);
 await db.query("INSERT INTO bitpos.driver_availability(driver_id,requested_online,heartbeat_expires_at)VALUES($1,true,clock_timestamp()+interval '90 seconds')",[driver]);
 await call(root+`/platform/merchants/${merchant}/branches/${branch}/drivers/${driver}/food-service`,'PUT',{idempotencyKey:randomUUID(),expectedVersion:'0',enabled:true,validUntil:new Date(Date.now()+1800000).toISOString(),reason:'W02 scoped replacement food service'},dispatcher.access);
 const version=(await db.query('SELECT version::text FROM bitpos.food_shipments WHERE id=$1',[shipment])).rows[0].version;
 const offer=await call(root+`/platform/food/shipments/${shipment}/offers`,'POST',{idempotencyKey:randomUUID(),expectedVersion:version,driverId:driver},dispatcher.access);
 const claim={idempotencyKey:randomUUID(),expectedVersion:'1',generation:offer.generation};
 const claims=await Promise.all([call(root+`/driver/food/offers/${offer.offerId}/claim`,'POST',claim,second.access),call(root+`/driver/food/offers/${offer.offerId}/claim`,'POST',claim,second.access)]);assert.deepEqual(claims[0],claims[1]);const replacement=claims[0];
 assert.notEqual(replacement.assignmentId,assignment.assignmentId);assert.ok(BigInt(replacement.generation)>BigInt(assignment.generation));
 await call(oldPath+'/arrive','POST',{...oldFence,stage:'PICKUP',idempotencyKey:randomUUID()},driverActor.access,409);
 const path=root+'/driver/food/assignments/'+replacement.assignmentId,fence={generation:replacement.generation,leaseGeneration:replacement.leaseGeneration};
 await call(path+'/arrive','POST',{...fence,stage:'PICKUP',idempotencyKey:randomUUID()},second.access);
 const pickup=await call('/api/orders/'+orderId+'/delivery/pickup-proof','POST',{assignmentId:replacement.assignmentId,...fence,idempotencyKey:randomUUID(),rotate:false},merchantToken);
 await call(oldPath+'/consume-proof','POST',{...oldFence,proofId:pickup.proofId,secret:pickup.secret,idempotencyKey:randomUUID()},driverActor.access,409);
 await call(path+'/consume-proof','POST',{...fence,proofId:pickup.proofId,secret:pickup.secret,idempotencyKey:randomUUID()},second.access);
 await call(path+'/arrive','POST',{...fence,stage:'DROPOFF',idempotencyKey:randomUUID()},second.access);
 const proof=await call(root+`/food/assignments/${replacement.assignmentId}/delivery-proof`,'POST',{...fence,idempotencyKey:randomUUID(),rotate:false},customerToken);
 const command={...fence,proofId:proof.proofId,secret:proof.secret,idempotencyKey:randomUUID()};
 const delivered=await Promise.all([call(path+'/consume-proof','POST',command,second.access),call(path+'/consume-proof','POST',command,second.access)]);assert.deepEqual(delivered[0],delivered[1]);assert.equal(delivered[0].accepted,true);
 const persisted=(await db.query(`SELECT a.id,a.state,l.state lease,(SELECT count(*)::int FROM bitpos.earning_accruals WHERE food_assignment_id=a.id) earnings FROM bitpos.food_assignments a JOIN bitpos.driver_assignment_leases l ON l.id=a.lease_id WHERE a.shipment_id=$1 ORDER BY a.accepted_at,a.id`,[shipment])).rows;
 assert.deepEqual(persisted,[{id:assignment.assignmentId,state:'RELEASED',lease:'RELEASED',earnings:0},{id:replacement.assignmentId,state:'DELIVERED',lease:'RELEASED',earnings:1}]);
 const money=(await db.query("SELECT facts.amount_minor::text amount,(SELECT sum(debit_minor)::text FROM bitpos.ledger_entries WHERE transaction_id=e.ledger_transaction_id) debit,(SELECT sum(credit_minor)::text FROM bitpos.ledger_entries WHERE transaction_id=e.ledger_transaction_id) credit FROM bitpos.earning_accruals e JOIN bitpos.earning_accrual_facts facts ON facts.accrual_id=e.id WHERE e.food_assignment_id=$1",[replacement.assignmentId])).rows;assert.deepEqual(money,[{amount:'100',debit:'100',credit:'100'}]);
 const final=await call(root+'/food/orders/'+orderId,'GET',undefined,customerToken);assert.equal(final.status,'PAID');assert.equal(final.fulfillmentStatus,'COLLECTED');
 const receipt={status:'PASS_CURRENT_SECOND_DRIVER_REPLACEMENT_DELIVERY',checkedAtUtc:new Date().toISOString(),shipmentId:shipment,orderId,oldAssignmentId:assignment.assignmentId,newAssignmentId:replacement.assignmentId,persisted,money,checks:['Prior driver withdraws before pickup, second distinct driver accepts higher generation','Old assignment cannot arrive or consume replacement proof','Concurrent exact replacement claim and delivery proof have one effect','Only replacement delivered driver earns exact balanced100; old driver earns0','Customer reads same original paid/collected order'],limits:['API/committedSQL only; full current native/browser replacement journey remains open','Synthetic identity and SQL payment seam; no real delivery/provider payout']};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/w02-replacement-delivery-20261021.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 }finally{await db.query('UPDATE bitpos.driver_availability SET requested_online=false WHERE driver_id=$1',[driver]);}
}
