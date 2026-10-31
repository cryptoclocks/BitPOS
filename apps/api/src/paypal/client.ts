// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// PayPal Orders v2 (intent CAPTURE) client for the sandbox. Facts verified on the real sandbox on 31 Oct 2026
// (paypal-hackathon/evidence/phase0-spike.md): create answers 200 + PAYER_ACTION_REQUIRED; capture replays with the same
// or a new PayPal-Request-Id answer 201 with the one existing capture; a duplicate invoice_id fails at capture.
// Outcome rule: network errors, timeouts, 429 and 5xx are OUTCOME_UNKNOWN (reconcile, never assume failure).
import {z} from 'zod';
import {PayPalError,type PayPalConfig} from './config';
import {centsToValue,valueToCents} from './money';

export type PayPalFetch=(url:string,init:RequestInit)=>Promise<Response>;
const MAX_BODY=256*1024;

const money=z.object({currency_code:z.string(),value:z.string()});
const captureSchema=z.object({id:z.string(),status:z.string(),status_details:z.object({reason:z.string()}).partial().optional(),amount:money,final_capture:z.boolean().optional(),
 custom_id:z.string().optional(),invoice_id:z.string().optional(),create_time:z.string().optional(),update_time:z.string().optional(),
 seller_receivable_breakdown:z.object({gross_amount:money,paypal_fee:money.optional(),net_amount:money.optional()}).partial().optional()});
const orderSchema=z.object({id:z.string().regex(/^[A-Z0-9]{10,30}$/),status:z.string(),
 purchase_units:z.array(z.object({reference_id:z.string().optional(),custom_id:z.string().optional(),invoice_id:z.string().optional(),amount:money.optional(),
  payee:z.object({merchant_id:z.string().optional()}).optional(),payments:z.object({captures:z.array(captureSchema).optional()}).optional()})).optional(),
 links:z.array(z.object({href:z.string(),rel:z.string()})).optional()});

export interface PayPalCapture {id:string;status:string;reason:string|null;currency:string;valueCents:bigint|null;finalCapture:boolean|null;customId:string|null;invoiceId:string|null;
 grossCents:bigint|null;feeCents:bigint|null;netCents:bigint|null;createTime:string|null;}
export interface PayPalOrder {id:string;status:string;debugId:string|null;payerActionUrl:string|null;
 units:{referenceId:string|null;customId:string|null;invoiceId:string|null;currency:string|null;valueCents:bigint|null;payeeMerchantId:string|null;captures:PayPalCapture[]}[];}

function capture(c:z.infer<typeof captureSchema>):PayPalCapture{
 const b=c.seller_receivable_breakdown;
 return {id:c.id,status:c.status,reason:c.status_details?.reason??null,currency:c.amount.currency_code,valueCents:valueToCents(c.amount.value),finalCapture:c.final_capture??null,
  customId:c.custom_id??null,invoiceId:c.invoice_id??null,grossCents:valueToCents(b?.gross_amount?.value),feeCents:valueToCents(b?.paypal_fee?.value),netCents:valueToCents(b?.net_amount?.value),createTime:c.create_time??null};
}
export function parseOrder(body:unknown,debugId:string|null):PayPalOrder{
 const o=orderSchema.safeParse(body);if(!o.success)throw new PayPalError('RESPONSE_INVALID',undefined,debugId);
 return {id:o.data.id,status:o.data.status,debugId,payerActionUrl:o.data.links?.find(l=>l.rel==='payer-action'||l.rel==='approve')?.href??null,
  units:(o.data.purchase_units??[]).map(u=>({referenceId:u.reference_id??null,customId:u.custom_id??null,invoiceId:u.invoice_id??null,currency:u.amount?.currency_code??null,
   valueCents:valueToCents(u.amount?.value),payeeMerchantId:u.payee?.merchant_id??null,captures:(u.payments?.captures??[]).map(capture)}))};
}

/** Attribution PayPal echoes back: custom_id ties the payment to merchant, order and checkout; invoice_id must be unique per PayPal account. */
export const customId=(merchantId:string,orderId:string,checkoutId:string)=>`bitpos:v1:${merchantId}:${orderId}:${checkoutId}`;
export const invoiceId=(checkoutId:string)=>'BP'+checkoutId.replaceAll('-','').toLowerCase();

