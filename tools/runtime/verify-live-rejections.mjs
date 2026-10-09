import fs from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
import {setTimeout as delay} from 'node:timers/promises';
import {Keypair} from '@solana/web3.js';
import {verifyTransfer,PaymentProofError,assertCluster} from '../../apps/api/src/payments.ts';
await assertCluster();
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
const attempts=(await db.query("SELECT * FROM bitpos.payment_attempts WHERE status='FINALIZED' AND signed_base64 IS NOT NULL ORDER BY created_at DESC LIMIT 2")).rows;await db.end();assert.equal(attempts.length,2);
const attempt=attempts[0];assert.ok(await verifyTransfer(attempt.signature,attempt,'finalized'),'actual finalized chain payment required as baseline');
const cases=[['wrong_amount',{amount_minor:(BigInt(attempt.amount_minor)+1n).toString()}],['wrong_mint',{mint:Keypair.generate().publicKey.toBase58()}],['wrong_token_program',{token_program:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'}],['wrong_recipient',{recipient:Keypair.generate().publicKey.toBase58()}],['wrong_reference',{reference:Keypair.generate().publicKey.toBase58()}],['wrong_payer',{payer:Keypair.generate().publicKey.toBase58()}],['missing_frozen_signed_proof',{signed_base64:null}]];
const results=[];
// Historical proof checks are deliberately paced, not burst alongside worker RPC.
for(const [name,mutation] of cases){await delay(5000);await assert.rejects(verifyTransfer(attempt.signature,{...attempt,...mutation},'finalized'),PaymentProofError);results.push({name,rejected:true});}
await delay(5000);
await assert.rejects(verifyTransfer(attempts[1].signature,attempt,'finalized'),PaymentProofError);results.push({name:'other_order_signature_replay',rejected:true});
const evidence={origin:'actual_finalized_devnet_receipt_adversarial_verifier',baseline:{orderId:attempt.order_id,signature:attempt.signature,verified:true},checks:results,transactions_created:0,database_mutations:0};
fs.writeFileSync('.omp/work/evidence/live-payment-rejections.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({actual_finalized_baseline:true,rejections:results.length,new_transactions:0}));
