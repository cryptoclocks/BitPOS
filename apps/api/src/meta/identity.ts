// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Tap → Messenger consent → known customer. Every write happens inside the shop's RLS transaction;
// network calls (Messenger Send API) are returned as an outbox and made by the caller after commit.
// Each insert reads the clock once (CTE `n`) so created_at/expires_at satisfy the exact TTL checks.
import type pg from 'pg';
import {createHash,randomBytes} from 'node:crypto';
import {deriveTagKeys,verifySun,SunError} from '../../../../packages/meta-ai/src/ntag424';
import {REF,type Outgoing,type ParsedEvent} from './messenger';
import type {EffectiveMenu} from '../offers';
import type {MetaRouter} from '../../../../packages/meta-ai/src/router';
import {checkIn,holdForDevice,type TableHold} from './reservations';
import {approvedOffers,formatMoney,selectOffer} from './offer-select';
import type {Money} from '../../../../packages/contracts/src/index';

export interface MetaDb {
 /** Runs as the application role outside any tenant (SECURITY DEFINER lookups only). */
 query<R extends pg.QueryResultRow=any>(sql:string,params:unknown[]):Promise<{rows:R[]}>;
 tenant<T>(merchant:string,fn:(db:pg.PoolClient)=>Promise<T>):Promise<T>;
}
export interface IdentityDeps {db:MetaDb;masterKey:Buffer;publicOrigin:string}

const sha=(s:string)=>createHash('sha256').update(s).digest();
const token=()=>randomBytes(32).toString('base64url');
const TAG=/^[A-Za-z0-9_-]{4,64}$/,TOKEN=/^[A-Za-z0-9_-]{43}$/;
export const CONSENT_VERSION='bitpos-meta-offers-v1';

export type TapOutcome=
 {kind:'invalid'}|{kind:'replayed'}|{kind:'no_page';merchantId:string}|
 {kind:'known';merchantId:string;tapSessionId:string;deviceId:string;linkId:string;checkedIn?:{tableLabel:string;startsAt:string;justNow:boolean}}|
 /** The table is held by someone else's booking: no session is bound; the booker can still identify via Messenger. */
 {kind:'reserved';merchantId:string;tableLabel:string;checkInUntil:string;status:'HELD'|'CHECKED_IN';url:string|null}|
 {kind:'messenger';merchantId:string;tapSessionId:string;url:string};

export async function handleTap(deps:IdentityDeps,tagId:string,e:string|null,m:string|null,cookieToken?:string|null):Promise<TapOutcome>{
 if(!TAG.test(tagId)||!e||!m)return {kind:'invalid'};
 let sun;try{sun=verifySun(deriveTagKeys(deps.masterKey,tagId),e,m);}catch(err){if(err instanceof SunError)return {kind:'invalid'};throw err;}
 const tap=(await deps.db.query<{merchant_id:string;device_id:string;session_id:string}>('SELECT merchant_id,device_id,session_id FROM bitpos.meta_record_tap($1,$2,$3,$4)',[tagId,sun.uid,sun.counter,sha(token())])).rows[0];
 if(!tap)return {kind:'replayed'};
 return afterTap(deps,tap,cookieToken);
}

/** A BitPOS Mini asks for a short-lived "scan to open Messenger" link (device key already checked by the route). */
export async function issueDeviceQr(deps:IdentityDeps,deviceId:string):Promise<{url:string;expiresAt:string}|null>{
 const t=token();
 const at=(await deps.db.query<{e:Date|null}>('SELECT bitpos.meta_issue_device_qr($1,$2) AS e',[deviceId,sha(t)])).rows[0]?.e;
 return at?{url:`${deps.publicOrigin}/meta/q/${t}`,expiresAt:at.toISOString()}:null;
}
/** Opening a device QR link: a tap session for that device (like an NFC tap), then the same Messenger flow. */
export async function handleQrTap(deps:IdentityDeps,qrToken:string,cookieToken?:string|null):Promise<TapOutcome>{
 if(!TOKEN.test(qrToken))return {kind:'invalid'};
 const tap=(await deps.db.query<{merchant_id:string;device_id:string;session_id:string}>('SELECT merchant_id,device_id,session_id FROM bitpos.meta_record_qr($1,$2)',[sha(qrToken),sha(token())])).rows[0];
 if(!tap)return {kind:'replayed'};
 return afterTap(deps,tap,cookieToken);
}

