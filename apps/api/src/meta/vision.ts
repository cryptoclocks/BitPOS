// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Two shop-side uses of Meta's vision models (dev.meta.ai docs), both reviewed by a person before anything changes:
// - SAM 3.1 (POST /v1/responses, streamed special-token text): count the items of one kind in a photo of the display
//   case, with their boxes, to suggest a stock number that staff confirm.
// - Muse Image (POST /v1/images/edits): put an offer badge on the shop's own menu photo; the owner approves the banner
//   before customers see it, and it is labelled as AI-edited.
// Photos are sent once and not stored, except an approved-or-pending banner the owner asked for.
import type {AsrConfig} from './voice';

export type VisionFetch=(input:string,init:RequestInit)=>Promise<Response>;
export class VisionError extends Error {constructor(readonly code:'UNAVAILABLE'|'FAILED'|'INVALID'){super(code);}}
export interface Box {x1:number;y1:number;x2:number;y2:number;c:number|null}

/** Boxes on the first frame of SAM's output text (<0f>id<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..[;c=..]|><|mask;..|>,...). */
export function parseSam(text:string):{boxes:Box[];w:number;h:number}{
 const line=text.split('\n').find(l=>/^<\d+f>/.test(l.trim()))??'';
 let w=0,h=0;const boxes:Box[]=[];
 for(const m of line.matchAll(/<\|box;([^|]*)\|>/g)){
  const f=Object.fromEntries(m[1].split(';').map(kv=>kv.split('=')).filter(p=>p.length===2).map(([k,v])=>[k,Number(v)]));
  if(![f.x1,f.y1,f.x2,f.y2].every(Number.isFinite))continue;
  w=f.w||w;h=f.h||h;boxes.push({x1:f.x1,y1:f.y1,x2:f.x2,y2:f.y2,c:Number.isFinite(f.c)?f.c:null});
 }
 return {boxes,w,h};
}

/** Count `noun` in a JPEG data URL with SAM 3.1 (include_confidence is refused by the API as of 29 Oct; boxes below 0.4 are dropped if it ever sends c). */
export async function samCount(config:AsrConfig,imageUrl:string,noun:string,fetchImpl:VisionFetch=fetch):Promise<{count:number;boxes:Box[];w:number;h:number}>{
 if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(imageUrl)||!/^[a-z][a-z \-']{1,40}$/i.test(noun))throw new VisionError('INVALID');
 let res:Response;
 try{res=await fetchImpl(`${config.baseUrl}/responses`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
  headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json',Accept:'text/event-stream'},
  body:JSON.stringify({model:'sam-3.1',stream:true,input:[{role:'user',content:[{type:'input_text',text:noun.toLowerCase()},{type:'input_image',image_url:imageUrl}]}]})});}
 catch{throw new VisionError('UNAVAILABLE');}
 if(!res.ok)throw new VisionError(res.status===400?'INVALID':'FAILED');
 const raw=await res.text();let text='';
 for(const line of raw.split('\n')){if(!line.startsWith('data:'))continue;try{const e=JSON.parse(line.slice(5).trim());if(e?.type==='response.output_text.delta'&&typeof e.delta==='string')text+=e.delta;else if(e?.type==='response.output_text.done'&&typeof e.text==='string'&&!text)text=e.text;}catch{}}
 const p=parseSam(text);const boxes=p.boxes.filter(b=>b.c===null||b.c>=0.4);
 return {count:boxes.length,boxes,w:p.w,h:p.h};
}

/** Muse Image edit of one photo; returns the image bytes (PNG/JPEG/WebP as the API sends them). */
export async function editImage(config:AsrConfig,imageUrl:string,prompt:string,fetchImpl:VisionFetch=fetch):Promise<{bytes:Buffer;mime:string}>{
 let res:Response;
 try{res=await fetchImpl(`${config.baseUrl}/images/edits`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),
  headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:'muse-image-1.0',prompt,images:[{image_url:imageUrl}],n:1})});}
 catch{throw new VisionError('UNAVAILABLE');}
 return imageResult(res,fetchImpl);
}
async function imageResult(res:Response,fetchImpl:VisionFetch):Promise<{bytes:Buffer;mime:string}>{
 if(!res.ok)throw new VisionError(res.status===400?'INVALID':'FAILED');
 const body=await res.json().catch(()=>null) as {data?:{b64_json?:string;url?:string}[]}|null;
 const d=body?.data?.[0];
 let bytes:Buffer|null=null;
 if(d?.b64_json)bytes=Buffer.from(d.b64_json,'base64');
 else if(d?.url?.startsWith('data:image/'))bytes=Buffer.from(d.url.split(',')[1]??'','base64');
 else if(d?.url?.startsWith('https://')){const r=await fetchImpl(d.url,{redirect:'error',signal:AbortSignal.timeout(30000)}).catch(()=>null);if(r?.ok)bytes=Buffer.from(await r.arrayBuffer());}
 if(!bytes||bytes.length<100||bytes.length>8_000_000)throw new VisionError('FAILED');
 const mime=bytes[0]===0x89?'image/png':bytes[0]===0xff?'image/jpeg':bytes.subarray(8,12).toString('ascii')==='WEBP'?'image/webp':'';
 if(!mime)throw new VisionError('FAILED');
 return {bytes,mime};
}

/** Muse Image generation of a new picture from words only (used for two-item offer art, labelled AI-generated). */
export async function generateImage(config:AsrConfig,prompt:string,fetchImpl:VisionFetch=fetch):Promise<{bytes:Buffer;mime:string}>{
 let res:Response;
 try{res=await fetchImpl(`${config.baseUrl}/images/generations`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),
  headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:'muse-image-1.0',prompt,n:1})});}
 catch{throw new VisionError('UNAVAILABLE');}
 return imageResult(res,fetchImpl);
}
