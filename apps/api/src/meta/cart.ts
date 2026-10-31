// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Multi-item orders for meta-pay (table or web) and meta-pos (counter sale as a Stripe QR), migration 313.
// The server prices every line from the live catalog and approved offers when the order is made; the customer only
// chooses product ids and quantities. PAID comes only from a signed Stripe webhook or a server-side Checkout lookup
// that matches amount, currency and order; stock is taken once per line and recorded in meta_stock_movements.
import {linkPreorder,preorderNote} from './reservations';
import {createHash,randomBytes} from 'node:crypto';
import type pg from 'pg';
import type {MetaDb} from './identity';
import {listMenu,type AgentDeps,type Currency} from './agent-orders';
import {formatTapAmount} from './staff';
import {STRIPE_MINIMUM,chargeSavedCard,createCheckoutSession,refundPaymentIntent,retrieveCheckoutSession,StripePaymentError,type PaymentFact} from './stripe';
import {reserveAllowance,type AllowanceGrant,type AllowanceMiss} from './autopay';

export type CartChannel='table'|'counter'|'web'|'chat';
export interface CartLine {productId:string;quantity:number}
export interface CartOrderView {orderId:string;code:string;channel:CartChannel;status:'PENDING'|'PAID'|'CANCELLED'|'EXPIRED';currency:Currency;amountMinor:string;total:string;
 discount:string;checkoutUrl:string|null;paidAt:string|null;handedOverAt:string|null;stockShort:boolean;tableLabel:string|null;
 lines:{productId:string;name:string;nameEn:string;emoji:string;quantity:number;unit:string;amount:string;offer:boolean}[]}
export class CartError extends Error {constructor(readonly code:'EMPTY'|'INVALID_INPUT'|'NOT_FOUND'|'OUT_OF_STOCK'|'MIXED_CURRENCY'|'BELOW_MINIMUM'|'PAYMENTS_UNAVAILABLE'|'NOT_CANCELLABLE'|'ENDED'){super(code);}}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha=(s:string)=>createHash('sha256').update(s).digest();
export const cartCode=(id:string)=>id.replace(/-/g,'').slice(0,4).toUpperCase();
const LIFETIME_MIN=30;

/** Parses "productId:qty,productId:qty" (the signed-out cart a page keeps), merging repeats; at most 20 lines. */
export function parseCart(raw:string|null|undefined):CartLine[]{
 const out=new Map<string,number>();
 for(const part of (raw??'').split(',').slice(0,40)){
  const [id,q]=part.split(':');const n=Number(q);
  if(!id||!UUID.test(id)||!Number.isInteger(n)||n<1)continue;
  out.set(id,Math.min(20,(out.get(id)??0)+n));
 }
 return [...out].slice(0,20).map(([productId,quantity])=>({productId,quantity}));
}
export const formatCart=(lines:CartLine[])=>lines.map(l=>`${l.productId}:${l.quantity}`).join(',');