async function afterTap(deps:IdentityDeps,tap:{merchant_id:string;device_id:string;session_id:string},cookieToken?:string|null):Promise<TapOutcome>{
 const merchantId=tap.merchant_id,tapSessionId=tap.session_id;
 const reserved=(h:TableHold,url:string|null)=>({kind:'reserved',merchantId,tableLabel:h.tableLabel,checkInUntil:h.checkInUntil.toISOString(),status:h.status,url} as const);
 if(cookieToken&&TOKEN.test(cookieToken)){
  const owner=(await deps.db.query<{m:string|null}>('SELECT bitpos.meta_session_merchant($1) AS m',[sha(cookieToken)])).rows[0]?.m;
  if(owner===merchantId){
   const r=await deps.db.tenant(merchantId,async db=>{
    const link=await activeLinkForSession(db,cookieToken);if(!link)return null;
    // A table held by another customer's booking refuses this tap; the booker checks in with it.
    const hold=await holdForDevice(db,tap.device_id);
    if(hold&&hold.linkId!==link)return {blocked:hold};
    if(!(await db.query("UPDATE meta_tap_sessions SET link_id=$2,bound_at=clock_timestamp(),claimed_at=clock_timestamp() WHERE id=$1 AND link_id IS NULL AND claimed_at IS NULL AND expires_at>clock_timestamp()",[tapSessionId,link])).rowCount)return null;
    const justNow=hold?await checkIn(db,hold,tapSessionId):false;
    return {link,checkedIn:hold?{tableLabel:hold.tableLabel,startsAt:hold.startsAt.toISOString(),justNow}:undefined};
   });
   if(r&&'blocked' in r&&r.blocked)return reserved(r.blocked,null);
   if(r)return {kind:'known',merchantId,tapSessionId,deviceId:tap.device_id,linkId:r.link,...(r.checkedIn?{checkedIn:r.checkedIn}:{})};
  }
 }
 return deps.db.tenant(merchantId,async db=>{
  const page=(await db.query<{page_username:string}>('SELECT page_username FROM meta_messenger_pages WHERE retired_at IS NULL')).rows[0];
  const hold=await holdForDevice(db,tap.device_id);
  if(!page)return hold?reserved(hold,null):{kind:'no_page',merchantId} as const;
  const ref=randomBytes(24).toString('base64url');
  await db.query("WITH n AS (SELECT clock_timestamp() AS t) INSERT INTO meta_messenger_refs(merchant_id,tap_session_id,ref_sha256,created_at,expires_at) SELECT $1,$2,$3,t,t+interval '10 minutes' FROM n",[merchantId,tapSessionId,sha(ref)]);
  const url=`https://m.me/${page.page_username}?ref=${ref}`;
  // Unknown phone at a held table: refused here; the booker can prove who they are in Messenger.
  if(hold)return reserved(hold,url);
  return {kind:'messenger',merchantId,tapSessionId,url} as const;
 });
}

async function activeLinkForSession(db:pg.PoolClient,cookieToken:string):Promise<string|null>{
 return (await db.query<{link_id:string}>('SELECT s.link_id FROM meta_customer_sessions s JOIN meta_customer_links l ON l.merchant_id=s.merchant_id AND l.id=s.link_id WHERE s.token_sha256=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND l.revoked_at IS NULL',[sha(cookieToken)])).rows[0]?.link_id??null;
}

async function tableHoldForTap(db:pg.PoolClient,tapSessionId:string):Promise<TableHold|null>{
 const d=(await db.query<{device_id:string}>('SELECT device_id FROM meta_tap_sessions WHERE id=$1',[tapSessionId])).rows[0];
 return d?holdForDevice(db,d.device_id):null;
}
async function bindTap(db:pg.PoolClient,tapSessionId:string|null,linkId:string):Promise<boolean>{
 if(!tapSessionId)return false;
 return (await db.query("UPDATE meta_tap_sessions SET link_id=$2,bound_at=clock_timestamp() WHERE id=$1 AND link_id IS NULL AND created_at>clock_timestamp()-interval '15 minutes'",[tapSessionId,linkId])).rowCount===1;
}

