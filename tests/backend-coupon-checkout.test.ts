import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type pg from 'pg';
import {fixturePaymentAttempt} from './backend-payment-fixture';
// DS41 / WP3b: coupon quote -> order -> payment -> release/refund, DB-backed.
// Every test runs in one rolled-back transaction on the disposable fixture
// database. Payment facts are SQL-only verifier seams (no chain, no wallet).
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
import {withFixture,type Q} from './backend-online-quote-fixture';
const redemption=async(db:pg.Client,orderId:string)=>(await db.query('SELECT * FROM coupon167_redemptions WHERE order_id=$1',[orderId])).rows[0] as Q|undefined;
const holdRow=async(db:pg.Client,id:string)=>(await db.query('SELECT * FROM coupon097_holds WHERE id=$1',[id])).rows[0] as Q;

test('coupon quote is admitted to checkout with the discounted canonical total, pays only that amount and is consumed once',integration,async()=>withFixture(async({db,source,quote,policy,apply,order,rejected,modules})=>{
 const version=await policy({global:5,account:1}),base=await quote(),applied=await apply(base,version);
 const replacement=(await db.query('SELECT * FROM order_quotes WHERE id=$1',[applied.quote.id])).rows[0];
 assert.equal(BigInt(replacement.total_minor),BigInt(source.total_minor)-1n);
 const o=await order(applied.quote.id);
 const authority=(await db.query('SELECT total_minor,settlement FROM order_authority WHERE order_id=$1',[o.id])).rows[0];
 assert.equal(BigInt(authority.total_minor),BigInt(replacement.total_minor));assert.equal(authority.settlement.amountMinor,replacement.usdg_minor);
 assert.equal(String(o.usdg_minor),String(replacement.usdg_minor));
 const bound=await redemption(db,o.id);assert.ok(bound);assert.equal(bound.state,'BOUND');assert.equal(bound.discount_minor,'1');assert.equal(bound.platform_minor,'0');assert.equal(bound.payable_minor,replacement.total_minor);
 // The same coupon quote cannot back a second order, and the account cap (1) blocks another hold.
 await rejected(()=>order(applied.quote.id),'COUPON_ALREADY_REDEEMED');
 const second=await quote();await rejected(()=>apply(second,version),'COUPON_ACCOUNT_LIMIT');
 // Payment is bound to the discounted quote amount; a wrong amount is refused by the canonical attempt guard.
 await rejected(()=>fixturePaymentAttempt(db,{merchant:source.merchant_id,order:o.id,status:'SUBMITTED',signature:'ds41-wrong-'+randomUUID(),amount:String(BigInt(replacement.usdg_minor)+1n)}),'');
 const attempt=(await fixturePaymentAttempt(db,{merchant:source.merchant_id,order:o.id,status:'SUBMITTED',signature:'ds41-sig-'+randomUUID()})).rows[0];
 assert.equal(String(attempt.amount_minor),replacement.usdg_minor);
 assert.equal((await redemption(db,o.id))!.state,'BOUND','not consumed before the verifier settles');
 await modules.settleAttempt(db,attempt,true);await modules.settleAttempt(db,attempt,true);
 const paid=(await db.query('SELECT status FROM orders WHERE id=$1',[o.id])).rows[0];assert.equal(paid.status,'PAID');
 const consumed=await redemption(db,o.id);assert.equal(consumed!.state,'CONSUMED');assert.equal(consumed!.version,'2','duplicate settlement did not re-apply the effect');
 assert.equal((await db.query('SELECT count(*)::int n FROM payments WHERE order_id=$1',[o.id])).rows[0].n,1);
 assert.equal((await holdRow(db,bound.hold_id)).state,'HELD','consumed hold keeps counting against the quota');
 // Quota is still consumed after payment.
 await rejected(()=>apply(second,version),'COUPON_ACCOUNT_LIMIT');
 // Redemption rows are immutable evidence apart from the one-way state move.
 await rejected(()=>db.query("UPDATE coupon167_redemptions SET discount_minor=2 WHERE order_id=$1",[o.id]),'COUPON_REDEMPTION_IMMUTABLE');
 await rejected(()=>db.query("UPDATE coupon167_redemptions SET state='RELEASED',version=version+1 WHERE order_id=$1",[o.id]),'COUPON_REDEMPTION_IMMUTABLE');
 await rejected(()=>db.query('DELETE FROM coupon167_redemptions WHERE order_id=$1',[o.id]),'immutable authority record');
 // The application role cannot read or write redemptions directly.
 await db.query('SAVEPOINT role');await db.query('SET LOCAL ROLE bitpos_app');await assert.rejects(db.query('SELECT * FROM coupon167_redemptions'),/permission denied/);await db.query('ROLLBACK TO SAVEPOINT role');
}));

