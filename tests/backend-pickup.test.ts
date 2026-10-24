import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tableFixture,success} from './backend-table-fixture';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
// Intentional loading boundary: skipped database tests must not load required private config.
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
async function fixture(){
 const f=await tableFixture(),{order}=await f.create(await f.quote());
 // Runtime service is loaded only after the integration opt-in fixture.
 const api=await import('../apps/api/src/fulfillment');
 const request=(status:string,version:number,key=randomUUID(),role='staff')=>f.tenant(f.merchant,db=>api.fulfillmentRequest(db,f.merchant,f.actor,role,order.id,false,{status,expectedVersion:version,idempotencyKey:key}));
 const read=()=>f.tenant(f.merchant,async db=>({financial:(await db.query('SELECT to_jsonb(o) AS data FROM orders o WHERE id=$1',[order.id])).rows[0].data,stock:(await db.query('SELECT stock,reserved FROM products WHERE id=$1',[f.product])).rows[0],bill:(await db.query('SELECT settlement,total_minor::text,target_device_id,target_assignment_generation::text FROM order_authority WHERE order_id=$1',[order.id])).rows[0],fulfillment:(await api.fulfillmentViews(db,f.merchant,[order.id])).get(order.id)!}));
 const reconcile=()=>f.tenant(f.merchant,db=>api.reconcilePickup(db,f.merchant,f.a.id,f.devices.get(f.a.id)!.connectionGeneration));
 const idle=()=>f.tenant(f.merchant,db=>db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,screen_generation=screen_generation+1 WHERE device_id=$1",[f.a.id]));
 const notice=()=>f.tenant(f.merchant,async db=>(await db.query('SELECT * FROM pickup_notifications WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1',[order.id])).rows[0]);
 const event=()=>f.tenant(f.merchant,async db=>(await db.query("SELECT e.* FROM outbox_events e JOIN pickup_notifications n ON n.last_event_id=e.id WHERE n.order_id=$1 ORDER BY n.created_at DESC LIMIT 1",[order.id])).rows[0]);
 return {...f,order,api,request,read,reconcile,idle,notice,event};
}
test('paid-only kitchen transitions, duplicate requests and guest acknowledgment never alter bill/payment/stock or collect',integration,async()=>{
 const f=await fixture();await assert.rejects(f.request('PREPARING',0),/ORDER_NOT_PAYABLE/);
 // Explicit database-only verified-state fixture, not chain/payment proof.
 await f.tenant(f.merchant,db=>db.query("UPDATE orders SET status='PAID',version=version+1 WHERE id=$1",[f.order.id]));
 const before=await f.read();await assert.rejects(f.request('PREPARING',0,randomUUID(),'customer'),/ROLE_REQUIRED/);
 const key=randomUUID(),prepared=await f.request('PREPARING',0,key);assert.equal(prepared.fulfillment.status,'PREPARING');assert.deepEqual(await f.request('PREPARING',0,key),prepared);
 await assert.rejects(f.request('READY',0),/FULFILLMENT_VERSION_CONFLICT/);await assert.rejects(f.request('COLLECTED',1),/FULFILLMENT_TRANSITION_INVALID/);
 await f.request('READY',1);await f.reconcile();assert.equal((await f.notice()).state,'UNSUPPORTED');assert.equal(await f.event(),undefined);
 success(await f.command(f.a.id,{type:'CAPABILITIES',capabilities:['pickup_ready_v1']}));await f.reconcile();assert.equal(await f.event(),undefined,'paid receipt still owns screen; queue does not overwrite it');
 await f.idle();await f.reconcile();const e=await f.event();assert.equal(e.target_device_id,f.a.id);assert.equal(e.order_id,null);assert.equal(e.payload.payload.sound,true);
 assert.equal(await f.tenant(f.merchant,async db=>(await db.query("SELECT count(*)::int AS n FROM outbox_events WHERE type='PICKUP_READY' AND target_device_id IN ($1,$2)",[f.b.id,f.c.id])).rows[0].n),0);
 await f.tenant(f.merchant,db=>db.query('INSERT INTO device_event_deliveries(merchant_id,device_id,event_id,device_seq,connection_generation) VALUES($1,$2,$3,$4,1)',[f.merchant,f.a.id,e.id,e.device_seq]));
 const ack={type:'ACK',eventId:e.id,deviceSeq:String(e.device_seq),orderId:null,orderVersion:null,screenGeneration:String(e.screen_generation),rendered:true};
 const wrong=await f.command(f.b.id,ack);assert.equal(wrong.result.ok,false);
 success(await f.command(f.a.id,ack));const rendered=await f.notice();assert.equal(rendered.state,'RENDERED');assert.ok(rendered.sound_consumed_at);
 success(await f.command(f.a.id,ack));assert.equal((await f.notice()).sound_consumed_at.toISOString(),rendered.sound_consumed_at.toISOString());
 success(await f.command(f.a.id,{type:'PICKUP_ACK',notificationId:rendered.id,screenGeneration:String(e.screen_generation)}));const got=await f.read();assert.equal(got.fulfillment.status,'READY');assert.equal(got.fulfillment.notification!.state,'ACKNOWLEDGED');
 await f.request('COLLECTED',2);const collected=await f.read();assert.equal(collected.fulfillment.status,'COLLECTED');assert.deepEqual(collected.financial,before.financial);assert.deepEqual(collected.stock,before.stock);assert.deepEqual(collected.bill,before.bill);
 await assert.rejects(f.tenant(f.other,db=>f.api.fulfillmentRequest(db,f.other,f.actor,'owner',f.order.id,false,{status:'PREPARING',expectedVersion:0,idempotencyKey:randomUUID()})),/RESOURCE_NOT_FOUND/);
});
test('reconnect publishes silent pickup; changed generation requires explicit retarget and TTL refuses stale render',integration,async()=>{
 const f=await fixture();await f.tenant(f.merchant,db=>db.query("UPDATE orders SET status='PAID',version=version+1 WHERE id=$1",[f.order.id]));await f.request('PREPARING',0);await f.request('READY',1);await f.idle();success(await f.command(f.a.id,{type:'CAPABILITIES',capabilities:['pickup_ready_v1']}));await f.reconcile();const first=await f.event();
 await f.tenant(f.merchant,db=>db.query('UPDATE device_presence SET connection_generation=2 WHERE device_id=$1',[f.a.id]));f.devices.get(f.a.id)!.connectionGeneration='2';success(await f.command(f.a.id,{type:'CAPABILITIES',capabilities:['pickup_ready_v1']}));await f.reconcile();const replay=await f.event();assert.notEqual(replay.id,first.id);assert.equal(replay.payload.payload.sound,false);assert.equal(replay.payload.payload.effectId,first.payload.payload.effectId);
 await f.tenant(f.merchant,db=>db.query('UPDATE devices SET assignment_generation=assignment_generation+1 WHERE id=$1',[f.a.id]));await f.reconcile();assert.equal((await f.notice()).state,'TARGET_CHANGED');assert.equal((await f.event()).id,replay.id);
 await assert.rejects(f.tenant(f.merchant,db=>f.api.fulfillmentRequest(db,f.merchant,f.actor,'staff',f.order.id,true,{expectedVersion:2,idempotencyKey:randomUUID(),targetDeviceId:f.a.id,assignmentGeneration:'1',confirmTarget:true})),/NOTIFICATION_TARGET_CHANGED/);
 const resent=await f.tenant(f.merchant,db=>f.api.fulfillmentRequest(db,f.merchant,f.actor,'staff',f.order.id,true,{expectedVersion:2,idempotencyKey:randomUUID(),targetDeviceId:f.a.id,assignmentGeneration:'2',confirmTarget:true}));assert.equal(resent.fulfillment.version,3);await f.reconcile();const n=await f.notice(),e=await f.event();assert.notEqual(n.id,first.payload.payload.notificationId);
 await f.tenant(f.merchant,db=>db.query("UPDATE pickup_notifications SET expires_at=greatest(created_at+interval '1 millisecond',clock_timestamp()-interval '1 millisecond') WHERE id=$1",[n.id]));
 await f.tenant(f.merchant,db=>db.query('INSERT INTO device_event_deliveries(merchant_id,device_id,event_id,device_seq,connection_generation) VALUES($1,$2,$3,$4,2)',[f.merchant,f.a.id,e.id,e.device_seq]));const ack=await f.command(f.a.id,{type:'ACK',eventId:e.id,deviceSeq:String(e.device_seq),orderId:null,orderVersion:null,screenGeneration:String(e.screen_generation),rendered:true});assert.equal(ack.result.ok,false);await f.reconcile();assert.equal((await f.notice()).state,'EXPIRED');
});
