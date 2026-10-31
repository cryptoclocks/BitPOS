// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// POST /paypal/webhooks — PayPal's notifications. Order of operations:
//   raw body (≤64 KiB) → offline signature check → inbox insert (unique event id) → 200 → process.
// Processing never trusts the event body for money: it finds the checkout from our custom_id and asks PayPal again.
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {pool,tenant} from '../db';
import {PayPalError} from './config';
import {webhookHeaders,webhookVerifier} from './webhook-verify';
import {paypalDeps,advanceCheckout,type PayPalDeps} from './checkout';

const PATH='/paypal/webhooks';
const MAX_BODY=64*1024;
let verify=webhookVerifier();
/** Tests replace the certificate source; production fetches PayPal's certificate (cached a day). */
export function setWebhookVerifier(v:ReturnType<typeof webhookVerifier>){verify=v;}

const custom=/^bitpos:v1:([0-9a-f-]{36}):([0-9a-f-]{36}):([0-9a-f-]{36})$/;
const eventSchema=z.object({id:z.string().regex(/^WH-[A-Za-z0-9-]{5,100}$/),event_type:z.string().regex(/^[A-Z_.]{3,80}$/),resource_type:z.string().max(40).optional(),
 resource:z.object({id:z.string().regex(/^[A-Z0-9]{10,30}$/),status:z.string().max(40).optional(),custom_id:z.string().max(255).optional(),invoice_id:z.string().max(127).optional(),
  amount:z.object({currency_code:z.string(),value:z.string()}).optional(),
  purchase_units:z.array(z.object({custom_id:z.string().max(255).optional()}).passthrough()).optional(),
  supplementary_data:z.object({related_ids:z.object({order_id:z.string().optional()}).partial()}).partial().optional(),
  links:z.array(z.object({href:z.string(),rel:z.string()})).optional()}).passthrough()}).passthrough();
type WebhookEvent=z.infer<typeof eventSchema>;

/** Only ids, statuses, amounts and our attribution are kept; nothing about the payer. */
function redact(e:WebhookEvent){
 const r=e.resource;
 return {id:e.id,eventType:e.event_type,resourceType:e.resource_type??null,resource:{id:r.id,status:r.status??null,customId:r.custom_id??r.purchase_units?.[0]?.custom_id??null,invoiceId:r.invoice_id??null,
  amount:r.amount??null,orderId:r.supplementary_data?.related_ids?.order_id??null,captureId:r.links?.find(l=>l.rel==='up'&&/\/captures\//.test(l.href))?.href.split('/').pop()??null}};
}
function json(res:ServerResponse,status:number,value:unknown){res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));}

export async function servePayPalWebhook(req:IncomingMessage,res:ServerResponse):Promise<boolean>{
 if(new URL(req.url??'/','http://localhost').pathname!==PATH)return false;
 if(req.method!=='POST'){json(res,405,{error:'METHOD_NOT_ALLOWED'});return true;}
 const d=paypalDeps();
 if(!d?.config.webhookId){json(res,503,{error:'WEBHOOK_NOT_CONFIGURED'});return true;}
 const chunks:Buffer[]=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY){json(res,413,{error:'REQUEST_TOO_LARGE'});return true;}chunks.push(Buffer.from(chunk));}
 const raw=Buffer.concat(chunks);
 const headers=webhookHeaders(n=>{const v=req.headers[n];return Array.isArray(v)?undefined:v;});
 if(!headers){json(res,400,{error:'WEBHOOK_INVALID'});return true;}
 try{await verify(headers,raw,d.config.webhookId);}
 catch(e){
  // An unreachable certificate is our problem (PayPal will retry); a bad signature is the sender's.
  if(e instanceof PayPalError&&e.code==='OUTCOME_UNKNOWN'){json(res,503,{error:'WEBHOOK_UNVERIFIED'});return true;}
  json(res,400,{error:'WEBHOOK_INVALID'});return true;
 }
 let event:WebhookEvent;
 try{event=eventSchema.parse(JSON.parse(raw.toString('utf8')));}catch{json(res,400,{error:'WEBHOOK_INVALID'});return true;}
 const r=redact(event);
 await pool.query('SELECT bitpos.paypal_webhook_receive($1,$2,$3,$4,$5,$6,$7)',[event.id,event.event_type,event.resource_type??null,event.resource.id,headers.transmissionId,createHash('sha256').update(raw).digest('hex'),r]);
 json(res,200,{received:true});
 // Best effort right away; the worker picks up anything left (inbox is durable).
 void processWebhookInbox(d,5).catch(()=>{/* retried by the worker */});
 return true;
}

