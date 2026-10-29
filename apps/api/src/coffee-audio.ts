import {CoffeeProviderError} from './coffee-provider';
/** Ephemeral strict duration inspection. Unknown/container-incomplete recordings
 * are refused rather than trusting the browser's duration field. */
export function audioDurationMs(b:Buffer,mime:string){
 let duration=0;
 if(mime==='audio/wav'){
  let rate=0,size=0;for(let at=12;at+8<=b.length;){const name=b.toString('ascii',at,at+4),n=b.readUInt32LE(at+4);if(at+8+n>b.length)throw new CoffeeProviderError('INVALID_AUDIO');if(name==='fmt '&&n>=16)rate=b.readUInt32LE(at+16);if(name==='data')size+=n;at+=8+n+(n%2);}if(rate)duration=size/rate*1000;
 }else if(mime.startsWith('audio/ogg')){
  if(!b.includes(Buffer.from('OpusHead')))throw new CoffeeProviderError('INVALID_AUDIO');
  let at=0;while(at+27<=b.length){if(b.toString('ascii',at,at+4)!=='OggS')throw new CoffeeProviderError('INVALID_AUDIO');const segments=b[at+26];if(at+27+segments>b.length)throw new CoffeeProviderError('INVALID_AUDIO');let payload=0;for(let i=0;i<segments;i++)payload+=b[at+27+i];const granule=b.readBigUInt64LE(at+6);if(granule!==0xffffffffffffffffn)duration=Math.max(duration,Number(granule)/48);at+=27+segments+payload;if(at>b.length)throw new CoffeeProviderError('INVALID_AUDIO');}
 }else if(mime==='audio/mp4'){
  if(!b.includes(Buffer.from('soun')))throw new CoffeeProviderError('INVALID_AUDIO');
  function boxes(start:number,end:number,depth:number){if(depth>8)throw new CoffeeProviderError('INVALID_AUDIO');for(let at=start;at+8<=end;){const n=b.readUInt32BE(at),name=b.toString('ascii',at+4,at+8);if(n<8||at+n>end)throw new CoffeeProviderError('INVALID_AUDIO');if(name==='mdhd'){const version=b[at+8],offset=version===1?28:20;if(at+offset+(version===1?12:8)>at+n)throw new CoffeeProviderError('INVALID_AUDIO');const scale=b.readUInt32BE(at+offset),ticks=version===1?Number(b.readBigUInt64BE(at+offset+4)):b.readUInt32BE(at+offset+4);if(scale)duration=Math.max(duration,ticks/scale*1000);}if(['moov','trak','mdia'].includes(name))boxes(at+8,at+n,depth+1);at+=n;}}
  boxes(0,b.length,0);
 }else{
  function vint(at:number,id=false){if(at>=b.length||!b[at])throw new CoffeeProviderError('INVALID_AUDIO');let n=1,mask=128;while(!(b[at]&mask)){n++;mask>>=1;}if(n>8||at+n>b.length)throw new CoffeeProviderError('INVALID_AUDIO');let value=id?b[at]:b[at]&~mask;for(let i=1;i<n;i++)value=value*256+b[at+i];return {n,value,unknown:!id&&value===2**(7*n)-1};}
  if(!b.includes(Buffer.from('A_OPUS')))throw new CoffeeProviderError('INVALID_AUDIO');
  let scale=1000000,cluster=0,maxEndMs=0,packetMs=0,blocks=0;
  function elements(start:number,end:number,depth:number,unknownCluster=false):number{
   if(depth>8)throw new CoffeeProviderError('INVALID_AUDIO');
   for(let at=start;at<end;){
    const id=vint(at,true);
    // MediaRecorder emits unknown-sized sibling Clusters. A level-one element
    // closes that Cluster; it must not become another recursively nested child.
    if(unknownCluster&&[0x114d9b74,0x1549a966,0x1654ae6b,0x1f43b675,0x1c53bb6b,0x1941a469,0x1043a770,0x1254c367].includes(id.value))return at;
    const size=vint(at+id.n),data=at+id.n+size.n;let stop=size.unknown?end:data+size.value;
    if(stop>end||stop<=at||size.unknown&&id.value!==0x18538067&&id.value!==0x1f43b675)throw new CoffeeProviderError('INVALID_AUDIO');
    if(id.value===0x2ad7b1||id.value===0xe7){let value=0;for(let i=data;i<stop;i++)value=value*256+b[i];if(id.value===0xe7)cluster=value;else scale=value;}
    if(id.value===0xa3||id.value===0xa1){const track=vint(data),packet=data+track.n+3;if(packet>=stop||(b[packet-1]&6)!==0)throw new CoffeeProviderError('INVALID_AUDIO');const toc=b[packet],config=toc>>3,code=toc&3,frame=config>=16?2.5*2**(config%4):config>=12?10*2**(config%2):config%4===3?60:10*2**(config%4);const count=code===0?1:code===3?(b[packet+1]&63):2;if(!count||frame*count>120)throw new CoffeeProviderError('INVALID_AUDIO');packetMs+=frame*count;blocks++;maxEndMs=Math.max(maxEndMs,(cluster+b.readInt16BE(data+track.n))*scale/1000000+frame*count);}
    if([0x18538067,0x1549a966,0x1f43b675,0xa0].includes(id.value))stop=elements(data,stop,depth+1,size.unknown&&id.value===0x1f43b675);
    at=stop;
   }
   return end;
  }
  elements(0,b.length,0);if(!blocks)throw new CoffeeProviderError('INVALID_AUDIO');duration=Math.max(packetMs,maxEndMs);
 }
 if(!Number.isFinite(duration)||duration<=0||duration>20000)throw new CoffeeProviderError('AUDIO_DURATION_INVALID');return duration;
}
