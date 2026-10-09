import type http from 'node:http';
import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {config,customerOrigin} from './config';
import {pool,tenant} from './db';
import {hash} from '../../../packages/domain/src/index';
import {safeRelease} from '../../../packages/domain/src/table-pricing';
import {routingLock,fail} from './authority';
import {ensureDevice,expireCart} from './registry';
import {streamEvent} from './orders';
import {commandSchema,applyDeviceCommand,currentScreen,recoverableDraft,catalogPage,type DeviceActor} from './device-commands';
import type {DeviceCommand,DeviceEvent,DeviceScreen,DeviceConfig} from '../../../packages/contracts/src/index';

type StreamRow={
 label:string;table_id:string|null;assignment_generation:string;table_label:string|null;table_entry_token:string|null;
 register_id:string|null;pairing_generation:string|null;active_price_version_id:string|null;
 kind:DeviceScreen['kind'];screen_generation:string;expired:boolean|null;
 status:string|null;reservation_released:boolean|null;recovery_resolved_at:string|null;
 ambiguous:boolean;rendered:boolean;pending:boolean;
};
type ClaimResult={refresh:true;row:StreamRow;events:[]}|{refresh:false;row:StreamRow;events:DeviceEvent[]};
type StreamState={row:StreamRow;payload:DeviceConfig;ownerSnapshot:{kind:DeviceScreen['kind'];generation:string;canDismiss:boolean};digest:string;owner:string};
function actorArgs(a:DeviceActor){return [a.merchant,a.device,a.tokenHash,a.authGeneration,a.connectionGeneration,a.connectionId];}
// The DB row is authoritative; payloads and hashes remain service-owned scheduling
// hints. In particular, paymentOrigin and limits are not mutable database facts.
function streamMetadata(a:DeviceActor,row:StreamRow):StreamState{
 const payload:DeviceConfig={paymentOrigin:customerOrigin,tableEntryUrl:row.table_entry_token?customerOrigin+'/table/'+row.table_entry_token:null,merchantId:a.merchant,deviceId:a.device,label:row.label,tableId:row.table_id,tableLabel:row.table_label??null,assignmentGeneration:row.assignment_generation,pairingGeneration:row.pairing_generation??null,pairing:row.register_id&&row.pairing_generation?{registerId:row.register_id,pairingGeneration:row.pairing_generation}:null,priceVersion:row.active_price_version_id??null,pricingReady:!!row.active_price_version_id,limits:{cartLines:50,quantity:100,pageRows:4,inboundBytes:8191,outboundBytes:7168},heartbeatSeconds:30,leaseSeconds:120};
 const canDismiss=row.kind==='order'&&safeRelease(row.status??'',!!row.reservation_released,Number(row.ambiguous),row.rendered,!!row.recovery_resolved_at);
 const ownerSnapshot={kind:row.kind,generation:row.screen_generation,canDismiss};
 return {row,payload,ownerSnapshot,digest:hash(JSON.stringify(payload)),owner:hash(JSON.stringify(ownerSnapshot))};
}
async function streamState(db:pg.Pool|pg.PoolClient,a:DeviceActor){
 const row=(await db.query<{state:StreamRow|null}>('SELECT bitpos.device_stream_probe($1::uuid,$2::uuid,$3::text,$4::bigint,$5::bigint,$6::uuid) AS state',actorArgs(a))).rows[0].state;
 if(!row)fail('DEVICE_AUTH_INVALID',401);
 return streamMetadata(a,row);
}
async function claimEvents(db:pg.Pool|pg.PoolClient,a:DeviceActor,state:StreamState){
 const result=(await db.query<{claim:ClaimResult|null}>('SELECT bitpos.device_claim_events($1::uuid,$2::uuid,$3::text,$4::bigint,$5::bigint,$6::uuid,$7::jsonb,$8::jsonb) AS claim',[...actorArgs(a),JSON.stringify(state.payload),JSON.stringify(state.ownerSnapshot)])).rows[0].claim;
 if(!result)fail('DEVICE_AUTH_INVALID',401);
 return result;
}
export function attachDevices(server:http.Server){
 const wss=new WebSocketServer({noServer:true,maxPayload:8191});const sockets=new Map<string,WebSocket>();const wakes=new Set<(notified?:boolean)=>void>();
 // NOTIFY is only a wake hint. Losing LISTEN never loses durable events; the
 // lightweight 250ms query remains the recovery path, with no empty-poll mutex.
 let listener:pg.PoolClient|undefined,stopped=false;
 server.once('listening',()=>{void (async()=>{let db:pg.PoolClient|undefined;try{db=await pool.connect();if(stopped){db.release();return;}listener=db;db.on('notification',()=>{for(const wake of wakes)wake(true);});db.on('error',()=>{if(listener===db){listener=undefined;db?.release(true);}});await db.query('LISTEN bitpos_device_outbox');}catch{if(db&&listener===db){listener=undefined;db.release(true);}}})();});
 server.once('close',()=>{stopped=true;const db=listener;listener=undefined;if(db)void db.query('UNLISTEN bitpos_device_outbox').catch(()=>{}).finally(()=>db.release(true));});
 server.on('upgrade',(req,socket,head)=>{void (async()=>{try{const url=new URL(req.url??'/',config.PUBLIC_URL);const token=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)?.[1];if(url.pathname!=='/api/device'||url.search||!token){socket.destroy();return;}const tokenHash=hash(token);const resolved=(await pool.query('SELECT * FROM bitpos.resolve_device($1)',[tokenHash])).rows[0];if(!resolved){socket.destroy();return;}
 const actor=await tenant(resolved.merchant_id,async db=>{await routingLock(db,resolved.merchant_id);const live=(await db.query('SELECT 1 FROM device_credentials c JOIN devices d ON d.merchant_id=c.merchant_id AND d.id=c.device_id WHERE c.token_hash=$1 AND c.revoked_at IS NULL AND d.revoked_at IS NULL AND c.auth_generation=d.auth_generation',[tokenHash])).rowCount;if(!live)fail('DEVICE_AUTH_INVALID',401);await ensureDevice(db,resolved.merchant_id,resolved.device_id);const id=randomUUID();const p=(await db.query("UPDATE device_presence SET connection_generation=connection_generation+1,connection_id=$3,connected_until=clock_timestamp()+interval '60 seconds',last_seen_at=clock_timestamp() WHERE merchant_id=$1 AND device_id=$2 RETURNING connection_generation::text",[resolved.merchant_id,resolved.device_id,id])).rows[0];return {merchant:resolved.merchant_id,device:resolved.device_id,tokenHash,authGeneration:String(resolved.auth_generation),connectionGeneration:p.connection_generation,connectionId:id};});
 wss.handleUpgrade(req,socket,head,ws=>connect(ws,actor));}catch{socket.destroy();}})();});
 function connect(ws:WebSocket,a:DeviceActor){
 const key=a.merchant+':'+a.device;sockets.get(key)?.close(1000,'Replaced connection');sockets.set(key,ws);
 let busy=false,initialized=false,closed=false,requested=false,notified=false,processing=false,catalogBusy=false;
 let configHash='',ownerHash='',nextCatalog=0;
 let memo:StreamState|undefined;
 const inbound:{command:DeviceCommand;receivedAt:string}[]=[];
 async function send(value:unknown,event?:{eventId:string;type:string},establishing=false){
 if(closed||ws.readyState!==WebSocket.OPEN)return;
 const bytes=JSON.stringify(value);if(Buffer.byteLength(bytes)>7168||ws.bufferedAmount>32768){ws.close(1009,'Resynchronize');return;}
 const checked=(await pool.query<{checked:{live:boolean;allowed:boolean}}>('SELECT bitpos.device_validate_send($1::uuid,$2::uuid,$3::text,$4::bigint,$5::bigint,$6::uuid,$7::uuid) AS checked',[...actorArgs(a),event?.eventId??null])).rows[0].checked;
 if(!checked.live)fail('DEVICE_AUTH_INVALID',401);
 const allowed=checked.allowed;
 // Losing an establishing frame must force a new authenticated snapshot, not
 // leave a connection marked initialized with only scheduling hashes.
 if(establishing&&!allowed&&(event?.type==='CONFIG'||event?.type==='SNAPSHOT')){ws.close(1008,'Resynchronize');return;}
 // Commit before send; no async work between the final check and enqueue.
 // A database cannot retract socket bytes: receivers still fence generations
 // and order versions across the unavoidable cross-process post-commit race.
 if(allowed&&!closed&&ws.readyState===WebSocket.OPEN){if(ws.bufferedAmount>32768){ws.close(1009,'Resynchronize');return;}ws.send(bytes,error=>{if(error)ws.close(1008,'Resynchronize');});}
 }
 function wake(notification=false){requested=true;notified||=notification;void pump();}
 async function pump(){
 if(busy||processing||closed||ws.readyState!==WebSocket.OPEN)return;busy=true;requested=false;
 try{
 // A committed NOTIFY can go directly to the authenticated claim. Memo is
 // comparison input only; the routine rereads live state after its mutex wait.
 const notification=notified;notified=false;
 let committed:{events:DeviceEvent[];state:StreamState}|undefined;
 const claim=notification&&initialized&&memo?await claimEvents(pool,a,memo):undefined;
 const probe=claim?streamMetadata(a,claim.row):await streamState(pool,a);
 if(claim&&!claim.refresh)committed={events:claim.events,state:probe};
 if(claim||!initialized||probe.digest!==configHash||probe.owner!==ownerHash||probe.row.expired||probe.row.pending){
 const establishing=!initialized;
 if(!claim&&initialized&&memo&&probe.digest===configHash&&probe.owner===ownerHash&&!probe.row.expired){
 // Ordinary events use the previously committed memo only for comparison. The
 // function authenticates and rereads after its mutex wait; refresh claims none.
 const claimed=await claimEvents(pool,a,memo);
 if(!claimed.refresh)committed={events:claimed.events,state:streamMetadata(a,claimed.row)};
 }
 if(!committed)committed=await tenant(a.merchant,async db=>{
 await routingLock(db,a.merchant);let state=await streamState(db,a);
 if(state.row.expired){await expireCart(db,a.merchant,a.device);state=await streamState(db,a);}
 await db.query('SAVEPOINT device_stream_refresh');
 if(!initialized)await db.query("INSERT INTO device_event_deliveries(merchant_id,device_id,event_id,device_seq,connection_generation,status) SELECT merchant_id,target_device_id,id,device_seq,$3,'superseded' FROM outbox_events WHERE merchant_id=$1 AND target_device_id=$2 ON CONFLICT DO NOTHING",[a.merchant,a.device,a.connectionGeneration]);
 if(!initialized||state.digest!==configHash)await streamEvent(db,a.merchant,a.device,state.row.assignment_generation,state.row.screen_generation,'CONFIG',state.payload);
 if(!initialized||(state.owner!==ownerHash&&(state.row.kind!=='order'||state.ownerSnapshot.canDismiss))){
 const screen=await currentScreen(db,a.merchant,a.device);
 const order=screen.kind==='order'?(await db.query('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2 AND version=$3',[a.merchant,screen.order.id,screen.order.version])).rows[0]:undefined;
 if(screen.kind==='order'&&!order)fail('DELIVERY_UNAVAILABLE',503);
 await streamEvent(db,a.merchant,a.device,state.row.assignment_generation,screen.screenGeneration,'SNAPSHOT',{screen,recoverableDraft:await recoverableDraft(db,a)},order);
 }
 const claimed=await claimEvents(db,a,state);
 // A lease can expire during slow snapshot construction. Roll back those
 // unpublished frames and refresh again without adopting hashes or disconnecting.
 if(claimed.refresh){await db.query('ROLLBACK TO SAVEPOINT device_stream_refresh');return undefined;}
 return {events:claimed.events,state:streamMetadata(a,claimed.row)};
 });
 if(!committed){requested=true;return;}
 // Hashes/initialization describe committed durable state, never rolled-back
 // config/snapshot writes. They are scheduling hints, not receipt authority.
 memo=committed.state;configHash=memo.digest;ownerHash=memo.owner;initialized=true;
 for(const event of committed.events)await send(event,event,establishing);
 if(committed.events.length)requested=true;
 }
 if(!processing&&!inbound.length&&probe.row.kind==='idle'&&Date.now()>=nextCatalog)void publishCatalog(probe.row.screen_generation);
 }catch{ws.close(1008,'Resynchronize');}finally{busy=false;if(inbound.length&&!processing&&!closed)queueMicrotask(()=>void drain());else if(requested&&!processing&&!closed)queueMicrotask(()=>void pump());}
 }
 async function publishCatalog(generation:string){
 if(catalogBusy||closed)return;catalogBusy=true;nextCatalog=Date.now()+10000;
 try{
 // Catalog construction holds no routing mutex and is not awaited by pump or
 // ACK. Publish only after rechecking idle ownership, current pricing and lease.
 const catalog=await tenant(a.merchant,db=>catalogPage(db,a,null,0));
 if(closed||processing||inbound.length)return;
 await tenant(a.merchant,async db=>{await routingLock(db,a.merchant);const state=await streamState(db,a);if(state.row.kind!=='idle'||state.row.screen_generation!==generation||state.payload.priceVersion!==catalog.priceVersion||Date.parse(catalog.validUntil)<=Date.now()||state.row.pending||processing||inbound.length)return;await streamEvent(db,a.merchant,a.device,state.row.assignment_generation,generation,'CATALOG',catalog);});
 }catch{if(!closed)ws.close(1008,'Resynchronize');}finally{catalogBusy=false;}
 }
 async function drain(){if(processing)return;processing=true;try{let remaining=8;while(!closed&&inbound.length&&remaining--){let index=inbound.findIndex(entry=>entry.command.type==='ACK');if(index<0)index=inbound.findIndex(entry=>entry.command.type==='ORDER_SUBMIT'||entry.command.type==='ORDER_DISMISS');if(index<0)index=0;const {command,receivedAt}=inbound.splice(index,1)[0];const result=await tenant(a.merchant,db=>applyDeviceCommand(db,a,command,receivedAt));await send(result);requested=true;}}catch{inbound.length=0;ws.close(1008,'Invalid command');}finally{processing=false;if(requested)void pump();}}
 ws.on('message',(raw,binary)=>{const receivedAt=new Date().toISOString();if(binary||Buffer.byteLength(raw.toString())>8191||inbound.length+(processing?1:0)>=8){ws.close(1009,'Resynchronize');return;}try{inbound.push({command:commandSchema.parse(JSON.parse(raw.toString())),receivedAt});if(!busy)void drain();}catch{ws.close(1008,'Invalid command');}});
 wakes.add(wake);const timer=setInterval(()=>wake(),250);
 ws.on('close',()=>{closed=true;clearInterval(timer);wakes.delete(wake);if(sockets.get(key)===ws)sockets.delete(key);void tenant(a.merchant,db=>db.query('UPDATE device_presence SET connected_until=NULL WHERE merchant_id=$1 AND device_id=$2 AND connection_generation=$3 AND connection_id=$4',[a.merchant,a.device,a.connectionGeneration,a.connectionId])).catch(()=>{});});wake();
 }
}
