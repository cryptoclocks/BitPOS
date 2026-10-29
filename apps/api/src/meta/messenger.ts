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
 {kind:'agent_pay';pageId:string;psid:string;timestamp:number;quoteId:string}|
 {kind:'agent_add';pageId:string;psid:string;timestamp:number;productId:string}|
 {kind:'menu';pageId:string;psid:string;timestamp:number}|
 {kind:'my_orders';pageId:string;psid:string;timestamp:number}|
 {kind:'welcome';pageId:string;psid:string;timestamp:number}|
 {kind:'photo';pageId:string;psid:string;timestamp:number;url:string}|
 {kind:'cart_add';pageId:string;psid:string;timestamp:number;cart:string}|
 {kind:'cart_pay';pageId:string;psid:string;timestamp:number;cart:string}|
 {kind:'cart_menu';pageId:string;psid:string;timestamp:number;cart:string}|
 {kind:'book_start';pageId:string;psid:string;timestamp:number}|
 {kind:'book_set';pageId:string;psid:string;timestamp:number;date:string|null;time:string|null}|
 {kind:'book_cancel';pageId:string;psid:string;timestamp:number;reservationId:string};

export interface ParsedEvent {event:MessengerEvent;key:Buffer}

const STOP=new Set(['stop','ลบข้อมูล','ยกเลิก','เลิกติดตาม']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Product ids come from the inherited catalog and are not always version-4 UUIDs.
// A chat cart travels in the button payload itself ("productId:qty,…", at most 10 lines); the server re-prices it.
const CART=/^BITPOS_CART_(ADD|PAY|MENU):((?:[0-9a-f-]{36}:[0-9]{1,2})(?:,[0-9a-f-]{36}:[0-9]{1,2}){0,9})$/;
const ANY_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A photo the customer sent: only Messenger's own https CDN hosts (the model fetches it; nothing else is followed). */
export function messengerImageUrl(u:unknown):u is string{
 if(typeof u!=='string'||u.length>2048)return false;
 try{const x=new URL(u);return x.protocol==='https:'&&!x.username&&!x.password&&/(^|\.)(fbcdn\.net|fbsbx\.com)$/.test(x.hostname);}catch{return false;}
}
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
   else if(payload?.startsWith('BITPOS_AGENT_ADD:')&&ANY_UUID.test(payload.slice(17)))event={...base,kind:'agent_add',productId:payload.slice(17)};
   else if(payload==='BITPOS_GET_STARTED'||payload==='BITPOS_HELP')event={...base,kind:'welcome'};
   else if(payload==='BITPOS_MENU')event={...base,kind:'menu'};
   else if(payload&&CART.test(payload)){const [,k,cart]=payload.match(CART)!;event=k==='ADD'?{...base,kind:'cart_add',cart}:k==='PAY'?{...base,kind:'cart_pay',cart}:{...base,kind:'cart_menu',cart};}
   else if(payload==='BITPOS_MY_ORDERS')event={...base,kind:'my_orders'};
   else if(payload==='BITPOS_BOOK')event={...base,kind:'book_start'};
   else if(payload?.startsWith('BITPOS_BOOK_CANCEL:')&&ANY_UUID.test(payload.slice(19)))event={...base,kind:'book_cancel',reservationId:payload.slice(19)};
   else if(payload?.startsWith('BITPOS_BOOK_SET:')){
    const m=payload.slice(16).match(/^(?:date:(\d{4}-\d{2}-\d{2})|time:(\d{2}:\d{2})|at:(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}))$/);
    if(m)event={...base,kind:'book_set',date:m[1]??m[3]??null,time:m[2]??m[4]??null};
   }
   else if(!payload&&m.message?.is_echo!==true&&Array.isArray(m.message?.attachments)&&m.message.attachments[0]?.type==='image'&&messengerImageUrl(m.message.attachments[0]?.payload?.url))
    event={...base,kind:'photo',url:m.message.attachments[0].payload.url};
   else if(!payload&&m.message?.is_echo!==true&&typeof m.message?.text==='string'&&m.message.text.trim())event={...base,kind:'text',text:m.message.text.trim().slice(0,300)};
   if(!event)continue;
   const mid=typeof m.message?.mid==='string'?m.message.mid:'';
   const key=createHash('sha256').update(JSON.stringify([pageId,psid,timestamp,event.kind,ref??'',payload??'',mid])).digest();
   out.push({event,key});
  }
 }
 return out;
}

export type MessengerButton={type:'postback';title:string;payload:string}|{type:'web_url';title:string;url:string};
/** A card in a horizontal carousel (generic template): Messenger allows 10 cards, titles and subtitles of 80 characters, 3 buttons. */
export interface Card {title:string;subtitle?:string;imageUrl?:string;buttons:MessengerButton[]}
/** Messenger's receipt template; amounts are decimal numbers in the order's currency, rendered by Messenger. */
export interface Receipt {recipientName:string;orderNumber:string;currency:string;paymentMethod:string;timestamp:number;
 elements:{title:string;subtitle?:string;quantity:number;price:number;currency:string;imageUrl?:string}[];total:number;subtotal?:number;discount?:number}
