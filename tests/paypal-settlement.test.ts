// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Integration tests (plan/05 D-01…D-13) for the PayPal ledger, the two-channel mutex and atomic settlement on a real
// PostgreSQL (BITPOS_BACKEND_INTEGRATION=1, disposable fixture). PayPal itself is not called: verdicts are built from
// the capture shape recorded on the real sandbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {tableFixture} from './backend-table-fixture';
import {fixturePaymentAttempt} from './backend-payment-fixture';
import type {PayPalCapture} from '../apps/api/src/paypal/client';
import type {Verdict} from '../apps/api/src/paypal/verify';
import type {CheckoutRow} from '../apps/api/src/paypal/settle';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const PAYEE='7W75A4XNV2GZ4';
let n=0;const captureId=()=>'CAP'+String(Date.now()).slice(-9)+String(++n).padStart(4,'0');
const paypalOrderId=()=>'ORD'+String(Date.now()).slice(-9)+String(++n).padStart(4,'0');
function capture(over:Partial<PayPalCapture>={},cents=540n):PayPalCapture{
 return {id:captureId(),status:'COMPLETED',reason:null,currency:'USD',valueCents:cents,finalCapture:true,customId:null,invoiceId:null,grossCents:cents,feeCents:62n,netCents:cents-62n,createTime:'2026-10-31T09:04:32Z',...over};
}
const completed=(c:PayPalCapture):Verdict=>({state:'COMPLETED',capture:c});

