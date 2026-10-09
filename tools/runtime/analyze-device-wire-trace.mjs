/* Read-only diagnostic, not a latency gate. Usage:
 * node --env-file=.env tools/runtime/analyze-device-wire-trace.mjs TRACE STATE OUTPUT
 * STATE remains private; output contains no raw state, SQL or frame bodies.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
const [tracePath,statePath,outputPath]=process.argv.slice(2);
assert.match(tracePath||'',/^\.omp\/work\/evidence\/device-wire-trace-[a-zA-Z0-9_-]+\.jsonl$/);
assert.match(statePath||'',/^local\/private\/demo-rounds-[a-z0-9-]+\.json$/);
assert.match(outputPath||'',/^\.omp\/work\/evidence\/[a-zA-Z0-9_-]+\.json$/);
const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
assert.equal(state.protocolVersion,2);
const trace=fs.readFileSync(tracePath,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});
await db.connect();
try{
 const rounds=[];
 for(const round of state.rounds){
  assert.ok(round.paidAt&&round.physicalAck,'Incomplete journal cannot be filtered');
  const rows=(await db.query("SELECT e.id,e.payload->>'occurredAt' AS verified_at,e.created_at AS persisted_at,d.sent_at AS claimed_at,d.rendered_at,d.latency_ms FROM bitpos.outbox_events e JOIN bitpos.device_event_deliveries d ON d.merchant_id=e.merchant_id AND d.event_id=e.id WHERE e.id=$1 AND e.order_id=$2 AND d.device_id=$3 AND d.connection_generation=$4 AND e.type='ORDER' AND e.payload->'payload'->>'status'='PAID' AND d.status='rendered'",[round.physicalAck.event_id,round.order.id,state.deviceId,round.physicalAck.connection_generation])).rows;
  assert.equal(rows.length,1);const receipt=rows[0];
  assert.equal(Number(receipt.latency_ms),Number(round.physicalAck.latency_ms));
  const start=Date.parse(receipt.verified_at),end=new Date(receipt.rendered_at).getTime();
  const critical=trace.filter(row=>Date.parse(row.finishedAt||row.at)>=start&&Date.parse(row.at)<=end);
  const sends=critical.filter(row=>row.boundary==='socket_send_invocation'&&row.eventId===receipt.id);
  const arrivals=critical.filter(row=>row.boundary==='socket_command_arrival'&&row.type==='ACK'&&row.eventId===receipt.id);
  assert.equal(sends.length,1,'Exact original send required');assert.equal(arrivals.length,1,'Exact physical ACK arrival required');
  rounds.push({orderId:round.order.id,eventId:receipt.id,signature:round.signature,source_fingerprint:round.sourceFingerprint,connectionGeneration:round.physicalAck.connection_generation,latency_ms:Number(receipt.latency_ms),verified_at:receipt.verified_at,persisted_at:receipt.persisted_at,claimed_at:receipt.claimed_at,rendered_at:receipt.rendered_at,verified_to_send_invocation_ms:Date.parse(sends[0].at)-start,send_invocation_to_ACK_arrival_ms:Date.parse(arrivals[0].at)-Date.parse(sends[0].at),critical});
 }
 const evidence={origin:'actual_API_diagnostic_callbacks_and_socket_boundaries_correlated_with_original_physical_ACK',acceptance_latency_claim:false,observer_overhead:'Synchronous sanitized diagnostic writes; not a source-frozen p95 cohort',claim_timestamp_warning:'Durable claimed_at is not socket send; callback intervals can overlap and are not summed',tracePath,rounds};
 fs.writeFileSync(outputPath,JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify(rounds.map(({orderId,latency_ms,verified_to_send_invocation_ms,send_invocation_to_ACK_arrival_ms,critical})=>({orderId,latency_ms,verified_to_send_invocation_ms,send_invocation_to_ACK_arrival_ms,critical_records:critical.length}))));
}finally{await db.end();}
