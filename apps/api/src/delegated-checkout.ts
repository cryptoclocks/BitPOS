import {createHash} from 'node:crypto';
import {z} from 'zod';
import {encodePaymentSignatureHeader} from '@x402/core/http';
import {pool,tenant} from './db';
import {fail} from './authority';
import {customerOrigin} from './config';
import {delegatedPaymentsRequest,bindGrantAttempt,assertGrantAttempt,type CommittedGrant} from './delegated-payments';
import {signDelegatedAttempt} from './delegated-signer';
import {prepareX402,acceptX402,type TrustedX402Grant} from './x402';
import {frozenAttempt} from './payment-assets';
import {orderView} from './orders';
import type {OrderRow,AttemptRow} from './types';
import type {X402Attempt} from './x402-payment';
const cap=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const confirmation=z.object({sessionToken:cap,grantId:z.string().uuid(),orderConfirmation:z.literal(true),orderId:z.string().uuid(),quoteId:z.string().uuid(),nonce:z.string().uuid()}).strict();
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function delegatedCheckoutRequest(path:string,method:string,input:unknown){
 const route=path.match(/^\/api\/table\/([A-Za-z0-9_-]{43})\/visit\/([A-Za-z0-9_-]{43})\/grants\/checkout$/);if(!route)return undefined;
 if(method!=='POST')fail('RESOURCE_NOT_FOUND',405);const d=confirmation.parse(input),entry=cap.parse(route[1]),visit=cap.parse(route[2]);
 const merchant=(await pool.query('SELECT bitpos.resolve_table_entry($1) AS merchant',[entry])).rows[0]?.merchant;if(!merchant)fail('RESOURCE_NOT_FOUND',404);
 // A saved signed authorization may be observed after expiry or pause. The same
 // owner token, private visit and immutable confirmation still scope that receipt;
 // this branch never creates a hold, signs or rebroadcasts.
 const recovery=await tenant(merchant,async db=>{
  const s=(await db.query('SELECT id,owner FROM delegated_owner_sessions WHERE merchant_id=$1 AND token_hash=$2 AND domain=$3',[merchant,digest(d.sessionToken),customerOrigin])).rows[0];if(!s)fail('WALLET_PROOF_REQUIRED',422);
  const o=(await db.query<OrderRow>(`SELECT o.* FROM table_visits v JOIN table_entries e ON e.merchant_id=v.merchant_id AND e.id=v.entry_id JOIN orders o ON o.merchant_id=v.merchant_id AND o.id=v.order_id WHERE v.merchant_id=$1 AND e.entry_token=$2 AND v.access_token=$3 AND o.id=$4 FOR UPDATE OF o`,[merchant,entry,visit,d.orderId])).rows[0];if(!o)fail('RESOURCE_NOT_FOUND',404);
  const h=(await db.query('SELECT h.*,g.owner,g.delegate,g.policy FROM delegated_holds h JOIN delegated_grants g ON g.merchant_id=h.merchant_id AND g.id=h.grant_id JOIN table_visits v ON v.merchant_id=h.merchant_id AND v.id=h.visit_id WHERE h.merchant_id=$1 AND h.order_id=$2 AND h.session_id=$3 AND v.access_token=$4',[merchant,o.id,s.id,visit])).rows[0];
  if(!h)return {access:o.access_token};
  if(h.grant_id!==d.grantId||h.quote_id!==d.quoteId||h.nonce!==d.nonce||h.owner!==s.owner)fail('IDEMPOTENCY_CONFLICT');
  const a=h.attempt_id?(await db.query<AttemptRow>('SELECT * FROM payment_attempts WHERE merchant_id=$1 AND id=$2',[merchant,h.attempt_id])).rows[0]:undefined;
  const memoBinding=digest(JSON.stringify([h.grant_id,h.policy.generation,h.id,h.nonce,h.request_hash,h.quote_id]));
  if(a?.signed_base64){const frozen=await frozenAttempt(db,a);if(!frozen.x402||frozen.x402.grantId!==h.grant_id||frozen.x402.holdId!==h.id)fail('PAYMENT_UNAVAILABLE',503);const j=(await db.query('SELECT partial_base64 FROM delegated_authorizations WHERE merchant_id=$1 AND attempt_id=$2',[merchant,a.id])).rows[0];if(!j?.partial_base64)fail('PAYMENT_UNAVAILABLE',503);return {access:o.access_token,attempt:{...frozen,x402:frozen.x402} as X402Attempt,partial:j.partial_base64 as string,memoBinding};}
  return {access:o.access_token,memoBinding};
 });
 let a:X402Attempt;
 if(recovery.attempt)a=recovery.attempt;
 else {
  const hold=await delegatedPaymentsRequest(path.replace(/checkout$/,'authorize'),method,d) as CommittedGrant;
  if(!hold||hold.grantId!==d.grantId)fail('PAYMENT_UNAVAILABLE',503);
  const memoBinding=await tenant(merchant,async db=>{
   const h=(await db.query('SELECT h.*,g.policy FROM delegated_holds h JOIN delegated_grants g ON g.merchant_id=h.merchant_id AND g.id=h.grant_id WHERE h.merchant_id=$1 AND h.id=$2 AND h.order_id=$3 AND h.quote_id=$4 AND h.nonce=$5',[merchant,hold.holdId,d.orderId,d.quoteId,d.nonce])).rows[0];if(!h)fail('IDEMPOTENCY_CONFLICT');return digest(JSON.stringify([h.grant_id,h.policy.generation,h.id,h.nonce,h.request_hash,h.quote_id]));
  });
  const grant:TrustedX402Grant={...hold,memoBinding,bindAttempt:(db,current)=>bindGrantAttempt(db,current,hold.holdId),assertAttempt:assertGrantAttempt};
  a=await prepareX402(merchant,recovery.access,hold.owner,grant);
  const partial=a.signed_base64?await tenant(merchant,async db=>{const j=(await db.query('SELECT partial_base64 FROM delegated_authorizations WHERE merchant_id=$1 AND attempt_id=$2',[merchant,a.id])).rows[0];if(!j?.partial_base64)fail('PAYMENT_UNAVAILABLE',503);return j.partial_base64 as string;}):await signDelegatedAttempt(merchant,a.id);
  const result=await acceptX402(a,encodePaymentSignatureHeader({x402Version:2,resource:{url:a.x402.resource},accepted:a.x402.requirements,payload:{transaction:partial}}),grant);
  return reply(merchant,a,result);
 }
 const result=await acceptX402(a,encodePaymentSignatureHeader({x402Version:2,resource:{url:a.x402.resource},accepted:a.x402.requirements,payload:{transaction:recovery.partial!}}));
 return reply(merchant,a,result);
}
async function reply(merchant:string,a:X402Attempt,result:Awaited<ReturnType<typeof acceptX402>>){
 const order=await tenant(merchant,async db=>{const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2',[merchant,a.order_id])).rows[0];if(!o)fail('RESOURCE_NOT_FOUND',404);return orderView(db,o,true);});
 return {...result,order};
}
