import {createHash} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import {z} from 'zod';
import {mobilePrincipal} from './mobile-auth';
import {withMobileDispatch} from './driver-platform';
import {fail} from './authority';
import {FoodNavigationAssignmentSchema,FoodNavigationSnapshotSchema,FoodNavigationTileSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {fetchFoodRoute,readFoodNavigationConfig} from './food-navigation-provider';
import {fetchFoodTile,readFoodTileConfig} from './food-tile-provider';
const Fence=z.object({assignmentId:z.string().uuid(),generation:z.string().regex(/^[1-9][0-9]{0,18}$/),leaseGeneration:z.string().regex(/^[1-9][0-9]{0,18}$/)}).strict();
let activeProviders=0;const providerAccounts=new Map<string,number>();
async function providerRequest<T>(account:string,signal:AbortSignal,run:()=>Promise<T>):Promise<T>{
 if(signal.aborted)fail('INVALID_REQUEST',499);
 if(activeProviders>=64||(providerAccounts.get(account)??0)>=4)fail('INVALID_REQUEST',429);
 activeProviders++;providerAccounts.set(account,(providerAccounts.get(account)??0)+1);
 try{return await run();}finally{activeProviders--;const remaining=providerAccounts.get(account)!-1;if(remaining)providerAccounts.set(account,remaining);else providerAccounts.delete(account);}
}
export async function foodNavigationRequest(url:URL,method:string,bearer:string|undefined,request?:IncomingMessage){
 if(!url.pathname.endsWith('/navigation')&&!url.pathname.endsWith('/navigation/tile'))return undefined;
 const controller=new AbortController(),abort=()=>controller.abort();
 request?.once('aborted',abort);request?.socket.once('close',abort);
 if(request?.aborted||request?.socket.destroyed)controller.abort();
 try{return await navigationRequest(url,method,bearer,controller.signal);}finally{request?.removeListener('aborted',abort);request?.socket.removeListener('close',abort);}
}
async function navigationRequest(url:URL,method:string,bearer:string|undefined,signal:AbortSignal){
 const customer=/^\/api\/mobile\/v1\/food\/orders\/([^/]+)\/delivery\/navigation(\/tile)?$/.exec(url.pathname),driver=/^\/api\/mobile\/v1\/driver\/food\/navigation(\/tile)?$/.exec(url.pathname);
 if(!customer&&!driver)return undefined;
 if(method!=='GET')fail('INVALID_REQUEST',422);
 const tile=Boolean(customer?.[2]||driver?.[1]),entries=[...url.searchParams.entries()];if(entries.length!==(tile?6:3)||new Set(entries.map(([key])=>key)).size!==entries.length)fail('INVALID_REQUEST',422);
 const query=Object.fromEntries(entries),fence=Fence.parse(tile?{assignmentId:query.assignmentId,generation:query.generation,leaseGeneration:query.leaseGeneration}:query);
 for(const generation of [fence.generation,fence.leaseGeneration])if(BigInt(generation)>9223372036854775807n)fail('INVALID_REQUEST',422);
 const oid=customer?z.string().uuid().parse(customer[1]):null;
 let account='';
 const read=async()=>{
  if(signal.aborted)fail('INVALID_REQUEST',499);
  const actor=await mobilePrincipal(bearer);
  if(signal.aborted)fail('INVALID_REQUEST',499);account=actor.accountId;
  return withMobileDispatch(actor,async db=>{
   await db.query("SET LOCAL statement_timeout='1500ms'; SET LOCAL lock_timeout='200ms'");
   await db.query("SELECT set_config('bitpos.mobile_access_hash',$1,true)",[createHash('sha256').update(bearer!.slice(7)).digest('hex')]);
   const value=FoodNavigationAssignmentSchema.nullable().parse((await db.query('SELECT bitpos.dispatch_food_navigation($1) AS value',[oid])).rows[0].value);
   if(signal.aborted)fail('INVALID_REQUEST',499);
   if(value&&(value.assignmentId!==fence.assignmentId||value.generation!==fence.generation||value.leaseGeneration!==fence.leaseGeneration))fail('ASSIGNMENT_CHANGED',409);
   return value;
  });
 };
 const assignment=await read(),config=readFoodNavigationConfig(process.env),tiles=readFoodTileConfig(process.env);
 const revalidate=async()=>{const current=await read();if(JSON.stringify(current&&[current.assignmentId,current.generation,current.leaseGeneration,current.state,current.target])!==JSON.stringify(assignment&&[assignment.assignmentId,assignment.generation,assignment.leaseGeneration,assignment.state,assignment.target]))fail('ASSIGNMENT_CHANGED',409);return current;};
 if(tile){
  if(!assignment||tiles.kind==='unavailable')fail('RESOURCE_NOT_FOUND',404);
  const coordinate=(name:string,min:number,max:number)=>{const value=query[name];if(!value||!/^(0|[1-9][0-9]*)$/.test(value))fail('INVALID_REQUEST',422);return z.number().int().min(min).max(max).parse(Number(value));};
  const zoom=coordinate('z',12,18),size=2**zoom,x=coordinate('x',0,size-1),y=coordinate('y',0,size-1);
  // Restrict tiles to a three-tile radius of current authorized endpoints, not arbitrary world browsing.
  const near=(latitudeE7:number,longitudeE7:number)=>{const latitude=Math.max(-85.05112878,Math.min(85.05112878,latitudeE7/1e7))*Math.PI/180,tx=(longitudeE7/1e7+180)/360*size,ty=(1-Math.asinh(Math.tan(latitude))/Math.PI)/2*size;return Math.min(Math.abs(x-Math.floor(tx)),size-Math.abs(x-Math.floor(tx)))<=3&&Math.abs(y-Math.floor(ty))<=3;};
  if(!near(assignment.targetLatitudeE7,assignment.targetLongitudeE7)&&!(assignment.location&&near(assignment.location.latitudeE7,assignment.location.longitudeE7)))fail('RESOURCE_NOT_FOUND',404);
  const image=await providerRequest(account,signal,()=>fetchFoodTile(tiles,zoom,x,y,fetch,signal)),current=await revalidate();
  if(!current||!near(current.targetLatitudeE7,current.targetLongitudeE7)&&!(current.location&&near(current.location.latitudeE7,current.location.longitudeE7)))fail('RESOURCE_NOT_FOUND',404);
  if(!image)fail('RESOURCE_NOT_FOUND',404);return FoodNavigationTileSchema.parse(image);
 }
 let route=null,reason: 'no_assignment'|'unconfigured'|'location_unavailable'|'location_stale'|'provider_unavailable'|'invalid_response'|null=null;
 if(!assignment)reason='no_assignment';
 else if(config.kind==='unavailable')reason='unconfigured';
 else if(!assignment.location)reason='location_unavailable';
 else if(assignment.location.stale||Date.now()-Date.parse(assignment.location.capturedAt)>30000||Date.now()-Date.parse(assignment.location.receivedAt)>30000)reason='location_stale';
 else{
  const result=await providerRequest(account,signal,()=>fetchFoodRoute(config,{origin:{latitudeE7:assignment.location!.latitudeE7,longitudeE7:assignment.location!.longitudeE7},destination:{latitudeE7:assignment.targetLatitudeE7,longitudeE7:assignment.targetLongitudeE7},mode:'motorcycle'},{signal}));
  if(result.kind==='route'){const {kind,...value}=result;route=value;}else reason=result.reason;
 }
 // Never hold database locks during provider I/O; never publish after owner/phase changes.
 const current=await revalidate();
 if(route){const before=assignment?.location,after=current?.location;if(!before||!after||before.sequence!==after.sequence||before.latitudeE7!==after.latitudeE7||before.longitudeE7!==after.longitudeE7||before.capturedAt!==after.capturedAt||before.receivedAt!==after.receivedAt)fail('LOCATION_STALE',409);}
 if(route&&current?.location&&(current.location.stale||Date.now()-Date.parse(current.location.capturedAt)>30000||Date.now()-Date.parse(current.location.receivedAt)>30000)){route=null;reason='location_stale';}
 return FoodNavigationSnapshotSchema.parse({serverTime:new Date().toISOString(),assignment:current,route,routeUnavailable:reason,tilesAvailable:tiles.kind!=='unavailable',tileAttribution:tiles.kind==='valhalla'?tiles.attribution:null,tileFixture:tiles.kind==='valhalla'&&tiles.fixture});
}
