import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PromotionCampaign,PromotionDeviceProjection,PromotionJob} from '../packages/contracts/src/index';
import {promotionFixture,type PromotionFixtureAccess} from './backend-promotions-fixture';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1',timeout:180000};
// Skipped tests must not load private runtime configuration, DB or provider modules.
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
async function effects(f:PromotionFixtureAccess){
 return (await f.inspect(`SELECT
  (SELECT jsonb_agg(to_jsonb(j) ORDER BY j.id) FROM ai_generation_jobs j WHERE merchant_id=$1) AS jobs,
  (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM promotion_campaigns c WHERE merchant_id=$1) AS campaigns,
  (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.campaign_id,r.version) FROM promotion_revisions r WHERE merchant_id=$1) AS revisions,
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM promotion_playlist_targets t WHERE merchant_id=$1) AS targets,
  (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.event_id) FROM promotion_playlist_events e WHERE merchant_id=$1) AS publications,
  (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM outbox_events e WHERE merchant_id=$1) AS outbox`,[f.merchant])).rows[0];
}
async function receipt(f:PromotionFixtureAccess,c:PromotionCampaign,device:string){
 return (await f.inspect(`SELECT t.id,t.campaign_id AS "campaignId",t.campaign_version AS "campaignVersion",t.target_device_id AS "deviceId",t.audience,t.state,t.failure,t.rendered_at AS "renderedAt",r.content
  FROM promotion_playlist_targets t JOIN promotion_revisions r ON r.merchant_id=t.merchant_id AND r.campaign_id=t.campaign_id AND r.version=t.campaign_version
  WHERE t.merchant_id=$1 AND t.campaign_id=$2 AND t.target_device_id=$3`,[f.merchant,c.id,device])).rows[0];
}
function exactReceipt(view:PromotionDeviceProjection,c:PromotionCampaign,row:Record<string,any>){
 const projected=view.campaigns.find(candidate=>candidate.id===c.id);assert.ok(projected);
 const {content,...proof}=row;
 assert.deepEqual(projected.playlistTargets,[proof]);
 assert.equal(projected.approvedVersion,proof.campaignVersion);assert.equal(projected.version,c.version);assert.notEqual(projected.version,proof.campaignVersion);
 assert.equal(projected.headline,content.headline);assert.equal(projected.copy,content.copy);assert.equal(projected.discountPercent,content.discountPercent);
 assert.deepEqual(projected.provenance,c.provenance);assert.equal(projected.startsAt,c.startsAt);assert.equal(projected.previewUrl,c.previewUrl);assert.equal(projected.assetBlocker,c.assetBlocker);
 assert.equal(view.playlist.items.some(item=>item.campaignId===c.id),false,'A queued/deferred receipt is not a current playlist item');
 return projected;
}

test('actual HTTP future daily inspection returns exact queued, offline and busy receipts without selecting or sending them',integration,async()=>{
 const f=await promotionFixture();try{
  assert.equal((await f.command(f.c.id,{type:'CAPABILITIES',capabilities:['promotion_playlist_v1','pickup_ready_v1']})).result.ok,true);
  const approved=await f.approve(await f.generate({startsAt:new Date(Date.now()+1800000).toISOString(),expiresAt:new Date(Date.now()+7200000).toISOString()}));
  const batch=await f.batch(approved),a=batch.targets.find(t=>t.deviceId===f.a.id)!;
  assert.equal((await f.command(f.a.id,{type:'CART_OPEN',sessionId:randomUUID(),expectedScreenGeneration:a.screenGeneration,expectedAssignmentGeneration:a.assignmentGeneration,recoverSessionId:null})).result.ok,true);
  await f.inspect('UPDATE device_presence SET connected_until=NULL WHERE merchant_id=$1 AND device_id=$2',[f.merchant,f.b.id]);
  const sent=(await f.publish(approved)).campaign,before=await effects(f),calls=f.providerCalls();
  for(const [device,state] of [[f.a.id,'DEFERRED_BUSY'],[f.b.id,'DEFERRED_OFFLINE'],[f.c.id,'QUEUED']] as const){
   const row=await receipt(f,sent,device);assert.equal(row.state,state);assert.equal(row.renderedAt,null);
   const view=await f.ok<PromotionDeviceProjection>('/api/promotions/devices/'+device,undefined,f.staff);
   assert.equal(view.device.deviceId,device);assert.deepEqual(view.playlist.items,[]);assert.deepEqual(view.campaigns.map(c=>c.id),[sent.id]);exactReceipt(view,sent,row);
   await f.ok('/api/promotions/devices/'+device);assert.deepEqual(await effects(f),before,'Repeated GET creates no job, draft, revision, publication or outbox event');
  }
  assert.equal(f.providerCalls(),calls);
  assert.equal((await f.request('/api/promotions/devices/'+f.b.id,undefined,f.foreign)).status,404);
  assert.equal((await f.request('/api/promotions/devices/'+f.b.id,undefined,null)).status,401);
  assert.deepEqual(await effects(f),before);
 }finally{await f.close();}
});

