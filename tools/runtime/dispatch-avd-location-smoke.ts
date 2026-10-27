import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
const adb='/Users/cryptoclock/Library/Android/sdk/platform-tools/adb';
const fixture=JSON.parse(await readFile('.omp/work/flutter-delivery-20261016/evidence/dispatch066-avd-fixture-20261018.json','utf8'));
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'});await db.connect();
const meters=(a:number,b:number)=>Math.hypot(a/1e7*111320,b/1e7*111320*Math.cos(13.756*Math.PI/180));
let latest: {seq:string;generation:string;lease_generation:string;captured_at:Date;received_at:Date;latitude_e7:number;longitude_e7:number;accuracy_mm:number}|undefined;
let assignment:{id:string;generation:string;lease_generation:string}|undefined,started:Date|undefined,target:{latitudeE7:number;longitudeE7:number}|undefined;
try{
 assignment=(await db.query('SELECT id,generation::text,lease_generation::text FROM bitpos.food_assignments WHERE shipment_id=$1 AND closed_at IS NULL',[fixture.shipmentId])).rows[0];assert.ok(assignment);
 const before=(await db.query('SELECT seq::text,latitude_e7 FROM bitpos.driver_latest_locations WHERE assignment_id=$1',[assignment.id])).rows[0];assert.ok(before,'foreground sample must exist before background verification');
 target=before.latitude_e7>137566000?{latitudeE7:137563000,longitudeE7:1005021000}:{latitudeE7:137568000,longitudeE7:1005026000};
 execFileSync(adb,['-s','emulator-5554','shell','input','keyevent','KEYCODE_HOME']);
 await new Promise(resolve=>setTimeout(resolve,5500));started=new Date();
 execFileSync(adb,['-s','emulator-5554','emu','geo','fix',String(target.longitudeE7/1e7),String(target.latitudeE7/1e7)]);
 const deadline=Date.now()+20000;
 const matches=()=>latest&&BigInt(latest.seq)>BigInt(before.seq)&&latest.received_at>=started!&&meters(latest.latitude_e7-target!.latitudeE7,latest.longitude_e7-target!.longitudeE7)<=latest.accuracy_mm/1000+1;
 do{latest=(await db.query('SELECT seq::text,generation::text,lease_generation::text,captured_at,received_at,latitude_e7,longitude_e7,accuracy_mm FROM bitpos.driver_latest_locations WHERE assignment_id=$1',[assignment.id])).rows[0];if(matches())break;await new Promise(resolve=>setTimeout(resolve,500));}while(Date.now()<deadline);
 assert.ok(matches(),'new background coordinate must reach SQL within native reported accuracy plus1m rounding margin');assert.ok(latest);assert.equal(latest.generation,assignment.generation);assert.equal(latest.lease_generation,assignment.lease_generation);
 const receipt={status:'PASS',assignment,priorSequence:before.seq,backgroundInjectionAt:started,target,latest,fixtures:['AVD native location manager GPS coordinate injection; not real GPS','Synthetic OTP, driver approval and settlement'],physicalTesting:'deferred_by_user_2026-10-16',limits:['Android emulator foreground service while app is backgrounded, not process-kill/reboot/iOS/battery proof']};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch066-avd-background-location-20261018.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}catch(error){await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch066-avd-background-location-failure-20261018.json',JSON.stringify({status:'FAIL',assignment,started,target,latest,error:String(error),physicalTesting:'deferred_by_user_2026-10-16'},null,2)+'\n');throw error;}finally{await db.end();}
