// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {approvedOffers,fallbackChoice,formatMoney,selectOffer} from '../apps/api/src/meta/offer-select';
import {createMetaRouter} from '../packages/meta-ai/src/router';
import type {MetaInvocation,MetaProviderConfig} from '../packages/meta-ai/src/types';
import type {EffectiveMenu} from '../apps/api/src/offers';

const thb=(minor:string)=>({currency:'THB' as const,decimals:2 as const,amountMinor:minor});
const P=(i:number)=>`00000000-0000-4000-8000-00000000000${i}`;
type Product=EffectiveMenu['products'][number];
const product=(i:number,over:Partial<Product>):Product=>({id:P(i),catalogKey:null,name:`สินค้า${i}`,nameEn:`Item ${i}`,emoji:'☕',available:10,imageUrl:null,category:'drink',description:null,basePrice:thb('6500'),unitPrice:thb('6500'),promotion:null,...over});
const menu=(products:Product[]):EffectiveMenu=>({merchant:{id:P(9),name:'demo'},asOf:'2026-10-28T00:00:00Z',priceValidUntil:'2026-10-28T01:00:00Z',menuVersion:'v',priceVersion:null,pricingRevision:'1',currency:null,decimals:null,products});
const promo={revision:'7',expiresAt:'2026-10-28T10:00:00Z',discount:{kind:'percent' as const,percent:20},priceVersion:P(8)};
const daily={campaignId:'0f8fad5b-d9cb-469f-a165-70867728950e',campaignVersion:2,discountPercent:30,startsAt:'2026-10-28T00:00:00Z',expiresAt:'2026-10-28T12:00:00Z'};

const sample=menu([
 product(1,{unitPrice:thb('5200'),promotion:promo}),                      // 20% product offer
 product(2,{unitPrice:thb('4550'),dailyPromotion:daily}),                 // 30% daily offer
 product(3,{unitPrice:thb('5200'),promotion:promo,available:0}),          // sold out
 product(4,{}),                                                           // no discount
 product(5,{unitPrice:thb('5200')}),                                      // cheaper but no approved offer
 product(6,{unitPrice:{currency:'USD',decimals:2,amountMinor:'100'},promotion:promo}), // currency mismatch
]);

test('only in-stock products discounted by an approved offer become candidates, best discount first',()=>{
 const c=approvedOffers(sample);
 assert.deepEqual(c.map(x=>[x.offerId,x.discountPercent]),[[`daily:${P(2)}:${daily.campaignId}.2`,30],[`product:${P(1)}:7`,20]]);
});

test('fallback avoids the offers shown most recently',()=>{
 const c=approvedOffers(sample);
 assert.equal(fallbackChoice(c,{visitCount:2,localHour:9,recentlyShown:[]}).candidate.productId,P(2));
 assert.equal(fallbackChoice(c,{visitCount:2,localHour:9,recentlyShown:[c[0].offerId]}).candidate.productId,P(1));
 assert.equal(fallbackChoice(c,{visitCount:2,localHour:9,recentlyShown:c.map(x=>x.offerId)}).candidate.productId,P(2));
});

const provider:MetaProviderConfig={id:'meta_api',baseUrl:'https://api.example.test/v1',apiKey:'k',model:'muse-spark-1.3',weights:'closed',location:'cloud',timeoutMs:5000,supportsJsonSchema:true,supportsImages:false};
const reply=(content:unknown)=>async()=>new Response(JSON.stringify({model:'muse-spark-1.3',choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:1,completion_tokens:1}}),{status:200});
const facts={visitCount:1,localHour:8,recentlyShown:[]};

test('Muse Spark choice is used only when it is an offered id with digit-free reasons',async()=>{
 const c=approvedOffers(sample);const records:MetaInvocation[]=[];
 const ok=createMetaRouter({providers:[provider],record:async r=>{records.push(r);},fetch:reply({offerId:c[1].offerId,reasonTh:'ครัวซองต์อุ่นๆ เหมาะกับเช้านี้',reasonEn:'A warm pick for the morning'})});
 const chosen=await selectOffer(ok,P(9),c,facts);
 assert.equal(chosen?.chosenBy,'model');assert.equal(chosen?.candidate.offerId,c[1].offerId);
 assert.equal(chosen?.invocationId,records[0].id);assert.equal(records[0].task,'offer_selection');
 // The model sees ids and coarse facts only, never the customer's identity.
 const digits=createMetaRouter({providers:[provider],fetch:reply({offerId:c[1].offerId,reasonTh:'ลด 50% วันนี้',reasonEn:'Half price'})});
 assert.equal((await selectOffer(digits,P(9),c,facts))?.chosenBy,'fallback');
 const money=createMetaRouter({providers:[provider],fetch:reply({offerId:c[1].offerId,reasonTh:'ราคาพิเศษ','reasonEn':'Only ฿ today'})});
 assert.equal((await selectOffer(money,P(9),c,facts))?.chosenBy,'fallback');
 const invented=createMetaRouter({providers:[provider],fetch:reply({offerId:'product:made-up:1',reasonTh:'อร่อย',reasonEn:'Tasty'})});
 assert.equal((await selectOffer(invented,P(9),c,facts))?.chosenBy,'fallback');
 const down=createMetaRouter({providers:[provider],fetch:async()=>{throw new TypeError('offline');}});
 assert.equal((await selectOffer(down,P(9),c,facts))?.chosenBy,'fallback');
 assert.equal((await selectOffer(null,P(9),c,facts))?.chosenBy,'fallback');
 assert.equal(await selectOffer(ok,P(9),[],facts),null);
});

test('money formatting comes from integer minor units',()=>{
 assert.equal(formatMoney(thb('5200')),'฿52');
 assert.equal(formatMoney(thb('4550')),'฿45.50');
 assert.equal(formatMoney(thb('123456789')),'฿1,234,567.89');
 assert.equal(formatMoney({currency:'USD',decimals:2,amountMinor:'450'}),'$4.50');
 assert.equal(formatMoney({currency:'USDG' as any,decimals:6,amountMinor:'1500000'}),'1.50 USDG');
 assert.equal(formatMoney({currency:'USDG' as any,decimals:6,amountMinor:'1234567'}),'1.234567 USDG');
});