type Claimed={event_id:string;event_type:string;resource_type:string|null;resource_id:string;redacted:ReturnType<typeof redact>;process_attempts:number};

/** Processes due inbox events. Returns how many were handled (done or failed). */
export async function processWebhookInbox(d:PayPalDeps,limit=20):Promise<number>{
 const claimed=(await pool.query<Claimed>('SELECT * FROM bitpos.paypal_webhook_claim($1)',[limit])).rows;
 for(const e of claimed){
  let merchant:string|null=null,orderId:string|null=null,checkoutId:string|null=null;
  try{
   const m=e.redacted.resource.customId?.match(custom);
   if(!m){await pool.query('SELECT bitpos.paypal_webhook_done($1,NULL,NULL,NULL,NULL)',[e.event_id]);continue;}// not a BitPOS payment: nothing to do
   [merchant,orderId,checkoutId]=[m[1],m[2],m[3]];
   const k=await tenant(merchant,async db=>(await db.query<{id:string;paypal_order_id:string|null}>('SELECT id,paypal_order_id FROM paypal_checkouts WHERE merchant_id=$1 AND order_id=$2 AND id=$3',[merchant,orderId,checkoutId])).rows[0]);
   if(!k)throw new Error('UNKNOWN_CHECKOUT');
   const t=e.event_type;
   if(t==='CHECKOUT.ORDER.APPROVED'){
    if(e.resource_id!==k.paypal_order_id)throw new Error('ORDER_ID_MISMATCH');
    await tenant(merchant,db=>db.query("UPDATE paypal_checkouts SET status='APPROVED',approved_at=coalesce(approved_at,clock_timestamp()) WHERE merchant_id=$1 AND id=$2 AND status='CREATED'",[merchant,checkoutId]));
    // The buyer may have closed the page before onApprove: capture now if the bill is still payable.
    await advanceCheckout(merchant,checkoutId,'capture',d);
   }else if(t.startsWith('PAYMENT.CAPTURE.')){
    if(t==='PAYMENT.CAPTURE.REFUNDED'||t==='PAYMENT.CAPTURE.REVERSED'){
     const captureId=e.redacted.resource.captureId??(t==='PAYMENT.CAPTURE.REVERSED'?e.resource_id:null);
     if(captureId){
      const amount=e.redacted.resource.amount?.currency_code==='USD'&&/^\d{1,7}\.\d{2}$/.test(e.redacted.resource.amount.value)?BigInt(e.redacted.resource.amount.value.replace('.','')):null;
      await tenant(merchant,db=>db.query(`INSERT INTO paypal_payment_events(merchant_id,capture_id,kind,amount_cents,source_event_id)
       SELECT $1,$2,$3,$4,$5 WHERE EXISTS(SELECT 1 FROM paypal_captures WHERE merchant_id=$1 AND capture_id=$2) ON CONFLICT(merchant_id,source_event_id) DO NOTHING`,[merchant,captureId,t.endsWith('REVERSED')?'REVERSED':'REFUNDED',amount?.toString()??null,e.event_id]));
     }
    }
    await advanceCheckout(merchant,checkoutId,'lookup',d,'capture_lookup');
   }
   await pool.query('SELECT bitpos.paypal_webhook_done($1,$2,$3,$4,NULL)',[e.event_id,merchant,orderId,checkoutId]);
  }catch(error){
   await pool.query('SELECT bitpos.paypal_webhook_done($1,$2,$3,$4,$5)',[e.event_id,merchant,orderId,checkoutId,String((error as Error).message??error).slice(0,200)]);
  }
 }
 return claimed.length;
}
