// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Messenger ordering for the PayPal shop. A guest writes to the shop's Facebook Page ("two iced lattes and a
// croissant"); the shop's AI (the existing table ordering assistant, interpretCoffee) turns it into a cart of real,
// available menu items; the server prices it through the normal table order path (quote → order, routed to the table's
// screen) and replies with a "Pay with PayPal" button that opens the existing pay page. After PayPal capture is
// verified (the normal PayPal flow: server capture + verification, webhooks, reconcile) the worker sends one "paid"
// reply. Nothing here moves money or trusts the chat for amounts.
//   GET  /paypal/messenger/webhook   Meta verification handshake (hub.verify_token)
//   POST /paypal/messenger/webhook   messages; X-Hub-Signature-256 (HMAC-SHA256 with the app secret) over the raw body
// Config (private PayPal env): BITPOS_PAYPAL_MESSENGER_PAGE_TOKEN, _APP_SECRET, _VERIFY_TOKEN, _TABLE_ENTRY (the table
// entry token the chat orders for), optional _GRAPH_VERSION. Without them the route answers 503 and nothing else runs.
// Privacy: message text is never stored; senders are stored as a salted hash for dedup/rate limits, and the raw
// page-scoped id only on a chat-created bill until its single paid reply (then erased). Replies stay inside the
// conversation the guest started (Messenger 24-hour response window).
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {z} from 'zod';
import {pool,tenant} from '../db';
import {tableRequest} from '../table-ordering';
import {interpretCoffee} from '../coffee-provider';
import {customerOrigin} from '../config';

const PATH='/paypal/messenger/webhook';
const MAX_BODY=64*1024,MAX_PER_MINUTE=6;
export interface MessengerConfig {page:string;secret:string;verify:string;entry:string;graph:string;}
export function messengerConfig(env:NodeJS.ProcessEnv=process.env):MessengerConfig|null{
 const page=env.BITPOS_PAYPAL_MESSENGER_PAGE_TOKEN?.trim(),secret=env.BITPOS_PAYPAL_MESSENGER_APP_SECRET?.trim(),verify=env.BITPOS_PAYPAL_MESSENGER_VERIFY_TOKEN?.trim(),entry=env.BITPOS_PAYPAL_MESSENGER_TABLE_ENTRY?.trim();
 if(!page||!secret||!verify||!entry||!/^[A-Za-z0-9_-]{43}$/.test(entry))return null;
 const graph=env.BITPOS_PAYPAL_MESSENGER_GRAPH_VERSION?.trim()||'v21.0';if(!/^v\d{1,2}\.\d$/.test(graph))return null;
 return {page,secret,verify,entry,graph};
}
export type MessengerSend=(recipient:string,message:Record<string,unknown>)=>Promise<void>;
let override:MessengerSend|null=null;
/** Tests capture replies instead of calling the Graph API. */
export function setMessengerSender(s:MessengerSend|null){override=s;}
function graphSend(c:MessengerConfig):MessengerSend{
 return async(recipient,message)=>{
  const r=await fetch(`https://graph.facebook.com/${c.graph}/me/messages`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.page},body:JSON.stringify({recipient:{id:recipient},messaging_type:'RESPONSE',message})});
  await r.body?.cancel();if(!r.ok)throw Error('MESSENGER_SEND_'+r.status);
 };
}
const send=(c:MessengerConfig)=>override??graphSend(c);
type Interpret=typeof interpretCoffee;
let interpreter:Interpret=interpretCoffee;
/** Tests use a scripted interpreter (no AI call); production uses the shop's table ordering assistant. */
export function setMessengerInterpreter(i:Interpret|null){interpreter=i??interpretCoffee;}

export function validSignature(secret:string,raw:Buffer,header:string|undefined){
 const m=header?.match(/^sha256=([0-9a-f]{64})$/);if(!m)return false;
 const expected=createHmac('sha256',secret).update(raw).digest();const got=Buffer.from(m[1],'hex');
 return got.length===expected.length&&timingSafeEqual(got,expected);
}
function json(res:ServerResponse,status:number,value:unknown){res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));}

const eventSchema=z.object({object:z.literal('page'),entry:z.array(z.object({messaging:z.array(z.object({
 sender:z.object({id:z.string().regex(/^[0-9]{5,40}$/)}),
 message:z.object({mid:z.string().min(1).max(200),text:z.string().max(1000).optional(),is_echo:z.boolean().optional(),quick_reply:z.object({payload:z.string().max(100)}).optional()}).passthrough().optional(),
 postback:z.object({mid:z.string().max(200).optional(),payload:z.string().max(100)}).passthrough().optional(),
}).passthrough()).optional()}).passthrough())}).passthrough();

