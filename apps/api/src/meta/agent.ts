// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Ordering by chat in Messenger, for customers who consented. Muse Spark reads the customer's message and
// picks one step from a server-built enum (show menu / quote a listed product / help); it never writes a
// price. The server prices the quote and shows the total; the customer presses Pay, gets a hosted Stripe
// Checkout (test mode), and the receipt arrives after a signed webhook or a server-side lookup.
// Credit guard: each customer gets a small number of model calls per hour; beyond that, or without a model,
// a deterministic matcher (menu names in the message) does the same job at no cost.
import {z} from 'zod';
import type {MetaRouter} from '../../../../packages/meta-ai/src/router';
import {MetaRouterError} from '../../../../packages/meta-ai/src/types';
import {AgentOrderError,createQuote,listCustomerOrders,listMenu,startAgentCheckout,type AgentDeps,type MenuItem,type QuoteView} from './agent-orders';
import type {AgentRequest} from './identity';
import type {Card,Outgoing} from './messenger';

export interface ChatAgentDeps extends AgentDeps {router:MetaRouter|null;publicOrigin:string;modelCallsPerHour?:number}
export type AgentStep={action:'quote';productId:string;quantity:number;replyTh:string;replyEn:string;chosenBy:'model'|'fallback'}|
 {action:'menu'|'help';replyTh:string;replyEn:string;chosenBy:'model'|'fallback'};

const NO_DIGITS=/[0-9๐-๙]/,FORBIDDEN=/https?:|www\.|[฿$%€£]/i;
const LABEL='Stripe sandbox · test mode · no real money';
const DEFAULT={quote:['ได้เลยค่ะ ตรวจรายการแล้วกดจ่ายได้เลย','Here is your order. Check it and press Pay.'],
 menu:['เมนูที่สั่งผ่านแชทได้ตอนนี้ค่ะ บอกชื่อเมนูได้เลย','Here is what you can order by chat. Tell me the item.'],
 help:['พิมพ์ชื่อเมนูที่อยากสั่งได้เลยค่ะ เช่น ลาเต้','Type the item you want, for example Latte.']} as const;
const SYSTEM=`You take orders for a small cafe in Facebook Messenger.
Read the customer's message and choose exactly one action:
- "quote": the customer clearly wants one item from the list; set productId to that item and quantity (1-10, default 1).
- "menu": the customer asks what is available, or the item is unclear or not in the list.
- "help": anything else (greetings, questions you cannot answer).
Use only productIds from the list; never invent items. Write a short friendly reply in Thai (replyTh) and English (replyEn), each under 120 characters.
Never write numbers, prices, quantities, currency symbols or links in the replies; the shop adds the order details and the price itself.`;

const calls=new Map<string,number[]>();
function allowModelCall(linkId:string,perHour:number,now=Date.now()):boolean{
 const recent=(calls.get(linkId)??[]).filter(t=>now-t<3_600_000);
 if(recent.length>=perHour){calls.set(linkId,recent);return false;}
 recent.push(now);calls.set(linkId,recent);
 if(calls.size>10_000)calls.clear();
 return true;
}

/** No-cost matcher: a menu name inside the message, and the first number 1–10 as the quantity. */
export function matchItem(text:string,items:MenuItem[]):AgentStep{
 const t=text.toLowerCase();
 const hits=items.filter(i=>[i.nameEn,i.name].some(n=>n&&t.includes(n.toLowerCase()))).sort((a,b)=>Math.max(b.nameEn.length,b.name.length)-Math.max(a.nameEn.length,a.name.length));
 const qty=Number(t.match(/\b([1-9]|10)\b/)?.[1]??1);
 if(hits.length)return {action:'quote',productId:hits[0].productId,quantity:qty,replyTh:DEFAULT.quote[0],replyEn:DEFAULT.quote[1],chosenBy:'fallback'};
 return {action:'menu',replyTh:DEFAULT.menu[0],replyEn:DEFAULT.menu[1],chosenBy:'fallback'};
}