async function magicLink(deps:IdentityDeps,db:pg.PoolClient,merchantId:string,linkId:string,tapSessionId:string|null):Promise<string>{
 const t=token();
 await db.query("WITH n AS (SELECT clock_timestamp() AS t) INSERT INTO meta_magic_links(merchant_id,link_id,tap_session_id,token_sha256,created_at,expires_at) SELECT $1,$2,$3,$4,t,t+interval '10 minutes' FROM n",[merchantId,linkId,tapSessionId,sha(t)]);
 return `${deps.publicOrigin}/meta/login?t=${t}`;
}

/** Get Started for someone the shop does not know yet: how to connect, or order on the web without connecting. */
function guestWelcome(origin:string,psid:string):Outgoing{
 const img=(n:string)=>`${origin}/meta/images/menu/${n}.jpg`;
 return {kind:'cards',psid,cards:[
  {title:'สวัสดีค่ะ ยินดีต้อนรับสู่ Muse Café ☕',subtitle:'แตะมือถือที่เครื่อง BitPOS Mini บนโต๊ะ แล้วกดยินยอม เพื่อสั่ง จองโต๊ะ และรับโปรในแชท',imageUrl:img('latte'),buttons:[{type:'web_url',title:'วิธีเชื่อมต่อ / How',url:`${origin}/help#tap`}]},
  {title:'สั่งบนเว็บได้เลย ไม่ต้องเชื่อมต่อ',subtitle:'ดูเมนู ใส่ตะกร้า จ่ายด้วย Stripe (sandbox ไม่ใช่เงินจริง)',imageUrl:img('croissant'),buttons:[{type:'web_url',title:'ดูเมนู / Menu',url:`${origin}/menu`}]},
  {title:'ร้านเก็บอะไรบ้าง',subtitle:'ร้านเก็บแค่รหัสแชทนี้หลังคุณยินยอม ไม่เก็บข้อความ เลิกเชื่อมต่อได้ทุกเมื่อ',imageUrl:img('matcha'),buttons:[{type:'web_url',title:'ความเป็นส่วนตัว',url:`${origin}/help`}]}]};
}
const T={
 consent:'สวัสดีค่ะ ให้ร้านจำคุณไว้เพื่อเสนอโปรที่ตรงใจและทักทายเมื่อแตะที่เครื่องไหม? ร้านเก็บแค่รหัสแชทนี้กับประวัติการซื้อที่ร้าน ลบได้ทุกเมื่อโดยพิมพ์ "ลบข้อมูล"\nLet this shop remember you for personal offers when you tap? Only this chat id and your purchases here are kept. Type STOP anytime.',
 welcome:'ยินดีต้อนรับค่ะ ร้านจำคุณได้แล้ว ครั้งหน้าแค่แตะที่เครื่อง\nWelcome! Next time, just tap.',
 back:'ยินดีต้อนรับกลับค่ะ 👋\nWelcome back!',
 declined:'รับทราบค่ะ ร้านจะไม่จำข้อมูลของคุณ\nOK, the shop will not remember you.',
 expired:'ลิงก์หมดอายุแล้ว กรุณาแตะที่เครื่องอีกครั้ง\nThis link expired. Please tap again.',
 revoked:'ลบการเชื่อมต่อกับร้านแล้วค่ะ\nYou are disconnected from this shop.',
 tableHeld:(h:TableHold)=>`โต๊ะ ${h.tableLabel} มีคนจองไว้ค่ะ ใช้โต๊ะอื่นได้เลย\nTable ${h.tableLabel} is reserved; please use another table.`,
 checkedIn:(h:TableHold)=>`เช็กอินโต๊ะ ${h.tableLabel} แล้วค่ะ ยินดีต้อนรับ 🙏\nChecked in at table ${h.tableLabel}. Welcome!`,
 notLinked:'สั่งผ่านแชทได้หลังเชื่อมต่อกับร้าน แตะมือถือที่เครื่องในร้านเพื่อเริ่มค่ะ\nTo order by chat, connect first: tap your phone on the device in the shop.',
};
const openButton=(url:string)=>({type:'web_url' as const,title:'เปิดหน้าร้าน / Open',url});

