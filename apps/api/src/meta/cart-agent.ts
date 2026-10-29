// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// A conversation that edits the customer's current chat cart step by step ("a latte" → "make it iced" → "one more" →
// "remove the croissant" → "pay"), with Muse Spark tool calling (parallel tool calls). The tools run on the server against
// the stored cart (migration 320): the model never sets a price; every reply shows the cart as the server prices it.
// Booking requests are handed back to the booking flow. Without a model, the caller keeps the one-step matcher.
import {z} from 'zod';
import type {MetaTool} from '../../../../packages/meta-ai/src/types';
import type {MetaDb} from './identity';
import {listMenu,type MenuItem} from './agent-orders';
import {formatCart,parseCart,quoteCart,type CartLine} from './cart';
import type {ChatAgentDeps} from './agent';

const MAX_LINES=10,TTL_MIN=120;
export async function chatCart(db:MetaDb,merchantId:string,linkId:string):Promise<CartLine[]>{
 const r=(await db.tenant(merchantId,c=>c.query<{cart:string}>(`SELECT cart FROM meta_chat_carts WHERE link_id=$1 AND updated_at>clock_timestamp()-interval '${TTL_MIN} minutes'`,[linkId]))).rows[0];
 return parseCart(r?.cart);
}
export async function saveChatCart(db:MetaDb,merchantId:string,linkId:string,lines:CartLine[]):Promise<void>{
 const cart=formatCart(lines.slice(0,MAX_LINES).map(l=>({productId:l.productId,quantity:Math.min(20,l.quantity)})));
 await db.tenant(merchantId,c=>c.query(`INSERT INTO meta_chat_carts(merchant_id,link_id,cart) VALUES(current_setting('bitpos.merchant')::uuid,$1,$2)
  ON CONFLICT(merchant_id,link_id) DO UPDATE SET cart=EXCLUDED.cart,updated_at=clock_timestamp()`,[linkId,cart]));
}

const SYSTEM=`You are the order assistant of a small cafe, talking with one customer in Thai or English (answer in the customer's language, warmly and briefly).
Keep their cart right with the tools: look at the menu and the cart, add items, change quantities, swap an item for another (e.g. hot latte → iced latte), remove items or clear the cart.
When they want to pay, call checkout. When they want to book a table, call booking and say nothing else.
Only use productIds that get_menu returns. Never state prices, totals, discounts or numbers of minutes in your reply — the shop shows the priced cart under your message.
If something is unclear, ask one short question.`;

export interface CartTalk {reply:string;cart:CartLine[];checkout:boolean;booking:boolean;calls:string[];by:string}
/** One customer message through the tool-calling agent; throws when no model can be used (the caller falls back). */
export async function talkCart(deps:ChatAgentDeps,merchantId:string,linkId:string,text:string,history:{role:'user'|'assistant';content:string}[]=[]):Promise<CartTalk>{
 const router=deps.router;
 if(!router||!('invokeTools' in router))throw new Error('NO_MODEL');
 const items=(await listMenu(deps,merchantId)).filter(i=>i.payable);
 const byId=new Map(items.map(i=>[i.productId,i] as [string,MenuItem]));
 let cart=await chatCart(deps.db,merchantId,linkId),checkout=false,booking=false;
 const id=z.string().refine(v=>byId.has(v),'unknown product');
 const qty=z.number().int().min(0).max(20);
 const put=(productId:string,quantity:number)=>{cart=cart.filter(l=>l.productId!==productId);if(quantity>0&&cart.length<MAX_LINES)cart.push({productId,quantity});};
 const view=async()=>{if(!cart.length)return {lines:[]};const q=await quoteCart(deps,merchantId,cart);return {lines:q.lines.map(l=>({productId:l.productId,item:l.nameEn,itemTh:l.name,quantity:l.quantity,onOffer:l.offer}))};};
 const tools:MetaTool[]=[
  {name:'get_menu',description:'Items the customer can order now (ids, names, category, whether on offer).',parameters:{type:'object',properties:{},additionalProperties:false},args:z.object({}).passthrough(),
   run:async()=>({items:items.map(i=>({productId:i.productId,item:i.nameEn,itemTh:i.name,category:i.category,onOffer:!!i.offer}))})},
  {name:'view_cart',description:'The current cart.',parameters:{type:'object',properties:{},additionalProperties:false},args:z.object({}).passthrough(),run:view},
  {name:'add_item',description:'Add a quantity of an item (adds to what is already in the cart).',parameters:{type:'object',required:['productId','quantity'],properties:{productId:{type:'string'},quantity:{type:'integer',minimum:1,maximum:10}},additionalProperties:false},
   args:z.object({productId:id,quantity:qty.min(1)}),run:async(a:{productId:string;quantity:number})=>{put(a.productId,(cart.find(l=>l.productId===a.productId)?.quantity??0)+a.quantity);return view();}},
  {name:'set_quantity',description:'Set an item to an exact quantity (0 removes it).',parameters:{type:'object',required:['productId','quantity'],properties:{productId:{type:'string'},quantity:{type:'integer',minimum:0,maximum:20}},additionalProperties:false},
   args:z.object({productId:id,quantity:qty}),run:async(a:{productId:string;quantity:number})=>{put(a.productId,a.quantity);return view();}},
  {name:'swap_item',description:'Replace one item in the cart with another, keeping its quantity (e.g. hot to iced).',parameters:{type:'object',required:['fromProductId','toProductId'],properties:{fromProductId:{type:'string'},toProductId:{type:'string'}},additionalProperties:false},
   args:z.object({fromProductId:id,toProductId:id}),run:async(a:{fromProductId:string;toProductId:string})=>{const n=cart.find(l=>l.productId===a.fromProductId)?.quantity??1;put(a.fromProductId,0);put(a.toProductId,(cart.find(l=>l.productId===a.toProductId)?.quantity??0)+n);return view();}},
  {name:'clear_cart',description:'Empty the cart.',parameters:{type:'object',properties:{},additionalProperties:false},args:z.object({}).passthrough(),run:async()=>{cart=[];return view();}},
  {name:'checkout',description:'The customer wants to pay for the cart now.',parameters:{type:'object',properties:{},additionalProperties:false},args:z.object({}).passthrough(),run:async()=>{checkout=cart.length>0;return {ok:checkout};}},
  {name:'booking',description:'The customer wants to reserve a table.',parameters:{type:'object',properties:{},additionalProperties:false},args:z.object({}).passthrough(),run:async()=>{booking=true;return {ok:true};}},
 ];
 const r=await router.invokeTools({task:'agent_tools',merchantId,tools,maxRounds:4,reasoningEffort:'low',deadlineMs:25000,
  messages:[{role:'system',content:SYSTEM},...history.slice(-6),{role:'user',content:`${text.slice(0,300)}\n\n(current cart: ${JSON.stringify((await view()).lines)})`}]});
 await saveChatCart(deps.db,merchantId,linkId,cart);
 // The reply may not carry numbers the shop did not compute; the priced cart follows it.
 const reply=/[0-9๐-๙]|[$฿€£]/.test(r.text)?r.text.replace(/[^\n]*([0-9๐-๙]|[$฿€£])[^\n]*/g,'').trim():r.text.trim();
 return {reply:reply||(booking?'':'รับทราบค่ะ / Got it.'),cart,checkout,booking,calls:r.calls.map(c=>c.name),by:`Muse Spark · ${r.calls.length} tool call${r.calls.length===1?'':'s'}`};
}
