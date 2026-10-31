// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Offline PayPal webhook signature check (PayPal "self-verification"): SHA256withRSA over
// `${transmissionId}|${transmissionTime}|${webhookId}|${crc32(rawBody) as decimal}` with the public key of the certificate at
// paypal-cert-url. Works for real and simulator events and never re-serializes the body. A valid signature only means
// "PayPal sent this"; the handler must still fetch the order/capture from PayPal before changing anything.
import {X509Certificate,verify} from 'node:crypto';
import {crc32} from 'node:zlib';
import {PayPalError} from './config';

export type CertFetch=(url:string)=>Promise<string>;
export interface WebhookHeaders {transmissionId:string;transmissionTime:string;certUrl:string;transmissionSig:string;authAlgo:string|null;}
const MAX_CERT=16*1024;

/** Header names are case-insensitive; returns null if any required header is missing or oversized. */
export function webhookHeaders(get:(name:string)=>string|null|undefined):WebhookHeaders|null{
 const v=(n:string,max=2048)=>{const x=get(n);return typeof x==='string'&&x.length>0&&x.length<=max?x:null;};
 const transmissionId=v('paypal-transmission-id',128),transmissionTime=v('paypal-transmission-time',64),certUrl=v('paypal-cert-url'),transmissionSig=v('paypal-transmission-sig',4096);
 if(!transmissionId||!transmissionTime||!certUrl||!transmissionSig)return null;
 return {transmissionId,transmissionTime,certUrl,transmissionSig,authAlgo:v('paypal-auth-algo',64)};
}

/** Only https certificates served by PayPal hosts are accepted ("api.paypal.com.evil.com" is not). */
export function allowedCertUrl(raw:string):boolean{
 let u:URL;try{u=new URL(raw);}catch{return false;}
 return u.protocol==='https:'&&!u.username&&!u.password&&(u.port===''||u.port==='443')&&(u.hostname==='paypal.com'||u.hostname.endsWith('.paypal.com'));
}

export const defaultCertFetch:CertFetch=async url=>{
 let r:Response;try{r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(5000)});}catch{throw new PayPalError('OUTCOME_UNKNOWN','CERT_FETCH');}
 if(!r.ok){await r.body?.cancel();throw new PayPalError('REJECTED','CERT_FETCH');}
 const text=await r.text();if(text.length>MAX_CERT)throw new PayPalError('REJECTED','CERT_TOO_LARGE');return text;
};

export function webhookVerifier(fetchCert:CertFetch=defaultCertFetch,now:()=>number=Date.now){
 const cache=new Map<string,{cert:X509Certificate;until:number}>();
 async function certificate(url:string){
  const hit=cache.get(url);if(hit&&hit.until>now())return hit.cert;
  let cert:X509Certificate;try{cert=new X509Certificate(await fetchCert(url));}catch(e){if(e instanceof PayPalError)throw e;throw new PayPalError('REJECTED','CERT_INVALID');}
  cache.set(url,{cert,until:now()+24*3600_000});return cert;
 }
 /** Throws PayPalError REJECTED (WEBHOOK_SIGNATURE, CERT_URL, CERT_EXPIRED, …) unless the raw body was signed by PayPal for this webhook id. */
 return async function verifyWebhook(h:WebhookHeaders,rawBody:Buffer,webhookId:string):Promise<void>{
  if(!allowedCertUrl(h.certUrl))throw new PayPalError('REJECTED','CERT_URL');
  if(h.authAlgo!==null&&h.authAlgo!=='SHA256withRSA')throw new PayPalError('REJECTED','AUTH_ALGO');
  const cert=await certificate(h.certUrl);const t=now();
  if(t<Date.parse(cert.validFrom)||t>Date.parse(cert.validTo))throw new PayPalError('REJECTED','CERT_EXPIRED');
  const message=`${h.transmissionId}|${h.transmissionTime}|${webhookId}|${crc32(rawBody)>>>0}`;
  let ok=false;try{ok=verify('sha256',Buffer.from(message),cert.publicKey,Buffer.from(h.transmissionSig,'base64'));}catch{ok=false;}
  if(!ok)throw new PayPalError('REJECTED','WEBHOOK_SIGNATURE');
 };
}
