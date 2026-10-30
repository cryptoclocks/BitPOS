// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Shop look (migration 327): the cover photo, logo, tagline and theme colour an owner or manager sets in meta-pos.
// Customer pages read it through LOOK (set once per request by withLook), so every meta-pay page gets the shop's
// colour and name without passing it around. Images are accepted only as JPEG/PNG/WebP (checked by their first
// bytes, not the browser's word) and are served from /meta/look/<merchant>/<kind>-<revision>.<ext>.
import {AsyncLocalStorage} from 'node:async_hooks';
import type {MetaDb} from './identity';

export interface ShopLook {merchantId:string;name:string;tagline:string;accent:string;accentDark:string;accentTint:string;coverUrl:string|null;logoUrl:string|null;revision:number}
export const DEFAULT_ACCENT='#0866FF';
/** Ready-made colours (all keep white text readable); any other colour must pass the same contrast check. */
export const PRESETS:[string,string,string][]=[['#0866FF','ฟ้า Meta','Meta blue'],['#6D28D9','ม่วง','Purple'],['#15803D','เขียว','Green'],['#C2410C','ส้มอิฐ','Terracotta'],
 ['#BE185D','ชมพูเข้ม','Raspberry'],['#7C4A2D','กาแฟ','Coffee'],['#1F2937','ดำถ่าน','Charcoal']];
export const LOOK=new AsyncLocalStorage<ShopLook|null>();
export const currentLook=()=>LOOK.getStore()??null;

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const rgb=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const toHex=(c:number[])=>'#'+c.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('').toUpperCase();
const lum=(hex:string)=>{const [r,g,b]=rgb(hex).map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;});return 0.2126*r+0.7152*g+0.0722*b;};
/** WCAG contrast of white text on this colour. */
export const whiteContrast=(hex:string)=>1.05/(lum(hex)+0.05);
const mix=(hex:string,to:number,t:number)=>toHex(rgb(hex).map(v=>v+(to-v)*t));

export class LookError extends Error {constructor(readonly code:'BAD_COLOUR'|'LOW_CONTRAST'|'BAD_IMAGE'|'TOO_LARGE'|'BAD_TAGLINE'){super(code);}}
/** The image type from its first bytes; anything else is refused. */
export function sniffImage(b:Buffer):'image/jpeg'|'image/png'|'image/webp'|null{
 if(b.length>3&&b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF)return 'image/jpeg';
 if(b.length>8&&b.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A])))return 'image/png';
 if(b.length>12&&b.subarray(0,4).toString('latin1')==='RIFF'&&b.subarray(8,12).toString('latin1')==='WEBP')return 'image/webp';
 return null;
}
const EXT={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'} as const;

const cache=new Map<string,{at:number;look:ShopLook}>();
export async function shopLook(db:MetaDb,merchantId:string):Promise<ShopLook>{
 const hit=cache.get(merchantId);if(hit&&Date.now()-hit.at<20_000)return hit.look;
 const r=await db.tenant(merchantId,async c=>({
  shop:(await c.query<{name:string}>('SELECT name FROM merchants WHERE id=$1',[merchantId])).rows[0]?.name??'',
  look:(await c.query<{tagline:string;accent:string;cover_mime:string|null;logo_mime:string|null;revision:number}>('SELECT tagline,accent,cover_mime,logo_mime,revision FROM meta_shop_look LIMIT 1')).rows[0]}));
 const accent=r.look?.accent??DEFAULT_ACCENT,rev=r.look?.revision??0;
 const url=(kind:'cover'|'logo',mime:string|null|undefined)=>mime?`/meta/look/${merchantId}/${kind}-${rev}.${EXT[mime as keyof typeof EXT]}`:null;
 const look={merchantId,name:r.shop,tagline:r.look?.tagline??'',accent,accentDark:mix(accent,0,0.18),accentTint:mix(accent,255,0.88),
  coverUrl:url('cover',r.look?.cover_mime),logoUrl:url('logo',r.look?.logo_mime),revision:rev};
 cache.set(merchantId,{at:Date.now(),look});return look;
}
/** Runs a customer request with the shop's look available to customerHtml (null when there is no demo shop). */
export async function withLook<T>(db:MetaDb|null,merchantId:string|null|undefined,fn:()=>Promise<T>):Promise<T>{
 const look=db&&merchantId?await shopLook(db,merchantId).catch(()=>null):null;
 return LOOK.run(look,fn);
}

export interface LookInput {tagline:string;accent:string;cover?:Buffer|null;logo?:Buffer|null}
/** Owner/manager (checked by the caller). cover/logo: a Buffer replaces, null removes, undefined keeps. */
export async function saveLook(db:MetaDb,merchantId:string,userId:string,input:LookInput):Promise<void>{
 const accent=input.accent.trim().toUpperCase(),tagline=input.tagline.replace(/\s+/g,' ').trim();
 if(!/^#[0-9A-F]{6}$/.test(accent))throw new LookError('BAD_COLOUR');
 if(whiteContrast(accent)<4.5)throw new LookError('LOW_CONTRAST');
 if(tagline.length>120)throw new LookError('BAD_TAGLINE');
 const img=(b:Buffer|null|undefined,max:number)=>{if(!b)return null;if(b.length>max)throw new LookError('TOO_LARGE');const m=sniffImage(b);if(!m||b.length<100)throw new LookError('BAD_IMAGE');return {b,m};};
 const cover=img(input.cover,3_000_000),logo=img(input.logo,1_000_000);
 await db.tenant(merchantId,async c=>{
  await c.query(`INSERT INTO meta_shop_look(merchant_id,tagline,accent,updated_by) VALUES($1,$2,$3,$4)
   ON CONFLICT (merchant_id) DO UPDATE SET tagline=EXCLUDED.tagline,accent=EXCLUDED.accent,revision=meta_shop_look.revision+1,updated_at=clock_timestamp(),updated_by=EXCLUDED.updated_by`,[merchantId,tagline,accent,userId]);
  if(input.cover!==undefined)await c.query('UPDATE meta_shop_look SET cover=$2,cover_mime=$3 WHERE merchant_id=$1',[merchantId,cover?.b??null,cover?.m??null]);
  if(input.logo!==undefined)await c.query('UPDATE meta_shop_look SET logo=$2,logo_mime=$3 WHERE merchant_id=$1',[merchantId,logo?.b??null,logo?.m??null]);
 });
 cache.delete(merchantId);
}
export async function lookImage(db:MetaDb,merchantId:string,kind:'cover'|'logo'):Promise<{mime:string;body:Buffer}|null>{
 if(!UUID.test(merchantId))return null;
 const r=(await db.tenant(merchantId,c=>c.query<{body:Buffer|null;mime:string|null}>(kind==='cover'?'SELECT cover AS body,cover_mime AS mime FROM meta_shop_look LIMIT 1':'SELECT logo AS body,logo_mime AS mime FROM meta_shop_look LIMIT 1'))).rows[0];
 return r?.body&&r.mime?{mime:r.mime,body:r.body}:null;
}
