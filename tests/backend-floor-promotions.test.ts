import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PromotionCampaign,PromotionJob,PromotionDerive,PromotionDeviceProjection,Quote,OrderView} from '../packages/contracts/src/index';
import type {EffectiveMenu} from '../apps/api/src/offers';
import type {PromotionProviderInput,PromotionProviderResult} from '../apps/api/src/promotion-provider';
import {promotionFixture,type PromotionFixtureAccess} from './backend-promotions-fixture';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1',timeout:60000};
// Intentional opt-in module-loading boundary: skipped tests must not load DB/private runtime configuration.
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
type Fixture=PromotionFixtureAccess;
async function command(f:Fixture,c:PromotionCampaign,scope:PromotionDerive['scope']='this_table',mode:PromotionDerive['mode']='edit'):Promise<PromotionDerive>{
 const {device}=await f.ok<PromotionDeviceProjection>('/api/promotions/devices/'+f.b.id);
 return {expectedVersion:c.version,idempotencyKey:randomUUID(),scope,mode,device:{deviceId:device.deviceId,assignmentGeneration:device.assignmentGeneration,authGeneration:device.authGeneration,screenGeneration:device.screenGeneration},confirmScope:true};
}
async function counts(f:Fixture){return (await f.inspect(`SELECT (SELECT count(*) FROM ai_generation_jobs WHERE merchant_id=$1)::int AS jobs,(SELECT count(*) FROM promotion_campaigns WHERE merchant_id=$1)::int AS campaigns,(SELECT count(*) FROM promotion_playlist_targets WHERE merchant_id=$1)::int AS targets,(SELECT count(*) FROM promotion_playlist_events WHERE merchant_id=$1)::int AS events`,[f.merchant])).rows[0];}
async function send(f:Fixture,c:PromotionCampaign){const batch=await f.batch(c),ids=c.scope?.placement?.deviceIds;return f.publish(c,{targets:ids?batch.targets.filter(t=>ids.includes(t.deviceId)):batch.targets});}
function response(f:Fixture,entered?:()=>void,hold?:Promise<void>,percent=20){return async(job:PromotionProviderInput):Promise<PromotionProviderResult>=>{entered?.();await hold;return {kind:'fixture_provider',provider:new URL(f.config.url).origin,model:f.config.model,requestId:'floor-fixture-'+job.jobId,candidate:{productId:f.product,headline:'Regenerated fixture',copy:'Controlled provider, not actual AI',discountPercent:percent,rationale:'Explicit one-call fixture'}};};}

test('canonical device projection is tenant-safe, revision-exact and selection creates no draft/job/publication',integration,async()=>{
 const f=await promotionFixture();try{
  const sent=await f.publish(await f.approve(await f.generate())),before=await counts(f);
  const view=await f.ok<PromotionDeviceProjection>('/api/promotions/devices/'+f.b.id,undefined,f.staff);
  assert.equal(view.device.deviceId,f.b.id);assert.equal(view.playlist.tableId,f.table.id);assert.equal(view.playlist.items.length,1);assert.equal(view.playlist.items[0].campaignId,sent.campaign.id);assert.equal(view.playlist.items[0].campaignVersion,sent.campaign.approvedVersion);assert.notEqual(view.playlist.items[0].campaignVersion,sent.campaign.version);
  assert.deepEqual(view.campaigns.map(c=>c.id),[sent.campaign.id]);assert.equal(view.campaigns[0].playlistTargets?.find(t=>t.deviceId===f.b.id)?.state,'DELIVERED');assert.equal(view.campaigns[0].provenance.kind,'fixture_provider');
  await f.ok('/api/promotions/devices/'+f.b.id);assert.deepEqual(await counts(f),before);
  assert.equal((await f.request('/api/promotions/devices/'+f.b.id,undefined,f.foreign)).status,404);assert.equal((await f.request('/api/promotions/devices/'+f.b.id,undefined,null)).status,401);assert.equal((await f.request('/api/promotions/devices/'+f.b.id,{},f.owner)).status,404);
 }finally{await f.close();}
});

