import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import type {AddressInfo} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket} from 'ws';
import type {DeviceEvent,DeviceCommandResult,PickupNotice} from '../../packages/contracts/src/index';
import {publicPickupFixture} from '../../tests/backend-pickup-fixture';
import {staffToken} from '../../tests/backend-table-fixture';
import {server} from '../../apps/api/src/index';
import {pool} from '../../apps/api/src/db';

type Message=DeviceEvent|DeviceCommandResult;
type PickupEvent=Extract<DeviceEvent,{type:'PICKUP_READY'}>;
const sockets:WebSocket[]=[];
server.listen(0,'127.0.0.1');await once(server,'listening');
const origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
async function publicRequest(path:string,method:string,body?:unknown){
 const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;
}
try{
 const f=await publicPickupFixture(publicRequest),token=await staffToken(pool,f.merchant,f.actor,'staff'),before=await f.financial();
 async function merchant(path:string,body?:unknown,expected=200){
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;
 }
 async function connect(device:string){
  const socket=new WebSocket(origin.replace('http:','ws:')+'/api/device',{headers:{Authorization:'Bearer '+f.credentials.get(device)}});sockets.push(socket);
  const frames:Message[]=[],pickups:PickupEvent[]=[];let displayed:PickupNotice|undefined;
  // Explicit synthetic transport consumer. This tests cancellation identity, NOT
  // firmware pixels/flush/touch/audio. Every event below comes from the real WS.
  socket.on('message',raw=>{const event:Message=JSON.parse(raw.toString());frames.push(event);if(event.type==='PICKUP_READY'){pickups.push(event);if(event.payload.state==='READY')displayed=event.payload;else if(displayed?.notificationId===event.payload.notificationId&&displayed.effectId===event.payload.effectId)displayed=undefined;}});
  await once(socket,'open');
  async function frame<K extends Message['type']>(type:K,predicate:(value:Extract<Message,{type:K}>)=>boolean=()=>true){
   const deadline=Date.now()+12000;
   while(Date.now()<deadline){const i=frames.findIndex(value=>value.type===type&&predicate(value as Extract<Message,{type:K}>));if(i>=0)return frames.splice(i,1)[0] as Extract<Message,{type:K}>;await delay(25);}
   throw Error('Missing public pickup transport frame '+type);
  }
  const config=await frame('CONFIG');await frame('SNAPSHOT');
  async function command(body:object){const requestId=randomUUID();socket.send(JSON.stringify({schemaVersion:2,requestId,connectionGeneration:config.connectionGeneration,...body}));return frame('COMMAND_RESULT',value=>value.requestId===requestId);}
  assert.equal((await command({type:'CAPABILITIES',capabilities:['pickup_ready_v1']})).result.ok,true);
  return {socket,frames,pickups,frame,command,displayed:()=>displayed};
 }
 const target=await connect(f.b.id),other=await connect(f.a.id);
 const orderPath='/api/orders/'+f.order.id;
 await merchant(orderPath+'/fulfillment',{status:'PREPARING',expectedVersion:0,idempotencyKey:randomUUID()});
 await merchant(orderPath+'/fulfillment',{status:'READY',expectedVersion:1,idempotencyKey:randomUUID()});
 const first=await target.frame('PICKUP_READY',e=>e.payload.state==='READY');assert.equal(first.payload.orderId,f.order.id);assert.equal(target.displayed()?.notificationId,first.payload.notificationId);
 // Later menu-only visitors, one already expired, must not revoke delivery.
 await f.visit();
 await f.tenant(f.merchant,db=>db.query(`INSERT INTO table_visits(merchant_id,entry_id,request_id,created_at,expires_at) SELECT merchant_id,entry_id,$2,created_at+interval '1 microsecond',created_at+interval '2 microseconds' FROM table_visits WHERE id=$1`,[f.originalBinding.id,randomUUID()]));
 await delay(1250);assert.equal((await merchant(orderPath)).fulfillment.notification.state,'DELIVERED');assert.equal(target.displayed()?.notificationId,first.payload.notificationId);
 const render=(event:PickupEvent)=>({type:'ACK',eventId:event.eventId,deviceSeq:event.deviceSeq,orderId:null,orderVersion:null,screenGeneration:event.screenGeneration,rendered:true});
 assert.equal((await target.command(render(first))).result.ok,true);assert.equal((await merchant(orderPath)).fulfillment.notification.state,'RENDERED');
 const replacement=await f.visit();await publicRequest(replacement.path+'/quotes','POST',{items:[{productId:f.product,qty:1}]});
 // Explicit confirmation cannot send an old order into this guest's active cart.
 const refused=await merchant(orderPath+'/notification/retry',{expectedVersion:2,idempotencyKey:randomUUID(),targetDeviceId:f.b.id,assignmentGeneration:'1',confirmTarget:true},409);assert.equal(refused.error.code,'NOTIFICATION_TARGET_CHANGED');
 await publicRequest(replacement.path+'/release','POST',{});
 const cancel=await target.frame('PICKUP_READY',e=>e.payload.state==='CANCELED'&&e.payload.notificationId===first.payload.notificationId);
 assert.equal(cancel.payload.effectId,first.payload.effectId);assert.equal(cancel.payload.sound,false);assert.equal(target.displayed(),undefined,'matching server cancellation clears only the original synthetic overlay');
 assert.equal((await target.command(render(cancel))).result.ok,true);
 const current=(await f.tenant(f.merchant,db=>db.query('SELECT screen_generation::text FROM device_screen_state WHERE device_id=$1',[f.b.id]))).rows[0].screen_generation;
 const stale=await target.command({type:'PICKUP_ACK',notificationId:first.payload.notificationId,screenGeneration:current});assert.equal(stale.result.ok,false);if(!stale.result.ok)assert.equal(stale.result.error.code,'INVALID_ACK');
 const invalid=await merchant(orderPath);assert.equal(invalid.fulfillment.status,'READY');assert.equal(invalid.fulfillment.version,2);assert.equal(invalid.fulfillment.notification.state,'TARGET_CHANGED');
 await delay(1250);assert.equal(target.pickups.filter(e=>e.payload.state==='READY').length,1,'no automatic replacement READY');assert.equal(other.pickups.length,0,'no cross-device delivery');assert.deepEqual(await f.financial(),before);
 const key=randomUUID(),retry={expectedVersion:2,idempotencyKey:key,targetDeviceId:f.b.id,assignmentGeneration:'1',confirmTarget:true};
 const confirmed=await merchant(orderPath+'/notification/retry',retry);assert.deepEqual(await merchant(orderPath+'/notification/retry',retry),confirmed);assert.equal(confirmed.fulfillment.version,3);
 const next=await target.frame('PICKUP_READY',e=>e.payload.state==='READY'&&e.payload.notificationId!==first.payload.notificationId);assert.equal(next.payload.orderId,f.order.id);
 assert.equal((await target.command(render(next))).result.ok,true);assert.equal((await merchant(orderPath)).fulfillment.notification.state,'RENDERED');
 assert.equal((await target.command({type:'PICKUP_ACK',notificationId:next.payload.notificationId,screenGeneration:next.screenGeneration})).result.ok,true);
 const acknowledged=await merchant(orderPath);assert.equal(acknowledged.fulfillment.status,'READY');assert.equal(acknowledged.fulfillment.notification.state,'ACKNOWLEDGED');assert.deepEqual(await f.financial(),before);
 const binding=await f.notice();assert.equal(binding.visit_id,f.originalBinding.id);assert.equal(binding.binding_confirmed_by,f.actor);assert.ok(binding.binding_confirmed_at);
 const evidence={scope:'post-submit-20261012',origin:'actual_local_public_HTTP_WebSocket_with_synthetic_PAID_and_transport_consumer',physical:false,chain:false,orderId:f.order.id,checks:['actual public visit/quote/order and ended original session','synthetic PAID receipt ACK then real public dismiss','unused/expired anonymous visit does not suppress READY/render','active acquired different guest refuses staff retry','matching CANCELED from original target after release','merchant stays TARGET_CHANGED; stale WS guest ACK rejected','no auto-retarget or cross-device notice','confirmed retry persists original guest and separate acquired fence','unchanged bill/customer/quote/payment/stock/financial effects; kitchen remains READY'],at:new Date().toISOString()};
 fs.mkdirSync('.omp/work/post-submit-20261012/evidence',{recursive:true});fs.writeFileSync('.omp/work/post-submit-20261012/evidence/pickup-session-transport-smoke.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{for(const socket of sockets)socket.terminate();server.close();await once(server,'close');await pool.end();}
