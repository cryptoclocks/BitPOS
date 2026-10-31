// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Integration tests (plan/05 I-04…I-13, D-WH) for the PayPal webhook inbox and the reconcile worker on the disposable
// PostgreSQL. Events are signed with a throwaway certificate exactly like PayPal's offline-verification scheme and sent
// through the real API server; PayPal itself is the shared in-memory sandbox fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSign,randomUUID} from 'node:crypto';
import {crc32} from 'node:zlib';
import type {AddressInfo} from 'node:net';
import pg from 'pg';
import {PayPalError} from '../apps/api/src/paypal/config';
import {config,setupPayPalShop} from './paypal-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const WEBHOOK_ID='8PT597110X687430LKGECATA';
const CERT_URL='https://api.sandbox.paypal.com/v1/notifications/certs/CERT-test';
const dir=mkdtempSync(join(tmpdir(),'paypal-wh-flow-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'k.pem'),'-out',join(dir,'c.pem'),'-days','2','-subj','/CN=messageverificationcerts.sandbox.paypal.com'],{stdio:'ignore'});
const key=readFileSync(join(dir,'k.pem'),'utf8'),cert=readFileSync(join(dir,'c.pem'),'utf8');rmSync(dir,{recursive:true,force:true});

async function setup(){
 const s=await setupPayPalShop();
 const deps={config:{...config,webhookId:WEBHOOK_ID},client:s.pp.client};s.checkout.setPayPalDeps(deps);
 const wh=await import('../apps/api/src/paypal/webhook');const {webhookVerifier}=await import('../apps/api/src/paypal/webhook-verify');
 wh.setWebhookVerifier(webhookVerifier(async()=>cert));
 const {server}=await import('../apps/api/src/index');
 if(!server.listening)await new Promise<void>(r=>server.listen(0,'127.0.0.1',()=>r()));
 const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/paypal/webhooks`;
 async function send(event:object,tamper=false){
  const body=Buffer.from(JSON.stringify(event));const id=randomUUID(),time=new Date().toISOString();
  const sig=createSign('sha256');sig.update(`${id}|${time}|${WEBHOOK_ID}|${crc32(body)>>>0}`);
  if(tamper)body[body.length-2]^=1;
  return fetch(url,{method:'POST',headers:{'Content-Type':'application/json','paypal-transmission-id':id,'paypal-transmission-time':time,'paypal-cert-url':CERT_URL,'paypal-auth-algo':'SHA256withRSA','paypal-transmission-sig':sig.sign(key,'base64')},body});
 }
 const custom=async(orderId:string)=>s.f.tenant(s.f.merchant,async db=>{const k=(await db.query('SELECT id FROM paypal_checkouts WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1',[orderId])).rows[0];return `bitpos:v1:${s.f.merchant}:${orderId}:${k.id}`;});
 const close=()=>new Promise(r=>server.close(r));
 /** The route also starts processing right after it answers 200; wait until no received event is still in flight. */
 async function drain(){
  const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
  try{for(let i=0;i<100;i++){await wh.processWebhookInbox(deps,50);
   const busy=(await admin.query("SELECT count(*)::int AS n FROM bitpos.paypal_webhook_inbox WHERE processed_at IS NULL AND last_error IS NULL AND received_at>clock_timestamp()-interval '5 minutes'")).rows[0].n;
   if(!busy)return;await new Promise(r=>setTimeout(r,50));}}finally{await admin.end();}
 }
 return {...s,deps,wh,send,custom,close,drain};
}
const event=(type:string,resource:object)=>({id:'WH-'+randomUUID().toUpperCase(),event_type:type,resource_type:type.startsWith('CHECKOUT')?'checkout-order':'capture',resource});

test('W-1/W-2: signed capture event settles a lost capture once; duplicates and bad signatures change nothing',integration,async()=>{
 const s=await setup();
 try{
  const b=await s.bill(1);const c=await s.checkout.createPayPalOrder(b.access_token);s.pp.approve(c.paypalOrderId!);
  s.pp.fail.capture='after';// PayPal captured, our response was lost
  assert.equal((await s.checkout.capturePayPalOrder(b.access_token,c.paypalOrderId!)).status,'checking');
  const e=event('PAYMENT.CAPTURE.COMPLETED',{id:'CAP0000000000001',status:'COMPLETED',custom_id:await s.custom(b.id),amount:{currency_code:'USD',value:'2.70'},supplementary_data:{related_ids:{order_id:c.paypalOrderId}},payer_email:'buyer@example.com'});
  assert.equal((await s.send(e,true)).status,400,'tampered body');
  for(let i=0;i<3;i++)assert.equal((await s.send(e)).status,200);
  await s.drain();
  assert.deepEqual(await s.state(b.id),{order:'PAID',stock:{stock:9,reserved:0},checkouts:['CAPTURED'],settlements:1});
  const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
  const row=(await admin.query('SELECT deliveries,processed_at IS NOT NULL AS done,redacted::text FROM bitpos.paypal_webhook_inbox WHERE event_id=$1',[e.id])).rows[0];await admin.end();
  assert.equal(row.deliveries,3);assert.equal(row.done,true);assert.equal(row.redacted.includes('buyer@example.com'),false,'payer data never stored');
  await assert.rejects(s.f.tenant(s.f.merchant,db=>db.query('SELECT * FROM paypal_webhook_inbox')),/permission denied/,'app role cannot read the inbox directly');
 }finally{await s.close();}
});

test('W-3: buyer approved and closed the page — the APPROVED webhook captures and settles',integration,async()=>{
 const s=await setup();
 try{
  const b=await s.bill(1);const c=await s.checkout.createPayPalOrder(b.access_token);s.pp.approve(c.paypalOrderId!);
  assert.equal((await s.send(event('CHECKOUT.ORDER.APPROVED',{id:c.paypalOrderId,status:'APPROVED',purchase_units:[{custom_id:await s.custom(b.id)}]}))).status,200);
  await s.drain();
  assert.equal((await s.state(b.id)).order,'PAID');
 }finally{await s.close();}
});

test('W-4: worker restart recovery — lost create resends the same request id; lost capture settles; stale CREATED expires',integration,async()=>{
 const s=await setup();const {reconcilePayPalMerchant}=await import('../apps/api/src/paypal/reconcile');
 try{
  const b=await s.bill(1);
  s.pp.fail.create=new PayPalError('OUTCOME_UNKNOWN');
  assert.equal((await s.checkout.createPayPalOrder(b.access_token)).status,'creating');
  await s.f.tenant(s.f.merchant,db=>db.query('UPDATE paypal_checkouts SET next_check_at=NULL WHERE order_id=$1',[b.id]));
  await reconcilePayPalMerchant(s.f.merchant,s.deps);
  const st=await s.checkout.paypalStatus(b.access_token);assert.equal(st.checkout.status,'awaiting_approval');
  s.pp.approve(st.checkout.paypalOrderId!);s.pp.fail.capture='after';
  await s.checkout.capturePayPalOrder(b.access_token,st.checkout.paypalOrderId!);
  await s.f.tenant(s.f.merchant,db=>db.query('UPDATE paypal_checkouts SET next_check_at=NULL WHERE order_id=$1',[b.id]));
  await reconcilePayPalMerchant(s.f.merchant,s.deps);
  assert.deepEqual(await s.state(b.id),{order:'PAID',stock:{stock:9,reserved:0},checkouts:['CAPTURED'],settlements:1});
  assert.equal(s.pp.calls.filter(x=>x==='create').length,2,'create resent once with the same request id (fake returns the same order)');
  const s2=await setup();const b2=await s2.bill(1);await s2.checkout.createPayPalOrder(b2.access_token);
  const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
  await admin.query('ALTER TABLE bitpos.paypal_checkouts DISABLE TRIGGER paypal_checkout_guard');
  try{await admin.query("UPDATE bitpos.paypal_checkouts SET expires_at=created_at+interval '1 millisecond' WHERE order_id=$1",[b2.id]);}finally{await admin.query('ALTER TABLE bitpos.paypal_checkouts ENABLE TRIGGER paypal_checkout_guard');await admin.end();}
  await reconcilePayPalMerchant(s2.f.merchant,s2.deps);
  assert.deepEqual((await s2.state(b2.id)).checkouts,['EXPIRED']);
 }finally{await s.close();}
});

test('W-5: a refund after settlement is its own fact — the bill stays paid, stock and paid display unchanged',integration,async()=>{
 const s=await setup();
 try{
  const b=await s.bill(1);const c=await s.checkout.createPayPalOrder(b.access_token);s.pp.approve(c.paypalOrderId!);
  const paid=await s.checkout.capturePayPalOrder(b.access_token,c.paypalOrderId!);assert.equal(paid.status,'paid');
  const before=await s.state(b.id);
  const refund=event('PAYMENT.CAPTURE.REFUNDED',{id:'REF0000000000001',status:'COMPLETED',custom_id:await s.custom(b.id),amount:{currency_code:'USD',value:'2.70'},links:[{rel:'up',href:`https://api-m.sandbox.paypal.com/v2/payments/captures/${paid.captureId}`}]});
  await s.send(refund);await s.send(refund);await s.drain();
  assert.deepEqual(await s.state(b.id),before);
  const events=await s.f.tenant(s.f.merchant,async db=>(await db.query('SELECT kind,amount_cents::text FROM paypal_payment_events WHERE capture_id=$1',[paid.captureId])).rows);
  assert.deepEqual(events,[{kind:'REFUNDED',amount_cents:'270'}]);
 }finally{await s.close();}
});

