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
import {cancelReservation,customerReservations,openBookingRequest,parseBooking,requestBooking,resetBookingRequest,bangkokToday,TZ,CHECKIN_MINUTES,type BookingFields,type BookingResult,type ReservationView} from './reservations';
import type {Card,Outgoing,QuickReply} from './messenger';
import {CartError,customerCartOrders,formatCart,parseCart,quoteCart,startCart,type CartLine} from './cart';

/** shopMerchant: the shop served at the root of publicOrigin (meta-pay), so menu cards can link to its item pages. */
export interface ChatAgentDeps extends AgentDeps {router:MetaRouter|null;publicOrigin:string;modelCallsPerHour?:number;shopMerchant?:string|null}
type By={chosenBy:'model'|'fallback';invocationId?:string|null};
export type AgentStep=({action:'quote';productId:string;quantity:number;replyTh:string;replyEn:string}|
 {action:'book';booking:BookingFields;replyTh:string;replyEn:string}|
 {action:'menu'|'help';replyTh:string;replyEn:string})&By;
/** What the agent knows besides the message: today in Bangkok and a booking the customer is part-way through. */
export interface StepContext {today:string;pendingBooking:BookingFields|null}

const NO_DIGITS=/[0-9๐-๙]/,FORBIDDEN=/https?:|www\.|[฿$%€£]/i;
const LABEL='Stripe sandbox · test mode · no real money';
const DEFAULT={quote:['ได้เลยค่ะ ตรวจรายการแล้วกดจ่ายได้เลย','Here is your order. Check it and press Pay.'],
 menu:['เมนูที่สั่งผ่านแชทได้ตอนนี้ค่ะ บอกชื่อเมนูได้เลย','Here is what you can order by chat. Tell me the item.'],
 help:['พิมพ์ชื่อเมนูที่อยากสั่งได้เลยค่ะ เช่น ลาเต้','Type the item you want, for example Latte.']} as const;
const SYSTEM=`You take orders for a small cafe in Facebook Messenger.
Read the customer's message and choose exactly one action:
- "quote": the customer clearly wants one item from the list; set productId to that item and quantity (1-10, default 1).
- "menu": the customer asks what is available, or the item is unclear or not in the list.
- "book": the customer wants to reserve a table, or answers a question about a booking in progress (pendingBooking). Fill bookingDate as YYYY-MM-DD (use today's date for "today"), bookingTime as HH:MM in 24-hour time (for example Thai "1 ทุ่ม" is 19:00, "บ่าย 2" is 14:00), and partySize; use "" or 0 for anything the customer did not say. Do not guess a time.
- "help": anything else (greetings, questions you cannot answer).
Use only productIds from the list; never invent items. Write a short friendly reply in Thai (replyTh) and English (replyEn), each under 120 characters.
Never write numbers, prices, quantities, currency symbols or links in the replies; the shop adds the order details and the price itself.`;

const calls=new Map<string,number[]>();
export function allowModelCall(linkId:string,perHour:number,now=Date.now()):boolean{
 const recent=(calls.get(linkId)??[]).filter(t=>now-t<3_600_000);
 if(recent.length>=perHour){calls.set(linkId,recent);return false;}
 recent.push(now);calls.set(linkId,recent);
 if(calls.size>10_000)calls.clear();
 return true;
}

/** No-cost matcher: a menu name inside the message, and the first number 1–10 as the quantity. */
export function matchItem(text:string,items:MenuItem[],ctx?:StepContext):AgentStep{
 const t=text.toLowerCase();
 if(ctx){
  const b=parseBooking(text,ctx.today);
  if(b.intent||ctx.pendingBooking&&(b.fields.date||b.fields.time||b.fields.partySize))return {action:'book',booking:b.fields,replyTh:'รับทราบค่ะ',replyEn:'Got it.',chosenBy:'fallback'};
 }
 const hits=items.filter(i=>[i.nameEn,i.name].some(n=>n&&t.includes(n.toLowerCase()))).sort((a,b)=>Math.max(b.nameEn.length,b.name.length)-Math.max(a.nameEn.length,a.name.length));
 const qty=Number(t.match(/\b([1-9]|10)\b/)?.[1]??1);
 if(hits.length)return {action:'quote',productId:hits[0].productId,quantity:qty,replyTh:DEFAULT.quote[0],replyEn:DEFAULT.quote[1],chosenBy:'fallback'};
 return {action:'menu',replyTh:DEFAULT.menu[0],replyEn:DEFAULT.menu[1],chosenBy:'fallback'};
}

