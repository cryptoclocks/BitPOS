import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PromotionCampaign,PromotionDeviceProjection,PromotionDerive,Quote,OrderView,TableClearResult,DeviceCommandResult} from '../packages/contracts/src/index';
import type {EffectiveMenu} from '../apps/api/src/offers';
import type {DeviceActor} from '../apps/api/src/device-commands';
import {promotionFixture} from './backend-promotions-fixture';
import type {PromotionFixtureAccess,PromotionFixtureEvent} from './backend-promotions-fixture';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1',timeout:120000};
// Skipped integrations must not import private runtime configuration.
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
interface Fixture extends PromotionFixtureAccess {
 a:{id:string};c:{id:string};table:{id:string};register:{id:string};owner:string;devices:Map<string,DeviceActor>;
 reg(path:string,method:string,input:unknown):Promise<unknown>;
 generate():Promise<PromotionCampaign>;
 approve(c:PromotionCampaign):Promise<PromotionCampaign>;
 campaign(id:string):Promise<PromotionCampaign>;
 request<T>(path:string,input?:unknown):Promise<{status:number;value:T}>;
 create(q:Quote):Promise<{order:OrderView}>;
 quote():Promise<Quote>;
 entry():Promise<string>;
 event():Promise<PromotionFixtureEvent>;
 deliver(event:PromotionFixtureEvent):Promise<void>;
 reconcile():Promise<void>;
 command(device:string,body:Record<string,unknown>):Promise<DeviceCommandResult>;
}
const live=['QUEUED','DEFERRED_BUSY','DEFERRED_OFFLINE','DELIVERED','RENDERED','UNSUPPORTED'];
async function projection(f:Fixture){return f.ok<PromotionDeviceProjection>('/api/promotions/devices/'+f.b.id);}
async function source(f:Fixture,oneDevice=false){
 if(oneDevice){
  await f.reg('/api/devices/'+f.a.id,'PATCH',{revoked:true});await f.reg('/api/devices/'+f.c.id,'PATCH',{revoked:true});
  await f.reg('/api/registers/'+f.register.id+'/pairing','PUT',{deviceId:f.b.id,expectedPairingGeneration:'2'});
 }
 const c=(await f.publish(await f.approve(await f.generate()))).campaign;
 assert.equal(c.playlistTargets?.length,oneDevice?1:3);return c;
}
async function localDraft(f:Fixture,c:PromotionCampaign,percent=20){
 const {device}=await projection(f);
 const input:PromotionDerive={expectedVersion:c.version,idempotencyKey:randomUUID(),scope:'this_table',mode:'edit',confirmScope:true,device:{deviceId:device.deviceId,assignmentGeneration:device.assignmentGeneration,authGeneration:device.authGeneration,screenGeneration:device.screenGeneration}};
 const draft=(await f.ok<{campaign:PromotionCampaign}>('/api/promotions/'+c.id+'/derive',input)).campaign;
 const edited=(await f.ok<{campaign:PromotionCampaign}>('/api/promotions/'+draft.id,{expectedVersion:draft.version,idempotencyKey:randomUUID(),discountPercent:percent},f.owner,'PATCH')).campaign;
 const approved=await f.approve(edited);
 return {approved};
}
async function sendLocal(f:Fixture,c:PromotionCampaign){const batch=await f.batch(c);return (await f.publish(c,{targets:batch.targets.filter(t=>t.deviceId===f.b.id)})).campaign;}
async function local(f:Fixture,c:PromotionCampaign,percent=20){return sendLocal(f,(await localDraft(f,c,percent)).approved);}
async function revoke(f:Fixture,c:PromotionCampaign){await f.ok('/api/promotions/'+c.id+'/revoke',{expectedVersion:c.version,idempotencyKey:randomUUID()});}
async function clear(f:Fixture){const entry=await f.entry(),view=await f.ok<{occupancy:{generation:string}}>('/api/table/'+entry,undefined,null);return f.ok<TableClearResult>('/api/tables/'+f.table.id+'/clear',{expectedGeneration:view.occupancy.generation,idempotencyKey:randomUUID(),confirmClear:true});}
async function finalSend(f:Fixture,event:PromotionFixtureEvent){
 const a=f.devices.get(f.b.id);assert.ok(a);
 return (await f.inspect('SELECT bitpos.device_validate_send($1::uuid,$2::uuid,$3::text,$4::bigint,$5::bigint,$6::uuid,$7::uuid) AS result',[f.merchant,f.b.id,a.tokenHash,a.authGeneration,a.connectionGeneration,a.connectionId,event.id])).rows[0].result;
}
async function ack(f:Fixture,event:PromotionFixtureEvent){return f.command(f.b.id,{type:'ACK',eventId:event.id,deviceSeq:String(event.device_seq),orderId:null,orderVersion:null,screenGeneration:String(event.screen_generation),rendered:true});}
async function reconnectPlaylist(f:Fixture){
 const a=f.devices.get(f.b.id);assert.ok(a);
 return (await f.inspect('SELECT bitpos.device_stream_probe($1::uuid,$2::uuid,$3::text,$4::bigint,$5::bigint,$6::uuid) AS result',[f.merchant,f.b.id,a.tokenHash,a.authGeneration,a.connectionGeneration,a.connectionId])).rows[0].result.promotion_playlist;
}
async function receipt(f:Fixture,c:PromotionCampaign){return (await f.inspect('SELECT * FROM promotion_playlist_targets WHERE merchant_id=$1 AND campaign_id=$2 AND target_device_id=$3',[f.merchant,c.id,f.b.id])).rows[0];}
async function publicPrice(f:Fixture,c:PromotionCampaign){
 const menu=await f.ok<EffectiveMenu>('/api/menu');assert.equal(menu.products[0].unitPrice?.amountMinor,'230');assert.equal(menu.products[0].dailyPromotion?.campaignId,c.id);
 const q=await f.ok<Quote>('/api/registers/'+f.register.id+'/quotes',{items:[{productId:f.product,qty:1}],serving:{kind:'counter'}});assert.equal(q.total.amountMinor,'230');assert.equal(q.lines[0].dailyPromotion?.campaignId,c.id);
 return q;
}
async function restored(f:Fixture,c:PromotionCampaign,originalTarget:string,previousGeneration:string){
 const view=await projection(f);assert.deepEqual(view.playlist.items.map(i=>i.campaignId),[c.id]);assert.equal(view.playlist.items[0].targetId,originalTarget);assert.equal(view.playlist.items[0].unitPrice.amountMinor,'230');assert.ok(BigInt(view.playlist.generation)>BigInt(previousGeneration));
 const target=await receipt(f,c);assert.ok(live.includes(target.state));assert.equal(target.failure,null);
 assert.equal((await f.inspect('SELECT bitpos.playlist_target_current($1::uuid,$2::uuid) AS current',[f.merchant,originalTarget])).rows[0].current,true);
 await f.reconcile();assert.deepEqual(await reconnectPlaylist(f),view.playlist);return view.playlist;
}

