import {assertLocalFoodFixture} from './fixture/assert-local';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import type pg from 'pg';
type Actor={access:string};type Call=(path:string,method?:string,body?:unknown,token?:string,status?:number)=>Promise<any>;
export async function verifyFoodIncidentAuthorityHttp(c:{db:pg.Client;shipment:string;orderId:string;assignment:any;driverActor:Actor;dispatcher:Actor;outsider:Actor;merchantToken:string;call:Call;postpickup:boolean;reportKind?:'SOS'|'CUSTODY'}){
 const {db,shipment,orderId,assignment,driverActor,dispatcher,outsider,merchantToken,call,postpickup}=c;
 await assertLocalFoodFixture(db);
 const root='/api/mobile/v1',path=root+'/driver/food/assignments/'+assignment.assignmentId,staff=root+'/platform',fence={generation:assignment.generation,leaseGeneration:assignment.leaseGeneration};
 const merchant=(await db.query('SELECT merchant_id FROM bitpos.food_shipments WHERE id=$1',[shipment])).rows[0].merchant_id;
 await call(path+'/arrive','POST',{...fence,stage:'PICKUP',idempotencyKey:randomUUID()},driverActor.access);
 const proof=await call('/api/orders/'+orderId+'/delivery/pickup-proof','POST',{assignmentId:assignment.assignmentId,...fence,idempotencyKey:randomUUID(),rotate:false},merchantToken);
 if(postpickup)await call(path+'/consume-proof','POST',{...fence,proofId:proof.proofId,secret:proof.secret,idempotencyKey:randomUUID()},driverActor.access);
 const report={...fence,idempotencyKey:randomUUID(),kind:c.reportKind??'SOS',body:'Synthetic PRIVATE safety report; no emergency contact occurred'};
 assert.equal((await call(path+'/incidents','POST',report,outsider.access,404)).code,'RESOURCE_NOT_FOUND');
 const [reported,replayed]=await Promise.all([call(path+'/incidents','POST',report,driverActor.access),call(path+'/incidents','POST',report,driverActor.access)]);
 assert.deepEqual(replayed,reported);assert.equal(reported.paused,true);assert.equal(reported.incident.custodyPhase,postpickup?'PICKED_UP':'AT_PICKUP');assert.equal(JSON.stringify(reported).includes(report.body),false);
 assert.equal((await call(path+'/incidents','POST',{...report,body:'Tampered fixture report'},driverActor.access,409)).code,'IDEMPOTENCY_CONFLICT');
 if(process.argv.includes('--incident-browser-stage')){
  const account=(await db.query("INSERT INTO bitpos.mobile_accounts(auth_subject) VALUES('fa000000-0000-4000-8000-000000000002') ON CONFLICT(auth_subject) DO UPDATE SET auth_subject=excluded.auth_subject RETURNING id")).rows[0].id;
  let grant=(await db.query("SELECT id FROM bitpos.platform_staff_role_grants WHERE account_id=$1 AND role='dispatcher' AND revoked_at IS NULL AND expires_at>clock_timestamp()",[account])).rows[0]?.id;
  if(!grant){grant=randomUUID();await db.query("INSERT INTO bitpos.platform_staff_role_grants(id,account_id,role,granted_by,expires_at) VALUES($1,$2,'dispatcher','Synthetic082 local browser fixture',clock_timestamp()+interval '1 hour')",[grant,account]);}
  await db.query('INSERT INTO bitpos.platform_role_scopes(grant_id,merchant_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[grant,merchant]);
  const setup={status:'FIXTURE_PREPARED_NOT_ACCEPTED',merchantId:merchant,incidentId:reported.incident.incidentId,assignmentId:assignment.assignmentId,staffGrantId:grant,phone:'+66900000002',otp:'123456',fixture:'Local synthetic OTP identity and scoped dispatcher. No real messages/emergency contacts/payment.',physicalTesting:'deferred_by_user_2026-10-16'};
  await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch082-browser-fixture-20261018.json',JSON.stringify(setup,null,2)+'\n');console.log(JSON.stringify(setup));return;
 }
 const support=await call(path+'/incidents','POST',{...report,idempotencyKey:randomUUID(),kind:'SUPPORT',body:'Synthetic nonblocking request during safety pause'},driverActor.access);assert.equal(support.paused,true);assert.equal(support.incident.blocksDuty,false);
 const restricted=await call(root+'/driver/food/work','GET',undefined,driverActor.access);assert.equal(restricted.assignment.access,'RESTRICTED');assert.equal(restricted.assignment.reason,'INCIDENT');assert.equal(restricted.assignment.custodyPhase,postpickup?'PICKED_UP':'PREPICKUP');assert.equal('addressText' in restricted.assignment,false);
 const blocked=postpickup?await call(path+'/arrive','POST',{...fence,stage:'DROPOFF',idempotencyKey:randomUUID()},driverActor.access,409):await call(path+'/consume-proof','POST',{...fence,proofId:proof.proofId,secret:proof.secret,idempotencyKey:randomUUID()},driverActor.access,409);assert.equal(blocked.code,'INCIDENT');
 const own=await call(path+'/incidents','GET',undefined,driverActor.access),queue=await call(staff+'/merchants/'+merchant+'/food/incidents','GET',undefined,dispatcher.access);assert.equal(own.incidents.length,2);assert.equal(JSON.stringify(own).includes(report.body),false);assert.equal(JSON.stringify(queue).includes(report.body),false);assert.ok(queue.incidents.some((i:any)=>i.incidentId===reported.incident.incidentId));
 const incidentPath=staff+'/food/incidents/'+reported.incident.incidentId;
 assert.equal((await call(incidentPath+'/inspect','POST',{purpose:'Synthetic unauthorized inspection'},outsider.access,403)).code,'ROLE_REQUIRED');
 const inspected=await call(incidentPath+'/inspect','POST',{purpose:'Synthetic scoped dispatch investigation'},dispatcher.access);assert.equal(inspected.body,report.body);assert.ok(inspected.auditId);
 const resume={...fence,idempotencyKey:randomUUID(),expectedVersion:support.shipmentVersion,reason:'Synthetic same-custody safety review'};
 assert.equal((await call(staff+'/food/assignments/'+assignment.assignmentId+'/resume','POST',resume,dispatcher.access,409)).code,'INCIDENT_ACK_REQUIRED');
 const ack={idempotencyKey:randomUUID(),expectedVersion:'1',reason:'Synthetic acknowledgement is not resume'};
 const acknowledged=await call(incidentPath+'/acknowledge','POST',ack,dispatcher.access);assert.equal(acknowledged.paused,true);assert.deepEqual(await call(incidentPath+'/acknowledge','POST',ack,dispatcher.access),acknowledged);
 assert.equal((await call(root+'/driver/food/work','GET',undefined,driverActor.access)).assignment.access,'RESTRICTED');
 resume.expectedVersion=acknowledged.shipmentVersion;
 const resumed=await call(staff+'/food/assignments/'+assignment.assignmentId+'/resume','POST',resume,dispatcher.access);assert.equal(resumed.state,postpickup?'PICKED_UP':'AT_PICKUP');assert.equal(resumed.resolvedCount,1);assert.deepEqual(await call(staff+'/food/assignments/'+assignment.assignmentId+'/resume','POST',resume,dispatcher.access),resumed);
 const normal=await call(root+'/driver/food/work','GET',undefined,driverActor.access);assert.equal(normal.assignment.access,'NORMAL');assert.equal(normal.assignment.proofs.length,0);
 const state=(await db.query("SELECT a.state,l.state lease,s.state shipment,f.status kitchen,p.consumed_at IS NOT NULL consumed,p.revoked_at IS NOT NULL revoked,(SELECT count(*)::int FROM bitpos.food_assignment_incidents i WHERE i.assignment_id=a.id) incidents,(SELECT count(*)::int FROM bitpos.food_incident_access_audit au JOIN bitpos.food_assignment_incidents i ON i.id=au.incident_id WHERE i.assignment_id=a.id) inspections FROM bitpos.food_assignments a JOIN bitpos.driver_assignment_leases l ON l.id=a.lease_id JOIN bitpos.food_shipments s ON s.id=a.shipment_id JOIN bitpos.order_fulfillment f ON(f.merchant_id,f.order_id)=(s.merchant_id,s.order_id) JOIN bitpos.fulfillment_proofs p ON p.id=$2 WHERE a.id=$1",[assignment.assignmentId,proof.proofId])).rows[0];
 assert.equal(state.state,postpickup?'PICKED_UP':'AT_PICKUP');assert.equal(state.lease,'ACTIVE');assert.equal(state.kitchen,postpickup?'COLLECTED':'READY');assert.equal(state.consumed,postpickup);assert.equal(state.revoked,!postpickup);assert.equal(state.incidents,2);assert.equal(state.inspections,1);
 const evidence={status:c.reportKind==='CUSTODY'?'PASS_CURRENT_POSTPICKUP_DELIVERY_ISSUE_REPORT':'PASS_ACTUAL_HTTP_INCIDENT_AUTHORITY',postpickup,assignmentId:assignment.assignmentId,reported,acknowledged,resumed,state,fixture:'Synthetic identities/payment/private report; actual canonical merchant proof, HTTP transitions and persisted graph. No emergency services contacted.',limits:['No operator browser/native incident acceptance in this receipt','True concurrent report/pickup/release/resume and expiry permutations remain open'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile(c.reportKind==='CUSTODY'?'.omp/work/flutter-delivery-20261016/evidence/w02-delivery-issue-report-20261021.json':'.omp/work/flutter-delivery-20261016/evidence/dispatch081-incident-'+(postpickup?'postpickup':'prepickup')+'-http-20261018.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}
