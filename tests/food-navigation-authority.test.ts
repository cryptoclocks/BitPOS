import {test} from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import http from 'node:http';
import net from 'node:net';
import {fixtureTilePng} from './food-tile-fixture';
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',ADMIN_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets',BITPOS_FOOD_ROUTE_ORIGIN:'https://route.example.invalid',BITPOS_FOOD_ROUTE_ATTRIBUTION:'Synthetic test provider'});
const {pool}=await import('../apps/api/src/db'),{foodNavigationRequest}=await import('../apps/api/src/food-navigation');
const id='00000000-0000-4000-8000-000000000001',token='Bearer '+'a'.repeat(43),url=new URL(`http://localhost/api/mobile/v1/driver/food/navigation?assignmentId=${id}&generation=1&leaseGeneration=1`);
function assignment(now:number){return {assignmentId:id,generation:'1',leaseGeneration:'1',shipmentId:id,state:'ACCEPTED',fixture:true,target:'PICKUP',targetLatitudeE7:0,targetLongitudeE7:10000,location:{sequence:'1',latitudeE7:0,longitudeE7:0,accuracyMm:5000,capturedAt:new Date(now).toISOString(),receivedAt:new Date(now).toISOString(),stale:false}};}
for(const change of ['assignment','revocation','location','coordinates','capture','receipt','age'])test(`provider response cannot publish after ${change} changes`,async t=>{
 let now=Date.now(),reads=0,activeTransactions=0,principals=0;const first=assignment(now),second=structuredClone(first);
 t.mock.method(Date,'now',()=>now);
 t.mock.method(pool,'query',async()=>({rows:++principals===2&&change==='revocation'?[]:[{id,account_id:id,device_id:id}]}));
 t.mock.method(pool,'connect',async()=>({release(){},async query(sql:string){if(sql.startsWith('BEGIN'))activeTransactions++;if(sql==='COMMIT'||sql==='ROLLBACK')activeTransactions--;if(sql.includes('dispatch_food_navigation'))return {rows:[{value:++reads===1?first:second}]};return {rows:[]};}} as unknown as pg.PoolClient));
 t.mock.method(globalThis,'fetch',async()=>{assert.equal(activeTransactions,0,'Provider latency must not hold SQL locks');if(change==='assignment')second.leaseGeneration='2';if(change==='location')second.location.sequence='2';if(change==='coordinates')second.location.latitudeE7=1;if(change==='capture')second.location.capturedAt=new Date(now-1).toISOString();if(change==='receipt')second.location.receivedAt=new Date(now-1).toISOString();if(change==='age')now+=31000;return new Response(JSON.stringify({trip:{status:0,units:'kilometers',summary:{time:24.5,length:.125},legs:[{summary:{time:24.5,length:.125},shape:'???o}@'}]}}));});
 if(change==='age'){const result=await foodNavigationRequest(url,'GET',token);assert.ok(result&&'route' in result);assert.equal(result.route,null);assert.equal(result.routeUnavailable,'location_stale');}
 else await assert.rejects(foodNavigationRequest(url,'GET',token),(error:unknown)=>error instanceof Error&&error.message.includes(change==='revocation'?'AUTH_REQUIRED':change==='assignment'?'ASSIGNMENT_CHANGED':'LOCATION_STALE'));
 assert.equal(activeTransactions,0);
});
for(const scope of ['account','global'])test(`${scope} provider admission releases abandoned transports without publishing`,async t=>{
 const value=assignment(Date.now());let providerCalls=0;
 t.mock.method(pool,'query',async(_sql:unknown,args:unknown[])=>({rows:[{id,account_id:scope==='account'?id:args[0],device_id:id}]}));
 t.mock.method(pool,'connect',async()=>({release(){},async query(sql:string){return {rows:sql.includes('dispatch_food_navigation')?[{value}]:[]};}} as unknown as pg.PoolClient));
 const transport=t.mock.method(globalThis,'fetch',async()=>{providerCalls++;return new Promise<Response>(()=>{});});
 const limit=scope==='account'?4:64,requests=Array.from({length:limit},()=>new http.IncomingMessage(new net.Socket()));
 const promises=requests.map((request,index)=>foodNavigationRequest(url,'GET',scope==='account'?token:'Bearer '+String(index).padStart(43,'a'),request)),results=Promise.allSettled(promises);
 await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(providerCalls,limit);
 await assert.rejects(foodNavigationRequest(url,'GET',scope==='account'?token:'Bearer '+'z'.repeat(43)),(error:unknown)=>typeof error==='object'&&error!==null&&'status' in error&&error.status===429);
 assert.equal(providerCalls,limit);
 for(const request of requests)request.socket.emit('close');
 const settled=await results;for(const result of settled){assert.equal(result.status,'rejected');if(result.status==='rejected')assert.equal(result.reason.status,499);}
 for(const request of requests){assert.equal(request.socket.listenerCount('close'),0);assert.equal(request.listenerCount('aborted'),0);request.socket.destroy();}
 transport.mock.mockImplementation(async()=>new Response(JSON.stringify({trip:{status:0,units:'kilometers',summary:{time:24.5,length:.125},legs:[{summary:{time:24.5,length:.125},shape:'???o}@'}]}})));
 const recovered=await foodNavigationRequest(url,'GET',token);assert.ok(recovered&&'route' in recovered);assert.equal(recovered.route?.durationSeconds,25);
});
test('tile provider response cannot outlive its current assigned endpoint neighbourhood',async t=>{
 const oldOrigin=process.env.BITPOS_FOOD_TILE_ORIGIN,oldAttribution=process.env.BITPOS_FOOD_TILE_ATTRIBUTION;
 process.env.BITPOS_FOOD_TILE_ORIGIN='https://tiles.example.invalid';process.env.BITPOS_FOOD_TILE_ATTRIBUTION='Synthetic fixture';t.after(()=>{if(oldOrigin===undefined)delete process.env.BITPOS_FOOD_TILE_ORIGIN;else process.env.BITPOS_FOOD_TILE_ORIGIN=oldOrigin;if(oldAttribution===undefined)delete process.env.BITPOS_FOOD_TILE_ATTRIBUTION;else process.env.BITPOS_FOOD_TILE_ATTRIBUTION=oldAttribution;});
 const first=assignment(Date.now()),second=structuredClone(first);first.location.latitudeE7=450000000;first.location.longitudeE7=900000000;let reads=0;
 t.mock.method(pool,'query',async()=>({rows:[{id,account_id:id,device_id:id}]}));
 t.mock.method(pool,'connect',async()=>({release(){},async query(sql:string){return {rows:sql.includes('dispatch_food_navigation')?[{value:++reads===1?first:second}]:[]};}} as unknown as pg.PoolClient));
 const png=fixtureTilePng();
 t.mock.method(globalThis,'fetch',async()=>new Response(png,{headers:{'Content-Type':'image/png'}}));
 const tileUrl=new URL(url);tileUrl.pathname+='/tile';tileUrl.searchParams.set('z','14');tileUrl.searchParams.set('x','12288');tileUrl.searchParams.set('y',String(Math.floor((1-Math.asinh(Math.tan(Math.PI/4))/Math.PI)/2*16384)));
 await assert.rejects(foodNavigationRequest(tileUrl,'GET',token),(error:unknown)=>typeof error==='object'&&error!==null&&'status' in error&&error.status===404);
});
