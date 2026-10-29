import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import type pg from 'pg';
export async function runFoodWithdrawalAvd(c:{db:pg.Client;base:string;assignment:any;driverActor:{account:string;session:string;access:string}}){
 const {db,assignment,driverActor}=c,base=new URL(c.base);assert.equal(base.hostname,'127.0.0.1');assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 const session={accountId:driverActor.account,sessionId:driverActor.session,accessToken:driverActor.access,refreshToken:'r'.repeat(43),accessExpiresAt:new Date(Date.now()+1800000).toISOString(),refreshExpiresAt:new Date(Date.now()+3600000).toISOString()};
 const child=spawn('/Users/cryptoclock/development/flutter/bin/flutter',['test','integration_test/food_withdrawal_test.dart','-d','emulator-5554','--dart-define=BITPOS_FIXTURE=true','--dart-define=BITPOS_MOBILE_API=http://10.0.2.2:'+base.port+'/api/mobile/v1/','--dart-define=BITPOS_TEST_SESSION_BASE64='+Buffer.from(JSON.stringify(session)).toString('base64'),'--no-enable-impeller','--no-uninstall'],{cwd:'apps/mobile-driver',stdio:['ignore','pipe','pipe']});
 let text='',capture:Promise<void>|undefined;const evidence='.omp/work/flutter-delivery-20261016/evidence';
 const observe=(bytes:Buffer)=>{process.stdout.write(bytes);text=(text+bytes.toString()).slice(-16000);if(!capture&&text.includes('BITPOS_WITHDRAWAL080_CONFIRMED'))capture=(async()=>{const adb=spawn('/Users/cryptoclock/Library/Android/sdk/platform-tools/adb',['-s','emulator-5554','exec-out','screencap','-p'],{stdio:['ignore','pipe','pipe']}),chunks:Buffer[]=[];adb.stdout.on('data',value=>chunks.push(value));assert.equal((await once(adb,'exit'))[0],0);await writeFile(evidence+'/dispatch080-withdrawal-confirmed-avd-20261018.png',Buffer.concat(chunks));})();};
 child.stdout.on('data',observe);child.stderr.on('data',observe);const deadline=setTimeout(()=>child.kill('SIGTERM'),300000);
 try{assert.equal((await once(child,'exit'))[0],0);assert.ok(capture);await capture;
  const persisted=(await db.query("SELECT a.state,l.state lease,s.state shipment,s.active_assignment_id IS NULL unassigned,(SELECT count(*)::int FROM bitpos.food_dispatch_commands c WHERE c.actor_account_id=$2 AND c.operation='withdraw') commands FROM bitpos.food_assignments a JOIN bitpos.driver_assignment_leases l ON l.id=a.lease_id JOIN bitpos.food_shipments s ON s.id=a.shipment_id WHERE a.id=$1",[assignment.assignmentId,driverActor.account])).rows[0];
  assert.deepEqual(persisted,{state:'RELEASED',lease:'RELEASED',shipment:'READY_FOR_DISPATCH',unassigned:true,commands:1});
  const receipt={status:'PASS_JOINED_NATIVE_AVD_HTTP_PERSISTED_WITHDRAWAL',assignmentId:assignment.assignmentId,persisted,fixture:true,screenshot:'dispatch080-withdrawal-confirmed-avd-20261018.png',limits:['Synthetic secure-storage identity and SQL payment fixture','No physical/field/full080 or platform acceptance'],physicalTesting:'deferred_by_user_2026-10-16'};await writeFile(evidence+'/dispatch080-withdrawal-avd-20261018.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 }finally{clearTimeout(deadline);}
}