export async function decideStep(router:MetaRouter|null,merchantId:string,text:string,items:MenuItem[],deadlineMs=8000):Promise<AgentStep>{
 if(!router||!items.length)return matchItem(text,items);
 const ids=['none',...items.map(i=>i.productId)] as [string,...string[]];
 const schema=z.object({action:z.enum(['quote','menu','help']),productId:z.enum(ids),quantity:z.number().int().min(1).max(10),replyTh:z.string().trim().min(1).max(200),replyEn:z.string().trim().min(1).max(200)}).strict();
 const jsonSchema={type:'object',additionalProperties:false,required:['action','productId','quantity','replyTh','replyEn'],properties:{action:{type:'string',enum:['quote','menu','help']},productId:{type:'string',enum:ids},quantity:{type:'integer',minimum:1,maximum:10},replyTh:{type:'string',maxLength:200},replyEn:{type:'string',maxLength:200}}};
 const list=items.map(i=>({productId:i.productId,item:i.nameEn,itemTh:i.name,category:i.category,onOffer:!!i.offer}));
 try{
  const r=await router.invoke({task:'agent_order',merchantId,messages:[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify({customerMessage:text,menu:list})}],
   output:{name:'order_step',schema,jsonSchema},maxOutputTokens:2000,reasoningEffort:'minimal',deadlineMs});
  const v=r.value;
  const safe=!NO_DIGITS.test(v.replyTh)&&!NO_DIGITS.test(v.replyEn)&&!FORBIDDEN.test(v.replyTh)&&!FORBIDDEN.test(v.replyEn);
  const [th,en]=safe?[v.replyTh,v.replyEn]:v.action==='quote'?DEFAULT.quote:v.action==='menu'?DEFAULT.menu:DEFAULT.help;
  if(v.action==='quote'&&v.productId!=='none')return {action:'quote',productId:v.productId,quantity:v.quantity,replyTh:th,replyEn:en,chosenBy:'model'};
  return {action:v.action==='help'?'help':'menu',replyTh:v.action==='quote'?DEFAULT.menu[0]:th,replyEn:v.action==='quote'?DEFAULT.menu[1]:en,chosenBy:'model'};
 }catch(e){if(e instanceof MetaRouterError)return matchItem(text,items);throw e;}
}

const ERRORS:Partial<Record<AgentOrderError['code'],string>>={OUT_OF_STOCK:'ขออภัย สินค้าไม่พอค่ะ / Sorry, not enough stock.',
 BELOW_MINIMUM:'ยอดนี้ต่ำกว่าขั้นต่ำของ Stripe ชำระที่เคาน์เตอร์ได้ค่ะ / Below the Stripe minimum; please pay at the counter.',
 QUOTE_EXPIRED:'รายการนี้หมดเวลาแล้ว พิมพ์สั่งใหม่ได้เลยค่ะ / This quote expired; order again.',
 NOT_FOUND:'ไม่พบรายการนี้ค่ะ / Order not found.',PAYMENTS_UNAVAILABLE:'ร้านยังไม่เปิดจ่ายผ่านแชทค่ะ / Chat payments are not available.'};
const errorText=(e:unknown)=>e instanceof AgentOrderError?ERRORS[e.code]??'ระบบขัดข้อง ลองใหม่อีกครั้งค่ะ / Something went wrong, please try again.':null;

export type ChatPlan={kind:'quote';reply:string;by:string;quoteId:string;line:string;total:string;quote:QuoteView;item:MenuItem}|{kind:'menu';reply:string;by:string;lines:string[];items:MenuItem[]}|{kind:'help';reply:string;by:string}|{kind:'error';text:string};

/** One customer message → one step (Muse Spark or the free matcher) → a server-priced quote or the menu. */
export async function planChatOrder(deps:ChatAgentDeps,merchantId:string,linkId:string,text:string):Promise<ChatPlan>{
 try{
  const items=(await listMenu(deps,merchantId)).filter(i=>i.payable);
  if(!items.length)return {kind:'error',text:'ตอนนี้ยังไม่มีเมนูที่สั่งผ่านแชทได้ค่ะ / Nothing can be ordered by chat right now.'};
  const step=await decideStep(deps.router&&allowModelCall(linkId,deps.modelCallsPerHour??10)?deps.router:null,merchantId,text,items);
  const by=step.chosenBy==='model'?'Muse Spark':'';
  const reply=`${step.replyTh}\n${step.replyEn}`;
  if(step.action==='quote'){
   const q=await createQuote(deps,merchantId,'messenger',step.productId,step.quantity,linkId);
   const item=items.find(i=>i.productId===q.productId)!;
   return {kind:'quote',reply,by,quoteId:q.quoteId,total:q.total,quote:q,item,line:`${item.emoji} ${q.name} / ${q.nameEn} ×${q.quantity} = ${q.total}${item.offer?` (โปร −${item.offer.discountPercent}%)`:''}`};
  }
  if(step.action==='menu')return {kind:'menu',reply,by,items,lines:items.slice(0,8).map(i=>`${i.emoji} ${i.name} / ${i.nameEn} ${i.price.display}${i.offer?` (−${i.offer.discountPercent}%)`:''}`)};
  return {kind:'help',reply,by};
 }catch(e){const t=errorText(e);if(t)return {kind:'error',text:t};throw e;}
}

