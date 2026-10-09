import fs from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
import {execFileSync} from 'node:child_process';
const serialPath=process.argv[2];assert.match(serialPath||'',/^\.omp\/work\/evidence\/[a-zA-Z0-9._-]+\.log$/,'Sanitized physical serial evidence required');
const lines=fs.readFileSync(serialPath,'utf8').split('\n');
const device=JSON.parse(fs.readFileSync('.omp/work/evidence/device-preflight.json','utf8'));
assert.equal(device.mac,'14:c1:9f:4e:62:48');
const statePath=process.env.BITPOS_DEMO_STATE||'local/private/demo-rounds.json';
assert.match(statePath,/^local\/private\/demo-rounds(?:-[a-z0-9-]+)?\.json$/);
const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
assert.equal(state.protocolVersion,2,'Legacy delivery rows cannot prove current firmware table flow');
assert.ok(state.rounds.filter(r=>r.signature).length>=3,'Three successful physical rounds required');
const fingerprint=JSON.parse(execFileSync('python3',['.omp/foreman.py','fingerprint'],{encoding:'utf8'})).source_fingerprint;
const freeze=JSON.parse(fs.readFileSync('.omp/work/evidence/demo-three-round-runtime-freeze.json','utf8'));
const runtimeFingerprint=JSON.parse(execFileSync('python3',['.omp/foreman.py','runtime-fingerprint'],{encoding:'utf8'})).source_fingerprint;
assert.equal(runtimeFingerprint,freeze.runtime_source_fingerprint,'Product runtime must be byte-identical to actual samples');
const samples=[];
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
try {
 for(const round of state.rounds.filter(r=>r.signature)){
  assert.ok(round.paidAt&&round.physicalAck,'No failed or missing sample may be filtered out');
  assert.ok([fingerprint,freeze.sample_source_fingerprint].includes(round.sourceFingerprint),'Keep original sample source; only byte-verified tooling changes allowed');
  const rows=(await db.query("SELECT e.id AS event_id,e.order_id,e.order_version,e.payload->>'occurredAt' AS verified_at,e.created_at AS outbox_persisted_at,d.rendered_at,d.latency_ms,d.connection_generation::text FROM bitpos.outbox_events e JOIN bitpos.device_event_deliveries d ON d.merchant_id=e.merchant_id AND d.event_id=e.id WHERE e.order_id=$1 AND e.type='ORDER' AND e.payload->'payload'->>'status'='PAID' AND d.device_id=$2 AND d.event_id=$3 AND d.connection_generation=$4 AND d.status='rendered' AND d.rendered_at IS NOT NULL",[round.order.id,state.deviceId,round.physicalAck.event_id,round.physicalAck.connection_generation])).rows;
  assert.equal(rows.length,1,'Use the recorded original event/generation, never the fastest reconnect');
  const row=rows[0];
  const line=lines.find(line=>line.includes('BITPOS_RENDER_ACK ')&&line.includes('event='+row.event_id+' ')&&line.includes('order='+row.order_id+' ')&&line.includes('version='+row.order_version+' ')&&line.includes('status=PAID '));
  assert.ok(line,'Exact event/order/version must correlate with actual physical serial render ACK');
  const flush=line.match(/flush_ms=(\d+)/);assert.ok(flush,'Physical display flush timing required');
  const latency=Number(row.latency_ms);assert.ok(Number.isFinite(latency)&&latency>=0);
  assert.equal(latency,Number(round.physicalAck.latency_ms));
  assert.ok(Math.abs(new Date(row.rendered_at).getTime()-Date.parse(row.verified_at)-latency)<=2,'Timestamp must remain verifier return to actual ACK callback, excluding chain finalization');
  samples.push({...row,latency_ms:latency,physical_flush_ms:Number(flush[1])});
 }
}finally{await db.end();}
assert.equal(new Set(samples.map(row=>row.order_id)).size,samples.length,'Each sample is a distinct paid order');
const latencies=samples.map(row=>row.latency_ms);
const evidence={origin:'physical_esp32',mac:device.mac,deviceId:state.deviceId,protocolVersion:2,source_fingerprint:fingerprint,sample_source_fingerprint:freeze.sample_source_fingerprint,runtime_source_fingerprint:runtimeFingerprint,runId:state.runId,samples:samples.length,latencies_ms:latencies,p95_claim:false,measurement:'Original successful finalized verifier to authenticated physical render ACK callback receipt; chain finalization excluded; every signed round retained, including slow values',serial_evidence:serialPath,measurements:samples};
fs.writeFileSync('.omp/work/evidence/physical-ack-three-round-demo.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({origin:evidence.origin,samples:evidence.samples,latencies_ms:latencies,p95_claim:false,source_fingerprint:fingerprint}));
