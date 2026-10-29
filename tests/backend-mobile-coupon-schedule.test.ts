import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type pg from 'pg';
import {withFixture,type Q} from './backend-online-quote-fixture';
// DS41/DS42 public mobile_v1 surface: coupon apply, published schedule slots and
// slot hold, exercised through the same handlers the HTTP routes call, as the
// application role (bitpos_app), inside one rolled-back transaction.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const wire=await import('../packages/contracts/src/mobile-v1.generated');
const food=await import('../apps/api/src/mobile-food');
async function principal(db:pg.Client,source:Q){const sid=(await db.query("SELECT current_setting('bitpos.mobile_session') s")).rows[0].s;return{accountId:source.source_account_id as string,sessionId:sid as string,deviceId:randomUUID()};}
async function asApp<T>(db:pg.Client,fn:()=>Promise<T>){await db.query('SET LOCAL ROLE bitpos_app');const result=await fn();await db.query('RESET ROLE');return result;} // on failure the caller's savepoint rollback restores the role
async function codeOf(db:pg.Client,version:string){return (await db.query('SELECT c.code FROM coupon097_versions v JOIN coupon097_campaigns c ON c.id=v.campaign_id WHERE v.id=$1',[version])).rows[0].code as string;}
async function slot(db:pg.Client,source:Q,capacity=1,serving='pickup',days=0){
 const branch=(await db.query('SELECT timezone FROM marketplace_branches WHERE merchant_id=$1 AND id=$2',[source.merchant_id,source.source_branch_id])).rows[0];const id=randomUUID();
 await db.query("INSERT INTO schedule107_windows(id,merchant_id,branch_id,serving,timezone,starts_at,ends_at,kitchen_release_at,booking_closes_at,capacity)VALUES($1,$2,$3,$6,$4,clock_timestamp()+interval '2 hours'+$7::int*interval '1 day',clock_timestamp()+interval '2 hours 30 minutes'+$7::int*interval '1 day',clock_timestamp()+interval '90 minutes'+$7::int*interval '1 day',clock_timestamp()+interval '1 hour'+$7::int*interval '1 day',$5)",[id,source.merchant_id,source.source_branch_id,branch.timezone,capacity,serving,days]);return id;
}
test('route entry points authenticate before touching coupon, hold or slot SQL',async()=>{
 for(const [method,path,body] of [['POST',`/api/mobile/v1/food/quotes/${randomUUID()}/coupon`,{code:'ABC',idempotencyKey:randomUUID()}],['POST',`/api/mobile/v1/food/quotes/${randomUUID()}/schedule-hold`,{slotId:randomUUID(),idempotencyKey:randomUUID()}],['GET',`/api/mobile/v1/branches/${randomUUID()}/schedule-slots?serving=pickup`,undefined]] as const)
  await assert.rejects(food.mobileFoodRequest(new URL('http://x'+path),method,body,undefined),(e:any)=>e.status===401&&e.code==='AUTH_REQUIRED');
});
test('coupon route: server-computed discounted quote, idempotent replay, typed refusals, and the discounted quote becomes the order',integration,async()=>withFixture(async({db,source,quote,policy,order,rejected})=>{
 const actor=await principal(db,source),branch=source.source_branch_id as string,version=await policy({global:5,account:1}),code=await codeOf(db,version);
 const base=await quote(),key=randomUUID();
 const applied=await asApp(db,()=>food.applyFoodCoupon(db as unknown as pg.PoolClient,actor,branch,base,{code:code.toLowerCase(),idempotencyKey:key}));
 assert.equal(wire.MobileCouponQuoteSchema.parse(applied).couponCode,code);assert.equal(applied.sourceQuoteId,base);assert.notEqual(applied.quote.id,base);
 const sourceRow=(await db.query('SELECT total_minor FROM order_quotes WHERE id=$1',[base])).rows[0],replacement=(await db.query('SELECT total_minor,usdg_minor FROM order_quotes WHERE id=$1',[applied.quote.id])).rows[0];
 assert.equal(BigInt(applied.quote.total.amountMinor),BigInt(sourceRow.total_minor)-1n,'discount is the server fixed 1 minor unit, not client supplied');
 assert.equal(applied.quote.total.amountMinor,String(replacement.total_minor));assert.equal(applied.quote.settlement.money.amountMinor,String(replacement.usdg_minor));
 assert.equal(applied.quote.discount.amountMinor,'1');
 // Same idempotency key: same replacement quote, no second hold.
 const replay=await asApp(db,()=>food.applyFoodCoupon(db as unknown as pg.PoolClient,actor,branch,base,{code,idempotencyKey:key}));
 assert.equal(replay.quote.id,applied.quote.id);assert.equal((await db.query('SELECT count(*)::int n FROM coupon097_holds WHERE quote_id=$1',[base])).rows[0].n,1);
 // The same key for another code is a conflict; unknown/blank codes and other accounts' quotes are typed refusals.
 await rejected(()=>asApp(db,()=>food.applyFoodCoupon(db as unknown as pg.PoolClient,actor,branch,base,{code:'NOPE'+code.slice(0,6),idempotencyKey:key})),'COUPON_NOT_FOUND');
 await rejected(async()=>asApp(db,async()=>food.applyFoodCoupon(db as unknown as pg.PoolClient,actor,branch,await quote(),{code:'ZZZ-NO-SUCH-CODE',idempotencyKey:randomUUID()})),'COUPON_NOT_FOUND');
 await rejected(()=>asApp(db,()=>food.applyFoodCoupon(db as unknown as pg.PoolClient,actor,branch,randomUUID(),{code,idempotencyKey:randomUUID()})),'RESOURCE_NOT_FOUND');
 await rejected(async()=>asApp(db,async()=>food.applyFoodCoupon(db as unknown as pg.PoolClient,actor,branch,await quote(),{code:'x',idempotencyKey:randomUUID()})),'');
 // Per-account cap 1: a second coupon quote is refused with the typed QUOTE_CHANGED reason.
 await db.query('SAVEPOINT cap');try{await asApp(db,async()=>food.applyFoodCoupon(db as unknown as pg.PoolClient,actor,branch,await quote(),{code,idempotencyKey:randomUUID()}));assert.fail('cap');}catch(e:any){assert.equal(e.status,409);assert.equal(e.code,'QUOTE_CHANGED');assert.equal(e.details.reasonCode,'COUPON_ACCOUNT_LIMIT');}await db.query('ROLLBACK TO SAVEPOINT cap');
 // The returned (not the source) quote is what the existing order route admits; the amount is the discounted canonical total.
 const o=await order(applied.quote.id);
 assert.equal((await db.query('SELECT state FROM coupon167_redemptions WHERE order_id=$1',[o.id])).rows[0].state,'BOUND');
 assert.equal(String((await db.query('SELECT total_minor FROM order_authority WHERE order_id=$1',[o.id])).rows[0].total_minor),applied.quote.total.amountMinor);
}));
test('coupon route refusals: platform-funded and zero-payable return configuration errors and leave no hold',integration,async()=>withFixture(async({db,source,quote,policy,rejected})=>{
 const actor=await principal(db,source),branch=source.source_branch_id as string;
 const platform=await policy({funding:5000}),platformCode=await codeOf(db,platform);
 await db.query('SAVEPOINT platform');try{await asApp(db,async()=>food.applyFoodCoupon(db as unknown as pg.PoolClient,actor,branch,await quote(),{code:platformCode,idempotencyKey:randomUUID()}));assert.fail('platform');}catch(e:any){assert.equal(e.status,503);assert.equal(e.code,'CONFIGURATION_REQUIRED');assert.equal(e.message,'COUPON_PLATFORM_FUNDING_REQUIRED');}await db.query('ROLLBACK TO SAVEPOINT platform');
 const campaign=randomUUID(),zero=randomUUID(),zeroCode='Z'+randomUUID().replaceAll('-','').slice(0,20).toUpperCase();
 await db.query("INSERT INTO coupon097_campaigns(id,merchant_id,code,name)VALUES($1,$2,$3,'route zero')",[campaign,source.merchant_id,zeroCode]);
 await db.query("INSERT INTO coupon097_versions(id,merchant_id,campaign_id,revision,price_version_id,discount_kind,basis_points,minimum_food_minor,maximum_discount_minor,global_cap,account_cap,budget_minor,merchant_funding_bps,serving,starts_at,expires_at)VALUES($1,$2,$3,1,$4,'BASIS_POINTS',10000,0,999999999999,5,5,999999999999,10000,ARRAY['pickup'],clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')",[zero,source.merchant_id,campaign,source.price_version_id]);
 await db.query('UPDATE coupon097_campaigns SET active_version_id=$2,enabled=true WHERE id=$1',[campaign,zero]);
 const q=await quote();
 await db.query('SAVEPOINT zero');try{await asApp(db,()=>food.applyFoodCoupon(db as unknown as pg.PoolClient,actor,branch,q,{code:zeroCode,idempotencyKey:randomUUID()}));assert.fail('zero');}catch(e:any){assert.equal(e.status,503);assert.equal(e.code,'CONFIGURATION_REQUIRED');assert.equal(e.message,'COUPON_ZERO_ORDER_REQUIRES_COMPLETION');}await db.query('ROLLBACK TO SAVEPOINT zero');
 assert.equal((await db.query('SELECT count(*)::int n FROM coupon097_holds WHERE quote_id=$1',[q])).rows[0].n,0);
 // Disabled campaign is indistinguishable from unknown.
 await db.query('SAVEPOINT disabled');await db.query('UPDATE coupon097_campaigns SET enabled=false WHERE id=$1',[campaign]);
 await rejected(()=>asApp(db,()=>food.applyFoodCoupon(db as unknown as pg.PoolClient,actor,branch,q,{code:zeroCode,idempotencyKey:randomUUID()})),'COUPON_NOT_FOUND');await db.query('ROLLBACK TO SAVEPOINT disabled');
}));
test('schedule routes: only bookable published slots are listed; holds are server-bound, idempotent and capacity-safe; a coupon quote can also be scheduled',integration,async()=>withFixture(async({db,source,quote,policy,order,rejected})=>{
 const actor=await principal(db,source),branch=source.source_branch_id as string,client=db as unknown as pg.PoolClient;
 const list=(serving='pickup')=>asApp(db,()=>food.branchScheduleSlots(client,actor,branch,serving));
 assert.deepEqual((await list()).slots,[],'no published slot: the app must show the honest disabled state');
 const slotId=await slot(db,source,1),other=await slot(db,source,5,'delivery');
 let slots=await list();assert.equal(slots.slots.length,1);assert.equal(slots.slots[0].id,slotId);assert.equal((await list('delivery')).slots.length,0,'delivery slot is unavailable while branch delivery is off');void other;
 assert.ok(new Date(slots.slots[0].bookingClosesAt)<new Date(slots.slots[0].startsAt));wire.MobileScheduleSlotsSchema.parse(slots);
 // Hold: the response carries the server window, never client supplied times.
 const version=await policy({global:5,account:5}),code=await codeOf(db,version);
 const base=await quote(),applied=await asApp(db,()=>food.applyFoodCoupon(client,actor,branch,base,{code,idempotencyKey:randomUUID()})),q=applied.quote.id,key=randomUUID();
 const hold=await asApp(db,()=>food.holdScheduleSlot(client,actor,q,{slotId,idempotencyKey:key}));
 wire.MobileScheduleHoldSchema.parse(hold);assert.equal(hold.state,'HELD');assert.equal(hold.replayed,false);assert.equal(hold.slotId,slotId);
 const window=(await db.query('SELECT starts_at,ends_at FROM schedule107_windows WHERE id=$1',[slotId])).rows[0];assert.equal(hold.startsAt,new Date(window.starts_at).toISOString());assert.equal(hold.endsAt,new Date(window.ends_at).toISOString());
 const replay=await asApp(db,()=>food.holdScheduleSlot(client,actor,q,{slotId,idempotencyKey:key}));assert.equal(replay.id,hold.id);assert.equal(replay.replayed,true);
 await rejected(()=>asApp(db,()=>food.holdScheduleSlot(client,actor,q,{slotId,idempotencyKey:randomUUID()})),'SCHEDULE_QUOTE_ALREADY_HELD');
 await rejected(()=>asApp(db,()=>food.holdScheduleSlot(client,actor,randomUUID(),{slotId,idempotencyKey:randomUUID()})),'RESOURCE_NOT_FOUND');
 await db.query('SAVEPOINT slotfull');try{await asApp(db,async()=>food.holdScheduleSlot(client,actor,await quote(),{slotId,idempotencyKey:randomUUID()}));assert.fail('full');}catch(e:any){assert.equal(e.status,409);assert.equal(e.code,'QUOTE_CHANGED');assert.equal(e.details.reasonCode,'SCHEDULE_CAPACITY_EXHAUSTED');}await db.query('ROLLBACK TO SAVEPOINT slotfull');
 assert.deepEqual((await list()).slots,[],'a full slot disappears from the published list');
 // Coupon + schedule on one quote: the order admission binds both.
 const o=await order(q);
 assert.equal((await db.query('SELECT state FROM coupon167_redemptions WHERE order_id=$1',[o.id])).rows[0].state,'BOUND');
 const booking=(await db.query('SELECT state,slot_id FROM schedule168_bookings WHERE order_id=$1',[o.id])).rows[0];assert.equal(booking.state,'BOUND');assert.equal(booking.slot_id,slotId);
 // A closed slot cannot be held.
 const closed=await slot(db,source,1,'pickup',1);await db.query('UPDATE schedule107_windows SET enabled=false WHERE id=$1',[closed]);
 await rejected(()=>asApp(db,async()=>food.holdScheduleSlot(client,actor,await quote(),{slotId:closed,idempotencyKey:randomUUID()})),'SCHEDULE_SLOT_UNAVAILABLE');
 // The application role cannot call the private 107/098 functions or read windows directly.
 await db.query('SAVEPOINT direct');await db.query('SET LOCAL ROLE bitpos_app');await assert.rejects(db.query('SELECT bitpos.schedule107_hold($1,$2,$3)',[slotId,q,randomUUID()]),/permission denied/);await db.query('ROLLBACK TO SAVEPOINT direct');
 await db.query('SAVEPOINT direct2');await db.query('SET LOCAL ROLE bitpos_app');await assert.rejects(db.query('SELECT * FROM schedule107_windows'),/permission denied/);await db.query('ROLLBACK TO SAVEPOINT direct2');
}));
