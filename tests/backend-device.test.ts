import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import type {AddressInfo} from 'node:net';
import {WebSocket} from 'ws';
import {createServer} from 'node:http';
import type {DeviceEvent,DeviceCommandResult} from '../packages/contracts/src/index';
import {tableFixture,success} from './backend-table-fixture';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
test('authenticated devices receive only immutable target, own reconnect snapshot and fenced ACK',integration,async()=>{
 // Loading boundary: skipped tests must not consume runtime private config.
 const f=await tableFixture();const {server}=await import('../apps/api/src/index');server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as AddressInfo).port;const connected:WebSocket[]=[];
 async function connect(device:string){const socket=new WebSocket(`ws://127.0.0.1:${port}/api/device`,{headers:{Authorization:'Bearer '+f.credentials.get(device)}});connected.push(socket);const frames:Record<string,unknown>[]=[];socket.on('message',raw=>frames.push(JSON.parse(raw.toString())));await once(socket,'open');async function frame(type:string){const deadline=Date.now()+5000;while(Date.now()<deadline){const index=frames.findIndex(v=>v.type===type);if(index>=0)return frames.splice(index,1)[0];await delay(10);}assert.fail('Missing '+type);}const config=await frame('CONFIG');const snapshot=await frame('SNAPSHOT');return {socket,frames,frame,config,snapshot};}
 try{const a=await connect(f.a.id),b=await connect(f.b.id),c=await connect(f.c.id);assert.equal(a.config.deviceId,f.a.id);assert.equal(JSON.stringify(a.snapshot).includes('payer'),false);const created=await f.create(await f.quote());const order=await a.frame('ORDER');assert.equal(order.deviceId,f.a.id);assert.equal(JSON.stringify(order).includes(created.order.id),true);await delay(400);assert.equal(b.frames.some(e=>e.type==='ORDER'),false);assert.equal(c.frames.some(e=>e.type==='ORDER'),false);
 const replaced=once(a.socket,'close');const newer=await connect(f.a.id);await replaced;assert.equal(b.socket.readyState,WebSocket.OPEN);assert.equal(JSON.stringify(newer.snapshot).includes(created.order.id),true);assert.equal(JSON.stringify(newer.snapshot).includes('"sound":true'),false);
 const event=await f.tenant(f.merchant,async db=>(await db.query('SELECT e.* FROM outbox_events e WHERE id=$1',[order.eventId])).rows[0]);const forged={schemaVersion:2,type:'ACK',requestId:randomUUID(),connectionGeneration:b.config.connectionGeneration,eventId:event.id,deviceSeq:String(event.device_seq),orderId:event.order_id,orderVersion:event.order_version,screenGeneration:String(event.screen_generation),rendered:true};b.socket.send(JSON.stringify(forged));const rejected=await b.frame('COMMAND_RESULT');assert.equal(JSON.stringify(rejected).includes('INVALID_ACK'),true);assert.equal(await f.tenant(f.merchant,async db=>(await db.query("SELECT 1 FROM device_event_deliveries WHERE event_id=$1 AND status='rendered'",[event.id])).rowCount),0);
 }finally{for(const socket of connected)socket.terminate();server.close();await once(server,'close');}
});
test('durable cart receipt replays before fences, stale socket cannot mutate replacement, expiry preserves draft',integration,async()=>{
 const f=await tableFixture();const id=randomUUID(),request=randomUUID();const open={type:'CART_OPEN',sessionId:id,expectedScreenGeneration:'1',expectedAssignmentGeneration:'1',recoverSessionId:null};success(await f.command(f.b.id,open,request));
 const set={type:'CART_SET',sessionId:id,expectedScreenGeneration:'2',expectedAssignmentGeneration:'1',expectedCartVersion:'0',items:[{productId:f.product,qty:2}]};const key=randomUUID();const saved=await f.command(f.b.id,set,key);const value=success(saved);assert.ok('screen' in value&&value.screen.kind==='cart');assert.equal(value.screen.cartVersion,'1');assert.deepEqual((await f.command(f.b.id,set,key)).result,saved.result);
 const conflict=await f.command(f.b.id,{...set,items:[{productId:f.product,qty:3}]},key);assert.ok(!conflict.result.ok);assert.equal(conflict.result.error.code,'COMMAND_CONFLICT');assert.deepEqual((await f.command(f.b.id,set,key)).result,saved.result,'conflict cannot replace the original durable receipt');const stale=await f.command(f.b.id,set);assert.ok(!stale.result.ok);assert.equal(stale.result.error.code,'CART_VERSION_CONFLICT');
 await f.tenant(f.merchant,db=>db.query("UPDATE device_screen_state SET lease_until=clock_timestamp()-interval '1 second' WHERE device_id=$1",[f.b.id]));const sync=success(await f.command(f.b.id,{type:'SESSION_SYNC',sessionId:id,pendingRequestId:key,pendingSubmissionKey:null}));assert.ok('recoverableDraft' in sync);assert.equal(sync.screen.kind,'idle');assert.ok(sync.recoverableDraft);assert.equal(sync.recoverableDraft.items[0].qty,2);assert.deepEqual(sync.pendingResult,saved.result);
 await f.tenant(f.merchant,db=>db.query('UPDATE device_presence SET connection_generation=connection_generation+1 WHERE device_id=$1',[f.b.id]));await assert.rejects(f.command(f.b.id,open),/DEVICE_AUTH_INVALID/);
});

