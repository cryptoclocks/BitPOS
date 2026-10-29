import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import type {PromotionCampaign,PromotionGenerate,PromotionJob,PromotionsView} from '../packages/contracts/src/index';
import type {PromotionBatchPublish,DevicePromotionPlaylist} from '../packages/contracts/src/daily-promotions';
import {tableFixture,staffToken} from './backend-table-fixture';
import type pg from 'pg';
import type {PromotionProviderConfiguration} from '../apps/api/src/promotion-provider';
export interface PromotionFixtureAccess {
 merchant:string;product:string;b:{id:string};config:PromotionProviderConfiguration;
 ok<T>(path:string,input?:unknown,token?:string|null,method?:string):Promise<T>;
 inspect(sql:string,args?:unknown[]):Promise<pg.QueryResult>;
 batch(campaign:PromotionCampaign):Promise<PromotionBatchPublish>;
 publish(campaign:PromotionCampaign,overrides?:Partial<PromotionBatchPublish>,token?:string):Promise<{campaign:PromotionCampaign}>;
}
export interface PromotionFixtureEvent {id:string;target_device_id:string;device_seq:string;screen_generation:string;payload:{authGeneration:string;payload:DevicePromotionPlaylist};}
// Intentional opt-in module loading: static server/config imports would require
// private runtime settings even when all integration tests are skipped.
export async function promotionFixture(){
 const f=await tableFixture(20),{server}=await import('../apps/api/src/index'),{runPromotionJob}=await import('../apps/worker/src/promotions');
 const config={url:'https://fixture-'+randomUUID()+'.invalid/v1/chat/completions',key:'fixture-not-live',model:'fixture-provider-only',jobBudget:1000,dailyBudget:10000};
 const env={BITPOS_AI_PROVIDER_URL:config.url,BITPOS_AI_API_KEY:config.key,BITPOS_AI_MODEL:config.model,BITPOS_AI_JOB_BUDGET_MICROUSD:String(config.jobBudget),BITPOS_AI_DAILY_BUDGET_MICROUSD:String(config.dailyBudget)};
 const old=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));Object.assign(process.env,env);
 await f.tenant(f.merchant,db=>db.query("UPDATE products SET image_url='/images/menu/espresso.jpg' WHERE merchant_id=$1 AND id=$2",[f.merchant,f.product]));
 for(const device of [f.a,f.b])assert.equal((await f.command(device.id,{type:'CAPABILITIES',capabilities:['promotion_playlist_v1','pickup_ready_v1']})).result.ok,true);
 const owner=await staffToken(f.pool,f.merchant,f.actor),staff=await staffToken(f.pool,f.merchant,randomUUID(),'staff'),foreign=await staffToken(f.pool,f.other,randomUUID());
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
 async function request<T>(path:string,input?:unknown,token:string|null=owner,method=input?'POST':'GET'){
  const response=await fetch(origin+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(input?{'Content-Type':'application/json'}:{})},body:input?JSON.stringify(input):undefined});const value=await response.json() as T;return {status:response.status,value};
 }
 async function ok<T>(path:string,input?:unknown,token:string|null=owner,method=input?'POST':'GET'){const r=await request<T>(path,input,token,method);assert.ok(r.status>=200&&r.status<300,`${r.status}: ${JSON.stringify(r.value)}`);return r.value;}
 const input:PromotionGenerate={productIds:[f.product],goal:'Controlled fixture; not actual AI execution',audience:'daily',minimumUnitMinor:'1',daily:{timezone:'Asia/Bangkok',lookbackWeeks:6},maxDiscountPercent:20,startsAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),idempotencyKey:randomUUID()};
 let providerCalls=0;
 async function generate(overrides:Partial<PromotionGenerate>={}){
  const generated=await ok<{job:PromotionJob}>('/api/promotions/generate',{...input,idempotencyKey:randomUUID(),...overrides});
  await runPromotionJob(f.merchant,{kind:'fixture_provider',configuration:config,provider:async job=>{providerCalls++;assert.equal(job.context?.kind,'daily');assert.equal(job.minimumUnitMinor,overrides.minimumUnitMinor??input.minimumUnitMinor);return {kind:'fixture_provider',provider:new URL(config.url).origin,model:config.model,requestId:'controlled-fixture-'+job.jobId,candidate:{productId:job.products[0].productId,headline:'กาแฟลดราคา',copy:'Controlled fixture promotion',discountPercent:15,rationale:'Explicit fixture response, not real model'}};}});
  const result=await ok<{job:PromotionJob}>('/api/promotions/jobs/'+generated.job.id);assert.equal(result.job.state,'SUCCEEDED');assert.equal(result.job.provenance?.kind,'fixture_provider');assert.ok(result.job.campaignId);
  return (await ok<{campaign:PromotionCampaign}>('/api/promotions/'+result.job.campaignId)).campaign;
 }
 async function approve(c:PromotionCampaign){return (await ok<{campaign:PromotionCampaign}>('/api/promotions/'+c.id+'/approve',{expectedVersion:c.version,idempotencyKey:randomUUID()})).campaign;}
 async function batch(c:PromotionCampaign):Promise<PromotionBatchPublish>{
  const list=await ok<PromotionsView>('/api/promotions');
  return {expectedVersion:c.version,idempotencyKey:randomUUID(),confirmTargets:true,targets:list.devices.map(({deviceId,assignmentGeneration,authGeneration,screenGeneration})=>({deviceId,assignmentGeneration,authGeneration,screenGeneration}))};
 }
 async function publish(c:PromotionCampaign,overrides:Partial<PromotionBatchPublish>={},token=owner){return ok<{campaign:PromotionCampaign}>('/api/promotions/'+c.id+'/publish',{...await batch(c),...overrides},token);}
 async function campaign(id:string){return (await ok<{campaign:PromotionCampaign}>('/api/promotions/'+id)).campaign;}
 async function playlist(device=f.b.id){return (await inspect('SELECT content FROM device_promotion_playlist_state WHERE merchant_id=$1 AND device_id=$2',[f.merchant,device])).rows[0].content as DevicePromotionPlaylist;}
 async function entry(){return (await inspect('SELECT e.entry_token FROM table_entries e JOIN devices d ON d.merchant_id=e.merchant_id AND d.id=e.device_id AND d.table_id=e.table_id AND d.assignment_generation=e.assignment_generation AND d.auth_generation=e.auth_generation WHERE e.merchant_id=$1 AND e.device_id=$2 AND d.revoked_at IS NULL',[f.merchant,f.b.id])).rows[0].entry_token as string;}
 async function event(device=f.b.id){const row=(await inspect("SELECT * FROM outbox_events WHERE merchant_id=$1 AND target_device_id=$2 AND type='PROMOTION_PLAYLIST' ORDER BY device_seq DESC LIMIT 1",[f.merchant,device])).rows[0] as PromotionFixtureEvent|undefined;assert.ok(row,'a capable idle device receives a durable playlist event');return row;}
 async function deliver(event:PromotionFixtureEvent){
  const actor=f.devices.get(event.target_device_id);assert.ok(actor);
  await inspect('INSERT INTO device_event_deliveries(merchant_id,device_id,event_id,device_seq,connection_generation) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[f.merchant,event.target_device_id,event.id,event.device_seq,actor.connectionGeneration]);
 }
 function inspect(sql:string,args:unknown[]=[]){return f.tenant(f.merchant,db=>db.query(sql,args));}
 async function reconcile(device=f.b.id){const {reconcilePromotionPlaylist}=await import('../apps/api/src/promotion-playlists');const {routingLock}=await import('../apps/api/src/authority');const connection=f.devices.get(device)?.connectionGeneration??'0';await f.tenant(f.merchant,async db=>{await routingLock(db,f.merchant);await reconcilePromotionPlaylist(db,f.merchant,device,connection);});}
 async function close(){await new Promise<void>(resolve=>server.close(()=>resolve()));for(const key of Object.keys(env)){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
 return {...f,config,owner,staff,foreign,origin,input,request,ok,generate,approve,batch,publish,campaign,playlist,entry,event,deliver,reconcile,inspect,close,providerCalls:()=>providerCalls};
}