test('checkout refuses stale, released, other-account, platform-funded and non-coupon-bound coupon quotes with no order or redemption',integration,async()=>withFixture(async({db,source,quote,policy,apply,order,rejected})=>{
 const version=await policy(),applied=await apply(await quote(),version);
 const count=async()=>(await db.query('SELECT (SELECT count(*) FROM coupon167_redemptions)::int r,(SELECT count(*) FROM orders)::int o')).rows[0];const before=await count();
 // Released hold -> HOLD_UNAVAILABLE.
 await db.query('SAVEPOINT released');await db.query('SELECT coupon097_release($1,$2::jsonb)',[applied.holdId,JSON.stringify({commandId:randomUUID(),expectedVersion:'1'})]);
 await rejected(()=>order(applied.quote.id),'COUPON_HOLD_UNAVAILABLE');await db.query('ROLLBACK TO SAVEPOINT released');
 // Hold lease expired in the past -> HOLD_UNAVAILABLE (clock moved by editing the lease via admin, as a worker would observe).
 await db.query('SAVEPOINT expired');await db.query('ALTER TABLE coupon097_holds DISABLE TRIGGER coupon097_hold_guard');await db.query("UPDATE coupon097_holds SET expires_at=clock_timestamp()-interval '1 second',created_at=clock_timestamp()-interval '2 seconds' WHERE id=$1",[applied.holdId]);await db.query('ALTER TABLE coupon097_holds ENABLE TRIGGER coupon097_hold_guard');
 await rejected(()=>order(applied.quote.id),'COUPON_HOLD_UNAVAILABLE');await db.query('ROLLBACK TO SAVEPOINT expired');
 // Pricing revision moved since the quote -> QUOTE_CHANGED (live re-validation, not stored snapshot).
 await db.query('SAVEPOINT revision');await db.query('UPDATE merchant_pricing SET revision=revision+1 WHERE merchant_id=$1',[source.merchant_id]);
 await rejected(()=>order(applied.quote.id),'COUPON_QUOTE_CHANGED');await db.query('ROLLBACK TO SAVEPOINT revision');
 // Another account's session cannot spend this hold.
 await db.query('SAVEPOINT other');const otherAccount=(await db.query('SELECT id FROM mobile_accounts WHERE id<>$1 AND disabled_at IS NULL LIMIT 1',[source.source_account_id])).rows[0];
 if(otherAccount){const s=randomUUID();await db.query("INSERT INTO mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at)VALUES($1,$2,$3,'a','b',clock_timestamp()+interval '10 minutes',clock_timestamp()+interval '10 minutes')",[s,otherAccount.id,randomUUID()]);
  await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true)",[otherAccount.id,s]);await rejected(()=>order(applied.quote.id),'');}
 await db.query('ROLLBACK TO SAVEPOINT other');
 // Platform-funded coupons stay refused at admission even if a replacement quote existed.
 await db.query('SAVEPOINT platform');await rejected(async()=>{const v=await policy({funding:5000});await apply(await quote(),v);},'COUPON_PLATFORM_FUNDING_REQUIRED');await db.query('ROLLBACK TO SAVEPOINT platform');
 // Missing context (no merchant) cannot reach the gate with a coupon quote.
 await db.query('SAVEPOINT nocontext');await db.query("SELECT set_config('bitpos.merchant','',true)");await rejected(()=>order(applied.quote.id),'');await db.query('ROLLBACK TO SAVEPOINT nocontext');
 assert.deepEqual(await count(),before);
 // After all failures the valid path still works (nothing was half-consumed).
 const o=await order(applied.quote.id);assert.equal((await redemption(db,o.id))!.state,'BOUND');
}));

test('unpaid coupon order closure releases the hold and quota; a closed order stays released and cannot be re-bound',integration,async()=>withFixture(async({db,source,quote,policy,apply,order,rejected})=>{
 const version=await policy({global:5,account:1}),applied=await apply(await quote(),version),o=await order(applied.quote.id);
 const bound=(await redemption(db,o.id))!;
 // Same transition the closure routine performs (status EXPIRED + closure_reason).
 await db.query("UPDATE orders SET status='EXPIRED',closure_reason='canceled',version=version+1 WHERE id=$1",[o.id]);
 const released=(await redemption(db,o.id))!;assert.equal(released.state,'RELEASED');assert.equal((await holdRow(db,bound.hold_id)).state,'RELEASED');
 // Quota freed: a new coupon quote can be held and billed.
 const again=await apply(await quote(),version),o2=await order(again.quote.id);assert.equal((await redemption(db,o2.id))!.state,'BOUND');
 // The released coupon quote can never become a second order.
 await rejected(()=>order(applied.quote.id),'COUPON_HOLD_UNAVAILABLE');
 // A timed-out order without closure keeps the redemption bound (late payment/recovery must still resolve it).
 await db.query("UPDATE orders SET status='EXPIRED',version=version+1 WHERE id=$1",[o2.id]);assert.equal((await redemption(db,o2.id))!.state,'BOUND');
 assert.equal(source.merchant_id,(await redemption(db,o.id))!.merchant_id);
}));

