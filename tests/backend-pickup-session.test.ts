import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {publicPickupFixture} from './backend-pickup-fixture';
import {success} from './backend-table-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
// Intentional opt-in loading boundary: skipped tests must not require private config.
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
async function ready(render=true){
 const f=await publicPickupFixture(),before=await f.financial();
 await f.kitchen('PREPARING',0);await f.kitchen('READY',1);
 success(await f.command(f.b.id,{type:'CAPABILITIES',capabilities:['pickup_ready_v1']}));
 await f.reconcile();const e=await f.event();assert.ok(e);await f.delivery(e);
 if(render)success(await f.command(f.b.id,f.ack(e)));
 return {...f,before,e};
}
for(const kind of ['unused','expired'] as const)test('public pickup survives a later '+kind+' anonymous visit through final send/render and guest ACK',integration,async()=>{
 const f=await ready(false);
 if(kind==='unused')await f.visit();
 else{
  // The public visit identity is immutable. Insert an already expired passive
  // visit against the real entry, with a creation time AFTER the original visit.
  await f.tenant(f.merchant,db=>db.query(`INSERT INTO table_visits(merchant_id,entry_id,request_id,created_at,expires_at)
   SELECT merchant_id,entry_id,$2,created_at+interval '1 microsecond',created_at+interval '2 microseconds' FROM table_visits WHERE id=$1`,[f.originalBinding.id,randomUUID()]));
 }
 const visits=(await f.tenant(f.merchant,db=>db.query('SELECT id,session_id,expires_at,created_at>(SELECT created_at FROM table_visits WHERE id=$2) AS newer FROM table_visits WHERE entry_id=$1 AND id<>$2',[f.entry.id,f.originalBinding.id]))).rows;
 assert.equal(visits.length,1);assert.equal(visits[0].session_id,null);assert.equal(visits[0].newer,true);
 if(kind==='expired')assert.ok(visits[0].expires_at.getTime()<Date.now());
 await f.reconcile();assert.equal((await f.notice()).state,'DELIVERED');assert.equal((await f.event()).id,f.e.id);
 assert.equal((await f.validate(f.e.id)).allowed,true,'passive visit cannot suppress final READY send');
 success(await f.command(f.b.id,f.ack(f.e)));assert.equal((await f.notice()).state,'RENDERED');
 success(await f.command(f.b.id,{type:'PICKUP_ACK',notificationId:(await f.notice()).id,screenGeneration:String(f.e.screen_generation)}));
 assert.equal((await f.notice()).state,'ACKNOWLEDGED');assert.equal((await f.fulfillment()).status,'READY');assert.deepEqual(await f.financial(),f.before);
});
test('acquired replacement rejects stale guest ACK before poll and emits one safely matching TARGET_CHANGED tombstone',integration,async()=>{
 const f=await ready(),rendered=await f.notice();
 const replacement=await f.visit();await f.request(replacement.path+'/quotes','POST',{items:[{productId:f.product,qty:1}],confirmJoin:true});await f.request(replacement.path+'/release','POST',{});
 // Adverse boundary fixture: preserve the old idle display generation while a
 // genuine public quote/release has acquired and ended a DIFFERENT guest session.
 // This removes screen-change rejection as an accidental explanation of success.
 await f.tenant(f.merchant,db=>db.query('UPDATE device_screen_state SET screen_generation=$2 WHERE device_id=$1',[f.b.id,f.e.screen_generation]));
 const changed=(await f.tenant(f.merchant,db=>db.query('SELECT assignment_generation::text,pickup_guest_generation::text FROM devices WHERE id=$1',[f.b.id]))).rows[0];
 assert.equal(changed.assignment_generation,'1');assert.notEqual(changed.pickup_guest_generation,f.originalBinding.pickup_guest_generation);
 assert.equal((await f.notice()).state,'RENDERED','no reconciliation poll has run');
 const stale=await f.command(f.b.id,{type:'PICKUP_ACK',notificationId:rendered.id,screenGeneration:String(f.e.screen_generation)});
 assert.equal(stale.result.ok,false);if(!stale.result.ok)assert.equal(stale.result.error.code,'INVALID_ACK');
 assert.equal((await f.notice()).acknowledged_at,null);assert.equal((await f.validate(f.e.id)).allowed,false);
 const staleRender=await f.command(f.b.id,f.ack(f.e));assert.equal(staleRender.result.ok,false);
 await f.reconcile();const invalid=await f.notice();assert.equal(invalid.state,'TARGET_CHANGED');assert.ok(invalid.cancel_event_id);
 const cancel=await f.event(invalid.cancel_event_id);assert.equal(cancel.target_device_id,f.b.id);assert.equal(cancel.target_assignment_generation,f.e.target_assignment_generation);assert.equal(cancel.order_id,null);
 assert.deepEqual(cancel.payload.payload,{...f.e.payload.payload,state:'CANCELED',sound:false});assert.equal((await f.validate(cancel.id)).allowed,true,'invalidation does not block its own tombstone');
 await f.delivery(cancel);success(await f.command(f.b.id,f.ack(cancel)));assert.equal((await f.notice()).state,'TARGET_CHANGED','rendering a tombstone is not guest acknowledgment');
 await f.reconcile();assert.equal((await f.notice()).cancel_event_id,cancel.id);
 const effects=(await f.tenant(f.merchant,db=>db.query("SELECT target_device_id,payload->'payload'->>'state' AS state FROM outbox_events WHERE type='PICKUP_READY' AND payload->'payload'->>'orderId'=$1 ORDER BY device_seq",[f.order.id]))).rows;
 assert.deepEqual(effects,[{target_device_id:f.b.id,state:'READY'},{target_device_id:f.b.id,state:'CANCELED'}],'no retry, no auto-retarget, no duplicate tombstone');
 assert.deepEqual(await f.financial(),f.before);const view=await f.fulfillment();assert.equal(view.status,'READY');assert.equal(view.version,2);assert.equal(view.notification!.state,'TARGET_CHANGED');assert.equal(view.notification!.id,invalid.id);
 const foreign=await f.tenant(f.other,async db=>(await db.query('SELECT bitpos.pickup_binding_current($1::uuid,$2::uuid) AS valid',[f.other,invalid.id])).rows[0].valid);assert.equal(foreign,false);
});