type Product={id:string;name:string;nameEn:string;available:number;imageUrl?:string|null;unitPrice?:{amountMinor:string;decimals:number;currency:string}|null;promotion?:unknown};
const money=(m?:{amountMinor:string;decimals:number;currency:string}|null)=>m?`${m.currency} ${(Number(m.amountMinor)/10**m.decimals).toFixed(Math.min(m.decimals,2))}`:'—';
const base=(c:MessengerConfig)=>`/api/table/${c.entry}`;

async function menu(c:MessengerConfig){return await tableRequest(base(c),'GET',undefined) as {tableLabel:string;menu:{products:Product[]};online:boolean;available:boolean};}

async function replyMenu(c:MessengerConfig,to:string){
 const m=await menu(c);const list=m.menu.products.filter(p=>p.available>0&&p.unitPrice).slice(0,8).map(p=>`• ${p.nameEn} — ${money(p.unitPrice)}${p.promotion?' (offer)':''}`).join('\n');
 await send(c)(to,{text:`Hi! You're ordering for ${m.tableLabel} at BitPOS PayPal Café (PayPal Sandbox, test money).\n\n${list}\n\nJust tell me what you'd like, for example: "two iced lattes and a croissant".`});
}

/** One chat message → AI cart → priced bill at the table → "Pay with PayPal" button. Returns the order id, if any. */
export async function handleOrderText(c:MessengerConfig,to:string,text:string):Promise<string|null>{
 const m=await menu(c);
 const products=m.menu.products.filter(p=>p.available>0&&p.unitPrice);
 const candidate=await interpreter(text,products.map(p=>({id:p.id,name:p.name,nameEn:p.nameEn,available:p.available})),false);
 if(candidate.kind!=='proposal'){await send(c)(to,{text:candidate.message});return null;}
 const items=candidate.items.map(i=>({productId:i.productId,qty:i.qty}));
 const visit=await tableRequest(base(c)+'/visit','POST',{requestId:randomUUID()}) as {visitToken:string};
 const q=await tableRequest(`${base(c)}/visit/${visit.visitToken}/quotes`,'POST',{items,collection:'table',confirmJoin:true}) as {quote:{id:string;priceVersion:string;total:{amountMinor:string;decimals:number;currency:string}}};
 const o=await tableRequest(`${base(c)}/visit/${visit.visitToken}/orders`,'POST',{quoteId:q.quote.id,priceVersion:q.quote.priceVersion,idempotencyKey:randomUUID()}) as {order:{id:string}};
 const merchant=(await pool.query('SELECT bitpos.resolve_table_entry($1) AS merchant',[c.entry])).rows[0].merchant as string;
 const row=(await tenant(merchant,db=>db.query('SELECT access_token,quote_expires_at FROM orders WHERE merchant_id=$1 AND id=$2',[merchant,o.order.id]))).rows[0] as {access_token:string;quote_expires_at:Date};const token=row.access_token;
 const minutes=Math.max(1,Math.round((new Date(row.quote_expires_at).getTime()-Date.now())/60000));
 await pool.query('SELECT bitpos.paypal_messenger_remember($1,$2,$3,$4)',[merchant,o.order.id,to,m.tableLabel]);
 const count=items.reduce((n,i)=>n+i.qty,0),total=money(q.quote.total);
 const lines=items.map(i=>{const p=products.find(p=>p.id===i.productId)!;return `${p.nameEn} × ${i.qty}`;}).join(' · ');
 const first=products.find(p=>p.id===items[0].productId);
 await send(c)(to,{attachment:{type:'template',payload:{template_type:'generic',elements:[{
  title:`Cart · ${count} item${count===1?'':'s'} · ${total}`.slice(0,80),subtitle:`${lines} · ${m.tableLabel} · pay within ${minutes} min`.slice(0,80),
  ...(first?.imageUrl&&/^\/images\/menu\/[a-z0-9-]+\.jpg$/.test(first.imageUrl)?{image_url:customerOrigin+first.imageUrl}:{}),
  buttons:[{type:'web_url',url:`${customerOrigin}/pay/${token}`,title:'Pay with PayPal'}]}]}}});
 return o.order.id;
}

