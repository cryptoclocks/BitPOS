// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Messenger Platform adapter: webhook signature check, event normalisation and the Send API.
// Only the fields BitPOS needs are read; message text is never stored (it is passed in memory to the
// ordering agent for consented customers only).
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';

export class MessengerError extends Error {constructor(readonly code:'SIGNATURE_INVALID'|'PAYLOAD_INVALID'|'SEND_FAILED'|'CONFIGURATION_REQUIRED'){super(code);}}

export interface MessengerConfig {appSecret:string;verifyToken:string;pageToken:string;graphVersion:string;graphBase?:string;timeoutMs?:number}
export type MessengerFetch=(input:string,init:RequestInit)=>Promise<Response>;

const ID=/^[0-9]{5,25}$/;
export const REF=/^[A-Za-z0-9_-]{16,64}$/;

/** Meta signs the exact raw body with the app secret: `X-Hub-Signature-256: sha256=<hex>`. */
export function verifyMessengerSignature(rawBody:Buffer,header:string|undefined,appSecret:string):void{
 const m=header?.match(/^sha256=([0-9a-f]{64})$/);
 if(!m)throw new MessengerError('SIGNATURE_INVALID');
 const expected=createHmac('sha256',appSecret).update(rawBody).digest();
 if(!timingSafeEqual(Buffer.from(m[1],'hex'),expected))throw new MessengerError('SIGNATURE_INVALID');
}

/** GET subscription handshake; returns the challenge to echo, or null to refuse. */
export function verifySubscription(params:URLSearchParams,verifyToken:string):string|null{
 const token=params.get('hub.verify_token')??'',challenge=params.get('hub.challenge')??'';
 if(params.get('hub.mode')!=='subscribe'||!/^[A-Za-z0-9_-]{1,128}$/.test(challenge))return null;
 const a=createHash('sha256').update(token).digest(),b=createHash('sha256').update(verifyToken).digest();
 return timingSafeEqual(a,b)?challenge:null;
}

export type MessengerEvent=
 {kind:'referral';pageId:string;psid:string;timestamp:number;ref:string}|
 {kind:'consent';pageId:string;psid:string;timestamp:number;requestId:string;accept:boolean}|
 {kind:'revoke';pageId:string;psid:string;timestamp:number}|
 {kind:'text';pageId:string;psid:string;timestamp:number;text:string}|
 {kind:'agent_pay';pageId:string;psid:string;timestamp:number;quoteId:string};

export interface ParsedEvent {event:MessengerEvent;key:Buffer}

const STOP=new Set(['stop','ลบข้อมูล','ยกเลิก','เลิกติดตาม']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Turns a `page` webhook body into the BitPOS events it carries; anything else is ignored. */
export function parseMessengerWebhook(body:unknown):ParsedEvent[]{
 const b=body as any;
 if(b?.object!=='page'||!Array.isArray(b.entry))throw new MessengerError('PAYLOAD_INVALID');
 const out:ParsedEvent[]=[];
 for(const entry of b.entry.slice(0,50)){
  if(!Array.isArray(entry?.messaging))continue;
  for(const m of entry.messaging.slice(0,100)){
   const pageId=String(m?.recipient?.id??''),psid=String(m?.sender?.id??''),timestamp=Number(m?.timestamp);
   if(!ID.test(pageId)||!ID.test(psid)||!Number.isSafeInteger(timestamp)||String(entry.id)!==pageId)continue;
   const base={pageId,psid,timestamp};let event:MessengerEvent|null=null;
   const ref=m.referral?.ref??m.postback?.referral?.ref;
   const payload=typeof m.postback?.payload==='string'?m.postback.payload:typeof m.message?.quick_reply?.payload==='string'?m.message.quick_reply.payload:null;
   const consent=payload?.match(/^BITPOS_CONSENT_(ACCEPT|DECLINE):([0-9a-f-]{36})$/);
   if(consent&&UUID.test(consent[2]))event={...base,kind:'consent',requestId:consent[2],accept:consent[1]==='ACCEPT'};
   else if(payload==='BITPOS_REVOKE'||typeof m.message?.text==='string'&&STOP.has(m.message.text.trim().toLowerCase()))event={...base,kind:'revoke'};
   else if(typeof ref==='string'&&REF.test(ref))event={...base,kind:'referral',ref};
   else if(payload?.startsWith('BITPOS_AGENT_PAY:')&&UUID.test(payload.slice(17)))event={...base,kind:'agent_pay',quoteId:payload.slice(17)};
   else if(!payload&&m.message?.is_echo!==true&&typeof m.message?.text==='string'&&m.message.text.trim())event={...base,kind:'text',text:m.message.text.trim().slice(0,300)};
   if(!event)continue;
   const mid=typeof m.message?.mid==='string'?m.message.mid:'';
   const key=createHash('sha256').update(JSON.stringify([pageId,psid,timestamp,event.kind,ref??'',payload??'',mid])).digest();
   out.push({event,key});
  }
 }
 return out;
}

export type Outgoing=
 {kind:'text';psid:string;text:string}|
 {kind:'buttons';psid:string;text:string;buttons:({type:'postback';title:string;payload:string}|{type:'web_url';title:string;url:string})[]};

export async function sendMessenger(config:MessengerConfig,message:Outgoing,fetchImpl:MessengerFetch=fetch):Promise<void>{
 if(!ID.test(message.psid))throw new MessengerError('PAYLOAD_INVALID');
 const payload=message.kind==='text'?{text:message.text}:{attachment:{type:'template',payload:{template_type:'button',text:message.text,buttons:message.buttons}}};
 let res:Response;
 try{res=await fetchImpl(`${config.graphBase??'https://graph.facebook.com'}/${config.graphVersion}/me/messages`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(config.timeoutMs??10000),
  headers:{Authorization:`Bearer ${config.pageToken}`,'Content-Type':'application/json'},
  body:JSON.stringify({recipient:{id:message.psid},messaging_type:'RESPONSE',message:payload})});}
 catch{throw new MessengerError('SEND_FAILED');}
 if(!res.ok)throw new MessengerError('SEND_FAILED');
}

export function messengerConfigFromEnv(env:Record<string,string|undefined>):MessengerConfig{
 const appSecret=env.META_MESSENGER_APP_SECRET,verifyToken=env.META_MESSENGER_VERIFY_TOKEN,pageToken=env.META_MESSENGER_PAGE_TOKEN,graphVersion=env.META_GRAPH_VERSION??'v24.0';
 if(!appSecret||!verifyToken||!pageToken||!/^v[0-9]{2}\.0$/.test(graphVersion))throw new MessengerError('CONFIGURATION_REQUIRED');
 return {appSecret,verifyToken,pageToken,graphVersion};
}
