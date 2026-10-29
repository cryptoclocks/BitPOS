// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Raw HTTP handlers under /meta/: the NTAG424 tap URL, the Messenger webhook and the customer web session.
// They need the exact request bytes (webhook signature), cookies and redirects, so they sit beside the JSON API.
import type http from 'node:http';
import {consumeMagicLink,customerFromSession,handleMessengerEvents,handleTap,offerForTap,offerMessage,revokeFromSession,type IdentityDeps,type OfferDeps,type OfferView} from './identity';
import {invocationSink} from './evidence';
import {applyStripeWebhook,reconcileTapOrder,startTapCheckout,type StripeDeps} from './tap-checkout';
import {stripeSandboxFromEnv,StripePaymentError} from './stripe';
import {createMetaRouter,metaProvidersFromEnv} from '../../../../packages/meta-ai/src/router';
import {formatTapAmount,handOver,listTapOrders,pickupCode,staffConfigFromEnv,staffDemoSignIn,staffFromSession,staffSignIn,staffSignOut,type SignInResult,type StaffDeps,type StaffOrder,type StaffView} from './staff';
import {serveMcp} from './mcp';
import {cancelReservation,screenTags,staffReservations,sweepLapsed,tableScreen} from './reservations';
import {screenHtml,screenKey,screenKeyValid} from './screen';
import {approveDraft,draftOffer,listOffersOverview,rejectDraft,revokePolicy,stopOffer,OfferPolicyError,type DraftView,type OfferPolicyDeps,type PolicyView} from './offer-policy';
import {bookingMessages,handleAgentRequest,planChatOrder,QUICK,type ChatAgentDeps} from './agent';
import {randomBytes} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {aiHtml,customerHtml,photo,staffHtml} from './ui';
import {servePos} from './pos';
import {cartChatReceipt,cartOrderMerchant,handOverCart} from './cart';
import {receiptAvailable,receiptImageKeyValid,receiptImageUrl,receiptPng} from './receipt-image';
import {deviceKeyValid,deviceView} from './device';
import {readFile} from 'node:fs/promises';
import {AgentOrderError,agentOrderMerchant,agentReceipt,createQuote,listMenu,reconcileAgentCheckout,startAgentCheckout,type MenuItem} from './agent-orders';
import {MessengerError,messengerConfigFromEnv,parseMessengerWebhook,sendMessenger,verifyMessengerSignature,verifySubscription,type MessengerConfig,type MessengerFetch} from './messenger';

export interface MetaRouteDeps {identity:IdentityDeps;messenger:MessengerConfig|null;offers:OfferDeps|null;stripe?:StripeDeps|null;staff?:StaffDeps|null;fetch?:MessengerFetch;log?:(msg:string)=>void;
 /** The Meta demo shop served at the meta-pay root (META_DEMO_MERCHANT). */
 demoMerchant?:string|null}
export const COOKIE='bitpos_meta',STAFF_COOKIE='bitpos_meta_staff';
const STAFF_SESSION_SECONDS=8*3600,MAX_FORM=4096;
const MAX_WEBHOOK=65536;
// The shop's existing menu photos (inherited), served by this container so Messenger cards do not depend on the POS host.
const MENU_IMAGES=new URL('../../../web/public/images/menu/',import.meta.url);

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
 const demo=env.META_DEMO_MERCHANT;const demoMerchant=demo&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(demo)?demo:null;
 return {identity:{db,masterKey:Buffer.from(master,'hex'),publicOrigin:u.origin},messenger,offers,stripe,staff,demoMerchant};
}

