import {randomUUID} from 'node:crypto';
import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole,uuid} from './authority';
import {audit} from './db';
import {settleAttempt} from './orders';
import type {AttemptRow} from './types';

// DEMO money buttons for a demo shop. No real money, no chain: "pay" settles the order through the SAME settlement routine the verifier uses, with a
// synthetic attempt whose signature is `demo:<uuid>` (so it can never be mistaken for a transaction), and "refund" writes a simulated record.
// Both are refused unless the shop's active catalog is explicitly a demo catalog (`demo_configured`, the "Test catalog" tick in pricing), so a shop that
// charges real customers cannot use them. Only owner/manager, only counter/table orders, always audited. Wallet/online customers still pay for real.
const reasonBody=z.object({reason:z.string().trim().min(3).max(120)}).strict();
const payBody=z.object({method:z.enum(['DEMO','PROMPTPAY']).default('DEMO')}).strict();
export type DemoMethod='DEMO'|'PROMPTPAY';
const methodOfSignature=(s:string):DemoMethod=>s.startsWith('demo:promptpay:')?'PROMPTPAY':'DEMO';
export const demoPrefix='demo:';

export async function isDemoShop(db:pg.PoolClient,merchant:string):Promise<boolean>{
 return (await db.query<{p:string}>('SELECT v.provenance AS p FROM merchant_pricing m JOIN catalog_price_versions v ON v.merchant_id=m.merchant_id AND v.id=m.active_price_version_id WHERE m.merchant_id=$1',[merchant])).rows[0]?.p==='demo_configured';
}
async function demoGate(db:pg.PoolClient,merchant:string){if(!(await isDemoShop(db,merchant)))fail('DEMO_ONLY',403);}
async function lockOrder(db:pg.PoolClient,merchant:string,orderId:unknown){
 const id=uuid.safeParse(orderId);if(!id.success)fail('INVALID_REQUEST',422);
 const row=(await db.query<{id:string;status:string;closure_reason:string|null}>('SELECT id,status,closure_reason FROM orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,id.data])).rows[0];
 if(!row)fail('RESOURCE_NOT_FOUND',404);
 const online=(await db.query<{k:string|null}>('SELECT source_kind AS k FROM order_authority WHERE merchant_id=$1 AND order_id=$2',[merchant,id.data])).rows[0]?.k==='online';
 return {...row,online};
}
const demoPayment=async(db:pg.PoolClient,merchant:string,order:string)=>(await db.query<{signature:string}>('SELECT signature FROM payments WHERE merchant_id=$1 AND order_id=$2 AND signature LIKE $3',[merchant,order,demoPrefix+'%'])).rows[0];

/** Owner/manager of a demo shop: pay an unpaid counter/table order with demo money. Idempotent. */
export async function demoPay(db:pg.PoolClient,merchant:string,actor:string,role:string,orderId:unknown,input:unknown=undefined){
 requireRole(role);await demoGate(db,merchant);
 const pm=payBody.safeParse(input===undefined||input===null?{}:input);if(!pm.success)fail('INVALID_REQUEST',422);const method=pm.data.method;
 const o=await lockOrder(db,merchant,orderId);
 {const prior=await demoPayment(db,merchant,o.id);if(prior)return {orderId:o.id,status:'PAID' as const,demo:true,method:methodOfSignature(prior.signature),replayed:true};}
 if(o.status==='PAID')fail('ORDER_ALREADY_PAID',409);
 if(o.online||!['AWAITING_WALLET','AWAITING_PAYMENT'].includes(o.status)||o.closure_reason)fail('ORDER_NOT_PAYABLE',409);
 if((await db.query("SELECT 1 FROM payment_attempts WHERE merchant_id=$1 AND order_id=$2 AND status IN('BUILDING','READY','SUBMITTING','SUBMITTED','CONFIRMED')",[merchant,o.id])).rowCount)fail('PAYMENT_PENDING',409);
 const attempt=(await db.query<AttemptRow>(
  `INSERT INTO bitpos.payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program,status,signature,signed_base64,transaction_base64)
   SELECT $1,$2,gen_random_uuid()::text,'DEMO-PAYER',q.settlement->>'recipient',(q.settlement->>'amountMinor')::bigint,q.descriptor->>'mint',q.descriptor->>'tokenProgram','SUBMITTED',$3,'DEMO-NOT-A-TRANSACTION','DEMO-NOT-A-TRANSACTION'
   FROM bitpos.order_payment_selection s JOIN bitpos.payment_quotes q ON q.merchant_id=s.merchant_id AND q.order_id=s.order_id AND q.id=s.quote_id
   WHERE s.merchant_id=$1 AND s.order_id=$2 RETURNING *`,[merchant,o.id,demoPrefix+(method==='PROMPTPAY'?'promptpay:':'')+randomUUID()])).rows[0];
 if(!attempt)fail('ORDER_NOT_PAYABLE',409);
 await settleAttempt(db,attempt,true);
 if((await db.query<{status:string}>('SELECT status FROM orders WHERE merchant_id=$1 AND id=$2',[merchant,o.id])).rows[0]?.status!=='PAID')fail('ORDER_NOT_PAYABLE',409);
 await audit(db,merchant,actor,'order.demo_pay',o.id);
 return {orderId:o.id,status:'PAID' as const,demo:true,method,replayed:false};
}

/** Owner/manager of a demo shop: record a SIMULATED full refund of an order that was paid with the demo button. Idempotent; nothing moves. */
export async function demoRefund(db:pg.PoolClient,merchant:string,actor:string,role:string,orderId:unknown,input:unknown){
 requireRole(role);await demoGate(db,merchant);
 const data=reasonBody.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
 const o=await lockOrder(db,merchant,orderId);
 const prior=(await db.query<{reason:string;refunded_by:string;refunded_at:Date;currency:string;decimals:number;amount_minor:string}>('SELECT reason,refunded_by,refunded_at,currency,decimals,amount_minor::text FROM demo_refunds WHERE merchant_id=$1 AND order_id=$2',[merchant,o.id])).rows[0];
 const view=(r:NonNullable<typeof prior>,replayed:boolean)=>({orderId:o.id,simulated:true as const,reason:r.reason,by:r.refunded_by,at:r.refunded_at.toISOString(),amount:{currency:r.currency,decimals:r.decimals,amountMinor:r.amount_minor},replayed});
 if(prior)return view(prior,true);
 if(o.status!=='PAID')fail('ORDER_NOT_PAID',409);
 if(!(await demoPayment(db,merchant,o.id)))fail('DEMO_ONLY',403); // a real payment is never "refunded" by a simulation
 const price=(await db.query<{currency:string;decimals:number;total:string}>('SELECT catalog_currency AS currency,catalog_decimals::int AS decimals,total_minor::text AS total FROM order_authority WHERE merchant_id=$1 AND order_id=$2',[merchant,o.id])).rows[0];
 if(!price)fail('ORDER_NOT_PAID',409);
 const row=(await db.query<{reason:string;refunded_by:string;refunded_at:Date;currency:string;decimals:number;amount_minor:string}>('INSERT INTO demo_refunds(merchant_id,order_id,currency,decimals,amount_minor,reason,refunded_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING reason,refunded_by,refunded_at,currency,decimals,amount_minor::text',[merchant,o.id,price.currency,price.decimals,price.total,data.data.reason,actor])).rows[0]!;
 await audit(db,merchant,actor,'order.demo_refund',o.id);
 return view(row,false);
}
/** For the bill detail: what the demo buttons may do right now, and the simulated refund if there is one. */
export async function demoState(db:pg.PoolClient,merchant:string,role:string,orderId:string,status:string,online:boolean,closed:boolean){
 const available=['owner','manager'].includes(role)&&await isDemoShop(db,merchant);
 const demoPaid=await demoPayment(db,merchant,orderId);const paidByDemo=!!demoPaid;
 const refund=(await db.query<{reason:string;refunded_by:string;refunded_at:Date;currency:string;decimals:number;amount_minor:string}>('SELECT reason,refunded_by,refunded_at,currency,decimals,amount_minor::text FROM demo_refunds WHERE merchant_id=$1 AND order_id=$2',[merchant,orderId])).rows[0];
 return {available,paidByDemo,paymentMethod:demoPaid?methodOfSignature(demoPaid.signature):null,canPay:available&&!online&&!closed&&['AWAITING_WALLET','AWAITING_PAYMENT'].includes(status),canRefund:available&&paidByDemo&&status==='PAID'&&!refund,
  refund:refund?{reason:refund.reason,by:refund.refunded_by,at:refund.refunded_at.toISOString(),amount:{currency:refund.currency,decimals:refund.decimals,amountMinor:refund.amount_minor}}:null};
}

/** Owner/manager of a demo shop: a SIMULATED refund of a PAID cash sale. No cash moves and the drawer is untouched (take real cash back with the void). Idempotent. */
export async function demoCashRefund(db:pg.PoolClient,merchant:string,actor:string,role:string,saleId:unknown,input:unknown){
 requireRole(role);await demoGate(db,merchant);
 const id=uuid.safeParse(saleId),data=reasonBody.safeParse(input);if(!id.success||!data.success)fail('INVALID_REQUEST',422);
 const sale=(await db.query<{status:string;currency_code:string;decimals:number;total_minor:string}>('SELECT status,currency_code,decimals,total_minor::text FROM cash_sales WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,id.data])).rows[0];if(!sale)fail('RESOURCE_NOT_FOUND',404);
 type R={reason:string;refunded_by:string;refunded_at:Date;currency:string;decimals:number;amount_minor:string};
 const out=(r:R,replayed:boolean)=>({saleId:id.data,simulated:true as const,reason:r.reason,by:r.refunded_by,at:r.refunded_at.toISOString(),amount:{currency:r.currency,decimals:r.decimals,amountMinor:r.amount_minor},replayed});
 const prior=(await db.query<R>('SELECT reason,refunded_by,refunded_at,currency,decimals,amount_minor::text FROM demo_cash_refunds WHERE merchant_id=$1 AND sale_id=$2',[merchant,id.data])).rows[0];
 if(prior)return out(prior,true);
 if(sale.status!=='PAID')fail('ORDER_NOT_PAID',409);
 const row=(await db.query<R>('INSERT INTO demo_cash_refunds(merchant_id,sale_id,currency,decimals,amount_minor,reason,refunded_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING reason,refunded_by,refunded_at,currency,decimals,amount_minor::text',[merchant,id.data,sale.currency_code,sale.decimals,sale.total_minor,data.data.reason,actor])).rows[0]!;
 await audit(db,merchant,actor,'cash.demo_refund',id.data);
 return out(row,false);
}
export async function demoCashState(db:pg.PoolClient,merchant:string,role:string,saleId:string,status:string){
 const available=['owner','manager'].includes(role)&&await isDemoShop(db,merchant);
 const refund=(await db.query<{reason:string;refunded_by:string;refunded_at:Date;currency:string;decimals:number;amount_minor:string}>('SELECT reason,refunded_by,refunded_at,currency,decimals,amount_minor::text FROM demo_cash_refunds WHERE merchant_id=$1 AND sale_id=$2',[merchant,saleId])).rows[0];
 return {available,canRefund:available&&status==='PAID'&&!refund,refund:refund?{reason:refund.reason,by:refund.refunded_by,at:refund.refunded_at.toISOString(),amount:{currency:refund.currency,decimals:refund.decimals,amountMinor:refund.amount_minor}}:null};
}
