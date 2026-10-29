import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import type pg from 'pg';
import {FoodIncidentReviewSchema} from '../../packages/contracts/src/mobile-v1.generated';
type Actor={account:string;session:string;access:string};
export async function verifyFoodIncidentAuthoritySql(c:{db:pg.Client;shipment:string;assignment:any;driver:string;driverActor:Actor;dispatcher:Actor;outsider:Actor;merchantToken:string}){
 const {db,shipment,assignment,driver,driverActor,dispatcher,outsider}=c;
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 const source=await readFile('supabase/migrations/081_food_incident_authority.sql','utf8'),hash=(value:string)=>createHash('sha256').update(value).digest('hex');
 await db.query('BEGIN');
 try{
  if(!(await db.query('SELECT 1 FROM public.bitpos_migrations WHERE name=$1',['081_food_incident_authority.sql'])).rowCount)await db.query(source);
  const reviewEnabled=process.argv.includes('--incident-review-sql');
  if(reviewEnabled)await db.query(await readFile('supabase/migrations/082_food_incident_review_snapshot.sql','utf8'));
  await db.query('SET LOCAL search_path=bitpos,public');
  await db.query("SELECT set_config('bitpos.merchant',(SELECT merchant_id::text FROM food_shipments WHERE id=$1),true)",[shipment]);
  const verifiedUntil=(await db.query('SELECT verified_until FROM driver_profiles WHERE id=$1',[driver])).rows[0].verified_until;
  async function actor(who:Actor){await db.query('RESET ROLE');await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true)",[who.account,who.session,hash(who.access)]);await db.query('SET LOCAL ROLE bitpos_app');}
  async function denied(sql:string,args:unknown[],message:string){await db.query('SAVEPOINT rejected');try{await assert.rejects(db.query(sql,args),(error:Error)=>error.message===message);}finally{await db.query('ROLLBACK TO SAVEPOINT rejected');await db.query('RELEASE SAVEPOINT rejected');}}
  const fence={generation:assignment.generation,leaseGeneration:assignment.leaseGeneration};
  await actor(driverActor);await db.query('SELECT dispatch_food_arrive($1,$2::jsonb)',[assignment.assignmentId,JSON.stringify({...fence,idempotencyKey:randomUUID(),stage:'PICKUP'})]);
  const proof=(await db.query("SELECT dispatch_issue_proof($1,'PICKUP',$2,$3,$4,$5,false,$6) value",[assignment.assignmentId,fence.generation,fence.leaseGeneration,randomUUID(),hash('private-fixture-pickup-secret'),hash(c.merchantToken)])).rows[0].value;
  await db.query('RESET ROLE');const physicalBefore=(await db.query('SELECT state FROM food_shipments WHERE id=$1',[shipment])).rows[0].state;await db.query('SET LOCAL ROLE bitpos_app');
  const report={...fence,idempotencyKey:randomUUID(),kind:'SOS',body:'Synthetic PRIVATE incident body; no emergency contact occurred'};
  await actor(outsider);await denied('SELECT dispatch_food_report_incident($1,$2::jsonb)',[assignment.assignmentId,JSON.stringify(report)],'RESOURCE_NOT_FOUND');
  await actor(driverActor);await db.query('RESET ROLE');await db.query("UPDATE driver_profiles SET status='SUSPENDED',verified_until=NULL WHERE id=$1",[driver]);await db.query('SET LOCAL ROLE bitpos_app');
  const reported=(await db.query('SELECT dispatch_food_report_incident($1,$2::jsonb) value',[assignment.assignmentId,JSON.stringify(report)])).rows[0].value;
  assert.equal(reported.paused,true);assert.equal(reported.incident.custodyPhase,'AT_PICKUP');assert.equal(JSON.stringify(reported).includes(report.body),false);
  assert.deepEqual((await db.query('SELECT dispatch_food_report_incident($1,$2::jsonb) value',[assignment.assignmentId,JSON.stringify(report)])).rows[0].value,reported);
  await denied('SELECT dispatch_food_report_incident($1,$2::jsonb)',[assignment.assignmentId,JSON.stringify({...report,body:'Tampered report'})],'IDEMPOTENCY_CONFLICT');
  const support=(await db.query('SELECT dispatch_food_report_incident($1,$2::jsonb) value',[assignment.assignmentId,JSON.stringify({...report,idempotencyKey:randomUUID(),kind:'SUPPORT',body:'Synthetic nonblocking support while safety report remains open'})])).rows[0].value;
  assert.equal(support.incident.blocksDuty,false);assert.equal(support.paused,true);
  await db.query('RESET ROLE');await db.query("UPDATE driver_profiles SET status='APPROVED',verified_until=$2 WHERE id=$1",[driver,verifiedUntil]);await db.query('SET LOCAL ROLE bitpos_app');
  const restricted=(await db.query('SELECT dispatch_driver_work() value')).rows[0].value;assert.equal(restricted.assignment.access,'RESTRICTED');assert.equal(restricted.assignment.reason,'INCIDENT');assert.equal('addressText' in restricted.assignment,false);
  await denied('SELECT dispatch_consume_proof($1,$2,$3,$4,$5,$6)',[assignment.assignmentId,proof.proofId,fence.generation,fence.leaseGeneration,randomUUID(),hash('private-fixture-pickup-secret')],'INCIDENT');
  const own=(await db.query('SELECT dispatch_food_incidents($1) value',[assignment.assignmentId])).rows[0].value;assert.ok(own.incidents.some((i:any)=>i.incidentId===reported.incident.incidentId));assert.equal(JSON.stringify(own).includes(report.body),false);assert.equal(own.nextCursor,null);
  await actor(outsider);await denied('SELECT dispatch_food_incident_inspect($1,$2)',[reported.incident.incidentId,'Synthetic unauthorized lookup'],'ROLE_REQUIRED');
  if(reviewEnabled)await denied('SELECT dispatch_food_incident_review($1)',[reported.incident.incidentId],'ROLE_REQUIRED');
  await actor(dispatcher);
  const queue=(await db.query("SELECT dispatch_food_incident_queue(current_setting('bitpos.merchant')::uuid) value")).rows[0].value;
  assert.ok(queue.incidents.some((i:any)=>i.incidentId===reported.incident.incidentId));assert.equal(JSON.stringify(queue).includes(report.body),false);
  async function review(){const result=FoodIncidentReviewSchema.parse((await db.query('SELECT dispatch_food_incident_review($1) value',[reported.incident.incidentId])).rows[0].value);assert.equal(JSON.stringify(result).includes(report.body),false);return result;}
  if(reviewEnabled){const current=await review();assert.equal(current.currentDuty,true);assert.equal(current.unresolvedBlocking,1);assert.equal(current.unacknowledgedBlocking,1);assert.equal(current.shipmentVersion,support.shipmentVersion);}
  const resume={...fence,idempotencyKey:randomUUID(),expectedVersion:support.shipmentVersion,reason:'Synthetic same-custody review'};
  await denied('SELECT dispatch_food_resume_incidents($1,$2::jsonb)',[assignment.assignmentId,JSON.stringify(resume)],'INCIDENT_ACK_REQUIRED');
  const inspected=(await db.query('SELECT dispatch_food_incident_inspect($1,$2) value',[reported.incident.incidentId,'Synthetic dispatch safety investigation'])).rows[0].value;assert.equal(inspected.body,report.body);assert.ok(inspected.auditId);
  const ack={idempotencyKey:randomUUID(),expectedVersion:'1',reason:'Synthetic staff acknowledged, not resumed'};
  const acknowledged=(await db.query('SELECT dispatch_food_ack_incident($1,$2::jsonb) value',[reported.incident.incidentId,JSON.stringify(ack)])).rows[0].value;assert.equal(acknowledged.paused,true);
  assert.deepEqual((await db.query('SELECT dispatch_food_ack_incident($1,$2::jsonb) value',[reported.incident.incidentId,JSON.stringify(ack)])).rows[0].value,acknowledged);
  resume.expectedVersion=acknowledged.shipmentVersion;
  if(reviewEnabled){const current=await review();assert.equal(current.currentDuty,true);assert.equal(current.unacknowledgedBlocking,0);assert.equal(current.unresolvedBlocking,1);assert.equal(current.shipmentVersion,acknowledged.shipmentVersion);}
  await db.query('RESET ROLE');await db.query("UPDATE driver_profiles SET status='SUSPENDED',verified_until=NULL WHERE id=$1",[driver]);await db.query('SET LOCAL ROLE bitpos_app');
  await denied('SELECT dispatch_food_resume_incidents($1,$2::jsonb)',[assignment.assignmentId,JSON.stringify(resume)],'DRIVER_SUSPENDED');
  await db.query('RESET ROLE');assert.equal((await db.query('SELECT resolved_at FROM food_assignment_incidents WHERE id=$1',[reported.incident.incidentId])).rows[0].resolved_at,null);
  await db.query("UPDATE driver_profiles SET status='APPROVED',verified_until=$2 WHERE id=$1",[driver,verifiedUntil]);await db.query('SET LOCAL ROLE bitpos_app');
  const resumed=(await db.query('SELECT dispatch_food_resume_incidents($1,$2::jsonb) value',[assignment.assignmentId,JSON.stringify(resume)])).rows[0].value;assert.equal(resumed.state,'AT_PICKUP');assert.equal(resumed.resolvedCount,1);
  assert.deepEqual((await db.query('SELECT dispatch_food_resume_incidents($1,$2::jsonb) value',[assignment.assignmentId,JSON.stringify(resume)])).rows[0].value,resumed);
  if(reviewEnabled){const current=await review();assert.equal(current.currentDuty,true);assert.equal(current.unresolvedBlocking,0);assert.equal(current.assignmentState,'AT_PICKUP');assert.equal(current.shipmentVersion,resumed.shipmentVersion);}
  await actor(driverActor);const normal=(await db.query('SELECT dispatch_driver_work() value')).rows[0].value;assert.equal(normal.assignment.access,'NORMAL');assert.equal(normal.assignment.proofs.length,0);
  await db.query('RESET ROLE');
  const state=(await db.query("SELECT a.state,l.state lease,s.state shipment,f.status kitchen,p.revoked_at IS NOT NULL revoked,p.consumed_at IS NULL unconsumed,(SELECT count(*)::int FROM food_incident_access_audit WHERE incident_id=$2) audits,(SELECT resolution FROM food_assignment_incidents WHERE id=$2) resolution FROM food_assignments a JOIN driver_assignment_leases l ON l.id=a.lease_id JOIN food_shipments s ON s.id=a.shipment_id JOIN order_fulfillment f ON(f.merchant_id,f.order_id)=(s.merchant_id,s.order_id) JOIN fulfillment_proofs p ON p.id=$3 WHERE a.id=$1",[assignment.assignmentId,reported.incident.incidentId,proof.proofId])).rows[0];
  assert.deepEqual(state,{state:'AT_PICKUP',lease:'ACTIVE',shipment:physicalBefore,kitchen:'READY',revoked:true,unconsumed:true,audits:1,resolution:'SAME_CUSTODY_RESUMED'});
  await denied('UPDATE food_assignment_incidents SET private_body=$2 WHERE id=$1',[reported.incident.incidentId,'Rewritten private history'],'IMMUTABLE_INCIDENT_HISTORY');
  await denied('DELETE FROM food_assignment_incidents WHERE id=$1',[reported.incident.incidentId],'IMMUTABLE_INCIDENT_HISTORY');
  await actor(driverActor);await db.query('SELECT dispatch_food_withdraw($1,$2::jsonb)',[assignment.assignmentId,JSON.stringify({...fence,idempotencyKey:randomUUID(),expectedVersion:resumed.shipmentVersion,reason:'SAFETY'})]);
  const historical=(await db.query('SELECT dispatch_food_report_incident($1,$2::jsonb) value',[assignment.assignmentId,JSON.stringify({...report,idempotencyKey:randomUUID()})])).rows[0].value;assert.equal(historical.paused,false);assert.equal(historical.incident.custodyPhase,'RELEASED');
  if(reviewEnabled){await actor(dispatcher);const current=await review();assert.equal(current.currentDuty,false);assert.equal(current.assignmentState,'RELEASED');assert.equal(current.leaseState,'RELEASED');assert.equal(current.incident.incidentId,reported.incident.incidentId);}
  await db.query('RESET ROLE');await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  const evidence={status:'PASS_ROLLBACK_INCIDENT_AUTHORITY',sourceSha256:hash(source),shipmentId:shipment,assignmentId:assignment.assignmentId,reported,acknowledged,resumed,state,historical,fixture:'Canonical actual HTTP shipment/assignment; rollback-only081 SQL, synthetic identity/payment/private report',limits:['081 not activated or HTTP/mobile/operator accepted','Postpickup/concurrent report/resume and privacy/source-expiry permutations remain open'],physicalTesting:'deferred_by_user_2026-10-16'};
  if(reviewEnabled){
   const reviewed={...evidence,status:'PASS_ROLLBACK_SCOPED_INCIDENT_REVIEW',reviewSourceSha256:hash(await readFile('supabase/migrations/082_food_incident_review_snapshot.sql','utf8')),fixture:'Canonical HTTP assignment;081 active disposable-only;082 rollback-only scoped review read under actual app role',limits:['082 NOT APPLIED; narrow review route/browser integration not accepted','Concurrent source-revocation/current-custody review permutations remain open']};
   await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch082-incident-review-sql-20261018.json',JSON.stringify(reviewed,null,2)+'\n');console.log(JSON.stringify(reviewed));
  }else{await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch081-incident-authority-sql-20261018.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));}
 }finally{await db.query('ROLLBACK');}
}