test('manual table draft inherits real provenance without a fake job, stays private through approval and changes only its explicit table on send',integration,async()=>{
 const f=await promotionFixture();try{
  const source=(await f.publish(await f.approve(await f.generate()))).campaign;
  const oldEvent=await f.event();await f.deliver(oldEvent);
  const oldBill=await f.create(await f.quote()),sourceBefore=await f.campaign(source.id),otherBefore=(await f.inspect('SELECT * FROM device_promotion_playlist_state WHERE merchant_id=$1 AND device_id=$2',[f.merchant,f.a.id])).rows[0],before=await counts(f);
  const input=await command(f,source),path='/api/promotions/'+source.id+'/derive';
  const derived=(await f.ok<{campaign:PromotionCampaign}>(path,input)).campaign;
  assert.notEqual(derived.id,source.id);assert.equal(derived.state,'DRAFT');assert.deepEqual(derived.provenance,source.provenance);assert.equal(derived.scope?.origin,'manual_derived');assert.equal(derived.scope?.pricePresentation,'inherited_source');assert.equal(derived.scope?.priceAuthority,'table');assert.deepEqual(derived.scope?.placement?.deviceIds,[f.b.id]);assert.equal(derived.scope?.placement?.tableId,f.table.id);assert.equal(derived.unitPrice.amountMinor,'230');
  assert.deepEqual((await f.ok<{campaign:PromotionCampaign}>(path,input)).campaign,derived);assert.deepEqual(await counts(f),{...before,campaigns:before.campaigns+1});assert.equal(f.providerCalls(),1);
  assert.deepEqual(await f.campaign(source.id),sourceBefore);assert.equal((await f.request(path,{...input,mode:'regenerate'})).status,409);
  const edited=(await f.ok<{campaign:PromotionCampaign}>('/api/promotions/'+derived.id,{expectedVersion:derived.version,idempotencyKey:randomUUID(),headline:'Table-only copy',discountPercent:20},f.owner,'PATCH')).campaign;
  assert.equal(edited.scope?.pricePresentation,'independent_discount');assert.deepEqual(edited.scope?.placement,derived.scope?.placement);assert.equal(edited.unitPrice.amountMinor,'216');
  const approved=await f.approve(edited);assert.equal((await f.ok<EffectiveMenu>('/api/menu')).products[0].unitPrice?.amountMinor,'230');assert.equal((await counts(f)).targets,before.targets);assert.equal((await counts(f)).events,before.events);
  const published=(await send(f,approved)).campaign;assert.equal(published.playlistTargets?.length,1);assert.equal(published.playlistTargets?.[0].deviceId,f.b.id);
  assert.equal((await f.command(f.b.id,{type:'ACK',eventId:oldEvent.id,deviceSeq:String(oldEvent.device_seq),orderId:null,orderVersion:null,screenGeneration:String(oldEvent.screen_generation),rendered:true})).result.ok,false);
  const entry=await f.entry(),local=await f.ok<{menu:EffectiveMenu}>('/api/table/'+entry,undefined,null),publicMenu=await f.ok<EffectiveMenu>('/api/menu');assert.equal(local.menu.products[0].unitPrice?.amountMinor,'216');assert.equal(local.menu.products[0].dailyPromotion?.campaignId,derived.id);assert.equal(publicMenu.products[0].unitPrice?.amountMinor,'230');assert.equal(publicMenu.products[0].dailyPromotion?.campaignId,source.id);assert.equal(local.menu.products[0].personalPromotion,undefined);
  assert.deepEqual((await f.inspect('SELECT * FROM device_promotion_playlist_state WHERE merchant_id=$1 AND device_id=$2',[f.merchant,f.a.id])).rows[0],otherBefore);
  const remaining=await f.campaign(source.id);assert.equal(remaining.version,sourceBefore.version);assert.equal(remaining.state,'APPROVED');assert.deepEqual(remaining.playlistTargets,sourceBefore.playlistTargets);assert.deepEqual((await f.ok<OrderView>('/api/orders/'+oldBill.order.id)).pricing,oldBill.order.pricing);
  const visit=await f.ok<{visitToken:string}>('/api/table/'+entry+'/visit',{requestId:randomUUID()},null),base='/api/table/'+entry+'/visit/'+visit.visitToken;
  const quote=(await f.ok<{quote:Quote}>(base+'/quotes',{items:[{productId:f.product,qty:2}]},null)).quote;assert.equal(quote.total.amountMinor,'432');assert.equal(quote.lines[0].dailyPromotion?.campaignId,derived.id);
  await assert.rejects(()=>f.inspect(`INSERT INTO order_quotes(merchant_id,id,origin_kind,origin_id,source_register_id,source_device_id,session_id,cart_version,price_version_id,pricing_revision,cart,lines,total_minor,usdg_minor,treasury,settlement,authority,request_hash,quoted_at,valid_until) SELECT merchant_id,gen_random_uuid(),origin_kind,origin_id,source_register_id,source_device_id,session_id,cart_version,price_version_id,pricing_revision,cart,lines,total_minor,usdg_minor,treasury,settlement,jsonb_set(authority,'{serving}','{"kind":"counter","label":"Counter"}'),request_hash,quoted_at,valid_until FROM order_quotes WHERE merchant_id=$1 AND id=$2`,[f.merchant,quote.id]),/table price escaped original destination/);
  const bill=await f.ok<{order:OrderView}>(base+'/orders',{quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:randomUUID()},null);assert.equal(bill.order.pricing.total.amountMinor,'432');assert.equal((await f.inspect('SELECT campaign_id FROM daily_order_promotions WHERE merchant_id=$1 AND order_id=$2',[f.merchant,bill.order.id])).rows[0].campaign_id,derived.id);
  assert.equal((await f.inspect('SELECT count(*)::int AS n FROM personal_promotion_job_bindings WHERE merchant_id=$1',[f.merchant])).rows[0].n,0);
 }finally{await f.close();}
});

