import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import type pg from 'pg';
import {WebSocket} from 'ws';
import type {DeviceEvent,DeviceCommandResult} from '../packages/contracts/src/index';
import {tableFixture} from './backend-table-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
interface NotificationFixture {
 pool:pg.Pool;merchant:string;credentials:Map<string,string>;
 tenant:<T>(merchant:string,fn:(db:pg.PoolClient)=>Promise<T>)=>Promise<T>;
}
type Frame=DeviceEvent|DeviceCommandResult;
type Event<T extends Frame['type']>=Extract<Frame,{type:T}>;
async function until(predicate:()=>boolean,message:string){
 const deadline=Date.now()+5000;
 while(!predicate()){assert.ok(Date.now()<deadline,message);await delay(10);}
}

// Fault controls delay real SQL replies/requests; they never replace database
// results. Disabling only the recovery timer makes a lost/coalesced NOTIFY wake
// observable instead of letting the next poll accidentally rescue a broken test.
async function wire(t:TestContext,f:NotificationFixture,polling=false){
 // Loading boundary: skipped integration tests cannot import private runtime config.
 const {attachDevices}=await import('../apps/api/src/devices');
 const interval=globalThis.setInterval;
 const polls:(()=>void)[]=[];
 t.mock.method(globalThis,'setInterval',(callback:()=>void,ms?:number)=>{
  if(ms!==250)return interval(callback,ms);
  polls.push(callback);return interval(()=>{if(polling)callback();},ms);
 });
 type Pause={matches:(sql:string,args:unknown[])=>boolean;after:boolean;reached:boolean;release:()=>void;released:Promise<void>};
 let pause:Pause|undefined;
 const releases:(()=>void)[]=[];
 const query=f.pool.query.bind(f.pool);
 t.mock.method(f.pool,'query',async(sql:string,args:unknown[]=[])=>{
  const held=pause?.matches(sql,args)?pause:undefined;
  if(held)pause=undefined;
  if(held&&!held.after){held.reached=true;await held.released;}
  const result=await query(sql,args);
  if(held&&held.after){held.reached=true;await held.released;}
  return result;
 });
 function hold(matches:Pause['matches'],after=false){
  assert.equal(pause,undefined,'only one unentered scheduling gate at a time');
  let release!:()=>void;const released=new Promise<void>(resolve=>{release=resolve;});
  const held:Pause={matches,after,reached:false,release,released};pause=held;releases.push(release);
  return {release,entered:()=>until(()=>held.reached,'device did not enter the scheduling gate')};
 }
 const server=createServer();attachDevices(server);
 // Capture the actual checked-out LISTEN connection, not a fake EventEmitter.
 let listener:pg.PoolClient|undefined;
 const acquired=(client:pg.PoolClient)=>{listener=client;};f.pool.once('acquire',acquired);
 server.listen(0,'127.0.0.1');await once(server,'listening');
 await until(()=>!!listener,'missing outbox listener connection');
 const db=listener!;
 await untilAsync(async()=>!!(await db.query("SELECT 1 FROM pg_listening_channels() AS channel WHERE channel='bitpos_device_outbox'")).rowCount,'LISTEN did not become active');
 const port=(server.address() as AddressInfo).port;
 const sockets:WebSocket[]=[];
 async function connect(device:string){
  const socket=new WebSocket(`ws://127.0.0.1:${port}/api/device`,{headers:{Authorization:'Bearer '+f.credentials.get(device)}});
  sockets.push(socket);const frames:Frame[]=[],pending:Frame[]=[];
  socket.on('message',raw=>{const frame=JSON.parse(raw.toString()) as Frame;frames.push(frame);pending.push(frame);});
  const closed=new Promise<{code:number;reason:string}>(resolve=>socket.once('close',(code,reason)=>resolve({code,reason:reason.toString()})));
  await once(socket,'open');
  async function next<T extends Frame['type']>(type:T,matches:(event:Event<T>)=>boolean=()=>true):Promise<Event<T>>{
   let index=-1;
   await until(()=>{index=pending.findIndex(frame=>frame.type===type&&matches(frame as Event<T>));return index>=0;},'Missing '+type);
   return pending.splice(index,1)[0] as Event<T>;
  }
  const config=await next('CONFIG'),snapshot=await next('SNAPSHOT');
  function command(body:Record<string,unknown>,requestId=randomUUID()){
   socket.send(JSON.stringify({schemaVersion:2,connectionGeneration:config.connectionGeneration,requestId,...body}));return requestId;
  }
  async function ack(event:DeviceEvent){
   const requestId=command({type:'ACK',eventId:event.eventId,deviceSeq:event.deviceSeq,orderId:event.type==='ORDER'?event.payload.id:null,orderVersion:event.type==='ORDER'?event.payload.version:null,screenGeneration:event.screenGeneration,rendered:true});
   const receipt=await next('COMMAND_RESULT',result=>result.requestId===requestId);
   assert.deepEqual(receipt.result,{ok:true,value:{acknowledged:true}});
  }
  return {socket,frames,next,config,snapshot,command,ack,closed};
 }
 async function close(){
  for(const release of releases)release();
  f.pool.removeListener('acquire',acquired);
  const closed=once(server,'close');for(const socket of sockets)socket.terminate();server.close();await closed;
 }
 return {connect,hold,listener:db,poll:()=>{for(const poll of polls)poll();},close};
}
async function untilAsync(predicate:()=>Promise<boolean>,message:string){
 const deadline=Date.now()+5000;
 while(!await predicate()){assert.ok(Date.now()<deadline,message);await delay(10);}
}
async function paid(f:NotificationFixture,orderId:string,occurredAt=new Date().toISOString(),beforeCommit?:(eventId:string)=>void){
 // Loading boundary: skipped integration tests cannot import private runtime config.
 const {emitOrder}=await import('../apps/api/src/orders');
 // Fixture of a verified state, not chain/wallet or physical-render evidence.
 return f.tenant(f.merchant,async db=>{
  const order=(await db.query("UPDATE orders SET status='PAID',version=version+1 WHERE id=$1 RETURNING *",[orderId])).rows[0];
  const event=await emitOrder(db,order,occurredAt);assert.ok(event);
  // Install the final-fence gate identity before COMMIT can release NOTIFY.
  if(beforeCommit)beforeCommit(event.eventId);return event;
 });
}
async function notify(f:NotificationFixture){await f.pool.query("SELECT pg_notify('bitpos_device_outbox','')");}