test('actual HTTP personal overflow stays inspectable with its original recipient and exact deferred receipt, never current from history',integration,async()=>{
 const f=await promotionFixture();try{
  // Opt-in loading boundary: the worker statically imports required private runtime config.
  const {runPromotionJob}=await import('../apps/worker/src/promotions');
  const entry=await f.entry(),visit=await f.ok<{visitToken:string}>('/api/table/'+entry+'/visit',{requestId:randomUUID()},null);
  await f.ok('/api/table/'+entry+'/visit/'+visit.visitToken+'/quotes',{items:[{productId:f.product,qty:1}],confirmJoin:true},null);
  const acquired=(await f.inspect('SELECT r.visit_id,o.generation::text FROM table_visit_recipients r JOIN table_occupancies o ON o.merchant_id=r.merchant_id AND o.id=r.occupancy_id JOIN table_visits v ON v.merchant_id=r.merchant_id AND v.id=r.visit_id WHERE r.merchant_id=$1 AND v.access_token=$2',[f.merchant,visit.visitToken])).rows[0];
  const customer=(await f.inspect('INSERT INTO customers(merchant_id) VALUES($1) RETURNING id',[f.merchant])).rows[0].id;
  await f.inspect('UPDATE device_presence SET connected_until=NULL WHERE merchant_id=$1 AND device_id=$2',[f.merchant,f.b.id]);
  async function personal(){
   const generated=await f.ok<{job:PromotionJob}>('/api/promotions/generate',{...f.input,audience:'customer',daily:undefined,personal:{tableId:f.table.id,occupancyGeneration:acquired.generation,recipientVisitId:acquired.visit_id,customerId:customer,confirmRecipient:true},idempotencyKey:randomUUID()});
   await runPromotionJob(f.merchant,{kind:'fixture_provider',configuration:f.config,provider:async job=>({kind:'fixture_provider',provider:new URL(f.config.url).origin,model:f.config.model,requestId:'projection-fixture-'+job.jobId,candidate:{productId:f.product,headline:'Personal projection fixture',copy:'Controlled provider, not actual AI',discountPercent:15,rationale:'Original acquired recipient fixture'}})});
   const completed=(await f.ok<{job:PromotionJob}>('/api/promotions/jobs/'+generated.job.id)).job;assert.equal(completed.state,'SUCCEEDED');assert.ok(completed.campaignId);
   const approved=await f.approve(await f.campaign(completed.campaignId)),batch=await f.batch(approved);
   return (await f.publish(approved,{targets:batch.targets.filter(t=>t.deviceId===f.b.id)})).campaign;
  }
  const older=await personal(),newer=await personal(),row=await receipt(f,older,f.b.id);assert.equal(row.state,'DEFERRED_OFFLINE');
  const draft=await f.generate(),before=await effects(f);
  const view=await f.ok<PromotionDeviceProjection>('/api/promotions/devices/'+f.b.id,undefined,f.staff);
  assert.equal(view.playlist.items.length,1);assert.equal(view.playlist.items[0].campaignId,newer.id);assert.equal(view.playlist.items[0].audience,'personal');
  assert.deepEqual(view.campaigns.map(c=>c.id).sort(),[older.id,newer.id].sort());assert.equal(view.campaigns.some(c=>c.id===draft.id),false,'An unpublished campaign is not device-associated');
  const projected=exactReceipt(view,older,row);assert.deepEqual(projected.scope?.binding,older.scope?.binding);assert.equal(projected.scope?.binding?.recipientVisitId,acquired.visit_id);assert.equal(projected.scope?.binding?.customerId,customer);assert.equal(projected.scope?.binding?.targetDeviceId,f.b.id);
  const otherDevice=await f.ok<PromotionDeviceProjection>('/api/promotions/devices/'+f.a.id);assert.deepEqual(otherDevice.campaigns,[]);assert.deepEqual(otherDevice.playlist.items,[]);
  await f.ok('/api/promotions/devices/'+f.b.id);assert.deepEqual(await effects(f),before);
  assert.equal((await f.request('/api/promotions/devices/'+f.b.id,undefined,f.foreign)).status,404);
  await f.ok('/api/promotions/'+older.id+'/revoke',{expectedVersion:older.version,idempotencyKey:randomUUID()});
  const revokedBefore=await effects(f),live=await f.ok<PromotionDeviceProjection>('/api/promotions/devices/'+f.b.id);
  assert.deepEqual(live.campaigns.map(c=>c.id),[newer.id]);assert.equal(live.playlist.items.some(item=>item.campaignId===older.id),false);assert.deepEqual(await effects(f),revokedBefore);
 }finally{await f.close();}
});

