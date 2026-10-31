// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Shared test fixture: an in-memory PayPal Sandbox that behaves like the real one recorded in
// paypal-hackathon/evidence/phase0-spike.md, and a BitPOS shop with PayPal enabled on the disposable database.
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {tableFixture} from './backend-table-fixture';
import {PayPalError,type PayPalConfig} from '../apps/api/src/paypal/config';
import type {PayPalClient,PayPalOrder,CreateOrderInput} from '../apps/api/src/paypal/client';
import {customId,invoiceId} from '../apps/api/src/paypal/client';
void assert;
export const PAYEE='7W75A4XNV2GZ4';
export const config:PayPalConfig={apiBase:'https://api-m.sandbox.paypal.com',clientId:'A'.repeat(80),clientSecret:'S'.repeat(80),merchantId:PAYEE,webhookId:null,timeoutMs:1000};

/** In-memory PayPal Sandbox. `fail` injects one failure into the next matching call. */
export function fakePayPal(){
 const uid=()=>randomBytes(8).toString('hex').toUpperCase().slice(0,15);const orders=new Map<string,{input:CreateOrderInput;status:string;captureId:string|null;value:bigint;payee:string}>();
 const calls:string[]=[];const fail:{create?:PayPalError;capture?:PayPalError|'after'}= {};
 const byRequest=new Map<string,string>();
 const shape=(id:string):PayPalOrder=>{const o=orders.get(id)!;const cid=customId(o.input.merchantId,o.input.orderId,o.input.checkoutId);
  return {id,status:o.status,debugId:'dbg',payerActionUrl:'https://www.sandbox.paypal.com/checkoutnow?token='+id,units:[{referenceId:o.input.orderId,customId:cid,invoiceId:invoiceId(o.input.checkoutId),currency:'USD',valueCents:o.input.amountCents,payeeMerchantId:o.payee,
   captures:o.captureId?[{id:o.captureId,status:'COMPLETED',reason:null,currency:'USD',valueCents:o.value,finalCapture:true,customId:cid,invoiceId:invoiceId(o.input.checkoutId),grossCents:o.value,feeCents:62n,netCents:o.value-62n,createTime:null}]:[]}]};};
 const client:PayPalClient={
  async createOrder(input){calls.push('create');if(fail.create){const e=fail.create;fail.create=undefined;throw e;}
   const replay=byRequest.get(input.requestId);if(replay)return shape(replay);
   const id='PP'+uid();orders.set(id,{input,status:'PAYER_ACTION_REQUIRED',captureId:null,value:input.amountCents,payee:input.payeeMerchantId});byRequest.set(input.requestId,id);return shape(id);},
  async captureOrder(id){calls.push('capture');const o=orders.get(id)!;
   if(fail.capture&&fail.capture!=='after'){const e=fail.capture;fail.capture=undefined;throw e;}
   if(o.status!=='APPROVED'&&o.status!=='COMPLETED')throw new PayPalError('REJECTED','ORDER_NOT_APPROVED','dbg',422);
   if(!o.captureId){o.captureId='CP'+uid();o.status='COMPLETED';}
   if(fail.capture==='after'){fail.capture=undefined;throw new PayPalError('OUTCOME_UNKNOWN');}
   return shape(id);},
  async getOrder(id){calls.push('get');return shape(id);},
  async getCapture(){throw new Error('unused');}
 };
 return {client,calls,fail,approve:(id:string)=>{orders.get(id)!.status='APPROVED';},tamper:(id:string,f:(o:{value:bigint;payee:string})=>void)=>f(orders.get(id)!)};
}

export async function setupPayPalShop(){
 const f=await tableFixture(10);
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 await admin.query("INSERT INTO bitpos.paypal_merchant_settings(merchant_id,enabled,payee_merchant_id,updated_by) VALUES($1,true,$2,'test')",[f.merchant,PAYEE]);await admin.end();
 const pp=fakePayPal();const checkout=await import('../apps/api/src/paypal/checkout');checkout.setPayPalDeps({config,client:pp.client});
 async function bill(qty=2){const created=await f.create(await f.quote(qty));return f.tenant(f.merchant,async db=>(await db.query('SELECT id,access_token FROM orders WHERE merchant_id=$1 AND id=$2',[f.merchant,created.order.id])).rows[0] as {id:string;access_token:string});}
 const state=(orderId:string)=>f.tenant(f.merchant,async db=>({
  order:(await db.query('SELECT status FROM orders WHERE id=$1',[orderId])).rows[0].status,
  stock:(await db.query('SELECT stock,reserved FROM products WHERE id=$1',[f.product])).rows[0],
  checkouts:(await db.query('SELECT status FROM paypal_checkouts WHERE order_id=$1 ORDER BY created_at',[orderId])).rows.map(r=>r.status),
  settlements:Number((await db.query('SELECT count(*) FROM paypal_settlements WHERE order_id=$1',[orderId])).rows[0].count)}));
 return {f,pp,checkout,bill,state};
}

