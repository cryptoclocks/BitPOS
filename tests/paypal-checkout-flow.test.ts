// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Integration tests (plan/05 I-01…I-12) for the customer PayPal checkout on real bills in the disposable PostgreSQL.
// PayPal is a scripted in-memory sandbox that behaves like the real one recorded in phase0-spike.md: create → payer
// action required; approve; capture returns the single capture; replays return it again; unknown outcomes are possible.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type {AddressInfo} from 'node:net';
import {PayPalError} from '../apps/api/src/paypal/config';
import {config,setupPayPalShop as setup} from './paypal-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
test('I-01/I-02: status → create (replays return the same PayPal order) → approve → capture → PAID once',integration,async()=>{
 const {pp,checkout,bill,state}=await setup();const b=await bill(2);
 const st=await checkout.paypalStatus(b.access_token);
 assert.equal(st.enabled,true);assert.equal(st.clientId,config.clientId);assert.deepEqual(st.amount,{currency:'USD',value:'5.40'});assert.equal(st.checkout.status,'none');
 const c1=await checkout.createPayPalOrder(b.access_token);const c2=await checkout.createPayPalOrder(b.access_token);
 assert.equal(c1.status,'awaiting_approval');assert.equal(c2.paypalOrderId,c1.paypalOrderId);assert.equal(pp.calls.filter(x=>x==='create').length,1,'second call returns the live checkout without calling PayPal');
 const early=await checkout.capturePayPalOrder(b.access_token,c1.paypalOrderId!);
 assert.equal(early.status,'awaiting_approval','capture before approval is not an error and moves no money');
 pp.approve(c1.paypalOrderId!);
 const paid=await checkout.capturePayPalOrder(b.access_token,c1.paypalOrderId!);
 assert.equal(paid.status,'paid');assert.ok(paid.captureId);
 assert.deepEqual(await state(b.id),{order:'PAID',stock:{stock:8,reserved:0},checkouts:['CAPTURED'],settlements:1});
 const again=await checkout.capturePayPalOrder(b.access_token,c1.paypalOrderId!);assert.equal(again.status,'paid');
 assert.equal((await checkout.createPayPalOrder(b.access_token)).status,'paid','a paid bill never gets a second PayPal order');
 assert.equal((await state(b.id)).settlements,1);
});

test('I-03: a PayPal order id from another bill or unknown is refused',integration,async()=>{
 const {pp,checkout,bill}=await setup();const a=await bill(1);const ca=await checkout.createPayPalOrder(a.access_token);pp.approve(ca.paypalOrderId!);
 await checkout.capturePayPalOrder(a.access_token,ca.paypalOrderId!);
 const s2=await setup();const b=await s2.bill(1);
 await assert.rejects(s2.checkout.capturePayPalOrder(b.access_token,ca.paypalOrderId!),(e:Error&{status?:number})=>e.message==='RESOURCE_NOT_FOUND'&&e.status===404);
 await assert.rejects(s2.checkout.capturePayPalOrder(b.access_token,'NOSUCHORDER000001'),/RESOURCE_NOT_FOUND/);
 void pp;
});

test('I-04: capture outcome unknown keeps the bill protected; the next attempt reuses the request id and settles once',integration,async()=>{
 const {f,pp,checkout,bill,state}=await setup();const b=await bill(1);const c=await checkout.createPayPalOrder(b.access_token);pp.approve(c.paypalOrderId!);
 pp.fail.capture='after';// PayPal captured, but the response was lost
 const lost=await checkout.capturePayPalOrder(b.access_token,c.paypalOrderId!);
 assert.equal(lost.status,'checking');assert.deepEqual((await state(b.id)).checkouts,['UNKNOWN']);
 const safe=await f.tenant(f.merchant,async db=>(await db.query('SELECT bitpos.unpaid_order_safe($1,$2) AS s',[f.merchant,b.id])).rows[0].s);assert.equal(safe,false,'expiry must not release it');
 const k=await f.tenant(f.merchant,async db=>(await db.query('SELECT id FROM paypal_checkouts WHERE order_id=$1',[b.id])).rows[0].id);
 const r=await checkout.advanceCheckout(f.merchant,k,'lookup',{config,client:pp.client});
 assert.equal(r.k.status,'CAPTURED');assert.equal(r.order.status,'PAID');assert.equal((await state(b.id)).settlements,1);
});

