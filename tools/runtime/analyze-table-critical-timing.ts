import 'dotenv/config';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
import {config} from '../../apps/api/src/config';
const tracePath=process.argv[2];assert.match(tracePath,/^\.omp\/work\/evidence\/critical-api-sql-[0-9TZ]+\.jsonl$/);
const demo=JSON.parse(fs.readFileSync('.omp/work/evidence/demo-table-critical-trace-round.json','utf8'));assert.equal(demo.protocolVersion,2);assert.equal(demo.successful_rounds,1);
const round=demo.rounds[0];const traces=fs.readFileSync(tracePath,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));
const db=new pg.Client({connectionString:config.ADMIN_DATABASE_URL});await db.connect();
try {
 const rows=(await db.query("SELECT e.id,e.payload->>'occurredAt' AS verified_at,d.rendered_at,d.latency_ms,d.connection_generation::text,p.signature,p.state FROM bitpos.outbox_events e JOIN bitpos.device_event_deliveries d ON d.merchant_id=e.merchant_id AND d.event_id=e.id JOIN bitpos.payments p ON p.merchant_id=e.merchant_id AND p.order_id=e.order_id WHERE e.order_id=$1 AND e.type='ORDER' AND e.payload->'payload'->>'status'='PAID' AND d.device_id=$2 AND d.event_id=$3 AND d.status='rendered' AND p.signature=$4",[round.orderId,demo.deviceId,round.physicalAck.event_id,round.signature])).rows;
 assert.equal(rows.length,1);const receipt=rows[0];assert.equal(receipt.state,'SETTLED');assert.equal(Number(receipt.latency_ms),Number(round.physicalAck.latency_ms));
 const start=Date.parse(receipt.verified_at),end=new Date(receipt.rendered_at).getTime();assert.ok(Math.abs(end-start-Number(receipt.latency_ms))<=2);
 const all=traces.filter(row=>row.origin==='temporary_actual_API_SQL_callback_trace');const critical=all.filter(row=>Date.parse(row.finishedAt)>=start&&Date.parse(row.at)<=end);
 function spread(values:number[]){const sorted=[...values].sort((a,b)=>a-b);return {samples:sorted.length,min_ms:sorted[0]??null,median_ms:sorted[Math.floor(sorted.length/2)]??null,p95_ms:sorted[Math.ceil(sorted.length*.95)-1]??null,max_ms:sorted.at(-1)??null};}
 const groups=new Map();for(const query of critical){const list=groups.get(query.pid)??[];list.push(query);groups.set(query.pid,list);}
 const evidence={origin:'actual_API_SQL_trace_correlated_with_single_finalized_devnet_physical_render_ACK',tracePath,orderId:round.orderId,signature:round.signature,eventId:receipt.id,sourceFingerprint:round.sourceFingerprint,verifiedAt:receipt.verified_at,physicalAckAt:receipt.rendered_at,latency_ms:Number(receipt.latency_ms),physicalSerial:'.omp/work/evidence/physical-table-critical-trace-payment.log',SQLRoundTripSpread:spread(all.filter(row=>row.verb==='SELECT').map(row=>row.ms)),critical:critical.map(({at,finishedAt,pid,sqlHash,verb,ms,errorCode})=>({at,finishedAt,pid,sqlHash,verb,ms,errorCode})),connectionSpans:[...groups].map(([pid,queries])=>({pid,queries:queries.length,queryWallMs:queries.reduce((n:number,q:{ms:number})=>n+q.ms,0)})),controls:{singleRoundNotP95:true,chainFinalizationExcluded:true,APIOnlyTraceWorkerNotTraced:true,queryParamsAndSQLTextNotLogged:true,temporaryLoggingMayAddOverhead:true,concurrentQueryDurationsMustNotBeSummedAsSerialLatency:true,noNewTransfersByAnalyzer:true}};
 fs.writeFileSync('.omp/work/evidence/table-critical-timing-analysis.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{await db.end();}