/** A customer just became known at a tap: the caller picks and sends an offer after commit. */
export interface OfferRequest {merchantId:string;linkId:string;tapSessionId:string;psid:string}
/** A consented customer wrote to the shop or pressed Pay: handled by the ordering agent after commit. */
export type AgentRequest={merchantId:string;linkId:string;psid:string}&({kind:'text';text:string}|{kind:'agent_pay';quoteId:string}|{kind:'agent_add';productId:string}|{kind:'menu'}|{kind:'my_orders'}|{kind:'welcome'}|{kind:'suggest'}|{kind:'photo';url:string}|{kind:'book_start'}|{kind:'book_set';date:string|null;time:string|null}|{kind:'book_cancel';reservationId:string;confirmed:boolean}|{kind:'cart_add';cart:string}|{kind:'cart_pay';cart:string}|{kind:'cart_menu';cart:string}|{kind:'autopay';autopay:import('./messenger').AutopayAction});

/** Applies verified webhook events. Returns messages and offer requests to handle after the transactions commit. */
export async function handleMessengerEvents(deps:IdentityDeps,events:ParsedEvent[]):Promise<{outbox:Outgoing[];offers:OfferRequest[];agent:AgentRequest[]}>{
 const out:Outgoing[]=[],offers:OfferRequest[]=[],agent:AgentRequest[]=[];
 for(const {event,key} of events){
  const merchantId=(await deps.db.query<{m:string|null}>('SELECT bitpos.meta_page_merchant($1) AS m',[event.pageId])).rows[0]?.m;
  if(!merchantId)continue;
  const reply=await deps.db.tenant(merchantId,async db=>{
   if(!(await db.query('INSERT INTO meta_messenger_events(merchant_id,event_sha256) VALUES($1,$2) ON CONFLICT DO NOTHING',[merchantId,key])).rowCount)return null;
   const {pageId,psid}=event;
   if(event.kind==='revoke'){
    const links=(await db.query<{id:string}>('UPDATE meta_customer_links SET revoked_at=clock_timestamp() WHERE page_id=$1 AND psid=$2 AND revoked_at IS NULL RETURNING id',[pageId,psid])).rows;
    if(links.length)await db.query('UPDATE meta_customer_sessions SET revoked_at=clock_timestamp() WHERE link_id=ANY($1::uuid[]) AND revoked_at IS NULL',[links.map(l=>l.id)]);
    return {kind:'text',psid,text:T.revoked} as Outgoing;
   }
   if(event.kind==='text'||event.kind==='agent_pay'||event.kind==='agent_add'||event.kind==='menu'||event.kind==='my_orders'||event.kind==='welcome'||event.kind==='suggest'||event.kind==='photo'||event.kind==='book_start'||event.kind==='book_set'||event.kind==='book_cancel'||event.kind==='cart_add'||event.kind==='cart_pay'||event.kind==='cart_menu'||event.kind==='autopay'){
    // Only a customer who consented in Messenger can order by chat; nobody else's text reaches a model.
    const link=(await db.query<{id:string}>('SELECT id FROM meta_customer_links WHERE page_id=$1 AND psid=$2 AND revoked_at IS NULL',[pageId,psid])).rows[0];
    if(!link)return event.kind==='welcome'?guestWelcome(deps.publicOrigin,psid):{kind:'text',psid,text:T.notLinked} as Outgoing;
    const who={merchantId,linkId:link.id,psid};
    agent.push(event.kind==='text'?{...who,kind:'text',text:event.text}:event.kind==='agent_pay'?{...who,kind:'agent_pay',quoteId:event.quoteId}:event.kind==='agent_add'?{...who,kind:'agent_add',productId:event.productId}:event.kind==='menu'?{...who,kind:'menu'}:event.kind==='my_orders'?{...who,kind:'my_orders'}:event.kind==='welcome'?{...who,kind:'welcome'}:event.kind==='suggest'?{...who,kind:'suggest'}:event.kind==='photo'?{...who,kind:'photo',url:event.url}:event.kind==='book_start'?{...who,kind:'book_start'}
     :event.kind==='autopay'?{...who,kind:'autopay',autopay:event.autopay}:event.kind==='book_set'?{...who,kind:'book_set',date:event.date,time:event.time}:event.kind==='book_cancel'?{...who,kind:'book_cancel',reservationId:event.reservationId,confirmed:event.confirmed}:{...who,kind:event.kind,cart:event.cart});
    return null;
   }
   if(event.kind==='referral'){
    if(!REF.test(event.ref))return null;
    const tap=(await db.query<{tap_session_id:string}>('UPDATE meta_messenger_refs SET consumed_at=clock_timestamp(),consumed_psid=$2 WHERE ref_sha256=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING tap_session_id',[sha(event.ref),psid])).rows[0];
    if(!tap)return {kind:'text',psid,text:T.expired} as Outgoing;
    const link=(await db.query<{id:string}>('SELECT id FROM meta_customer_links WHERE page_id=$1 AND psid=$2 AND revoked_at IS NULL',[pageId,psid])).rows[0];
    if(link){
     const held=await tableHoldForTap(db,tap.tap_session_id);
     if(held&&held.linkId!==link.id)return {kind:'text',psid,text:T.tableHeld(held)} as Outgoing;
     if(await bindTap(db,tap.tap_session_id,link.id)){
      if(held&&await checkIn(db,held,tap.tap_session_id))return {kind:'text',psid,text:T.checkedIn(held)} as Outgoing;
      offers.push({merchantId,linkId:link.id,tapSessionId:tap.tap_session_id,psid});
     }return {kind:'buttons',psid,text:T.back,buttons:[openButton(await magicLink(deps,db,merchantId,link.id,tap.tap_session_id))]} as Outgoing;}
    const request=(await db.query<{id:string}>("WITH n AS (SELECT clock_timestamp() AS t) INSERT INTO meta_consent_requests(merchant_id,page_id,psid,tap_session_id,created_at,expires_at) SELECT $1,$2,$3,$4,t,t+interval '15 minutes' FROM n RETURNING id",[merchantId,pageId,psid,tap.tap_session_id])).rows[0];
    return {kind:'buttons',psid,text:T.consent,buttons:[{type:'postback',title:'ยินยอม / Allow',payload:`BITPOS_CONSENT_ACCEPT:${request.id}`},{type:'postback',title:'ไม่ / No',payload:`BITPOS_CONSENT_DECLINE:${request.id}`}]} as Outgoing;
   }
   const decided=(await db.query<{tap_session_id:string|null}>('UPDATE meta_consent_requests SET decided_at=clock_timestamp(),decision=$4 WHERE id=$1 AND page_id=$2 AND psid=$3 AND decided_at IS NULL AND expires_at>clock_timestamp() RETURNING tap_session_id',[event.requestId,pageId,psid,event.accept?'ACCEPTED':'DECLINED'])).rows[0];
   if(!decided)return {kind:'text',psid,text:T.expired} as Outgoing;
   if(!event.accept)return {kind:'text',psid,text:T.declined} as Outgoing;
   await db.query('INSERT INTO meta_customer_links(merchant_id,page_id,psid,consent_version) VALUES($1,$2,$3,$4) ON CONFLICT (merchant_id,page_id,psid) WHERE revoked_at IS NULL DO NOTHING',[merchantId,pageId,psid,CONSENT_VERSION]);
   const link=(await db.query<{id:string}>('SELECT id FROM meta_customer_links WHERE page_id=$1 AND psid=$2 AND revoked_at IS NULL',[pageId,psid])).rows[0];
   const held=decided.tap_session_id?await tableHoldForTap(db,decided.tap_session_id):null;
   if(!(held&&held.linkId!==link.id)&&await bindTap(db,decided.tap_session_id,link.id))offers.push({merchantId,linkId:link.id,tapSessionId:decided.tap_session_id!,psid});
   return {kind:'buttons',psid,text:T.welcome,buttons:[openButton(await magicLink(deps,db,merchantId,link.id,decided.tap_session_id))]} as Outgoing;
  });
  if(reply)out.push(reply);
 }
 return {outbox:out,offers,agent};
}

