// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Screens for the BitPOS Mini Meta product (device/firmware/main/bitpos_meta.c, design/figcraft-meta B01–B11).
// GET /meta/device/state?d=<device id> with "Authorization: Bearer <device key>". The key is derived from the tap
// master key and the device id, so the server stores nothing extra. The answer describes one template: tone,
// title, lines, a big value, an optional Stripe QR link and an optional countdown. No personal data, no prices
// beyond the bill total, nothing that marks anything paid. On the idle and welcome screens `anim` may name a looping
// offer animation (a same-origin path to a 240 px GIF, routes.ts /meta/anim) that the device plays with LVGL.
import {createHmac,timingSafeEqual} from 'node:crypto';
import type {MetaDb} from './identity';
import {tableScreen} from './reservations';
import {cartCode} from './cart';
import {formatTapAmount} from './staff';

export function deviceKey(masterKey:Buffer,deviceId:string):string{
 return createHmac('sha256',masterKey).update(`bitpos-meta-device:${deviceId}`).digest('base64url').slice(0,43);
}
export function deviceKeyValid(masterKey:Buffer,deviceId:string,authorization:string|undefined):boolean{
 const key=authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
 return !!key&&timingSafeEqual(Buffer.from(key),Buffer.from(deviceKey(masterKey,deviceId)));
}

export interface DeviceView {v:1;screen:string;tone:'white'|'green'|'red'|'violet'|'blue'|'amber';table:string;title:string;line1:string;line2:string;big:string;qr:string;anim:string;countdown_s:number;poll_ms:number}
/** Picks the offer animation for a screen: the tapped customer's offer (productId) or the shop's live offer; '' for none. */
export type AnimFor=(merchantId:string,productId:string|null)=>Promise<string>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hhmm=(d:string|Date)=>new Date(d).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'});

