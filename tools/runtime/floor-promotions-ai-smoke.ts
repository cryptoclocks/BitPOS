import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parse} from 'dotenv';
import {promotionFixture} from '../../tests/backend-promotions-fixture';
import type {PromotionDeviceProjection,PromotionJob} from '../../packages/contracts/src/index';

// Explicit coordinator-only opt-in. A disposable fixture source is clearly labeled;
// only the derived job calls the genuine authorized adapter, once, without send.
if(process.env.BITPOS_FLOOR_REAL_AI_SMOKE!=='1')throw Error('Explicit bounded real-provider authorization required');
const privateFile=process.env.BITPOS_PRIVATE_PROVIDER_FILE;
if(!privateFile||privateFile.startsWith(process.cwd()+'/'))throw Error('Existing provider configuration must stay outside repository');
const privateEnv=parse(fs.readFileSync(privateFile));
const f=await promotionFixture();
try{
 const source=(await f.publish(await f.approve(await f.generate()))).campaign;
 const before=(await f.inspect('SELECT count(*)::int AS n FROM promotion_playlist_targets WHERE merchant_id=$1',[f.merchant])).rows[0].n;
 for(const key of ['BITPOS_AI_PROVIDER_URL','BITPOS_AI_MODEL','BITPOS_AI_API_KEY']){
  assert.ok(privateEnv[key]);process.env[key]=privateEnv[key];
 }
 process.env.BITPOS_AI_JOB_BUDGET_MICROUSD='1000';process.env.BITPOS_AI_DAILY_BUDGET_MICROUSD='20000';
 const {device}=await f.ok<PromotionDeviceProjection>('/api/promotions/devices/'+f.b.id);
 const {job}=await f.ok<{job:PromotionJob}>('/api/promotions/'+source.id+'/derive',{
  expectedVersion:source.version,idempotencyKey:randomUUID(),scope:'all_campaign_devices',mode:'regenerate',confirmScope:true,
  device:{deviceId:device.deviceId,assignmentGeneration:device.assignmentGeneration,authGeneration:device.authGeneration,screenGeneration:device.screenGeneration},
 });
 const {runPromotionJob}=await import('../../apps/worker/src/promotions');
 await runPromotionJob(f.merchant); // Production adapter; no fixture injection or retry.
 const result=(await f.ok<{job:PromotionJob}>('/api/promotions/jobs/'+job.id)).job;
 const details=(await f.inspect('SELECT attempts,reserved_microusd::text FROM ai_generation_jobs WHERE merchant_id=$1 AND id=$2',[f.merchant,job.id])).rows[0];
 const campaign=result.campaignId?await f.campaign(result.campaignId):null;
 assert.equal((await f.inspect('SELECT count(*)::int AS n FROM promotion_playlist_targets WHERE merchant_id=$1',[f.merchant])).rows[0].n,before);
 assert.deepEqual(await f.campaign(source.id),source);
 if(campaign){assert.equal(campaign.state,'DRAFT');assert.equal(campaign.scope?.origin,'ai_regenerated');assert.equal(campaign.provenance.kind,'provider');assert.equal(campaign.provenance.jobId,job.id);assert.equal(details.attempts,1);}
 const receipt={scope:'promotions-floorplan-20261013',origin:'actual_existing_authorized_Gemini_Free_regeneration',source:'explicit disposable fixture campaign, not live merchant publication',job:result,details,campaign:campaign?{id:campaign.id,state:campaign.state,provenance:campaign.provenance,placement:campaign.scope?.placement,headline:campaign.headline,copy:campaign.copy}:null,automaticallyPublished:false,sourceUnchanged:true,newPublicationTargets:0,chainTransactions:0};
 fs.mkdirSync('.omp/work/promotions-floorplan-20261013/evidence',{recursive:true});
 fs.writeFileSync('.omp/work/promotions-floorplan-20261013/evidence/real-ai-regeneration.json',JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({state:result.state,blocker:result.blocker,attempts:details.attempts,actualProvider:campaign?.provenance.kind==='provider',newPublicationTargets:0}));
 if(!campaign)process.exitCode=2;
}finally{await f.close();const {pool}=await import('../../apps/api/src/db');await pool.end();}
