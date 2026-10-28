// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Raw HTTP handlers under /meta/: the NTAG424 tap URL, the Messenger webhook and the customer web session.
// They need the exact request bytes (webhook signature), cookies and redirects, so they sit beside the JSON API.
import type http from 'node:http';
import {consumeMagicLink,customerFromSession,handleMessengerEvents,handleTap,offerForTap,offerMessage,revokeFromSession,type IdentityDeps,type OfferDeps,type OfferView} from './identity';
import {invocationSink} from './evidence';
import {applyStripeWebhook,reconcileTapOrder,startTapCheckout,type StripeDeps} from './tap-checkout';
import {stripeSandboxFromEnv,StripePaymentError} from './stripe';
import {createMetaRouter,metaProvidersFromEnv} from '../../../../packages/meta-ai/src/router';
import {formatTapAmount,handOver,listTapOrders,pickupCode,staffConfigFromEnv,staffDemoSignIn,staffFromSession,staffSignIn,staffSignOut,type SignInResult,type StaffDeps,type StaffOrder} from './staff';
import {MessengerError,messengerConfigFromEnv,parseMessengerWebhook,sendMessenger,verifyMessengerSignature,verifySubscription,type MessengerConfig,type MessengerFetch} from './messenger';

export interface MetaRouteDeps {identity:IdentityDeps;messenger:MessengerConfig|null;offers:OfferDeps|null;stripe?:StripeDeps|null;staff?:StaffDeps|null;fetch?:MessengerFetch;log?:(msg:string)=>void}
export const COOKIE='bitpos_meta',STAFF_COOKIE='bitpos_meta_staff';
const STAFF_SESSION_SECONDS=8*3600,MAX_FORM=4096;
const MAX_WEBHOOK=65536;

export function metaRouteDepsFromEnv(env:Record<string,string|undefined>,db:IdentityDeps['db'],menu?:OfferDeps['menu']):MetaRouteDeps|null{
 const master=env.META_TAP_MASTER_KEY,origin=env.META_PUBLIC_URL;
 if(!master||!/^[0-9a-fA-F]{32}$/.test(master)||!origin)return null;
 const u=new URL(origin);if(!['https:','http:'].includes(u.protocol)||u.pathname!=='/'||u.search||u.hash||u.username)return null;
 // Messenger and Stripe are each optional: a route whose provider is not configured answers 503.
 let messenger:MessengerConfig|null=null;try{messenger=messengerConfigFromEnv(env);}catch{messenger=null;}
 // Offers work without a model (deterministic fallback); with META_AI_* providers set, Muse Spark chooses.
 const providers=metaProvidersFromEnv(env as NodeJS.ProcessEnv);
 const offers=menu?{menu,router:providers.length?createMetaRouter({providers,record:invocationSink(db)}):null}:null;
 // Payments stay off unless Stripe test keys are configured (live keys are refused).
 let stripe:StripeDeps|null=null;try{stripe={config:stripeSandboxFromEnv(env)};}catch{stripe=null;}
 // The staff page needs the shop's Supabase Auth; without it /meta/staff answers 503.
 let staff:StaffDeps|null=null;try{const c=staffConfigFromEnv(env,u.origin);staff=c?{db,config:c}:null;}catch{staff=null;}
 return {identity:{db,masterKey:Buffer.from(master,'hex'),publicOrigin:u.origin},messenger,offers,stripe,staff};
}