async function setup(stock=10){
 const f=await tableFixture(stock);
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 await admin.query("INSERT INTO bitpos.paypal_merchant_settings(merchant_id,enabled,payee_merchant_id,updated_by) VALUES($1,true,$2,'test')",[f.merchant,PAYEE]);
 await admin.end();
 const {applyVerdict}=await import('../apps/api/src/paypal/settle');
 /** Creates a routed order for `qty` and a CREATED PayPal checkout for its canonical total (USD 2-decimal catalog = cents). */
 async function order(qty=2,expiresInMs=10*60_000){
  const created=await f.create(await f.quote(qty));const orderId=created.order.id;
  const k=await f.tenant(f.merchant,async db=>{
   const a=(await db.query('SELECT quote_id,total_minor::text,catalog_decimals FROM order_authority WHERE merchant_id=$1 AND order_id=$2',[f.merchant,orderId])).rows[0];
   assert.equal(a.catalog_decimals,2);
   const o=(await db.query('SELECT version FROM orders WHERE merchant_id=$1 AND id=$2',[f.merchant,orderId])).rows[0];
   const id=randomUUID();
   return (await db.query<CheckoutRow>(`INSERT INTO paypal_checkouts(merchant_id,id,order_id,quote_id,order_version,amount_cents,payee_merchant_id,invoice_id,paypal_order_id,status,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'CREATED',clock_timestamp()+($10||' milliseconds')::interval) RETURNING *`,
    [f.merchant,id,orderId,a.quote_id,o.version,a.total_minor,PAYEE,'BP'+id.replaceAll('-',''),paypalOrderId(),String(expiresInMs)])).rows[0];
  });
  return {orderId,k,amount:BigInt(k.amount_cents)};
 }
 const lock=(db:pg.PoolClient,k:CheckoutRow)=>db.query<CheckoutRow>('SELECT * FROM paypal_checkouts WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[k.merchant_id,k.id]).then(r=>r.rows[0]);
 async function apply(k:CheckoutRow,v:Verdict,via:'capture_response'|'order_lookup'|'capture_lookup'='capture_response'){
  return f.tenant(f.merchant,async db=>{await db.query('SELECT 1 FROM orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[k.merchant_id,k.order_id]);return applyVerdict(db,await lock(db,k),v,via,'dbg-test');});
 }
 async function state(orderId:string){
  return f.tenant(f.merchant,async db=>({
   order:(await db.query('SELECT status,version,reservation_released,paid_at IS NOT NULL AS paid FROM orders WHERE merchant_id=$1 AND id=$2',[f.merchant,orderId])).rows[0],
   product:(await db.query('SELECT stock,reserved FROM products WHERE merchant_id=$1 AND id=$2',[f.merchant,f.product])).rows[0],
   checkouts:(await db.query('SELECT status FROM paypal_checkouts WHERE merchant_id=$1 AND order_id=$2 ORDER BY created_at',[f.merchant,orderId])).rows.map(r=>r.status),
   settlements:(await db.query('SELECT state,recovery_reason,amount_cents::text FROM paypal_settlements WHERE merchant_id=$1 AND order_id=$2 ORDER BY created_at',[f.merchant,orderId])).rows,
   effects:Number((await db.query('SELECT count(*) FROM device_sound_effects WHERE merchant_id=$1 AND order_id=$2',[f.merchant,orderId])).rows[0].count),
   events:Number((await db.query('SELECT count(*) FROM outbox_events WHERE merchant_id=$1 AND order_id=$2',[f.merchant,orderId])).rows[0].count)
  }));
 }
 return {f,order,apply,state,lock};
}

test('D-01/D-02: a verified capture settles once — PAID, stock and reservation, sound, outbox — and every replay is a no-op',integration,async()=>{
 const s=await setup(10);const {orderId,k,amount}=await s.order(2);
 const before=await s.state(orderId);assert.equal(before.order.status,'AWAITING_WALLET');assert.deepEqual(before.product,{stock:10,reserved:2});
 const c=capture({},amount);
 assert.deepEqual(await s.apply(k,completed(c)),{outcome:'PAID',captureId:c.id});
 const after=await s.state(orderId);
 assert.deepEqual(after.order,{status:'PAID',version:before.order.version+1,reservation_released:true,paid:true});
 assert.deepEqual(after.product,{stock:8,reserved:0});assert.deepEqual(after.checkouts,['CAPTURED']);
 assert.deepEqual(after.settlements,[{state:'SETTLED',recovery_reason:null,amount_cents:String(amount)}]);
 assert.equal(after.effects,1);assert.ok(after.events>before.events,'paid order published to the outbox');
 for(const via of ['capture_response','order_lookup','capture_lookup'] as const)assert.deepEqual(await s.apply(k,completed(c),via),{outcome:'ALREADY_SETTLED',captureId:c.id});
 assert.deepEqual(await s.state(orderId),after,'callback, webhook and worker replays change nothing');
});

test('D-03: two concurrent settlements of the same capture produce one settlement',integration,async()=>{
 const s=await setup(10);const {orderId,k,amount}=await s.order(1);const c=capture({},amount);
 const results=await Promise.all([s.apply(k,completed(c)),s.apply(k,completed(c))]);
 assert.deepEqual(results.map(r=>r.outcome).sort(),['ALREADY_SETTLED','PAID']);
 const after=await s.state(orderId);assert.equal(after.settlements.length,1);assert.deepEqual(after.product,{stock:9,reserved:0});assert.equal(after.effects,1);
});

test('D-04: a second real payment for an already paid order is kept as RECOVERY, never dropped and never double-counted',integration,async()=>{
 const s=await setup(10);const {orderId,k,amount}=await s.order(1);
 await s.apply(k,completed(capture({},amount)));
 const second=await s.f.tenant(s.f.merchant,async db=>{const id=randomUUID();return (await db.query<CheckoutRow>(`INSERT INTO paypal_checkouts(merchant_id,id,order_id,quote_id,order_version,amount_cents,payee_merchant_id,invoice_id,paypal_order_id,status,expires_at)
  SELECT merchant_id,$2,order_id,quote_id,order_version,amount_cents,payee_merchant_id,$3,$4,'CREATED',expires_at FROM paypal_checkouts WHERE merchant_id=$1 AND id=$5 RETURNING *`,[s.f.merchant,id,'BP'+id.replaceAll('-',''),paypalOrderId(),k.id])).rows[0];});
 assert.equal((await s.apply(second,completed(capture({},amount)))).outcome,'RECOVERY');
 const after=await s.state(orderId);
 assert.deepEqual(after.settlements.map(x=>[x.state,x.recovery_reason]),[['SETTLED',null],['RECOVERY','ALREADY_PAID']]);
 assert.deepEqual(after.product,{stock:9,reserved:0},'stock moved once');assert.equal(after.order.status,'RECOVERY','merchant must review a double payment');
});

test('D-05: a capture that completes after the checkout expired is RECOVERY: reservation released, stock not taken',integration,async()=>{
 const s=await setup(10);const {orderId,k,amount}=await s.order(3,300);
 await new Promise(r=>setTimeout(r,400));
 assert.equal((await s.apply(k,completed(capture({},amount)))).outcome,'RECOVERY');
 const after=await s.state(orderId);
 assert.deepEqual(after.settlements.map(x=>x.recovery_reason),['LATE']);assert.deepEqual(after.product,{stock:10,reserved:0});assert.equal(after.effects,0,'no paid sound for recovery');
});

test('D-06/D-13: tenant fences — wrong tenant context fails, other tenants cannot see PayPal rows',integration,async()=>{
 const s=await setup(5);const {orderId,k,amount}=await s.order(1);
 const c=capture({},amount);await s.apply(k,{state:'PENDING',capture:{...c,status:'PENDING',reason:'PENDING_REVIEW'}});
 await assert.rejects(s.f.tenant(s.f.other,db=>db.query('SELECT * FROM bitpos.paypal_settle_capture($1,$2,$3,$4)',[s.f.merchant,orderId,k.id,c.id])),/TENANT_CONTEXT_MISMATCH/);
 const seen=await s.f.tenant(s.f.other,async db=>[(await db.query('SELECT count(*) FROM paypal_checkouts')).rows[0].count,(await db.query('SELECT count(*) FROM paypal_captures')).rows[0].count,(await db.query('SELECT count(*) FROM paypal_merchant_settings')).rows[0].count]);
 assert.deepEqual(seen,['0','0','0']);
});

test('D-07/D-08: one payment channel per order — a live PayPal checkout blocks new Solana attempts',integration,async()=>{
 const s=await setup(5);const {orderId,k}=await s.order(1);
 await assert.rejects(s.f.tenant(s.f.merchant,db=>fixturePaymentAttempt(db,{merchant:s.f.merchant,order:orderId,status:'BUILDING',reference:randomUUID()})),/PAYMENT_PENDING/);
 await s.f.tenant(s.f.merchant,db=>db.query("UPDATE paypal_checkouts SET status='EXPIRED' WHERE merchant_id=$1 AND id=$2",[s.f.merchant,k.id]));
 await s.f.tenant(s.f.merchant,db=>fixturePaymentAttempt(db,{merchant:s.f.merchant,order:orderId,status:'BUILDING',reference:randomUUID()}));
 const t=await setup(5);const solana=await t.order(1);
 await t.f.tenant(t.f.merchant,db=>db.query("UPDATE paypal_checkouts SET status='EXPIRED' WHERE merchant_id=$1 AND id=$2",[t.f.merchant,solana.k.id]));
 await t.f.tenant(t.f.merchant,db=>fixturePaymentAttempt(db,{merchant:t.f.merchant,order:solana.orderId,status:'SUBMITTED',signature:randomUUID(),reference:randomUUID()}));
 const safe=await t.f.tenant(t.f.merchant,async db=>(await db.query('SELECT bitpos.unpaid_order_safe($1,$2) AS safe',[t.f.merchant,solana.orderId])).rows[0].safe);
 assert.equal(safe,false,'a submitted Solana attempt still protects the order (pre-existing rule kept)');
});

test('D-09/D-10 + guards: one live checkout per order, one checkout per capture, immutable money, terminal states stay terminal',integration,async()=>{
 const s=await setup(5);const {k,amount}=await s.order(1);
 const dup=s.f.tenant(s.f.merchant,db=>{const id=randomUUID();return db.query(`INSERT INTO paypal_checkouts(merchant_id,id,order_id,quote_id,order_version,amount_cents,payee_merchant_id,invoice_id,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'CREATING',clock_timestamp()+interval '5 minutes')`,[s.f.merchant,id,k.order_id,k.quote_id,k.order_version,k.amount_cents,PAYEE,'BP'+id.replaceAll('-','')]);});
 await assert.rejects(dup,/paypal_one_live_checkout/);
 await assert.rejects(s.f.tenant(s.f.merchant,db=>db.query('UPDATE paypal_checkouts SET amount_cents=amount_cents-1 WHERE merchant_id=$1 AND id=$2',[s.f.merchant,k.id])),/PAYPAL_CHECKOUT_IMMUTABLE/);
 await assert.rejects(s.f.tenant(s.f.merchant,db=>db.query("UPDATE paypal_checkouts SET invoice_id='BP00000000000000000000000000000000' WHERE merchant_id=$1 AND id=$2",[s.f.merchant,k.id])),/IMMUTABLE|paypal_checkouts_check/);
 const c=capture({},amount);await s.apply(k,completed(c));
 await assert.rejects(s.f.tenant(s.f.merchant,db=>db.query("UPDATE paypal_checkouts SET status='CREATED' WHERE merchant_id=$1 AND id=$2",[s.f.merchant,k.id])),/PAYPAL_CHECKOUT_TERMINAL/);
 const t=await setup(5);const other=await t.order(1);
 await assert.rejects(t.apply(other.k,completed({...c})),/duplicate key|unique/i,'a capture id belongs to exactly one checkout, across tenants too');
});

test('D-11: mismatch evidence blocks settlement; the SQL routine refuses unverified or wrong-amount captures',integration,async()=>{
 const s=await setup(5);const {orderId,k,amount}=await s.order(1);
 const bad=capture({},amount+1n);
 assert.equal((await s.apply(k,{state:'MISMATCH',reasons:['CAPTURE_AMOUNT','GROSS_AMOUNT'],capture:bad})).outcome,'MISMATCH');
 const after=await s.state(orderId);assert.deepEqual(after.checkouts,['MISMATCH']);assert.equal(after.order.status,'AWAITING_WALLET');assert.equal(after.settlements.length,0);
 await assert.rejects(s.f.tenant(s.f.merchant,db=>db.query('SELECT * FROM bitpos.paypal_settle_capture($1,$2,$3,$4)',[s.f.merchant,orderId,k.id,bad.id])),/PAYMENT_QUOTE_MISMATCH/);
 const t=await setup(5);const second=await t.order(1);const wrong=capture({},second.amount);
 await t.apply(second.k,{state:'PENDING',capture:{...wrong,status:'PENDING'}});
 await t.f.tenant(t.f.merchant,db=>db.query("UPDATE paypal_captures SET gross_cents=gross_cents+1 WHERE merchant_id=$1 AND capture_id=$2",[t.f.merchant,wrong.id]));
 await assert.rejects(t.apply(second.k,completed(wrong)),/PAYMENT_QUOTE_MISMATCH/,'stored gross must equal the checkout amount');
});

test('D-12: PENDING then COMPLETED settles once; an order with a capture in flight is not safe to expire',integration,async()=>{
 const s=await setup(5);const {orderId,k,amount}=await s.order(1);
 const safe=()=>s.f.tenant(s.f.merchant,async db=>(await db.query('SELECT bitpos.unpaid_order_safe($1,$2) AS safe',[s.f.merchant,orderId])).rows[0].safe);
 assert.equal(await safe(),true,'CREATED checkout: nothing moved yet');
 await s.f.tenant(s.f.merchant,db=>db.query("UPDATE paypal_checkouts SET status='CAPTURING',capture_started_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2",[s.f.merchant,k.id]));
 assert.equal(await safe(),false,'capture sent: expiry must wait for reconcile');
 const c=capture({status:'PENDING',reason:'PENDING_REVIEW',finalCapture:false},amount);
 assert.equal((await s.apply(k,{state:'PENDING',capture:c})).outcome,'PENDING');
 assert.equal(await safe(),false);assert.deepEqual((await s.state(orderId)).checkouts,['PENDING']);
 assert.equal((await s.apply(k,completed({...c,status:'COMPLETED',reason:null,finalCapture:true}),'capture_lookup')).outcome,'PAID');
 const after=await s.state(orderId);assert.equal(after.order.status,'PAID');assert.equal(after.settlements.length,1);
 const row=await s.f.tenant(s.f.merchant,async db=>(await db.query('SELECT status,verified,verified_via,redacted FROM paypal_captures WHERE merchant_id=$1 AND capture_id=$2',[s.f.merchant,c.id])).rows[0]);
 assert.equal(row.status,'COMPLETED');assert.equal(row.verified,true);assert.equal(row.verified_via,'capture_response','first verification is kept');
 assert.equal(JSON.stringify(row.redacted).includes('payer'),false,'no payer identity stored');
});