export async function decideStep(router:MetaRouter|null,merchantId:string,text:string,items:MenuItem[],ctx?:StepContext,deadlineMs=8000):Promise<AgentStep>{
 if(!router||!items.length)return matchItem(text,items,ctx);
 const ids=['none',...items.map(i=>i.productId)] as [string,...string[]];
 const schema=z.object({action:z.enum(['quote','menu','book','help']),productId:z.enum(ids),quantity:z.number().int().min(1).max(10),bookingDate:z.string().max(10),bookingTime:z.string().max(5),partySize:z.number().int().min(0).max(12),replyTh:z.string().trim().min(1).max(200),replyEn:z.string().trim().min(1).max(200)}).strict();
 const jsonSchema={type:'object',additionalProperties:false,required:['action','productId','quantity','bookingDate','bookingTime','partySize','replyTh','replyEn'],properties:{action:{type:'string',enum:['quote','menu','book','help']},bookingDate:{type:'string',maxLength:10},bookingTime:{type:'string',maxLength:5},partySize:{type:'integer',minimum:0,maximum:12},productId:{type:'string',enum:ids},quantity:{type:'integer',minimum:1,maximum:10},replyTh:{type:'string',maxLength:200},replyEn:{type:'string',maxLength:200}}};
 const list=items.map(i=>({productId:i.productId,item:i.nameEn,itemTh:i.name,category:i.category,onOffer:!!i.offer}));
 try{
  const r=await router.invoke({task:'agent_order',merchantId,messages:[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify({customerMessage:text,today:ctx?.today??null,timeZone:TZ,pendingBooking:ctx?.pendingBooking??null,menu:list})}],
   output:{name:'order_step',schema,jsonSchema},maxOutputTokens:2000,reasoningEffort:'minimal',deadlineMs});
  const v=r.value;
  const safe=!NO_DIGITS.test(v.replyTh)&&!NO_DIGITS.test(v.replyEn)&&!FORBIDDEN.test(v.replyTh)&&!FORBIDDEN.test(v.replyEn);
  const [th,en]=safe?[v.replyTh,v.replyEn]:v.action==='quote'?DEFAULT.quote:v.action==='menu'?DEFAULT.menu:DEFAULT.help;
  const by={chosenBy:'model' as const,invocationId:r.invocation.id};
  if(v.action==='book')return {action:'book',booking:{date:v.bookingDate||null,time:v.bookingTime||null,partySize:v.partySize||null},replyTh:safe?v.replyTh:'รับทราบค่ะ',replyEn:safe?v.replyEn:'Got it.',...by};
  if(v.action==='quote'&&v.productId!=='none')return {action:'quote',productId:v.productId,quantity:v.quantity,replyTh:th,replyEn:en,...by};
  return {action:v.action==='help'?'help':'menu',replyTh:v.action==='quote'?DEFAULT.menu[0]:th,replyEn:v.action==='quote'?DEFAULT.menu[1]:en,...by};
 }catch(e){if(e instanceof MetaRouterError)return matchItem(text,items,ctx);throw e;}
}

const ERRORS:Partial<Record<AgentOrderError['code'],string>>={OUT_OF_STOCK:'ขออภัย สินค้าไม่พอค่ะ / Sorry, not enough stock.',
 BELOW_MINIMUM:'ยอดนี้ต่ำกว่าขั้นต่ำของ Stripe ชำระที่เคาน์เตอร์ได้ค่ะ / Below the Stripe minimum; please pay at the counter.',
 QUOTE_EXPIRED:'รายการนี้หมดเวลาแล้ว พิมพ์สั่งใหม่ได้เลยค่ะ / This quote expired; order again.',
 NOT_FOUND:'ไม่พบรายการนี้ค่ะ / Order not found.',PAYMENTS_UNAVAILABLE:'ร้านยังไม่เปิดจ่ายผ่านแชทค่ะ / Chat payments are not available.'};
