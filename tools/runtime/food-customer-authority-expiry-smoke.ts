import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import type pg from 'pg';
type Call=(path:string,method?:string,body?:unknown,token?:string,status?:number)=>Promise<any>;
export async function verifyFoodCustomerAuthorityExpiry(c:{db:pg.Client;base:string;shipment:string;driver:string;assignment:any;driverActor:{access:string};merchantToken:string;customerToken:string;merchant:string;branch:string;orderId:string;call:Call;expectFixed:boolean}){
 const {db,base,shipment,driver,assignment,driverActor,merchantToken,customerToken,merchant,branch,orderId,call,expectFixed}=c,mobile='/api/mobile/v1',path=mobile+'/driver/food/assignments/'+assignment.assignmentId,fence={generation:assignment.generation,leaseGeneration:assignment.leaseGeneration};
 assert.equal(new URL(base).hostname,'127.0.0.1');assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 await call(path+'/arrive','POST',{...fence,stage:'PICKUP',idempotencyKey:randomUUID()},driverActor.access);
 const pickup=await call('/api/orders/'+orderId+'/delivery/pickup-proof','POST',{assignmentId:assignment.assignmentId,...fence,idempotencyKey:randomUUID(),rotate:false},merchantToken);
 assert.equal((await call(path+'/consume-proof','POST',{...fence,proofId:pickup.proofId,idempotencyKey:randomUUID(),secret:pickup.secret},driverActor.access)).accepted,true);
 await call(path+'/arrive','POST',{...fence,stage:'DROPOFF',idempotencyKey:randomUUID()},driverActor.access);
 await call(path+'/location','POST',{...fence,sequence:'1',capturedAt:new Date().toISOString(),latitudeE7:137560000,longitudeE7:1005018000,accuracyMm:5000,headingMdeg:null,speedMmS:null},driverActor.access);
 await call(mobile+'/food/assignments/'+assignment.assignmentId+'/delivery-proof','POST',{...fence,idempotencyKey:randomUUID(),rotate:false},customerToken);
 const live=await call(mobile+'/food/orders/'+orderId+'/delivery','GET',undefined,customerToken);assert.equal(live.assignment.serviceAvailable,true);assert.equal(live.assignment.location.sequence,'1');assert.ok(live.assignment.deliveryProof);
 await db.query("SELECT pg_advisory_lock(hashtextextended('fixture:078-customer-clock-expiry',0))");
 let original=(await db.query("SELECT pg_get_functiondef('bitpos.dispatch_customer_work(uuid)'::regprocedure) definition")).rows[0].definition as string;const needle='tracking:=dispatch_food_tracking(s.id);',seam=needle+' PERFORM pg_sleep(0.9);';assert.equal(original.split(needle).length,2);
 // Recover only the exact test-owned wait if a previous process was killed before finally.
 if(original.includes(seam)){assert.equal(original.split(seam).length,2);original=original.replace(seam,needle);await db.query(original);}
 const service=(await db.query('SELECT valid_until FROM bitpos.driver_food_service_grants WHERE driver_id=$1 AND merchant_id=$2 AND branch_id=$3',[driver,merchant,branch])).rows[0];assert.ok(service);
 const projections:Record<string,unknown>[]=[];let instrumented=false;
 async function renewShortExpiry(){return (await db.query("UPDATE bitpos.driver_food_service_grants SET valid_until=clock_timestamp()+interval '500 milliseconds' WHERE driver_id=$1 AND merchant_id=$2 AND branch_id=$3 RETURNING valid_until",[driver,merchant,branch])).rows[0].valid_until;}
 try{
  // Test-only function body seam is committed so actual API connections see the real clock wait.
  // Always restore the byte-identical captured function and source expiry; never edit migration078.
  await db.query(original.replace(needle,seam));instrumented=true;
  for(const transport of ['HTTP','SSE']){
   const expiresAt=await renewShortExpiry();let work:any;
   if(transport==='HTTP')work=await call(mobile+'/food/orders/'+orderId+'/delivery','GET',undefined,customerToken);
   else{
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),8000);
    try{
     const response=await fetch(base+mobile+'/food/orders/'+orderId+'/delivery/events',{headers:{Authorization:'Bearer '+customerToken},signal:abort.signal});assert.equal(response.status,200);
     const reader=response.body!.getReader(),decoder=new TextDecoder();let text='';while(!text.includes('\n\n')){const chunk=await reader.read();assert.equal(chunk.done,false);text+=decoder.decode(chunk.value,{stream:true});assert.ok(text.length<65536);}
     assert.ok(text.includes('event: snapshot'));work=JSON.parse(text.split('\ndata: ')[1]!.split('\n')[0]!).work;
    }finally{clearTimeout(timer);abort.abort();}
   }
   assert.equal(work.assignment.serviceAvailable,false);assert.equal(work.assignment.deliveryProof,null);
   if(expectFixed)assert.equal(work.assignment.location,null,'Restricted customer network payload must not retain earlier location');else assert.equal(work.assignment.location.sequence,'1','Before correction must demonstrate actual earlier location leak, not merely an unavailable fixture');
   projections.push({transport,expiresAt,serviceAvailable:work.assignment.serviceAvailable,location:work.assignment.location,deliveryProof:work.assignment.deliveryProof});
  }
  const custody=(await db.query("SELECT a.state,l.state lease,f.status kitchen,(SELECT count(*)::int FROM bitpos.earning_accruals e WHERE e.food_assignment_id=a.id) earnings FROM bitpos.food_assignments a JOIN bitpos.driver_assignment_leases l ON l.id=a.lease_id JOIN bitpos.food_shipments s ON s.id=a.shipment_id JOIN bitpos.order_fulfillment f ON(f.merchant_id,f.order_id)=(s.merchant_id,s.order_id) WHERE a.id=$1",[assignment.assignmentId])).rows[0];assert.deepEqual(custody,{state:'AT_DROPOFF',lease:'ACTIVE',kitchen:'COLLECTED',earnings:0});
  const receipt={status:expectFixed?'PASS_CUSTOMER_CLOCK_EXPIRY_PRIVATE_FIELDS_REDACTED':'COUNTEREXAMPLE_CUSTOMER_RESTRICTED_CLOCK_EXPIRY_LOCATION_LEAK',shipmentId:shipment,assignmentId:assignment.assignmentId,projections,custody,fixture:true,seam:'Only disposable API function body temporarily waits actual900ms after real tracking; actual500ms service expiry; exact original function/expiry restored in finally',sourceFunctionSha256:createHash('sha256').update(original).digest('hex'),physicalTesting:'deferred_by_user_2026-10-16',limits:['Synthetic payment/identity/location, not physical GPS','No support resolution or full platform acceptance']};
  await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch078-customer-expiry-'+(expectFixed?'after':'before')+'-20261018.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 }finally{
  if(instrumented)await db.query(original);
  await db.query('UPDATE bitpos.driver_food_service_grants SET valid_until=$4 WHERE driver_id=$1 AND merchant_id=$2 AND branch_id=$3',[driver,merchant,branch,service.valid_until]);
  assert.equal((await db.query("SELECT pg_get_functiondef('bitpos.dispatch_customer_work(uuid)'::regprocedure) definition")).rows[0].definition,original,'Exact function restoration required');
  await db.query("SELECT pg_advisory_unlock(hashtextextended('fixture:078-customer-clock-expiry',0))");
 }
}
