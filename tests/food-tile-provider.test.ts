import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchFoodTile,readFoodTileConfig} from '../apps/api/src/food-tile-provider';
import {fixtureTilePng,pngChunk} from './food-tile-fixture';
const config=readFoodTileConfig({BITPOS_FOOD_TILE_ORIGIN:'http://127.0.0.1:3999',BITPOS_FOOD_TILE_ATTRIBUTION:'Synthetic local fixture',BITPOS_FOOD_NAVIGATION_FIXTURE:'1'});
function png(width=256){const data=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(data);data.writeUInt32BE(13,8);data.write('IHDR',12);data.writeUInt32BE(width,16);data.writeUInt32BE(256,20);return data;}
const transport=(response:Response)=>(async()=>response) as typeof fetch;
test('unconfigured tiles never contact a provider',async()=>{assert.equal(await fetchFoodTile(readFoodTileConfig({}),14,1,1,async()=>{throw Error('Unexpected provider request');}),null);});
test('oversized decoded dimensions are refused despite tiny compressed input',async()=>{assert.equal(await fetchFoodTile(config,14,1,1,transport(new Response(png(100000),{headers:{'Content-Type':'image/png'}}))),null);});
test('streamed byte budget cancels body without relying on content length',async()=>{let canceled=false;const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(262145));},cancel(){canceled=true;}});assert.equal(await fetchFoodTile(config,14,1,1,transport(new Response(body,{headers:{'Content-Type':'image/png'}}))),null);await Promise.resolve();assert.equal(canceled,true);});
test('non-PNG and unexpected media cannot enter image decoder',async()=>{for(const response of [new Response('private error page',{headers:{'Content-Type':'text/html'}}),new Response('not PNG',{headers:{'Content-Type':'image/png'}})])assert.equal(await fetchFoodTile(config,14,1,1,transport(response)),null);});
test('invalid credential-bearing provider configuration fails closed',()=>{assert.throws(()=>readFoodTileConfig({BITPOS_FOOD_TILE_ORIGIN:'https://secret@example.com',BITPOS_FOOD_TILE_ATTRIBUTION:'Fixture'}),/Invalid food navigation configuration/);});
test('caller cancellation releases a stalled PNG body without returning partial pixels',async()=>{
 let canceled=false;const controller=new AbortController(),body=new ReadableStream<Uint8Array>({start(stream){stream.enqueue(png());},cancel(){canceled=true;}});
 const pending=fetchFoodTile(config,14,1,1,transport(new Response(body,{headers:{'Content-Type':'image/png'}})),controller.signal);
 await new Promise<void>(resolve=>setImmediate(resolve));controller.abort();assert.equal(await pending,null);assert.equal(canceled,true);
});
test('caller cancellation bounds even a transport ignoring AbortSignal',async()=>{
 const controller=new AbortController(),pending=fetchFoodTile(config,14,1,1,async()=>new Promise<Response>(()=>{}),controller.signal);controller.abort();assert.equal(await pending,null);
});
test('ordinary fixed-size PNG is admitted but animated frame declarations are refused',async()=>{
 const valid=fixtureTilePng(),accepted=await fetchFoodTile(config,14,1,1,transport(new Response(valid,{headers:{'Content-Type':'image/png'}})));assert.equal(accepted?.pngBase64,valid.toString('base64'));
 const frames=Buffer.alloc(8);frames.writeUInt32BE(100000);const animated=Buffer.concat([valid.subarray(0,33),pngChunk('acTL',frames),valid.subarray(33)]);
 assert.equal(await fetchFoodTile(config,14,1,1,transport(new Response(animated,{headers:{'Content-Type':'image/png'}}))),null);
});
