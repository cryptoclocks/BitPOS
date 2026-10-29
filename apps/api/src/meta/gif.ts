// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// A small animated-GIF encoder for offer animations (no extra package in the Meta image): one global 256-colour palette
// (8 red × 8 green × 4 blue levels) with 4×4 ordered dithering, LZW per frame, infinite loop. Good enough for short promo
// loops on Messenger and the BitPOS Mini; frames are RGBA buffers of one size.
const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5].map(v=>(v+0.5)/16-0.5);
const R=8,G=8,B=4;

function palette():Uint8Array{
 const p=new Uint8Array(256*3);let i=0;
 for(let r=0;r<R;r++)for(let g=0;g<G;g++)for(let b=0;b<B;b++){p[i++]=Math.round(r*255/(R-1));p[i++]=Math.round(g*255/(G-1));p[i++]=Math.round(b*255/(B-1));}
 return p;
}
/** RGBA → palette indices (one byte per pixel), so a caller can drop each RGBA frame as soon as it is rendered. */
export function indexFrame(rgba:Uint8Array,w:number,h:number):Uint8Array{
 const out=new Uint8Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const o=(y*w+x)*4,d=BAYER[(y&3)*4+(x&3)];
  const q=(v:number,n:number)=>Math.max(0,Math.min(n-1,Math.round(v/255*(n-1)+d)));
  out[y*w+x]=q(rgba[o],R)*G*B+q(rgba[o+1],G)*B+q(rgba[o+2],B);
 }
 return out;
}
/** GIF LZW (minimum code size 8), emitted as data sub-blocks. */
function lzw(indices:Uint8Array):Buffer{
 const clear=256,eoi=257,bytes:number[]=[];let size=9,next=258,acc=0,bits=0;
 const put=(code:number)=>{acc|=code<<bits;bits+=size;while(bits>=8){bytes.push(acc&255);acc>>>=8;bits-=8;}};
 let dict=new Map<number,number>();
 put(clear);
 let prefix=indices[0];
 for(let i=1;i<indices.length;i++){
  const k=indices[i],key=prefix*256+k,hit=dict.get(key);
  if(hit!==undefined){prefix=hit;continue;}
  put(prefix);
  if(next<4096){dict.set(key,next++);if(next>(1<<size)&&size<12)size++;}
  else{put(clear);dict=new Map();next=258;size=9;}
  prefix=k;
 }
 put(prefix);put(eoi);if(bits>0)bytes.push(acc&255);
 const out:number[]=[];for(let i=0;i<bytes.length;i+=255){const c=bytes.slice(i,i+255);out.push(c.length,...c);}out.push(0);
 return Buffer.from(out);
}
/** frames: RGBA buffers (w×h), or palette indices from indexFrame when indexed; delayCs: per-frame delay in 1/100 s. */
export function encodeGif(w:number,h:number,frames:Uint8Array[],delayCs:number,indexed=false):Buffer{
 const pal=palette(),parts:Buffer[]=[];
 const hdr=Buffer.alloc(13);hdr.write('GIF89a',0,'ascii');hdr.writeUInt16LE(w,6);hdr.writeUInt16LE(h,8);hdr[10]=0xF7;hdr[11]=0;hdr[12]=0;
 parts.push(hdr,Buffer.from(pal));
 parts.push(Buffer.from([0x21,0xFF,0x0B,...Buffer.from('NETSCAPE2.0','ascii'),0x03,0x01,0x00,0x00,0x00]));
 for(const f of frames){
  const gce=Buffer.from([0x21,0xF9,0x04,0x04,delayCs&255,(delayCs>>8)&255,0,0]);
  const desc=Buffer.alloc(10);desc[0]=0x2C;desc.writeUInt16LE(0,1);desc.writeUInt16LE(0,3);desc.writeUInt16LE(w,5);desc.writeUInt16LE(h,7);desc[9]=0;
  parts.push(gce,desc,Buffer.from([8]),lzw(indexed?f:indexFrame(f,w,h)));
 }
 parts.push(Buffer.from([0x3B]));
 return Buffer.concat(parts);
}
