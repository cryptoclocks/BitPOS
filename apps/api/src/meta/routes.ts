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
import {serveMcp} from './mcp';
import {cancelReservation,staffReservations,sweepLapsed} from './reservations';
import {approveDraft,draftOffer,listOffersOverview,rejectDraft,revokePolicy,stopOffer,OfferPolicyError,type DraftView,type OfferPolicyDeps,type PolicyView} from './offer-policy';
import {bookingMessages,handleAgentRequest,planChatOrder,type ChatAgentDeps} from './agent';
import {randomBytes} from 'node:crypto';
import {AgentOrderError,agentReceipt,reconcileAgentCheckout,startAgentCheckout} from './agent-orders';
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
  if(r.kind==='reserved'){
   const mins=Math.max(0,Math.ceil((Date.parse(r.checkInUntil)-Date.now())/60_000));
   const until=new Date(r.checkInUntil).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'});
   page(res,409,`โต๊ะ ${r.tableLabel} จองไว้แล้ว`,r.status==='HELD'?[`โต๊ะนี้มีคนจองไว้ ถ้าผู้จองไม่มาเช็กอินภายใน <strong>${mins} นาที</strong> (ถึง ${until}) โต๊ะจะว่าง`,`Reserved. If the booker has not checked in by ${until} (${mins} min), the table is released.`,
    ...(r.url?[`<a href="${esc(r.url)}">ฉันเป็นผู้จอง / I booked this table →</a>`]:[])]:['โต๊ะนี้มีลูกค้าที่จองไว้นั่งอยู่ ใช้โต๊ะอื่นได้เลยค่ะ','This table is in use by a booking; please use another.'],{Refresh:'30'});return true;
  }
  if(r.kind==='known'&&r.checkedIn){page(res,200,`เช็กอินโต๊ะ ${r.checkedIn.tableLabel} แล้ว ✓`,['ยินดีต้อนรับค่ะ โต๊ะนี้เป็นของคุณ','Checked in — welcome, this table is yours.',...offerCard(await offerOrNull(deps,r.merchantId,r.linkId,r.tapSessionId),!!deps.stripe),ORDER_LINK]);return true;}
  if(r.kind==='known'){page(res,200,'สวัสดีค่ะ 👋',['ร้านจำคุณได้แล้ว','Welcome back — the shop knows it is you.',...offerCard(await offerOrNull(deps,r.merchantId,r.linkId,r.tapSessionId),!!deps.stripe),ORDER_LINK]);return true;}
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
   const {outbox,offers,agent}=await handleMessengerEvents(deps.identity,events);
   json(res,200,{received:events.length});
   const send=async(message:Parameters<typeof sendMessenger>[1])=>{try{await sendMessenger(messenger,message,deps.fetch);}catch(e){log(`Messenger send failed: ${e instanceof MessengerError?e.code:'UNKNOWN'}`);}};
   for(const message of outbox)await send(message);
   // Offers are chosen after the webhook transaction committed, so the model call never holds a lock.
   for(const o of offers){const view=await offerOrNull(deps,o.merchantId,o.linkId,o.tapSessionId);if(view)await send(offerMessage(o.psid,view));}
   // Chat orders also run after commit, so the model and Stripe calls never hold a transaction.
   const chat=chatDeps(deps);
   for(const a of agent){
    if(!chat){await send({kind:'text',psid:a.psid,text:'ร้านยังไม่เปิดสั่งผ่านแชทค่ะ / Chat ordering is not available.'});continue;}
    try{for(const m of await handleAgentRequest(chat,a))await send(m);}catch{log('Chat agent failed');}
   }
   return true;
  }
 }
 if(path==='/meta/login'&&method==='GET'){
  const s=await consumeMagicLink(deps.identity,url.searchParams.get('t')??'');
  if(!s){page(res,410,'ลิงก์หมดอายุ',['ขอลิงก์ใหม่ได้โดยแตะที่เครื่องอีกครั้ง','This sign-in link expired or was already used.']);return true;}
  page(res,200,'เชื่อมต่อแล้ว ✓',['ครั้งหน้าแค่แตะมือถือที่เครื่อง ร้านจะรู้ว่าเป็นคุณ','Next time, just tap your phone on the device.',...offerCard(s.tapSessionId?await offerOrNull(deps,s.merchantId,s.linkId,s.tapSessionId):null,!!deps.stripe),ORDER_LINK,'<form method="post" action="/meta/me/revoke"><button>ลบการเชื่อมต่อ / Forget me</button></form>'],{'Set-Cookie':sessionCookie(deps,s.sessionToken,2592000)});
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
  page(res,200,'โปรของคุณ',[...(offer?offerCard(offer,!!deps.stripe):['ยังไม่มีโปรตอนนี้ ลองแตะที่เครื่องอีกครั้ง','No offer right now. Tap the device again.']),ORDER_LINK]);return true;
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
  const receipt=async(merchantId:string,orderId:string)=>{const r=await agentReceipt(deps.identity.db,merchantId,orderId,deps.identity.publicOrigin);if(r&&deps.messenger)await sendMessenger(deps.messenger,{kind:'receipt',psid:r.psid,receipt:r.receipt,fallbackText:r.text},deps.fetch).catch(()=>log('Receipt send failed'));};
  try{json(res,200,{result:await applyStripeWebhook(deps.identity,deps.stripe,raw.toString('utf8'),req.headers['stripe-signature'] as string|undefined,undefined,receipt)});}
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
 if(path==='/meta/agent/paid'&&method==='GET'){
  const chat=chatDeps(deps);
  if(!chat){page(res,503,'ยังรับชำระไม่ได้',['Payments are not configured.']);return true;}
  let o;try{o=await reconcileAgentCheckout(chat,url.searchParams.get('o'));}catch{o=undefined;}
  if(o===null){page(res,404,'ไม่พบรายการ',['Order not found.']);return true;}
  if(o?.confirmedNow&&deps.messenger){const r=await agentReceipt(deps.identity.db,o.merchantId,o.orderId,deps.identity.publicOrigin);if(r)await sendMessenger(deps.messenger,{kind:'receipt',psid:r.psid,receipt:r.receipt,fallbackText:r.text},deps.fetch).catch(()=>log('Receipt send failed'));}
  if(o?.status==='CONFIRMED'){page(res,200,'จ่ายแล้ว ✓',['ร้านได้รับออเดอร์แล้ว รับที่เคาน์เตอร์ได้เลย','Paid — pick it up at the counter.',`รหัสรับสินค้า / Pickup code: <strong>${esc(o.pickupCode)}</strong>`,'กลับไปที่ Messenger ได้เลย / You can go back to Messenger.','<small>Stripe sandbox · test mode · no real money</small>']);return true;}
  page(res,202,'กำลังตรวจสอบการชำระเงิน',['ยังไม่ได้รับการยืนยันจาก Stripe ลองรีเฟรชอีกครั้ง','Waiting for Stripe to confirm. Refresh in a moment.']);return true;
 }
 if(path==='/meta/order'||path==='/meta/order/pay')return serveWebOrder(req,res,deps,url,log);
 if(path==='/meta/staff'||path.startsWith('/meta/staff/'))return serveStaff(req,res,deps,url,log);
 const mcp=path.match(/^\/meta\/mcp\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/);
 if(mcp){
  if(!deps.offers){json(res,503,{error:'NOT_CONFIGURED'});return true;}
  if(!allowAttempt(req,Date.now(),mcpCalls,120,60_000)){json(res,429,{error:'RATE_LIMITED'});return true;}
  if(!(await serveMcp(req,res,{db:deps.identity.db,offers:deps.offers,stripe:deps.stripe??null},mcp[1])))json(res,404,{error:'RESOURCE_NOT_FOUND'});
  return true;
 }
 json(res,404,{error:'RESOURCE_NOT_FOUND'});return true;
}

