// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Offer animations: a short looping GIF made on the server from the offer's picture (the real menu photo, an approved
// Muse Image banner, or a Muse Image-generated picture for a two-item offer). Motion: slow zoom and pan, the discount
// badge pops in and pulses, a light sweep and twinkling sparkles, the item names fade in. Frames are SVG rendered by resvg
// (Sarabun font, Thai OK) and encoded by gif.ts. A two-item offer opens with both real menu photos side by side. resvg reads PNG and JPEG only; Muse Image answers WebP, which sharp turns
// into PNG first (no sharp → no animation, and the caller falls back to the real menu photo). Sizes: 480 px for Messenger, 240 px for the BitPOS Mini screen.
import path from 'node:path';
import {encodeGif,indexFrame} from './gif';

const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../../../..');
const FONTS=['apps/web/public/fonts/bitpos-sarabun-regular.ttf','apps/web/public/fonts/bitpos-sarabun-semibold.ttf'].map(f=>path.join(ROOT,f));
type Resvg={Resvg:new(svg:string,o:unknown)=>{render():{pixels:Uint8Array;width:number;height:number}}};
let lib:Promise<Resvg|null>|null=null;
const load=()=>lib??=import(process.env.META_RESVG_MODULE??'@resvg/resvg-js').then(m=>(m.default??m) as Resvg).catch(()=>null);
type Sharp=(b:Buffer)=>{resize(w:number,h:number,o:unknown):ReturnType<Sharp>;png():{toBuffer():Promise<Buffer>}};
let sharpLib:Promise<Sharp|null>|null=null;
const loadSharp=()=>sharpLib??=import(process.env.META_SHARP_MODULE??'sharp').then(m=>{const s=(m.default??m) as Sharp&{cache?:(on:boolean)=>void};s.cache?.(false);return s;}).catch(()=>null);
/** A PNG or JPEG resvg can draw, or null. */
async function drawable(image:Buffer,mime:string,size:number):Promise<{image:Buffer;mime:string}|null>{
 if(mime==='image/png'||mime==='image/jpeg')return {image,mime};
 const sharp=await loadSharp();if(!sharp)return null;
 try{return {image:await sharp(image).resize(size,size,{fit:'cover'}).png().toBuffer(),mime:'image/png'};}catch{return null;}
}
const x=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
// resvg places ำ (sara am) badly with Sarabun; nikhahit + sara aa draws the same word correctly.
const glyphs=(s:string)=>s.replace(/\u0e33/g,'\u0e4d\u0e32').replace(/[^\x20-\x7e -ÿ฀-๿−]/g,'').replace(/\s+/g,' ').trim();

export interface AnimSpec {image:Buffer;mime:string;badge:string;title:string;subtitle:string;size:number;frames?:number;
 /** A two-item offer: both real menu photos (JPEG) side by side first, then `image` (the generated picture) when it differs. */
 photos?:[Buffer,Buffer];photoSubtitle?:string}
const ease=(t:number)=>1-Math.pow(1-t,3);
const bounce=(t:number)=>t<=0?0:t>=1?1:1-Math.pow(2,-8*t)*Math.cos(t*Math.PI*3);