// Detects a wake flag cleared by an in-flight empty poll, and any rerouting to
// the register's new pairing or repeated sound-bearing send on duplicate wakes.
test('NOTIFY queued during a busy empty probe delivers once to the frozen target after re-pairing',integration,async t=>{
 const f=await tableFixture();const first=await f.create(await f.quote(2));const w=await wire(t,f);
 try{
  const a=await w.connect(f.a.id),b=await w.connect(f.b.id),c=await w.connect(f.c.id);
  const held=w.hold((sql,args)=>sql.startsWith('SELECT bitpos.device_stream_probe(')&&args[1]===f.a.id,true);w.poll();await held.entered();
  const occurredAt=new Date().toISOString();const event=await paid(f,first.order.id,occurredAt);
  await f.reg('/api/registers/'+f.register.id+'/pairing','PUT',{deviceId:f.c.id,expectedPairingGeneration:'2'});
  let noticed=false;w.listener.once('notification',()=>{noticed=true;});
  await notify(f);await until(()=>noticed,'NOTIFY did not arrive while the empty probe was held');
  await notify(f);held.release();
  const delivered=await a.next('ORDER',frame=>frame.eventId===event.eventId);
  assert.equal(delivered.deviceId,f.a.id);assert.equal(delivered.payload.id,first.order.id);
  assert.equal(delivered.payload.status,'PAID');assert.equal(delivered.payload.version,first.order.version+1);
  assert.deepEqual(delivered.payload.authority,first.order.authority);
  assert.deepEqual(delivered.payload.total,first.order.pricing.total);
  assert.deepEqual(delivered.payload.settlement,first.order.settlement);
  assert.deepEqual(delivered.payload.items,['2 x Coffee']);assert.equal(delivered.occurredAt,occurredAt);
  assert.equal(delivered.connectionGeneration,a.config.connectionGeneration);assert.equal(delivered.payload.sound,true);
  await a.ack(delivered);await notify(f);await notify(f);await delay(300);
  assert.equal(a.frames.filter(frame=>frame.type==='ORDER'&&frame.eventId===event.eventId).length,1);
  assert.equal([...b.frames,...c.frames].some(frame=>frame.type==='ORDER'&&frame.payload.id===first.order.id),false);
  const durable=await f.tenant(f.merchant,async db=>({
   deliveries:(await db.query('SELECT device_id,status,connection_generation::text FROM device_event_deliveries WHERE event_id=$1',[event.eventId])).rows,
   effect:(await db.query('SELECT device_id,effect_id,consumed_at FROM device_sound_effects WHERE order_id=$1',[first.order.id])).rows
  }));
  assert.deepEqual(durable.deliveries,[{device_id:f.a.id,status:'rendered',connection_generation:a.config.connectionGeneration}]);
  assert.equal(durable.effect.length,1);assert.equal(durable.effect[0].device_id,f.a.id);
  assert.equal(durable.effect[0].effect_id,delivered.payload.effectId);assert.ok(durable.effect[0].consumed_at);
 }finally{await w.close();}
});