test('refund obligation for a coupon order equals the discounted amount actually paid; refund does not restore coupon quota',integration,async()=>withFixture(async({db,source,quote,policy,apply,order,rejected,modules})=>{
 const version=await policy({global:5,account:1}),applied=await apply(await quote(),version),o=await order(applied.quote.id);
 const attempt=(await fixturePaymentAttempt(db,{merchant:source.merchant_id,order:o.id,status:'SUBMITTED',signature:'ds41-refund-'+randomUUID()})).rows[0];
 await modules.settleAttempt(db,attempt,true);
 const payment=(await db.query('SELECT p.*,a.descriptor,a.settlement,a.payer FROM payments p JOIN payment_attempt_assets a ON a.attempt_id=p.attempt_id WHERE p.order_id=$1',[o.id])).rows[0];
 assert.equal(String(payment.amount_minor),String((await db.query('SELECT usdg_minor FROM order_quotes WHERE id=$1',[applied.quote.id])).rows[0].usdg_minor),'paid amount is the discounted quote amount');
 // Merchant rejects the paid online order: the canonical refund obligation is derived from the received payment.
 await db.query("UPDATE online_food_orders SET acceptance_status='REJECTED',acceptance_version=acceptance_version+1,decision_by=$2,decision_reason='ds41-test' WHERE order_id=$1",[o.id,randomUUID()]);
 await db.query('SELECT ensure_online_decision_refunds($1,$2)',[source.merchant_id,o.id]);await db.query('SELECT ensure_online_decision_refunds($1,$2)',[source.merchant_id,o.id]);
 const refund=await db.query('SELECT * FROM refunds WHERE order_id=$1',[o.id]);
 assert.equal(refund.rowCount,1,'repeat ensure is idempotent');assert.equal(String(refund.rows[0].amount_minor),String(payment.amount_minor));
 // Refunding more than was paid (the undiscounted price) is refused by the obligation guard.
 await rejected(()=>db.query(`INSERT INTO refunds(merchant_id,order_id,payment_id,amount_minor,asset_descriptor,settlement,beneficiary,cause)VALUES($1,$2,$3,$4,$5,$6,$7,'ONLINE_ACCEPTANCE_REJECTED')`,[source.merchant_id,o.id,randomUUID(),String(BigInt(payment.amount_minor)+1n),payment.descriptor,payment.settlement,payment.payer]),'');
 // Coupon stays consumed (no automatic quota restore); the platform did not fund any part of it.
 const kept=(await redemption(db,o.id))!;assert.equal(kept.state,'CONSUMED');assert.equal(kept.platform_minor,'0');
 const next=await quote();await rejected(()=>apply(next,version),'COUPON_ACCOUNT_LIMIT');
}));

test('zero-payable coupon orders stay refused (no payment-free completion path exists)',integration,async()=>withFixture(async({db,source,quote,policy,rejected})=>{
 const campaign=randomUUID(),version=randomUUID();
 await db.query("INSERT INTO coupon097_campaigns(id,merchant_id,code,name)VALUES($1,$2,$3,'DS41 zero')",[campaign,source.merchant_id,'Z'+randomUUID().replaceAll('-','').slice(0,20).toUpperCase()]);
 await db.query("INSERT INTO coupon097_versions(id,merchant_id,campaign_id,revision,price_version_id,discount_kind,basis_points,minimum_food_minor,maximum_discount_minor,global_cap,account_cap,budget_minor,merchant_funding_bps,serving,starts_at,expires_at)VALUES($1,$2,$3,1,$4,'BASIS_POINTS',10000,0,999999999999,5,5,999999999999,10000,ARRAY['pickup'],clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')",[version,source.merchant_id,campaign,source.price_version_id]);
 await db.query('UPDATE coupon097_campaigns SET active_version_id=$2,enabled=true WHERE id=$1',[campaign,version]);
 const {prepareCouponQuoteCandidate}=await import('../apps/api/src/coupon-quote-candidate');
 const base=await quote();await db.query('SET CONSTRAINTS ALL DEFERRED');
 await rejected(()=>prepareCouponQuoteCandidate(db,source.merchant_id,base,version,randomUUID()),'COUPON_ZERO_ORDER_REQUIRES_COMPLETION');
 void policy;
}));