/** Prices the lines from the live menu inside the shop's transaction. */
async function price(deps:AgentDeps,merchantId:string,lines:CartLine[]){
 if(!lines.length)throw new CartError('EMPTY');
 const menu=new Map((await listMenu(deps,merchantId)).map(m=>[m.productId,m]));
 let currency:Currency|null=null,total=0n,base=0n;
 const priced=lines.map((l,i)=>{
  const m=menu.get(l.productId);if(!m)throw new CartError('NOT_FOUND');
  if(m.available<l.quantity)throw new CartError('OUT_OF_STOCK');
  if(currency&&currency!==m.price.currency)throw new CartError('MIXED_CURRENCY');currency=m.price.currency;
  const unit=BigInt(m.price.amountMinor),b=BigInt(m.basePrice.amountMinor);total+=unit*BigInt(l.quantity);base+=b*BigInt(l.quantity);
  return {line:i+1,m,quantity:l.quantity,unit,base:b};
 });
 // Two-item offers (migration 322): per pair of A and B, X% off both unit prices; a unit counts in one pair only.
 const combos=(await deps.db.tenant(merchantId,c=>c.query<{id:string;product_a:string;product_b:string;discount_percent:number}>(
  "SELECT id,product_a,product_b,discount_percent FROM meta_combo_offers WHERE state='APPLIED' AND expires_at>clock_timestamp() ORDER BY discount_percent DESC"))).rows;
 const left=new Map(priced.map(x=>[x.m.productId,x.quantity]));const unitOf=new Map(priced.map(x=>[x.m.productId,x.unit]));
 let comboOff=0n;const combosApplied:{id:string;pairs:number;off:bigint}[]=[];
 for(const c of combos){
  const pairs=Math.min(left.get(c.product_a)??0,left.get(c.product_b)??0);if(pairs<=0)continue;
  const off=(unitOf.get(c.product_a)!+unitOf.get(c.product_b)!)*BigInt(pairs)*BigInt(c.discount_percent)/100n;
  left.set(c.product_a,left.get(c.product_a)!-pairs);left.set(c.product_b,left.get(c.product_b)!-pairs);
  comboOff+=off;combosApplied.push({id:c.id,pairs,off});
 }
 total-=comboOff;
 if(total<STRIPE_MINIMUM[currency!])throw new CartError('BELOW_MINIMUM');
 return {currency:currency!,total,discount:base-total,priced,comboOff,combosApplied};
}
export async function quoteCart(deps:AgentDeps,merchantId:string,lines:CartLine[]){
 const p=await price(deps,merchantId,lines);
 return {currency:p.currency,total:formatTapAmount(p.total.toString(),p.currency),discount:formatTapAmount(p.discount.toString(),p.currency),comboDiscount:p.comboOff>0n?formatTapAmount(p.comboOff.toString(),p.currency):null,
  lines:p.priced.map(x=>({productId:x.m.productId,name:x.m.name,nameEn:x.m.nameEn,emoji:x.m.emoji,imageUrl:x.m.imageUrl,quantity:x.quantity,
   unit:formatTapAmount(x.unit.toString(),p.currency),amount:formatTapAmount((x.unit*BigInt(x.quantity)).toString(),p.currency),offer:x.m.offer!==null}))};
}

/** Makes the order and its hosted Stripe Checkout. Returns the order and a one-time access token for its receipt page. */
type CartOpts={channel:CartChannel;tableId?:string|null;linkId?:string|null;staffUserId?:string|null;deviceId?:string|null;publicOrigin:string};
export async function startCart(deps:AgentDeps,merchantId:string,lines:CartLine[],opts:CartOpts):Promise<{orderId:string;access:string;checkoutUrl:string}>{
 const o=await createCartOrder(deps,merchantId,lines,opts,false);
 return {orderId:o.orderId,access:o.access,checkoutUrl:await cartCheckout(deps,merchantId,o,opts.publicOrigin)};
}

export type AutoCartResult={orderId:string;access:string}&({kind:'paid';paidNow:boolean}|{kind:'processing'}|{kind:'checkout';checkoutUrl:string;miss:AllowanceMiss|'DECLINED'});
/** A chat checkout for a customer who may have an AI auto-pay allowance (migration 328): if the total fits, the saved card
 * is charged off-session at once; otherwise, or if the bank declines, the customer gets the normal Pay button for the same order. */