export interface CustomerSession {merchantId:string;sessionToken:string;linkId:string;tapSessionId:string|null}

/** Single-use sign-in link from Messenger → a 30-day web session for that shop only. */
export async function consumeMagicLink(deps:IdentityDeps,magic:string):Promise<CustomerSession|null>{
 if(!TOKEN.test(magic))return null;
 const merchantId=(await deps.db.query<{m:string|null}>('SELECT bitpos.meta_magic_merchant($1) AS m',[sha(magic)])).rows[0]?.m;
 if(!merchantId)return null;
 return deps.db.tenant(merchantId,async db=>{
  const row=(await db.query<{link_id:string;tap_session_id:string|null}>('UPDATE meta_magic_links ml SET consumed_at=clock_timestamp() FROM meta_customer_links l WHERE ml.token_sha256=$1 AND ml.consumed_at IS NULL AND ml.expires_at>clock_timestamp() AND l.merchant_id=ml.merchant_id AND l.id=ml.link_id AND l.revoked_at IS NULL RETURNING ml.link_id,ml.tap_session_id',[sha(magic)])).rows[0];
  if(!row)return null;
  const sessionToken=token();
  await db.query("WITH n AS (SELECT clock_timestamp() AS t) INSERT INTO meta_customer_sessions(merchant_id,link_id,token_sha256,created_at,expires_at) SELECT $1,$2,$3,t,t+interval '30 days' FROM n",[merchantId,row.link_id,sha(sessionToken)]);
  return {merchantId,sessionToken,linkId:row.link_id,tapSessionId:row.tap_session_id};
 });
}

