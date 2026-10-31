// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// AI auto-pay allowance (migration 328). A consented Messenger customer picks how long the shop's AI may pay for them
// (1, 7, 30 or 90 days) and two caps (per order, in total), then saves a card on a hosted Stripe Checkout in setup
// mode. While the allowance is active, a chat checkout — or the customer's own agent through the Muse Connector with
// the one-time agent key — is charged off-session without a Pay button. The server, never the model, checks the
// allowance inside the order's transaction (the allowance row is locked, so two orders cannot both fit the last
// dollars). PAID still comes only from the PaymentIntent the server created (checked) or a signed webhook.
// The customer can stop it at any time in Messenger; it also ends by itself.
import {createHash,randomBytes} from 'node:crypto';
import type pg from 'pg';
import type {MetaDb} from './identity';
import {listMenu,type AgentDeps,type Currency} from './agent-orders';
import {formatTapAmount} from './staff';
import {createSetupCheckout,retrieveSetupCheckout} from './stripe';

export const AUTOPAY_DAYS=[1,7,30,90] as const;
/** Ready-made caps [per order, total] in Stripe minor units per currency; the chat offers these as buttons. */
export const AUTOPAY_CAPS:Record<Currency,[number,number][]>={usd:[[500,2000],[1000,5000],[2000,15000]],thb:[[20000,80000],[40000,200000],[80000,600000]]};
export type AutopayStatus='SETUP'|'ACTIVE'|'REVOKED'|'EXPIRED';
export interface AutopayView {grantId:string;status:AutopayStatus;days:number;currency:Currency;perOrder:string;total:string;spent:string;left:string;leftMinor:bigint;expiresAt:string|null;cardLabel:string|null}
export class AutopayError extends Error {constructor(readonly code:'INVALID_INPUT'|'NOT_FOUND'|'PAYMENTS_UNAVAILABLE'|'PROVIDER'){super(code);}}
/** Why an order was not paid from the allowance (the customer then sees the normal Pay button). */
export type AllowanceMiss='NONE'|'EXPIRED'|'CURRENCY'|'OVER_ORDER'|'OVER_TOTAL';
export interface AllowanceGrant {id:string;linkId:string;customerId:string;paymentMethodId:string}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY=/^bpa_[A-Za-z0-9_-]{32}$/;
const sha=(s:string)=>createHash('sha256').update(s).digest();
/** Minor units already used under an allowance: paid orders and charges still in flight (refunded or failed ones do not count). */
const SPENT=`(SELECT coalesce(sum(amount_minor),0) FROM meta_cart_orders WHERE autopay_grant_id=g.id AND status IN ('PENDING','PAID'))
 +(SELECT coalesce(sum(amount_minor),0) FROM meta_agent_orders WHERE autopay_grant_id=g.id AND status IN ('PENDING','CONFIRMED','REFUNDING'))`;
type Row={id:string;status:'SETUP'|'ACTIVE'|'REVOKED';expired:boolean;days:number;currency:Currency;per_order_max_minor:string;total_max_minor:string;spent:string;expires_at:Date|null;card_label:string|null};
const COLS=`g.id,g.status,(g.status='ACTIVE' AND g.expires_at<=clock_timestamp()) AS expired,g.days,g.currency,g.per_order_max_minor::text,g.total_max_minor::text,(${SPENT})::text AS spent,g.expires_at,g.card_label`;
function view(r:Row):AutopayView{
 const f=(m:bigint)=>formatTapAmount(m.toString(),r.currency),total=BigInt(r.total_max_minor),spent=BigInt(r.spent),left=total>spent?total-spent:0n;
 return {grantId:r.id,status:r.expired?'EXPIRED':r.status,days:r.days,currency:r.currency,perOrder:f(BigInt(r.per_order_max_minor)),total:f(total),spent:f(spent),left:f(left),leftMinor:left,
  expiresAt:r.expires_at?.toISOString()??null,cardLabel:r.card_label};
}

/** The shop's payable currency (the first payable menu item), so caps are in the money the menu is priced in. */
export async function shopCurrency(deps:AgentDeps,merchantId:string):Promise<Currency>{
 return (await listMenu(deps,merchantId)).find(i=>i.payable)?.price.currency??'usd';
}