test('W-6: unsigned config, foreign events and unknown checkouts are handled without effects',integration,async()=>{
 const s=await setup();
 try{
  s.checkout.setPayPalDeps({config,client:s.pp.client});// no webhook id configured
  assert.equal((await s.send(event('PAYMENT.CAPTURE.COMPLETED',{id:'CAP0000000000009',custom_id:'x'}))).status,503);
  s.checkout.setPayPalDeps(s.deps);
  const foreign=event('PAYMENT.CAPTURE.COMPLETED',{id:'CAP0000000000010',custom_id:'someone-else'});
  assert.equal((await s.send(foreign)).status,200);
  const ghost=event('PAYMENT.CAPTURE.COMPLETED',{id:'CAP0000000000011',custom_id:`bitpos:v1:${s.f.merchant}:${randomUUID()}:${randomUUID()}`});
  assert.equal((await s.send(ghost)).status,200);
  await s.drain();
  const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
  const rows=(await admin.query('SELECT event_id,processed_at IS NOT NULL AS done,last_error FROM bitpos.paypal_webhook_inbox WHERE event_id=ANY($1)',[[foreign.id,ghost.id]])).rows;await admin.end();
  assert.deepEqual(rows.find(r=>r.event_id===foreign.id),{event_id:foreign.id,done:true,last_error:null});
  assert.deepEqual(rows.find(r=>r.event_id===ghost.id),{event_id:ghost.id,done:false,last_error:'UNKNOWN_CHECKOUT'});
 }finally{await s.close();}
});