function chatDeps(deps:MetaRouteDeps):ChatAgentDeps|null{
 return deps.offers?{db:deps.identity.db,offers:deps.offers,stripe:deps.stripe??null,router:deps.offers.router,publicOrigin:deps.identity.publicOrigin}:null;
}

// Requests per client address (behind the tunnel, Cloudflare's client IP header) per window: staff sign-in and MCP calls.
const attempts=new Map<string,{start:number;n:number}>(),mcpCalls=new Map<string,{start:number;n:number}>();
function allowAttempt(req:http.IncomingMessage,now=Date.now(),bucket=attempts,limit=10,windowMs=600_000):boolean{
 const remote=req.socket.remoteAddress??'';
 const viaTunnel=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)&&typeof req.headers['cf-connecting-ip']==='string';
 const key=viaTunnel?String(req.headers['cf-connecting-ip']):remote;
 const a=bucket.get(key);
 if(!a||now-a.start>windowMs){if(bucket.size>10_000)bucket.clear();bucket.set(key,{start:now,n:1});return true;}
 return ++a.n<=limit;
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
  const what=`<strong>#${esc(o.code)}</strong> ${esc(o.emoji)} ${esc(o.name)} <small>${esc(o.nameEn)}</small> · ${esc(formatTapAmount(o.amountMinor,o.currency))}${o.channel==='agent'?' <small>· 🤖 agent (MCP)</small>':o.channel==='chat'?' <small>· 💬 chat (Messenger / voice)</small>':''}`;
  if(o.status==='PAID'&&o.handedOverAt)return `${what}<br><small>ส่งมอบแล้ว / Handed over ${time(o.handedOverAt)}</small>`;
  if(o.status==='PAID')return `${what}<br>✅ จ่ายแล้ว / Paid ${time(o.paidAt!)} <small>(${o.paidSource==='webhook'?'Stripe webhook':o.paidSource==='charge'?'Stripe PaymentIntent':'Stripe lookup'})</small>${o.stockShort?'<br>⚠️ สต็อกในระบบไม่พอ ตรวจของจริง / Stock was short in the system':''}<form method="post" action="/meta/staff/orders/${o.id}/handover"><button>ส่งมอบแล้ว / Handed over</button></form>`;
  if(o.status==='CREATED')return `${what}<br><small>⏳ รอชำระเงิน / Waiting for payment · ${time(o.createdAt)}</small>`;
  if(o.status==='FAILED')return `${what}<br><small>จ่ายไม่สำเร็จ / Payment failed · ${time(o.createdAt)}</small>`;
  if(o.status==='CANCELLED')return `${what}<br><small>ยกเลิก / คืนเงิน · Cancelled / refunded</small>`;
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
   ...reservationLines(await staffReservations(deps.identity.db,me.merchantId)),
   ...(me.role!=='staff'?['<a href="/meta/staff/offers">โปรโมชัน + Allow All / Promotions →</a> · <a href="/meta/staff/ledger">หลักฐาน AI + การจ่าย / Evidence ledger →</a>']:[]),
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
 if(path==='/meta/staff/offers'||path.startsWith('/meta/staff/offers/')||path.startsWith('/meta/staff/policies/'))return serveOffers(req,res,deps,staff,cookie,url,log);
 if(path==='/meta/staff/ledger'&&method==='GET')return serveLedger(res,deps,staff,cookie);
 const resCancel=path.match(/^\/meta\/staff\/reservations\/([0-9a-f-]{36})\/cancel$/);
 if(resCancel&&method==='POST'){
  const me=await staffFromSession(staff,cookie);
  if(!me){res.writeHead(303,{Location:'/meta/staff','Cache-Control':'no-store'});res.end();return true;}
  await cancelReservation(deps.identity.db,me.merchantId,resCancel[1],{staff:true});
  res.writeHead(303,{Location:'/meta/staff','Cache-Control':'no-store'});res.end();return true;
 }
 if(path==='/meta/staff/logout'&&method==='POST'){
  await staffSignOut(staff,cookie);
  res.writeHead(303,{Location:'/meta/staff','Set-Cookie':staffCookie(staff,'',0),'Cache-Control':'no-store'});res.end();return true;
 }
 json(res,404,{error:'RESOURCE_NOT_FOUND'});return true;
}