// The paused reply fence leaves processing=true after a real committed command.
// No timer is allowed to rescue the event or the queued second command.
test('NOTIFY queued during command processing survives correlated replies and resumes paid delivery',integration,async t=>{
 const f=await tableFixture();const first=await f.create(await f.quote());const w=await wire(t,f);
 try{
  const a=await w.connect(f.a.id);const held=w.hold((sql,args)=>sql.startsWith('SELECT bitpos.device_validate_send(')&&args[1]===f.a.id&&args[6]===null);
  const heartbeat=a.command({type:'HEARTBEAT',sessionId:null});await held.entered();
  const sync=a.command({type:'SESSION_SYNC',sessionId:null,pendingRequestId:null,pendingSubmissionKey:null});
  const event=await paid(f,first.order.id);let noticed=false;
  w.listener.once('notification',()=>{noticed=true;});await notify(f);
  await until(()=>noticed,'NOTIFY did not arrive while the command reply was held');held.release();
  const heartbeatReply=await a.next('COMMAND_RESULT',result=>result.requestId===heartbeat);
  const syncReply=await a.next('COMMAND_RESULT',result=>result.requestId===sync);
  assert.equal(heartbeatReply.result.ok,true);assert.equal(syncReply.result.ok,true);
  assert.ok(syncReply.result.ok&&'screen' in syncReply.result.value&&syncReply.result.value.screen.kind==='order');
  assert.equal(syncReply.result.value.screen.order.id,first.order.id);assert.equal(syncReply.result.value.screen.order.status,'PAID');
  const delivered=await a.next('ORDER',frame=>frame.eventId===event.eventId);await a.ack(delivered);
  await notify(f);await delay(300);
  assert.equal(a.frames.filter(frame=>frame.type==='ORDER'&&frame.eventId===event.eventId).length,1);
  assert.equal(a.socket.readyState,WebSocket.OPEN);
 }finally{await w.close();}
});