export interface CustomerView {merchantId:string;linkId:string;consentedAt:string;lastTap:{tapSessionId:string;deviceId:string;boundAt:string}|null}

export async function customerFromSession(deps:IdentityDeps,sessionToken:string|null|undefined):Promise<CustomerView|null>{
 if(!sessionToken||!TOKEN.test(sessionToken))return null;
 const merchantId=(await deps.db.query<{m:string|null}>('SELECT bitpos.meta_session_merchant($1) AS m',[sha(sessionToken)])).rows[0]?.m;
 if(!merchantId)return null;
 return deps.db.tenant(merchantId,async db=>{
  const linkId=await activeLinkForSession(db,sessionToken);if(!linkId)return null;
  const link=(await db.query<{consented_at:Date}>('SELECT consented_at FROM meta_customer_links WHERE id=$1',[linkId])).rows[0];
  const tap=(await db.query<{id:string;device_id:string;bound_at:Date}>("SELECT id,device_id,bound_at FROM meta_tap_sessions WHERE link_id=$1 AND bound_at>clock_timestamp()-interval '15 minutes' ORDER BY bound_at DESC LIMIT 1",[linkId])).rows[0];
  return {merchantId,linkId,consentedAt:link.consented_at.toISOString(),lastTap:tap?{tapSessionId:tap.id,deviceId:tap.device_id,boundAt:tap.bound_at.toISOString()}:null};
 });
}

/** Customer-initiated forget from the web page: ends the link and every session of it. */
export async function revokeFromSession(deps:IdentityDeps,sessionToken:string|null|undefined):Promise<boolean>{
 const me=await customerFromSession(deps,sessionToken);if(!me)return false;
 return deps.db.tenant(me.merchantId,async db=>{
  await db.query('UPDATE meta_customer_links SET revoked_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL',[me.linkId]);
  await db.query('UPDATE meta_customer_sessions SET revoked_at=clock_timestamp() WHERE link_id=$1 AND revoked_at IS NULL',[me.linkId]);
  return true;
 });
}

export interface OfferDeps {
 /** The inherited catalog: approved product/daily offers with server prices. */
 menu:(db:pg.PoolClient,merchant:string)=>Promise<EffectiveMenu>;
 router:MetaRouter|null;deadlineMs?:number;timeZone?:string;
}
export interface OfferView {offerId:string;productId:string;imageUrl:string|null;emoji:string;name:string;nameEn:string;price:string;basePrice:string;discountPercent:number;reasonTh:string;reasonEn:string;chosenBy:'model'|'fallback'}

interface ImpressionRow {offer_id:string;product_id:string;image_url:string|null;emoji:string;name:string;name_en:string;currency:string;decimals:number;base_price_minor:string;unit_price_minor:string;reason_th:string;reason_en:string;chosen_by:'model'|'fallback'}
const IMPRESSION_SQL='SELECT i.offer_id,p.id AS product_id,p.image_url,p.emoji,p.name,p.name_en,i.currency,i.decimals,i.base_price_minor::text,i.unit_price_minor::text,i.reason_th,i.reason_en,i.chosen_by FROM meta_offer_impressions i JOIN products p ON p.merchant_id=i.merchant_id AND p.id=i.product_id WHERE i.tap_session_id=$1';
function view(r:ImpressionRow):OfferView{
 const m=(v:string)=>({currency:r.currency,decimals:r.decimals,amountMinor:v}) as Money,base=BigInt(r.base_price_minor),unit=BigInt(r.unit_price_minor);
 return {offerId:r.offer_id,productId:r.product_id,imageUrl:r.image_url,emoji:r.emoji,name:r.name,nameEn:r.name_en,price:formatMoney(m(r.unit_price_minor)),basePrice:formatMoney(m(r.base_price_minor)),discountPercent:Number((base-unit)*100n/base),reasonTh:r.reason_th,reasonEn:r.reason_en,chosenBy:r.chosen_by};
}

