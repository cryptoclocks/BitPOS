// Meta hackathon work (2026-10-26..11-05). See meta-hackathon/PROVENANCE.md.
// The picture on the Messenger card sent after a tap: shop and table over a background made once with Muse Image
// (AI-generated artwork, not a photo of the shop). No customer data on it. Messenger fetches it by URL, so the URL
// carries an HMAC of its text and cannot be used to render anything else.
import {createHmac,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {glyphs,renderPng} from './receipt-image';

export type TableCardKind='welcome'|'checked-in';
const sign=(masterKey:Buffer,kind:string,shop:string,table:string)=>createHmac('sha256',masterKey).update(`bitpos-meta-table-card:${kind}\0${shop}\0${table}`).digest('base64url').slice(0,32);
export const tableCardUrl=(origin:string,masterKey:Buffer,kind:TableCardKind,shop:string,table:string)=>
 `${origin}/meta/card/${kind}.png?${new URLSearchParams({s:shop,t:table,k:sign(masterKey,kind,shop,table)})}`;
export function tableCardKeyValid(masterKey:Buffer,kind:string,shop:string,table:string,key:string|null):boolean{
 const want=Buffer.from(sign(masterKey,kind,shop,table)),got=Buffer.from(key??'');
 return want.length===got.length&&timingSafeEqual(want,got);
}
/** "Table 1" reads as "โต๊ะ 1" in Thai; any other label is kept as it is. */
export const tableNumber=(label:string)=>label.replace(/^table\s+/i,'');
const x=(s:string)=>glyphs(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const BG=new URL('../../../web/public/images/menu/table-card-bg.jpg',import.meta.url);

export async function tableCardSvg(kind:TableCardKind,shop:string,table:string):Promise<string>{
 const bg=(await readFile(BG)).toString('base64'),n=x(tableNumber(table)).slice(0,12),on=kind==='checked-in',GOLD='#E8C48A';
 return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720" font-family="Sarabun">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#120A05" stop-opacity=".82"/><stop offset=".62" stop-color="#120A05" stop-opacity=".42"/><stop offset="1" stop-color="#120A05" stop-opacity=".08"/></linearGradient></defs>
<image href="data:image/jpeg;base64,${bg}" width="720" height="720" preserveAspectRatio="xMidYMid slice"/>
<rect width="720" height="720" fill="url(#g)"/>
<rect x="28" y="28" width="664" height="664" rx="10" fill="none" stroke="${GOLD}" stroke-opacity=".55" stroke-width="2"/>
<text x="72" y="118" font-size="32" font-weight="600" letter-spacing="5" fill="${GOLD}">${x(shop.toUpperCase()).slice(0,28)}</text>
<line x1="72" y1="144" x2="168" y2="144" stroke="${GOLD}" stroke-width="3"/>
<text x="72" y="282" font-size="104" font-weight="600" fill="#FFFFFF">โต๊ะ ${n}</text>
<text x="74" y="340" font-size="38" fill="#F3E6D4">Table ${n}</text>
<text x="74" y="412" font-size="30" fill="#F3E6D4">${on?'เช็กอินเรียบร้อย · Checked in':'ยินดีต้อนรับ · Welcome'}</text>
</svg>`;
}
export async function tableCardPng(kind:TableCardKind,shop:string,table:string):Promise<Buffer|null>{
 return renderPng(await tableCardSvg(kind,shop,table),720);
}