test('one-device local override retains the last public destination, counter price, exact source authority and frozen bill',integration,async()=>{
 const f=await promotionFixture();try{
  const c=await source(f,true);
  const oldQuote=await publicPrice(f,c),oldBill=await f.create(oldQuote),financialBefore=(await f.inspect('SELECT * FROM daily_order_promotions WHERE merchant_id=$1 ORDER BY order_id,product_id',[f.merchant])).rows;
  await projection(f);const before=await f.campaign(c.id),targetBefore=await receipt(f,c),originalTarget=targetBefore.id;
  const fork=await local(f,c),view=await projection(f);
  assert.deepEqual(view.playlist.items.map(i=>i.campaignId),[fork.id]);assert.equal(view.playlist.items[0].unitPrice.amountMinor,'216');
  const menu=await f.ok<{menu:EffectiveMenu}>('/api/table/'+await f.entry(),undefined,null);assert.equal(menu.menu.products[0].unitPrice?.amountMinor,'216');assert.equal(menu.menu.products[0].dailyPromotion?.campaignId,fork.id);
  await publicPrice(f,c);assert.deepEqual(await f.campaign(c.id),before);assert.deepEqual(await receipt(f,c),targetBefore);
  assert.equal((await f.inspect('SELECT bitpos.playlist_target_current($1::uuid,$2::uuid) AS current',[f.merchant,originalTarget])).rows[0].current,true);
  assert.deepEqual((await f.ok<OrderView>('/api/orders/'+oldBill.order.id)).pricing,oldBill.order.pricing);assert.equal(oldBill.order.pricing.total.amountMinor,'230');
  assert.deepEqual((await f.inspect('SELECT * FROM daily_order_promotions WHERE merchant_id=$1 ORDER BY order_id,product_id',[f.merchant])).rows,financialBefore);
  await f.reconcile();await projection(f);assert.equal((await receipt(f,c)).id,originalTarget);assert.ok(live.includes((await receipt(f,c)).state));
 }finally{await f.close();}
});

