// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Raw HTTP handlers under /meta/: the NTAG424 tap URL, the Messenger webhook and the customer web session.
// They need the exact request bytes (webhook signature), cookies and redirects, so they sit beside the JSON API.
import type http from 'node:http';
import {consumeMagicLink,customerFromSession,handleMessengerEvents,handleTap,revokeFromSession,type IdentityDeps} from './identity';
import {MessengerError,messengerConfigFromEnv,parseMessengerWebhook,sendMessenger,verifyMessengerSignature,verifySubscription,type MessengerConfig,type MessengerFetch} from './messenger';

export interface MetaRouteDeps {identity:IdentityDeps;messenger:MessengerConfig;fetch?:MessengerFetch;log?:(msg:string)=>void}
export const COOKIE='bitpos_meta';
const MAX_WEBHOOK=65536;

export function metaRouteDepsFromEnv(env:Record<string,string|undefined>,db:IdentityDeps['db']):MetaRouteDeps|null{
 const master=env.META_TAP_MASTER_KEY,origin=env.META_PUBLIC_URL;
 if(!master||!/^[0-9a-fA-F]{32}$/.test(master)||!origin)return null;
 const u=new URL(origin);if(!['https:','http:'].includes(u.protocol)||u.pathname!=='/'||u.search||u.hash||u.username)return null;
 try{return {identity:{db,masterKey:Buffer.from(master,'hex'),publicOrigin:u.origin},messenger:messengerConfigFromEnv(env)};}catch{return null;}
}

const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function page(res:http.ServerResponse,status:number,title:string,lines:string[],extraHeaders:Record<string,string|string[]>={}){
 const html=`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:17px/1.5 system-ui,sans-serif;margin:0;padding:32px 20px;background:#f7f5ff;color:#1d1440}main{max-width:420px;margin:auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 2px 12px #0001}h1{font-size:22px;color:#5b34d6;margin:0 0 12px}p{margin:8px 0}button{font:inherit;padding:10px 16px;border-radius:10px;border:1px solid #c9bdf5;background:#fff;color:#5b34d6}</style></head><body><main><h1>${esc(title)}</h1>${lines.map(l=>`<p>${l}</p>`).join('')}</main></body></html>`;
 res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',...extraHeaders});
 res.end(html);
}
function json(res:http.ServerResponse,status:number,value:unknown){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}

export function cookieValue(header:string|undefined,name=COOKIE):string|null{
 for(const part of (header??'').split(';')){const i=part.indexOf('=');if(i>0&&part.slice(0,i).trim()===name)return part.slice(i+1).trim();}
 return null;
}
function sessionCookie(deps:MetaRouteDeps,value:string,maxAge:number){
 return `${COOKIE}=${value}; Path=/meta; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${deps.identity.publicOrigin.startsWith('https:')?'; Secure':''}`;
}

async function rawBody(req:http.IncomingMessage,limit:number):Promise<Buffer|null>{
 const parts:Buffer[]=[];let bytes=0;
 for await(const chunk of req){bytes+=chunk.length;if(bytes>limit)return null;parts.push(chunk);}
 return Buffer.concat(parts);
}

