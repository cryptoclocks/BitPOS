// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Shared by sandbox-smoke.ts (CLI) and sdk-spike/server.ts (JS SDK v6 page). Phase 0 spike: prove PayPal Sandbox Orders v2 create → buyer approval → server capture → server lookup,
// and probe idempotency (PayPal-Request-Id) before writing the real adapter. Sandbox only; refuses anything else.
// Prints only ids, statuses, amounts and debug ids — never tokens, secrets or payer personal data.

import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

export const SANDBOX='https://api-m.sandbox.paypal.com';
const envFile=process.env.PAYPAL_ENV_FILE??join(homedir(),'.bitpos-paypal/paypal-sandbox.env');
export const env=Object.fromEntries(readFileSync(envFile,'utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]));
if(env.PAYPAL_ENVIRONMENT!=='sandbox'||env.PAYPAL_API_BASE_URL!==SANDBOX)throw Error('LIVE_MODE_REFUSED: only '+SANDBOX);
for(const k of ['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_MERCHANT_ID'])if(!env[k])throw Error('CONFIGURATION_REQUIRED: '+k+' is empty in '+envFile);
const stateDir=join(homedir(),'.bitpos-paypal/smoke');mkdirSync(stateDir,{recursive:true,mode:0o700});

let token:string|undefined;
async function accessToken(){
 if(token)return token;
 const r=await fetch(SANDBOX+'/v1/oauth2/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
  headers:{Authorization:'Basic '+Buffer.from(env.PAYPAL_CLIENT_ID+':'+env.PAYPAL_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},
  body:'grant_type=client_credentials'});
 const body:any=await r.json().catch(()=>({}));
 if(!r.ok||typeof body.access_token!=='string')throw Error(`AUTH_FAILED ${r.status} ${body.error??''}`);
 console.log(JSON.stringify({step:'oauth',status:r.status,scopeCount:String(body.scope??'').split(' ').length,expiresIn:body.expires_in,appId:body.app_id}));
 return token=body.access_token;
}
export async function call(method:string,path:string,requestId?:string,payload?:unknown){
 const headers:Record<string,string>={Authorization:'Bearer '+await accessToken(),'Content-Type':'application/json',Prefer:'return=representation'};
 if(requestId)headers['PayPal-Request-Id']=requestId;
 const r=await fetch(SANDBOX+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers,body:payload===undefined?undefined:JSON.stringify(payload)});
 const body:any=await r.json().catch(()=>({}));
 return {status:r.status,debugId:r.headers.get('paypal-debug-id'),body};
}
// Redacted view: no payer, no names, no addresses, no links except approve.
export function view(o:any){
 const pu=o?.purchase_units?.[0];const cap=pu?.payments?.captures?.[0];
 return {orderId:o?.id,orderStatus:o?.status,referenceId:pu?.reference_id,customId:pu?.custom_id,invoiceId:pu?.invoice_id,
  amount:pu?.amount,payeeMerchantId:pu?.payee?.merchant_id,
  capture:cap&&{id:cap.id,status:cap.status,reason:cap.status_details?.reason,amount:cap.amount,finalCapture:cap.final_capture,
   gross:cap.seller_receivable_breakdown?.gross_amount?.value,fee:cap.seller_receivable_breakdown?.paypal_fee?.value,net:cap.seller_receivable_breakdown?.net_amount?.value,
   customId:cap.custom_id,invoiceId:cap.invoice_id},
  approveUrl:o?.links?.find((l:any)=>l.rel==='payer-action'||l.rel==='approve')?.href,issues:o?.details?.map((d:any)=>d.issue),name:o?.name};
}
export const statePath=(id:string)=>join(stateDir,id+'.json');
export const load=(id:string)=>{if(!existsSync(statePath(id)))throw Error('No smoke state for '+id);return JSON.parse(readFileSync(statePath(id),'utf8'));};
export const save=(s:any)=>writeFileSync(statePath(s.orderId),JSON.stringify(s,null,1),{mode:0o600});

export function verify(s:any,o:any){
 const v=view(o),c=v.capture,fail:string[]=[];
 if(v.orderId!==s.orderId)fail.push('order id');
 if(v.referenceId!==s.referenceId)fail.push('reference_id');
 if(v.customId!==s.customId)fail.push('custom_id');
 if(v.invoiceId!==s.invoiceId)fail.push('invoice_id');
 if(v.payeeMerchantId!==env.PAYPAL_MERCHANT_ID)fail.push('payee merchant');
 if(!c)fail.push('no capture');else{
  if(c.status!=='COMPLETED')fail.push('capture status '+c.status+(c.reason?' ('+c.reason+')':''));
  if(c.amount?.currency_code!=='USD'||c.amount?.value!==s.value)fail.push('amount');
  if(c.gross!==undefined&&c.gross!==s.value)fail.push('gross');
  if(c.finalCapture!==true)fail.push('final_capture');
 }
 return fail;
}


export function newCheckout(value:string){
 if(!/^\d{1,5}\.\d{2}$/.test(value))throw Error('amount must have exactly 2 decimals');
 const checkoutId=randomUUID(),orderRef=randomUUID();
 const s={checkoutId,referenceId:orderRef,customId:`bitpos:v1:spike:${orderRef}:${checkoutId}`,invoiceId:'BP'+checkoutId.replaceAll('-',''),
  value,createRequestId:randomUUID(),captureRequestId:randomUUID()};
 const payload={intent:'CAPTURE',purchase_units:[{reference_id:s.referenceId,custom_id:s.customId,invoice_id:s.invoiceId,description:'BitPOS PayPal Café · Phase 0 sandbox spike',
  payee:{merchant_id:env.PAYPAL_MERCHANT_ID},amount:{currency_code:'USD',value,breakdown:{item_total:{currency_code:'USD',value}}},
  items:[{name:'Croissant (sample)',quantity:'1',unit_amount:{currency_code:'USD',value},category:'PHYSICAL_GOODS'}]}],
  payment_source:{paypal:{experience_context:{brand_name:'BitPOS PayPal Café',shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW',locale:'en-US',
   return_url:env.BITPOS_PAYPAL_PUBLIC_URL+'/paypal-spike/return',cancel_url:env.BITPOS_PAYPAL_PUBLIC_URL+'/paypal-spike/cancel'}}}};
 return {s,payload};
}