test('shared replacement uses the original membership, never shop-wide expansion; ordinary daily subset and tampered derived sets reject atomically',integration,async()=>{
 const f=await promotionFixture();try{
  const originalDraft=await f.approve(await f.generate()),batch=await f.batch(originalDraft);
  assert.equal((await f.request('/api/promotions/'+originalDraft.id+'/publish',{...batch,targets:batch.targets.filter(t=>t.deviceId===f.b.id)})).status,409);assert.equal((await counts(f)).targets,0);
  const source=(await f.publish(originalDraft)).campaign,derived=(await f.ok<{campaign:PromotionCampaign}>('/api/promotions/'+source.id+'/derive',await command(f,source,'all_campaign_devices'))).campaign;
  const approved=await f.approve(derived),original=approved.scope!.placement!.deviceIds,before=await counts(f);
  await f.reg('/api/devices','POST',{label:'Not an original campaign device'});
  const invalid=await f.request('/api/promotions/'+approved.id+'/publish',await f.batch(approved));assert.equal(invalid.status,409);assert.deepEqual(await counts(f),before);assert.ok((await f.campaign(source.id)).playlistTargets?.every(t=>t.state!=='REVOKED'));
  const sent=(await send(f,approved)).campaign;assert.deepEqual(sent.playlistTargets?.map(t=>t.deviceId).sort(),[...original].sort());assert.ok((await f.campaign(source.id)).playlistTargets?.every(t=>t.failure==='REPLACED'));assert.equal((await f.ok<EffectiveMenu>('/api/menu')).products[0].unitPrice?.amountMinor,'230');
 }finally{await f.close();}
});