export function frame(s:AnimSpec,i:number,n:number,href:string|[string,string]):string{
 const t=i/n,S=s.size,k=S/480;
 const zoom=1.04+0.10*t,dx=-14*k*t,dy=-8*k*Math.sin(t*Math.PI);
 // Two photos: each fills half, sliding gently toward the middle, with a "+" between them.
 const pic=typeof href==='string'?`<g transform="translate(${S/2+dx} ${S/2+dy}) scale(${zoom.toFixed(4)}) translate(${-S/2} ${-S/2})"><image href="${href}" width="${S}" height="${S}" preserveAspectRatio="xMidYMid slice"/></g>`
  :[0,1].map(j=>{const off=(j?-1:1)*10*k*t;return `<svg x="${j*S/2}" y="0" width="${S/2}" height="${S}"><image href="${href[j]}" x="${-S*0.25+off}" y="${-S*0.02*zoom}" width="${S}" height="${S*zoom}" preserveAspectRatio="xMidYMid slice"/></svg>`;}).join('')
   +`<rect x="${S/2-1.5*k}" width="${3*k}" height="${S}" fill="#fff"/><g transform="translate(${S/2} ${S*0.42}) scale(${(0.9+0.1*Math.sin(t*Math.PI*2)).toFixed(3)})"><circle r="${30*k}" fill="#fff"/><text y="${15*k}" font-size="${44*k}" font-weight="600" fill="#0866FF" text-anchor="middle">+</text></g>`;
 const pop=bounce(Math.min(1,t/0.35)),pulse=1+0.05*Math.sin(t*Math.PI*4)*(t>0.35?1:0),bs=pop*pulse;
 const sweep=-S*0.6+S*2.2*Math.max(0,Math.min(1,(t-0.45)/0.35));
 const fade=ease(Math.min(1,Math.max(0,(t-0.15)/0.3)));
 const stars=[[0.18,0.2,0],[0.82,0.62,0.33],[0.3,0.72,0.66],[0.62,0.16,0.5]].map(([sx,sy,ph])=>{const a=Math.max(0,Math.sin((t+ph)*Math.PI*2));const r=(7+9*a)*k;const cx=sx*S,cy=sy*S;
  return `<path d="M${cx} ${cy-r}L${cx+r*0.28} ${cy-r*0.28}L${cx+r} ${cy}L${cx+r*0.28} ${cy+r*0.28}L${cx} ${cy+r}L${cx-r*0.28} ${cy+r*0.28}L${cx-r} ${cy}L${cx-r*0.28} ${cy-r*0.28}Z" fill="#fff" opacity="${(0.25+0.75*a).toFixed(2)}"/>`;}).join('');
 const R=78*k;const bx=S-R-22*k,by=R+22*k;
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" font-family="Sarabun">
<defs><linearGradient id="sh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="dk" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#0b1020" stop-opacity=".82"/></linearGradient>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0866FF"/><stop offset="1" stop-color="#7A3FF2"/></linearGradient></defs>
${pic}
<rect x="${sweep}" y="${-S*0.2}" width="${S*0.35}" height="${S*1.4}" fill="url(#sh)" transform="rotate(18 ${S/2} ${S/2})"/>
<rect width="${S}" height="${S}" fill="url(#dk)"/>${stars}
<g transform="translate(${bx} ${by}) scale(${bs.toFixed(3)})"><circle r="${R}" fill="url(#bg)" stroke="#fff" stroke-width="${5*k}"/><text y="${16*k}" font-size="${46*k}" font-weight="600" fill="#fff" text-anchor="middle">${x(glyphs(s.badge))}</text></g>
<g opacity="${fade.toFixed(2)}"><text x="${24*k}" y="${S-60*k}" font-size="${34*k}" font-weight="600" fill="#fff">${x(glyphs(s.title)).slice(0,40)}</text>
<text x="${24*k}" y="${S-24*k}" font-size="${22*k}" fill="#dfe7ff">${x(glyphs(s.subtitle)).slice(0,52)}</text></g></svg>`;
}

/** The GIF, or null when the renderer is not installed. */
export async function offerGif(s:AnimSpec):Promise<Buffer|null>{
 const R=await load();if(!R)return null;
 const pic=await drawable(s.image,s.mime,s.size);if(!pic)return null;
 const n=s.frames??20,uri=(b:Buffer,m:string)=>`data:${m};base64,${b.toString('base64')}`,frames:Uint8Array[]=[];
 const scenes:{href:string|[string,string];spec:AnimSpec}[]=[];
 if(s.photos)scenes.push({href:[uri(s.photos[0],'image/jpeg'),uri(s.photos[1],'image/jpeg')],spec:{...s,subtitle:s.photoSubtitle??s.subtitle}});
 if(!s.photos||pic.image!==s.photos[0])scenes.push({href:uri(pic.image,pic.mime),spec:s});
 for(const sc of scenes)for(let i=0;i<n;i++){
  const img=new R.Resvg(frame(sc.spec,i,n,sc.href),{font:{fontFiles:FONTS,loadSystemFonts:false,defaultFontFamily:'Sarabun'},fitTo:{mode:'width',value:s.size}}).render();
  frames.push(indexFrame(img.pixels,s.size,s.size));// keep 1 byte per pixel, not 4
 }
 return encodeGif(s.size,s.size,frames,12,true);
}
