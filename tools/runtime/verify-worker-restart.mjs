import fs from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
import {Connection} from '@solana/web3.js';
const tag=process.env.BITPOS_RESTART_TAG||'english';assert.match(tag,/^[a-z0-9-]{1,32}$/);
const beforePath=`.omp/work/evidence/worker-${tag}-restart-before.json`;
const afterPath=`.omp/work/evidence/worker-${tag}-restart-after.json`;
const before=JSON.parse(fs.readFileSync(beforePath,'utf8'));
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
const deadline=Date.now()+90000;let row;
while(Date.now()<deadline){row=(await db.query("SELECT o.id,o.status,o.version,a.signature,a.status AS attempt_status,(SELECT count(*)::int FROM bitpos.payment_attempts WHERE order_id=o.id) AS attempts,(SELECT count(*)::int FROM bitpos.payments WHERE order_id=o.id AND state='SETTLED') AS payments,(SELECT count(*)::int FROM bitpos.outbox_events WHERE order_id=o.id AND payload->>'paymentStatus'='PAID') AS paid_events FROM bitpos.orders o JOIN bitpos.payment_attempts a ON a.order_id=o.id WHERE o.id=$1 AND a.id=$2",[before.order_id,before.attempt_id])).rows[0];if(row?.status==='PAID')break;await new Promise(resolve=>setTimeout(resolve,500));}
await db.end();assert.equal(row.status,'PAID');assert.equal(row.attempt_status,'FINALIZED');assert.equal(row.signature,before.signature);assert.equal(row.attempts,1);assert.equal(row.payments,1);assert.equal(row.paid_events,1);
const chain=new Connection('https://api.devnet.solana.com','confirmed');assert.equal(await chain.getGenesisHash(),'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const status=(await chain.getSignatureStatuses([row.signature],{searchTransactionHistory:true})).value[0];assert.equal(status?.confirmationStatus,'finalized');assert.equal(status.err,null);
const evidence={origin:'actual_worker_process_restart_live_devnet',before_evidence:beforePath,after:row,chain_status:status,same_persisted_signature:true,one_attempt_payment_paid_event:true};
fs.writeFileSync(afterPath,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:row.status,signature:row.signature,attempts:row.attempts,payments:row.payments,paid_events:row.paid_events}));