test('role, source version, routing and scope fences reject without creating jobs, campaigns or receipts',integration,async()=>{
 const f=await promotionFixture();try{
  const source=(await f.publish(await f.approve(await f.generate()))).campaign,input=await command(f,source),path='/api/promotions/'+source.id+'/derive',before=await counts(f);
  for(const invalid of [{...input,scope:undefined},{...input,confirmScope:false},{...input,expectedVersion:source.version-1},{...input,device:{...input.device,authGeneration:'9007199254740993'}},{...input,device:{...input.device,screenGeneration:'9007199254740993'}}])assert.ok((await f.request(path,invalid)).status>=400);
  assert.equal((await f.request(path,input,f.staff)).status,403);assert.equal((await f.request(path,input,f.foreign)).status,404);assert.deepEqual(await counts(f),before);
  const derived=(await f.ok<{campaign:PromotionCampaign}>(path,input)).campaign;
  await f.reg('/api/devices/'+f.b.id+'/credential','POST',{});
  assert.equal((await f.request('/api/promotions/'+derived.id+'/approve',{expectedVersion:derived.version,idempotencyKey:randomUUID()})).status,409);assert.equal((await counts(f)).targets,before.targets);assert.equal((await counts(f)).jobs,before.jobs);
 }finally{await f.close();}
});

test('AI regeneration binds a new durable job, calls the existing provider once and never publishes automatically',integration,async()=>{
 const f=await promotionFixture();try{
  const {runPromotionJob}=await import('../apps/worker/src/promotions');const source=(await f.publish(await f.approve(await f.generate()))).campaign,input=await command(f,source,'all_campaign_devices','regenerate'),before=await counts(f),snapshot=await f.campaign(source.id),path='/api/promotions/'+source.id+'/derive';
  const generated=await f.ok<{job:PromotionJob}>(path,input);assert.equal(generated.job.state,'QUEUED');assert.notEqual(generated.job.id,source.provenance.jobId);assert.deepEqual(await f.ok(path,input),generated);
  let calls=0;await runPromotionJob(f.merchant,{kind:'fixture_provider',configuration:f.config,provider:async job=>{calls++;assert.equal(job.products[0].effectivePrice.amountMinor,'230');assert.equal(job.context?.kind,'daily');return response(f)(job);}});
  await runPromotionJob(f.merchant,{kind:'fixture_provider',configuration:f.config,provider:async()=>{throw Error('No queued job may be retried');}});assert.equal(calls,1);
  const completed=(await f.ok<{job:PromotionJob}>('/api/promotions/jobs/'+generated.job.id)).job;assert.equal(completed.state,'SUCCEEDED');assert.ok(completed.campaignId);const draft=await f.campaign(completed.campaignId);assert.equal(draft.state,'DRAFT');assert.equal(draft.scope?.origin,'ai_regenerated');assert.equal(draft.provenance.jobId,generated.job.id);assert.deepEqual(draft.scope?.placement?.deviceIds,[f.a.id,f.b.id,f.c.id].sort());assert.equal(draft.unitPrice.amountMinor,'216');assert.deepEqual(await counts(f),{...before,jobs:before.jobs+1,campaigns:before.campaigns+1});assert.deepEqual(await f.campaign(source.id),snapshot);
  assert.deepEqual((await f.inspect('SELECT attempts,reserved_microusd::text FROM ai_generation_jobs WHERE merchant_id=$1 AND id=$2',[f.merchant,generated.job.id])).rows[0],{attempts:1,reserved_microusd:'1000'});
 }finally{await f.close();}
});