test('canonical clear restores the original shared receipt under new occupancy, screen and playlist generations; old sends, ACKs and local drafts cannot return',integration,async()=>{
 const f=await promotionFixture();try{
  const c=await source(f),sourceEvent=await f.event();await f.deliver(sourceEvent);
  const targetBefore=await receipt(f,c),otherBefore=(await f.inspect('SELECT * FROM device_promotion_playlist_state WHERE merchant_id=$1 AND device_id=$2',[f.merchant,f.a.id])).rows[0];
  const pending=await localDraft(f,c),fork=await local(f,c),localView=await projection(f),oldLocalEvent=await f.event();await f.deliver(oldLocalEvent);
  assert.deepEqual(localView.playlist.items.map(i=>i.campaignId),[fork.id]);assert.equal((await finalSend(f,oldLocalEvent)).allowed,true);
  const result=await clear(f),playlist=await restored(f,c,targetBefore.id,localView.playlist.generation);
  assert.equal(playlist.occupancyGeneration,result.generation);assert.notEqual(playlist.occupancyGeneration,localView.playlist.occupancyGeneration);
  assert.deepEqual((await f.inspect('SELECT * FROM device_promotion_playlist_state WHERE merchant_id=$1 AND device_id=$2',[f.merchant,f.a.id])).rows[0],otherBefore);
  assert.equal((await finalSend(f,sourceEvent)).allowed,false);assert.equal((await finalSend(f,oldLocalEvent)).allowed,false);assert.equal((await ack(f,sourceEvent)).result.ok,false);assert.equal((await ack(f,oldLocalEvent)).result.ok,false);
  const batch=await f.batch(pending.approved);assert.equal((await f.request('/api/promotions/'+pending.approved.id+'/publish',{...batch,targets:batch.targets.filter(t=>t.deviceId===f.b.id)})).status,409);
  const freshEvent=await f.event();assert.notEqual(freshEvent.id,oldLocalEvent.id);assert.deepEqual(freshEvent.payload.payload,playlist);await f.deliver(freshEvent);assert.equal((await finalSend(f,freshEvent)).allowed,true);assert.equal((await ack(f,freshEvent)).result.ok,true);
  assert.equal((await receipt(f,c)).state,'RENDERED');assert.equal((await receipt(f,fork)).state,'TARGET_CHANGED');await publicPrice(f,c);
 }finally{await f.close();}
});

