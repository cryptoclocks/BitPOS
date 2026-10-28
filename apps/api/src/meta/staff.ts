// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Staff view of tap orders: sign in with the POS account (Supabase Auth password grant), then list the
// shop's tap orders and hand a paid one over once. The role is re-read from `members` on every request,
// so removing or demoting a member takes effect immediately. No customer identity (PSID) is shown.
import {createHash,randomBytes} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {z} from 'zod';
import type {MetaDb} from './identity';

export interface StaffConfig {
 /** Origin the staff page is served from (same-origin checks and cookie Secure flag). */
 origin:string;authUrl:string;anonKey:string;
 /** Optional demo accounts file ([{email,password,role}], mode 600) for quick sign-in on a devnet demo. */
 demoLoginFile?:string|null;
 fetch?:(url:string,init:RequestInit)=>Promise<Response>;
}
export interface StaffDeps {db:MetaDb;config:StaffConfig}
export interface StaffView {merchantId:string;userId:string;role:'owner'|'manager'|'staff';sessionId:string}
export type SignInResult={kind:'ok';token:string;role:StaffView['role']}|{kind:'error';reason:'AUTH'|'ROLE'|'UNAVAILABLE'};
export type HandOverResult='HANDED_OVER'|'ALREADY'|'NOT_PAID'|'NOT_FOUND';
export interface StaffOrder {id:string;channel:'tap'|'agent'|'chat'|'table'|'counter'|'web';code:string;status:'CREATED'|'PAID'|'EXPIRED'|'FAILED'|'CANCELLED';emoji:string;name:string;nameEn:string;amountMinor:string;currency:string;
 createdAt:string;paidAt:string|null;paidSource:string|null;stockShort:boolean;handedOverAt:string|null}

const ROLES=['owner','manager','staff'] as const;
const TOKEN=/^[A-Za-z0-9_-]{43}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha=(s:string)=>createHash('sha256').update(s).digest();
const isRole=(r:unknown):r is StaffView['role']=>typeof r==='string'&&(ROLES as readonly string[]).includes(r);
/** Short code the customer sees on the paid page and staff see in the list. */
export const pickupCode=(orderId:string)=>orderId.replace(/-/g,'').slice(0,4).toUpperCase();

export function staffConfigFromEnv(env:Record<string,string|undefined>,fallbackOrigin:string):StaffConfig|null{
 const authUrl=env.META_AUTH_URL,anonKey=env.META_AUTH_ANON_KEY;
 if(!authUrl||!anonKey)return null;
 const a=new URL(authUrl);if(!['http:','https:'].includes(a.protocol))return null;
 const o=new URL(env.META_STAFF_URL||fallbackOrigin);if(!['http:','https:'].includes(o.protocol)||o.pathname!=='/'||o.search||o.hash||o.username)return null;
 return {origin:o.origin,authUrl:authUrl.replace(/\/$/,''),anonKey,demoLoginFile:env.META_STAFF_DEMO_LOGIN_FILE||null};
}

/** Password grant against the shop's own Supabase Auth, then exactly one staff-capable membership. */
export async function staffSignIn(deps:StaffDeps,email:string,password:string):Promise<SignInResult>{
 if(!z.string().email().max(254).safeParse(email).success||!password||password.length>512)return {kind:'error',reason:'AUTH'};
 let response:Response;
 try{response=await (deps.config.fetch??fetch)(`${deps.config.authUrl}/token?grant_type=password`,{method:'POST',headers:{apikey:deps.config.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email,password}),signal:AbortSignal.timeout(10000)});}
 catch{return {kind:'error',reason:'UNAVAILABLE'};}
 if(response.status>=500)return {kind:'error',reason:'UNAVAILABLE'};
 if(!response.ok)return {kind:'error',reason:'AUTH'};
 const user=z.object({user:z.object({id:z.string().regex(UUID)})}).safeParse(await response.json().catch(()=>null));
 if(!user.success)return {kind:'error',reason:'UNAVAILABLE'};
 const userId=user.data.user.id;
 const memberships=(await deps.db.query<{merchant_id:string;role:string}>('SELECT merchant_id,role FROM members WHERE user_id=$1',[userId])).rows;
 if(memberships.length!==1||!isRole(memberships[0].role))return {kind:'error',reason:'ROLE'};
 const {merchant_id:merchantId,role}=memberships[0];
 const token=randomBytes(32).toString('base64url');
 await deps.db.tenant(merchantId,db=>db.query("WITH n AS (SELECT clock_timestamp() AS t) INSERT INTO meta_staff_sessions(merchant_id,user_id,token_sha256,created_at,expires_at) SELECT $1,$2,$3,t,t+interval '8 hours' FROM n",[merchantId,userId,sha(token)]));
 return {kind:'ok',token,role};
}

