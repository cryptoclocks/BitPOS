import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import type {PromotionCampaign,PromotionJob,PromotionsView} from '../packages/contracts/src/index';
import type {PromotionProviderResult} from '../apps/api/src/promotion-provider';
import {promotionFixture} from './backend-promotions-fixture';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
// Intentional opt-in loading boundary: private runtime config is unavailable to skipped tests.
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
test('actual licensed photo preview exists before publish, exact bounded RGB565 SHA/480x320 PNG, edit invalidates old artifact',integration,async()=>{
 const f=await promotionFixture();try{
  let c=await f.generate();assert.ok(c.previewUrl,'Pillow + licensed Sarabun + actual cafe source photo are required');assert.equal(c.assetBlocker,null);assert.equal(c.targets.length,0);
  const preview=await fetch(f.origin+new URL(c.previewUrl).pathname);assert.equal(preview.status,200);assert.equal(preview.headers.get('content-type'),'image/png');const png=Buffer.from(await preview.arrayBuffer());assert.equal(png.readUInt32BE(16),480);assert.equal(png.readUInt32BE(20),320);assert.ok(png.length<=524288);
  const imagePath=new URL(c.previewUrl).pathname.replace('/preview.png','/image.rgb565'),imageResponse=await fetch(f.origin+imagePath);const image=Buffer.from(await imageResponse.arrayBuffer());assert.equal(image.length,112000);assert.equal(imageResponse.headers.get('content-length'),'112000');assert.equal(imageResponse.headers.get('x-content-sha256'),createHash('sha256').update(image).digest('hex'));
  const oldUrl=c.previewUrl;c=(await f.ok<{campaign:PromotionCampaign}>('/api/promotions/'+c.id,{expectedVersion:c.version,idempotencyKey:randomUUID(),headline:'Edited real photograph preview'},f.owner,'PATCH')).campaign;assert.notEqual(c.previewUrl,oldUrl);assert.equal((await fetch(f.origin+new URL(oldUrl).pathname)).status,404);
  const sent=await f.publish(await f.approve(c)),item=(await f.playlist()).items.find(i=>i.campaignId===sent.campaign.id);assert.ok(item?.image);assert.equal(item.image.sha256,createHash('sha256').update(Buffer.from(await (await fetch(f.origin+new URL(item.image.url).pathname)).arrayBuffer())).digest('hex'));assert.equal(sent.campaign.targets.length,0);
 }finally{await f.close();}
});
test('offline daily target with controlled TTL never delivers/renders and expired publication cannot be silently republished',integration,async t=>{
 const f=await promotionFixture();try{
  const c=await f.approve(await f.generate());await f.inspect('UPDATE device_presence SET connected_until=NULL WHERE merchant_id=$1 AND device_id=$2',[f.merchant,f.b.id]);const sent=await f.publish(c);await f.reconcile();
  assert.equal((await f.campaign(c.id)).playlistTargets?.find(target=>target.deviceId===f.b.id)?.state,'DEFERRED_OFFLINE');assert.equal((await f.inspect("SELECT count(*)::int AS n FROM outbox_events WHERE merchant_id=$1 AND target_device_id=$2 AND type='PROMOTION_PLAYLIST'",[f.merchant,f.b.id])).rows[0].n,0);
  t.mock.method(Date,'now',()=>Date.parse(sent.campaign.expiresAt)+1);await f.reconcile();const expired=await f.campaign(c.id);assert.equal(expired.playlistTargets?.find(target=>target.deviceId===f.b.id)?.state,'EXPIRED');assert.equal((await f.playlist()).items.length,0);
  const retry=await f.request<{error:{code:string}}>('/api/promotions/'+c.id+'/publish',await f.batch(expired));assert.equal(retry.value.error.code,'PROMOTION_STATE_INVALID');t.mock.restoreAll();
  await f.inspect("UPDATE device_presence SET connected_until=clock_timestamp()+interval '1 hour' WHERE merchant_id=$1 AND device_id=$2",[f.merchant,f.b.id]);await f.reconcile();assert.equal((await f.campaign(c.id)).playlistTargets?.find(target=>target.deviceId===f.b.id)?.state,'EXPIRED');assert.equal((await f.playlist()).items.length,0);assert.equal((await f.inspect('SELECT count(*)::int AS n FROM promotion_playlist_targets WHERE merchant_id=$1 AND campaign_id=$2',[f.merchant,c.id])).rows[0].n,3);
 }finally{await f.close();}
});
test('durable one-attempt lease excludes concurrent runners; restart ambiguity consumes conservative reservation not second provider request',integration,async()=>{
 const f=await promotionFixture();try{
  // Intentional opt-in module loading boundary (see file comment).
  const {runPromotionJob}=await import('../apps/worker/src/promotions');const generated=await f.ok<{job:PromotionJob}>('/api/promotions/generate',{...f.input,idempotencyKey:randomUUID()});
  let resolveProvider!:(value:PromotionProviderResult)=>void,entered!:()=>void,calls=0;const enteredPromise=new Promise<void>(resolve=>entered=resolve),pending=new Promise<PromotionProviderResult>(resolve=>resolveProvider=resolve);
  const fixture={kind:'fixture_provider' as const,configuration:f.config,provider:async()=>{calls++;entered();return pending;}};
  const first=runPromotionJob(f.merchant,fixture);await enteredPromise;await runPromotionJob(f.merchant,fixture);assert.equal(calls,1);
  const row=(await f.inspect('SELECT state,attempts,reserved_microusd::text FROM bitpos.ai_generation_jobs WHERE id=$1',[generated.job.id])).rows[0];assert.deepEqual(row,{state:'RUNNING',attempts:1,reserved_microusd:'1000'});
  await f.tenant(f.merchant,db=>db.query("UPDATE ai_generation_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE merchant_id=$1 AND id=$2",[f.merchant,generated.job.id]));await runPromotionJob(f.merchant,fixture);
  resolveProvider({kind:'fixture_provider',provider:new URL(f.config.url).origin,model:f.config.model,requestId:'lease-fixture',candidate:{productId:f.product,headline:'Fixture',copy:'Not actual AI',discountPercent:15,rationale:'Controlled fixture'}});await first;await runPromotionJob(f.merchant,fixture);assert.equal(calls,1);
  const failed=await f.ok<{job:PromotionJob}>('/api/promotions/jobs/'+generated.job.id);assert.equal(failed.job.state,'FAILED');assert.equal(failed.job.blocker,'PROVIDER_OUTCOME_UNKNOWN');assert.equal(failed.job.campaignId,null);
 }finally{await f.close();}
});
test('global daily budget cannot be multiplied by tenants, and exhausted jobs call no provider',integration,async()=>{
 const f=await promotionFixture();try{
  // Intentional opt-in module loading boundary (see file comment).
  const {runPromotionJob}=await import('../apps/worker/src/promotions');let calls=0;const configuration={...f.config,dailyBudget:1000};
  const fixture={kind:'fixture_provider' as const,configuration,provider:async()=>{calls++;return {kind:'fixture_provider' as const,provider:new URL(configuration.url).origin,model:configuration.model,requestId:'budget-fixture',candidate:{productId:f.product,headline:'Fixture',copy:'Not actual AI',discountPercent:15,rationale:'Controlled fixture'}};}};
  await f.ok('/api/promotions/generate',{...f.input,idempotencyKey:randomUUID()});await runPromotionJob(f.merchant,fixture);assert.equal(calls,1);
  const generated=await f.ok<{job:PromotionJob}>('/api/promotions/generate',{...f.input,idempotencyKey:randomUUID()});await runPromotionJob(f.merchant,fixture);assert.equal(calls,1);assert.equal((await f.ok<{job:PromotionJob}>('/api/promotions/jobs/'+generated.job.id)).job.blocker,'AI_BUDGET_EXHAUSTED');
  await assert.rejects(()=>f.tenant(f.other,db=>db.query('SELECT bitpos.reserve_promotion_budget($1::uuid,$2::uuid,$3,$4,1000,1000)',[f.merchant,generated.job.id,new URL(configuration.url).origin,configuration.model])),/invalid AI budget boundary/);
  const foreignJob=await f.tenant(f.other,async db=>(await db.query("INSERT INTO ai_generation_jobs(merchant_id,state,actor_id,input,products,provider_origin,provider_model) VALUES($1,'QUEUED','controlled-budget-fixture',$2,'[]',$3,$4) RETURNING id",[f.other,{...f.input,idempotencyKey:randomUUID()},new URL(configuration.url).origin,configuration.model])).rows[0].id);
  const context=(await f.inspect('SELECT context FROM promotion_job_contexts WHERE merchant_id=$1 AND job_id=$2',[f.merchant,generated.job.id])).rows[0].context;await f.tenant(f.other,db=>db.query("INSERT INTO promotion_job_contexts(merchant_id,job_id,audience,context,minimum_unit_minor) VALUES($1,$2,'daily',$3,1)",[f.other,foreignJob,context]));
  await runPromotionJob(f.other,fixture);assert.equal(calls,1,'another tenant does not multiply the provider daily ceiling');
  const foreignRow=await f.tenant(f.other,async db=>(await db.query('SELECT state,blocker,reserved_microusd::text FROM ai_generation_jobs WHERE merchant_id=$1 AND id=$2',[f.other,foreignJob])).rows[0]);assert.deepEqual(foreignRow,{state:'FAILED',blocker:'AI_BUDGET_EXHAUSTED',reserved_microusd:'0'});
  const list=await f.ok<PromotionsView>('/api/promotions');assert.equal(list.campaigns.length,1);
 }finally{await f.close();}
});
test('required daily audience/context, bounded window/cap and merchant floor cannot be bypassed by generation or editing',integration,async()=>{
 const f=await promotionFixture();try{
  for(const missing of ['audience','minimumUnitMinor','daily'] as const){const input:Record<string,unknown>={...f.input,idempotencyKey:randomUUID()};delete input[missing];assert.equal((await f.request('/api/promotions/generate',input)).status,422);}
  assert.equal((await f.request('/api/promotions/generate',{...f.input,idempotencyKey:randomUUID(),daily:{timezone:'Asia/Bangkok',lookbackWeeks:0}})).status,422);
  for(const overrides of [{expiresAt:f.input.startsAt},{expiresAt:new Date(Date.now()+8*86400000).toISOString()},{minimumUnitMinor:'271'}]){
   const denied=await f.request<{error:{code:string}}>('/api/promotions/generate',{...f.input,idempotencyKey:randomUUID(),...overrides});assert.equal(denied.value.error.code,'PROMOTION_REVIEW_REQUIRED');
  }
  const c=await f.generate({minimumUnitMinor:'230'});assert.equal(c.scope?.minimumUnitMinor,'230');
  for(const discountPercent of [20,21]){const denied=await f.request<{error:{code:string}}>('/api/promotions/'+c.id,{expectedVersion:c.version,idempotencyKey:randomUUID(),discountPercent},f.owner,'PATCH');assert.equal(denied.value.error.code,'PROMOTION_REVIEW_REQUIRED');}
  assert.equal((await f.campaign(c.id)).unitPrice.amountMinor,'230');assert.equal(f.providerCalls(),1);
 }finally{await f.close();}
});
test('actual bounded fixture worker rejects spoofed provenance without publishing or repeating the provider call',integration,async()=>{
 const f=await promotionFixture();try{
  // Intentional opt-in loading: worker requires private configuration even for fixture injection.
  const {runPromotionJob}=await import('../apps/worker/src/promotions');const generated=await f.ok<{job:PromotionJob}>('/api/promotions/generate',{...f.input,idempotencyKey:randomUUID()});let calls=0;
  const fixture={kind:'fixture_provider' as const,configuration:f.config,provider:async()=>{calls++;return {kind:'provider' as const,provider:new URL(f.config.url).origin,model:f.config.model,requestId:'spoofed-live-provider',candidate:{productId:f.product,headline:'Fixture',copy:'Not actual AI',discountPercent:15,rationale:'Controlled response with invalid provenance'}};}};
  await runPromotionJob(f.merchant,fixture);await runPromotionJob(f.merchant,fixture);assert.equal(calls,1);const failed=await f.ok<{job:PromotionJob}>('/api/promotions/jobs/'+generated.job.id);assert.equal(failed.job.state,'FAILED');assert.equal(failed.job.blocker,'PROVIDER_PROVENANCE_INVALID');assert.equal(failed.job.campaignId,null);assert.equal(failed.job.provenance,null);
  assert.equal((await f.inspect('SELECT count(*)::int AS n FROM promotion_campaigns WHERE merchant_id=$1',[f.merchant])).rows[0].n,0);assert.equal((await f.inspect('SELECT count(*)::int AS n FROM promotion_playlist_targets WHERE merchant_id=$1',[f.merchant])).rows[0].n,0);
 }finally{await f.close();}
});
test('image snapshot changes require a freshly rendered merchant preview before approval/publication',integration,async()=>{
 const f=await promotionFixture();try{
  const draft=await f.generate(),oldPreview=draft.previewUrl;assert.ok(oldPreview);await f.inspect("UPDATE products SET image_url='/images/menu/latte.jpg' WHERE merchant_id=$1 AND id=$2",[f.merchant,f.product]);
  const denied=await f.request<{error:{code:string}}>('/api/promotions/'+draft.id+'/approve',{expectedVersion:draft.version,idempotencyKey:randomUUID()});assert.equal(denied.value.error.code,'PROMOTION_REVIEW_REQUIRED');
  const refreshed=await f.ok<{campaign:PromotionCampaign}>('/api/promotions/'+draft.id+'/preview',{expectedVersion:draft.version,idempotencyKey:randomUUID()});assert.equal(refreshed.campaign.imageUrl,'/images/menu/latte.jpg');assert.ok(refreshed.campaign.previewUrl);assert.notEqual(refreshed.campaign.previewUrl,oldPreview);assert.equal((await fetch(f.origin+new URL(oldPreview).pathname)).status,404);
  const approved=await f.approve(refreshed.campaign);await f.inspect("UPDATE products SET image_url='/images/menu/espresso.jpg' WHERE merchant_id=$1 AND id=$2",[f.merchant,f.product]);const stalePublish=await f.request<{error:{code:string}}>('/api/promotions/'+approved.id+'/publish',await f.batch(approved));assert.equal(stalePublish.value.error.code,'PROMOTION_REVIEW_REQUIRED');assert.deepEqual((await f.campaign(approved.id)).playlistTargets,[]);
 }finally{await f.close();}
});
test('worker cannot create a below-floor daily candidate even with valid fixture provenance and retained conservative budget',integration,async()=>{
 const f=await promotionFixture();try{
  // Intentional opt-in loading: worker imports private configuration; injection remains fixture_provider only.
  const {runPromotionJob}=await import('../apps/worker/src/promotions'),generated=await f.ok<{job:PromotionJob}>('/api/promotions/generate',{...f.input,minimumUnitMinor:'240',idempotencyKey:randomUUID()});let calls=0;
  const fixture={kind:'fixture_provider' as const,configuration:f.config,provider:async()=>{calls++;return {kind:'fixture_provider' as const,provider:new URL(f.config.url).origin,model:f.config.model,requestId:'below-floor-fixture',candidate:{productId:f.product,headline:'Fixture',copy:'Not actual AI',discountPercent:15,rationale:'Controlled below-floor candidate'}};}};
  await runPromotionJob(f.merchant,fixture);await runPromotionJob(f.merchant,fixture);const failed=await f.ok<{job:PromotionJob}>('/api/promotions/jobs/'+generated.job.id);assert.equal(calls,1);assert.equal(failed.job.state,'FAILED');assert.equal(failed.job.blocker,'PROMOTION_REVIEW_REQUIRED');assert.equal(failed.job.provenance?.kind,'fixture_provider');assert.equal(failed.job.campaignId,null);assert.deepEqual((await f.inspect('SELECT reserved_microusd::text,attempts FROM ai_generation_jobs WHERE merchant_id=$1 AND id=$2',[f.merchant,generated.job.id])).rows[0],{reserved_microusd:'1000',attempts:1});assert.equal((await f.inspect('SELECT count(*)::int AS n FROM promotion_campaigns WHERE merchant_id=$1',[f.merchant])).rows[0].n,0);
 }finally{await f.close();}
});
test('queued generation lost-response replay and worker restart produce one fixture provider request and one unpublished daily draft',integration,async()=>{
 const f=await promotionFixture();try{
  const input={...f.input,idempotencyKey:randomUUID()},queued=await f.ok<{job:PromotionJob}>('/api/promotions/generate',input);assert.deepEqual(await f.ok('/api/promotions/generate',input),queued);
  // Intentional opt-in loading: actual worker needs private runtime config; no real AI request is made.
  const {runPromotionJob}=await import('../apps/worker/src/promotions');let calls=0;const fixture={kind:'fixture_provider' as const,configuration:f.config,provider:async()=>{calls++;return {kind:'fixture_provider' as const,provider:new URL(f.config.url).origin,model:f.config.model,requestId:'durable-replay-fixture',candidate:{productId:f.product,headline:'Fixture',copy:'Not actual AI',discountPercent:15,rationale:'Controlled durable response'}};}};
  await runPromotionJob(f.merchant,fixture);await runPromotionJob(f.merchant,fixture);await runPromotionJob(f.merchant,fixture);assert.equal(calls,1);
  const complete=await f.ok<{job:PromotionJob}>('/api/promotions/jobs/'+queued.job.id);assert.equal(complete.job.state,'SUCCEEDED');assert.equal(complete.job.provenance?.kind,'fixture_provider');assert.ok(complete.job.campaignId);const campaign=await f.campaign(complete.job.campaignId);assert.equal(campaign.state,'DRAFT');assert.deepEqual(campaign.playlistTargets,[]);assert.equal(campaign.targets.length,0);
  assert.deepEqual((await f.inspect('SELECT reserved_microusd::text,attempts FROM ai_generation_jobs WHERE merchant_id=$1 AND id=$2',[f.merchant,queued.job.id])).rows[0],{reserved_microusd:'1000',attempts:1});assert.equal((await f.inspect('SELECT count(*)::int AS n FROM promotion_campaigns WHERE merchant_id=$1',[f.merchant])).rows[0].n,1);
 }finally{await f.close();}
});
test('queued jobs bind provider origin/model before spend; changed configuration never calls the wrong provider or blocks a newer matching job',integration,async()=>{
 const f=await promotionFixture();try{
  const {runPromotionJob}=await import('../apps/worker/src/promotions');
  const old=await f.ok<{job:PromotionJob}>('/api/promotions/generate',{...f.input,idempotencyKey:randomUUID()});let calls=0;
  const provider=(configuration:typeof f.config)=>async()=>{calls++;return {kind:'fixture_provider' as const,provider:new URL(configuration.url).origin,model:configuration.model,requestId:randomUUID(),candidate:{productId:f.product,headline:'Profile fixture',copy:'Explicit fixture only',discountPercent:15,rationale:'Controlled profile isolation'}};};
  for(const configuration of [{...f.config,url:'https://another-profile.invalid/v1/chat/completions'},{...f.config,model:f.config.model+'-new'}])await runPromotionJob(f.merchant,{kind:'fixture_provider',configuration,provider:provider(configuration)});
  assert.equal(calls,0);assert.deepEqual((await f.inspect('SELECT state,blocker,attempts,reserved_microusd::text FROM ai_generation_jobs WHERE merchant_id=$1 AND id=$2',[f.merchant,old.job.id])).rows[0],{state:'QUEUED',blocker:'CONFIGURATION_REQUIRED',attempts:0,reserved_microusd:'0'});
  const configuration={...f.config,model:f.config.model+'-new'};process.env.BITPOS_AI_MODEL=configuration.model;
  const current=await f.ok<{job:PromotionJob}>('/api/promotions/generate',{...f.input,idempotencyKey:randomUUID()});
  await runPromotionJob(f.merchant,{kind:'fixture_provider',configuration,provider:provider(configuration)});assert.equal(calls,1);assert.equal((await f.ok<{job:PromotionJob}>('/api/promotions/jobs/'+current.job.id)).job.state,'SUCCEEDED');assert.equal((await f.ok<{job:PromotionJob}>('/api/promotions/jobs/'+old.job.id)).job.state,'QUEUED');
  await runPromotionJob(f.merchant,{kind:'fixture_provider',configuration:f.config,provider:provider(f.config)});assert.equal(calls,2);assert.equal((await f.ok<{job:PromotionJob}>('/api/promotions/jobs/'+old.job.id)).job.state,'SUCCEEDED');
  const rows=(await f.inspect("SELECT attempts,blocker,provenance->>'model' AS model FROM ai_generation_jobs WHERE merchant_id=$1 AND id=ANY($2::uuid[]) ORDER BY created_at,id",[f.merchant,[old.job.id,current.job.id]])).rows;assert.deepEqual(rows,[{attempts:1,blocker:null,model:f.config.model},{attempts:1,blocker:null,model:configuration.model}]);
 }finally{await f.close();}
});