for(const phase of ['queued','provider_pending'] as const)test('invalidated table regeneration '+phase+' never retargets, retries or publishes',integration,async()=>{
 const f=await promotionFixture();try{
  const {runPromotionJob}=await import('../apps/worker/src/promotions'),source=(await f.publish(await f.approve(await f.generate()))).campaign;
  const generated=await f.ok<{job:PromotionJob}>('/api/promotions/'+source.id+'/derive',await command(f,source,'this_table','regenerate')),before=await counts(f);let calls=0,entered!:()=>void,release!:()=>void;
  const reached=new Promise<void>(resolve=>entered=resolve),held=new Promise<void>(resolve=>release=resolve);
  const provider=async(job:PromotionProviderInput)=>{calls++;return response(f,entered,held)(job);};
  let running:Promise<void>|undefined;
  if(phase==='provider_pending'){running=runPromotionJob(f.merchant,{kind:'fixture_provider',configuration:f.config,provider});await reached;}
  await f.reg('/api/devices/'+f.b.id+'/credential','POST',{});
  if(running){release();await running;}else await runPromotionJob(f.merchant,{kind:'fixture_provider',configuration:f.config,provider});
  const failed=(await f.ok<{job:PromotionJob}>('/api/promotions/jobs/'+generated.job.id)).job;assert.equal(failed.state,'FAILED');assert.equal(failed.campaignId,null);assert.equal(calls,phase==='queued'?0:1);
  const row=(await f.inspect('SELECT attempts,reserved_microusd::text,provenance FROM ai_generation_jobs WHERE merchant_id=$1 AND id=$2',[f.merchant,generated.job.id])).rows[0];assert.equal(row.attempts,calls);assert.equal(row.reserved_microusd,phase==='queued'?'0':'1000');if(calls)assert.equal(row.provenance.jobId,generated.job.id);
  await runPromotionJob(f.merchant,{kind:'fixture_provider',configuration:f.config,provider});assert.equal(calls,phase==='queued'?0:1);assert.equal((await counts(f)).campaigns,before.campaigns);assert.equal((await counts(f)).targets,before.targets);assert.equal((await f.campaign(source.id)).version,source.version);assert.equal((await f.campaign(source.id)).state,'APPROVED');
 }finally{await f.close();}
});

test('table-local same-price send has truthful inherited presentation and canonical clear invalidates it without changing other daily prices',integration,async()=>{
 const f=await promotionFixture();try{
  const source=(await f.publish(await f.approve(await f.generate()))).campaign;
  const derived=(await f.ok<{campaign:PromotionCampaign}>('/api/promotions/'+source.id+'/derive',await command(f,source))).campaign,sent=(await send(f,await f.approve(derived))).campaign,entry=await f.entry();
  assert.equal(sent.scope?.pricePresentation,'inherited_source');assert.equal(sent.scope?.priceAuthority,'table');assert.equal((await f.playlist()).items[0].unitPrice.amountMinor,'230');assert.equal((await f.ok<EffectiveMenu>('/api/menu')).products[0].unitPrice?.amountMinor,'230');
  const occupancy=(await f.ok<{occupancy:{generation:string}}>('/api/table/'+entry,undefined,null)).occupancy;
  await f.ok('/api/tables/'+f.table.id+'/clear',{expectedGeneration:occupancy.generation,idempotencyKey:randomUUID(),confirmClear:true});
  assert.equal((await f.ok<PromotionDeviceProjection>('/api/promotions/devices/'+f.b.id)).playlist.items.some(i=>i.campaignId===derived.id),false);
  assert.equal((await f.ok<EffectiveMenu>('/api/menu')).products[0].unitPrice?.amountMinor,'230');assert.equal((await f.campaign(source.id)).version,source.version);
 }finally{await f.close();}
});