test('render ACK is atomic, exact-version fenced, idempotent and enables only explicit receipt release',integration,async()=>{
 const f=await tableFixture();const created=await f.create(await f.quote());
 // Intentional loading boundary: skipped integration tests cannot load private runtime config.
 const {emitOrder}=await import('../apps/api/src/orders');
 const {applyDeviceCommand,currentScreen,commandSchema}=await import('../apps/api/src/device-commands');
 const actor=f.devices.get(f.a.id);assert.ok(actor);
 const events=await f.tenant(f.merchant,async db=>{
 const old=(await db.query('SELECT * FROM outbox_events WHERE order_id=$1 ORDER BY device_seq DESC LIMIT 1',[created.order.id])).rows[0];
 // Database fixture of verified PAID state; no wallet/chain/physical proof.
 const paid=(await db.query("UPDATE orders SET status='PAID',version=version+1 WHERE id=$1 RETURNING *",[created.order.id])).rows[0];
 const event=await emitOrder(db,paid);assert.ok(event);
 for(const e of [old,{id:event.eventId,device_seq:event.deviceSeq}])await db.query('INSERT INTO device_event_deliveries(merchant_id,device_id,event_id,device_seq,connection_generation) VALUES($1,$2,$3,$4,$5)',[f.merchant,f.a.id,e.id,e.device_seq,actor.connectionGeneration]);
 return {old,event};
 });
 const ack={type:'ACK',eventId:events.event.eventId,deviceSeq:events.event.deviceSeq,orderId:created.order.id,orderVersion:created.order.version+1,screenGeneration:events.event.screenGeneration,rendered:true};
 const before=await f.tenant(f.merchant,db=>currentScreen(db,actor.merchant,actor.device));assert.equal(before.kind,'order');assert.ok(before.kind==='order');assert.equal(before.canDismiss,false);assert.equal(before.order.sound,false);assert.equal(JSON.stringify(before).includes('payer'),false);
 const oldAck=await f.command(f.a.id,{...ack,eventId:events.old.id,deviceSeq:String(events.old.device_seq),orderVersion:events.old.order_version});assert.ok(!oldAck.result.ok);assert.equal(oldAck.result.error.code,'INVALID_ACK');
 for(const wrong of [{deviceSeq:'999999'},{orderVersion:1},{screenGeneration:'999999'},{orderId:randomUUID()}]){const result=await f.command(f.a.id,{...ack,...wrong});assert.ok(!result.result.ok);assert.equal(result.result.error.code,'INVALID_ACK');}
 const receivedAt=new Date().toISOString();const c=commandSchema.parse({schemaVersion:2,connectionGeneration:actor.connectionGeneration,requestId:randomUUID(),...ack});
 for(const fenced of [{...actor,connectionId:randomUUID()},{...actor,authGeneration:'999999'},{...actor,tokenHash:'0'.repeat(64)}])await assert.rejects(f.tenant(f.merchant,db=>applyDeviceCommand(db,fenced,c,receivedAt)),/DEVICE_AUTH_INVALID/);
 await f.tenant(f.merchant,db=>db.query('UPDATE device_credentials SET revoked_at=clock_timestamp() WHERE device_id=$1',[f.a.id]));
 await assert.rejects(f.tenant(f.merchant,db=>applyDeviceCommand(db,actor,c,receivedAt)),/DEVICE_AUTH_INVALID/);
 assert.equal(await f.tenant(f.merchant,async db=>(await db.query("SELECT 1 FROM device_event_deliveries WHERE event_id=$1 AND status='rendered'",[events.event.eventId])).rowCount),0);
 await f.tenant(f.merchant,db=>db.query('UPDATE device_credentials SET revoked_at=NULL WHERE device_id=$1',[f.a.id]));
 success(await f.tenant(f.merchant,db=>applyDeviceCommand(db,actor,c,receivedAt)));
 const first=await f.tenant(f.merchant,async db=>(await db.query('SELECT d.status,d.rendered_at,d.latency_ms,f.consumed_at FROM device_event_deliveries d JOIN device_sound_effects f ON f.merchant_id=d.merchant_id AND f.device_id=d.device_id WHERE d.event_id=$1',[events.event.eventId])).rows[0]);
 assert.equal(first.status,'rendered');assert.equal(first.rendered_at.toISOString(),receivedAt);assert.equal(first.consumed_at.toISOString(),receivedAt);
 success(await f.tenant(f.merchant,db=>applyDeviceCommand(db,actor,c,new Date(Date.parse(receivedAt)+1000).toISOString())));
 const duplicate=await f.tenant(f.merchant,async db=>(await db.query('SELECT d.status,d.rendered_at,d.latency_ms,f.consumed_at FROM device_event_deliveries d JOIN device_sound_effects f ON f.merchant_id=d.merchant_id AND f.device_id=d.device_id WHERE d.event_id=$1',[events.event.eventId])).rows[0]);assert.deepEqual(duplicate,first);
 const rendered=await f.tenant(f.merchant,db=>currentScreen(db,actor.merchant,actor.device));assert.ok(rendered.kind==='order');assert.equal(rendered.order.id,created.order.id);assert.equal(rendered.order.version,created.order.version+1);assert.equal(rendered.canDismiss,true);
 assert.equal((await f.tenant(f.merchant,async db=>(await db.query('SELECT kind FROM device_screen_state WHERE device_id=$1',[f.a.id])).rows[0])).kind,'order','render ACK alone never releases the receipt');
 success(await f.command(f.a.id,{type:'ORDER_DISMISS',orderId:created.order.id,orderVersion:created.order.version+1,screenGeneration:events.event.screenGeneration}));
 const stale=await f.command(f.a.id,ack);assert.ok(!stale.result.ok);assert.equal(stale.result.error.code,'INVALID_ACK');
 assert.equal((await f.tenant(f.merchant,db=>currentScreen(db,actor.merchant,actor.device))).kind,'idle');
});

