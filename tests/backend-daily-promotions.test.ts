import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {OrderView,Quote} from '../packages/contracts/src/index';
import type {DailyPromotionLine} from '../packages/contracts/src/daily-promotions';
import type {EffectiveMenu} from '../apps/api/src/offers';
import {promotionFixture} from './backend-promotions-fixture';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
// Intentional opt-in module loading: skipped integrations cannot load private runtime config.
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
test('explicit daily publication gives public menu, counter/table quotes and frozen order sidecars identical canonical prices',integration,async()=>{
 const f=await promotionFixture();try{
  const approved=await f.approve(await f.generate()),entry=await f.entry();
  const before=await f.ok<{menu:EffectiveMenu}>('/api/table/'+entry,undefined,null);assert.equal(before.menu.products[0].unitPrice?.amountMinor,'270');assert.equal(before.menu.products[0].dailyPromotion,undefined);
  const sent=await f.publish(approved),evidence:DailyPromotionLine={campaignId:approved.id,campaignVersion:approved.version,discountPercent:15,startsAt:approved.startsAt,expiresAt:approved.expiresAt};
  const publicMenu=await f.ok<{menu:EffectiveMenu}>('/api/table/'+entry,undefined,null),staffMenu=await f.ok<EffectiveMenu>('/api/menu');
  for(const menu of [publicMenu.menu,staffMenu]){assert.equal(menu.products[0].basePrice?.amountMinor,'270');assert.equal(menu.products[0].unitPrice?.amountMinor,'230');assert.deepEqual(menu.products[0].dailyPromotion,evidence);assert.equal(menu.products[0].scopedPromotion,undefined);assert.equal(menu.products[0].personalPromotion,undefined);}
  const registerBase='/api/registers/'+f.register.id,counter=await f.ok<Quote>(registerBase+'/quotes',{items:[{productId:f.product,qty:2}],serving:{kind:'counter'}});
  const visit=await f.ok<{visitToken:string}>('/api/table/'+entry+'/visit',{requestId:randomUUID()},null),base='/api/table/'+entry+'/visit/'+visit.visitToken,table=await f.ok<{quote:Quote}>(base+'/quotes',{items:[{productId:f.product,qty:2}]},null),visitMenu=await f.ok<{menu:EffectiveMenu}>(base,undefined,null);
  assert.deepEqual(visitMenu.menu.products[0].unitPrice,publicMenu.menu.products[0].unitPrice);
  for(const quote of [counter,table.quote]){assert.equal(quote.total.amountMinor,'460');assert.equal(quote.lines[0].unitPrice.amountMinor,'230');assert.equal(quote.lines[0].basePrice.amountMinor,'270');assert.equal(quote.lines[0].promotion,null);assert.deepEqual(quote.lines[0].dailyPromotion,evidence);assert.equal(quote.lines[0].scopedPromotion,undefined);assert.equal(quote.lines[0].personalPromotion,undefined);}
  assert.deepEqual(counter.lines,table.quote.lines);assert.equal(counter.settlement.amountMinor,table.quote.settlement.amountMinor);
  const counterInput={items:[{productId:f.product,qty:2}],serving:{kind:'counter'},quoteId:counter.id,priceVersion:counter.priceVersion,idempotencyKey:randomUUID()},tableInput={quoteId:table.quote.id,priceVersion:table.quote.priceVersion,idempotencyKey:randomUUID()};
  const counterResult=await f.request<OrderView>(registerBase+'/orders',counterInput);assert.equal(counterResult.status,201);const counterOrder=counterResult.value,tableOrder=await f.ok<{order:OrderView;replayed:boolean}>(base+'/orders',tableInput,null);
  for(const order of [counterOrder,tableOrder.order]){assert.equal(order.pricing.kind,'versioned');assert.equal(order.pricing.total.amountMinor,'460');assert.deepEqual(order.pricing.lines,counter.lines);}
  const quotes=(await f.inspect('SELECT quote_id,product_id,campaign_id,campaign_version,evidence FROM daily_quote_promotions WHERE merchant_id=$1 ORDER BY quote_id',[f.merchant])).rows;assert.equal(quotes.length,2);assert.deepEqual(quotes.map(row=>row.quote_id).sort(),[counter.id,table.quote.id].sort());assert.ok(quotes.every(row=>row.product_id===f.product&&row.campaign_id===approved.id&&row.campaign_version===approved.version));assert.ok(quotes.every(row=>JSON.stringify(row.evidence)===JSON.stringify(quotes[0].evidence)));assert.deepEqual(quotes[0].evidence,evidence);
  const orders=(await f.inspect('SELECT order_id,quote_id,product_id,campaign_id,campaign_version,evidence FROM daily_order_promotions WHERE merchant_id=$1 ORDER BY order_id',[f.merchant])).rows;assert.equal(orders.length,2);assert.deepEqual(orders.map(row=>row.order_id).sort(),[counterOrder.id,tableOrder.order.id].sort());assert.ok(orders.every(row=>row.campaign_id===approved.id&&row.campaign_version===approved.version));assert.ok(orders.every(row=>row.quote_id===(row.order_id===counterOrder.id?counter.id:table.quote.id)));for(const row of orders)assert.deepEqual(row.evidence,evidence);
  await assert.rejects(()=>f.inspect("UPDATE daily_order_promotions SET evidence='{}' WHERE merchant_id=$1 AND order_id=$2",[f.merchant,tableOrder.order.id]),/immutable authority record/);await assert.rejects(()=>f.inspect("UPDATE daily_quote_promotions SET evidence='{}' WHERE merchant_id=$1 AND quote_id=$2",[f.merchant,counter.id]),/immutable authority record/);
  await f.ok('/api/promotions/'+sent.campaign.id+'/revoke',{expectedVersion:sent.campaign.version,idempotencyKey:randomUUID()});
  const counterReplay=await f.ok<OrderView>(registerBase+'/orders',counterInput),tableReplay=await f.ok<{order:OrderView;replayed:boolean}>(base+'/orders',tableInput,null);assert.equal(counterReplay.id,counterOrder.id);assert.equal(tableReplay.replayed,true);assert.deepEqual(counterReplay.pricing,counterOrder.pricing);assert.deepEqual(tableReplay.order.pricing,tableOrder.order.pricing);
  assert.deepEqual((await f.ok<OrderView>('/api/orders/'+counterOrder.id)).pricing,counterOrder.pricing);assert.equal((await f.ok<{menu:EffectiveMenu}>('/api/table/'+entry,undefined,null)).menu.products[0].unitPrice?.amountMinor,'270');assert.equal((await f.inspect('SELECT count(*)::int AS n FROM orders WHERE merchant_id=$1',[f.merchant])).rows[0].n,2);assert.equal((await f.inspect('SELECT count(*)::int AS n FROM scoped_offer_eligibility WHERE merchant_id=$1',[f.merchant])).rows[0].n,0);assert.equal((await f.inspect('SELECT count(*)::int AS n FROM promotion_targets WHERE merchant_id=$1',[f.merchant])).rows[0].n,0);
 }finally{await f.close();}
});
test('daily revocation rejects captured uncommitted counter/table quotes and old render ACK; subsequent fresh quotes return base price',integration,async()=>{
 const f=await promotionFixture();try{
  const sent=await f.publish(await f.approve(await f.generate())),event=await f.event(f.a.id);await f.deliver(event);
  const counter=await f.quote(),entry=await f.entry(),visit=await f.ok<{visitToken:string}>('/api/table/'+entry+'/visit',{requestId:randomUUID()},null),base='/api/table/'+entry+'/visit/'+visit.visitToken,table=await f.ok<{quote:Quote}>(base+'/quotes',{items:[{productId:f.product,qty:1}]},null);assert.equal(counter.total.amountMinor,'230');assert.equal(table.quote.total.amountMinor,'230');
  await f.ok('/api/promotions/'+sent.campaign.id+'/revoke',{expectedVersion:sent.campaign.version,idempotencyKey:randomUUID()});
  await assert.rejects(()=>f.create(counter),/PROMOTION_OFFER_INVALID/);const denied=await f.request<{error:{code:string}}>(base+'/orders',{quoteId:table.quote.id,priceVersion:table.quote.priceVersion,idempotencyKey:randomUUID()},null);assert.equal(denied.value.error.code,'PROMOTION_OFFER_INVALID');
  assert.equal((await f.command(f.a.id,{type:'ACK',eventId:event.id,deviceSeq:String(event.device_seq),orderId:null,orderVersion:null,screenGeneration:String(event.screen_generation),rendered:true})).result.ok,false);
  const freshCounter=await f.quote(),freshTable=await f.ok<{quote:Quote}>(base+'/quotes',{items:[{productId:f.product,qty:1}]},null);assert.equal(freshCounter.total.amountMinor,'270');assert.equal(freshTable.quote.total.amountMinor,'270');assert.equal(freshCounter.lines[0].dailyPromotion,undefined);assert.equal(freshTable.quote.lines[0].dailyPromotion,undefined);
  await f.reconcile(f.a.id);await f.reconcile();assert.deepEqual((await f.playlist(f.a.id)).items,[]);assert.deepEqual((await f.playlist()).items,[]);assert.ok((await f.campaign(sent.campaign.id)).playlistTargets?.every(target=>target.state==='REVOKED'));
  assert.equal((await f.inspect('SELECT count(*)::int AS n FROM orders WHERE merchant_id=$1',[f.merchant])).rows[0].n,0);assert.equal((await f.inspect('SELECT reserved FROM products WHERE merchant_id=$1 AND id=$2',[f.merchant,f.product])).rows[0].reserved,0);assert.equal((await f.inspect('SELECT count(*)::int AS n FROM daily_order_promotions WHERE merchant_id=$1',[f.merchant])).rows[0].n,0);
 }finally{await f.close();}
});
test('expiry invalidates a new bill from captured daily quote but never reprices pre-publication or already-created daily bills',integration,async()=>{
 const f=await promotionFixture();try{
  const oldQuote=await f.quote(),oldKey=randomUUID(),oldBill=await f.create(oldQuote,oldKey);assert.equal(oldBill.order.pricing.total.amountMinor,'270');assert.equal(oldBill.order.pricing.lines[0].dailyPromotion,undefined);
  const sent=await f.publish(await f.approve(await f.generate())),entry=await f.entry(),visit=await f.ok<{visitToken:string}>('/api/table/'+entry+'/visit',{requestId:randomUUID()},null),base='/api/table/'+entry+'/visit/'+visit.visitToken,quote=await f.ok<{quote:Quote}>(base+'/quotes',{items:[{productId:f.product,qty:1}]},null),input={quoteId:quote.quote.id,priceVersion:quote.quote.priceVersion,idempotencyKey:randomUUID()},dailyBill=await f.ok<{order:OrderView}>(base+'/orders',input,null);assert.equal(dailyBill.order.pricing.total.amountMinor,'230');
  await f.reg('/api/registers/'+f.register.id+'/pairing','PUT',{deviceId:f.c.id,expectedPairingGeneration:'2'});const captured=await f.quote();assert.equal(captured.total.amountMinor,'230');
  // Controlled local expiry fixture; no production clock, provider, payment or immutable evidence is changed.
  await f.inspect("UPDATE promotion_campaigns SET starts_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '1 second' WHERE merchant_id=$1 AND id=$2",[f.merchant,sent.campaign.id]);
  await assert.rejects(()=>f.create(captured),/PROMOTION_OFFER_INVALID/);const fresh=await f.quote();assert.equal(fresh.total.amountMinor,'270');assert.equal(fresh.lines[0].dailyPromotion,undefined);
  assert.deepEqual((await f.ok<OrderView>('/api/orders/'+oldBill.order.id)).pricing,oldBill.order.pricing);const replay=await f.ok<{order:OrderView;replayed:boolean}>(base+'/orders',input,null);assert.equal(replay.replayed,true);assert.deepEqual(replay.order.pricing,dailyBill.order.pricing);
  assert.equal((await f.inspect('SELECT count(*)::int AS n FROM daily_order_promotions WHERE merchant_id=$1 AND order_id=$2',[f.merchant,oldBill.order.id])).rows[0].n,0);assert.equal((await f.inspect('SELECT count(*)::int AS n FROM daily_order_promotions WHERE merchant_id=$1 AND order_id=$2',[f.merchant,dailyBill.order.id])).rows[0].n,1);assert.equal((await f.inspect('SELECT count(*)::int AS n FROM orders WHERE merchant_id=$1',[f.merchant])).rows[0].n,2);
 }finally{await f.close();}
});
