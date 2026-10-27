// Privileged invariant probe on an already-owned disposable refund clone only.
// Demonstrates constraints, not app table-write admission. Every mutation rolls back.
import pg from 'pg';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import {readFile,writeFile} from 'node:fs/promises';import {Keypair} from '@solana/web3.js';
import {fixturePaymentAttempt} from '../../tests/backend-payment-fixture';
const database=process.argv[2];if(!/^bitpos_refund_commit_[a-f0-9]{12}$/.test(database??''))throw Error('Owned disposable refund clone required');
const db=new pg.Client({host:'127.0.0.1',port:55446,database});await db.connect();
try{
 const connection=(await db.query('SELECT current_database() name,inet_server_port() port')).rows[0];assert.equal(connection.name,database);assert.equal(connection.port,55446);
 await db.query('BEGIN');await db.query('SET LOCAL search_path=bitpos,public');
 const review=(await db.query("SELECT r.case_id,r.merchant_id,r.order_id FROM food_return108_financial_reviews r JOIN food_return109_decisions d ON d.case_id=r.case_id WHERE d.decision='LINE_REFUND'")).rows;assert.equal(review.length,1);const target=review[0];
 const foreign=(await db.query('SELECT merchant_id,order_id FROM payments WHERE state=\'SETTLED\' AND(merchant_id,order_id)<>($1::uuid,$2::uuid) ORDER BY id LIMIT 1',[target.merchant_id,target.order_id])).rows[0];assert.ok(foreign,'Synthetic second order required');
 const signature='SQL-SCOPE-ONLY-'+randomUUID(),attempt=(await fixturePaymentAttempt(db,{merchant:foreign.merchant_id,order:foreign.order_id,status:'SUBMITTED',signature,payer:Keypair.generate().publicKey.toBase58()})).rows[0];
 const payment=(await db.query("INSERT INTO payments(merchant_id,order_id,attempt_id,signature,amount_minor,state)VALUES($1,$2,$3,$4,$5,'RECOVERY')RETURNING id",[foreign.merchant_id,foreign.order_id,attempt.id,signature,attempt.amount_minor])).rows[0].id;
 await db.query('SAVEPOINT allocation');let denied=false;
 try{
  await db.query('INSERT INTO food_return109_allocations(case_id,merchant_id,order_id,payment_id,amount_minor,asset_descriptor,settlement,beneficiary) SELECT $1,p.merchant_id,p.order_id,p.id,p.amount_minor,a.descriptor,a.settlement,a.payer FROM payments p JOIN payment_attempt_assets a ON(a.merchant_id,a.order_id,a.attempt_id)=(p.merchant_id,p.order_id,p.attempt_id)WHERE p.id=$2',[target.case_id,payment]);
 }catch(error){if(!(error instanceof Error)||error.message!=='RETURN_ALLOCATION_MUST_MATCH_PAYMENT')throw error;denied=true;}
 await db.query('ROLLBACK TO SAVEPOINT allocation');
 const evidence='.omp/work/flutter-delivery-20261016/evidence/refund135-scope-probe-'+new Date().toISOString().replaceAll(':','-')+'.json';
 await writeFile(evidence,JSON.stringify({status:denied?'PASS_CROSS_CASE_ALLOCATION_DENIED':'FAIL_CROSS_CASE_ALLOCATION_ACCEPTED',sourceSha256:createHash('sha256').update(await readFile('supabase/migrations/135_food_selected_line_refunds.sql')).digest('hex'),crossOrder:true,paymentState:'RECOVERY',caller:'Privileged fixture owner; application raw table writes remain closed',impact:'Intrinsic allocation constraint must bind original case merchant/order even when canonical current entry points choose correctly',realFunds:false,cleanup:'Outer transaction rolled back',physicalTesting:'deferred_by_user_2026-10-16'},null,2)+'\n');
 console.log(evidence);assert.equal(denied,true,'A foreign-order RECOVERY payment must not attach to this returned-food case');
}finally{await db.query('ROLLBACK');await db.end();}
