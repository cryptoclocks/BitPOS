import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type pg from 'pg';
type Call=(path:string,method?:string,body?:unknown,token?:string,status?:number)=>Promise<any>;
export async function runFoodOfferAvd(c:{db:pg.Client;base:string;shipment:string;driver:string;dispatcher:{access:string};driverActor:{account:string;session:string;access:string};call:Call}){
 const {db,shipment,driver,dispatcher,driverActor,call}=c,evidence='.omp/work/flutter-delivery-20261016/evidence',runDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-',''),adb='/Users/cryptoclock/Library/Android/sdk/platform-tools/adb';
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 const api=new URL(c.base);assert.equal(api.hostname,'127.0.0.1');
 const session={accountId:driverActor.account,sessionId:driverActor.session,accessToken:driverActor.access,refreshToken:'r'.repeat(43),accessExpiresAt:new Date(Date.now()+1800000).toISOString(),refreshExpiresAt:new Date(Date.now()+3600000).toISOString()};
 const child=spawn('/Users/cryptoclock/development/flutter/bin/flutter',['test','integration_test/food_offer_decline_test.dart','-d','emulator-5554','--dart-define=BITPOS_FIXTURE=true','--dart-define=BITPOS_MOBILE_API=http://10.0.2.2:'+api.port+'/api/mobile/v1/','--dart-define=BITPOS_TEST_SESSION_BASE64='+Buffer.from(JSON.stringify(session)).toString('base64'),'--no-enable-impeller','--no-uninstall'],{cwd:'apps/mobile-driver',stdio:['ignore','pipe','pipe']});
 let text='',created=false,visible=false,committed=false,offer:any,pending=Promise.resolve();
 async function capture(name:string){const shot=spawn(adb,['-s','emulator-5554','exec-out','screencap','-p'],{stdio:['ignore','pipe','pipe']}),bytes:Buffer[]=[];shot.stdout.on('data',data=>bytes.push(data));assert.equal((await once(shot,'exit'))[0],0);await writeFile(evidence+'/'+name,Buffer.concat(bytes));}
 const observe=(bytes:Buffer)=>{process.stdout.write(bytes);text=(text+bytes.toString()).slice(-12000);
  if(!created&&text.includes('BITPOS_OFFER077_READY')){created=true;pending=pending.then(async()=>{
   const profile=await call('/api/mobile/v1/driver/profile','GET',undefined,driverActor.access);
   await call('/api/mobile/v1/driver/availability','PUT',{idempotencyKey:randomUUID(),expectedVersion:profile.driver.availability.version,online:true},driverActor.access);
   const version=(await db.query('SELECT version::text FROM bitpos.food_shipments WHERE id=$1',[shipment])).rows[0].version;
   offer=await call('/api/mobile/v1/platform/food/shipments/'+shipment+'/offers','POST',{idempotencyKey:randomUUID(),expectedVersion:version,driverId:driver},dispatcher.access);
  });void pending.catch(()=>{});}
  if(!visible&&text.includes('BITPOS_OFFER077_VISIBLE')){visible=true;pending=pending.then(()=>capture(`dispatch077-offer-visible-avd-${runDate}.png`));void pending.catch(()=>{});}
  if(!committed&&text.includes('BITPOS_OFFER077_COMMITTED')){committed=true;pending=pending.then(()=>capture(`dispatch077-offer-declined-avd-${runDate}.png`));void pending.catch(()=>{});}
 };child.stdout.on('data',observe);child.stderr.on('data',observe);const deadline=setTimeout(()=>child.kill('SIGTERM'),300000);
 try{
  const [code]=await once(child,'exit');clearTimeout(deadline);await pending;assert.equal(code,0);assert.ok(offer);assert.ok(visible&&committed);
  const state=(await db.query("SELECT f.state,f.version::text,(SELECT count(*)::int FROM bitpos.food_dispatch_commands c WHERE c.actor_account_id=$2 AND c.operation='decline' AND c.response->>'offerId'=f.id::text) commands,(SELECT count(*)::int FROM bitpos.food_assignments a WHERE a.offer_id=f.id) assignments,(SELECT count(*)::int FROM bitpos.driver_assignment_leases l WHERE l.driver_id=$3 AND l.state='ACTIVE') leases,(SELECT safe_payload->>'reason' FROM bitpos.shipment_events e WHERE e.shipment_id=f.shipment_id AND e.type='OFFER_DECLINED') reason FROM bitpos.food_dispatch_offers f WHERE f.id=$1",[offer.offerId,driverActor.account,driver])).rows[0];assert.deepEqual(state,{state:'REJECTED',version:'2',commands:1,assignments:0,leases:0,reason:'SAFETY'});
  const receipt={status:'PASS_JOINED_AVD_HTTP_PERSISTED_OFFER_REFUSAL',shipmentId:shipment,offerId:offer.offerId,state,screenshots:[`dispatch077-offer-visible-avd-${runDate}.png`,`dispatch077-offer-declined-avd-${runDate}.png`],fixture:true,checks:['Current native Android build on authorized existing AVD','Actual SSE admits freshly created canonical45s offer after native readiness','Native TH/EN-capable reason menu submits SAFETY through durable exact journal','Actual authenticated API persists one declined command/event with zero assignment/lease','Journal clears and native offer list removes declined offer'],limits:['Synthetic OTP/identity/approval/payment; no real dispatch or physical field proof','Secure storage mock isolates synthetic session, not HTTP or dispatch'],physicalTesting:'deferred_by_user_2026-10-16'};await writeFile(evidence+`/dispatch077-offer-decline-avd-${runDate}.json`,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 }finally{clearTimeout(deadline);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await once(child,'exit');}await pending.catch(()=>{});}
}