test('a blocked idle catalog cannot hold routing authority ahead of another device payment and render ACK',integration,async()=>{
 const f=await tableFixture();const created=await f.create(await f.quote());const {emitOrder}=await import('../apps/api/src/orders');
 // Intentional loading boundary: devices imports required runtime config.
 const {attachDevices}=await import('../apps/api/src/devices');const server=createServer();attachDevices(server);server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as AddressInfo).port;
 const sockets:WebSocket[]=[];const blocker=await f.pool.connect();let locked=false;
 async function connect(device:string){
 const socket=new WebSocket(`ws://127.0.0.1:${port}/api/device`,{headers:{Authorization:'Bearer '+f.credentials.get(device)}});sockets.push(socket);const frames:(DeviceEvent|DeviceCommandResult)[]=[];socket.on('message',raw=>frames.push(JSON.parse(raw.toString())));await once(socket,'open');
 async function frame<T extends DeviceEvent['type']|DeviceCommandResult['type']>(type:T):Promise<Extract<DeviceEvent|DeviceCommandResult,{type:T}>>{const deadline=Date.now()+5000;while(Date.now()<deadline){const index=frames.findIndex(f=>f.type===type);if(index>=0)return frames.splice(index,1)[0] as Extract<DeviceEvent|DeviceCommandResult,{type:T}>;await delay(10);}assert.fail('Missing '+type+' while catalog remains blocked');}
 const config=await frame('CONFIG');await frame('SNAPSHOT');return {socket,frames,frame,config};
 }
 try{
 const a=await connect(f.a.id);
 await blocker.query('BEGIN');locked=true;await blocker.query('LOCK TABLE bitpos.products IN ACCESS EXCLUSIVE MODE');
 const b=await connect(f.b.id);
 const deadline=Date.now()+5000;let blocked=false;
 while(Date.now()<deadline){blocked=!!(await f.pool.query("SELECT 1 FROM pg_locks WHERE relation='bitpos.products'::regclass AND NOT granted")).rowCount;if(blocked)break;await delay(10);}assert.equal(blocked,true,'exercise an actually blocked catalog query, not a slow fixture timer');
 const paid=await f.tenant(f.merchant,async db=>{const o=(await db.query("UPDATE orders SET status='PAID',version=version+1 WHERE id=$1 RETURNING *",[created.order.id])).rows[0];return emitOrder(db,o);});assert.ok(paid);
 const event=await a.frame('ORDER');assert.equal(event.payload.status,'PAID');assert.equal(event.payload.id,created.order.id);assert.equal(b.frames.some(e=>e.type==='ORDER'),false);
 a.socket.send(JSON.stringify({schemaVersion:2,type:'ACK',requestId:randomUUID(),connectionGeneration:a.config.connectionGeneration,eventId:event.eventId,deviceSeq:event.deviceSeq,orderId:created.order.id,orderVersion:event.payload.version,screenGeneration:event.screenGeneration,rendered:true}));
 const receipt=await a.frame('COMMAND_RESULT');assert.deepEqual(receipt.result,{ok:true,value:{acknowledged:true}});
 const d=await f.tenant(f.merchant,async db=>(await db.query('SELECT status FROM device_event_deliveries WHERE device_id=$1 AND event_id=$2 AND connection_generation=$3',[f.a.id,event.eventId,a.config.connectionGeneration])).rows[0]);assert.equal(d.status,'rendered');
 assert.equal(!!(await f.pool.query("SELECT 1 FROM pg_locks WHERE relation='bitpos.products'::regclass AND NOT granted")).rowCount,true,'payment and ACK completed before releasing catalog');
 }finally{if(locked)await blocker.query('ROLLBACK');blocker.release();for(const socket of sockets)socket.terminate();server.close();await once(server,'close');}
});