const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Set while a staff request runs, so the shared page() helper renders the meta-pos shell (or its sign-in page). */
interface StaffContext {active:string;me:StaffView|null;shop:string}
const STAFF_CTX=new AsyncLocalStorage<StaffContext>();
function page(res:http.ServerResponse,status:number,title:string,lines:string[],extraHeaders:Record<string,string|string[]>={},nav?:[string,string][]){
 const body=`<div class="card">${lines.map(l=>`<div style="margin:8px 0">${l}</div>`).join('')}</div>`,ctx=STAFF_CTX.getStore();
 const html=ctx?.me?staffHtml({title,active:ctx.active,role:ctx.me.role,shop:ctx.shop},body)
  :ctx?customerHtml({title,nav:nav??[['เข้าสู่ระบบพนักงาน / Staff sign-in','/meta/staff']]},`<h1>${esc(title)}</h1>${body}`)
  :customerHtml({title,nav:nav??[['หน้าร้าน / Shop','/'],['ช่วยเหลือ / Help','/help']]},`<h1>${esc(title)}</h1>${body}`);
 res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https:; form-action 'self' https://checkout.stripe.com",
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
 // Customer pages live on META_PUBLIC_URL's host, staff pages on META_STAFF_URL's host. On the staff host only
 // /meta/staff answers; elsewhere (customer host or the legacy pay.… /meta/ route) staff pages redirect there.
 // Direct loopback requests (host health checks, tests) are not redirected.
 const staffOrigin=deps.staff?.config.origin,host=(req.headers.host??'').toLowerCase(),isStaffPath=path==='/meta/staff'||path.startsWith('/meta/staff/');
 if(staffOrigin&&staffOrigin!==deps.identity.publicOrigin&&!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)){
  if(host===new URL(staffOrigin).host){if(!isStaffPath){res.writeHead(404,{'Content-Type':'text/plain'});res.end('not found');return true;}}
  else if(isStaffPath&&method==='GET'){res.writeHead(302,{Location:staffOrigin+path,'Cache-Control':'no-store'});res.end();return true;}
 }
 const image=path.match(/^\/meta\/images\/menu\/([a-z0-9-]{1,64}\.jpg)$/);
 if(image&&method==='GET'){
  try{const body=await readFile(new URL(image[1],MENU_IMAGES));res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'});res.end(body);}
  catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('not found');}
  return true;
 }
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
 // BitPOS Mini Meta product: which screen to show (device key in the Authorization header, never in the URL).
 if(path==='/meta/device/state'&&method==='GET'){
  const d=url.searchParams.get('d')??'';
  if(!/^[0-9a-f-]{36}$/.test(d)||!deviceKeyValid(deps.identity.masterKey,d,req.headers.authorization)){json(res,401,{error:'UNAUTHORIZED'});return true;}
  const v=await deviceView(deps.identity.db,d,deps.identity.publicOrigin);
  if(!v){json(res,404,{error:'NOT_FOUND'});return true;}
  json(res,200,v);return true;
 }
 const screen=path.match(/^\/meta\/screen\/([A-Za-z0-9_-]{4,64})$/);
 if(screen&&method==='GET'){
  const notFound=()=>{res.writeHead(404,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('not found');return true as const;};
  if(!screenKeyValid(deps.identity.masterKey,screen[1],url.searchParams.get('k')))return notFound();
  const tag=(await deps.identity.db.query<{merchant_id:string;device_id:string}>('SELECT merchant_id,device_id FROM bitpos.meta_tag_device($1)',[screen[1]])).rows[0];
  const view=tag?await tableScreen(deps.identity.db,tag.merchant_id,tag.device_id):null;
  if(!view)return notFound();
  const nonce=randomBytes(16).toString('base64');
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
   'Content-Security-Policy':`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'none'; frame-ancestors 'none'`});
  res.end(screenHtml(view,nonce));return true;
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
 const pic=path.match(/^\/meta\/receipt\/([0-9a-f-]{36})\.png$/);
 if(pic&&method==='GET'){
  // Messenger fetches this; the HMAC in the URL is the only key. Paid chat orders only; no customer identity on it.
  const id=pic[1],db=deps.identity.db;
  if(!receiptImageKeyValid(deps.identity.masterKey,id,url.searchParams.get('k'))){json(res,404,{error:'RESOURCE_NOT_FOUND'});return true;}
  const merchantId=await agentOrderMerchant(db,id)??await cartOrderMerchant(db,id);
  const r=merchantId?await paidReceipt(deps,merchantId,id):null;
  const png=r?await receiptPng({shop:r.shop,code:r.receipt.orderNumber,receipt:r.receipt}):null;
  if(!png){json(res,404,{error:'RESOURCE_NOT_FOUND'});return true;}
  res.writeHead(200,{'Content-Type':'image/png','Content-Length':png.length,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});res.end(png);return true;
 }
 if(path==='/meta/stripe/webhook'&&method==='POST'){
  if(!deps.stripe){json(res,503,{error:'NOT_CONFIGURED'});return true;}
  const raw=await rawBody(req,MAX_WEBHOOK);
  if(!raw){json(res,413,{error:'REQUEST_TOO_LARGE'});return true;}
  const receipt=(merchantId:string,orderId:string)=>sendReceipt(deps,merchantId,orderId,log);
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
  if(o?.confirmedNow)await sendReceipt(deps,o.merchantId,o.orderId,log);
  if(o?.status==='CONFIRMED'){page(res,200,'จ่ายแล้ว ✓',['ร้านได้รับออเดอร์แล้ว รับที่เคาน์เตอร์ได้เลย','Paid — pick it up at the counter.',`รหัสรับสินค้า / Pickup code: <strong>${esc(o.pickupCode)}</strong>`,'กลับไปที่ Messenger ได้เลย / You can go back to Messenger.','<small>Stripe sandbox · test mode · no real money</small>']);return true;}
  page(res,202,'กำลังตรวจสอบการชำระเงิน',['ยังไม่ได้รับการยืนยันจาก Stripe ลองรีเฟรชอีกครั้ง','Waiting for Stripe to confirm. Refresh in a moment.']);return true;
 }
 if(path==='/meta/order'||path==='/meta/order/pay'||path==='/meta/order/add')return serveWebOrder(req,res,deps,url,log);
 if(path==='/meta/staff'||path.startsWith('/meta/staff/'))return STAFF_CTX.run({active:path.replace(/^(\/meta\/staff\/[a-z]+).*$/,'$1'),me:null,shop:''},()=>serveStaff(req,res,deps,url,log));
 const mcp=path.match(/^\/meta\/mcp\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/);
 if(mcp){
  if(!deps.offers){json(res,503,{error:'NOT_CONFIGURED'});return true;}
  if(!allowAttempt(req,Date.now(),mcpCalls,120,60_000)){json(res,429,{error:'RATE_LIMITED'});return true;}
  if(!(await serveMcp(req,res,{db:deps.identity.db,offers:deps.offers,stripe:deps.stripe??null},mcp[1])))json(res,404,{error:'RESOURCE_NOT_FOUND'});
  return true;
 }
 json(res,404,{error:'RESOURCE_NOT_FOUND'});return true;
}

