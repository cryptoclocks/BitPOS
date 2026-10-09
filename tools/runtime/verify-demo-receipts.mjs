import fs from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
import {PublicKey} from '@solana/web3.js';
import {execFileSync} from 'node:child_process';
import {config} from '../../apps/api/src/config.ts';
import {assertCluster,mintPolicy,verifyTransfer,chain} from '../../apps/api/src/payments.ts';
const statePath=process.env.BITPOS_DEMO_STATE||'local/private/demo-rounds.json';
assert.match(statePath,/^local\/private\/demo-rounds(?:-[a-z0-9-]+)?\.json$/);
const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
assert.equal(state.protocolVersion,2,'Historical single-terminal proof is not current table proof');
const fingerprint=JSON.parse(execFileSync('python3',['.omp/foreman.py','fingerprint'],{encoding:'utf8'})).source_fingerprint;
const freeze=JSON.parse(fs.readFileSync('.omp/work/evidence/demo-three-round-runtime-freeze.json','utf8'));
const runtimeFingerprint=JSON.parse(execFileSync('python3',['.omp/foreman.py','runtime-fingerprint'],{encoding:'utf8'})).source_fingerprint;
assert.equal(runtimeFingerprint,freeze.runtime_source_fingerprint,'Product runtime changed after actual samples; new runtime proof required');
const paid=state.rounds.filter(round=>round.paidAt&&round.physicalAck);
assert.ok(paid.length>=3,'Three successful current-runtime rounds required');
assert.equal(paid.length,state.rounds.filter(round=>round.signature).length,'Every signed attempt must reconcile; unsigned interrupted draft is reported separately');
await assertCluster();await mintPolicy();
const db=new pg.Client({connectionString:config.ADMIN_DATABASE_URL});await db.connect();
const receipts=[],payers=new Set();
try {
 for(const round of paid){
  assert.ok([fingerprint,freeze.sample_source_fingerprint].includes(round.sourceFingerprint),'Every sample retains its original source fingerprint; only verified tooling changes allowed');
  const attempts=(await db.query('SELECT * FROM bitpos.payment_attempts WHERE order_id=$1 AND signature=$2',[round.order.id,round.signature])).rows;
  assert.equal(attempts.length,1);const attempt=attempts[0];assert.equal(attempt.status,'FINALIZED');
  await new Promise(resolve=>setTimeout(resolve,1200));
  assert.ok(await verifyTransfer(round.signature,attempt,'finalized'),'Independent chain proof must satisfy mint/program/payer/recipient/amount/reference');
  const rows=(await db.query("SELECT o.id,o.status,o.payer,o.usdg_minor::text,o.reservation_released,a.target_device_id,(SELECT count(*)::int FROM bitpos.payments p WHERE p.order_id=o.id AND p.state='SETTLED' AND p.signature=$2) AS payments,(SELECT count(*)::int FROM bitpos.outbox_events e WHERE e.order_id=o.id AND e.type='ORDER' AND e.payload->'payload'->>'status'='PAID') AS paid_events FROM bitpos.orders o JOIN bitpos.order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id WHERE o.id=$1",[round.order.id,round.signature])).rows;
  assert.equal(rows.length,1);const row=rows[0];assert.equal(row.status,'PAID');assert.equal(row.payments,1);assert.equal(row.paid_events,1);assert.equal(row.reservation_released,true);assert.equal(row.target_device_id,state.deviceId);assert.equal(row.usdg_minor,attempt.amount_minor);assert.equal(row.payer,attempt.payer);
  const ack=(await db.query("SELECT d.event_id,d.connection_generation::text,d.latency_ms FROM bitpos.device_event_deliveries d JOIN bitpos.outbox_events e ON e.merchant_id=d.merchant_id AND e.id=d.event_id WHERE e.order_id=$1 AND d.device_id=$2 AND d.event_id=$3 AND d.connection_generation=$4 AND d.status='rendered' AND d.rendered_at IS NOT NULL AND e.type='ORDER' AND e.payload->'payload'->>'status'='PAID'",[row.id,state.deviceId,round.physicalAck.event_id,round.physicalAck.connection_generation])).rows;
  assert.equal(ack.length,1);assert.equal(Number(ack[0].latency_ms),Number(round.physicalAck.latency_ms));
  assert.ok(round.transitions.includes('CONFIRMING'));assert.equal(round.transitions.at(-1),'PAID');
  payers.add(row.payer);receipts.push({index:round.index,orderId:row.id,signature:round.signature,finalized:true,amountMinor:row.usdg_minor,payments:1,paidEvents:1,targetDeviceId:row.target_device_id,physicalAck:ack[0],transitions:round.transitions});
 }
 for(const payer of payers)assert.equal(await chain.getBalance(new PublicKey(payer)),0);
 const unsignedDrafts=[];for(const round of state.rounds.filter(r=>!r.signature)){const row=(await db.query('SELECT id,status,(SELECT count(*)::int FROM bitpos.payment_attempts a WHERE a.order_id=o.id AND a.signature IS NOT NULL) AS signed_attempts FROM bitpos.orders o WHERE id=$1',[round.order?.id])).rows[0];assert.equal(row?.signed_attempts??0,0);unsignedDrafts.push({index:round.index,orderId:row?.id??null,status:row?.status??'NO_ORDER',signedAttempts:0});}
 const evidence={origin:'live_devnet_scripted_wallet_independent_chain_and_table_receipt_verification',fixture:'Dedicated host test signer; not physical mobile',protocolVersion:2,source_fingerprint:fingerprint,sample_source_fingerprint:freeze.sample_source_fingerprint,runtime_source_fingerprint:runtimeFingerprint,runId:state.runId,successful_rounds:receipts.length,customer_zero_sol:true,transactionsSubmittedByVerifier:0,unsignedDrafts,rounds:receipts};
 fs.writeFileSync('.omp/work/evidence/demo-table-receipts.json',JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({successful_rounds:receipts.length,all_finalized:true,customer_zero_sol:true,source_fingerprint:fingerprint}));
}finally{await db.end();}