test('unacknowledged metadata is bounded and cannot retain the screen ahead of a paid order',integration,async()=>{
 const f=await tableFixture();
 // Intentional loading boundary: runtime config is unavailable when integration is skipped.
 const {attachDevices}=await import('../apps/api/src/devices');const {streamEvent,emitOrder}=await import('../apps/api/src/orders');
 const server=createServer();attachDevices(server);server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as AddressInfo).port;
 const socket=new WebSocket(`ws://127.0.0.1:${port}/api/device`,{headers:{Authorization:'Bearer '+f.credentials.get(f.a.id)}});const frames:DeviceEvent[]=[];socket.on('message',raw=>frames.push(JSON.parse(raw.toString())));
 async function frame(type:DeviceEvent['type']){const deadline=Date.now()+5000;while(Date.now()<deadline){const index=frames.findIndex(e=>e.type===type);if(index>=0)return frames.splice(index,1)[0];await delay(10);}assert.fail('Missing '+type);}
 try{
 await once(socket,'open');const config=await frame('CONFIG');await frame('SNAPSHOT');
 // Metadata backlog is deliberately not ACKed. It has no payment authority.
 await f.tenant(f.merchant,async db=>{for(let i=0;i<12;i++)await streamEvent(db,f.merchant,f.a.id,'1','1','SNAPSHOT',{screen:{kind:'idle',screenGeneration:'1'},recoverableDraft:null});});
 const deadline=Date.now()+5000;let sent=0,pending=0;
 while(Date.now()<deadline){const counts=await f.tenant(f.merchant,async db=>(await db.query("SELECT (SELECT count(*)::int FROM device_event_deliveries WHERE device_id=$1 AND connection_generation=$2 AND status='sent') AS sent,(SELECT count(*)::int FROM outbox_events e WHERE e.target_device_id=$1 AND NOT EXISTS(SELECT 1 FROM device_event_deliveries d WHERE d.event_id=e.id AND d.device_id=$1 AND d.connection_generation=$2)) AS pending",[f.a.id,config.connectionGeneration])).rows[0]);sent=counts.sent;pending=counts.pending;assert.ok(sent<=8);if(sent===8&&pending>0)break;await delay(10);}
 assert.equal(sent,8);assert.ok(pending>0,'retain undelivered durable events instead of dropping overflow');
 const created=await f.create(await f.quote());
 await f.tenant(f.merchant,async db=>{const o=(await db.query("UPDATE orders SET status='PAID',version=version+1 WHERE id=$1 RETURNING *",[created.order.id])).rows[0];await emitOrder(db,o);});
 let event=await frame('ORDER');while(event.type==='ORDER'&&event.payload.status!=='PAID')event=await frame('ORDER');assert.ok(event.type==='ORDER');assert.equal(event.payload.id,created.order.id);assert.equal(event.payload.status,'PAID');assert.equal(socket.readyState,WebSocket.OPEN);
 const deliveries=await f.tenant(f.merchant,async db=>(await db.query("SELECT status,count(*)::int AS n FROM device_event_deliveries WHERE device_id=$1 AND connection_generation=$2 GROUP BY status",[f.a.id,config.connectionGeneration])).rows);
 assert.ok((deliveries.find(r=>r.status==='sent')?.n??0)<=8);assert.ok((deliveries.find(r=>r.status==='superseded')?.n??0)>=12,'old idle backlog is durably superseded, not retargeted or treated as rendered');
 }finally{socket.terminate();server.close();await once(server,'close');}
});