const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function page(res:http.ServerResponse,status:number,title:string,lines:string[],extraHeaders:Record<string,string|string[]>={}){
 const html=`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:17px/1.5 system-ui,sans-serif;margin:0;padding:32px 20px;background:#f7f5ff;color:#1d1440}main{max-width:420px;margin:auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 2px 12px #0001}h1{font-size:22px;color:#5b34d6;margin:0 0 12px}p{margin:8px 0}button{font:inherit;padding:10px 16px;border-radius:10px;border:1px solid #c9bdf5;background:#fff;color:#5b34d6}</style></head><body><main><h1>${esc(title)}</h1>${lines.map(l=>`<p>${l}</p>`).join('')}</main></body></html>`;
 res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://checkout.stripe.com",
  // same-origin, not no-referrer: with no-referrer browsers send `Origin: null` on our own form POSTs,
  // which the same-origin checks below reject. Cross-origin navigations still carry no referrer.
  'Referrer-Policy':'same-origin','X-Content-Type-Options':'nosniff',...extraHeaders});
 res.end(html);
}
function offerCard(o:OfferView|null,payable=false):string[]{
 if(!o)return [];
 const pay=payable?[`<form method="post" action="/meta/checkout"><button>จ่าย ${esc(o.price)} / Pay (Stripe test mode)</button></form>`]:[];
 return [`<strong>${esc(o.emoji)} ${esc(o.name)} ${esc(o.price)}</strong> <s>${esc(o.basePrice)}</s> · ลด ${o.discountPercent}%`,esc(o.reasonTh),`<small>${esc(o.nameEn)} — ${esc(o.reasonEn)}${o.chosenBy==='model'?' · picked by Muse Spark':''}</small>`,...pay];
}
async function offerOrNull(deps:MetaRouteDeps,merchantId:string,linkId:string,tapSessionId:string):Promise<OfferView|null>{
 if(!deps.offers)return null;
 try{return await offerForTap(deps.identity,deps.offers,merchantId,linkId,tapSessionId);}catch{deps.log?.('Offer selection failed');return null;}
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
  if(r.kind==='known'){page(res,200,'สวัสดีค่ะ 👋',['ร้านจำคุณได้แล้ว','Welcome back — the shop knows it is you.',...offerCard(await offerOrNull(deps,r.merchantId,r.linkId,r.tapSessionId),!!deps.stripe)]);return true;}
  if(r.kind==='replayed'){page(res,409,'กรุณาแตะใหม่อีกครั้ง',['ลิงก์นี้ใช้ไปแล้ว ให้แตะมือถือที่เครื่องอีกครั้ง','This tap link was already used. Tap the device again.']);return true;}
  if(r.kind==='no_page'){page(res,503,'ร้านยังไม่ได้เชื่อม Messenger',['The shop has not connected a Messenger page yet.']);return true;}
  page(res,400,'แตะไม่สำเร็จ',['ให้แตะมือถือที่เครื่องอีกครั้ง','Please tap the device again.']);return true;
 }
 if(path==='/meta/messenger/webhook'){
  const messenger=deps.messenger;
  if(!messenger){json(res,503,{error:'NOT_CONFIGURED'});return true;}
  if(method==='GET'){const challenge=verifySubscription(url.searchParams,messenger.verifyToken);res.writeHead(challenge?200:403,{'Content-Type':'text/plain'});res.end(challenge??'');return true;}
  if(method==='POST'){
   const raw=await rawBody(req,MAX_WEBHOOK);
   if(!raw){json(res,413,{error:'REQUEST_TOO_LARGE'});return true;}
   try{verifyMessengerSignature(raw,req.headers['x-hub-signature-256'] as string|undefined,messenger.appSecret);}catch{json(res,401,{error:'SIGNATURE_INVALID'});return true;}
   let events;try{events=parseMessengerWebhook(JSON.parse(raw.toString('utf8')));}catch{json(res,400,{error:'PAYLOAD_INVALID'});return true;}
   const {outbox,offers}=await handleMessengerEvents(deps.identity,events);
   json(res,200,{received:events.length});
   const send=async(message:Parameters<typeof sendMessenger>[1])=>{try{await sendMessenger(messenger,message,deps.fetch);}catch(e){log(`Messenger send failed: ${e instanceof MessengerError?e.code:'UNKNOWN'}`);}};
   for(const message of outbox)await send(message);
   // Offers are chosen after the webhook transaction committed, so the model call never holds a lock.
   for(const o of offers){const view=await offerOrNull(deps,o.merchantId,o.linkId,o.tapSessionId);if(view)await send(offerMessage(o.psid,view));}
   return true;
  }
 }
 if(path==='/meta/login'&&method==='GET'){
  const s=await consumeMagicLink(deps.identity,url.searchParams.get('t')??'');
  if(!s){page(res,410,'ลิงก์หมดอายุ',['ขอลิงก์ใหม่ได้โดยแตะที่เครื่องอีกครั้ง','This sign-in link expired or was already used.']);return true;}
  page(res,200,'เชื่อมต่อแล้ว ✓',['ครั้งหน้าแค่แตะมือถือที่เครื่อง ร้านจะรู้ว่าเป็นคุณ','Next time, just tap your phone on the device.',...offerCard(s.tapSessionId?await offerOrNull(deps,s.merchantId,s.linkId,s.tapSessionId):null,!!deps.stripe),'<form method="post" action="/meta/me/revoke"><button>ลบการเชื่อมต่อ / Forget me</button></form>'],{'Set-Cookie':sessionCookie(deps,s.sessionToken,2592000)});
  return true;
 }
 if(path==='/meta/me'&&method==='GET'){
  const me=await customerFromSession(deps.identity,cookieValue(req.headers.cookie));
  if(!me){json(res,401,{error:'AUTH_REQUIRED'});return true;}
  json(res,200,{consentedAt:me.consentedAt,lastTap:me.lastTap});return true;
 }
 if(path==='/meta/offer'&&method==='GET'){
  const me=await customerFromSession(deps.identity,cookieValue(req.headers.cookie));
  if(!me){json(res,401,{error:'AUTH_REQUIRED'});return true;}
  json(res,200,{offer:me.lastTap?await offerOrNull(deps,me.merchantId,me.linkId,me.lastTap.tapSessionId):null});return true;
 }
 if(path==='/meta/offer-page'&&method==='GET'){
  const me=await customerFromSession(deps.identity,cookieValue(req.headers.cookie));
  if(!me){page(res,401,'ยังไม่ได้เชื่อมต่อ',['แตะมือถือที่เครื่องเพื่อเริ่ม','Tap your phone on the device to start.']);return true;}
  const offer=me.lastTap?await offerOrNull(deps,me.merchantId,me.linkId,me.lastTap.tapSessionId):null;
  page(res,200,'โปรของคุณ',offer?offerCard(offer,!!deps.stripe):['ยังไม่มีโปรตอนนี้ ลองแตะที่เครื่องอีกครั้ง','No offer right now. Tap the device again.']);return true;
 }
 if(path==='/meta/checkout'&&method==='POST'){
  if(req.headers.origin!==deps.identity.publicOrigin){page(res,403,'ไม่อนุญาต',['Same-origin request required.']);return true;}
  if(!deps.stripe||!deps.offers){page(res,503,'ยังรับชำระไม่ได้',['Payments are not configured.']);return true;}
  try{
   const r=await startTapCheckout(deps.identity,deps.offers,deps.stripe,cookieValue(req.headers.cookie));
   if(r.kind==='redirect'){res.writeHead(303,{Location:r.url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();return true;}
   if(r.kind==='paid'){res.writeHead(303,{Location:`/meta/paid?o=${r.orderId}`,'Cache-Control':'no-store'});res.end();return true;}
   const why:Record<typeof r.reason,string>={NO_SESSION:'แตะมือถือที่เครื่องก่อน / Tap the device first.',NO_TAP:'แตะมือถือที่เครื่องอีกครั้ง / Tap the device again.',NO_OFFER:'ยังไม่มีโปรสำหรับการแตะนี้ / No offer for this tap.',OFFER_ENDED:'โปรนี้หมดแล้ว / This offer has ended.',CURRENCY:'สกุลเงินนี้จ่ายผ่าน Stripe ไม่ได้ / Currency not supported.',OUT_OF_STOCK:'สินค้าหมด / Sold out.',BELOW_MINIMUM:'ยอดต่ำกว่าขั้นต่ำของ Stripe ให้ชำระที่เคาน์เตอร์ / Below the Stripe minimum charge; please pay at the counter.'};
   page(res,409,'จ่ายไม่ได้ตอนนี้',[esc(why[r.reason])]);return true;
  }catch(e){log(`Checkout failed: ${e instanceof StripePaymentError?e.code:'UNKNOWN'}`);page(res,502,'ระบบชำระเงินขัดข้อง',['ลองใหม่อีกครั้ง / Please try again.']);return true;}
 }
 if(path==='/meta/paid'&&method==='GET'){
  if(!deps.stripe){page(res,503,'ยังรับชำระไม่ได้',['Payments are not configured.']);return true;}
  let o;try{o=await reconcileTapOrder(deps.identity,deps.stripe,cookieValue(req.headers.cookie),url.searchParams.get('o')??'');}catch{o=undefined;}
  if(o===null){page(res,404,'ไม่พบรายการ',['Order not found for this browser.']);return true;}
  if(o?.status==='PAID'){page(res,200,'จ่ายแล้ว ✓',['ร้านได้รับออเดอร์แล้ว รับที่เคาน์เตอร์ได้เลย','Paid — pick it up at the counter.',`รหัสรับสินค้า / Pickup code: <strong>${esc(pickupCode(url.searchParams.get('o')??''))}</strong>`,'<small>Stripe sandbox · test mode · no real money</small>']);return true;}
  page(res,202,'กำลังตรวจสอบการชำระเงิน',['ยังไม่ได้รับการยืนยันจาก Stripe ลองรีเฟรชอีกครั้ง','Waiting for Stripe to confirm. Refresh in a moment.']);return true;
 }
 if(path==='/meta/stripe/webhook'&&method==='POST'){
  if(!deps.stripe){json(res,503,{error:'NOT_CONFIGURED'});return true;}
  const raw=await rawBody(req,MAX_WEBHOOK);
  if(!raw){json(res,413,{error:'REQUEST_TOO_LARGE'});return true;}
  try{json(res,200,{result:await applyStripeWebhook(deps.identity,deps.stripe,raw.toString('utf8'),req.headers['stripe-signature'] as string|undefined)});}
  catch(e){json(res,e instanceof StripePaymentError?400:500,{error:e instanceof StripePaymentError?e.code:'INTERNAL'});}
  return true;
 }
 if(path==='/meta/me/revoke'&&method==='POST'){
  // A cross-site form must not be able to disconnect someone: same-origin requests only.
  const origin=req.headers.origin;
  if(origin!==deps.identity.publicOrigin){page(res,403,'ไม่อนุญาต',['Same-origin request required.']);return true;}
  const ok=await revokeFromSession(deps.identity,cookieValue(req.headers.cookie));
  page(res,ok?200:401,ok?'ลบการเชื่อมต่อแล้ว':'ไม่พบการเชื่อมต่อ',[ok?'ร้านจะไม่จำคุณอีก / The shop no longer remembers you.':'Nothing to forget.'],{'Set-Cookie':sessionCookie(deps,'',0)});
  return true;
 }
 if(path==='/meta/staff'||path.startsWith('/meta/staff/'))return serveStaff(req,res,deps,url,log);
 json(res,404,{error:'RESOURCE_NOT_FOUND'});return true;
}

// Sign-in attempts per client address (behind the tunnel, Cloudflare's client IP header) per 10 minutes.
const attempts=new Map<string,{start:number;n:number}>();
function allowAttempt(req:http.IncomingMessage,now=Date.now()):boolean{
 const remote=req.socket.remoteAddress??'';
 const viaTunnel=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)&&typeof req.headers['cf-connecting-ip']==='string';
 const key=viaTunnel?String(req.headers['cf-connecting-ip']):remote;
 const a=attempts.get(key);
 if(!a||now-a.start>600_000){if(attempts.size>10_000)attempts.clear();attempts.set(key,{start:now,n:1});return true;}
 return ++a.n<=10;
}
function staffCookie(deps:StaffDeps,value:string,maxAge:number){
 return `${STAFF_COOKIE}=${value}; Path=/meta/staff; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${deps.config.origin.startsWith('https:')?'; Secure':''}`;
}
function signInForm(deps:StaffDeps,message?:string):string[]{
 const demo=deps.config.demoLoginFile?['<form method="post" action="/meta/staff/login"><small>Demo quick sign-in (devnet demo accounts):</small><br>'+
  ['owner','manager','staff'].map(r=>`<button name="role" value="${r}">${r[0].toUpperCase()+r.slice(1)}</button>`).join(' ')+'</form>']:[];
 return [...(message?[`<strong>${esc(message)}</strong>`]:[]),'ใช้บัญชีเดียวกับ POS / Sign in with your POS account.',
  '<form method="post" action="/meta/staff/login"><input name="email" type="email" autocomplete="username" placeholder="Email" required style="font:inherit;width:100%;margin:4px 0;padding:8px"><input name="password" type="password" autocomplete="current-password" placeholder="Password" required style="font:inherit;width:100%;margin:4px 0;padding:8px"><button>เข้าสู่ระบบ / Sign in</button></form>',...demo];
}
function orderLines(orders:StaffOrder[]):string[]{
 if(!orders.length)return ['ยังไม่มีออเดอร์จากการแตะใน 24 ชั่วโมง / No tap orders in the last 24 hours.'];
 const time=(iso:string)=>new Date(iso).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'});
 return orders.map(o=>{
  const what=`<strong>#${esc(o.code)}</strong> ${esc(o.emoji)} ${esc(o.name)} <small>${esc(o.nameEn)}</small> · ${esc(formatTapAmount(o.amountMinor,o.currency))}`;
  if(o.status==='PAID'&&o.handedOverAt)return `${what}<br><small>ส่งมอบแล้ว / Handed over ${time(o.handedOverAt)}</small>`;
  if(o.status==='PAID')return `${what}<br>✅ จ่ายแล้ว / Paid ${time(o.paidAt!)} <small>(${o.paidSource==='webhook'?'Stripe webhook':'Stripe lookup'})</small>${o.stockShort?'<br>⚠️ สต็อกในระบบไม่พอ ตรวจของจริง / Stock was short in the system':''}<form method="post" action="/meta/staff/orders/${o.id}/handover"><button>ส่งมอบแล้ว / Handed over</button></form>`;
  if(o.status==='CREATED')return `${what}<br><small>⏳ รอชำระเงิน / Waiting for payment · ${time(o.createdAt)}</small>`;
  return `${what}<br><small>หมดเวลาชำระ / Checkout expired · ${time(o.createdAt)}</small>`;
 });
}
async function formBody(req:http.IncomingMessage):Promise<URLSearchParams|null>{
 const raw=await rawBody(req,MAX_FORM);
 return raw?new URLSearchParams(raw.toString('utf8')):null;
}