/** Absolute image for a Messenger card: the shop's own /images/ path on the public origin, or an https URL. */
function imageFor(deps:ChatAgentDeps,i:MenuItem):string|undefined{
 if(i.imageUrl?.startsWith('/images/'))return deps.publicOrigin+i.imageUrl;
 return i.imageUrl?.startsWith('https://')?i.imageUrl:undefined;
}
/** The menu as a swipeable card carousel; "Order" quotes the item directly, with no model call. */
export function menuCards(deps:ChatAgentDeps,psid:string,items:MenuItem[]):Outgoing{
 return {kind:'cards',psid,cards:items.slice(0,10).map(i=>({title:`${i.emoji} ${i.name} · ${i.price.display}`,
  subtitle:`${i.nameEn}${i.offer?` · โปร −${i.offer.discountPercent}% (ปกติ ${i.basePrice.display})`:''}`,imageUrl:imageFor(deps,i),
  buttons:[{type:'postback',title:'สั่ง / Order',payload:`BITPOS_AGENT_ADD:${i.productId}`}]}))};
}
function quoteCard(deps:ChatAgentDeps,psid:string,q:QuoteView,item:MenuItem,by:string):Outgoing{
 const card:Card={title:`${item.emoji} ${q.name} ×${q.quantity} = ${q.total}`,subtitle:`${item.offer?`โปร −${item.offer.discountPercent}% · `:''}${LABEL}${by?` · ${by}`:''}`,imageUrl:imageFor(deps,item),
  buttons:[{type:'postback',title:`จ่าย ${q.total}`.slice(0,20),payload:`BITPOS_AGENT_PAY:${q.quoteId}`},{type:'postback',title:'ดูเมนู / Menu',payload:'BITPOS_MENU'}]};
 return {kind:'cards',psid,cards:[card]};
}
const STATUS:Record<string,string>={PENDING:'⏳ รอชำระ / waiting',CONFIRMED:'✅ จ่ายแล้ว / paid',FAILED:'✖️ จ่ายไม่สำเร็จ / failed',REFUNDING:'↩️ กำลังคืนเงิน / refunding',CANCELLED:'↩️ ยกเลิก / cancelled'};

/** Handles one chat request after the webhook transaction committed; returns the replies to send. */
export async function handleAgentRequest(deps:ChatAgentDeps,req:AgentRequest):Promise<Outgoing[]>{
 const {merchantId,linkId,psid}=req;
 try{
  if(req.kind==='agent_pay'){
   const r=await startAgentCheckout(deps,merchantId,linkId,req.quoteId,deps.publicOrigin);
   if(r.kind==='paid')return [{kind:'text',psid,text:`จ่ายแล้วค่ะ รหัสรับสินค้า #${r.pickupCode}\nAlready paid — pickup code #${r.pickupCode}.`}];
   if(r.kind==='ended')return [{kind:'text',psid,text:'รายการนี้ปิดแล้ว พิมพ์สั่งใหม่ได้เลยค่ะ / This order is closed; order again.'}];
   return [{kind:'buttons',psid,text:`ยอด ${r.total} · จ่ายบนหน้า Stripe Checkout\nTotal ${r.total} · pay on Stripe Checkout.\n${LABEL}`,buttons:[{type:'web_url',title:'จ่าย / Pay',url:r.url}]}];
  }
  if(req.kind==='my_orders'){
   const orders=await listCustomerOrders(deps,merchantId,linkId);
   if(!orders.length)return [{kind:'text',psid,text:'ยังไม่มีออเดอร์ใน 7 วันค่ะ / No orders in the last 7 days.'}];
   return [{kind:'text',psid,text:['ออเดอร์ของคุณ / Your orders',...orders.map(o=>`#${o.code} ${o.line} · ${o.handedOver?'🤝 รับแล้ว / picked up':STATUS[o.status]}`)].join('\n')}];
  }
  if(req.kind==='menu'||req.kind==='agent_add'){
   const items=(await listMenu(deps,merchantId)).filter(i=>i.payable);
   if(!items.length)return [{kind:'text',psid,text:'ตอนนี้ยังไม่มีเมนูที่สั่งผ่านแชทได้ค่ะ / Nothing can be ordered by chat right now.'}];
   if(req.kind==='menu')return [{kind:'text',psid,text:'เมนูวันนี้ เลื่อนดูแล้วกด "สั่ง" ได้เลยค่ะ\nToday’s menu: swipe and tap Order.'},menuCards(deps,psid,items)];
   const item=items.find(i=>i.productId===req.productId);
   if(!item)return [{kind:'text',psid,text:'เมนูนี้สั่งผ่านแชทไม่ได้ตอนนี้ค่ะ / This item cannot be ordered by chat now.'}];
   const q=await createQuote(deps,merchantId,'messenger',item.productId,1,linkId);
   return [quoteCard(deps,psid,q,item,'')];
  }
  const plan=await planChatOrder(deps,merchantId,linkId,req.text);
  const by=plan.kind!=='error'&&plan.by?` · ${plan.by}`:'';
  if(plan.kind==='quote')return [{kind:'text',psid,text:`${plan.reply}${by}`},quoteCard(deps,psid,plan.quote,plan.item,plan.by)];
  if(plan.kind==='menu')return [{kind:'text',psid,text:`${plan.reply}${by}`},menuCards(deps,psid,plan.items)];
  if(plan.kind==='help')return [{kind:'buttons',psid,text:`${plan.reply}${by}`,buttons:[{type:'postback',title:'ดูเมนู / Menu',payload:'BITPOS_MENU'},{type:'postback',title:'ออเดอร์ของฉัน',payload:'BITPOS_MY_ORDERS'}]}];
  return [{kind:'text',psid,text:plan.text}];
 }catch(e){
  const t=errorText(e);if(t)return [{kind:'text',psid,text:t}];
  throw e;
 }
}