test('device wire calls refresh after routing waits without claiming stale metadata, preserve bounded sequence delivery and fence final send',integration,async()=>{
 const f=await tableFixture();const a=f.devices.get(f.a.id);assert.ok(a);
 // Intentional loading boundary: skipped integration tests must not load private runtime config.
 const {streamEvent}=await import('../apps/api/src/orders');
 const args=[a.merchant,a.device,a.tokenHash,a.authGeneration,a.connectionGeneration,a.connectionId];
 const probeSQL='SELECT bitpos.device_stream_probe($1::uuid,$2::uuid,$3::text,$4::bigint,$5::bigint,$6::uuid) AS state';
 const claimSQL='SELECT bitpos.device_claim_events($1::uuid,$2::uuid,$3::text,$4::bigint,$5::bigint,$6::uuid,$7::jsonb,$8::jsonb) AS claim';
 const validateSQL='SELECT bitpos.device_validate_send($1::uuid,$2::uuid,$3::text,$4::bigint,$5::bigint,$6::uuid,$7::uuid) AS checked';
 // Decimal generation strings must not round at the JS Number boundary.
 await f.tenant(f.merchant,db=>db.query('UPDATE devices SET assignment_generation=9007199254740993 WHERE merchant_id=$1 AND id=$2',[f.merchant,a.device]));
 const row=(await f.pool.query(probeSQL,args)).rows[0].state;assert.equal(row.assignment_generation,'9007199254740993');
 const config={merchantId:a.merchant,deviceId:a.device,label:row.label,tableId:row.table_id,tableLabel:row.table_label,assignmentGeneration:row.assignment_generation,pairingGeneration:row.pairing_generation,pairing:{registerId:row.register_id,pairingGeneration:row.pairing_generation},priceVersion:row.active_price_version_id,pricingReady:true,paymentOrigin:'https://service-owned.example',limits:{cartLines:50,quantity:100,pageRows:4,inboundBytes:8191,outboundBytes:7168},heartbeatSeconds:30,leaseSeconds:120};
 const owner={kind:'idle',generation:row.screen_generation,canDismiss:false};
 const events=await f.tenant(f.merchant,async db=>{
 const emitted=[await streamEvent(db,f.merchant,a.device,row.assignment_generation,row.screen_generation,'CONFIG',config)];
 for(let i=0;i<9;i++)emitted.push(await streamEvent(db,f.merchant,a.device,row.assignment_generation,row.screen_generation,'SNAPSHOT',{screen:{kind:'idle',screenGeneration:row.screen_generation},recoverableDraft:null}));
 return emitted;
 });
 const blocker=await f.pool.connect();let locked=false;let waiting:Promise<unknown>|undefined;
 try{
 await blocker.query('BEGIN');locked=true;await blocker.query("SELECT set_config('bitpos.merchant',$1,true)",[f.merchant]);
 await blocker.query('SELECT 1 FROM bitpos.merchants WHERE id=$1 FOR NO KEY UPDATE',[f.merchant]);
 // Empty-poll authentication does not wait on the routing mutex.
 assert.equal((await f.pool.query(probeSQL,args)).rows[0].state.label,row.label);
 const claim=f.pool.query(claimSQL,[...args,JSON.stringify(config),JSON.stringify(owner)]);waiting=claim;
 const deadline=Date.now()+5000;let blocked=false;
 while(Date.now()<deadline){blocked=!!(await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE 'SELECT bitpos.device_claim_events(%'")).rowCount;if(blocked)break;await delay(10);}
 assert.equal(blocked,true,'exercise a real routing lock wait before changing metadata');
 await blocker.query("UPDATE bitpos.devices SET label='After wait' WHERE merchant_id=$1 AND id=$2",[f.merchant,a.device]);
 await blocker.query('COMMIT');locked=false;
 const refreshed=(await claim).rows[0].claim;assert.equal(refreshed.refresh,true);assert.equal(refreshed.row.label,'After wait');assert.deepEqual(refreshed.events,[]);
 assert.equal(await f.tenant(f.merchant,async db=>(await db.query('SELECT 1 FROM device_event_deliveries WHERE merchant_id=$1 AND device_id=$2',[f.merchant,a.device])).rowCount),0,'refresh must not claim or supersede any frame');
 const current={...config,label:'After wait'};
 const claimed=(await f.pool.query(claimSQL,[...args,JSON.stringify(current),JSON.stringify(owner)])).rows[0].claim;
 assert.equal(claimed.refresh,false);assert.deepEqual(claimed.events.map((e:DeviceEvent)=>e.eventId),events.slice(0,8).map(e=>e.eventId));
 assert.ok(claimed.events.every((e:DeviceEvent)=>e.connectionGeneration===a.connectionGeneration));
 const full=(await f.pool.query(claimSQL,[...args,JSON.stringify(current),JSON.stringify(owner)])).rows[0].claim;assert.equal(full.refresh,false);assert.deepEqual(full.events,[]);
 const obsolete=(await f.pool.query(validateSQL,[...args,events[0].eventId])).rows[0].checked;assert.deepEqual(obsolete,{live:true,allowed:false});
 assert.equal((await f.tenant(f.merchant,db=>db.query('SELECT status FROM device_event_deliveries WHERE merchant_id=$1 AND device_id=$2 AND event_id=$3',[f.merchant,a.device,events[0].eventId]))).rows[0].status,'superseded');
 assert.deepEqual((await f.pool.query(validateSQL,[...args,events[1].eventId])).rows[0].checked,{live:true,allowed:true});
 assert.deepEqual((await f.pool.query(validateSQL,[...args,null])).rows[0].checked,{live:true,allowed:true},'COMMAND_RESULT still authenticates without authorizing an event payload');
 success(await f.command(a.device,{type:'CART_OPEN',sessionId:randomUUID(),expectedScreenGeneration:row.screen_generation,expectedAssignmentGeneration:row.assignment_generation,recoverSessionId:null}));
 const cart=(await f.pool.query(probeSQL,args)).rows[0].state;assert.equal(cart.kind,'cart');
 await f.tenant(f.merchant,db=>db.query("UPDATE device_screen_state SET lease_until=clock_timestamp()-interval '1 second' WHERE merchant_id=$1 AND device_id=$2",[f.merchant,a.device]));
 const expired=(await f.pool.query(claimSQL,[...args,JSON.stringify(current),JSON.stringify({kind:'cart',generation:cart.screen_generation,canDismiss:false})])).rows[0].claim;
 assert.equal(expired.refresh,true);assert.equal(expired.row.expired,true);assert.deepEqual(expired.events,[],'lease expiry must remain in the transactional slow path, not claim from a memo');
 assert.deepEqual((await f.pool.query(validateSQL,[...args,randomUUID()])).rows[0].checked,{live:true,allowed:false});
 const staleOwner=(await f.pool.query(claimSQL,[...args,JSON.stringify(current),JSON.stringify({...owner,generation:'999'})])).rows[0].claim;assert.equal(staleOwner.refresh,true);assert.deepEqual(staleOwner.events,[]);
 // Invalid merchant, credential and physical connection fences return no facts.
 for(const invalid of [[f.other,...args.slice(1)],[...args.slice(0,2),'0'.repeat(64),...args.slice(3)],[...args.slice(0,3),'999',...args.slice(4)],[...args.slice(0,4),'999',args[5]],[...args.slice(0,5),randomUUID()]]){
 assert.equal((await f.pool.query(probeSQL,invalid)).rows[0].state,null);
 assert.equal((await f.pool.query(claimSQL,[...invalid,JSON.stringify(current),JSON.stringify(owner)])).rows[0].claim,null);
 assert.deepEqual((await f.pool.query(validateSQL,[...invalid,null])).rows[0].checked,{live:false,allowed:false});
 }
 await f.tenant(f.merchant,db=>db.query('UPDATE device_credentials SET revoked_at=clock_timestamp() WHERE merchant_id=$1 AND device_id=$2',[f.merchant,a.device]));
 assert.deepEqual((await f.pool.query(validateSQL,[...args,null])).rows[0].checked,{live:false,allowed:false});
 }finally{if(locked)await blocker.query('ROLLBACK');if(waiting)await waiting.catch(()=>{});blocker.release();}
});