test('actual HTTP inspection bounds live campaigns and exact receipts independently while retaining the canonical current item',integration,async()=>{
 const f=await promotionFixture();try{
  await f.inspect('UPDATE device_presence SET connected_until=NULL WHERE merchant_id=$1 AND device_id=$2',[f.merchant,f.b.id]);
  const source=(await f.publish(await f.approve(await f.generate()))).campaign,original=await receipt(f,source,f.b.id);
  const jobs=Array.from({length:101},()=>randomUUID()),campaigns=jobs.map(()=>randomUUID()),targets=jobs.map(()=>randomUUID());
  // Controlled set-based DB fixtures exercise the real HTTP bound without 101 provider calls.
  // Each has an approved immutable revision and real device fence; all starts remain future.
  await f.inspect(`INSERT INTO ai_generation_jobs(merchant_id,id,state,actor_id,input,products,blocker)
   SELECT $1,id,'CONFIGURATION_REQUIRED',$3,'{}','[]','CONFIGURATION_REQUIRED' FROM unnest($2::uuid[]) id`,[f.merchant,jobs,f.actor]);
  await f.inspect(`INSERT INTO promotion_campaigns(merchant_id,id,job_id,version,state,product_id,headline,copy,rationale,discount_percent,max_discount_percent,snapshot,starts_at,expires_at,asset_token,asset_blocker,provenance,approved_version)
   SELECT c.merchant_id,n.id,n.job,c.version,c.state,c.product_id,c.headline,c.copy,c.rationale,c.discount_percent,c.max_discount_percent,c.snapshot,clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '2 hours',c.asset_token,c.asset_blocker,c.provenance,c.approved_version
   FROM promotion_campaigns c CROSS JOIN unnest($3::uuid[],$4::uuid[]) n(id,job) WHERE c.merchant_id=$1 AND c.id=$2`,[f.merchant,source.id,campaigns,jobs]);
  await f.inspect(`INSERT INTO promotion_revisions(merchant_id,campaign_id,version,content,approved_by)
   SELECT r.merchant_id,n.id,r.version,r.content,r.approved_by FROM promotion_revisions r CROSS JOIN unnest($3::uuid[]) n(id)
   WHERE r.merchant_id=$1 AND r.campaign_id=$2 AND r.version=$4`,[f.merchant,source.id,campaigns,source.approvedVersion]);
  await f.inspect(`INSERT INTO promotion_scopes(merchant_id,campaign_id,audience,context,minimum_unit_minor)
   SELECT s.merchant_id,n.id,s.audience,s.context,s.minimum_unit_minor FROM promotion_scopes s CROSS JOIN unnest($3::uuid[]) n(id)
   WHERE s.merchant_id=$1 AND s.campaign_id=$2`,[f.merchant,source.id,campaigns]);
  await f.inspect(`INSERT INTO promotion_playlist_targets(merchant_id,id,campaign_id,campaign_version,audience,target_device_id,assignment_generation,auth_generation,state,expires_at,created_at)
   SELECT t.merchant_id,n.id,n.campaign,t.campaign_version,t.audience,t.target_device_id,t.assignment_generation,t.auth_generation,'DEFERRED_OFFLINE',clock_timestamp()+interval '2 hours',statement_timestamp()+n.ordinality*interval '1 millisecond'
   FROM promotion_playlist_targets t CROSS JOIN unnest($3::uuid[],$4::uuid[]) WITH ORDINALITY n(id,campaign,ordinality)
   WHERE t.merchant_id=$1 AND t.id=$2`,[f.merchant,original.id,targets,campaigns]);
  assert.equal((await f.inspect('SELECT count(*)::int AS n FROM promotion_playlist_targets WHERE merchant_id=$1 AND target_device_id=$2 AND bitpos.playlist_target_current(merchant_id,id)',[f.merchant,f.b.id])).rows[0].n,102);
  const before=await effects(f),view=await f.ok<PromotionDeviceProjection>('/api/promotions/devices/'+f.b.id);
  assert.deepEqual(view.playlist.items.map(item=>item.campaignId),[source.id]);
  assert.equal(view.campaigns.length,100);
  assert.deepEqual(view.campaigns.map(c=>c.id).sort(),[source.id,...campaigns.slice(2)].sort());
  assert.deepEqual(view.campaigns.flatMap(c=>c.playlistTargets??[]).map(t=>t.id).sort(),[original.id,...targets.slice(2)].sort());
  assert.ok(view.campaigns.every(c=>c.playlistTargets?.length===1&&c.playlistTargets[0].deviceId===f.b.id&&c.playlistTargets[0].campaignVersion===c.approvedVersion));
  assert.deepEqual(await effects(f),before);
  const repeated=await f.ok<PromotionDeviceProjection>('/api/promotions/devices/'+f.b.id);assert.deepEqual(repeated,view);assert.deepEqual(await effects(f),before);
 }finally{await f.close();}
});
