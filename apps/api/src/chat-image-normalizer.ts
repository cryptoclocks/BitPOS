import sharp from 'sharp';
import {createHash} from 'node:crypto';

export const CHAT_IMAGE_LIMITS=Object.freeze({sourceBytes:4*1024*1024,storedBytes:4*1024*1024,sourcePixels:16_000_000,sourceDimension:16384,outputDimension:1280,parallel:2,seconds:2});
export class ChatImageError extends Error {
 constructor(readonly code:'CHAT_IMAGE_INVALID'|'CHAT_IMAGE_TOO_LARGE'|'CHAT_IMAGE_BUSY'){super(code);}
}
export type SanitizedChatImage={bytes:Buffer;mime:'image/jpeg';byteLength:number;width:number;height:number;sourceSha256:string;sha256:string;sanitizer:'raster-reencode-v1'};
let active=0;
// Private chat pixels must not enter libvips' cross-request operation cache.
sharp.cache(false);
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
/** No path/URL input and no original file retention. Raster validation/re-encoding is not an antivirus verdict. */
export async function normalizeChatImage(input:Uint8Array,declaredMime:string):Promise<SanitizedChatImage>{
 if(!(input instanceof Uint8Array)||input.byteLength===0)throw new ChatImageError('CHAT_IMAGE_INVALID');
 if(input.byteLength>CHAT_IMAGE_LIMITS.sourceBytes)throw new ChatImageError('CHAT_IMAGE_TOO_LARGE');
 if(active>=CHAT_IMAGE_LIMITS.parallel)throw new ChatImageError('CHAT_IMAGE_BUSY');
 active++;
 try{
  const source=Buffer.from(input);
  const png=source.length>=8&&source.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg=source.length>=3&&source[0]===255&&source[1]===216&&source[2]===255;
  const expected=declaredMime==='image/jpeg'&&jpeg?'jpeg':declaredMime==='image/png'&&png?'png':null;
  if(!expected)throw new ChatImageError('CHAT_IMAGE_INVALID');
  // Metadata reads the bounded input header before the full pixel-limited decode.
  const meta=await sharp(source,{limitInputPixels:false,failOn:'warning'}).metadata();
  if(meta.format!==expected||(meta.pages??1)!==1||!meta.width||!meta.height)throw new ChatImageError('CHAT_IMAGE_INVALID');
  if(meta.width>CHAT_IMAGE_LIMITS.sourceDimension||meta.height>CHAT_IMAGE_LIMITS.sourceDimension||meta.width*meta.height>CHAT_IMAGE_LIMITS.sourcePixels)throw new ChatImageError('CHAT_IMAGE_TOO_LARGE');
  const {data,info}=await sharp(source,{limitInputPixels:CHAT_IMAGE_LIMITS.sourcePixels,failOn:'warning',sequentialRead:true})
   .autoOrient().flatten({background:'#ffffff'})
   .resize({width:CHAT_IMAGE_LIMITS.outputDimension,height:CHAT_IMAGE_LIMITS.outputDimension,fit:'inside',withoutEnlargement:true})
   .jpeg({quality:82,progressive:false,chromaSubsampling:'4:2:0'})
   .timeout({seconds:CHAT_IMAGE_LIMITS.seconds}).toBuffer({resolveWithObject:true});
  if(data.length>CHAT_IMAGE_LIMITS.storedBytes)throw new ChatImageError('CHAT_IMAGE_TOO_LARGE');
  return {bytes:data,mime:'image/jpeg',byteLength:data.length,width:info.width,height:info.height,sourceSha256:digest(source),sha256:digest(data),sanitizer:'raster-reencode-v1'};
 }catch(error){if(error instanceof ChatImageError)throw error;throw new ChatImageError('CHAT_IMAGE_INVALID');}
 finally{active--;}
}