/** Demo quick sign-in: the same password grant, with credentials read from the private demo file. */
export async function staffDemoSignIn(deps:StaffDeps,role:string):Promise<SignInResult>{
 const file=deps.config.demoLoginFile;
 if(!file||!isRole(role))return {kind:'error',reason:'UNAVAILABLE'};
 try{
  const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0)return {kind:'error',reason:'UNAVAILABLE'};
  const accounts=z.array(z.object({email:z.string().email(),password:z.string().min(1),role:z.string()})).parse(JSON.parse(readFileSync(file,'utf8')));
  const chosen=accounts.find(a=>a.role===role);
  if(!chosen)return {kind:'error',reason:'UNAVAILABLE'};
  return staffSignIn(deps,chosen.email,chosen.password);
 }catch{return {kind:'error',reason:'UNAVAILABLE'};}
}

export async function staffFromSession(deps:StaffDeps,token:string|null|undefined):Promise<StaffView|null>{
 if(!token||!TOKEN.test(token))return null;
 const h=sha(token);
 const merchantId=(await deps.db.query<{m:string|null}>('SELECT bitpos.meta_staff_session_merchant($1) AS m',[h])).rows[0]?.m;
 if(!merchantId)return null;
 return deps.db.tenant(merchantId,async db=>{
  const s=(await db.query<{id:string;user_id:string}>('SELECT id,user_id FROM meta_staff_sessions WHERE token_sha256=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()',[h])).rows[0];
  if(!s)return null;
  const role=(await db.query<{role:string}>('SELECT role FROM members WHERE user_id=$1 AND merchant_id=$2',[s.user_id,merchantId])).rows[0]?.role;
  return isRole(role)?{merchantId,userId:s.user_id,role,sessionId:s.id}:null;
 });
}

export async function staffSignOut(deps:StaffDeps,token:string|null|undefined):Promise<void>{
 const me=await staffFromSession(deps,token);
 if(me)await deps.db.tenant(me.merchantId,db=>db.query('UPDATE meta_staff_sessions SET revoked_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL',[me.sessionId]));
}