async function serveStaff(req:http.IncomingMessage,res:http.ServerResponse,deps:MetaRouteDeps,url:URL,log:(m:string)=>void):Promise<true>{
 const staff=deps.staff,path=url.pathname,method=req.method??'GET';
 if(!staff){page(res,503,'หน้าพนักงานยังไม่พร้อม',['Staff sign-in is not configured on this server.']);return true;}
 const cookie=cookieValue(req.headers.cookie,STAFF_COOKIE);
 if(method==='POST'&&req.headers.origin!==staff.config.origin){page(res,403,'ไม่อนุญาต',['Same-origin request required.']);return true;}
 if(path==='/meta/staff'&&method==='GET'){
  const me=await staffFromSession(staff,cookie);
  if(!me){page(res,200,'พนักงาน · ออเดอร์จากการแตะ',signInForm(staff));return true;}
  const done=url.searchParams.get('done');
  const lines=[`<small>${esc(me.role)} · อัปเดตทุก 10 วินาที / refreshes every 10 s · Stripe sandbox, test mode</small>`,
   ...(done&&/^[0-9A-F]{4}$/.test(done)?[`✓ ส่งมอบ #${done} แล้ว / Handed over.`]:[]),...orderLines(await listTapOrders(staff,me)),
   '<form method="post" action="/meta/staff/logout"><button>ออกจากระบบ / Sign out</button></form>'];
  page(res,200,'ออเดอร์จากการแตะ / Tap orders',lines,{Refresh:'10'});return true;
 }
 if(path==='/meta/staff/login'&&method==='POST'){
  if(!allowAttempt(req)){page(res,429,'ลองใหม่ภายหลัง',['Too many sign-in attempts. Try again in a few minutes.']);return true;}
  const form=await formBody(req);
  if(!form){page(res,413,'คำขอใหญ่เกินไป',['Request too large.']);return true;}
  const role=form.get('role');
  const r:SignInResult=role?await staffDemoSignIn(staff,role):await staffSignIn(staff,form.get('email')??'',form.get('password')??'');
  if(r.kind==='ok'){log(`Staff signed in (${r.role})`);res.writeHead(303,{Location:'/meta/staff','Set-Cookie':staffCookie(staff,r.token,STAFF_SESSION_SECONDS),'Cache-Control':'no-store'});res.end();return true;}
  const why={AUTH:'อีเมลหรือรหัสผ่านไม่ถูกต้อง / Wrong email or password.',ROLE:'บัญชีนี้ไม่มีสิทธิ์พนักงานของร้าน / This account has no staff role in a shop.',UNAVAILABLE:'ระบบเข้าสู่ระบบไม่พร้อม / Sign-in is unavailable.'}[r.reason];
  page(res,r.reason==='UNAVAILABLE'?503:r.reason==='ROLE'?403:401,'พนักงาน · ออเดอร์จากการแตะ',signInForm(staff,why));return true;
 }
 const hand=path.match(/^\/meta\/staff\/orders\/([0-9a-f-]{36})\/handover$/);
 if(hand&&method==='POST'){
  const me=await staffFromSession(staff,cookie);
  if(!me){res.writeHead(303,{Location:'/meta/staff','Cache-Control':'no-store'});res.end();return true;}
  const r=await handOver(staff,me,hand[1]);
  if(r==='HANDED_OVER'||r==='ALREADY'){res.writeHead(303,{Location:`/meta/staff?done=${pickupCode(hand[1])}`,'Cache-Control':'no-store'});res.end();return true;}
  page(res,r==='NOT_FOUND'?404:409,'ส่งมอบไม่ได้',[r==='NOT_PAID'?'ออเดอร์นี้ยังไม่ได้จ่าย / This order is not paid.':'ไม่พบออเดอร์ / Order not found.','<a href="/meta/staff">← กลับ / Back</a>']);return true;
 }
 if(path==='/meta/staff/logout'&&method==='POST'){
  await staffSignOut(staff,cookie);
  res.writeHead(303,{Location:'/meta/staff','Set-Cookie':staffCookie(staff,'',0),'Cache-Control':'no-store'});res.end();return true;
 }
 json(res,404,{error:'RESOURCE_NOT_FOUND'});return true;
}