const failureText=(code:string)=>code==='DEVICE_OFFLINE'?'The table screen is reconnecting. Please try again in a minute.':code==='DEVICE_BUSY'?'Someone is ordering at this table right now. Please try again in a minute.':code.startsWith('PROVIDER')||code==='CONFIGURATION_REQUIRED'?'Sorry, the ordering assistant is busy. Please try again shortly, or order from the table menu.':'Sorry, I could not place that order. Please try again.';

export async function handleMessengerEvent(c:MessengerConfig,body:unknown){
 const event=eventSchema.parse(body);
 for(const e of event.entry)for(const m of e.messaging??[]){
  if(m.message?.is_echo)continue;
  const id=m.message?.mid??m.postback?.mid??`postback:${m.sender.id}:${m.postback?.payload}:${Date.now()}`;
  const text=m.message?.text?.trim(),payload=m.postback?.payload??m.message?.quick_reply?.payload;
  if(!text&&!payload)continue;
  const senderHash=createHash('sha256').update(c.secret+':'+m.sender.id).digest('hex');
  const admitted=(await pool.query('SELECT bitpos.paypal_messenger_receive($1,$2,$3) AS r',[id,senderHash,MAX_PER_MINUTE])).rows[0].r as string;
  if(admitted!=='new')continue;
  try{
   if(payload==='GET_STARTED'||!text||/^(hi|hello|hey|menu|start|สวัสดี|เมนู)\b/i.test(text))await replyMenu(c,m.sender.id);
   else await handleOrderText(c,m.sender.id,text);
  }catch(error){
   const code=(error as {code?:string}).code??'UNKNOWN';
   try{await send(c)(m.sender.id,{text:failureText(code)});}catch{/* the guest can retry; nothing else to do */}
  }
 }
}

export async function serveMessengerWebhook(req:IncomingMessage,res:ServerResponse):Promise<boolean>{
 const url=new URL(req.url??'/','http://localhost');if(url.pathname!==PATH)return false;
 const c=messengerConfig();if(!c){json(res,503,{error:'MESSENGER_NOT_CONFIGURED'});return true;}
 if(req.method==='GET'){
  const ok=url.searchParams.get('hub.mode')==='subscribe'&&url.searchParams.get('hub.verify_token')===c.verify;const challenge=url.searchParams.get('hub.challenge')??'';
  if(!ok||!/^[A-Za-z0-9_-]{1,200}$/.test(challenge)){json(res,403,{error:'FORBIDDEN'});return true;}
  res.statusCode=200;res.setHeader('Content-Type','text/plain');res.end(challenge);return true;
 }
 if(req.method!=='POST'){json(res,405,{error:'METHOD_NOT_ALLOWED'});return true;}
 const chunks:Buffer[]=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY){json(res,413,{error:'REQUEST_TOO_LARGE'});return true;}chunks.push(Buffer.from(chunk));}
 const raw=Buffer.concat(chunks);const sig=req.headers['x-hub-signature-256'];
 if(!validSignature(c.secret,raw,Array.isArray(sig)?undefined:sig)){json(res,401,{error:'SIGNATURE_INVALID'});return true;}
 let body:unknown;try{body=JSON.parse(raw.toString('utf8'));eventSchema.parse(body);}catch{json(res,400,{error:'EVENT_INVALID'});return true;}
 // Meta expects a fast 200; the order work continues after the response (messages are deduplicated by id).
 json(res,200,{received:true});
 void handleMessengerEvent(c,body).catch(error=>console.error('Messenger event failed:',(error as Error).message));
 return true;
}

/** Worker: one "paid" reply per chat-created bill once PayPal capture is verified (bill PAID). */
export async function notifyPaidMessenger(){
 const c=messengerConfig();if(!c)return 0;
 const db=await pool.connect();let n=0;
 try{
  await db.query('BEGIN');
  const due=(await db.query<{order_id:string;sender_id:string;table_label:string}>('SELECT * FROM bitpos.paypal_messenger_due(10)')).rows;
  for(const d of due){
   try{await send(c)(d.sender_id,{text:`Paid with PayPal ✓ Your order is sent to the kitchen for ${d.table_label}. (PayPal Sandbox, test money)`});n++;}
   catch(error){console.error('Messenger paid reply failed:',(error as Error).message);}
   await db.query('SELECT bitpos.paypal_messenger_done($1)',[d.order_id]);
  }
  await db.query('COMMIT');
 }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
 return n;
}