/**
 * One offer per tap for the customer bound to it. Three phases so no model call runs inside a
 * transaction: read menu + facts, ask Muse Spark (or fall back), then store the impression once.
 */
export async function offerForTap(deps:IdentityDeps,offers:OfferDeps,merchantId:string,linkId:string,tapSessionId:string):Promise<OfferView|null>{
 const hour=Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:offers.timeZone??'Asia/Bangkok'}).format(new Date()));
 const prep=await deps.db.tenant(merchantId,async db=>{
  if(!(await db.query('SELECT 1 FROM meta_tap_sessions WHERE id=$1 AND link_id=$2',[tapSessionId,linkId])).rowCount)return null;
  const existing=(await db.query<ImpressionRow>(IMPRESSION_SQL,[tapSessionId])).rows[0];
  if(existing)return {kind:'existing' as const,row:existing};
  const candidates=approvedOffers(await offers.menu(db,merchantId));
  const visitCount=Number((await db.query<{n:string}>('SELECT count(*)::text AS n FROM meta_tap_sessions WHERE link_id=$1',[linkId])).rows[0].n);
  const recentlyShown=(await db.query<{offer_id:string}>('SELECT offer_id FROM meta_offer_impressions WHERE link_id=$1 ORDER BY created_at DESC LIMIT 3',[linkId])).rows.map(r=>r.offer_id);
  return {kind:'new' as const,candidates,facts:{visitCount,localHour:hour,recentlyShown}};
 });
 if(!prep)return null;
 if(prep.kind==='existing')return view(prep.row);
 const choice=await selectOffer(offers.router,merchantId,prep.candidates,prep.facts,offers.deadlineMs);
 if(!choice)return null;
 return deps.db.tenant(merchantId,async db=>{
  const c=choice.candidate;
  await db.query('INSERT INTO meta_offer_impressions(merchant_id,link_id,tap_session_id,offer_id,product_id,currency,decimals,base_price_minor,unit_price_minor,candidate_count,chosen_by,invocation_id,reason_th,reason_en) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (merchant_id,tap_session_id) DO NOTHING',
   [merchantId,linkId,tapSessionId,c.offerId,c.productId,c.unitPrice.currency,c.unitPrice.decimals,c.basePrice.amountMinor,c.unitPrice.amountMinor,prep.candidates.length,choice.chosenBy,choice.invocationId,choice.reasonTh,choice.reasonEn]);
  const row=(await db.query<ImpressionRow>(IMPRESSION_SQL,[tapSessionId])).rows[0];
  return row?view(row):null;
 });
}

/** The offer as a card with its photo: add it to the chat cart (the server prices it with the approved offer) or see the menu. */
export function offerMessage(psid:string,o:OfferView,publicOrigin?:string):Outgoing{
 const text=`${o.emoji} โปรสำหรับคุณ: ${o.name} ${o.price} (ปกติ ${o.basePrice})\n${o.reasonTh}\n\n${o.emoji} For you: ${o.nameEn} ${o.price} (was ${o.basePrice})\n${o.reasonEn}`;
 if(!publicOrigin||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(o.productId))return {kind:'text',psid,text};
 const image=o.imageUrl?.startsWith('/images/')?`${publicOrigin}/meta${o.imageUrl}`:o.imageUrl?.startsWith('https://')?o.imageUrl:undefined;
 return {kind:'cards',psid,quick:QUICK_START,cards:[{title:`${o.emoji} โปรสำหรับคุณ: ${o.name} ${o.price} (ปกติ ${o.basePrice})`,subtitle:`ลด ${o.discountPercent}% · ${o.reasonTh} · ${o.reasonEn}`,imageUrl:image,
  buttons:[{type:'postback',title:'ใส่ตะกร้า / Add',payload:`BITPOS_CART_ADD:${o.productId}:1`},{type:'postback',title:'ดูเมนู / Menu',payload:'BITPOS_MENU'}]}]};
}
/** Same chips as the chat agent (agent.ts QUICK), kept here to avoid an import cycle. */
const QUICK_START=[{title:'เมนู',payload:'BITPOS_MENU'},{title:'ออเดอร์ของฉัน',payload:'BITPOS_MY_ORDERS'},{title:'จองโต๊ะ',payload:'BITPOS_BOOK'}];
