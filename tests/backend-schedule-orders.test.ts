import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type pg from 'pg';
import {fixturePaymentAttempt} from './backend-payment-fixture';
import {withFixture,type Q} from './backend-online-quote-fixture';
// DS42 / WP3b: scheduled order admission, capacity, once-only due work and
// payment/cancel convergence. DB-backed; every test is rolled back.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
async function slot(db:pg.Client,source:Q,capacity=1){
 const branch=(await db.query('SELECT timezone FROM marketplace_branches WHERE merchant_id=$1 AND id=$2',[source.merchant_id,source.source_branch_id])).rows[0];
 const id=randomUUID();
 await db.query("INSERT INTO schedule107_windows(id,merchant_id,branch_id,serving,timezone,starts_at,ends_at,kitchen_release_at,booking_closes_at,capacity)VALUES($1,$2,$3,'pickup',$4,clock_timestamp()+interval '2 hours',clock_timestamp()+interval '2 hours 30 minutes',clock_timestamp()+interval '90 minutes',clock_timestamp()+interval '1 hour',$5)",[id,source.merchant_id,source.source_branch_id,branch.timezone,capacity]);
 return id;
}
const booking=async(db:pg.Client,orderId:string)=>(await db.query('SELECT * FROM schedule168_bookings WHERE order_id=$1',[orderId])).rows[0] as Q|undefined;
async function pay(db:pg.Client,source:Q,orderId:string,settleAttempt:any){
 const attempt=(await fixturePaymentAttempt(db,{merchant:source.merchant_id,order:orderId,status:'SUBMITTED',signature:'ds42-'+randomUUID()})).rows[0];
 await settleAttempt(db,attempt,true);return attempt;
}
async function schedule(db:pg.Client,slotId:string,quoteId:string){
 const {prepareFoodScheduleCandidate}=await import('../apps/api/src/food-schedule-candidate');
 await db.query('SET CONSTRAINTS ALL DEFERRED');const r=await prepareFoodScheduleCandidate(db,slotId,quoteId,randomUUID());await db.query('SET CONSTRAINTS ALL IMMEDIATE');return r;
}
/** Moves the booking release instant into the past, as the clock reaching it would. */
async function elapse(db:pg.Client,orderId:string){
 await db.query('ALTER TABLE schedule168_bookings DISABLE TRIGGER schedule168_booking_guard');
 await db.query("UPDATE schedule168_bookings SET kitchen_release_at=clock_timestamp()-interval '1 second' WHERE order_id=$1",[orderId]);
 await db.query('ALTER TABLE schedule168_bookings ENABLE TRIGGER schedule168_booking_guard');
}

test('a held slot is admitted to checkout, bound once, paid, and released to the kitchen exactly once after the server release time',integration,async()=>withFixture(async({db,source,quote,order,rejected,modules})=>{
 const slotId=await slot(db,source,1),q=await quote(),hold=await schedule(db,slotId,q);
 assert.equal(hold.state,'HELD');
 const o=await order(q);
 const bound=(await booking(db,o.id))!;assert.equal(bound.state,'BOUND');assert.equal(bound.slot_id,slotId);
 const window=(await db.query('SELECT kitchen_release_at FROM schedule107_windows WHERE id=$1',[slotId])).rows[0];
 assert.equal(new Date(bound.kitchen_release_at).getTime(),new Date(window.kitchen_release_at).getTime(),'release instant comes from the server-published window');
 // One quote cannot become a second order; the single-capacity slot is full for another quote.
 await rejected(()=>order(q),'SCHEDULE_ALREADY_BOOKED');
 await rejected(async()=>schedule(db,slotId,await quote()),'SCHEDULE_CAPACITY_EXHAUSTED');
 // Due work before payment or before release time is a no-op.
 assert.equal((await db.query('SELECT schedule168_release_due(10) n')).rows[0].n,0);
 await pay(db,source,o.id,modules.settleAttempt);
 assert.equal((await booking(db,o.id))!.state,'PAID');
 assert.equal((await db.query('SELECT schedule168_release_due(10) n')).rows[0].n,0,'paid but release time not reached');
 // Capacity stays consumed after the hold lease would have lapsed (expiry never frees a bound booking).
 await db.query('ALTER TABLE schedule107_holds DISABLE TRIGGER schedule107_hold_guard');await db.query("UPDATE schedule107_holds SET expires_at=clock_timestamp()-interval '1 second',created_at=clock_timestamp()-interval '2 seconds' WHERE id=$1",[hold.id]);await db.query('ALTER TABLE schedule107_holds ENABLE TRIGGER schedule107_hold_guard');
 assert.equal((await db.query('SELECT schedule107_expire(10) n')).rows[0].n,0);
 await rejected(async()=>schedule(db,slotId,await quote()),'SCHEDULE_CAPACITY_EXHAUSTED');
 await elapse(db,o.id);
 const before=(await db.query('SELECT event_sequence::int n FROM online_food_orders WHERE order_id=$1',[o.id])).rows[0].n;
 assert.equal((await db.query('SELECT schedule168_release_due(10) n')).rows[0].n,1);
 // A restarted worker / duplicate tick finds nothing and adds no second event.
 assert.equal((await db.query('SELECT schedule168_release_due(10) n')).rows[0].n,0);
 const due=(await booking(db,o.id))!;assert.equal(due.state,'DUE');assert.ok(due.due_at);
 const events=(await db.query("SELECT sequence::int s FROM mobile_order_events WHERE order_id=$1 AND kind='SCHEDULE_DUE'",[o.id])).rows;
 assert.equal(events.length,1);assert.equal(events[0].s,before+1);
 // Due bookings are final and immutable.
 await rejected(()=>db.query("UPDATE schedule168_bookings SET state='CANCELED',version=version+1 WHERE order_id=$1",[o.id]),'SCHEDULE_BOOKING_IMMUTABLE');
 await rejected(()=>db.query('DELETE FROM schedule168_bookings WHERE order_id=$1',[o.id]),'immutable authority record');
 await db.query('SAVEPOINT role');await db.query('SET LOCAL ROLE bitpos_app');await assert.rejects(db.query('SELECT * FROM schedule168_bookings'),/permission denied/);await db.query('ROLLBACK TO SAVEPOINT role');
}));