const OFFER_ERRORS:Record<OfferPolicyError['code'],string>={ROLE_REQUIRED:'ต้องเป็นเจ้าของหรือผู้จัดการ / Owner or manager only.',OWNER_REQUIRED:'Allow All ตั้งได้เฉพาะเจ้าของ / Only the owner can set Allow All.',
 NOT_FOUND:'ไม่พบรายการ / Not found.',NOT_OPEN:'รายการนี้ปิดแล้วหรือมีร่างค้างอยู่ / Already decided, expired, or a draft is already open.',NO_CANDIDATES:'ไม่มีสินค้าที่ร่างโปรได้ตอนนี้ / No product can take a new offer now.',INVALID_INPUT:'ข้อมูลไม่ถูกต้อง / Invalid input.'};
function draftLine(d:DraftView,isOwner:boolean):string{
 const head=`<strong>${esc(d.emoji)} ${esc(d.name)}</strong> <small>${esc(d.nameEn)}</small> · ลด ${d.discountPercent}% · ${d.durationHours} ชม./h${d.chosenBy==='model'?' <small>· Muse Spark</small>':' <small>· fallback</small>'}<br><small>${esc(d.reasonTh)} — ${esc(d.reasonEn)}</small>`;
 const at=(iso:string)=>new Date(iso).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'});
 if(d.state==='DRAFT'){
  const allow=isOwner?`<form method="post" action="/meta/staff/offers/${d.id}/approve"><input type="hidden" name="allow_all" value="1"><select name="scope" style="font:inherit"><option value="product">สินค้านี้ / this product</option>${d.category?`<option value="category">หมวด ${esc(d.category)} / this category</option>`:''}</select> <select name="daily_limit" style="font:inherit">${[1,2,3,5].map(n=>`<option value="${n}"${n===3?' selected':''}>${n}/วัน day</option>`).join('')}</select><br><button>อนุมัติ + Allow All แบบนี้ / Approve + Allow All like this</button></form>`:'';
  return `${head}<form method="post" action="/meta/staff/offers/${d.id}/approve"><button>อนุมัติครั้งนี้ / Approve once</button></form>${allow}<form method="post" action="/meta/staff/offers/${d.id}/reject"><button>ไม่อนุมัติ / Reject</button></form>`;
 }
 if(d.state==='APPLIED')return `${head}<br>${d.approvalKind==='policy'?'🤖 อนุมัติอัตโนมัติด้วย Allow All / Auto-approved by Allow All':'✅ เจ้าของอนุมัติ / Approved by owner'} · ถึง ${at(d.offerExpiresAt!)}<form method="post" action="/meta/staff/offers/${d.id}/stop"><button>หยุดโปรนี้ / Stop this offer</button></form>`;
 const label:Record<string,string>={REJECTED:'ไม่อนุมัติ / Rejected',EXPIRED:'ร่างหมดเวลา / Draft expired',FAILED:`ใช้ไม่ได้ / Not applied (${esc(d.failure??'')})`,STOPPED:'หยุดแล้ว / Stopped'};
 return `${head}<br><small>${label[d.state]??esc(d.state)}</small>`;
}
function policyLine(p:PolicyView):string{
 return `🛡️ <strong>Allow All</strong> · ${p.scopeKind==='product'?'สินค้า':'หมวด'} ${esc(p.label)} · ลดไม่เกิน ${p.maxDiscountPercent}% · ไม่เกิน ${p.maxDurationHours} ชม. · ${p.usedToday}/${p.dailyLimit} วันนี้<form method="post" action="/meta/staff/policies/${p.id}/revoke"><button>ยกเลิก Allow All / Revoke</button></form>`;
}