/** Quick-reply chips under the last message (design C08/C15); each sends a postback-like payload. */
export type QuickReply={title:string;payload:string};
export type Outgoing=(
 /** eventUpdate: a booking notice that may arrive after the 24-hour window (CONFIRMED_EVENT_UPDATE tag). */
 {kind:'text';psid:string;text:string;eventUpdate?:boolean}|
 {kind:'buttons';psid:string;text:string;buttons:MessengerButton[]}|
 {kind:'cards';psid:string;cards:Card[]}|
 {kind:'receipt';psid:string;receipt:Receipt;fallbackText:string}|
 {kind:'image';psid:string;url:string})&{quick?:QuickReply[]};

const cut=(s:string,n:number)=>s.length<=n?s:s.slice(0,n-1)+'…';
function messagePayload(m:Outgoing):unknown{
 const p=basePayload(m) as Record<string,unknown>;
 return m.quick?.length?{...p,quick_replies:m.quick.slice(0,13).map(q=>({content_type:'text',title:cut(q.title,20),payload:q.payload}))}:p;
}
function basePayload(m:Outgoing):unknown{
 if(m.kind==='text')return {text:m.text};
 if(m.kind==='image')return {attachment:{type:'image',payload:{url:m.url,is_reusable:false}}};
 if(m.kind==='buttons')return {attachment:{type:'template',payload:{template_type:'button',text:cut(m.text,640),buttons:m.buttons.slice(0,3)}}};
 if(m.kind==='cards')return {attachment:{type:'template',payload:{template_type:'generic',image_aspect_ratio:'square',elements:m.cards.slice(0,10).map(c=>({title:cut(c.title,80),
  ...(c.subtitle?{subtitle:cut(c.subtitle,80)}:{}),...(c.imageUrl?{image_url:c.imageUrl}:{}),buttons:c.buttons.slice(0,3)}))}}};
 const r=m.receipt;
 return {attachment:{type:'template',payload:{template_type:'receipt',recipient_name:cut(r.recipientName,80),order_number:r.orderNumber,currency:r.currency,payment_method:r.paymentMethod,timestamp:String(r.timestamp),
  elements:r.elements.map(e=>({title:cut(e.title,80),...(e.subtitle?{subtitle:cut(e.subtitle,80)}:{}),quantity:e.quantity,price:e.price,currency:e.currency,...(e.imageUrl?{image_url:e.imageUrl}:{})})),
  summary:{...(r.subtotal!==undefined?{subtotal:r.subtotal}:{}),total_cost:r.total},...(r.discount?{adjustments:[{name:'ส่วนลดที่ร้านอนุมัติ / Approved offer',amount:r.discount}]}:{})}}};
}

export async function sendMessenger(config:MessengerConfig,message:Outgoing,fetchImpl:MessengerFetch=fetch):Promise<void>{
 if(!ID.test(message.psid))throw new MessengerError('PAYLOAD_INVALID');
 const payload=messagePayload(message);
 let res:Response;
 try{res=await fetchImpl(`${config.graphBase??'https://graph.facebook.com'}/${config.graphVersion}/me/messages`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(config.timeoutMs??10000),
  headers:{Authorization:`Bearer ${config.pageToken}`,'Content-Type':'application/json'},
  body:JSON.stringify({recipient:{id:message.psid},...(message.kind==='text'&&message.eventUpdate?{messaging_type:'MESSAGE_TAG',tag:'CONFIRMED_EVENT_UPDATE'}:{messaging_type:'RESPONSE'}),message:payload})});}
 catch{throw new MessengerError('SEND_FAILED');}
 // A receipt Messenger will not render still reaches the customer as plain text.
 if(!res.ok&&message.kind==='receipt')return sendMessenger(config,{kind:'text',psid:message.psid,text:message.fallbackText,quick:message.quick},fetchImpl);
 if(!res.ok)throw new MessengerError('SEND_FAILED');
}

export function messengerConfigFromEnv(env:Record<string,string|undefined>):MessengerConfig{
 const appSecret=env.META_MESSENGER_APP_SECRET,verifyToken=env.META_MESSENGER_VERIFY_TOKEN,pageToken=env.META_MESSENGER_PAGE_TOKEN,graphVersion=env.META_GRAPH_VERSION??'v24.0';
 if(!appSecret||!verifyToken||!pageToken||!/^v[0-9]{2}\.0$/.test(graphVersion))throw new MessengerError('CONFIGURATION_REQUIRED');
 return {appSecret,verifyToken,pageToken,graphVersion};
}