test('I-07/I-08: declined instrument and cancel leave the bill payable with the same PayPal order',integration,async()=>{
 const {pp,checkout,bill,state}=await setup();const b=await bill(1);const c=await checkout.createPayPalOrder(b.access_token);
 assert.equal((await checkout.cancelPayPalOrder(b.access_token,c.paypalOrderId!)).status,'awaiting_approval');
 pp.approve(c.paypalOrderId!);pp.fail.capture=new PayPalError('REJECTED','INSTRUMENT_DECLINED','dbg',422);
 const declined=await checkout.capturePayPalOrder(b.access_token,c.paypalOrderId!);
 assert.equal(declined.status,'declined');assert.equal(declined.issue,'INSTRUMENT_DECLINED');assert.deepEqual((await state(b.id)).checkouts,['CREATED']);
 assert.equal((await checkout.createPayPalOrder(b.access_token)).paypalOrderId,c.paypalOrderId,'retry uses the same PayPal order');
 assert.equal((await checkout.capturePayPalOrder(b.access_token,c.paypalOrderId!)).status,'paid');
});

test('I-09: a bill that can no longer be paid is never captured (no money moves)',integration,async()=>{
 const {f,pp,checkout,bill,state}=await setup();const b=await bill(1);const c=await checkout.createPayPalOrder(b.access_token);pp.approve(c.paypalOrderId!);
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 await admin.query("ALTER TABLE bitpos.paypal_checkouts DISABLE TRIGGER paypal_checkout_guard");
 try{await admin.query("UPDATE bitpos.paypal_checkouts SET expires_at=created_at+interval '1 second' WHERE order_id=$1",[b.id]);}finally{await admin.query("ALTER TABLE bitpos.paypal_checkouts ENABLE TRIGGER paypal_checkout_guard");await admin.end();}
 const before=pp.calls.filter(x=>x==='capture').length;
 assert.equal((await checkout.capturePayPalOrder(b.access_token,c.paypalOrderId!)).status,'expired');
 assert.equal(pp.calls.filter(x=>x==='capture').length,before,'no capture call');assert.deepEqual((await state(b.id)).checkouts,['EXPIRED']);void f;
});

test('I-11: a PayPal answer that does not match the bill (amount or payee) is MISMATCH, never paid',integration,async()=>{
 const {pp,checkout,bill,state}=await setup();const b=await bill(1);const c=await checkout.createPayPalOrder(b.access_token);pp.approve(c.paypalOrderId!);
 pp.tamper(c.paypalOrderId!,o=>{o.value=o.value-1n;});
 assert.equal((await checkout.capturePayPalOrder(b.access_token,c.paypalOrderId!)).status,'mismatch');
 const s=await state(b.id);assert.equal(s.order,'AWAITING_WALLET');assert.deepEqual(s.checkouts,['MISMATCH']);assert.equal(s.settlements,0);
});

test('I-12: Solana and PayPal never both start; create refuses while a Solana attempt is live; HTTP route round-trip',integration,async()=>{
 const {f,pp,checkout,bill}=await setup();const b=await bill(1);
 const {fixturePaymentAttempt}=await import('./backend-payment-fixture');const {randomUUID}=await import('node:crypto');
 await f.tenant(f.merchant,db=>fixturePaymentAttempt(db,{merchant:f.merchant,order:b.id,status:'SUBMITTED',signature:randomUUID(),reference:randomUUID()}));
 await assert.rejects(checkout.createPayPalOrder(b.access_token),/PAYMENT_PENDING/);
 const s2=await setup();const b2=await s2.bill(1);
 const {server}=await import('../apps/api/src/index');await new Promise<void>(r=>server.listen(0,'127.0.0.1',()=>r()));
 try{
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/pay/${b2.access_token}/paypal`;
  assert.equal((await (await fetch(base)).json()).enabled,true);
  const created=await (await fetch(base+'/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();assert.equal(created.status,'awaiting_approval');
  assert.equal((await fetch(base+'/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"amount":"0.01"}'})).status,422,'the browser cannot send an amount');
  assert.equal((await fetch(base+'/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"paypalOrderId":"../x"}'})).status,422);
  s2.pp.approve(created.paypalOrderId);
  const paid=await (await fetch(base+'/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paypalOrderId:created.paypalOrderId})})).json();assert.equal(paid.status,'paid');
  assert.equal((await fetch(base+'?x=1')).status,404);
 }finally{await new Promise(r=>server.close(r));}
 void pp;
});