/** A paid chat order (agent or cart) as receipt facts, with the shop's name for the picture. */
async function paidReceipt(deps:MetaRouteDeps,merchantId:string,orderId:string){
 const db=deps.identity.db,o=deps.identity.publicOrigin;
 const r=await agentReceipt(db,merchantId,orderId,o)??await cartChatReceipt(db,merchantId,orderId,o);
 if(!r)return null;
 const shop=(await db.tenant(merchantId,c=>c.query<{name:string}>('SELECT name FROM merchants WHERE id=$1',[merchantId]))).rows[0]?.name??'';
 return {...r,shop};
}
/** Paid receipt to the customer's chat: the receipt picture plus a short text with chips; if Messenger refuses the
 * picture or the renderer is missing, the receipt template (and its text fallback) instead. Runs after commit. */
async function sendReceipt(deps:MetaRouteDeps,merchantId:string,orderId:string,log:(m:string)=>void):Promise<void>{
 if(!deps.messenger)return;
 try{
  const r=await paidReceipt(deps,merchantId,orderId);if(!r)return;
  const msg=deps.messenger,f=deps.fetch;
  if(await receiptAvailable()){
   const ok=await sendMessenger(msg,{kind:'image',psid:r.psid,url:receiptImageUrl(deps.identity.publicOrigin,deps.identity.masterKey,orderId)},f).then(()=>true,()=>false);
   if(ok){await sendMessenger(msg,{kind:'text',psid:r.psid,text:`จ่ายแล้ว ✓ รหัสรับสินค้า #${r.receipt.orderNumber} · รับที่เคาน์เตอร์ได้เลยค่ะ\nPaid — pickup code #${r.receipt.orderNumber}.`,quick:QUICK},f);return;}
   log('Receipt picture refused; sending the template');
  }
  await sendMessenger(msg,{kind:'receipt',psid:r.psid,receipt:r.receipt,fallbackText:r.text,quick:QUICK},f);
 }catch{log('Receipt send failed');}
}
function chatDeps(deps:MetaRouteDeps):ChatAgentDeps|null{
 return deps.offers?{db:deps.identity.db,offers:deps.offers,stripe:deps.stripe??null,router:deps.offers.router,publicOrigin:deps.identity.publicOrigin,shopMerchant:deps.demoMerchant??null}:null;
}