/** Step 3 in chat: records the allowance (not yet active) and opens Stripe Checkout in setup mode to save a card. */
export async function startAutopay(deps:AgentDeps,merchantId:string,linkId:string,input:{days:number;perOrderMinor:number;totalMinor:number},publicOrigin:string):Promise<{grantId:string;url:string}>{
 if(!deps.stripe)throw new AutopayError('PAYMENTS_UNAVAILABLE');
 const currency=await shopCurrency(deps,merchantId);
 if(!(AUTOPAY_DAYS as readonly number[]).includes(input.days)||!AUTOPAY_CAPS[currency].some(([o,t])=>o===input.perOrderMinor&&t===input.totalMinor))throw new AutopayError('INVALID_INPUT');
 const grantId=await deps.db.tenant(merchantId,async c=>(await c.query<{id:string}>('INSERT INTO meta_autopay_grants(merchant_id,link_id,days,currency,per_order_max_minor,total_max_minor) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
  [merchantId,linkId,input.days,currency,input.perOrderMinor,input.totalMinor])).rows[0].id);
 const f=(m:number)=>formatTapAmount(String(m),currency);
 let s;
 try{s=await createSetupCheckout(deps.stripe.config,{grantId,merchantId,currency,successUrl:`${publicOrigin}/meta/autopay/done?g=${grantId}&s={CHECKOUT_SESSION_ID}`,cancelUrl:`${publicOrigin}/meta/autopay/done?g=${grantId}`,
  description:`AI auto-pay for ${input.days} day${input.days>1?'s':''}: up to ${f(input.perOrderMinor)} per order and ${f(input.totalMinor)} in total. Stop any time in Messenger. Stripe sandbox, test mode.`},deps.stripe.fetch);}
 catch{throw new AutopayError('PROVIDER');}
 await deps.db.tenant(merchantId,c=>c.query('UPDATE meta_autopay_grants SET stripe_customer_id=$2,stripe_setup_session_id=$3,setup_url=$4 WHERE id=$1 AND status=\'SETUP\'',[grantId,s.customerId,s.id,s.url]));
 return {grantId,url:s.url!};
}

/** Return page after Stripe: asks Stripe (server to server) whether the card was saved, then activates the allowance once.
 * The agent key is made only by the request that activates it and is never stored in clear. */
export async function activateAutopay(deps:AgentDeps,grantIdIn:unknown):Promise<{merchantId:string;view:AutopayView;agentKey:string|null;psid:string|null}|null>{
 if(typeof grantIdIn!=='string'||!UUID.test(grantIdIn))return null;
 const grantId=grantIdIn;
 const merchantId=(await deps.db.query<{m:string|null}>('SELECT bitpos.meta_autopay_grant_merchant($1) AS m',[grantId])).rows[0]?.m;
 if(!merchantId)return null;
 const read=(c:pg.PoolClient)=>c.query<Row&{session:string|null;link_id:string}>(`SELECT ${COLS},g.stripe_setup_session_id AS session,g.link_id FROM meta_autopay_grants g WHERE g.id=$1`,[grantId]).then(r=>r.rows[0]);
 const before=await deps.db.tenant(merchantId,read);
 if(before.status!=='SETUP'||!before.session||!deps.stripe)return {merchantId,view:view(before),agentKey:null,psid:null};
 const s=await retrieveSetupCheckout(deps.stripe.config,before.session,deps.stripe.fetch).catch(()=>null);
 if(!s?.complete||s.grantId!==grantId||s.merchantId!==merchantId||!s.customerId||!s.paymentMethodId)return {merchantId,view:view(before),agentKey:null,psid:null};
 const key=`bpa_${randomBytes(24).toString('base64url')}`;
 return deps.db.tenant(merchantId,async c=>{
  const g=(await c.query<{link_id:string}>("SELECT link_id FROM meta_autopay_grants WHERE id=$1 AND status='SETUP' FOR UPDATE",[grantId])).rows[0];
  if(!g)return {merchantId,view:view((await read(c))!),agentKey:null,psid:null};
  // A new allowance replaces the customer's previous one.
  await c.query("UPDATE meta_autopay_grants SET status='REVOKED',revoked_at=clock_timestamp() WHERE link_id=$1 AND status='ACTIVE'",[g.link_id]);
  await c.query(`UPDATE meta_autopay_grants SET status='ACTIVE',stripe_payment_method_id=$2,card_label=$3,agent_key_sha256=$4,activated_at=n.t,expires_at=n.t+make_interval(days=>days)
   FROM (SELECT clock_timestamp() AS t) n WHERE id=$1`,[grantId,s.paymentMethodId,s.cardLabel?.slice(0,40)??null,sha(key)]);
  const psid=(await c.query<{psid:string}>('SELECT psid FROM meta_customer_links WHERE id=$1 AND revoked_at IS NULL',[g.link_id])).rows[0]?.psid??null;
  return {merchantId,view:view((await read(c))!),agentKey:key,psid};
 });
}