for(const failure of ['budget','provider','catalog'] as const)test('regeneration '+failure+' failure retains genuine outcome and cannot auto-send',integration,async()=>{
 const f=await promotionFixture();try{
  // Intentional opt-in loading: worker/DB require private config even when tests are skipped.
  const {runPromotionJob}=await import('../apps/worker/src/promotions'),source=(await f.publish(await f.approve(await f.generate()))).campaign;
  const generated=await f.ok<{job:PromotionJob}>('/api/promotions/'+source.id+'/derive',await command(f,source,'this_table','regenerate')),before=await counts(f);let calls=0;
  if(failure==='catalog')await f.inspect('UPDATE products SET stock=0 WHERE merchant_id=$1 AND id=$2',[f.merchant,f.product]);
  const configuration=failure==='budget'?{...f.config,dailyBudget:1000}:f.config;
  await runPromotionJob(f.merchant,{kind:'fixture_provider',configuration,provider:async()=>{calls++;throw Error('Controlled provider failure, not actual AI');}});
  const failed=(await f.ok<{job:PromotionJob}>('/api/promotions/jobs/'+generated.job.id)).job;assert.equal(failed.state,'FAILED');assert.equal(failed.campaignId,null);assert.equal(calls,failure==='provider'?1:0);assert.equal((await counts(f)).campaigns,before.campaigns);assert.equal((await counts(f)).targets,before.targets);assert.equal((await counts(f)).events,before.events);
  assert.deepEqual((await f.inspect('SELECT attempts,reserved_microusd::text FROM ai_generation_jobs WHERE merchant_id=$1 AND id=$2',[f.merchant,generated.job.id])).rows[0],{attempts:calls,reserved_microusd:failure==='provider'?'1000':'0'});
  await runPromotionJob(f.merchant,{kind:'fixture_provider',configuration,provider:async()=>{throw Error('Failed durable job must not retry');}});assert.equal((await f.campaign(source.id)).version,source.version);
 }finally{await f.close();}
});

test('lost-response derivation replays before stale-source checks, but a new command or draft send cannot outlive source revocation',integration,async()=>{
 const f=await promotionFixture();try{
  const source=(await f.publish(await f.approve(await f.generate()))).campaign,input=await command(f,source),path='/api/promotions/'+source.id+'/derive',created=await f.ok<{campaign:PromotionCampaign}>(path,input),approved=await f.approve(created.campaign);
  await f.ok('/api/promotions/'+source.id+'/revoke',{expectedVersion:source.version,idempotencyKey:randomUUID()});
  const before=await counts(f);assert.deepEqual(await f.ok(path,input),created);assert.equal((await f.request(path,{...input,idempotencyKey:randomUUID()})).status,409);assert.equal((await f.request('/api/promotions/'+approved.id+'/publish',{...await f.batch(approved),targets:(await f.batch(approved)).targets.filter(t=>t.deviceId===f.b.id)})).status,409);assert.deepEqual(await counts(f),before);
 }finally{await f.close();}
});

test('missing provider configuration produces a truthful durable blocker without fake AI, draft or send',integration,async()=>{
 const f=await promotionFixture();try{
  const source=(await f.publish(await f.approve(await f.generate()))).campaign,input=await command(f,source,'this_table','regenerate'),before=await counts(f);
  delete process.env.BITPOS_AI_PROVIDER_URL;
  const generated=await f.ok<{job:PromotionJob}>('/api/promotions/'+source.id+'/derive',input);assert.equal(generated.job.state,'CONFIGURATION_REQUIRED');assert.equal(generated.job.blocker,'CONFIGURATION_REQUIRED');assert.equal(generated.job.provenance,null);assert.equal(generated.job.campaignId,null);assert.deepEqual(await counts(f),{...before,jobs:before.jobs+1});
 }finally{await f.close();}
});

test('final SQL send rejects an unreconciled table playlist after stock changes; canonical reconnect projection cannot revive it',integration,async()=>{
 const f=await promotionFixture();try{
  const source=(await f.publish(await f.approve(await f.generate()))).campaign,derived=(await f.ok<{campaign:PromotionCampaign}>('/api/promotions/'+source.id+'/derive',await command(f,source))).campaign;
  const edited=(await f.ok<{campaign:PromotionCampaign}>('/api/promotions/'+derived.id,{expectedVersion:derived.version,idempotencyKey:randomUUID(),discountPercent:20},f.owner,'PATCH')).campaign;await send(f,await f.approve(edited));
  const event=await f.event();await f.deliver(event);const actor=f.devices.get(f.b.id);assert.ok(actor);
  await f.inspect('UPDATE products SET stock=0 WHERE merchant_id=$1 AND id=$2',[f.merchant,f.product]);
  const result=(await f.inspect('SELECT bitpos.device_validate_send($1::uuid,$2::uuid,$3::text,$4::bigint,$5::bigint,$6::uuid,$7::uuid) AS result',[f.merchant,f.b.id,actor.tokenHash,actor.authGeneration,actor.connectionGeneration,actor.connectionId,event.id])).rows[0].result;assert.equal(result.allowed,false);
  const current=await f.ok<PromotionDeviceProjection>('/api/promotions/devices/'+f.b.id);assert.equal(current.playlist.items.some(i=>i.campaignId===derived.id),false);
  await f.reconcile();assert.equal((await f.playlist()).items.some(i=>i.campaignId===derived.id),false);assert.equal((await f.campaign(derived.id)).playlistTargets?.[0].state,'TARGET_CHANGED');
 }finally{await f.close();}
});