async function serveOffers(req:http.IncomingMessage,res:http.ServerResponse,deps:MetaRouteDeps,staff:StaffDeps,cookie:string|null,url:URL,log:(m:string)=>void):Promise<true>{
 const path=url.pathname,method=req.method??'GET';
 const me=await staffFromSession(staff,cookie);
 if(!me){res.writeHead(303,{Location:'/meta/staff','Cache-Control':'no-store'});res.end();return true;}
 if(!deps.offers){page(res,503,'ยังไม่พร้อม',['Promotions are not configured on this server.']);return true;}
 const od:OfferPolicyDeps={db:deps.identity.db,menu:deps.offers.menu,router:deps.offers.router};
 const back=(note?:string)=>{res.writeHead(303,{Location:`/meta/staff/offers${note?`?n=${note}`:''}`,'Cache-Control':'no-store'});res.end();return true as const;};
 try{
  if(path==='/meta/staff/offers'&&method==='GET'){
   const {drafts,policies}=await listOffersOverview(od,me);
   const notes:Record<string,string>={drafted:'ร่างโปรใหม่แล้ว / New draft ready.',auto:'🤖 อยู่ในกรอบ Allow All จึงอนุมัติอัตโนมัติแล้ว / Inside Allow All: approved automatically.',approved:'อนุมัติแล้ว / Approved.',rejected:'ไม่อนุมัติแล้ว / Rejected.',stopped:'หยุดโปรแล้ว / Offer stopped.',revoked:'ยกเลิก Allow All แล้ว / Allow All revoked.'};
   const n=url.searchParams.get('n');
   page(res,200,'โปรโมชัน / Promotions',[`<small>${esc(me.role)} · Muse Spark ร่าง เจ้าของอนุมัติ ราคาคิดโดยระบบ / Muse Spark drafts, the owner approves, the server prices</small>`,
    ...(n&&notes[n]?[`<strong>${notes[n]}</strong>`]:[]),
    '<form method="post" action="/meta/staff/offers/draft"><button>✨ ให้ Muse Spark ร่างโปร / Draft an offer with Muse Spark</button></form>',
    ...(policies.length?policies.map(policyLine):['<small>ยังไม่มี Allow All / No Allow All policy yet.</small>']),
    ...(drafts.length?drafts.map(d=>draftLine(d,me.role==='owner')):['<small>ยังไม่มีร่างโปร / No drafts yet.</small>']),
    '<a href="/meta/staff">← ออเดอร์ / Orders</a>']);
   return true;
  }
  if(method!=='POST'){json(res,404,{error:'RESOURCE_NOT_FOUND'});return true;}
  if(path==='/meta/staff/offers/draft'){const r=await draftOffer(od,me);log(`Offer drafted (${r.draft.chosenBy}${r.autoApplied?', auto-approved':''})`);return back(r.autoApplied?'auto':'drafted');}
  const m=path.match(/^\/meta\/staff\/(offers|policies)\/([0-9a-f-]{36})\/(approve|reject|stop|revoke)$/);
  if(!m){json(res,404,{error:'RESOURCE_NOT_FOUND'});return true;}
  const [,kind,id,action]=m;
  if(kind==='policies'&&action==='revoke'){await revokePolicy(od,me,id);return back('revoked');}
  if(kind==='offers'&&action==='approve'){
   const form=await formBody(req);
   if(!form){page(res,413,'คำขอใหญ่เกินไป',['Request too large.']);return true;}
   const allow=form.get('allow_all')==='1'?{scope:form.get('scope') as 'product'|'category',dailyLimit:Number(form.get('daily_limit')??3)}:undefined;
   const d=await approveDraft(od,me,id,allow);
   if(d.state==='FAILED'){page(res,409,'ใช้โปรไม่ได้',[`ระบบไม่ได้ตั้งโปรนี้ / Not applied: ${esc(d.failure??'')}`,'<a href="/meta/staff/offers">← กลับ / Back</a>']);return true;}
   return back('approved');
  }
  if(kind==='offers'&&action==='reject'){await rejectDraft(od,me,id);return back('rejected');}
  if(kind==='offers'&&action==='stop'){await stopOffer(od,me,id);return back('stopped');}
  json(res,404,{error:'RESOURCE_NOT_FOUND'});return true;
 }catch(e){
  if(e instanceof OfferPolicyError){page(res,e.code==='ROLE_REQUIRED'||e.code==='OWNER_REQUIRED'?403:e.code==='NOT_FOUND'?404:409,'ทำรายการไม่ได้',[OFFER_ERRORS[e.code],'<a href="/meta/staff/offers">← กลับ / Back</a>']);return true;}
  log('Offer action failed');page(res,500,'ระบบขัดข้อง',['Something went wrong.','<a href="/meta/staff/offers">← กลับ / Back</a>']);return true;
 }
}