export interface CreateOrderInput {
 merchantId:string;orderId:string;checkoutId:string;requestId:string;payeeMerchantId:string;
 amountCents:bigint;items?:{name:string;quantity:number;unitCents:bigint}[];description:string;
 brandName:string;locale:string;returnUrl:string;cancelUrl:string;
}
export function createOrderBody(i:CreateOrderInput){
 const value=centsToValue(i.amountCents);
 // Items are sent only when they add up exactly; otherwise PayPal gets the total alone.
 const items=i.items&&i.items.length&&i.items.every(x=>Number.isInteger(x.quantity)&&x.quantity>0&&x.unitCents>0n)&&i.items.reduce((s,x)=>s+x.unitCents*BigInt(x.quantity),0n)===i.amountCents
  ?i.items.map(x=>({name:x.name.slice(0,127),quantity:String(x.quantity),unit_amount:{currency_code:'USD',value:centsToValue(x.unitCents)},category:'PHYSICAL_GOODS'})):undefined;
 return {intent:'CAPTURE',purchase_units:[{reference_id:i.orderId,custom_id:customId(i.merchantId,i.orderId,i.checkoutId),invoice_id:invoiceId(i.checkoutId),description:i.description.slice(0,127),
  payee:{merchant_id:i.payeeMerchantId},amount:{currency_code:'USD',value,...(items?{breakdown:{item_total:{currency_code:'USD',value}}}:{})},...(items?{items}:{})}],
  payment_source:{paypal:{experience_context:{brand_name:i.brandName.slice(0,127),shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW',locale:i.locale,return_url:i.returnUrl,cancel_url:i.cancelUrl}}}};
}

export interface PayPalClient {
 createOrder(input:CreateOrderInput):Promise<PayPalOrder>;
 captureOrder(paypalOrderId:string,requestId:string):Promise<PayPalOrder>;
 getOrder(paypalOrderId:string):Promise<PayPalOrder>;
 getCapture(captureId:string):Promise<PayPalCapture&{debugId:string|null}>;
}

export function paypalClient(cfg:PayPalConfig,fetchImpl:PayPalFetch=fetch,now:()=>number=Date.now):PayPalClient{
 let token:{value:string;until:number}|null=null;
 async function read(r:Response):Promise<unknown>{
  const reader=r.body?.getReader();if(!reader)return null;const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const n=await reader.read();if(n.done)break;size+=n.value.length;if(size>MAX_BODY){await reader.cancel();throw new PayPalError('RESPONSE_TOO_LARGE',undefined,r.headers.get('paypal-debug-id'),r.status);}chunks.push(n.value);}}
  catch(e){if(e instanceof PayPalError)throw e;throw new PayPalError('OUTCOME_UNKNOWN',undefined,r.headers.get('paypal-debug-id'),r.status);}
  const text=Buffer.concat(chunks).toString('utf8');if(!text)return null;
  try{return JSON.parse(text);}catch{return undefined;}
 }
 async function send(url:string,init:RequestInit):Promise<Response>{
  try{return await fetchImpl(url,{...init,redirect:'error',signal:AbortSignal.timeout(cfg.timeoutMs)});}
  catch{throw new PayPalError('OUTCOME_UNKNOWN');}
 }
 async function accessToken(force=false):Promise<string>{
  if(!force&&token&&token.until>now())return token.value;
  const r=await send(cfg.apiBase+'/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(cfg.clientId+':'+cfg.clientSecret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
  const body:any=await read(r);
  if(r.status===429||r.status>=500)throw new PayPalError('OUTCOME_UNKNOWN',undefined,r.headers.get('paypal-debug-id'),r.status);
  if(!r.ok||typeof body?.access_token!=='string'||!Number.isFinite(body?.expires_in))throw new PayPalError('AUTH_FAILED',undefined,r.headers.get('paypal-debug-id'),r.status);
  token={value:body.access_token,until:now()+Math.max(0,body.expires_in-60)*1000};return token.value;
 }
 async function api(method:'GET'|'POST',path:string,requestId?:string,payload?:unknown):Promise<{body:unknown;debugId:string|null}>{
  for(let attempt=0;;attempt++){
   const headers:Record<string,string>={Authorization:'Bearer '+await accessToken(attempt>0),'Content-Type':'application/json',Prefer:'return=representation'};
   if(requestId)headers['PayPal-Request-Id']=requestId;
   const r=await send(cfg.apiBase+path,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload)});
   const debugId=r.headers.get('paypal-debug-id');
   // An expired or revoked token is retried once with a fresh one; the request id keeps the retry idempotent.
   if(r.status===401&&attempt===0){await r.body?.cancel();token=null;continue;}
   const body:any=await read(r);
   if(r.status===429||r.status>=500)throw new PayPalError('OUTCOME_UNKNOWN',undefined,debugId,r.status);
   if(r.status===401||r.status===403)throw new PayPalError('AUTH_FAILED',undefined,debugId,r.status);
   if(!r.ok)throw new PayPalError('REJECTED',typeof body?.details?.[0]?.issue==='string'?body.details[0].issue:typeof body?.name==='string'?body.name:undefined,debugId,r.status);
   if(body===undefined||body===null)throw new PayPalError('RESPONSE_INVALID',undefined,debugId,r.status);
   return {body,debugId};
  }
 }
 const id=(v:string,what:string)=>{if(!/^[A-Z0-9]{10,30}$/.test(v))throw new PayPalError('RESPONSE_INVALID',what);return v;};
 return {
  async createOrder(input){const r=await api('POST','/v2/checkout/orders',input.requestId,createOrderBody(input));return parseOrder(r.body,r.debugId);},
  async captureOrder(paypalOrderId,requestId){const r=await api('POST',`/v2/checkout/orders/${id(paypalOrderId,'ORDER_ID')}/capture`,requestId,{});return parseOrder(r.body,r.debugId);},
  async getOrder(paypalOrderId){const r=await api('GET',`/v2/checkout/orders/${id(paypalOrderId,'ORDER_ID')}`);return parseOrder(r.body,r.debugId);},
  async getCapture(captureId){const r=await api('GET',`/v2/payments/captures/${id(captureId,'CAPTURE_ID')}`);const c=captureSchema.safeParse(r.body);if(!c.success)throw new PayPalError('RESPONSE_INVALID',undefined,r.debugId);return {...capture(c.data),debugId:r.debugId};},
 };
}