// Requests per client address (behind the tunnel, Cloudflare's client IP header) per window: staff sign-in and MCP calls.
const attempts=new Map<string,{start:number;n:number}>(),mcpCalls=new Map<string,{start:number;n:number}>(),orderPosts=new Map<string,{start:number;n:number}>();
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

/** The signed-in staff member (role re-read every request); also fills the page shell's context. */
async function whoami(staff:StaffDeps,cookie:string|null):Promise<StaffView|null>{
 const me=await staffFromSession(staff,cookie),ctx=STAFF_CTX.getStore();
 if(me&&ctx){ctx.me=me;ctx.shop=(await staff.db.tenant(me.merchantId,c=>c.query<{name:string}>('SELECT name FROM merchants WHERE id=$1',[me.merchantId]))).rows[0]?.name??'';}
 return me;
}
async function serveStaff(req:http.IncomingMessage,res:http.ServerResponse,deps:MetaRouteDeps,url:URL,log:(m:string)=>void):Promise<true>{
 const staff=deps.staff,path=url.pathname,method=req.method??'GET';
 if(!staff){page(res,503,'หน้าพนักงานยังไม่พร้อม',['Staff sign-in is not configured on this server.']);return true;}
 const cookie=cookieValue(req.headers.cookie,STAFF_COOKIE);
 if(method==='POST'&&req.headers.origin!==staff.config.origin){page(res,403,'ไม่อนุญาต',['Same-origin request required.']);return true;}
 if(path==='/meta/staff'&&method==='GET'){
  const me=await whoami(staff,cookie);
  if(!me){page(res,200,'พนักงาน · ออเดอร์จากการแตะ',signInForm(staff));return true;}
  if(await servePos(req,res,deps,staff,async()=>me,url,log))return true;
  const done=url.searchParams.get('done');
  const lines=[`<small>${esc(me.role)} · อัปเดตทุก 10 วินาที / refreshes every 10 s · Stripe sandbox, test mode</small>`,
   ...(done&&/^[0-9A-F]{4}$/.test(done)?[`✓ ส่งมอบ #${done} แล้ว / Handed over.`]:[]),...orderLines(await listTapOrders(staff,me)),
   ...reservationLines(await staffReservations(deps.identity.db,me.merchantId)),
   ...screenLinks(deps,await screenTags(deps.identity.db,me.merchantId)),
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
  const me=await whoami(staff,cookie);
  if(!me){res.writeHead(303,{Location:'/meta/staff','Cache-Control':'no-store'});res.end();return true;}
  let r=await handOver(staff,me,hand[1]);
  if(r==='NOT_FOUND')r=await handOverCart(deps.identity.db,me.merchantId,me.userId,hand[1]);
  if(r==='HANDED_OVER'||r==='ALREADY'){res.writeHead(303,{Location:`/meta/staff?done=${pickupCode(hand[1])}`,'Cache-Control':'no-store'});res.end();return true;}
  page(res,r==='NOT_FOUND'?404:409,'ส่งมอบไม่ได้',[r==='NOT_PAID'?'ออเดอร์นี้ยังไม่ได้จ่าย / This order is not paid.':'ไม่พบออเดอร์ / Order not found.','<a href="/meta/staff">← กลับ / Back</a>']);return true;
 }
 if(path==='/meta/staff/offers'||path.startsWith('/meta/staff/offers/')||path.startsWith('/meta/staff/policies/'))return serveOffers(req,res,deps,staff,cookie,url,log);
 if(path==='/meta/staff/ledger'&&method==='GET')return serveLedger(res,deps,staff,cookie);
 const resCancel=path.match(/^\/meta\/staff\/reservations\/([0-9a-f-]{36})\/cancel$/);
 if(resCancel&&method==='POST'){
  const me=await whoami(staff,cookie);
  if(!me){res.writeHead(303,{Location:'/meta/staff','Cache-Control':'no-store'});res.end();return true;}
  await cancelReservation(deps.identity.db,me.merchantId,resCancel[1],{staff:true});
  res.writeHead(303,{Location:'/meta/staff','Cache-Control':'no-store'});res.end();return true;
 }
 if(await servePos(req,res,deps,staff,()=>whoami(staff,cookie),url,log))return true;
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
 const me=await whoami(staff,cookie);
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
 if(!me){page(res,401,'ยังไม่ได้เชื่อมต่อ',['สั่งด้วยเสียงใช้ได้หลังเชื่อมต่อกับร้าน: แตะมือถือที่เครื่อง BitPOS Mini แล้วกดยินยอมใน Messenger','หรือสั่งจากเมนูบนหน้าร้านได้เลยโดยไม่ต้องเชื่อมต่อ','Tap your phone on the BitPOS Mini and accept in Messenger to order by voice.'],{},[['สั่งจากเมนู / Menu','/menu'],['วิธีเชื่อมต่อ / Help','/help#tap']]);return true;}
 if(method==='POST'&&req.headers.origin!==deps.identity.publicOrigin){page(res,403,'ไม่อนุญาต',['Same-origin request required.']);return true;}
 // Per-address cap on top of the per-customer model-call cap: 30 orders or payments a minute.
 if(method==='POST'&&!allowAttempt(req,Date.now(),orderPosts,30,60_000)){page(res,429,'ลองใหม่ภายหลัง',['ส่งคำสั่งถี่เกินไป รอสักครู่แล้วลองใหม่','Too many requests. Wait a moment and try again.']);return true;}
 const nonce=randomBytes(16).toString('base64');
 const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'same-origin','X-Content-Type-Options':'nosniff','Permissions-Policy':'microphone=(self)',
  'Content-Security-Policy':`default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:; script-src 'nonce-${nonce}'; form-action 'self' https://checkout.stripe.com`};
 const menu=(await listMenu(chat,me.merchantId)).filter(i=>i.payable);
 const hint=menu.slice(0,3).map(i=>`ขอ${i.name} 1 แก้ว`);
 // Design C11 as a modern assistant: dark thread, glowing orb that follows the mic level, glass dock with input and chips.
 const show=(status:number,o:{you?:string;reply?:string;by?:string;result?:string;note?:string})=>{
  const thread=o.you||o.note||o.result?`${o.you?`<div class="msg me"><div class="tx">${esc(o.you)}</div></div>`:''}${o.reply?`<div class="msg"><span class="av"></span><div class="tx">${esc(o.reply).replace(/\n/g,'<br>')}${o.by?`<div><small>✦ ${esc(o.by)}</small></div>`:''}</div></div>`:''}${o.result?`<div class="glass">${o.result}</div>`:''}${o.note?`<div class="note">${o.note}</div>`:''}`
   :`<div class="hello"><h1>อยากทานอะไรดีคะ?</h1><p class="mu">แตะลูกแก้วแล้วพูดได้เลย หรือพิมพ์ด้านล่าง<br>Muse Spark ช่วยเลือก ร้านคิดราคาเอง</p></div>`;
  const dock=`<div class="orbw"><button type="button" id="mic" class="orb" aria-label="กดแล้วพูด / Tap to speak"><span>🎙️</span></button><div id="live" class="live"></div><div id="st" class="st">แตะเพื่อพูด</div>
<div class="lang"><a class="on" href="#" data-l="th-TH">ไทย</a><a href="#" data-l="en-US">English</a></div></div>
<form method="post" action="/meta/order" id="f" class="aibar"><input name="q" id="q" maxlength="300" placeholder="พิมพ์ เช่น ${esc(hint[0]??'ขอลาเต้ 1 แก้ว')}" required autocomplete="off"><button aria-label="ส่ง">↑</button></form>
${hint.length?`<div class="sugg">${hint.map(h=>`<form method="post" action="/meta/order"><input type="hidden" name="q" value="${esc(h)}"><button>${esc(h)}</button></form>`).join('')}<form method="get" action="/menu"><button>☕ ดูเมนูทั้งหมด</button></form></div>`:''}`;
  const errs={'not-allowed':'เบราว์เซอร์ไม่ได้รับสิทธิ์ใช้ไมค์ · กดอนุญาตที่ไอคอนไมค์ในแถบที่อยู่ และเปิดใน System Settings › Privacy & Security › Microphone',
   'service-not-allowed':'Safari ต้องเปิด Dictation ก่อน (System Settings › Keyboard › Dictation) หรือใช้ Chrome',
   'network':'บริการแปลงเสียงของเบราว์เซอร์ต่อไม่ได้ (Chrome ใช้เซิร์ฟเวอร์ Google) ลองใหม่ หรือใช้ Safari / พิมพ์แทน',
   'no-speech':'ไม่ได้ยินเสียง ลองพูดใกล้ไมค์อีกครั้ง','audio-capture':'ไม่พบไมโครโฟนในเครื่องนี้',
   'language-not-supported':'เบราว์เซอร์นี้ยังไม่รองรับภาษานี้ ลอง English หรือพิมพ์แทน','aborted':'หยุดฟังแล้ว'};
  const script=`(()=>{const R=window.SpeechRecognition||window.webkitSpeechRecognition,b=document.getElementById('mic'),st=document.getElementById('st'),live=document.getElementById('live'),q=document.getElementById('q'),f=document.getElementById('f');let lang='th-TH',r=null,said='',audio=null;
window.scrollTo(0,document.body.scrollHeight);
const msg=${JSON.stringify(errs)};
document.querySelectorAll('[data-l]').forEach(a=>a.onclick=e=>{e.preventDefault();lang=a.dataset.l;document.querySelectorAll('[data-l]').forEach(x=>x.classList.toggle('on',x===a));});
if(!R){b.disabled=true;b.classList.add('off');st.textContent='เบราว์เซอร์นี้พูดสั่งไม่ได้ (ใช้ Chrome หรือ Safari) · พิมพ์แทนได้';return;}
if(!window.isSecureContext){b.disabled=true;b.classList.add('off');st.textContent='ต้องเปิดผ่าน https เพื่อใช้ไมค์';return;}
// The orb follows the voice level (Web Audio, local only; nothing is recorded or sent).
const level=async()=>{try{const s=await navigator.mediaDevices.getUserMedia({audio:true}),c=new AudioContext(),a=c.createAnalyser();a.fftSize=256;c.createMediaStreamSource(s).connect(a);const d=new Uint8Array(a.frequencyBinCount);
 audio={s,c};const tick=()=>{if(!audio)return;a.getByteFrequencyData(d);let m=0;for(const v of d)m+=v;b.style.setProperty('--lvl',Math.min(1,m/d.length/90).toFixed(3));requestAnimationFrame(tick);};tick();}catch(e){}};
const stopLevel=()=>{if(audio){audio.s.getTracks().forEach(t=>t.stop());audio.c.close();audio=null;}b.style.setProperty('--lvl','0');};
const idle=()=>{b.classList.remove('on');stopLevel();if(!said)st.textContent=st.dataset.err||'แตะเพื่อพูด';};
b.onclick=()=>{if(r){r.stop();return;}said='';st.dataset.err='';live.textContent='';r=new R();r.lang=lang;r.interimResults=true;r.continuous=false;r.maxAlternatives=1;
 r.onstart=()=>{b.classList.add('on');st.textContent='กำลังฟัง… แตะอีกครั้งเพื่อหยุด';level();};
 r.onresult=e=>{let t='',fin=false;for(const x of e.results){t+=x[0].transcript;fin=fin||x.isFinal;}live.textContent=t;if(fin)said=t.trim();};
 r.onerror=e=>{st.dataset.err=msg[e.error]||('ไมค์ใช้ไม่ได้ ('+e.error+') · พิมพ์แทนได้');st.textContent=st.dataset.err;};
 r.onend=()=>{r=null;idle();if(said){q.value=said;st.textContent='Muse Spark กำลังคิด…';b.classList.add('on');f.submit();}};
 try{r.start();}catch(err){r=null;st.textContent='เริ่มฟังไม่ได้ ลองอีกครั้ง';}};
f.addEventListener('submit',()=>{st.textContent='Muse Spark กำลังคิด…';});})();`;
  res.writeHead(status,headers);res.end(aiHtml({title:'สั่งด้วยเสียง',back:'/menu',nonce,script,dock},thread));return true as const;
 };
 const quoteCard=(q:{quoteId:string;total:string;quantity:number;name:string;nameEn:string},item?:MenuItem)=>{const img=photo(item?.imageUrl);
  return `<div><div class="row" style="border:0;padding:0;margin:0">${img?`<img src="${esc(img)}" alt="">`:`<div class="ic">${esc(item?.emoji??'☕')}</div>`}<div class="t"><b>${esc(q.name)} × ${q.quantity}</b><small>${esc(q.nameEn)}${item?.offer?` · <span class="pill rd">โปร −${item.offer.discountPercent}%</span>`:''}</small></div><div class="r">${esc(q.total)}</div></div>
<form method="post" action="/meta/order/pay"><input type="hidden" name="quote" value="${esc(q.quoteId)}"><button>จ่าย ${esc(q.total)} ด้วย Stripe</button></form><small class="mu">ราคาจากร้าน ล็อก 10 นาที · บัตรทดสอบ 4242 4242 4242 4242</small></div>`;};
 const menuRows=(items:MenuItem[])=>`<div class="lst">${items.slice(0,8).map(i=>`<form method="post" action="/meta/order/add"><input type="hidden" name="id" value="${esc(i.productId)}"><button class="row" style="width:100%;text-align:left;font-weight:400;background:#fff">${photo(i.imageUrl)?`<img src="${esc(photo(i.imageUrl)!)}" alt="">`:`<span class="ic">${esc(i.emoji)}</span>`}<span class="t"><b>${esc(i.name)} · ${esc(i.nameEn)}</b><small>${i.offer?`โปร −${i.offer.discountPercent}% · `:''}กดเพื่อสั่ง 1 ชิ้น</small></span><span class="r">${esc(i.price.display)}</span></button></form>`).join('')}</div>`;
 try{
  if(url.pathname==='/meta/order'&&method==='GET')return show(200,{});
  const body=await formBody(req);
  if(!body){page(res,413,'คำขอใหญ่เกินไป',['Request too large.']);return true;}
  if(url.pathname==='/meta/order/add'&&method==='POST'){
   // A tapped menu row: quote that product directly, no model call.
   const item=menu.find(i=>i.productId===body.get('id'));
   if(!item)return show(409,{note:'เมนูนี้สั่งไม่ได้ตอนนี้ / Not available now.',result:menuRows(menu)});
   const q=await createQuote(chat,me.merchantId,'messenger',item.productId,1,me.linkId);
   return show(200,{you:`${item.name} × 1`,reply:'ได้เลยค่ะ ราคาจากร้าน 👇',result:quoteCard(q,item)});
  }
  if(url.pathname==='/meta/order'&&method==='POST'){
   const text=(body.get('q')??'').trim().slice(0,300);
   if(!text)return show(400,{note:'พิมพ์หรือพูดก่อนนะคะ / Please say or type something.'});
   const plan=await planChatOrder(chat,me.merchantId,me.linkId,text);
   if(plan.kind==='quote')return show(200,{you:text,reply:plan.reply,by:plan.by,result:quoteCard(plan.quote,plan.item)});
   if(plan.kind==='menu')return show(200,{you:text,reply:plan.reply,by:plan.by,result:menuRows(plan.items)});
   if(plan.kind==='help')return show(200,{you:text,reply:plan.reply,by:plan.by,result:menuRows(menu)});
   if(plan.kind==='book'){const m=bookingMessages('0',plan.result,plan.reply);
    return show(200,{you:text,reply:m.map(x=>x.kind==='text'||x.kind==='buttons'?x.text:'').filter(Boolean).join('\n'),by:plan.by,
     result:m.filter(x=>x.kind==='cards').map(x=>x.kind==='cards'?`<div class="card"><b>${esc(x.cards[0].title)}</b><br><small class="mu">${esc(x.cards[0].subtitle??'')}</small><div class="mu" style="margin-top:6px">ยกเลิกหรือดูการจองได้ใน Messenger › ออเดอร์ของฉัน</div></div>`:'').join('')});}
   return show(409,{you:text,note:esc(plan.text)});
  }
  if(url.pathname==='/meta/order/pay'&&method==='POST'){
   const r=await startAgentCheckout(chat,me.merchantId,me.linkId,body.get('quote'),deps.identity.publicOrigin);
   if(r.kind==='redirect'){res.writeHead(303,{Location:r.url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();return true;}
   if(r.kind==='paid')return show(200,{note:`จ่ายแล้ว รหัสรับสินค้า #${esc(r.pickupCode)} / Already paid.`});
   return show(409,{note:'รายการนี้ปิดแล้ว สั่งใหม่ได้เลย / This order is closed; order again.'});
  }
  json(res,404,{error:'RESOURCE_NOT_FOUND'});return true;
 }catch(e){
  if(e instanceof AgentOrderError)return show(409,{note:esc(ORDER_ERR[e.code]??'ระบบขัดข้อง / Something went wrong.')});
  log('Web order failed');page(res,500,'ระบบขัดข้อง',['Something went wrong.']);return true;
 }
}

/** Owner/manager evidence ledger: every model call, tap, payment event and promotion decision of the last day.
 * No customer identity (PSID) and no message text is shown or stored. */
async function serveLedger(res:http.ServerResponse,deps:MetaRouteDeps,staff:StaffDeps,cookie:string|null):Promise<true>{
 const me=await whoami(staff,cookie);
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

/** Links to each table's countdown screen (on the customer host), to open on a tablet or phone at the table. */
function screenLinks(deps:MetaRouteDeps,tags:{tagId:string;tableLabel:string}[]):string[]{
 if(!tags.length)return [];
 return [`🖥️ จอโต๊ะ / Table screens: ${tags.map(g=>`<a href="${esc(`${deps.identity.publicOrigin}/meta/screen/${g.tagId}?k=${screenKey(deps.identity.masterKey,g.tagId)}`)}" target="_blank" rel="noopener">${esc(g.tableLabel)}</a>`).join(' · ')}`];
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