export async function startCartAuto(deps:AgentDeps,merchantId:string,lines:CartLine[],opts:CartOpts&{linkId:string},onPaid?:(orderId:string)=>Promise<void>):Promise<AutoCartResult>{
 const o=await createCartOrder(deps,merchantId,lines,opts,true);
 const g=o.grant;
 if(!g)return {orderId:o.orderId,access:o.access,kind:'checkout',miss:o.miss??'NONE',checkoutUrl:await cartCheckout(deps,merchantId,o,opts.publicOrigin)};
 let r;
 try{r=await chargeSavedCard(deps.stripe!.config,{checkoutId:o.orderId,merchantId,orderId:o.orderId,quoteId:o.orderId,grantId:g.id,amountMinor:o.total,currency:o.currency,customerId:g.customerId,paymentMethodId:g.paymentMethodId},deps.stripe!.fetch);}
 catch(e){
  // Unknown outcome: the order stays pending under the allowance; Stripe's signed webhook settles it (and sends the receipt).
  if(!(e instanceof StripePaymentError&&e.code==='PAYMENT_FAILED'))return {orderId:o.orderId,access:o.access,kind:'processing'};
  r={outcome:'FAILED' as const,paymentIntentId:null,declineCode:e.detail??'payment_failed'};
 }
 const res=r;
 if(res.outcome==='SUCCEEDED'){
  const m=await deps.db.tenant(merchantId,c=>markCartPaid(c,o.orderId,{paymentIntentId:res.paymentIntentId!,amountMinor:o.total,currency:o.currency,source:'charge'}));
  if(m==='PAID'&&onPaid)await onPaid(o.orderId).catch(()=>{});
  return {orderId:o.orderId,access:o.access,kind:'paid',paidNow:m==='PAID'};
 }
 if(res.outcome==='PROCESSING')return {orderId:o.orderId,access:o.access,kind:'processing'};
 // Declined (or the bank wants the customer present): release the allowance and fall back to Checkout.
 await deps.db.tenant(merchantId,c=>c.query("UPDATE meta_cart_orders SET autopay_grant_id=NULL WHERE id=$1 AND status='PENDING'",[o.orderId]));
 return {orderId:o.orderId,access:o.access,kind:'checkout',miss:'DECLINED',checkoutUrl:await cartCheckout(deps,merchantId,o,opts.publicOrigin)};
}

async function createCartOrder(deps:AgentDeps,merchantId:string,lines:CartLine[],opts:CartOpts,autopay:boolean){
 if(!deps.stripe)throw new CartError('PAYMENTS_UNAVAILABLE');
 if((opts.channel==='counter')!==Boolean(opts.staffUserId)||opts.channel==='chat'&&!opts.linkId)throw new CartError('INVALID_INPUT');
 const p=await price(deps,merchantId,lines);
 const access=randomBytes(24).toString('base64url');
 const {orderId,grant,miss}=await deps.db.tenant(merchantId,async c=>{
  let grant:AllowanceGrant|null=null,miss:AllowanceMiss|null=null;
  const id=(await c.query<{id:string}>(`INSERT INTO meta_cart_orders(merchant_id,channel,table_id,link_id,access_sha256,currency,amount_minor,discount_minor,created_by,device_id,expires_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp()+interval '${LIFETIME_MIN} minutes') RETURNING id`,
   [merchantId,opts.channel,opts.tableId??null,opts.linkId??null,sha(access),p.currency,p.total.toString(),p.discount.toString(),opts.staffUserId??null,opts.deviceId??null])).rows[0].id;
  for(const x of p.priced)await c.query('INSERT INTO meta_cart_items(merchant_id,order_id,line,product_id,name,name_en,emoji,quantity,unit_minor,base_minor,offer_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
   [merchantId,id,x.line,x.m.productId,x.m.name,x.m.nameEn,x.m.emoji,x.quantity,x.unit.toString(),x.base.toString(),x.m.offer?.offerId??null]);
  // The allowance row stays locked until this order commits, so two orders cannot both use its last part.
  if(autopay&&opts.linkId){
   const a=await reserveAllowance(c,{linkId:opts.linkId},p.total,p.currency);
   if('grant' in a){grant=a.grant;await c.query('UPDATE meta_cart_orders SET autopay_grant_id=$2 WHERE id=$1',[id,a.grant.id]);}else miss=a.miss;
  }
  return {orderId:id,grant,miss};
 });
 return {orderId,access,total:p.total,currency:p.currency,items:p.priced.reduce((n,x)=>n+x.quantity,0),grant,miss};
}
async function cartCheckout(deps:AgentDeps,merchantId:string,o:{orderId:string;access:string;total:bigint;currency:Currency;items:number},publicOrigin:string):Promise<string>{
 const {orderId,items}=o;
 const back=`${publicOrigin}/receipt/${orderId}?a=${o.access}`;
 const session=await createCheckoutSession(deps.stripe!.config,{merchantId,orderId,quoteId:orderId,amountMinor:o.total,currency:o.currency,
  productName:`Muse order #${cartCode(orderId)} · ${items} item${items>1?'s':''}`,successUrl:`${back}&s={CHECKOUT_SESSION_ID}`,cancelUrl:`${publicOrigin}/cart`,
  expiresAtSeconds:Math.floor(Date.now()/1000)+LIFETIME_MIN*60},deps.stripe!.fetch);
 await deps.db.tenant(merchantId,c=>c.query('UPDATE meta_cart_orders SET stripe_checkout_id=$2,checkout_url=$3 WHERE id=$1',[orderId,session.id,session.url]));
 return session.url!;
}

