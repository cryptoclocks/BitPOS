// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// JSON for the POS screens of meta-pos (Meta edition): the POS signs staff in through its own API and sends
// "Authorization: Bearer <POS session token>"; this module checks that token against the POS sessions table and
// re-reads the member's role, then answers only for that member's shop. A counter sale becomes a Stripe Checkout
// bill (the same cart orders as meta-pay); PAID still comes only from the signed webhook or a server-side lookup.
import type http from 'node:http';
import {createHash} from 'node:crypto';
import QRCode from 'qrcode';
import type {MetaRouteDeps} from './routes';
import {agentDepsOf} from './shop';
import {cartForStaff,CartError,handOverCart,refundCart,startCart,type CartLine} from './cart';
import {handOver,listTapOrders,type StaffView} from './staff';
import {staffSessionFor} from './staff';
import {staffCookie} from './routes';

export interface PosMember {userId:string;merchantId:string;role:'owner'|'manager'|'staff'}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const json=(res:http.ServerResponse,status:number,body:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));return true as const;};

/** The POS session behind a Bearer token (sha256 hex, unexpired, role re-read from members). */
export async function posMember(deps:MetaRouteDeps,authorization:string|undefined):Promise<PosMember|null>{
 const token=authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,200})$/)?.[1];
 if(!token)return null;
 const r=(await deps.identity.db.query<{user_id:string;merchant_id:string;role:string}>(
  'SELECT s.user_id,s.merchant_id,m.role FROM sessions s JOIN members m ON m.user_id=s.user_id AND m.merchant_id=s.merchant_id WHERE s.token_hash=$1 AND s.expires_at>now()',
  [createHash('sha256').update(token).digest('hex')])).rows[0];
 return r&&['owner','manager','staff'].includes(r.role)?{userId:r.user_id,merchantId:r.merchant_id,role:r.role as PosMember['role']}:null;
}

async function body(req:http.IncomingMessage):Promise<unknown>{
 const parts:Buffer[]=[];let n=0;for await(const c of req){n+=c.length;if(n>16384)return null;parts.push(c);}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return null;}
}

/** /meta/staff/api/*; returns false for other paths. */
export async function servePosApi(req:http.IncomingMessage,res:http.ServerResponse,deps:MetaRouteDeps,path:string,log:(m:string)=>void):Promise<boolean>{
 if(!path.startsWith('/meta/staff/api/'))return false;
 const method=req.method??'GET';
 if(method==='POST'&&req.headers.origin!==deps.staff?.config.origin)return json(res,403,{error:'SAME_ORIGIN_REQUIRED'});
 const me=await posMember(deps,req.headers.authorization);
 if(!me)return json(res,401,{error:'AUTH_REQUIRED'});
 if(path==='/meta/staff/api/sso'&&method==='POST'){
  // The Muse tab shows Meta pages in frames; they use the Meta staff cookie, made here from the POS session.
  if(!deps.staff)return json(res,503,{error:'UNAVAILABLE'});
  const token=await staffSessionFor(deps.staff,me.merchantId,me.userId);
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':staffCookie(deps.staff,token,28800)});res.end('{"ok":true}');return true;
 }
 const agent=agentDepsOf(deps);
 if(!agent?.stripe)return json(res,503,{error:'PAYMENTS_UNAVAILABLE'});
 const bill=async(id:string)=>{
  const v=await cartForStaff(deps.identity.db,me.merchantId,id);
  if(!v)return null;
  const payUrl=`${deps.identity.publicOrigin}/pay/${v.orderId}`;
  return {orderId:v.orderId,code:v.code,status:v.status,total:v.total,discount:v.discount,lines:v.lines,payUrl,
   qrSvg:v.status==='PENDING'&&v.checkoutUrl?await QRCode.toString(payUrl,{type:'svg',margin:1,errorCorrectionLevel:'M'}):null};
 };
 if(path==='/meta/staff/api/counter'&&method==='POST'){
  const b=await body(req) as {items?:{productId?:unknown;qty?:unknown}[];deviceId?:unknown}|null;
  const lines:CartLine[]=(Array.isArray(b?.items)?b!.items:[]).slice(0,50).flatMap(i=>typeof i?.productId==='string'&&UUID.test(i.productId)&&Number.isInteger(i.qty)&&(i.qty as number)>=1&&(i.qty as number)<=20?[{productId:i.productId,quantity:i.qty as number}]:[]);
  const deviceId=typeof b?.deviceId==='string'&&UUID.test(b.deviceId)&&(await deps.identity.db.tenant(me.merchantId,c=>c.query('SELECT 1 FROM devices WHERE id=$1 AND revoked_at IS NULL',[b.deviceId]))).rowCount?b.deviceId as string:null;
  try{const r=await startCart(agent,me.merchantId,lines,{channel:'counter',staffUserId:me.userId,deviceId,publicOrigin:deps.identity.publicOrigin});log('POS counter bill started (Stripe)');return json(res,200,await bill(r.orderId));}
  catch(e){if(e instanceof CartError)return json(res,409,{error:e.code});throw e;}
 }
 const one=path.match(/^\/meta\/staff\/api\/counter\/([0-9a-f-]{36})$/);
 if(one&&method==='GET'){const v=await bill(one[1]);return v?json(res,200,v):json(res,404,{error:'NOT_FOUND'});}
 // Meta orders (NFC tap, Messenger, AI agents, table, web and Stripe counter bills) for the POS order center.
 const view:StaffView={merchantId:me.merchantId,userId:me.userId,role:me.role,sessionId:''};
 if(path==='/meta/staff/api/orders'&&method==='GET'){
  if(!deps.staff)return json(res,503,{error:'UNAVAILABLE'});
  return json(res,200,{orders:await listTapOrders(deps.staff,view),canRefund:me.role!=='staff'});
 }
 const act=path.match(/^\/meta\/staff\/api\/orders\/([0-9a-f-]{36})\/(handover|refund)$/);
 if(act&&method==='POST'){
  if(!deps.staff)return json(res,503,{error:'UNAVAILABLE'});
  if(act[2]==='handover'){
   let r=await handOver(deps.staff,view,act[1]);
   if(r==='NOT_FOUND')r=await handOverCart(deps.identity.db,me.merchantId,me.userId,act[1]);
   return r==='HANDED_OVER'||r==='ALREADY'?json(res,200,{ok:true}):json(res,r==='NOT_FOUND'?404:409,{error:r});
  }
  if(me.role==='staff')return json(res,403,{error:'ROLE_REQUIRED'});
  try{await refundCart(agent,me.merchantId,act[1]);log('Cart order refunded from the POS screens');return json(res,200,{ok:true});}
  catch(e){if(e instanceof CartError)return json(res,409,{error:e.code});log('Refund failed');return json(res,502,{error:'STRIPE_FAILED'});}
 }
 if(path==='/meta/staff/api/devices'&&method==='GET'){
  const rows=(await deps.identity.db.tenant(me.merchantId,c=>c.query<{id:string;label:string}>('SELECT id,label FROM devices WHERE revoked_at IS NULL ORDER BY label'))).rows;
  return json(res,200,{devices:rows});
 }
 return json(res,404,{error:'NOT_FOUND'});
}
