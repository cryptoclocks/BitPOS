import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import type pg from 'pg';
type Call=(path:string,method?:string,body?:unknown,token?:string,status?:number)=>Promise<any>;
export async function runFoodIncidentAvd(c:{db:pg.Client;base:string;orderId:string;assignment:any;driverActor:{account:string;session:string;access:string};dispatcher:{access:string};merchantToken:string;call:Call}){
 const {db,assignment,driverActor,dispatcher,merchantToken,orderId,call}=c,base=new URL(c.base);assert.equal(base.hostname,'127.0.0.1');assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 const root='/api/mobile/v1',fence={generation:assignment.generation,leaseGeneration:assignment.leaseGeneration};
 await call(root+'/driver/food/assignments/'+assignment.assignmentId+'/arrive','POST',{...fence,stage:'PICKUP',idempotencyKey:randomUUID()},driverActor.access);
 const proof=await call('/api/orders/'+orderId+'/delivery/pickup-proof','POST',{assignmentId:assignment.assignmentId,...fence,idempotencyKey:randomUUID(),rotate:false},merchantToken);
 const session={accountId:driverActor.account,sessionId:driverActor.session,accessToken:driverActor.access,refreshToken:'r'.repeat(43),accessExpiresAt:new Date(Date.now()+1800000).toISOString(),refreshExpiresAt:new Date(Date.now()+3600000).toISOString()};
 const evidence='.omp/work/flutter-delivery-20261016/evidence',screenshots:string[]=[];
 async function capture(stage:string){const name='dispatch081-incident-'+stage+'-avd-20261018.png',adb=spawn('/Users/cryptoclock/Library/Android/sdk/platform-tools/adb',['-s','emulator-5554','exec-out','screencap','-p'],{stdio:['ignore','pipe','pipe']}),chunks:Buffer[]=[];adb.stdout.on('data',value=>chunks.push(value));assert.equal((await once(adb,'exit'))[0],0);await writeFile(evidence+'/'+name,Buffer.concat(chunks));screenshots.push(name);}
 const child=spawn('/Users/cryptoclock/development/flutter/bin/flutter',['test','integration_test/food_incident_test.dart','-d','emulator-5554','--dart-define=BITPOS_FIXTURE=true','--dart-define=BITPOS_MOBILE_API=http://10.0.2.2:'+base.port+'/api/mobile/v1/','--dart-define=BITPOS_TEST_SESSION_BASE64='+Buffer.from(JSON.stringify(session)).toString('base64'),'--no-enable-impeller','--no-uninstall'],{cwd:'apps/mobile-driver',stdio:['ignore','pipe','pipe']});
 let text='',recorded=false,ackVisible=false,resumedVisible=false,acknowledged:any,resumed:any;let pending=Promise.resolve();
 const observe=(bytes:Buffer)=>{process.stdout.write(bytes);text=(text+bytes.toString()).slice(-16000);
  if(!recorded&&text.includes('BITPOS_INCIDENT081_RECORDED')){recorded=true;pending=pending.then(async()=>{
   await capture('recorded');const incident=(await call(root+'/driver/food/assignments/'+assignment.assignmentId+'/incidents','GET',undefined,driverActor.access)).incidents[0];
   const inspected=await call(root+'/platform/food/incidents/'+incident.incidentId+'/inspect','POST',{purpose:'Synthetic AVD coordinator scoped safety investigation'},dispatcher.access);assert.ok(inspected.auditId);
   acknowledged=await call(root+'/platform/food/incidents/'+incident.incidentId+'/acknowledge','POST',{idempotencyKey:randomUUID(),expectedVersion:incident.incidentVersion,reason:'Synthetic AVD coordinator ACK; not resume'},dispatcher.access);assert.equal(acknowledged.paused,true);
  });void pending.catch(()=>{});}
  if(!ackVisible&&text.includes('BITPOS_INCIDENT081_ACK_VISIBLE')){ackVisible=true;pending=pending.then(async()=>{await capture('acknowledged');resumed=await call(root+'/platform/food/assignments/'+assignment.assignmentId+'/resume','POST',{...fence,idempotencyKey:randomUUID(),expectedVersion:acknowledged.shipmentVersion,reason:'Synthetic separate same-custody AVD review'},dispatcher.access);});void pending.catch(()=>{});}
  if(!resumedVisible&&text.includes('BITPOS_INCIDENT081_RESUMED')){resumedVisible=true;pending=pending.then(()=>capture('resumed'));void pending.catch(()=>{});}
 };
 child.stdout.on('data',observe);child.stderr.on('data',observe);const deadline=setTimeout(()=>child.kill('SIGTERM'),300000);
 try{assert.equal((await once(child,'exit'))[0],0);await pending;assert.ok(recorded&&ackVisible&&resumedVisible);assert.equal(resumed.state,'AT_PICKUP');
  const persisted=(await db.query("SELECT a.state,l.state lease,f.status kitchen,p.revoked_at IS NOT NULL revoked,p.consumed_at IS NULL unconsumed,(SELECT count(*)::int FROM bitpos.food_assignment_incidents i WHERE i.assignment_id=a.id AND i.resolution='SAME_CUSTODY_RESUMED') resolved,(SELECT count(*)::int FROM bitpos.food_incident_access_audit au JOIN bitpos.food_assignment_incidents i ON i.id=au.incident_id WHERE i.assignment_id=a.id) inspections FROM bitpos.food_assignments a JOIN bitpos.driver_assignment_leases l ON l.id=a.lease_id JOIN bitpos.food_shipments s ON s.id=a.shipment_id JOIN bitpos.order_fulfillment f ON(f.merchant_id,f.order_id)=(s.merchant_id,s.order_id) JOIN bitpos.fulfillment_proofs p ON p.id=$2 WHERE a.id=$1",[assignment.assignmentId,proof.proofId])).rows[0];assert.deepEqual(persisted,{state:'AT_PICKUP',lease:'ACTIVE',kitchen:'READY',revoked:true,unconsumed:true,resolved:1,inspections:1});
  const receipt={status:'PASS_JOINED_NATIVE_AVD_HTTP_PERSISTED_INCIDENT',assignmentId:assignment.assignmentId,acknowledged,resumed,persisted,screenshots,fixture:'Synthetic secure-storage identity/payment; actual native report+safe history, scoped coordinator HTTP inspection/ACK/separate resume. No emergency services contacted.',limits:['Coordinator is not operator browser acceptance','No actual AVD network-response-loss injection or physical/field/GPS proof'],physicalTesting:'deferred_by_user_2026-10-16'};await writeFile(evidence+'/dispatch081-incident-avd-20261018.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 }finally{clearTimeout(deadline);await pending;}
}