const errorText=(e:unknown)=>e instanceof AgentOrderError?ERRORS[e.code]??'ระบบขัดข้อง ลองใหม่อีกครั้งค่ะ / Something went wrong, please try again.':null;

export type ChatPlan={kind:'quote';reply:string;by:string;quoteId:string;line:string;total:string;quote:QuoteView;item:MenuItem}|{kind:'menu';reply:string;by:string;lines:string[];items:MenuItem[]}|{kind:'help';reply:string;by:string}|{kind:'book';reply:string;by:string;result:BookingResult}|{kind:'error';text:string};

/** One customer message → one step (Muse Spark or the free matcher) → a server-priced quote or the menu. */
export async function planChatOrder(deps:ChatAgentDeps,merchantId:string,linkId:string,text:string):Promise<ChatPlan>{
 try{
  const items=(await listMenu(deps,merchantId)).filter(i=>i.payable);
  if(!items.length)return {kind:'error',text:'ตอนนี้ยังไม่มีเมนูที่สั่งผ่านแชทได้ค่ะ / Nothing can be ordered by chat right now.'};
  const ctx:StepContext={today:await bangkokToday(deps.db,merchantId),pendingBooking:await openBookingRequest(deps.db,merchantId,linkId)};
  const step=await decideStep(deps.router&&allowModelCall(linkId,deps.modelCallsPerHour??10)?deps.router:null,merchantId,text,items,ctx);
  const by=step.chosenBy==='model'?'Muse Spark':'';
  const reply=`${step.replyTh}\n${step.replyEn}`;
  if(step.action==='quote'){
   const q=await createQuote(deps,merchantId,'messenger',step.productId,step.quantity,linkId);
   const item=items.find(i=>i.productId===q.productId)!;
   return {kind:'quote',reply,by,quoteId:q.quoteId,total:q.total,quote:q,item,line:`${item.emoji} ${q.name} / ${q.nameEn} ×${q.quantity} = ${q.total}${item.offer?` (โปร −${item.offer.discountPercent}%)`:''}`};
  }
  if(step.action==='book')return {kind:'book',reply,by,result:await requestBooking(deps.db,merchantId,linkId,step.booking,{chosenBy:step.chosenBy,invocationId:step.invocationId??null})};
  if(step.action==='menu')return {kind:'menu',reply,by,items,lines:items.slice(0,8).map(i=>`${i.emoji} ${i.name} / ${i.nameEn} ${i.price.display}${i.offer?` (−${i.offer.discountPercent}%)`:''}`)};
  return {kind:'help',reply,by};
 }catch(e){const t=errorText(e);if(t)return {kind:'error',text:t};throw e;}
}

