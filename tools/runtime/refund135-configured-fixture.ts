// Disposable local fixture only. Publishes mutable configuration; never rewrites
// immutable quote/order/payment evidence or calls a chain/provider.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type pg from 'pg';
import {publishProductOptions} from '../../apps/api/src/online-options';
import {productOffer} from '../../apps/api/src/offers';

export async function prepareRefund135ConfiguredFixture(db:pg.Client,merchant:string,actor:string,product:string,priceVersion:string){
 const client=db as unknown as pg.PoolClient,spice=randomUUID(),spicy=randomUUID(),mild=randomUUID(),addons=randomUUID(),extra18=randomUUID(),extra35=randomUUID(),extra37=randomUUID();
 const money=(amountMinor:string)=>({currency:'USD',decimals:2,amountMinor});
 const publication=await publishProductOptions(client,merchant,actor,'owner',product,{
  expectedRevision:'0',idempotencyKey:randomUUID(),priceVersion,noteEnabled:false,
  groups:[{id:spice,name:'ระดับความเผ็ด',nameEn:'Spice',enabled:true,minSelections:1,maxSelections:1,choices:[
   {id:spicy,name:'เผ็ด',nameEn:'Spicy',enabled:true,maxQty:1,priceDelta:money('0')},
   {id:mild,name:'เผ็ดน้อย',nameEn:'Mild',enabled:true,maxQty:1,priceDelta:money('0')}
  ]},{id:addons,name:'เพิ่มเติม',nameEn:'Extras',enabled:true,minSelections:0,maxSelections:2,choices:[
   {id:extra18,name:'เพิ่ม 18',nameEn:'Extra 18',enabled:true,maxQty:2,priceDelta:money('18')},
   {id:extra35,name:'เพิ่ม 35',nameEn:'Extra 35',enabled:true,maxQty:1,priceDelta:money('35')},
   {id:extra37,name:'เพิ่ม 37',nameEn:'Extra 37',enabled:true,maxQty:1,priceDelta:money('37')}
  ]}]
 });
 await productOffer(client,merchant,actor,'owner',product,'PUT',{priceVersion,expectedRevision:'0',enabled:true,basePriceMinor:'270',currentPriceMinor:'243',expiresAt:new Date(Date.now()+3600000).toISOString(),discount:{kind:'amount',amountMinor:'27'}});
 const originalPolicy={id:'FIXTURE_USD_CENTS_THIRDS',numerator:'10000',denominator:'3'};
 assert.equal((await db.query("UPDATE bitpos.merchant_payment_assets SET policy=$2,version=version+1 WHERE merchant_id=$1 AND asset_id='usdg-devnet'",[merchant,originalPolicy])).rowCount,1);
 const definitions=[
  {id:'00000000-0000-4000-8000-000000000010',qty:1,choice:spicy,extra:null,catalog:'243',atoms:'810000'},
  {id:'00000000-0000-4000-8000-000000000020',qty:1,choice:mild,extra:null,catalog:'243',atoms:'810000'},
  {id:'00000000-0000-4000-8000-000000000030',qty:2,choice:spicy,extra:{id:extra18,qty:2},catalog:'558',atoms:'1860000'},
  {id:'00000000-0000-4000-8000-000000000040',qty:1,choice:spicy,extra:{id:extra35,qty:1},catalog:'278',atoms:null},
  {id:'00000000-0000-4000-8000-000000000050',qty:1,choice:mild,extra:{id:extra37,qty:1},catalog:'280',atoms:null}
 ];
 return {originalPolicy,definitions,items:definitions.map(line=>({lineId:line.id,productId:product,qty:line.qty,optionVersion:publication.version,selections:[{groupId:spice,choiceId:line.choice,qty:1},...(line.extra?[{groupId:addons,choiceId:line.extra.id,qty:line.extra.qty}]:[])],allergyNote:null})),catalogTotal:'1722',receivedAtoms:'5740000'};
}

export async function verifyRefund135ConfiguredOrder(db:pg.Client,merchant:string,order:string,fixture:Awaited<ReturnType<typeof prepareRefund135ConfiguredFixture>>){
 const snapshot=(await db.query('SELECT snapshot FROM bitpos.order_configured_food WHERE merchant_id=$1 AND order_id=$2',[merchant,order])).rows[0].snapshot;
 assert.equal(snapshot.lines.length,5);
 for(const expected of fixture.definitions){const line=snapshot.lines.find((value:{lineId:string})=>value.lineId===expected.id);assert.ok(line);assert.equal(line.qty,expected.qty);assert.equal(line.lineTotal.amountMinor,expected.catalog);assert.equal(line.selections.find((option:{choiceId:string})=>option.choiceId===expected.choice).priceDelta.amountMinor,'0');}
 const payment=(await db.query('SELECT p.amount_minor::text amount,a.settlement FROM bitpos.payments p JOIN bitpos.payment_attempt_assets a ON(a.merchant_id,a.order_id,a.attempt_id)=(p.merchant_id,p.order_id,p.attempt_id) WHERE p.merchant_id=$1 AND p.order_id=$2',[merchant,order])).rows;
 assert.equal(payment.length,1);assert.equal(payment[0].amount,fixture.receivedAtoms);
 // Changing current policy must not alter the frozen original settlement used by135.
 const currentPolicy={id:'FIXTURE_CHANGED_AFTER_PAYMENT',numerator:'10000',denominator:'1'};
 assert.equal((await db.query("UPDATE bitpos.merchant_payment_assets SET policy=$2,version=version+1 WHERE merchant_id=$1 AND asset_id='usdg-devnet'",[merchant,currentPolicy])).rowCount,1);
 return {definitions:fixture.definitions,originalPolicy:fixture.originalPolicy,currentPolicy,catalogTotal:fixture.catalogTotal,receivedAtoms:fixture.receivedAtoms,optionsSource:'Canonical publishProductOptions, quote/order freeze and immutable payment quote; no sidecar mutation'};
}