// Six continuously replenished valid commands stay below ingress capacity but
// exceed one drain batch. The durable ORDER must reach the socket before the
// whole burst finishes, and yielding delivery must not strand any command.
test('a replenished valid command burst yields to pending paid delivery and completes every correlated reply',integration,async t=>{
 const f=await tableFixture();const first=await f.create(await f.quote());const w=await wire(t,f);
 try{
  const a=await w.connect(f.a.id);
  const held=w.hold((sql,args)=>sql.startsWith('SELECT bitpos.device_validate_send(')&&args[1]===f.a.id&&args[6]===null);
  const requests=new Set<string>(),replies=new Set<string>();const total=24;
  function enqueue(){requests.add(a.command({type:'HEARTBEAT',sessionId:null}));}
  a.socket.on('message',raw=>{
   const frame=JSON.parse(raw.toString()) as Frame;
   if(frame.type!=='COMMAND_RESULT'||!requests.has(frame.requestId)||replies.has(frame.requestId))return;
   replies.add(frame.requestId);if(requests.size<total)enqueue();
  });
  enqueue();await held.entered();for(let i=0;i<5;i++)enqueue();
  const event=await paid(f,first.order.id);let noticed=false;
  w.listener.once('notification',()=>{noticed=true;});await notify(f);
  await until(()=>noticed,'NOTIFY did not arrive during the command burst');held.release();
  const delivered=await a.next('ORDER',frame=>frame.eventId===event.eventId);
  const deliveryIndex=a.frames.findIndex(frame=>frame.type==='ORDER'&&frame.eventId===event.eventId);
  const earlierReplies=a.frames.slice(0,deliveryIndex).filter(frame=>frame.type==='COMMAND_RESULT'&&requests.has(frame.requestId));
  assert.ok(earlierReplies.length<total,'pending payment must preempt a continuously replenished command burst');
  await a.ack(delivered);
  // No aggregate throughput promise: require continuing transport progress and
  // every exact reply. Real serial heartbeat round trips can exceed500ms each.
  while(replies.size<total){const before=replies.size;await until(()=>replies.size>before,'delivery yielded but valid command replies stopped progressing');}
  const results=a.frames.filter((frame):frame is DeviceCommandResult=>frame.type==='COMMAND_RESULT'&&requests.has(frame.requestId));
  assert.equal(results.length,total);assert.equal(new Set(results.map(frame=>frame.requestId)).size,total);
  assert.ok(results.every(frame=>frame.result.ok),'all valid heartbeat commands must succeed');
  await notify(f);await delay(300);
  assert.equal(a.frames.filter(frame=>frame.type==='ORDER'&&frame.eventId===event.eventId).length,1);
  assert.equal(a.socket.readyState,WebSocket.OPEN);
 }finally{await w.close();}
});

test('a committed paid frame does not wait for an older ACK reply before its final send fence',integration,async t=>{
 const f=await tableFixture();const first=await f.create(await f.quote());const w=await wire(t,f);
 try{
  const a=await w.connect(f.a.id);
  const claimed=w.hold((sql,args)=>sql.startsWith('SELECT bitpos.device_claim_events(')&&args[1]===f.a.id,true);
  const event=await paid(f,first.order.id);await claimed.entered();
  const reply=w.hold((sql,args)=>sql.startsWith('SELECT bitpos.device_validate_send(')&&args[1]===f.a.id&&args[6]===null);
  const requestId=randomUUID();let queued=false;
  const emit=WebSocket.prototype.emit;
  t.mock.method(WebSocket.prototype,'emit',function(this:WebSocket,name:string,...args:unknown[]){
   const result=emit.call(this,name,...args);
   if(name==='message'&&Buffer.isBuffer(args[0])){
    const message=JSON.parse(args[0].toString()) as {type?:string;requestId?:string};
    if(message.type==='ACK'&&message.requestId===requestId)queued=true;
   }
   return result;
  });
  a.command({type:'ACK',eventId:a.config.eventId,deviceSeq:a.config.deviceSeq,orderId:null,orderVersion:null,screenGeneration:a.config.screenGeneration,rendered:true},requestId);
  await until(()=>queued,'older ACK did not arrive through the real transport');
  claimed.release();await reply.entered();
  const delivered=await a.next('ORDER',frame=>frame.eventId===event.eventId);
  assert.equal(delivered.payload.status,'PAID');assert.equal(delivered.deviceId,f.a.id);
  reply.release();
  const result=await a.next('COMMAND_RESULT',frame=>frame.requestId===requestId);
  assert.deepEqual(result.result,{ok:true,value:{acknowledged:true}});
  await a.ack(delivered);assert.equal(a.socket.readyState,WebSocket.OPEN);
 }finally{await w.close();}
});