/** Absolute image for a Messenger card: the shop's own /images/ path, served by the /meta container, or an https URL. */
function imageFor(deps:ChatAgentDeps,i:MenuItem):string|undefined{
 if(i.imageUrl?.startsWith('/images/'))return deps.publicOrigin+'/meta'+i.imageUrl;
 return i.imageUrl?.startsWith('https://')?i.imageUrl:undefined;
}
const CART_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CART_LINES=10;
/** The chip row under the last reply (design C08/C15). */
export const QUICK:QuickReply[]=[{title:'เมนู',payload:'BITPOS_MENU'},{title:'ออเดอร์ของฉัน',payload:'BITPOS_MY_ORDERS'},{title:'จองโต๊ะ',payload:'BITPOS_BOOK'}];
const plus=(cart:CartLine[],productId:string,n=1):CartLine[]|null=>{
 if(!CART_ID.test(productId))return null;
 const has=cart.some(l=>l.productId===productId);
 if(!has&&cart.length>=CART_LINES)return null;
 return has?cart.map(l=>l.productId===productId?{...l,quantity:Math.min(20,l.quantity+n)}:l):[...cart,{productId,quantity:n}];
};
/** The menu as a swipeable card carousel. "Add" carries the cart in its payload, so the chat keeps no cart state. */
export function menuCards(deps:ChatAgentDeps,psid:string,items:MenuItem[],cart:CartLine[]=[],merchantId?:string):Outgoing{
 const details=!!merchantId&&merchantId===deps.shopMerchant;
 return {kind:'cards',psid,cards:items.slice(0,10).map(i=>{const next=plus(cart,i.productId);
  return {title:`${i.emoji} ${i.name} · ${i.price.display}`,
  subtitle:`${i.nameEn}${i.offer?` · โปร −${i.offer.discountPercent}% (ปกติ ${i.basePrice.display})`:''}`,imageUrl:imageFor(deps,i),
  buttons:[next?{type:'postback',title:'ใส่ตะกร้า / Add',payload:`BITPOS_CART_ADD:${formatCart(next)}`}:{type:'postback',title:'สั่ง / Order',payload:`BITPOS_AGENT_ADD:${i.productId}`},
   ...(details?[{type:'web_url' as const,title:'รายละเอียด / Details',url:`${deps.publicOrigin}/item/${i.productId}`}]:[])]};})};
}
function quoteCard(deps:ChatAgentDeps,psid:string,q:QuoteView,item:MenuItem,by:string):Outgoing{
 const more=plus([],item.productId,q.quantity);
 const card:Card={title:`${item.emoji} ${q.name} ×${q.quantity} = ${q.total}`,subtitle:`${item.offer?`โปร −${item.offer.discountPercent}% · `:''}${LABEL}${by?` · ${by}`:''}`,imageUrl:imageFor(deps,item),
  buttons:[{type:'postback',title:`จ่าย ${q.total}`.slice(0,20),payload:`BITPOS_AGENT_PAY:${q.quoteId}`},
   more?{type:'postback',title:'เพิ่มเมนูอื่น / Add more',payload:`BITPOS_CART_MENU:${formatCart(more)}`}:{type:'postback',title:'ดูเมนู / Menu',payload:'BITPOS_MENU'}]};
 return {kind:'cards',psid,cards:[card]};
}
const CART_ERR:Record<CartError['code'],string>={EMPTY:'ตะกร้ายังว่างค่ะ / Your cart is empty.',INVALID_INPUT:'ตะกร้าไม่ถูกต้อง เริ่มใหม่จากเมนูได้เลยค่ะ / Start again from the menu.',
 NOT_FOUND:'มีเมนูที่ร้านนำออกแล้ว เริ่มใหม่จากเมนูได้เลยค่ะ / An item is no longer on the menu.',OUT_OF_STOCK:'มีเมนูที่ของไม่พอค่ะ ลองลดจำนวนหรือเลือกอย่างอื่น / Not enough stock.',
 MIXED_CURRENCY:'สั่งรวมกันไม่ได้ค่ะ / These items cannot be paid together.',BELOW_MINIMUM:'ยอดยังต่ำกว่าขั้นต่ำของ Stripe ค่ะ เพิ่มอีกนิดได้เลย / Below the Stripe minimum.',
 PAYMENTS_UNAVAILABLE:'ตอนนี้ยังรับชำระไม่ได้ค่ะ / Payments are not available right now.',NOT_CANCELLABLE:'ทำรายการนี้ไม่ได้ค่ะ',ENDED:'รายการนี้ปิดแล้วค่ะ'};