/** Inside the shop's transaction: PAID once, stock once per line, recorded. */
async function markCartPaid(c:pg.PoolClient,orderId:string,f:{paymentIntentId:string;amountMinor:bigint;currency:string;source:'webhook'|'lookup'|'charge'}):Promise<'PAID'|'ALREADY_PAID'|'MISMATCH'|'UNKNOWN_ORDER'>{
 const o=(await c.query<{status:string;amount_minor:string;currency:string}>('SELECT status,amount_minor::text,currency FROM meta_cart_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
 if(!o)return 'UNKNOWN_ORDER';
 if(o.status==='PAID'||o.status==='CANCELLED')return 'ALREADY_PAID';
 if(BigInt(o.amount_minor)!==f.amountMinor||o.currency!==f.currency)return 'MISMATCH';
 let short=false;
 for(const l of (await c.query<{line:number;product_id:string;quantity:number}>('SELECT line,product_id,quantity FROM meta_cart_items WHERE order_id=$1 ORDER BY line',[orderId])).rows){
  const took=(await c.query('UPDATE products SET stock=stock-$2 WHERE id=$1 AND stock-reserved>=$2',[l.product_id,l.quantity])).rowCount===1;
  if(took)await c.query("INSERT INTO meta_stock_movements(merchant_id,product_id,delta,reason,order_kind,order_id,line) VALUES(current_setting('bitpos.merchant')::uuid,$1,$2,'cart_paid','cart',$3,$4)",[l.product_id,-l.quantity,orderId,l.line]);
  else short=true;
 }
 await c.query("UPDATE meta_cart_orders SET status='PAID',paid_at=clock_timestamp(),paid_source=$2,stripe_payment_intent_id=$3,stock_short=$4 WHERE id=$1",[orderId,f.source,f.paymentIntentId,short]);
 await linkPreorder(c,orderId);
 return 'PAID';
}
export async function cartOrderMerchant(db:MetaDb,orderId:string):Promise<string|null>{
 if(!UUID.test(orderId))return null;
 return (await db.query<{m:string|null}>('SELECT bitpos.meta_cart_order_merchant($1) AS m',[orderId])).rows[0]?.m??null;
}
/** Signed payment_intent.succeeded for a cart order: dedupe the event, then mark paid if it matches. */
export async function applyCartWebhook(db:MetaDb,merchantId:string,fact:PaymentFact){
 return db.tenant(merchantId,async c=>{
  if(!(await c.query('SELECT 1 FROM meta_cart_orders WHERE id=$1',[fact.orderId])).rowCount)return 'UNKNOWN_ORDER' as const;
  if(!(await c.query('INSERT INTO meta_cart_stripe_events(merchant_id,event_id,order_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[merchantId,fact.eventId,fact.orderId])).rowCount)return 'DUPLICATE_EVENT' as const;
  return markCartPaid(c,fact.orderId,{paymentIntentId:fact.paymentIntentId,amountMinor:fact.amountMinor,currency:fact.currency,source:'webhook'});
 });
}

async function viewOf(c:pg.PoolClient,orderId:string):Promise<CartOrderView|null>{
 const o=(await c.query<{id:string;channel:CartChannel;status:CartOrderView['status'];expired:boolean;currency:Currency;amount_minor:string;discount_minor:string;checkout_url:string|null;paid_at:Date|null;handed_over_at:Date|null;stock_short:boolean;label:string|null}>(
  `SELECT o.id,o.channel,o.status,(o.status='PENDING' AND o.expires_at<clock_timestamp()) AS expired,o.currency,o.amount_minor::text,o.discount_minor::text,o.checkout_url,o.paid_at,o.handed_over_at,o.stock_short,t.label
   FROM meta_cart_orders o LEFT JOIN merchant_tables t ON t.merchant_id=o.merchant_id AND t.id=o.table_id WHERE o.id=$1`,[orderId])).rows[0];
 if(!o)return null;
 const lines=(await c.query<{product_id:string;name:string;name_en:string;emoji:string;quantity:number;unit_minor:string;base_minor:string}>('SELECT product_id,name,name_en,emoji,quantity,unit_minor::text,base_minor::text FROM meta_cart_items WHERE order_id=$1 ORDER BY line',[orderId])).rows;
 const f=(m:string|bigint)=>formatTapAmount(m.toString(),o.currency);
 return {orderId:o.id,code:cartCode(o.id),channel:o.channel,status:o.expired?'EXPIRED':o.status,currency:o.currency,amountMinor:o.amount_minor,total:f(o.amount_minor),discount:f(o.discount_minor),
  checkoutUrl:o.status==='PENDING'&&!o.expired?o.checkout_url:null,paidAt:o.paid_at?.toISOString()??null,handedOverAt:o.handed_over_at?.toISOString()??null,stockShort:o.stock_short,tableLabel:o.label,
  lines:lines.map(l=>({productId:l.product_id,name:l.name,nameEn:l.name_en,emoji:l.emoji,quantity:l.quantity,unit:f(l.unit_minor),amount:f(BigInt(l.unit_minor)*BigInt(l.quantity)),offer:BigInt(l.base_minor)>BigInt(l.unit_minor)}))};
}
/** The customer's receipt page: needs the access token from the return link; asks Stripe once if still pending. */
export async function cartReceipt(deps:AgentDeps,orderId:string,access:string|null,checkoutId:string|null):Promise<CartOrderView|null>{
 if(!UUID.test(orderId)||!access||!/^[A-Za-z0-9_-]{32}$/.test(access))return null;
 const merchantId=await cartOrderMerchant(deps.db,orderId);if(!merchantId)return null;
 const first=await deps.db.tenant(merchantId,async c=>{
  const ok=(await c.query<{checkout:string|null}>('SELECT stripe_checkout_id AS checkout FROM meta_cart_orders WHERE id=$1 AND access_sha256=$2',[orderId,sha(access)])).rows[0];
  return ok?{view:await viewOf(c,orderId),checkout:ok.checkout}:null;
 });
 if(!first?.view)return null;
 if(first.view.status!=='PENDING'||!deps.stripe||!first.checkout||(checkoutId&&checkoutId!==first.checkout))return first.view;
 // Server-to-server lookup; the redirect itself proves nothing.
 const s=await retrieveCheckoutSession(deps.stripe.config,first.checkout,deps.stripe.fetch).catch(()=>null);
 if(!s?.paid||!s.paymentIntentId||s.orderId!==orderId||s.merchantId!==merchantId)return first.view;
 return deps.db.tenant(merchantId,async c=>{await markCartPaid(c,orderId,{paymentIntentId:s.paymentIntentId!,amountMinor:s.amountMinor,currency:s.currency,source:'lookup'});return viewOf(c,orderId);});
}
export async function cartForStaff(db:MetaDb,merchantId:string,orderId:string):Promise<CartOrderView|null>{
 if(!UUID.test(orderId))return null;
 return db.tenant(merchantId,c=>viewOf(c,orderId));
}
export async function handOverCart(db:MetaDb,merchantId:string,staffUserId:string,orderId:string):Promise<'HANDED_OVER'|'ALREADY'|'NOT_PAID'|'NOT_FOUND'|'NOT_CHECKED_IN'>{
 if(!UUID.test(orderId))return 'NOT_FOUND';
 return db.tenant(merchantId,async c=>{
  const o=(await c.query<{status:string;handed:boolean;held:boolean|null}>(`SELECT o.status,o.handed_over_at IS NOT NULL AS handed,(SELECT r.status='HELD' FROM meta_table_reservations r WHERE r.merchant_id=o.merchant_id AND r.id=o.reservation_id) AS held FROM meta_cart_orders o WHERE o.id=$1 FOR UPDATE OF o`,[orderId])).rows[0];
  if(!o)return 'NOT_FOUND';if(o.status!=='PAID')return 'NOT_PAID';if(o.handed)return 'ALREADY';if(o.held)return 'NOT_CHECKED_IN';
  await c.query('UPDATE meta_cart_orders SET handed_over_at=clock_timestamp(),handed_over_by=$2 WHERE id=$1',[orderId,staffUserId]);return 'HANDED_OVER';
 });
}
/** Staff refund before hand-over: full amount, idempotent at Stripe, stock returned once per line. */
export async function refundCart(deps:AgentDeps,merchantId:string,orderId:string):Promise<CartOrderView>{
 if(!deps.stripe)throw new CartError('PAYMENTS_UNAVAILABLE');
 const o=await deps.db.tenant(merchantId,async c=>(await c.query<{status:string;handed:boolean;pi:string|null;amount:string}>('SELECT status,handed_over_at IS NOT NULL AS handed,stripe_payment_intent_id AS pi,amount_minor::text AS amount FROM meta_cart_orders WHERE id=$1',[orderId])).rows[0]);
 if(!o)throw new CartError('NOT_FOUND');
 if(o.status==='CANCELLED')return (await cartForStaff(deps.db,merchantId,orderId))!;
 if(o.status!=='PAID'||o.handed||!o.pi)throw new CartError('NOT_CANCELLABLE');
 const refund=await refundPaymentIntent(deps.stripe.config,{paymentIntentId:o.pi,amountMinor:BigInt(o.amount),orderId},deps.stripe.fetch);
 return deps.db.tenant(merchantId,async c=>{
  const cur=(await c.query<{status:string;stock_short:boolean}>('SELECT status,stock_short FROM meta_cart_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
  if(cur.status==='PAID'){
   for(const m of (await c.query<{line:number;product_id:string;delta:number}>("SELECT line,product_id,delta FROM meta_stock_movements WHERE order_kind='cart' AND order_id=$1 AND reason='cart_paid'",[orderId])).rows){
    await c.query('UPDATE products SET stock=stock+$2 WHERE id=$1',[m.product_id,-m.delta]);
    await c.query("INSERT INTO meta_stock_movements(merchant_id,product_id,delta,reason,order_kind,order_id,line) VALUES(current_setting('bitpos.merchant')::uuid,$1,$2,'cart_refunded','cart',$3,$4)",[m.product_id,-m.delta,orderId,m.line]);
   }
   await c.query("UPDATE meta_cart_orders SET status='CANCELLED',stripe_refund_id=$2,cancelled_at=clock_timestamp() WHERE id=$1",[orderId,refund.id]);
  }
  return (await viewOf(c,orderId))!;
 });
}
/** Messenger receipt for a paid chat cart (consented, not revoked links only). */
export async function cartChatReceipt(db:MetaDb,merchantId:string,orderId:string,publicOrigin:string):Promise<{psid:string;text:string;receipt:import('./messenger').Receipt}|null>{
 if(!UUID.test(orderId))return null;
 return db.tenant(merchantId,async c=>{
  const o=(await c.query<{psid:string;shop:string;status:string;currency:string;amount_minor:string;discount_minor:string;paid_at:Date|null}>(
   `SELECT l.psid,m.name AS shop,o.status,o.currency,o.amount_minor::text,o.discount_minor::text,o.paid_at FROM meta_cart_orders o JOIN merchants m ON m.id=o.merchant_id
    JOIN meta_customer_links l ON l.merchant_id=o.merchant_id AND l.id=o.link_id AND l.revoked_at IS NULL WHERE o.id=$1 AND o.channel='chat'`,[orderId])).rows[0];
  if(!o||o.status!=='PAID')return null;
  const items=(await c.query<{name:string;name_en:string;emoji:string;quantity:number;unit_minor:string;image_url:string|null}>(
   'SELECT i.name,i.name_en,i.emoji,i.quantity,i.unit_minor::text,p.image_url FROM meta_cart_items i LEFT JOIN products p ON p.merchant_id=i.merchant_id AND p.id=i.product_id WHERE i.order_id=$1 ORDER BY i.line',[orderId])).rows;
  const pre=await preorderNote(c,'meta_cart_orders',orderId);
  const code=cartCode(orderId),cur=o.currency.toUpperCase(),dec=(m:string|bigint)=>Number(BigInt(m))/100,f=(m:string)=>formatTapAmount(m,o.currency);
  const img=(u:string|null)=>u?.startsWith('/images/')?publicOrigin+'/meta'+u:u?.startsWith('https://')?u:undefined;
  const text=`จ่ายแล้ว ✓ รหัสรับสินค้า #${code} · ${o.shop}\n${items.map(i=>`${i.emoji} ${i.name} ×${i.quantity}`).join('\n')}\n${BigInt(o.discount_minor)>0n?`ส่วนลด −${f(o.discount_minor)}\n`:''}รวม ${f(o.amount_minor)}${pre?`\n${pre.text}\nStripe sandbox, test mode.`:` · ร้านกำลังเตรียม จะแจ้งเมื่อพร้อมรับค่ะ\nPaid — order #${code}. We will tell you when it is ready. Stripe sandbox, test mode.`}`;
  return {psid:o.psid,text,receipt:{recipientName:`${o.shop} · รหัสรับ #${code}`,orderNumber:code,currency:cur,paymentMethod:'Stripe sandbox (test mode)',timestamp:Math.floor((o.paid_at??new Date()).getTime()/1000),
   elements:items.map(i=>({title:`${i.emoji} ${i.name} / ${i.name_en}`,subtitle:pre?.subtitle??'กำลังเตรียม · แจ้งเมื่อพร้อมรับ / Preparing · we will tell you when ready',quantity:i.quantity,price:dec(i.unit_minor),currency:cur,imageUrl:img(i.image_url)})),
   total:dec(o.amount_minor),subtotal:dec(BigInt(o.amount_minor)+BigInt(o.discount_minor)),discount:BigInt(o.discount_minor)>0n?dec(o.discount_minor):undefined}};
 });
}
/** A Messenger customer's own recent cart orders for "My orders". */
export async function customerCartOrders(db:MetaDb,merchantId:string,linkId:string):Promise<CartOrderView[]>{
 return db.tenant(merchantId,async c=>{
  const ids=(await c.query<{id:string}>("SELECT id FROM meta_cart_orders WHERE link_id=$1 AND created_at>clock_timestamp()-interval '7 days' AND (status<>'PENDING' OR expires_at>clock_timestamp()) ORDER BY created_at DESC LIMIT 5",[linkId])).rows;
  return (await Promise.all(ids.map(r=>viewOf(c,r.id)))).filter((v):v is CartOrderView=>!!v);
 });
}
export {formatTapAmount};