test('losing the real LISTEN connection leaves durable paid delivery recoverable by the poll timer',integration,async t=>{
 const f=await tableFixture();const first=await f.create(await f.quote());const w=await wire(t,f,true);
 try{
  const a=await w.connect(f.a.id);const pid=(await w.listener.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let stopped=false;w.listener.once('end',()=>{stopped=true;});
  assert.equal((await f.pool.query('SELECT pg_terminate_backend($1) AS terminated',[pid])).rows[0].terminated,true);
  await until(()=>stopped,'LISTEN connection did not stop');
  const event=await paid(f,first.order.id);const delivered=await a.next('ORDER',frame=>frame.eventId===event.eventId);
  assert.equal(delivered.payload.status,'PAID');assert.equal(delivered.deviceId,f.a.id);await a.ack(delivered);
  await delay(600);
  assert.equal(a.frames.filter(frame=>frame.type==='ORDER'&&frame.eventId===event.eventId).length,1);
  assert.equal(a.socket.readyState,WebSocket.OPEN);
 }finally{await w.close();}
});

test('notification claim refresh publishes current assignment without delivering obsolete metadata',integration,async t=>{
 const f=await tableFixture();const w=await wire(t,f);
 try{
  // Loading boundary: skipped integration tests cannot import private runtime config.
  const b=await w.connect(f.b.id);const {streamEvent}=await import('../apps/api/src/orders');
  const held=w.hold((sql,args)=>sql.startsWith('SELECT bitpos.device_claim_events(')&&args[1]===f.b.id);
  const obsolete=await f.tenant(f.merchant,db=>streamEvent(db,f.merchant,f.b.id,'1',b.snapshot.screenGeneration,'SNAPSHOT',{screen:{kind:'idle',screenGeneration:b.snapshot.screenGeneration},recoverableDraft:null}));
  await held.entered();
  await f.reg('/api/devices/'+f.b.id,'PATCH',{label:'New assignment',tableId:null,expectedAssignmentGeneration:'1'});
  held.release();
  const config=await b.next('CONFIG',event=>event.payload.assignmentGeneration==='2');
  assert.equal(config.payload.label,'New assignment');assert.equal(config.payload.tableId,null);assert.equal(config.payload.tableLabel,null);
  const current=await f.tenant(f.merchant,db=>streamEvent(db,f.merchant,f.b.id,'2',b.snapshot.screenGeneration,'SNAPSHOT',{screen:{kind:'idle',screenGeneration:b.snapshot.screenGeneration},recoverableDraft:null}));
  const delivered=await b.next('SNAPSHOT',event=>event.eventId===current.eventId);await b.ack(delivered);
  assert.equal(b.frames.some(frame=>frame.type!=='COMMAND_RESULT'&&frame.eventId===obsolete.eventId),false);
  assert.equal((await f.tenant(f.merchant,db=>db.query('SELECT status FROM device_event_deliveries WHERE event_id=$1 AND connection_generation=$2',[obsolete.eventId,b.config.connectionGeneration]))).rows[0].status,'superseded');
  assert.equal(b.socket.readyState,WebSocket.OPEN);
 }finally{await w.close();}
});

test('assignment changed after claim is rejected by the final send fence without retargeting the event',integration,async t=>{
 const f=await tableFixture();const w=await wire(t,f);
 try{
  // Loading boundary: skipped integration tests cannot import private runtime config.
  const b=await w.connect(f.b.id),c=await w.connect(f.c.id);const {streamEvent}=await import('../apps/api/src/orders');
  // Learn the exact fence identity before producer COMMIT releases NOTIFY.
  let eventId:string|undefined;
  const held=w.hold((sql,args)=>sql.startsWith('SELECT bitpos.device_validate_send(')&&args[1]===f.b.id&&args[6]===eventId);
  const event=await f.tenant(f.merchant,async db=>{
   const emitted=await streamEvent(db,f.merchant,f.b.id,'1',b.snapshot.screenGeneration,'SNAPSHOT',{screen:{kind:'idle',screenGeneration:b.snapshot.screenGeneration},recoverableDraft:null});
   eventId=emitted.eventId;return emitted;
  });
  await held.entered();
  await f.reg('/api/devices/'+f.b.id,'PATCH',{tableId:null,expectedAssignmentGeneration:'1'});held.release();
  const config=await b.next('CONFIG',frame=>frame.payload.assignmentGeneration==='2');assert.equal(config.payload.tableId,null);
  await delay(300);
  assert.equal([...b.frames,...c.frames].some(frame=>frame.type!=='COMMAND_RESULT'&&frame.eventId===event.eventId),false);
  const rows=await f.tenant(f.merchant,db=>db.query('SELECT e.target_device_id,d.device_id,d.status FROM outbox_events e JOIN device_event_deliveries d ON d.event_id=e.id WHERE e.id=$1',[event.eventId]));
  assert.deepEqual(rows.rows,[{target_device_id:f.b.id,device_id:f.b.id,status:'superseded'}]);
  assert.equal(b.socket.readyState,WebSocket.OPEN);
 }finally{await w.close();}
});

for(const change of ['replacement','revocation'] as const)test('claimed PAID cannot cross the final send fence after '+change,integration,async t=>{
 const f=await tableFixture();const first=await f.create(await f.quote());const w=await wire(t,f);
 try{
  const a=await w.connect(f.a.id);let eventId:string|undefined;
  const held=w.hold((sql,args)=>sql.startsWith('SELECT bitpos.device_validate_send(')&&args[1]===f.a.id&&args[6]===eventId);
  const event=await paid(f,first.order.id,new Date().toISOString(),id=>{eventId=id;});await held.entered();
  if(change==='replacement'){
   const newer=await w.connect(f.a.id);
   assert.notEqual(newer.config.connectionGeneration,a.config.connectionGeneration);
   assert.ok(newer.snapshot.payload.screen.kind==='order');
   assert.equal(newer.snapshot.payload.screen.order.id,first.order.id);assert.equal(newer.snapshot.payload.screen.order.status,'PAID');
   assert.equal(newer.snapshot.payload.screen.order.sound,false);assert.equal(newer.snapshot.payload.screen.order.effectId,null);
   await until(()=>a.socket.readyState===WebSocket.CLOSED,'replaced connection remained open');
   assert.equal((await a.closed).code,1000);held.release();await notify(f);await delay(300);
   assert.equal(newer.frames.some(frame=>frame.type==='ORDER'&&frame.eventId===event.eventId),false);
  }else{
   await f.reg('/api/devices/'+f.a.id+'/credential','DELETE',{});held.release();
   await until(()=>a.socket.readyState===WebSocket.CLOSED,'revoked connection remained open');
   assert.equal((await a.closed).code,1008);
  }
  assert.equal(a.frames.some(frame=>frame.type==='ORDER'&&frame.eventId===event.eventId),false);
  const durable=await f.tenant(f.merchant,async db=>({
   rendered:(await db.query("SELECT event_id FROM device_event_deliveries WHERE event_id=$1 AND status='rendered'",[event.eventId])).rows,
   effects:(await db.query('SELECT device_id,consumed_at FROM device_sound_effects WHERE order_id=$1',[first.order.id])).rows
  }));
  assert.deepEqual(durable.rendered,[]);assert.deepEqual(durable.effects,[{device_id:f.a.id,consumed_at:null}]);
 }finally{await w.close();}
});