const ORDER_LINK='<a href="/meta/order">🎙️ สั่งด้วยเสียงหรือพิมพ์ / Order by voice or text →</a>';
const ORDER_ERR:Partial<Record<AgentOrderError['code'],string>>={QUOTE_EXPIRED:'รายการหมดเวลา สั่งใหม่ได้เลย / Quote expired; order again.',NOT_FOUND:'ไม่พบรายการ / Not found.',PAYMENTS_UNAVAILABLE:'ยังรับชำระไม่ได้ / Payments are not available.'};

/** Voice or typed ordering on the shop's web page, for a customer signed in from Messenger. Speech is turned
 * into text by the browser's own speech recognition; the server receives text only, and the same agent,
 * quote and Stripe Checkout as the Messenger chat are used. */
async function serveWebOrder(req:http.IncomingMessage,res:http.ServerResponse,deps:MetaRouteDeps,url:URL,log:(m:string)=>void):Promise<true>{
 const method=req.method??'GET';
 const chat=chatDeps(deps);
 if(!chat){page(res,503,'ยังไม่พร้อม',['Ordering is not configured on this server.']);return true;}
 const me=await customerFromSession(deps.identity,cookieValue(req.headers.cookie));
 if(!me){page(res,401,'ยังไม่ได้เชื่อมต่อ',['แตะมือถือที่เครื่องในร้านเพื่อเริ่ม','Tap your phone on the device in the shop to start.']);return true;}
 if(method==='POST'&&req.headers.origin!==deps.identity.publicOrigin){page(res,403,'ไม่อนุญาต',['Same-origin request required.']);return true;}
 const nonce=randomBytes(16).toString('base64');
 const csp=`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'self' https://checkout.stripe.com`;
 const form=`<form method="post" action="/meta/order" id="f"><input name="q" id="q" maxlength="300" placeholder="เช่น ขอลาเต้ 1 แก้ว / e.g. one latte" required style="font:inherit;width:100%;padding:8px;margin:4px 0"><button>ส่ง / Send</button> <button type="button" id="mic" hidden>🎙️ พูด / Speak</button></form>`;
 // Browser speech-to-text (th-TH): fills the box and sends it. Hidden where the browser has no speech API.
 const script=`<script nonce="${nonce}">(()=>{const R=window.SpeechRecognition||window.webkitSpeechRecognition;if(!R)return;const b=document.getElementById('mic');b.hidden=false;b.onclick=()=>{const r=new R();r.lang='th-TH';r.interimResults=false;b.textContent='🎙️ กำลังฟัง… / Listening…';r.onresult=e=>{document.getElementById('q').value=e.results[0][0].transcript;document.getElementById('f').submit();};r.onend=()=>{b.textContent='🎙️ พูด / Speak';};r.start();};})();</script>`;
 const show=(status:number,lines:string[])=>page(res,status,'สั่งด้วยเสียงหรือพิมพ์ / Order',[...lines,form,'<small>เสียงแปลงเป็นข้อความโดยเบราว์เซอร์ของคุณ · ราคาคิดโดยร้าน · Stripe sandbox, test mode</small>',script],{'Content-Security-Policy':csp});
 try{
  if(url.pathname==='/meta/order'&&method==='GET'){show(200,['พูดหรือพิมพ์สิ่งที่อยากสั่ง / Say or type what you would like.']);return true;}
  const body=await formBody(req);
  if(!body){page(res,413,'คำขอใหญ่เกินไป',['Request too large.']);return true;}
  if(url.pathname==='/meta/order'&&method==='POST'){
   const text=(body.get('q')??'').trim().slice(0,300);
   if(!text){show(400,['พิมพ์หรือพูดก่อนนะคะ / Please say or type something.']);return true;}
   const plan=await planChatOrder(chat,me.merchantId,me.linkId,text);
   const by=plan.kind!=='error'&&plan.by?` <small>· ${esc(plan.by)}</small>`:'';
   if(plan.kind==='quote'){show(200,[`<small>คุณ / You: ${esc(text)}</small>`,esc(plan.reply).replace(/\n/g,'<br>')+by,`<strong>${esc(plan.line)}</strong>`,`<form method="post" action="/meta/order/pay"><input type="hidden" name="quote" value="${esc(plan.quoteId)}"><button>จ่าย ${esc(plan.total)} / Pay (Stripe test mode)</button></form>`]);return true;}
   if(plan.kind==='menu'){show(200,[`<small>คุณ / You: ${esc(text)}</small>`,esc(plan.reply).replace(/\n/g,'<br>')+by,...plan.lines.map(esc)]);return true;}
   if(plan.kind==='help'){show(200,[`<small>คุณ / You: ${esc(text)}</small>`,esc(plan.reply).replace(/\n/g,'<br>')+by]);return true;}
   if(plan.kind==='book'){show(200,[`<small>คุณ / You: ${esc(text)}</small>`,...bookingMessages('0',plan.result,plan.reply).map(m=>m.kind==='text'||m.kind==='buttons'?esc(m.text).replace(/\n/g,'<br>'):m.kind==='cards'?`<strong>${esc(m.cards[0].title)}</strong><br><small>${esc(m.cards[0].subtitle??'')}</small>`:'')]);return true;}
   show(409,[esc(plan.text)]);return true;
  }
  if(url.pathname==='/meta/order/pay'&&method==='POST'){
   const r=await startAgentCheckout(chat,me.merchantId,me.linkId,body.get('quote'),deps.identity.publicOrigin);
   if(r.kind==='redirect'){res.writeHead(303,{Location:r.url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();return true;}
   if(r.kind==='paid'){show(200,[`จ่ายแล้ว รหัสรับสินค้า #${esc(r.pickupCode)} / Already paid.`]);return true;}
   show(409,['รายการนี้ปิดแล้ว สั่งใหม่ได้เลย / This order is closed; order again.']);return true;
  }
  json(res,404,{error:'RESOURCE_NOT_FOUND'});return true;
 }catch(e){
  if(e instanceof AgentOrderError){show(409,[esc(ORDER_ERR[e.code]??'ระบบขัดข้อง / Something went wrong.')]);return true;}
  log('Web order failed');page(res,500,'ระบบขัดข้อง',['Something went wrong.']);return true;
 }
}

/** Owner/manager evidence ledger: every model call, tap, payment event and promotion decision of the last day.
 * No customer identity (PSID) and no message text is shown or stored. */
async function serveLedger(res:http.ServerResponse,deps:MetaRouteDeps,staff:StaffDeps,cookie:string|null):Promise<true>{
 const me=await staffFromSession(staff,cookie);
 if(!me){res.writeHead(303,{Location:'/meta/staff','Cache-Control':'no-store'});res.end();return true;}
 if(me.role==='staff'){page(res,403,'ทำรายการไม่ได้',[OFFER_ERRORS.ROLE_REQUIRED,'<a href="/meta/staff">← กลับ / Back</a>']);return true;}
 const t=(d:Date)=>d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Bangkok'});
 const code=(id:string)=>id.replace(/-/g,'').slice(0,4).toUpperCase();
 const data=await deps.identity.db.tenant(me.merchantId,async db=>({
  ai:(await db.query<{started_at:Date;task:string;provider:string;model:string;outcome:string;latency_ms:number;prompt_tokens:number|null;completion_tokens:number|null}>("SELECT started_at,task,provider,model,outcome,latency_ms,prompt_tokens,completion_tokens FROM meta_ai_invocations WHERE started_at>clock_timestamp()-interval '24 hours' ORDER BY started_at DESC LIMIT 30")).rows,
  taps:(await db.query<{created_at:Date;tag_id:string;counter:number;bound:boolean}>("SELECT created_at,tag_id,counter,link_id IS NOT NULL AS bound FROM meta_tap_sessions WHERE created_at>clock_timestamp()-interval '24 hours' ORDER BY created_at DESC LIMIT 20")).rows,
  pay:(await db.query<{at:Date;event_id:string;order_id:string;kind:string}>("SELECT received_at AS at,event_id,order_id,'tap' AS kind FROM meta_stripe_events WHERE received_at>clock_timestamp()-interval '24 hours' UNION ALL SELECT received_at,event_id,order_id,'agent' FROM meta_agent_stripe_events WHERE received_at>clock_timestamp()-interval '24 hours' ORDER BY at DESC LIMIT 20")).rows,
  decisions:(await db.query<{decided_at:Date;state:string;approval_kind:string|null;discount_percent:number;chosen_by:string;name_en:string}>("SELECT d.decided_at,d.state,d.approval_kind,d.discount_percent,d.chosen_by,coalesce(p.name_en,'') AS name_en FROM meta_offer_drafts d LEFT JOIN products p ON p.merchant_id=d.merchant_id AND p.id=d.product_id WHERE d.decided_at>clock_timestamp()-interval '24 hours' ORDER BY d.decided_at DESC LIMIT 20")).rows,
 }));
 const section=(title:string,rows:string[])=>[`<strong>${title}</strong>`,...(rows.length?rows:['<small>— none in the last 24 h —</small>'])];
 page(res,200,'หลักฐาน / Evidence ledger',[`<small>${esc(me.role)} · 24 ชั่วโมงล่าสุด / last 24 hours · ไม่แสดงตัวตนลูกค้า / no customer identity shown</small>`,
  ...section('🧠 AI calls (Meta Model API)',data.ai.map(r=>`<small>${t(r.started_at)} · ${esc(r.task)} · ${esc(r.model)} (${esc(r.provider)}) · ${esc(r.outcome)} · ${r.latency_ms} ms · ${r.prompt_tokens??'?'}/${r.completion_tokens??'?'} tokens</small>`)),
  ...section('📱 Taps (NTAG424 SUN verified)',data.taps.map(r=>`<small>${t(r.created_at)} · ${esc(r.tag_id)} · counter ${r.counter} · ${r.bound?'customer known':'not linked'}</small>`)),
  ...section('💳 Stripe events (signature verified, once each)',data.pay.map(r=>`<small>${t(r.at)} · ${esc(r.event_id)} · order #${code(r.order_id)} · ${r.kind}</small>`)),
  ...section('🛡️ Promotion decisions',data.decisions.map(r=>`<small>${t(r.decided_at)} · ${esc(r.name_en)} −${r.discount_percent}% · ${esc(r.state)} · ${r.approval_kind==='policy'?'Allow All':r.approval_kind==='owner'?'owner':'—'} · drafted by ${r.chosen_by==='model'?'Muse Spark':'fallback'}</small>`)),
  '<a href="/meta/staff">← ออเดอร์ / Orders</a>']);
 return true;
}

function reservationLines(rows:Awaited<ReturnType<typeof staffReservations>>):string[]{
 if(!rows.length)return [];
 const t=(iso:string)=>new Date(iso).toLocaleString('en-GB',{weekday:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'});
 const label:Record<string,string>={HELD:'🗓️ รอเช็กอิน / awaiting check-in',CHECKED_IN:'✅ เช็กอินแล้ว / checked in',NO_SHOW:'⌛ หลุดคิว / no-show',CANCELLED:'↩️ ยกเลิก / cancelled'};
 return ['<strong>🗓️ การจองโต๊ะ / Table bookings</strong>',...rows.map(r=>`<strong>#${esc(r.code)}</strong> โต๊ะ ${esc(r.tableLabel)} · ${t(r.startsAt)} · ${r.partySize} คน · ${label[r.status]??esc(r.status)}${r.status==='HELD'&&r.minutesToDeadline!==null?` · หมดเวลาเช็กอินใน ${Math.max(0,r.minutesToDeadline)} นาที`:''}${r.status==='HELD'?`<form method="post" action="/meta/staff/reservations/${r.id}/cancel"><button>ยกเลิกการจอง / Cancel booking</button></form>`:''}`)];
}

/** Every minute: bookings past their check-in window lapse (NO_SHOW) and the customer is told in Messenger. */
export function startReservationSweeper(deps:MetaRouteDeps,intervalMs=60_000):NodeJS.Timeout{
 const tick=async()=>{
  try{
   for(const n of await sweepLapsed(deps.identity.db)){
    deps.log?.('Booking lapsed');
    if(deps.messenger)await sendMessenger(deps.messenger,{kind:'text',psid:n.psid,text:n.text,eventUpdate:true},deps.fetch).catch(()=>deps.log?.('Lapse notice failed'));
   }
  }catch{deps.log?.('Booking sweep failed');}
 };
 const timer=setInterval(tick,intervalMs);timer.unref();return timer;
}