/** The device font has ASCII and Thai only: map the few other symbols we use, drop the rest. */
const glyphs=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/×/g,'x').replace(/·/g,'-').replace(/✓/g,'').replace(/[^\x20-\x7e\u0e00-\u0e7f]/g,'').replace(/\s+/g,' ').trim();
/** What device `deviceId` should show now, or null when it is not an active device. */
export async function deviceView(db:MetaDb,deviceId:string,publicOrigin:string,animFor?:AnimFor):Promise<DeviceView|null>{
 const v=await view(db,deviceId,publicOrigin,animFor);
 return v&&{...v,anim:/^\/meta\/anim\/(offer|combo)\/[0-9a-f-]{36}\/240(-[0-9a-f]{8})?\.gif$/.test(v.anim)?v.anim:'',table:glyphs(v.table),title:glyphs(v.title),line1:glyphs(v.line1),line2:glyphs(v.line2),big:glyphs(v.big)};
}
async function view(db:MetaDb,deviceId:string,publicOrigin:string,animFor?:AnimFor):Promise<DeviceView|null>{
 if(!UUID.test(deviceId))return null;
 const merchantId=(await db.query<{m:string|null}>('SELECT bitpos.meta_device_merchant($1) AS m',[deviceId])).rows[0]?.m;
 if(!merchantId)return null;
 const base=(table:string):DeviceView=>({v:1,screen:'idle',tone:'white',table,title:'',line1:'',line2:'',big:'',qr:'',anim:'',countdown_s:0,poll_ms:2000});
 const r=await db.tenant(merchantId,async c=>{
  const dev=(await c.query<{label:string|null;shop:string}>('SELECT t.label,m.name AS shop FROM devices d JOIN merchants m ON m.id=d.merchant_id LEFT JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id WHERE d.id=$1',[deviceId])).rows[0];
  const bill=(await c.query<{id:string;status:string;amount_minor:string;currency:string;paid_recent:boolean;items:string}>(
   `SELECT o.id,o.status,o.amount_minor::text,o.currency,(o.status='PAID' AND o.paid_at>clock_timestamp()-interval '20 seconds') AS paid_recent,
     (SELECT string_agg(i.name||' × '||i.quantity,', ' ORDER BY i.line) FROM meta_cart_items i WHERE i.order_id=o.id) AS items
    FROM meta_cart_orders o WHERE o.device_id=$1 AND ((o.status='PENDING' AND o.expires_at>clock_timestamp()) OR (o.status='PAID' AND o.paid_at>clock_timestamp()-interval '20 seconds'))
    ORDER BY o.created_at DESC LIMIT 1`,[deviceId])).rows[0];
  const tapPaid=(await c.query<{id:string}>(`SELECT o.id FROM meta_tap_orders o JOIN meta_tap_sessions s ON s.merchant_id=o.merchant_id AND s.id=o.tap_session_id
    WHERE s.device_id=$1 AND o.status='PAID' AND o.paid_at>clock_timestamp()-interval '20 seconds' ORDER BY o.paid_at DESC LIMIT 1`,[deviceId])).rows[0];
  const tap=(await c.query<{known:boolean;product_id:string|null}>(`SELECT link_id IS NOT NULL AS known,(SELECT i.product_id FROM meta_offer_impressions i WHERE i.merchant_id=s.merchant_id AND i.tap_session_id=s.id) AS product_id FROM meta_tap_sessions s WHERE device_id=$1 AND created_at>clock_timestamp()-interval '15 seconds' ORDER BY created_at DESC LIMIT 1`,[deviceId])).rows[0];
  return {dev,bill,tapPaid,tap};
 });
 const v=base(r.dev?.label??'');
 const anim=async(productId:string|null)=>animFor?(await animFor(merchantId,productId).catch(()=>'')).slice(0,120):'';
 if(r.bill&&r.bill.paid_recent||r.tapPaid){const id=r.bill?.paid_recent?r.bill.id:r.tapPaid!.id;return {...v,screen:'paid',tone:'green',title:'จ่ายแล้ว ✓ · ขอบคุณค่ะ',big:`#${cartCode(id)}`,line1:'รหัสรับสินค้า · Stripe ยืนยันแล้ว',poll_ms:3000};}
 if(r.bill?.status==='PENDING')return {...v,screen:'pay_qr',title:'สแกนเพื่อจ่าย',big:formatTapAmount(r.bill.amount_minor,r.bill.currency),line1:r.bill.items??'',line2:'Stripe sandbox · ไม่ใช่เงินจริง',qr:`${publicOrigin}/pay/${r.bill.id}`,poll_ms:1500};
 if(r.tap)return r.tap.known?{...v,screen:'welcome',tone:'blue',title:'สวัสดีค่ะ ร้านจำคุณได้',line1:'ส่งโปรนี้ไปที่ Messenger แล้ว',line2:'ดูบนมือถือ',anim:await anim(r.tap.product_id)}
  :{...v,screen:'tap_new',title:'ไปต่อในมือถือนะคะ',line1:'กดยินยอมใน Messenger เพื่อให้ร้านจำคุณได้',line2:'ไม่ยินยอมก็สั่งจาก QR บนโต๊ะได้'};
 const t=await tableScreen(db,merchantId,deviceId);
 if(t){
  const left=(iso:string|null)=>iso?Math.max(0,Math.round((Date.parse(iso)-Date.parse(t.now))/1000)):0;
  if(t.state==='check_in')return {...v,screen:'check_in',tone:'red',title:'รอผู้จองเช็กอิน · แตะเพื่อเช็กอิน',line1:`${t.partySize} คน · ${hhmm(t.startsAt!)} · ไม่มาภายใน ${hhmm(t.checkInUntil!)} โต๊ะจะว่าง`,countdown_s:left(t.checkInUntil)};
  if(t.state==='upcoming')return {...v,screen:'upcoming',tone:'violet',title:`จองไว้ ${hhmm(t.startsAt!)} · ${t.partySize} คน`,line1:`เช็กอินได้ตั้งแต่ ${hhmm(t.checkInFrom!)}`,countdown_s:left(t.checkInFrom)};
  if(t.state==='seated')return {...v,screen:'seated',tone:'blue',title:'เช็กอินแล้ว ✓ ยินดีต้อนรับ',line1:`โต๊ะนี้ของคุณถึง ${hhmm(t.seatedUntil!)}`,line2:'สั่งจากมือถือหรือสแกน QR บนโต๊ะ'};
 }
 const idle=await anim(null);
 // With an animation the device shows a short card beside it; its button opens the Messenger QR.
 return idle?{...v,title:r.dev?.shop??'BitPOS × Muse',line1:'แตะมือถือที่เครื่อง หรือกดสแกน QR',line2:'',anim:idle,poll_ms:4000}
  :{...v,title:r.dev?.shop??'BitPOS × Muse',line1:'แตะมือถือที่เครื่อง หรือกดปุ่มสแกน QR เข้า Messenger',line2:'รับโปร สั่ง และจ่ายด้วย Stripe ในแชท'};
}