/** Returns true when the request was a /meta/ route and has been answered. */
export async function serveMeta(req:http.IncomingMessage,res:http.ServerResponse,deps:MetaRouteDeps|null):Promise<boolean>{
 const url=new URL(req.url??'/','http://local'),path=url.pathname,method=req.method??'GET';
 if(!path.startsWith('/meta/'))return false;
 if(!deps){page(res,503,'ยังไม่พร้อมใช้งาน',['Meta features are not configured on this server.']);return true;}
 const log=deps.log??(()=>{});
 const tap=path.match(/^\/meta\/t\/([A-Za-z0-9_-]{4,64})$/);
 if(tap&&method==='GET'){
  const r=await handleTap(deps.identity,tap[1],url.searchParams.get('e'),url.searchParams.get('m'),cookieValue(req.headers.cookie));
  if(r.kind==='messenger'){res.writeHead(303,{Location:r.url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();return true;}
  if(r.kind==='known'){page(res,200,'สวัสดีค่ะ 👋',['ร้านจำคุณได้แล้ว ดูโปรของคุณได้ที่หน้าจอและในหน้านี้','Welcome back — the shop knows it is you.']);return true;}
  if(r.kind==='replayed'){page(res,409,'กรุณาแตะใหม่อีกครั้ง',['ลิงก์นี้ใช้ไปแล้ว ให้แตะมือถือที่เครื่องอีกครั้ง','This tap link was already used. Tap the device again.']);return true;}
  if(r.kind==='no_page'){page(res,503,'ร้านยังไม่ได้เชื่อม Messenger',['The shop has not connected a Messenger page yet.']);return true;}
  page(res,400,'แตะไม่สำเร็จ',['ให้แตะมือถือที่เครื่องอีกครั้ง','Please tap the device again.']);return true;
 }
 if(path==='/meta/messenger/webhook'){
  if(method==='GET'){const challenge=verifySubscription(url.searchParams,deps.messenger.verifyToken);res.writeHead(challenge?200:403,{'Content-Type':'text/plain'});res.end(challenge??'');return true;}
  if(method==='POST'){
   const raw=await rawBody(req,MAX_WEBHOOK);
   if(!raw){json(res,413,{error:'REQUEST_TOO_LARGE'});return true;}
   try{verifyMessengerSignature(raw,req.headers['x-hub-signature-256'] as string|undefined,deps.messenger.appSecret);}catch{json(res,401,{error:'SIGNATURE_INVALID'});return true;}
   let events;try{events=parseMessengerWebhook(JSON.parse(raw.toString('utf8')));}catch{json(res,400,{error:'PAYLOAD_INVALID'});return true;}
   const outbox=await handleMessengerEvents(deps.identity,events);
   json(res,200,{received:events.length});
   for(const message of outbox){try{await sendMessenger(deps.messenger,message,deps.fetch);}catch(e){log(`Messenger send failed: ${e instanceof MessengerError?e.code:'UNKNOWN'}`);}}
   return true;
  }
 }
 if(path==='/meta/login'&&method==='GET'){
  const s=await consumeMagicLink(deps.identity,url.searchParams.get('t')??'');
  if(!s){page(res,410,'ลิงก์หมดอายุ',['ขอลิงก์ใหม่ได้โดยแตะที่เครื่องอีกครั้ง','This sign-in link expired or was already used.']);return true;}
  page(res,200,'เชื่อมต่อแล้ว ✓',['ครั้งหน้าแค่แตะมือถือที่เครื่อง ร้านจะรู้ว่าเป็นคุณ','Next time, just tap your phone on the device.','<form method="post" action="/meta/me/revoke"><button>ลบการเชื่อมต่อ / Forget me</button></form>'],{'Set-Cookie':sessionCookie(deps,s.sessionToken,2592000)});
  return true;
 }
 if(path==='/meta/me'&&method==='GET'){
  const me=await customerFromSession(deps.identity,cookieValue(req.headers.cookie));
  if(!me){json(res,401,{error:'AUTH_REQUIRED'});return true;}
  json(res,200,{consentedAt:me.consentedAt,lastTap:me.lastTap});return true;
 }
 if(path==='/meta/me/revoke'&&method==='POST'){
  // A cross-site form must not be able to disconnect someone: same-origin requests only.
  const origin=req.headers.origin;
  if(origin!==deps.identity.publicOrigin){page(res,403,'ไม่อนุญาต',['Same-origin request required.']);return true;}
  const ok=await revokeFromSession(deps.identity,cookieValue(req.headers.cookie));
  page(res,ok?200:401,ok?'ลบการเชื่อมต่อแล้ว':'ไม่พบการเชื่อมต่อ',[ok?'ร้านจะไม่จำคุณอีก / The shop no longer remembers you.':'Nothing to forget.'],{'Set-Cookie':sessionCookie(deps,'',0)});
  return true;
 }
 json(res,404,{error:'RESOURCE_NOT_FOUND'});return true;
}