test('personal derivation preserves its acquired recipient/device proof and cannot become shared or table-wide pricing',integration,async()=>{
 const f=await promotionFixture();try{
  // Intentional opt-in loading: worker/config are unavailable for skipped integration tests.
  const {runPromotionJob}=await import('../apps/worker/src/promotions'),entry=await f.entry(),visit=await f.ok<{visitToken:string}>('/api/table/'+entry+'/visit',{requestId:randomUUID()},null),base='/api/table/'+entry+'/visit/'+visit.visitToken;
  await f.ok(base+'/quotes',{items:[{productId:f.product,qty:1}],confirmJoin:true},null);
  const binding=(await f.inspect('SELECT r.visit_id,o.generation::text FROM table_visit_recipients r JOIN table_occupancies o ON o.merchant_id=r.merchant_id AND o.id=r.occupancy_id JOIN table_visits v ON v.merchant_id=r.merchant_id AND v.id=r.visit_id WHERE r.merchant_id=$1 AND v.access_token=$2',[f.merchant,visit.visitToken])).rows[0],customer=(await f.inspect('INSERT INTO customers(merchant_id) VALUES($1) RETURNING id',[f.merchant])).rows[0].id;
  const generated=await f.ok<{job:PromotionJob}>('/api/promotions/generate',{...f.input,audience:'customer',daily:undefined,personal:{tableId:f.table.id,occupancyGeneration:binding.generation,recipientVisitId:binding.visit_id,customerId:customer,confirmRecipient:true},idempotencyKey:randomUUID()});
  await runPromotionJob(f.merchant,{kind:'fixture_provider',configuration:f.config,provider:response(f,undefined,undefined,15)});
  const completed=(await f.ok<{job:PromotionJob}>('/api/promotions/jobs/'+generated.job.id)).job;assert.equal(completed.state,'SUCCEEDED');assert.ok(completed.campaignId);const approved=await f.approve(await f.campaign(completed.campaignId)),batch=await f.batch(approved),source=(await f.publish(approved,{targets:batch.targets.filter(t=>t.deviceId===f.b.id)})).campaign;
  assert.equal((await f.request('/api/promotions/'+source.id+'/derive',await command(f,source,'all_campaign_devices'))).status,409);
  const derived=(await f.ok<{campaign:PromotionCampaign}>('/api/promotions/'+source.id+'/derive',await command(f,source))).campaign;assert.equal(derived.scope?.audience,'customer');assert.equal(derived.scope?.priceAuthority,'personal');assert.equal(derived.scope?.placement?.priceAuthority,'personal');assert.deepEqual(derived.scope?.binding,source.scope?.binding);assert.deepEqual(derived.provenance,source.provenance);
  await send(f,await f.approve(derived));assert.equal((await f.ok<EffectiveMenu>('/api/menu')).products[0].unitPrice?.amountMinor,'270');assert.equal((await f.ok<{menu:EffectiveMenu}>('/api/table/'+entry,undefined,null)).menu.products[0].unitPrice?.amountMinor,'270');
  const quote=(await f.ok<{quote:Quote}>(base+'/quotes',{items:[{productId:f.product,qty:1}]},null)).quote;assert.equal(quote.lines[0].unitPrice.amountMinor,'230');assert.equal(quote.lines[0].personalPromotion?.campaignId,derived.id);assert.equal(quote.lines[0].dailyPromotion,undefined);
 }finally{await f.close();}
});
