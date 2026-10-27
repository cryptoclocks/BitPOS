import {PublicKey} from '@solana/web3.js';
import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import type {AttemptRow} from '../apps/api/src/types';
// SQL-only verifier seam, not a chain proof or wallet fixture. Preserves canonical
// quote/asset/recipient fields so durability tests do not bypass the new boundary.
export async function fixturePaymentAttempt(db:pg.PoolClient|pg.Client,input:{merchant:string;order:string;status:string;signature?:string|null;reference?:string;amount?:string;failureReconciled?:boolean;payer?:string}){
 if(input.payer&&(new PublicKey(input.payer).toBase58()!==input.payer||!PublicKey.isOnCurve(new PublicKey(input.payer).toBytes())))throw Error('Invalid synthetic fixture payer');
 return db.query<AttemptRow>(`INSERT INTO bitpos.payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program,status,signature,signed_base64,transaction_base64,failure_reconciled_at)
 SELECT $1,$2,$3,coalesce($8::text,'SQL-only-fixture-payer'),q.settlement->>'recipient',coalesce($4::bigint,(q.settlement->>'amountMinor')::bigint),q.descriptor->>'mint',q.descriptor->>'tokenProgram',$5,$6,
 CASE WHEN $6::text IS NOT NULL THEN 'SQL-only-fixture-proof' END,CASE WHEN $6::text IS NOT NULL THEN 'SQL-only-fixture-message' END,CASE WHEN $7::boolean THEN clock_timestamp() END
 FROM bitpos.order_payment_selection s JOIN bitpos.payment_quotes q ON q.merchant_id=s.merchant_id AND q.order_id=s.order_id AND q.id=s.quote_id
 WHERE s.merchant_id=$1 AND s.order_id=$2 RETURNING *`,[input.merchant,input.order,input.reference??randomUUID(),input.amount??null,input.status,input.signature??null,input.failureReconciled??false,input.payer??null]);
}
