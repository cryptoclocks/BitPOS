import 'dotenv/config';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
import {PublicKey} from '@solana/web3.js';
import {config} from '../../apps/api/src/config';
import {assertCluster,mintPolicy,verifyTransfer,chain} from '../../apps/api/src/payments';
import type {AttemptRow} from '../../apps/api/src/types';
const [browserPath='.omp/work/evidence/table-first-browser-live-payment.json',serialPath='.omp/work/evidence/physical-table-v030-first-browser-payment.log',outputPath='.omp/work/evidence/table-first-browser-payment-reconciled.json']=process.argv.slice(2);
for(const path of [browserPath,outputPath])assert.match(path,/^\.omp\/work\/evidence\/[a-zA-Z0-9_-]+\.json$/);
assert.match(serialPath,/^\.omp\/work\/evidence\/[a-zA-Z0-9_-]+\.log$/);
const browser=JSON.parse(fs.readFileSync(browserPath,'utf8'));
const signature=new URL(browser.explorer).pathname.split('/').pop()!;
await assertCluster();await mintPolicy();
const db=new pg.Client({connectionString:config.ADMIN_DATABASE_URL});await db.connect();
try {
 const attempt=(await db.query<AttemptRow>('SELECT * FROM bitpos.payment_attempts WHERE order_id=$1 AND signature=$2',[browser.orderId,signature])).rows[0];assert.ok(attempt);
 assert.equal(attempt.status,'FINALIZED');assert.ok(BigInt(attempt.amount_minor)>0n);assert.equal(attempt.amount_minor,browser.settlement.amountMinor);
 assert.ok(await verifyTransfer(signature,attempt,'finalized'),'independent chain facts satisfy every frozen transfer constraint');
 assert.equal(await chain.getBalance(new PublicKey(attempt.payer)),0);
 const rows=(await db.query("SELECT o.status,o.version,o.reservation_released,a.target_device_id,(SELECT count(*)::int FROM bitpos.payments p WHERE p.order_id=o.id AND p.signature=$2 AND p.state='SETTLED') AS payments,(SELECT count(*)::int FROM bitpos.outbox_events e WHERE e.order_id=o.id AND e.type='ORDER' AND e.payload->'payload'->>'status'='PAID') AS paid_events FROM bitpos.orders o JOIN bitpos.order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id WHERE o.id=$1",[browser.orderId,signature])).rows;
 assert.equal(rows.length,1);const order=rows[0];assert.equal(order.status,'PAID');assert.equal(order.payments,1);assert.equal(order.paid_events,1);assert.equal(order.reservation_released,true);assert.equal(order.target_device_id,browser.authority.target.deviceId);
 const deliveries=(await db.query("SELECT e.id AS event_id,e.order_id,e.order_version,e.payload->>'occurredAt' AS verified_at,d.rendered_at,d.latency_ms,d.connection_generation::text FROM bitpos.outbox_events e JOIN bitpos.device_event_deliveries d ON d.merchant_id=e.merchant_id AND d.event_id=e.id WHERE e.order_id=$1 AND e.type='ORDER' AND e.payload->'payload'->>'status'='PAID' AND d.device_id=$2 AND d.status='rendered' ORDER BY d.rendered_at",[browser.orderId,order.target_device_id])).rows;
 assert.ok(deliveries.length);const first=deliveries[0];const serial=fs.readFileSync(serialPath,'utf8');assert.ok(serial.split('\n').some(line=>line.includes('BITPOS_RENDER_ACK')&&line.includes(first.event_id)&&line.includes(browser.orderId)&&line.includes('status=PAID')));
 assert.ok(Math.abs(new Date(first.rendered_at).getTime()-new Date(first.verified_at).getTime()-Number(first.latency_ms))<=2);
 const receipt={origin:'live_devnet_exact_browser_transaction_independent_chain_database_physical_reconciliation',source_fingerprint:browser.source_fingerprint,orderId:browser.orderId,signature,finalized:true,customerZeroSOL:true,settledPayments:1,originalPaidEvents:1,targetDevice:order.target_device_id,physicalACK:first,allRenderedDeliveries:deliveries.length,serialEvidence:serialPath,browserEvidence:browserPath,latencyMeasurement:'host successful verifier return to physical ACK host callback; chain finalization excluded',p95Claim:false,physicalMobile:false,transactionsSubmittedByVerifier:0};
 fs.writeFileSync(outputPath,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await db.end();}
