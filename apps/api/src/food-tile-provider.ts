import {readFoodNavigationConfig,type FoodNavigationConfig} from './food-navigation-provider';
export function readFoodTileConfig(env:NodeJS.ProcessEnv):FoodNavigationConfig{
 return readFoodNavigationConfig({BITPOS_FOOD_ROUTE_ORIGIN:env.BITPOS_FOOD_TILE_ORIGIN,BITPOS_FOOD_ROUTE_ATTRIBUTION:env.BITPOS_FOOD_TILE_ATTRIBUTION,BITPOS_FOOD_ROUTE_BEARER:env.BITPOS_FOOD_TILE_BEARER,BITPOS_FOOD_NAVIGATION_FIXTURE:env.BITPOS_FOOD_NAVIGATION_FIXTURE});
}
/** Fixed XYZ PNG protocol, not a caller-supplied URL proxy. No redirects or persistent private cache. */
export async function fetchFoodTile(config:FoodNavigationConfig,z:number,x:number,y:number,transport:typeof fetch=fetch,signal?:AbortSignal){
 if(config.kind==='unavailable'||signal?.aborted)return null;
 const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 let rejectDeadline!:(error:Error)=>void;
 const deadline=new Promise<never>((_,reject)=>{rejectDeadline=reject;});
 const abort=()=>{controller.abort();void reader?.cancel().catch(()=>{});rejectDeadline(new Error('Tile provider canceled'));};
 signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,5000);
 try{
  return await Promise.race([deadline,(async()=>{
   const response=await transport(new URL(`/tiles/${z}/${x}/${y}.png`,config.origin),{redirect:'error',credentials:'omit',signal:controller.signal,headers:{Accept:'image/png',...(config.bearer?{Authorization:`Bearer ${config.bearer}`}:{})}});
   if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});return null;}
   if(!response.ok||response.headers.get('content-type')?.split(';')[0]!=='image/png'){void response.body?.cancel().catch(()=>{});return null;}
   const declared=response.headers.get('content-length');if(declared!==null&&Number(declared)>262144){void response.body?.cancel().catch(()=>{});return null;}
   reader=response.body?.getReader();if(!reader)return null;
   const chunks:Uint8Array[]=[];let bytes=0;
   while(true){const next=await reader.read();if(controller.signal.aborted)return null;if(next.done)break;bytes+=next.value.byteLength;if(bytes>262144){void reader.cancel().catch(()=>{});return null;}chunks.push(next.value);}
   const png=Buffer.concat(chunks,bytes);
   // Bound decoder allocation as well as compressed bytes. Only ordinary 256px PNG tiles accepted.
   if(png.length<33||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||png.toString('ascii',12,16)!=='IHDR'||png.readUInt32BE(8)!==13||png.readUInt32BE(16)!==256||png.readUInt32BE(20)!==256)return null;
   let cursor=8,dataSeen=false,ended=false;
   while(cursor+12<=png.length){
    const length=png.readUInt32BE(cursor),kind=png.toString('ascii',cursor+4,cursor+8),end=cursor+12+length;
    if(end>png.length||['acTL','fcTL','fdAT'].includes(kind)||kind==='IHDR'&&cursor!==8)return null;
    if(kind==='IDAT')dataSeen=true;
    if(kind==='IEND'){if(length!==0||end!==png.length||!dataSeen)return null;ended=true;break;}
    cursor=end;
   }
   if(!ended)return null;
   return {pngBase64:png.toString('base64'),fixture:config.fixture,attribution:config.attribution};
  })()]);
 }catch{return null;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
}