/** The last day of tap and agent orders: paid ones first until handed over, then the rest, newest first. */
export async function listTapOrders(deps:StaffDeps,me:StaffView):Promise<StaffOrder[]>{
 return deps.db.tenant(me.merchantId,async db=>(await db.query<{id:string;channel:StaffOrder['channel'];status:StaffOrder['status'];emoji:string;name:string;name_en:string;amount_minor:string;currency:string;created_at:Date;paid_at:Date|null;paid_source:string|null;stock_short:boolean;handed_over_at:Date|null}>(
  `SELECT o.id,o.channel,o.status,o.amount_minor,o.currency,o.created_at,o.paid_at,o.paid_source,o.stock_short,o.handed_over_at,
    coalesce(o.items_emoji,p.emoji,'') AS emoji,coalesce(o.items_name,p.name,'') AS name,coalesce(o.items_name_en,p.name_en,'') AS name_en FROM (
    SELECT id,'tap' AS channel,CASE WHEN status='CREATED' AND expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE status END AS status,
     merchant_id,product_id,amount_minor::text,currency,created_at,paid_at,paid_source,stock_short,handed_over_at,NULL AS items_emoji,NULL AS items_name,NULL AS items_name_en FROM meta_tap_orders WHERE created_at>clock_timestamp()-interval '24 hours'
    UNION ALL
    SELECT id,CASE WHEN link_id IS NULL THEN 'agent' ELSE 'chat' END,CASE status WHEN 'CONFIRMED' THEN 'PAID' WHEN 'PENDING' THEN 'CREATED' WHEN 'FAILED' THEN 'FAILED' ELSE 'CANCELLED' END,
     merchant_id,product_id,amount_minor::text,currency,created_at,confirmed_at,confirmed_source,stock_short,handed_over_at,NULL,NULL,NULL FROM meta_agent_orders WHERE created_at>clock_timestamp()-interval '24 hours'
    UNION ALL
    SELECT c.id,c.channel,CASE WHEN c.status='PENDING' AND c.expires_at<=clock_timestamp() THEN 'EXPIRED' WHEN c.status='PENDING' THEN 'CREATED' ELSE c.status END,
     c.merchant_id,NULL,c.amount_minor::text,c.currency,c.created_at,c.paid_at,c.paid_source,c.stock_short,c.handed_over_at,
     (SELECT string_agg(i.emoji,'' ORDER BY i.line) FROM meta_cart_items i WHERE i.order_id=c.id),
     (SELECT string_agg(i.name||' × '||i.quantity,', ' ORDER BY i.line) FROM meta_cart_items i WHERE i.order_id=c.id),
     (SELECT string_agg(i.name_en||' × '||i.quantity,', ' ORDER BY i.line) FROM meta_cart_items i WHERE i.order_id=c.id) FROM meta_cart_orders c WHERE c.created_at>clock_timestamp()-interval '24 hours'
   ) o LEFT JOIN products p ON p.merchant_id=o.merchant_id AND p.id=o.product_id
   ORDER BY (o.status='PAID' AND o.handed_over_at IS NULL) DESC,o.created_at DESC LIMIT 50`)).rows.map(r=>({
  id:r.id,channel:r.channel,code:pickupCode(r.id),status:r.status,emoji:r.emoji,name:r.name,nameEn:r.name_en,amountMinor:r.amount_minor,currency:r.currency,
  createdAt:r.created_at.toISOString(),paidAt:r.paid_at?.toISOString()??null,paidSource:r.paid_source,stockShort:r.stock_short,handedOverAt:r.handed_over_at?.toISOString()??null})));
}

/** Hand a paid order to the customer: once, by the signed-in member, never for an unpaid order. */
export async function handOver(deps:StaffDeps,me:StaffView,orderId:string):Promise<HandOverResult>{
 if(!UUID.test(orderId))return 'NOT_FOUND';
 return deps.db.tenant(me.merchantId,async db=>{
  // Tap orders are PAID when paid; agent orders are CONFIRMED (a refund in progress blocks hand-over).
  for(const [table,paid] of [['meta_tap_orders','PAID'],['meta_agent_orders','CONFIRMED']] as const){
   const o=(await db.query<{status:string;handed_over_at:Date|null}>(`SELECT status,handed_over_at FROM ${table} WHERE id=$1 FOR UPDATE`,[orderId])).rows[0];
   if(!o)continue;
   if(o.handed_over_at)return 'ALREADY';
   if(o.status!==paid)return 'NOT_PAID';
   await db.query(`UPDATE ${table} SET handed_over_at=clock_timestamp(),handed_over_by=$2 WHERE id=$1`,[orderId,me.userId]);
   return 'HANDED_OVER';
  }
  return 'NOT_FOUND';
 });
}

/** Stripe minor units (2 decimals for THB and USD) for display. */
export function formatTapAmount(amountMinor:string,currency:string):string{
 const v=BigInt(amountMinor),whole=v/100n,cents=(v%100n).toString().padStart(2,'0');
 return `${currency==='usd'?'$':currency==='thb'?'฿':currency.toUpperCase()+' '}${whole}.${cents}`;
}