/** The customer's current allowance (active first, else the latest one), or null. */
export async function autopayStatus(db:MetaDb,merchantId:string,linkId:string):Promise<AutopayView|null>{
 const r=(await db.tenant(merchantId,c=>c.query<Row>(`SELECT ${COLS} FROM meta_autopay_grants g WHERE g.link_id=$1 AND g.status<>'SETUP' ORDER BY (g.status='ACTIVE') DESC,g.created_at DESC LIMIT 1`,[linkId]))).rows[0];
 return r?view(r):null;
}
/** Stop: ends every active allowance of this customer at once. */
export async function revokeAutopay(db:MetaDb,merchantId:string,linkId:string):Promise<number>{
 return (await db.tenant(merchantId,c=>c.query("UPDATE meta_autopay_grants SET status='REVOKED',revoked_at=clock_timestamp() WHERE link_id=$1 AND status IN ('ACTIVE','SETUP')",[linkId]))).rowCount??0;
}

/** Inside the order's transaction: lock the customer's active allowance and check this amount fits. */
export async function reserveAllowance(c:pg.PoolClient,by:{linkId:string}|{agentKey:string},amountMinor:bigint,currency:Currency):Promise<{grant:AllowanceGrant}|{miss:AllowanceMiss}>{
 if('agentKey' in by&&!KEY.test(by.agentKey))return {miss:'NONE'};
 const g=(await c.query<{id:string;link_id:string;expired:boolean;currency:Currency;per_order_max_minor:string;total_max_minor:string;stripe_customer_id:string;stripe_payment_method_id:string}>(
  `SELECT id,link_id,expires_at<=clock_timestamp() AS expired,currency,per_order_max_minor::text,total_max_minor::text,stripe_customer_id,stripe_payment_method_id FROM meta_autopay_grants
   WHERE status='ACTIVE' AND ${'linkId' in by?'link_id=$1':'agent_key_sha256=$1'} FOR UPDATE`,['linkId' in by?by.linkId:sha(by.agentKey)])).rows[0];
 if(!g)return {miss:'NONE'};
 if(g.expired)return {miss:'EXPIRED'};
 if(g.currency!==currency)return {miss:'CURRENCY'};
 if(amountMinor>BigInt(g.per_order_max_minor))return {miss:'OVER_ORDER'};
 const spent=BigInt((await c.query<{s:string}>(`SELECT (${SPENT})::text AS s FROM meta_autopay_grants g WHERE g.id=$1`,[g.id])).rows[0].s);
 if(spent+amountMinor>BigInt(g.total_max_minor))return {miss:'OVER_TOTAL'};
 return {grant:{id:g.id,linkId:g.link_id,customerId:g.stripe_customer_id,paymentMethodId:g.stripe_payment_method_id}};
}

const DAYS_TH:Record<number,string>={1:'1 วัน',7:'1 สัปดาห์',30:'1 เดือน',90:'3 เดือน'},DAYS_EN:Record<number,string>={1:'1 day',7:'1 week',30:'1 month',90:'3 months'};
export const daysLabel=(d:number)=>`${DAYS_TH[d]??`${d} วัน`} / ${DAYS_EN[d]??`${d} days`}`;
export const MISS_TEXT:Record<AllowanceMiss,string>={NONE:'',EXPIRED:'สิทธิ์จ่ายอัตโนมัติหมดอายุแล้ว / Your auto-pay allowance has ended.',
 CURRENCY:'สิทธิ์จ่ายอัตโนมัติใช้กับสกุลเงินนี้ไม่ได้ / Auto-pay does not cover this currency.',OVER_ORDER:'ยอดนี้เกินวงเงินต่อครั้งที่ตั้งไว้ จ่ายเองได้เลยค่ะ / Over your per-order cap; pay by hand.',
 OVER_TOTAL:'วงเงินรวมที่ตั้งไว้เหลือไม่พอ จ่ายเองได้เลยค่ะ / Not enough left in your allowance; pay by hand.'};
/** One line for chat: what is left and until when (Bangkok time). */
export function allowanceLine(v:AutopayView):string{
 const until=v.expiresAt?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'}).format(new Date(v.expiresAt)):'';
 return `เหลือ ${v.left} จาก ${v.total} · ไม่เกิน ${v.perOrder}/ครั้ง · ถึง ${until}\n${v.left} of ${v.total} left · up to ${v.perOrder} per order · until ${until}`;
}
