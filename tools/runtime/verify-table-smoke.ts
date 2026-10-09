import 'dotenv/config';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
import {PublicKey} from '@solana/web3.js';
import {config} from '../../apps/api/src/config';
import {assertCluster,mintPolicy,verifyTransfer,chain} from '../../apps/api/src/payments';
import type {AttemptRow} from '../../apps/api/src/types';
const [demoPath,serialPath,name]=process.argv.slice(2);
for(const path of [demoPath,serialPath])assert.match(path||'',/^\.omp\/work\/evidence\/[a-zA-Z0-9._-]+\.(?:json|log)$/);
assert.match(name||'',/^[a-z0-9-]+$/);
const demo=JSON.parse(fs.readFileSync(demoPath,'utf8'));assert.equal(demo.protocolVersion,2);assert.equal(demo.successful_rounds,1);assert.equal(demo.rounds.length,1);
const round=demo.rounds[0],lines=fs.readFileSync(serialPath,'utf8').split('\n');
await assertCluster();await mintPolicy();
const db=new pg.Client({connectionString:config.ADMIN_DATABASE_URL});await db.connect();
try {
 const attempts=(await db.query<AttemptRow>('SELECT * FROM bitpos.payment_attempts WHERE order_id=$1 AND signature=$2',[round.orderId,round.signature])).rows;
 assert.equal(attempts.length,1);const attempt=attempts[0];assert.equal(attempt.status,'FINALIZED');assert.ok(await verifyTransfer(round.signature,attempt,'finalized'));assert.equal(await chain.getBalance(new PublicKey(attempt.payer)),0);
 const orders=(await db.query("SELECT o.status,o.reservation_released,a.target_device_id,(SELECT count(*)::int FROM bitpos.payments p WHERE p.order_id=o.id AND p.signature=$2 AND p.state='SETTLED') AS payments,(SELECT count(*)::int FROM bitpos.outbox_events e WHERE e.order_id=o.id AND e.type='ORDER' AND e.payload->'payload'->>'status'='PAID') AS paid_events FROM bitpos.orders o JOIN bitpos.order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id WHERE o.id=$1",[round.orderId,round.signature])).rows;
 assert.equal(orders.length,1);const order=orders[0];assert.equal(order.status,'PAID');assert.equal(order.reservation_released,true);assert.equal(order.payments,1);assert.equal(order.paid_events,1);assert.equal(order.target_device_id,demo.deviceId);
 const deliveries=(await db.query("SELECT e.id AS event_id,e.order_version,e.payload->>'occurredAt' AS verified_at,d.rendered_at,d.latency_ms,d.connection_generation::text FROM bitpos.outbox_events e JOIN bitpos.device_event_deliveries d ON d.merchant_id=e.merchant_id AND d.event_id=e.id WHERE e.order_id=$1 AND d.device_id=$2 AND d.event_id=$3 AND d.connection_generation=$4 AND e.type='ORDER' AND e.payload->'payload'->>'status'='PAID' AND d.status='rendered' AND d.rendered_at IS NOT NULL",[round.orderId,demo.deviceId,round.physicalAck.event_id,round.physicalAck.connection_generation])).rows;
 assert.equal(deliveries.length,1);const ack=deliveries[0];assert.equal(Number(ack.latency_ms),Number(round.physicalAck.latency_ms));assert.ok(Math.abs(new Date(ack.rendered_at).getTime()-Date.parse(ack.verified_at)-Number(ack.latency_ms))<=2);
 const line=lines.find(line=>line.includes('event='+ack.event_id+' ')&&line.includes('order='+round.orderId+' ')&&line.includes('version='+ack.order_version+' ')&&line.includes('status=PAID '));assert.ok(line);const flush=line.match(/flush_ms=(\d+)/);assert.ok(flush);
 const evidence={origin:'independently_reconciled_finalized_devnet_original_physical_table_delivery',demoPath,serialPath,source_fingerprint_at_round:round.sourceFingerprint,orderId:round.orderId,signature:round.signature,deviceId:demo.deviceId,customerZeroSOL:true,settledPayments:1,originalPaidEvents:1,physicalAck:ack,physicalFlushMs:Number(flush[1]),samples:1,p95Claim:false,transactionsSubmittedByVerifier:0,physicalAndroid:false};
 fs.writeFileSync('.omp/work/evidence/'+name+'.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{await db.end();}