/** Cart summary: every line priced by the server now; Pay starts one hosted Checkout for all of it. */
async function cartMessages(deps:ChatAgentDeps,merchantId:string,psid:string,cart:CartLine[],note:string):Promise<Outgoing[]>{
 const q=await quoteCart(deps,merchantId,cart),n=q.lines.reduce((a,l)=>a+l.quantity,0),raw=formatCart(cart);
 const lines=q.lines.map(l=>`${l.emoji} ${l.name} ×${l.quantity} = ${l.amount}${l.offer?' (โปร)':''}`);
 const last=q.lines[q.lines.length-1];
 const image=last?.imageUrl?.startsWith('/images/')?deps.publicOrigin+'/meta'+last.imageUrl:last?.imageUrl?.startsWith('https://')?last.imageUrl:undefined;
 return [{kind:'text',psid,text:`${note}\n${lines.join('\n')}${/[1-9]/.test(q.discount)?`\nส่วนลดที่ร้านอนุมัติ −${q.discount}`:''}\nรวม ${q.total} · ราคาจากร้าน / Prices from the shop`},
  {kind:'cards',psid,cards:[{title:`🛒 ตะกร้า ${n} ชิ้น · ${q.total}`,subtitle:`${lines.join(' · ')}`,imageUrl:image,
   buttons:[{type:'postback',title:`จ่าย ${q.total}`.slice(0,20),payload:`BITPOS_CART_PAY:${raw}`},{type:'postback',title:'เพิ่มเมนู / Add more',payload:`BITPOS_CART_MENU:${raw}`},{type:'postback',title:'ล้างตะกร้า / Clear',payload:'BITPOS_MENU'}]}]}];
}
const STATUS:Record<string,string>={PENDING:'⏳ รอชำระ / waiting',CONFIRMED:'✅ จ่ายแล้ว / paid',FAILED:'✖️ จ่ายไม่สำเร็จ / failed',REFUNDING:'↩️ กำลังคืนเงิน / refunding',CANCELLED:'↩️ ยกเลิก / cancelled'};

