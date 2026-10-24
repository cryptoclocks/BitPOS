import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs';
import {WebSocket} from 'ws';
import {z} from 'zod';
import {promotionFixture} from '../../tests/backend-promotions-fixture';
import {pool} from '../../apps/api/src/db';
import type {PromotionCampaign,PromotionJob,Quote,OrderView} from '../../packages/contracts/src/index';

// Actual disposable-tenant HTTP/worker/WebSocket proof. Structured provider and
// display-render ACK are explicitly fixtures: no model, chain or physical claim.
assert.equal(process.env.BITPOS_BACKEND_INTEGRATION,'1','explicit integration opt-in required');
const frameSchema=z.object({type:z.string(),connectionGeneration:z.string(),screenGeneration:z.string(),assignmentGeneration:z.string().optional(),authGeneration:z.string().optional(),eventId:z.string().uuid().optional(),deviceSeq:z.string().optional(),requestId:z.string().uuid().optional(),payload:z.unknown().optional(),result:z.unknown().optional()}).passthrough();
type Frame=z.infer<typeof frameSchema>;
const playlistSchema=z.object({generation:z.string(),occupancyGeneration:z.string().nullable(),tableId:z.string().uuid().nullable(),state:z.literal('CURRENT'),items:z.array(z.object({targetId:z.string().uuid(),campaignId:z.string().uuid(),campaignVersion:z.number().int(),audience:z.enum(['daily','personal']),menuUrl:z.string().url(),image:z.object({url:z.string().url(),sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.literal(112000),width:z.literal(280),height:z.literal(200),format:z.literal('rgb565le')}).nullable()}).passthrough()).max(3)});
const commandSuccess=z.object({ok:z.literal(true),value:z.unknown()});
const f=await promotionFixture(),sockets:WebSocket[]=[];
async function connect(){
 const token=f.credentials.get(f.b.id);assert.ok(token);
 const socket=new WebSocket(f.origin.replace(/^http:/,'ws:')+'/api/device',{headers:{Authorization:'Bearer '+token}});sockets.push(socket);
 const frames:Frame[]=[],waiters=new Set<()=>void>();let terminal:Error|undefined;
 socket.on('message',raw=>{try{frames.push(frameSchema.parse(JSON.parse(raw.toString())));for(const wake of waiters)wake();}catch{terminal=Error('Invalid actual WebSocket frame');for(const wake of waiters)wake();}});
 socket.on('error',()=>{terminal=Error('Actual local WebSocket unavailable');for(const wake of waiters)wake();});
 async function frame(predicate:(value:Frame)=>boolean){
  const existing=frames.find(predicate);if(existing)return existing;if(terminal)throw terminal;
  return new Promise<Frame>((resolve,reject)=>{const timer=setTimeout(()=>{waiters.delete(wake);reject(Error('Actual WebSocket frame deadline exceeded'));},30000);const wake=()=>{const found=frames.find(predicate);if(found||terminal){clearTimeout(timer);waiters.delete(wake);if(terminal)reject(terminal);else resolve(found!);}};waiters.add(wake);});
 }
 const configuration=await frame(message=>message.type==='CONFIG');
 const config=z.object({deviceId:z.string().uuid(),assignmentGeneration:z.string(),authGeneration:z.string(),paymentOrigin:z.string().url()}).passthrough().parse(configuration.payload);assert.equal(config.deviceId,f.b.id);
 async function command(payload:Record<string,unknown>){const requestId=randomUUID();socket.send(JSON.stringify({schemaVersion:2,requestId,connectionGeneration:configuration.connectionGeneration,...payload}));const receipt=await frame(message=>message.type==='COMMAND_RESULT'&&message.requestId===requestId);commandSuccess.parse(receipt.result);return receipt;}
 await command({type:'CAPABILITIES',capabilities:['promotion_playlist_v1','pickup_ready_v1']});
 return {socket,frames,frame,command,configuration,config};
}
try{
 const key=process.env.BITPOS_AI_API_KEY;delete process.env.BITPOS_AI_API_KEY;
 const blockedInput={...f.input,idempotencyKey:randomUUID()},blocked=await f.ok<{job:PromotionJob}>('/api/promotions/generate',blockedInput);
 assert.equal(blocked.job.state,'CONFIGURATION_REQUIRED');assert.deepEqual(await f.ok('/api/promotions/generate',blockedInput),blocked);
 assert.deepEqual((await f.inspect('SELECT reserved_microusd::text,attempts FROM ai_generation_jobs WHERE merchant_id=$1 AND id=$2',[f.merchant,blocked.job.id])).rows[0],{reserved_microusd:'0',attempts:0});process.env.BITPOS_AI_API_KEY=key;
 let campaign=await f.generate();assert.equal(campaign.provenance.kind,'fixture_provider');assert.deepEqual(campaign.playlistTargets,[]);assert.ok(campaign.previewUrl);
 const preview=await fetch(f.origin+new URL(campaign.previewUrl).pathname);assert.equal(preview.status,200);const png=Buffer.from(await preview.arrayBuffer());assert.equal(png.readUInt32BE(16),480);assert.equal(png.readUInt32BE(20),320);
 campaign=await f.approve(campaign);const entry=await f.entry();
 const publicMenu=()=>f.ok<{menu:{products:{unitPrice:{amountMinor:string};dailyPromotion?:unknown}[]}}>('/api/table/'+entry,undefined,null);
 assert.equal((await publicMenu()).menu.products[0].unitPrice.amountMinor,'270','approval remains private');
 const first=await connect(),published=await f.publish(campaign,{},f.staff);const target=published.campaign.playlistTargets?.find(t=>t.deviceId===f.b.id);assert.ok(target);
 const ready=await first.frame(message=>message.type==='PROMOTION_PLAYLIST'&&playlistSchema.parse(message.payload).items.some(item=>item.targetId===target.id));
 const playlist=playlistSchema.parse(ready.payload),notice=playlist.items.find(item=>item.targetId===target.id)!;
 assert.equal(ready.assignmentGeneration,first.config.assignmentGeneration);assert.equal(ready.authGeneration,first.config.authGeneration);assert.equal('sound' in playlist,false);assert.equal(notice.audience,'daily');
 assert.equal((await f.campaign(campaign.id)).playlistTargets?.find(t=>t.id===target.id)?.state,'DELIVERED');
 assert.ok(notice.image);const media=await fetch(f.origin+new URL(notice.image.url).pathname);assert.equal(media.status,200);const image=Buffer.from(await media.arrayBuffer());assert.equal(image.length,112000);assert.equal(createHash('sha256').update(image).digest('hex'),notice.image.sha256);
 await first.command({type:'ACK',eventId:ready.eventId,deviceSeq:ready.deviceSeq,orderId:null,orderVersion:null,screenGeneration:ready.screenGeneration,rendered:true});assert.equal((await f.campaign(campaign.id)).playlistTargets?.find(t=>t.id===target.id)?.state,'RENDERED');
 first.socket.terminate();const second=await connect();const reconnected=await second.frame(message=>message.type==='PROMOTION_PLAYLIST'&&playlistSchema.parse(message.payload).items.some(item=>item.targetId===target.id));assert.notEqual(reconnected.eventId,ready.eventId);assert.deepEqual(reconnected.payload,ready.payload);assert.equal('sound' in playlistSchema.parse(reconnected.payload),false);
 await second.command({type:'ACK',eventId:reconnected.eventId,deviceSeq:reconnected.deviceSeq,orderId:null,orderVersion:null,screenGeneration:reconnected.screenGeneration,rendered:true});
 assert.equal(new URL(notice.menuUrl).searchParams.has('offer'),false,'daily menu cannot use legacy personal offer tokens');assert.equal((await publicMenu()).menu.products[0].unitPrice.amountMinor,'230');
 const visit=await f.ok<{visitToken:string}>('/api/table/'+entry+'/visit',{requestId:randomUUID()},null),base='/api/table/'+entry+'/visit/'+visit.visitToken;
 const quoted=await f.ok<{quote:Quote}>(base+'/quotes',{items:[{productId:f.product,qty:2}]},null);assert.equal(quoted.quote.total.amountMinor,'460');assert.equal(quoted.quote.lines[0].dailyPromotion?.campaignId,campaign.id);assert.equal(quoted.quote.lines[0].scopedPromotion,undefined);
 const orderInput={quoteId:quoted.quote.id,priceVersion:quoted.quote.priceVersion,idempotencyKey:randomUUID()},created=await f.ok<{order:OrderView}>(base+'/orders',orderInput,null),frozen=structuredClone(created.order.pricing);
 const latest=await f.campaign(campaign.id);await f.ok('/api/promotions/'+campaign.id+'/revoke',{expectedVersion:latest.version,idempotencyKey:randomUUID()});
 const replay=await f.ok<{order:OrderView;replayed:boolean}>(base+'/orders',orderInput,null);assert.equal(replay.replayed,true);assert.deepEqual(replay.order.pricing,frozen);assert.equal((await publicMenu()).menu.products[0].unitPrice.amountMinor,'270');
 const evidence={origin:'actual_local_HTTP_worker_WebSocket_with_explicit_fixture_provider',scope:'promotions-table-visits-20261013',campaignId:campaign.id,targetId:target.id,orderId:created.order.id,fixtureProviderCalls:f.providerCalls(),actualProviderCalls:0,chainTransactions:0,approvalPrivate:true,explicitALLTargets:published.campaign.playlistTargets?.length,independentPlaylistGeneration:playlist.generation,imageBytes:image.length,imageSha256:notice.image.sha256,deliveredDistinctFromRendered:true,renderReceiptOrigin:'authenticated_websocket_fixture_not_physical',silentReconnect:true,publicDailyUnitMinor:'230',quantityTwoTotalMinor:'460',frozenBillAfterRevoke:true,physical:false,Android:false};
 const output=process.argv[2];if(output)fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{for(const socket of sockets)socket.terminate();await f.close();await pool.end();}