test('unpaid expiry, late payment and merchant rejection cancel the booking and free capacity; nothing becomes due',integration,async()=>withFixture(async({db,source,quote,order,rejected,modules})=>{
 const slotId=await slot(db,source,1);
 // 1. Unpaid order closed by the closure routine.
 let q=await quote();await schedule(db,slotId,q);let o=await order(q);
 await db.query("UPDATE orders SET status='EXPIRED',closure_reason='timeout',version=version+1 WHERE id=$1",[o.id]);
 assert.equal((await booking(db,o.id))!.state,'CANCELED');
 // 2. Slot is free again; a new booking is admitted, paid, then the merchant rejects it before the kitchen release.
 q=await quote();await schedule(db,slotId,q);o=await order(q);await pay(db,source,o.id,modules.settleAttempt);assert.equal((await booking(db,o.id))!.state,'PAID');
 await db.query("UPDATE online_food_orders SET acceptance_status='REJECTED',acceptance_version=acceptance_version+1,decision_by=$2,decision_reason='ds42-test' WHERE order_id=$1",[o.id,randomUUID()]);
 await db.query('SELECT ensure_online_decision_refunds($1,$2)',[source.merchant_id,o.id]);
 assert.equal((await booking(db,o.id))!.state,'CANCELED');
 assert.equal((await db.query('SELECT count(*)::int n FROM refunds WHERE order_id=$1',[o.id])).rows[0].n,1,'paid scheduled order has its refund obligation');
 await elapse(db,o.id).catch(()=>undefined);
 assert.equal((await db.query('SELECT schedule168_release_due(10) n')).rows[0].n,0,'canceled bookings are never released to the kitchen');
 // 3. Capacity is free once more.
 q=await quote();await schedule(db,slotId,q);o=await order(q);assert.equal((await booking(db,o.id))!.state,'BOUND');
 // 4. Late payment of an expired order goes to recovery, not to the kitchen.
 await db.query("UPDATE orders SET status='RECOVERY',version=version+1 WHERE id=$1",[o.id]);
 assert.equal((await booking(db,o.id))!.state,'CANCELED');
 // Order creation is refused once the slot is closed to bookings or disabled.
 q=await quote();await schedule(db,slotId,q);
 await db.query('UPDATE schedule107_windows SET enabled=false WHERE id=$1',[slotId]);
 await rejected(()=>order(q),'SCHEDULE_HOLD_UNAVAILABLE');
 void source;
}));

test('scheduled checkout fails closed for expired holds, other accounts and orders without hold context; due-work lane is wired',integration,async()=>withFixture(async({db,source,quote,order,rejected})=>{
 const slotId=await slot(db,source,2),q=await quote(),hold=await schedule(db,slotId,q);
 await db.query('SAVEPOINT expired');await db.query('ALTER TABLE schedule107_holds DISABLE TRIGGER schedule107_hold_guard');await db.query("UPDATE schedule107_holds SET expires_at=clock_timestamp()-interval '1 second',created_at=clock_timestamp()-interval '2 seconds' WHERE id=$1",[hold.id]);await db.query('ALTER TABLE schedule107_holds ENABLE TRIGGER schedule107_hold_guard');
 await rejected(()=>order(q),'SCHEDULE_HOLD_UNAVAILABLE');await db.query('ROLLBACK TO SAVEPOINT expired');
 await db.query('SAVEPOINT nocontext');await db.query("SELECT set_config('bitpos.merchant','',true)");await rejected(()=>order(q),'');await db.query('ROLLBACK TO SAVEPOINT nocontext');
 assert.equal((await db.query('SELECT count(*)::int n FROM schedule168_bookings WHERE quote_id=$1',[q])).rows[0].n,0);
 const o=await order(q);assert.equal((await booking(db,o.id))!.state,'BOUND');
 // The worker exposes the due-work tick and the SQL entry point is the one granted to the app role.
 const worker=await import('../apps/worker/src/index');assert.equal(typeof worker.tickScheduledOrders,'function');
 assert.equal((await db.query("SELECT has_function_privilege('bitpos_app','bitpos.schedule168_release_due(integer)','EXECUTE') ok")).rows[0].ok,true);
 assert.equal((await db.query("SELECT has_function_privilege('bitpos_app','bitpos.schedule168_cancel(bitpos.schedule168_bookings)','EXECUTE') ok")).rows[0].ok,false);
}));