const bkk=(iso:string,o:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat('en-GB',{...o,timeZone:TZ}).format(new Date(iso));
const when=(iso:string)=>`${bkk(iso,{weekday:'short',day:'numeric',month:'short'})} ${bkk(iso,{hour:'2-digit',minute:'2-digit'})}`;
const hhmm=(iso:string)=>bkk(iso,{hour:'2-digit',minute:'2-digit'});
const addDay=(d:string,n:number)=>new Date(Date.parse(d+'T00:00:00Z')+n*86_400_000).toISOString().slice(0,10);
/** Booking outcome → Messenger messages (also rendered as text on the web order page). */
export function bookingMessages(psid:string,r:BookingResult,reply=''):Outgoing[]{
 if(r.kind==='booked'){
  const v=r.reservation;
  return [{kind:'text',psid,text:`${reply?reply+'\n':''}จองโต๊ะให้แล้วค่ะ ✅ มาแตะมือถือที่สติกเกอร์บนโต๊ะ ${hhmm(v.checkInFrom)}–${hhmm(v.checkInUntil)} ถ้าไม่มาแตะในเวลา โต๊ะจะถูกปล่อยให้ลูกค้าคนอื่นค่ะ\nBooked. Tap your phone on the table's sticker between ${hhmm(v.checkInFrom)} and ${hhmm(v.checkInUntil)}, or the table is released.`},
   {kind:'cards',psid,cards:[{title:`🗓️ โต๊ะ ${v.tableLabel} · ${when(v.startsAt)} · ${v.partySize} คน`,subtitle:`#${v.code} · เช็กอิน ${hhmm(v.checkInFrom)}–${hhmm(v.checkInUntil)} · tap to check in`,
    buttons:[{type:'postback',title:'ยกเลิกการจอง / Cancel',payload:`BITPOS_BOOK_CANCEL:${v.id}`},{type:'postback',title:'ดูเมนู / Menu',payload:'BITPOS_MENU'}]}]}];
 }
 if(r.kind==='ask'){
  if(r.missing.includes('date'))return [{kind:'buttons',psid,text:`${reply?reply+'\n':''}จองโต๊ะได้เลยค่ะ อยากมาวันไหน เวลากี่โมง กี่ท่านคะ (เช่น "พรุ่งนี้ 1 ทุ่ม 2 คน")\nWhich day and time, and for how many? (e.g. "tomorrow 19:00, 2 people")`,
   buttons:[{type:'postback',title:'วันนี้ / Today',payload:`BITPOS_BOOK_SET:date:${r.today}`},{type:'postback',title:'พรุ่งนี้ / Tomorrow',payload:`BITPOS_BOOK_SET:date:${addDay(r.today,1)}`}]}];
  return [{kind:'buttons',psid,text:`${reply?reply+'\n':''}วันที่ ${r.fields.date} ค่ะ มากี่โมงดีคะ (พิมพ์เวลาได้เลย เช่น 18:30)\nWhat time? (type it, e.g. 18:30)`,
   buttons:['12:00','18:00','19:00'].map(t=>({type:'postback' as const,title:t,payload:`BITPOS_BOOK_SET:time:${t}`}))}];
 }
 if(r.kind==='full'){
  if(!r.alternatives.length)return [{kind:'text',psid,text:'ขออภัยค่ะ ช่วงนั้นโต๊ะเต็ม ลองเวลาอื่นได้เลยค่ะ\nSorry, fully booked around then. Try another time.'}];
  return [{kind:'buttons',psid,text:'ช่วงนั้นโต๊ะเต็มค่ะ ว่างเวลาเหล่านี้ / Fully booked then; free at:',
   buttons:r.alternatives.slice(0,3).map(t=>({type:'postback' as const,title:t,payload:`BITPOS_BOOK_SET:at:${r.fields.date}T${t}`}))}];
 }
 const why={PAST:'เวลานี้ผ่านไปแล้วค่ะ บอกเวลาใหม่ได้เลย / That time has passed; tell me another.',TOO_FAR:'จองล่วงหน้าได้ไม่เกิน 14 วันค่ะ / Bookings are up to 14 days ahead.',NO_TABLES:'ร้านยังไม่เปิดจองโต๊ะค่ะ / This shop has no bookable tables yet.'}[r.reason];
 return [{kind:'text',psid,text:why}];
}
const RES_STATUS:Record<ReservationView['status'],string>={HELD:'🗓️ จองไว้ / booked',CHECKED_IN:'✅ เช็กอินแล้ว / checked in',NO_SHOW:'⌛ หลุดคิว / lapsed',CANCELLED:'↩️ ยกเลิก / cancelled'};

/** Handles one chat request after the webhook transaction committed; returns the replies to send. */
export async function handleAgentRequest(deps:ChatAgentDeps,req:AgentRequest):Promise<Outgoing[]>{
 const out=await agentReplies(deps,req);
 // Chips go under the last reply unless it is a booking question (its own buttons answer it).
 const last=out[out.length-1];
 if(last&&!(last.kind==='buttons'&&last.buttons.some(b=>b.type==='postback'&&b.payload.startsWith('BITPOS_BOOK_SET:'))))out[out.length-1]={...last,quick:QUICK};
 return out;
}
async function agentReplies(deps:ChatAgentDeps,req:AgentRequest):Promise<Outgoing[]>{
 const {merchantId,linkId,psid}=req;
 try{
  if(req.kind==='agent_pay'){
   const r=await startAgentCheckout(deps,merchantId,linkId,req.quoteId,deps.publicOrigin);
   if(r.kind==='paid')return [{kind:'text',psid,text:`จ่ายแล้วค่ะ รหัสรับสินค้า #${r.pickupCode}\nAlready paid — pickup code #${r.pickupCode}.`}];
   if(r.kind==='ended')return [{kind:'text',psid,text:'รายการนี้ปิดแล้ว พิมพ์สั่งใหม่ได้เลยค่ะ / This order is closed; order again.'}];
   return [{kind:'buttons',psid,text:`ยอด ${r.total} · จ่ายบนหน้า Stripe Checkout\nTotal ${r.total} · pay on Stripe Checkout.\n${LABEL}`,buttons:[{type:'web_url',title:'จ่าย / Pay',url:r.url}]}];
  }
  if(req.kind==='cart_add'||req.kind==='cart_menu'||req.kind==='cart_pay'){
   const cart=parseCart(req.cart).slice(0,CART_LINES);
   try{
    if(req.kind==='cart_menu'){
     const items=(await listMenu(deps,merchantId)).filter(i=>i.payable);
     return [{kind:'text',psid,text:'เลือกเพิ่มได้เลยค่ะ กด "ใส่ตะกร้า" แล้วจ่ายทีเดียว\nAdd more, then pay once.'},menuCards(deps,psid,items,cart,merchantId)];
    }
    if(req.kind==='cart_add')return await cartMessages(deps,merchantId,psid,cart,'ใส่ตะกร้าแล้ว ✓ / Added to cart');
    const r=await startCart(deps,merchantId,cart,{channel:'chat',linkId,publicOrigin:deps.publicOrigin});
    return [{kind:'buttons',psid,text:`ยอดรวมจากร้าน · จ่ายทีเดียวบนหน้า Stripe Checkout\nPay the whole cart on Stripe Checkout.\n${LABEL}`,buttons:[{type:'web_url',title:'จ่าย / Pay',url:r.checkoutUrl}]}];
   }catch(e){if(e instanceof CartError)return [{kind:'text',psid,text:CART_ERR[e.code]}];throw e;}
  }
  if(req.kind==='welcome'){
   // Get Started / Help for a connected customer: a picture menu of what the chat can do (no model call).
   const items=(await listMenu(deps,merchantId)).filter(i=>i.payable),pic=(n:number)=>items[n]?imageFor(deps,items[n]):undefined;
   const top=items.find(i=>i.offer);
   return [{kind:'text',psid,text:'สวัสดีค่ะ 👋 Muse Café ยินดีต้อนรับ\nเลือกได้เลยค่ะ หรือพิมพ์/พูดสิ่งที่อยากสั่ง เช่น "ขอลาเต้ 2 แก้ว"'},
    {kind:'cards',psid,cards:[
     {title:'☕ สั่งจากเมนู',subtitle:top?`วันนี้ ${top.name} ลด ${top.offer!.discountPercent}% · ใส่ตะกร้าแล้วจ่ายทีเดียว`:'ใส่ตะกร้าแล้วจ่ายทีเดียวด้วย Stripe',imageUrl:pic(0),
      buttons:[{type:'postback',title:'ดูเมนู / Menu',payload:'BITPOS_MENU'},{type:'web_url',title:'🎙️ สั่งด้วยเสียง',url:`${deps.publicOrigin}/meta/order`}]},
     {title:'🗓️ จองโต๊ะ',subtitle:'บอกวัน เวลา จำนวนคน แล้วแตะมือถือที่โต๊ะเพื่อเช็กอิน',imageUrl:pic(1),buttons:[{type:'postback',title:'จองโต๊ะ / Book',payload:'BITPOS_BOOK'}]},
     {title:'🧾 ออเดอร์และการจองของฉัน',subtitle:'ดูสถานะ รหัสรับสินค้า หรือยกเลิกการจอง',imageUrl:pic(2),buttons:[{type:'postback',title:'ออเดอร์ของฉัน',payload:'BITPOS_MY_ORDERS'}]}]}];
  }
  if(req.kind==='my_orders'){
   const carts=await customerCartOrders(deps.db,merchantId,linkId),orders=await listCustomerOrders(deps,merchantId,linkId),bookings=await customerReservations(deps.db,merchantId,linkId);
   if(!carts.length&&!orders.length&&!bookings.length)return [{kind:'text',psid,text:'ยังไม่มีออเดอร์หรือการจองค่ะ / No orders or bookings yet.'}];
   const CS:Record<string,string>={PENDING:'⏳ รอจ่าย / waiting',PAID:'✅ จ่ายแล้ว / paid',CANCELLED:'↩️ คืนเงินแล้ว / refunded',EXPIRED:'⌛ หมดเวลา / expired'};
   const cards:Card[]=[
    ...bookings.map(b=>({title:`🗓️ #${b.code} โต๊ะ ${b.tableLabel} · ${when(b.startsAt)}`,subtitle:`${b.partySize} คน · ${RES_STATUS[b.status]}${b.status==='HELD'?` · เช็กอิน ${hhmm(b.checkInFrom)}–${hhmm(b.checkInUntil)}`:''}`,
     buttons:b.status==='HELD'?[{type:'postback' as const,title:'ยกเลิกการจอง / Cancel',payload:`BITPOS_BOOK_CANCEL:${b.id}`}]:[]})),
    ...carts.map(c=>({title:`🧾 #${c.code} ${c.lines.map(l=>`${l.emoji} ${l.name} ×${l.quantity}`).join(', ')}`,subtitle:`${c.total} · ${c.handedOverAt?'🤝 รับแล้ว / picked up':CS[c.status]??c.status}${c.status==='PAID'&&!c.handedOverAt?' · รับที่เคาน์เตอร์':''}`,
     buttons:c.checkoutUrl?[{type:'web_url' as const,title:'จ่าย / Pay',url:c.checkoutUrl}]:[]})),
    ...orders.map(o=>({title:`🧾 #${o.code} ${o.line}`,subtitle:o.handedOver?'🤝 รับแล้ว / picked up':STATUS[o.status],buttons:[]}))].slice(0,10);
   return [{kind:'text',psid,text:'รายการล่าสุดของคุณค่ะ / Your latest orders and bookings'},{kind:'cards',psid,cards}];
  }
  if(req.kind==='book_start')return (await resetBookingRequest(deps.db,merchantId,linkId),bookingMessages(psid,await requestBooking(deps.db,merchantId,linkId,{date:null,time:null,partySize:null},{chosenBy:'fallback',invocationId:null})));
  if(req.kind==='book_set')return bookingMessages(psid,await requestBooking(deps.db,merchantId,linkId,{date:req.date,time:req.time,partySize:null},{chosenBy:'fallback',invocationId:null}));
  if(req.kind==='book_cancel'){
   const r=await cancelReservation(deps.db,merchantId,req.reservationId,{linkId});
   return [{kind:'text',psid,text:r?`ยกเลิกการจอง #${r.code} แล้วค่ะ / Booking #${r.code} cancelled.`:'การจองนี้ยกเลิกไม่ได้แล้วค่ะ (เช็กอินแล้ว หมดเวลา หรือยกเลิกไปแล้ว) / This booking can no longer be cancelled.'}];
  }
  if(req.kind==='menu'||req.kind==='agent_add'){
   const items=(await listMenu(deps,merchantId)).filter(i=>i.payable);
   if(!items.length)return [{kind:'text',psid,text:'ตอนนี้ยังไม่มีเมนูที่สั่งผ่านแชทได้ค่ะ / Nothing can be ordered by chat right now.'}];
   if(req.kind==='menu')return [{kind:'text',psid,text:'เมนูวันนี้ เลื่อนดูแล้วกด "ใส่ตะกร้า" ได้เลยค่ะ\nToday’s menu: swipe and tap Add.'},menuCards(deps,psid,items,[],merchantId)];
   const item=items.find(i=>i.productId===req.productId);
   if(!item)return [{kind:'text',psid,text:'เมนูนี้สั่งผ่านแชทไม่ได้ตอนนี้ค่ะ / This item cannot be ordered by chat now.'}];
   const q=await createQuote(deps,merchantId,'messenger',item.productId,1,linkId);
   return [quoteCard(deps,psid,q,item,'')];
  }
  const plan=await planChatOrder(deps,merchantId,linkId,req.text);
  const by=plan.kind!=='error'&&plan.by?` · ${plan.by}`:'';
  if(plan.kind==='quote')return [{kind:'text',psid,text:`${plan.reply}${by}`},quoteCard(deps,psid,plan.quote,plan.item,plan.by)];
  if(plan.kind==='menu')return [{kind:'text',psid,text:`${plan.reply}${by}`},menuCards(deps,psid,plan.items,[],merchantId)];
  if(plan.kind==='book')return bookingMessages(psid,plan.result,`${plan.reply}${by}`);
  if(plan.kind==='help')return [{kind:'buttons',psid,text:`${plan.reply}${by}`,buttons:[{type:'postback',title:'ดูเมนู / Menu',payload:'BITPOS_MENU'},{type:'postback',title:'ออเดอร์ของฉัน',payload:'BITPOS_MY_ORDERS'}]}];
  if(plan.kind==='error')return [{kind:'text',psid,text:plan.text}];
  return [];
 }catch(e){
  const t=errorText(e);if(t)return [{kind:'text',psid,text:t}];
  throw e;
 }
}