for(const ending of ['expiry','revoke'] as const)test('local '+ending+' restores only the still-valid shared baseline, without a new source receipt',integration,async()=>{
 const f=await promotionFixture();try{
  const c=await source(f,true),original=await receipt(f,c),fork=await local(f,c),before=await projection(f);
  assert.deepEqual(before.playlist.items.map(i=>i.campaignId),[fork.id]);
  const oldLocalEvent=await f.event();await f.deliver(oldLocalEvent);assert.equal((await finalSend(f,oldLocalEvent)).allowed,true);
  if(ending==='revoke')await revoke(f,fork);
  else await f.inspect("UPDATE promotion_campaigns SET starts_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '1 second' WHERE merchant_id=$1 AND id=$2",[f.merchant,fork.id]);
  await restored(f,c,original.id,before.playlist.generation);await publicPrice(f,c);
  assert.equal((await finalSend(f,oldLocalEvent)).allowed,false);assert.equal((await ack(f,oldLocalEvent)).result.ok,false);
  assert.equal((await receipt(f,fork)).state,ending==='revoke'?'REVOKED':'EXPIRED');
  assert.equal((await f.inspect('SELECT count(*)::int AS n FROM promotion_playlist_targets WHERE merchant_id=$1 AND campaign_id=$2',[f.merchant,c.id])).rows[0].n,1);
  const menu=await f.ok<{menu:EffectiveMenu}>('/api/table/'+await f.entry(),undefined,null);assert.equal(menu.menu.products[0].unitPrice?.amountMinor,'230');assert.equal(menu.menu.products[0].dailyPromotion?.campaignId,c.id);
 }finally{await f.close();}
});

for(const invalidation of ['source_revoke','source_expiry','stale_catalog','terminal_target'] as const)test('clear never resurrects a '+invalidation+' baseline after a local override',integration,async()=>{
 const f=await promotionFixture();try{
  const c=await source(f,true),original=await receipt(f,c),fork=await local(f,c);assert.deepEqual((await projection(f)).playlist.items.map(i=>i.campaignId),[fork.id]);
  if(invalidation==='source_revoke')await revoke(f,c);
  else if(invalidation==='source_expiry')await f.inspect("UPDATE promotion_campaigns SET starts_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '1 second' WHERE merchant_id=$1 AND id=$2",[f.merchant,c.id]);
  else if(invalidation==='stale_catalog'){
   await f.inspect("UPDATE products SET image_url='/images/menu/changed-fixture.jpg' WHERE merchant_id=$1 AND id=$2",[f.merchant,f.product]);
   assert.deepEqual((await projection(f)).playlist.items,[]);assert.equal((await receipt(f,c)).state,'TARGET_CHANGED');
   // Returning the old catalog must not reactivate a terminal publication.
   await f.inspect("UPDATE products SET image_url='/images/menu/espresso.jpg' WHERE merchant_id=$1 AND id=$2",[f.merchant,f.product]);
  }else await f.inspect("UPDATE promotion_playlist_targets SET state='REVOKED',failure='EXPLICIT_FIXTURE_REVOKE' WHERE merchant_id=$1 AND id=$2",[f.merchant,original.id]);
  await clear(f);assert.deepEqual((await projection(f)).playlist.items,[]);await f.reconcile();assert.deepEqual((await reconnectPlaylist(f)).items,[]);
  const target=await receipt(f,c);assert.equal(target.id,original.id);assert.equal(target.state,invalidation==='source_expiry'?'EXPIRED':invalidation==='stale_catalog'?'TARGET_CHANGED':'REVOKED');
  assert.equal((await f.inspect('SELECT bitpos.playlist_target_current($1::uuid,$2::uuid) AS current',[f.merchant,original.id])).rows[0].current,false);
  const menu=await f.ok<EffectiveMenu>('/api/menu');assert.equal(menu.products[0].unitPrice?.amountMinor,'270');assert.equal(menu.products[0].dailyPromotion,undefined);
  assert.equal((await f.quote()).total.amountMinor,'270');assert.equal((await f.inspect('SELECT count(*)::int AS n FROM promotion_playlist_targets WHERE merchant_id=$1 AND campaign_id=$2',[f.merchant,c.id])).rows[0].n,1);
 }finally{await f.close();}
});
