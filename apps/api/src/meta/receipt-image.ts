// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// The paid receipt as a picture for Messenger (design C10): shop, pickup code, lines with menu photos, discount,
// total and the Stripe sandbox label. The facts come from the same server rows as the receipt template; the image
// is drawn as SVG and rasterised with resvg using the repository's Sarabun font (no system fonts needed).
// Messenger fetches it by URL, so the URL carries an HMAC of the order id; no customer identity is on the image.
import {createHmac,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import type {Receipt} from './messenger';

export function receiptImageKey(masterKey:Buffer,orderId:string):string{
 return createHmac('sha256',masterKey).update(`bitpos-meta-receipt:${orderId}`).digest('base64url').slice(0,32);
}
export function receiptImageKeyValid(masterKey:Buffer,orderId:string,key:string|null):boolean{
 if(!key||!/^[A-Za-z0-9_-]{32}$/.test(key))return false;
 return timingSafeEqual(Buffer.from(key),Buffer.from(receiptImageKey(masterKey,orderId)));
}
export const receiptImageUrl=(origin:string,masterKey:Buffer,orderId:string)=>`${origin}/meta/receipt/${orderId}.png?k=${receiptImageKey(masterKey,orderId)}`;

const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../../../..');
const FONTS=['apps/web/public/fonts/bitpos-sarabun-regular.ttf','apps/web/public/fonts/bitpos-sarabun-semibold.ttf'].map(f=>path.join(ROOT,f));
const x=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Sarabun covers Thai and Latin; emoji and other symbols would render as boxes. */
const glyphs=(s:string)=>s.replace(/×/g,'x').replace(/[^\x20-\x7e\u00a0-\u00ff\u0e00-\u0e7f\u2013\u2014\u2212]/g,'').replace(/\s+/g,' ').trim();
const cut=(s:string,n:number)=>s.length<=n?s:s.slice(0,n-1)+'…';
const money=(n:number,cur:string)=>`${cur==='USD'?'$':cur==='THB'?'฿':cur+' '}${n.toFixed(2)}`;

/** A menu photo the shop serves from /meta/images/menu/, read from disk and embedded; anything else is skipped. */
async function photo(url:string|undefined):Promise<string|null>{
 const m=url?.match(/\/meta\/images\/menu\/([a-z0-9-]{1,60})\.jpg$/);
 if(!m)return null;
 try{return `data:image/jpeg;base64,${(await readFile(path.join(ROOT,'apps/web/public/images/menu',`${m[1]}.jpg`))).toString('base64')}`;}catch{return null;}
}

export interface ReceiptPicture {shop:string;code:string;receipt:Receipt}
export async function receiptSvg(p:ReceiptPicture):Promise<string>{
 const r=p.receipt,W=720,rowH=112,top=300,n=r.elements.length;
 const H=top+n*rowH+(r.discount?60:0)+250;
 const when=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'}).format(new Date(r.timestamp*1000));
 const rows=(await Promise.all(r.elements.map(async(e,i)=>{
  const y=top+i*rowH,img=await photo(e.imageUrl);
  return `${img?`<clipPath id="c${i}"><rect x="56" y="${y}" width="88" height="88" rx="18"/></clipPath><image href="${img}" x="56" y="${y}" width="88" height="88" preserveAspectRatio="xMidYMid slice" clip-path="url(#c${i})"/>`
   :`<rect x="56" y="${y}" width="88" height="88" rx="18" fill="#E7F0FF"/>`}
<text x="168" y="${y+38}" font-size="28" font-weight="600" fill="#1C2B33">${x(cut(glyphs(e.title),30))}</text>
<text x="168" y="${y+74}" font-size="22" fill="#65676B">${x(money(e.price,e.currency))} x ${e.quantity}</text>
<text x="${W-56}" y="${y+54}" font-size="28" font-weight="600" fill="#1C2B33" text-anchor="end">${x(money(e.price*e.quantity,e.currency))}</text>`;}))).join('');
 let y=top+n*rowH+10;
 const disc=r.discount?`<text x="56" y="${y+30}" font-size="24" fill="#65676B">ส่วนลดที่ร้านอนุมัติ</text><text x="${W-56}" y="${y+30}" font-size="24" fill="#1E8E3E" text-anchor="end">−${x(money(r.discount,r.currency))}</text>`:'';
 if(r.discount)y+=60;
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Sarabun">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0866FF"/><stop offset="1" stop-color="#7A3FF2"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="#F0F2F5"/><rect x="24" y="24" width="${W-48}" height="${H-48}" rx="36" fill="#FFFFFF"/>
<rect x="24" y="24" width="${W-48}" height="190" rx="36" fill="url(#g)"/><rect x="24" y="180" width="${W-48}" height="34" fill="url(#g)"/>
<text x="56" y="88" font-size="30" font-weight="600" fill="#FFFFFF">${x(cut(glyphs(p.shop),34))}</text>
<text x="56" y="128" font-size="22" fill="#FFFFFF" opacity=".9">จ่ายแล้ว · ${x(when)}</text>
<text x="${W-56}" y="112" font-size="22" fill="#FFFFFF" text-anchor="end" opacity=".9">รหัสรับสินค้า</text>
<text x="${W-56}" y="172" font-size="64" font-weight="600" fill="#FFFFFF" text-anchor="end">#${x(p.code)}</text>
<text x="56" y="268" font-size="22" fill="#65676B">รายการ</text>
${rows}${disc}
<line x1="56" y1="${y+10}" x2="${W-56}" y2="${y+10}" stroke="#DADDE1" stroke-width="2"/>
<text x="56" y="${y+62}" font-size="32" font-weight="600" fill="#1C2B33">รวม</text>
<text x="${W-56}" y="${y+62}" font-size="40" font-weight="600" fill="#0866FF" text-anchor="end">${x(money(r.total,r.currency))}</text>
<rect x="56" y="${y+96}" width="${W-112}" height="56" rx="16" fill="#E6F4EA"/>
<text x="${W/2}" y="${y+133}" font-size="22" fill="#1E8E3E" text-anchor="middle">รับที่เคาน์เตอร์ · แสดงรหัสนี้กับพนักงาน</text>
<text x="${W/2}" y="${y+190}" font-size="18" fill="#65676B" text-anchor="middle">Stripe sandbox · ไม่ใช่เงินจริง · ยืนยันโดยเซิร์ฟเวอร์ของร้าน</text>
</svg>`;
}

type Resvg={Resvg:new(svg:string,o:unknown)=>{render():{asPng():Buffer}}};
let lib:Promise<Resvg|null>|null=null;
/** resvg is in the Meta image (infra/meta/Dockerfile); META_RESVG_MODULE points elsewhere for local runs. */
const load=()=>lib??=import(process.env.META_RESVG_MODULE??'@resvg/resvg-js').then(m=>(m.default??m) as Resvg).catch(()=>null);
export async function receiptAvailable():Promise<boolean>{return !!(await load());}
/** The PNG, or null when the renderer is not installed (the caller falls back to the receipt template). */
export async function receiptPng(p:ReceiptPicture):Promise<Buffer|null>{
 const R=await load();if(!R)return null;
 return new R.Resvg(await receiptSvg(p),{font:{fontFiles:FONTS,loadSystemFonts:false,defaultFontFamily:'Sarabun'},fitTo:{mode:'width',value:720}}).render().asPng();
}
