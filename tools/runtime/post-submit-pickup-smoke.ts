import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import type {AddressInfo} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket} from 'ws';
import {tableFixture,staffToken} from '../../tests/backend-table-fixture';
import {server} from '../../apps/api/src/index';
import {pool} from '../../apps/api/src/db';
const f=await tableFixture(),{order}=await f.create(await f.quote()),token=await staffToken(pool,f.merchant,f.actor,'staff');
// Synthetic tenant and verified-state fixture only: no chain or physical proof.
await f.tenant(f.merchant,db=>db.query("UPDATE orders SET status='PAID',version=version+1 WHERE id=$1",[order.id]));
server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
const sockets:WebSocket[]=[];
async function api(path:string,body?:unknown){const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;}
async function connect(device:string){
 const socket=new WebSocket(origin.replace('http:','ws:')+'/api/device',{headers:{Authorization:'Bearer '+f.credentials.get(device)}});sockets.push(socket);const frames:any[]=[];socket.on('message',raw=>frames.push(JSON.parse(raw.toString())));await once(socket,'open');
 async function frame(type:string,predicate=(v:any)=>true){const deadline=Date.now()+12000;while(Date.now()<deadline){const i=frames.findIndex(v=>v.type===type&&predicate(v));if(i>=0)return frames.splice(i,1)[0];await delay(25);}throw Error('Missing transport frame '+type);}
 const config=await frame('CONFIG');await frame('SNAPSHOT');const send=(body:unknown)=>socket.send(JSON.stringify({schemaVersion:2,requestId:randomUUID(),connectionGeneration:config.connectionGeneration,...body as object}));
 send({type:'CAPABILITIES',capabilities:['pickup_ready_v1']});const capability=await frame('COMMAND_RESULT');assert.equal(capability.result.ok,true);return {socket,frames,frame,send,config};
}
try{
 const a=await connect(f.a.id),b=await connect(f.b.id);await api('/api/orders/'+order.id+'/fulfillment',{status:'PREPARING',expectedVersion:0,idempotencyKey:randomUUID()});
 const key=randomUUID(),ready={status:'READY',expectedVersion:1,idempotencyKey:key};await api('/api/orders/'+order.id+'/fulfillment',ready);await api('/api/orders/'+order.id+'/fulfillment',ready);
 await delay(1250);assert.equal(a.frames.some(e=>e.type==='PICKUP_READY'),false,'bill has priority');
 await f.tenant(f.merchant,db=>db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,screen_generation=screen_generation+1 WHERE device_id=$1",[f.a.id]));
 const notice=await a.frame('PICKUP_READY');assert.equal(notice.payload.orderId,order.id);assert.equal(notice.payload.sound,true);assert.equal(b.frames.some(e=>e.type==='PICKUP_READY'),false);
 a.send({type:'ACK',eventId:notice.eventId,deviceSeq:notice.deviceSeq,orderId:null,orderVersion:null,screenGeneration:notice.screenGeneration,rendered:true});assert.equal((await a.frame('COMMAND_RESULT')).result.ok,true);
 const rendered=await api('/api/orders/'+order.id);assert.equal(rendered.fulfillment.notification.state,'RENDERED');
 a.socket.terminate();const replay=await connect(f.a.id),silent=await replay.frame('PICKUP_READY');assert.equal(silent.payload.sound,false);assert.equal(silent.payload.effectId,notice.payload.effectId);
 replay.send({type:'ACK',eventId:silent.eventId,deviceSeq:silent.deviceSeq,orderId:null,orderVersion:null,screenGeneration:silent.screenGeneration,rendered:true});assert.equal((await replay.frame('COMMAND_RESULT')).result.ok,true);
 replay.send({type:'PICKUP_ACK',notificationId:silent.payload.notificationId,screenGeneration:silent.screenGeneration});assert.equal((await replay.frame('COMMAND_RESULT')).result.ok,true);
 const acknowledged=await api('/api/orders/'+order.id);assert.equal(acknowledged.fulfillment.status,'READY');assert.equal(acknowledged.fulfillment.notification.state,'ACKNOWLEDGED');
 await api('/api/orders/'+order.id+'/fulfillment',{status:'COLLECTED',expectedVersion:2,idempotencyKey:randomUUID()});assert.equal((await api('/api/orders/'+order.id)).fulfillment.status,'COLLECTED');
 const evidence={scope:'post-submit-20261012',origin:'actual_local_API_WSS_contract_with_synthetic_DB_tenant',physical:false,chain:false,orderId:order.id,checks:['staff API preparation/ready/collected','duplicate ready idempotency','busy bill queued','exact device no broadcast','render ACK persisted','reconnect silent same effect','guest acknowledgment not collection'],at:new Date().toISOString()};
 fs.mkdirSync('.omp/work/post-submit-20261012/evidence',{recursive:true});fs.writeFileSync('.omp/work/post-submit-20261012/evidence/pickup-transport-smoke.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{for(const socket of sockets)socket.terminate();server.close();await once(server,'close');await pool.end();}
