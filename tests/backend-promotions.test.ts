import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PromotionCampaign,PromotionJob,PromotionsView,Quote,OrderView} from '../packages/contracts/src/index';
import type {EffectiveMenu} from '../apps/api/src/offers';
import {promotionFixture} from './backend-promotions-fixture';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
// Intentional opt-in module loading: skipped integration tests cannot require private config.
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
const mutation=(version:number)=>({expectedVersion:version,idempotencyKey:randomUUID()});
test('durable daily draft records fixture provenance/context; generation and approval never publish or change public prices',integration,async()=>{
 const f=await promotionFixture();try{
  const before=(await f.inspect('SELECT (SELECT count(*)::int FROM versioned_product_offers WHERE merchant_id=$1) AS offers,(SELECT count(*)::int FROM outbox_events WHERE merchant_id=$1) AS events',[f.merchant])).rows[0];
  const c=await f.generate();assert.equal(c.state,'DRAFT');assert.deepEqual(c.provenance,{kind:'fixture_provider',provider:new URL(f.config.url).origin,model:f.config.model,requestId:'controlled-fixture-'+c.provenance.jobId,jobId:c.provenance.jobId});assert.equal(c.targets.length,0);assert.deepEqual(c.playlistTargets,[]);assert.equal(c.unitPrice.amountMinor,'230');assert.equal(c.scope?.audience,'daily');assert.equal(c.scope?.minimumUnitMinor,'1');
  assert.equal(c.scope?.context.kind,'daily');if(c.scope?.context.kind==='daily'){assert.equal(c.scope.context.timezone,'Asia/Bangkok');assert.equal(c.scope.context.lookbackWeeks,6);assert.equal(c.scope.context.sparseHistory,true);assert.equal(c.scope.context.verifiedPaidOrderCount,0);}
  const approved=await f.approve(c);assert.equal(approved.state,'APPROVED');assert.deepEqual(approved.playlistTargets,[]);
  const after=(await f.inspect('SELECT (SELECT count(*)::int FROM versioned_product_offers WHERE merchant_id=$1) AS offers,(SELECT count(*)::int FROM outbox_events WHERE merchant_id=$1) AS events',[f.merchant])).rows[0];assert.deepEqual(after,before);
  const menu=await f.ok<EffectiveMenu>('/api/menu');assert.equal(menu.products[0].unitPrice?.amountMinor,'270');assert.equal(menu.products[0].dailyPromotion,undefined);assert.equal((await f.quote()).total.amountMinor,'270');
  delete process.env.BITPOS_AI_API_KEY;const data={...f.input,idempotencyKey:randomUUID()};const blocked=await f.ok<{job:PromotionJob}>('/api/promotions/generate',data);assert.equal(blocked.job.state,'CONFIGURATION_REQUIRED');assert.equal(blocked.job.blocker,'CONFIGURATION_REQUIRED');assert.deepEqual(await f.ok('/api/promotions/generate',data),blocked);
  assert.deepEqual((await f.inspect('SELECT reserved_microusd::text,attempts FROM ai_generation_jobs WHERE id=$1',[blocked.job.id])).rows[0],{reserved_microusd:'0',attempts:0});
  const conflict=await f.request<{error:{code:string}}>('/api/promotions/generate',{...data,goal:'Changed request'});assert.equal(conflict.value.error.code,'IDEMPOTENCY_CONFLICT');
  const denied=await f.request<{error:{code:string}}>('/api/promotions/generate',data,f.staff);assert.equal(denied.status,403);assert.equal(denied.value.error.code,'ROLE_REQUIRED');assert.equal((await f.request('/api/promotions/'+c.id,undefined,f.foreign)).status,404);
 }finally{await f.close();}
});
test('preview/approval stock fences and immutable approved version; explicit ALL exact-fenced daily batch supports staff lost-response replay',integration,async()=>{
 const f=await promotionFixture();try{
  let c=await f.generate();assert.equal((await f.request('/api/promotions/'+c.id,{...mutation(c.version),unitPrice:'1'},f.owner,'PATCH')).status,422);
  await f.inspect('UPDATE products SET stock=stock-1 WHERE merchant_id=$1 AND id=$2',[f.merchant,f.product]);
  const stale=await f.request<{error:{code:string}}>('/api/promotions/'+c.id+'/approve',mutation(c.version));assert.equal(stale.value.error.code,'PROMOTION_REVIEW_REQUIRED');
  const previewBody=mutation(c.version),preview=await f.ok<{campaign:PromotionCampaign}>('/api/promotions/'+c.id+'/preview',previewBody);c=preview.campaign;assert.equal(c.stockSnapshot,19);assert.equal(c.state,'DRAFT');assert.deepEqual(await f.ok('/api/promotions/'+c.id+'/preview',previewBody),preview);
  assert.equal((await f.request('/api/promotions/'+c.id+'/approve',mutation(c.version),f.staff)).status,403);c=await f.approve(c);const payload=await f.batch(c);
  assert.deepEqual(payload.targets.map(t=>t.deviceId).sort(),[f.a.id,f.b.id,f.c.id].sort());
  for(const fence of ['assignmentGeneration','authGeneration','screenGeneration'] as const){
   const wrong=await f.request<{error:{code:string}}>('/api/promotions/'+c.id+'/publish',{...payload,idempotencyKey:randomUUID(),targets:payload.targets.map((t,i)=>i? t:{...t,[fence]:'9007199254740993'})});assert.equal(wrong.value.error.code,'PROMOTION_TARGET_CHANGED');
  }
  const subset=await f.request<{error:{code:string}}>('/api/promotions/'+c.id+'/publish',{...payload,idempotencyKey:randomUUID(),targets:payload.targets.slice(1)});assert.equal(subset.value.error.code,'PROMOTION_TARGET_CHANGED');
  assert.equal((await f.request('/api/promotions/'+c.id+'/publish',{...payload,targets:[payload.targets[0],payload.targets[0]]})).status,422);assert.equal((await f.request('/api/promotions/'+c.id+'/publish',{...payload,confirmTargets:false})).status,422);
  assert.equal((await f.inspect('SELECT count(*)::int AS n FROM promotion_playlist_targets WHERE merchant_id=$1',[f.merchant])).rows[0].n,0);
  const sent=await f.ok<{campaign:PromotionCampaign}>('/api/promotions/'+c.id+'/publish',payload,f.staff);assert.equal(sent.campaign.version,c.version+1);assert.equal(sent.campaign.targets.length,0);assert.equal(sent.campaign.playlistTargets?.length,3);assert.ok(sent.campaign.playlistTargets?.every(t=>t.campaignVersion===c.version));assert.equal(sent.campaign.playlistTargets?.find(t=>t.deviceId===f.c.id)?.state,'UNSUPPORTED');
  assert.deepEqual(await f.ok('/api/promotions/'+c.id+'/publish',payload,f.staff),sent,'retry the frozen exact batch after a lost response, not a newly selected batch');
  const effects=(await f.inspect("SELECT (SELECT count(*)::int FROM promotion_playlist_targets WHERE merchant_id=$1) AS targets,(SELECT count(*)::int FROM outbox_events WHERE merchant_id=$1 AND type='PROMOTION_PLAYLIST') AS events",[f.merchant])).rows[0];assert.deepEqual(effects,{targets:3,events:2});await f.reconcile(f.a.id);await f.reconcile();assert.deepEqual((await f.inspect("SELECT (SELECT count(*)::int FROM promotion_playlist_targets WHERE merchant_id=$1) AS targets,(SELECT count(*)::int FROM outbox_events WHERE merchant_id=$1 AND type='PROMOTION_PLAYLIST') AS events",[f.merchant])).rows[0],effects);
  assert.equal((await f.inspect("SELECT count(*)::int AS n FROM outbox_events WHERE merchant_id=$1 AND type='PROMOTION'",[f.merchant])).rows[0].n,0,'clean cutover publishes no new legacy QR/token event');
 }finally{await f.close();}
});
test('daily ALL batch retains busy, offline and unsupported devices without failing or granting scoped eligibility',integration,async()=>{
 const f=await promotionFixture();try{
  const c=await f.approve(await f.generate()),payload=await f.batch(c),a=payload.targets.find(t=>t.deviceId===f.a.id)!;
  assert.equal((await f.command(f.a.id,{type:'CART_OPEN',sessionId:randomUUID(),expectedScreenGeneration:a.screenGeneration,expectedAssignmentGeneration:a.assignmentGeneration,recoverSessionId:null})).result.ok,true);
  await f.inspect('UPDATE device_presence SET connected_until=NULL WHERE merchant_id=$1 AND device_id=$2',[f.merchant,f.b.id]);
  const list=await f.ok<PromotionsView>('/api/promotions');assert.equal(list.devices.find(d=>d.deviceId===f.a.id)?.busy,true);assert.equal(list.devices.find(d=>d.deviceId===f.b.id)?.online,false);assert.equal(list.devices.find(d=>d.deviceId===f.c.id)?.capable,false);
  const sent=await f.publish(c);assert.deepEqual(Object.fromEntries(sent.campaign.playlistTargets!.map(t=>[t.deviceId,t.state])),{[f.a.id]:'DEFERRED_BUSY',[f.b.id]:'DEFERRED_OFFLINE',[f.c.id]:'UNSUPPORTED'});assert.equal(sent.campaign.targets.length,0);
  assert.equal((await f.inspect("SELECT count(*)::int AS n FROM outbox_events WHERE merchant_id=$1 AND type='PROMOTION_PLAYLIST'",[f.merchant])).rows[0].n,0);assert.equal((await f.quote()).total.amountMinor,'230','public daily price does not depend on any device having rendered');
  assert.equal((await f.inspect('SELECT count(*)::int AS n FROM scoped_offer_eligibility WHERE merchant_id=$1',[f.merchant])).rows[0].n,0);assert.ok((await f.playlist()).items.every(item=>item.menuUrl!==null&&!new URL(item.menuUrl).searchParams.has('offer')));
 }finally{await f.close();}
});
test('render requires ACK for the current exact playlist event and marks all its members only on that device',integration,async()=>{
 const f=await promotionFixture();try{
  const otherProduct=randomUUID();await f.inspect("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock,image_url) VALUES($1,$2,'ชา','Tea','',3500,20,'/images/menu/espresso.jpg')",[otherProduct,f.merchant]);
  // Intentional opt-in loading: catalog imports private config, skipped tests must not.
  const {publishPrices,pricingView}=await import('../apps/api/src/catalog');await f.tenant(f.merchant,async db=>{const current=await pricingView(db,f.merchant);await publishPrices(db,f.merchant,f.actor,'owner',{...f.configuration,expectedRevision:current.revision,prices:[{productId:f.product,unitMinor:'270'},{productId:otherProduct,unitMinor:'270'}]});});
  const first=await f.approve(await f.generate()),second=await f.approve(await f.generate({productIds:[otherProduct]}));await f.publish(first);const stale=await f.event();await f.deliver(stale);await f.publish(second);const event=await f.event();assert.notEqual(event.id,stale.id);assert.equal(event.payload.payload.items.length,2);assert.deepEqual(event.payload.payload.items.map(i=>i.campaignId).sort(),[first.id,second.id].sort());assert.equal('sound' in event.payload.payload,false);assert.equal(event.payload.authGeneration,String(f.devices.get(f.b.id)!.authGeneration));
  const ack={type:'ACK',eventId:event.id,deviceSeq:String(event.device_seq),orderId:null,orderVersion:null,screenGeneration:String(event.screen_generation),rendered:true};
  assert.equal((await f.command(f.b.id,{...ack,eventId:stale.id,deviceSeq:String(stale.device_seq),screenGeneration:String(stale.screen_generation)})).result.ok,false,'superseded membership cannot render');assert.equal((await f.command(f.b.id,ack)).result.ok,false,'ACK requires a delivery receipt');assert.equal((await f.command(f.a.id,ack)).result.ok,false,'another device cannot ACK this event');
  await f.deliver(event);assert.equal((await f.command(f.b.id,{...ack,deviceSeq:String(BigInt(event.device_seq)+1n)})).result.ok,false);assert.equal((await f.command(f.b.id,ack)).result.ok,true);
  const rendered=(await f.inspect('SELECT device_id,event_id,rendered_at FROM device_event_deliveries WHERE merchant_id=$1 AND event_id=$2',[f.merchant,event.id])).rows[0];assert.ok(rendered.rendered_at);
  const targets=(await f.inspect('SELECT id,campaign_id,target_device_id,state,rendered_at FROM promotion_playlist_targets WHERE merchant_id=$1 ORDER BY id',[f.merchant])).rows;assert.equal(targets.filter(t=>t.state==='RENDERED').length,2);assert.ok(targets.filter(t=>t.target_device_id===f.b.id).every(t=>t.state==='RENDERED'));assert.ok(targets.filter(t=>t.target_device_id!==f.b.id).every(t=>t.state!=='RENDERED'));
  await f.command(f.b.id,ack);await f.reconcile();assert.deepEqual((await f.inspect('SELECT id,campaign_id,target_device_id,state,rendered_at FROM promotion_playlist_targets WHERE merchant_id=$1 ORDER BY id',[f.merchant])).rows,targets);assert.equal((await f.event()).id,event.id);
 }finally{await f.close();}
});
test('reconnect silently resends once; acquired cart excludes stale playlist render and reassignment never silently retries old targets',integration,async()=>{
 const f=await promotionFixture();try{
  const sent=await f.publish(await f.approve(await f.generate())),first=await f.event(),connectionId=randomUUID();
  await f.tenant(f.merchant,async db=>{await db.query("UPDATE device_presence SET connection_generation=2,connection_id=$3,connected_until=clock_timestamp()+interval '1 hour' WHERE merchant_id=$1 AND device_id=$2",[f.merchant,f.b.id,connectionId]);await db.query('UPDATE device_capabilities SET connection_generation=2 WHERE merchant_id=$1 AND device_id=$2',[f.merchant,f.b.id]);});
  const actor=f.devices.get(f.b.id)!;actor.connectionGeneration='2';actor.connectionId=connectionId;await f.reconcile();const second=await f.event();assert.notEqual(second.id,first.id);assert.deepEqual(second.payload.payload,first.payload.payload);assert.equal('sound' in second.payload.payload,false);await f.reconcile();assert.equal((await f.event()).id,second.id);
  await f.deliver(second);const batch=await f.batch(sent.campaign),device=batch.targets.find(t=>t.deviceId===f.b.id)!;const sessionId=randomUUID(),opened=await f.command(f.b.id,{type:'CART_OPEN',sessionId,expectedScreenGeneration:device.screenGeneration,expectedAssignmentGeneration:device.assignmentGeneration,recoverSessionId:null});assert.equal(opened.result.ok,true);
  assert.equal((await f.command(f.b.id,{type:'ACK',eventId:second.id,deviceSeq:String(second.device_seq),orderId:null,orderVersion:null,screenGeneration:String(second.screen_generation),rendered:true})).result.ok,false,'playlist cannot overwrite an acquired financial screen');
  assert.equal((await f.command(f.b.id,{type:'CART_RELEASE',sessionId,expectedScreenGeneration:String(BigInt(device.screenGeneration)+1n),cartVersion:'0'})).result.ok,true);
  await f.reg('/api/devices/'+f.b.id,'PATCH',{tableId:null,expectedAssignmentGeneration:device.assignmentGeneration});await f.reconcile();assert.equal((await f.campaign(sent.campaign.id)).playlistTargets?.find(t=>t.deviceId===f.b.id)?.state,'TARGET_CHANGED');assert.equal((await f.playlist()).items.length,0);
  const retry=await f.request<{error:{code:string}}>('/api/promotions/'+sent.campaign.id+'/publish',await f.batch(await f.campaign(sent.campaign.id)));assert.equal(retry.value.error.code,'PROMOTION_STATE_INVALID');assert.equal((await f.inspect('SELECT count(*)::int AS n FROM promotion_playlist_targets WHERE merchant_id=$1 AND campaign_id=$2',[f.merchant,sent.campaign.id])).rows[0].n,3);
 }finally{await f.close();}
});
test('catalog and stock changes between approval and publication require fresh preview rather than price override',integration,async()=>{
 const f=await promotionFixture();try{
  const draft=await f.generate();
  // Intentional opt-in module loading: pricing depends on private config.
  const {publishPrices,pricingView}=await import('../apps/api/src/catalog');await f.tenant(f.merchant,async db=>{const current=await pricingView(db,f.merchant);await publishPrices(db,f.merchant,f.actor,'owner',{...f.configuration,expectedRevision:current.revision,prices:[{productId:f.product,unitMinor:'300'}]});});
  const stale=await f.request<{error:{code:string}}>('/api/promotions/'+draft.id+'/approve',mutation(draft.version));assert.equal(stale.value.error.code,'PROMOTION_REVIEW_REQUIRED');const refreshed=await f.ok<{campaign:PromotionCampaign}>('/api/promotions/'+draft.id+'/preview',mutation(draft.version));assert.equal(refreshed.campaign.basePrice.amountMinor,'300');assert.equal(refreshed.campaign.unitPrice.amountMinor,'255');assert.notEqual(refreshed.campaign.priceVersion,draft.priceVersion);
  const approved=await f.approve(refreshed.campaign);await f.inspect('UPDATE products SET stock=stock-1 WHERE merchant_id=$1 AND id=$2',[f.merchant,f.product]);const stalePublish=await f.request<{error:{code:string}}>('/api/promotions/'+approved.id+'/publish',await f.batch(approved));assert.equal(stalePublish.value.error.code,'PROMOTION_REVIEW_REQUIRED');assert.deepEqual((await f.campaign(approved.id)).playlistTargets,[]);
 }finally{await f.close();}
});
test('synthetic paid pickup remains higher priority than daily playlist without changing the frozen financial bill',integration,async()=>{
 const f=await promotionFixture();try{
  const entry=await f.entry(),visit=await f.ok<{visitToken:string}>('/api/table/'+entry+'/visit',{requestId:randomUUID()},null),base='/api/table/'+entry+'/visit/'+visit.visitToken;
  const quoted=await f.ok<{quote:Quote}>(base+'/quotes',{items:[{productId:f.product,qty:1}]},null),created=await f.ok<{order:OrderView}>(base+'/orders',{quoteId:quoted.quote.id,priceVersion:quoted.quote.priceVersion,idempotencyKey:randomUUID()},null);
  // Synthetic PAID fixture only: no chain/provider/hardware proof. Opt-in import requires private config.
  const {emitOrder}=await import('../apps/api/src/orders');const paid=await f.tenant(f.merchant,async db=>{const o=(await db.query("UPDATE orders SET status='PAID',version=version+1 WHERE merchant_id=$1 AND id=$2 RETURNING *",[f.merchant,created.order.id])).rows[0];await emitOrder(db,o);return (await db.query('SELECT * FROM outbox_events WHERE merchant_id=$1 AND order_id=$2 AND order_version=$3 ORDER BY device_seq DESC LIMIT 1',[f.merchant,o.id,o.version])).rows[0];});
  await f.inspect('INSERT INTO device_event_deliveries(merchant_id,device_id,event_id,device_seq,connection_generation) VALUES($1,$2,$3,$4,1)',[f.merchant,f.b.id,paid.id,paid.device_seq]);assert.equal((await f.command(f.b.id,{type:'ACK',eventId:paid.id,deviceSeq:String(paid.device_seq),orderId:created.order.id,orderVersion:paid.order_version,screenGeneration:String(paid.screen_generation),rendered:true})).result.ok,true);await f.ok(base+'/dismiss',{},null);
  await f.ok('/api/orders/'+created.order.id+'/fulfillment',{status:'PREPARING',expectedVersion:0,idempotencyKey:randomUUID()},f.staff);await f.ok('/api/orders/'+created.order.id+'/fulfillment',{status:'READY',expectedVersion:1,idempotencyKey:randomUUID()},f.staff);
  const before=(await f.inspect('SELECT to_jsonb(o) AS bill FROM orders o WHERE merchant_id=$1 AND id=$2',[f.merchant,created.order.id])).rows[0].bill,sent=await f.publish(await f.approve(await f.generate()));await f.reconcile();assert.equal((await f.inspect("SELECT count(*)::int AS n FROM outbox_events WHERE merchant_id=$1 AND target_device_id=$2 AND type='PROMOTION_PLAYLIST'",[f.merchant,f.b.id])).rows[0].n,0);assert.equal(sent.campaign.playlistTargets?.find(t=>t.deviceId===f.b.id)?.state,'DEFERRED_BUSY');assert.deepEqual((await f.inspect('SELECT to_jsonb(o) AS bill FROM orders o WHERE merchant_id=$1 AND id=$2',[f.merchant,created.order.id])).rows[0].bill,before);
 }finally{await f.close();}
});
test('ALL daily confirmation is the current nonrevoked device set, never a cached subset or automatic newly-added target',integration,async()=>{
 const f=await promotionFixture();try{
  const approved=await f.approve(await f.generate()),frozen=await f.batch(approved),added=await f.reg('/api/devices','POST',{label:'New offline daily target'});
  const stale=await f.request<{error:{code:string}}>('/api/promotions/'+approved.id+'/publish',frozen);assert.equal(stale.value.error.code,'PROMOTION_TARGET_CHANGED');assert.deepEqual((await f.campaign(approved.id)).playlistTargets,[]);
  await f.reg('/api/devices/'+f.c.id,'PATCH',{revoked:true});const fresh=await f.batch(approved);assert.deepEqual(fresh.targets.map(target=>target.deviceId).sort(),[f.a.id,f.b.id,added.id].sort());assert.equal(fresh.targets.some(target=>target.deviceId===f.c.id),false);
  const sent=await f.ok<{campaign:PromotionCampaign}>('/api/promotions/'+approved.id+'/publish',fresh);assert.deepEqual(sent.campaign.playlistTargets!.map(target=>target.deviceId).sort(),[f.a.id,f.b.id,added.id].sort());assert.equal(sent.campaign.playlistTargets?.find(target=>target.deviceId===added.id)?.state,'DEFERRED_OFFLINE');assert.equal(sent.campaign.playlistTargets?.some(target=>target.deviceId===f.c.id),false);
 }finally{await f.close();}
});
