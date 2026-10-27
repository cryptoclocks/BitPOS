// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {autoApprovable,flashSalePolicy,planFlashSale,type FlashSaleFacts,type FlashSalePolicy} from '../packages/meta-ai/src/flash-sale';
import {createMetaRouter} from '../packages/meta-ai/src/router';
import {metaPromotionProvider} from '../apps/api/src/meta/promotion-bridge';
import {PromotionProviderFailure,type PromotionProviderInput} from '../apps/api/src/promotion-provider';

const productId='00000000-0000-4000-8000-000000000010';
const policy:FlashSalePolicy={version:1,mode:'leashed',maxDiscountPercent:30,autoApproveMaxPercent:20,minConfidenceBp:8500,minSurplusUnits:3,windowMinutes:90,dailyAutoLimit:3};
const product={productId,name:'ครัวซองต์',nameEn:'Croissant',category:'bakery',stock:7,basePrice:{currency:'THB' as const,decimals:2 as const,amountMinor:'9500'},effectivePrice:{currency:'THB' as const,decimals:2 as const,amountMinor:'9500'},priceVersion:'00000000-0000-4000-8000-000000000020',imageUrl:'/images/menu/croissant.jpg'};
const facts:FlashSaleFacts={now:new Date('2026-10-30T09:00:00Z'),closesAt:new Date('2026-10-30T11:00:00Z'),product,count:{productId,detected:7,confidenceBp:9200,observationId:'obs'},soldPerHourMilli:1000,autoApprovedToday:0,openRun:false};

test('surplus at 4pm yields a bounded candidate with only price-reducing discounts',()=>{
 const plan=planFlashSale(policy,facts);
 assert.equal(plan.kind,'candidate');if(plan.kind!=='candidate')return;
 assert.equal(plan.projectedSurplus,5);
 assert.deepEqual(plan.allowedDiscounts,Array.from({length:30},(_,i)=>i+1));
 assert.equal(plan.expiresAt,'2026-10-30T10:30:00.000Z');
 assert.equal(autoApprovable(policy,plan,20,facts.count,0),true);
 assert.equal(autoApprovable(policy,plan,21,facts.count,0),false);
 assert.equal(autoApprovable(policy,plan,10,facts.count,3),false);
 assert.equal(autoApprovable({...policy,mode:'supervised',autoApproveMaxPercent:0},plan,5,facts.count,0),false);
});

test('low confidence, no surplus, open run, closing and camera>ledger mismatch never plan a sale',()=>{
 assert.deepEqual(planFlashSale(policy,{...facts,count:{...facts.count,confidenceBp:8000}}),{kind:'none',reason:'LOW_CONFIDENCE'});
 assert.deepEqual(planFlashSale(policy,{...facts,soldPerHourMilli:3000}),{kind:'none',reason:'NO_SURPLUS'});
 assert.deepEqual(planFlashSale(policy,{...facts,openRun:true}),{kind:'none',reason:'OPEN_RUN'});
 assert.deepEqual(planFlashSale(policy,{...facts,closesAt:new Date('2026-10-30T09:10:00Z')}),{kind:'none',reason:'CLOSING_TOO_SOON'});
 assert.deepEqual(planFlashSale(policy,{...facts,count:{...facts.count,detected:12}}),{kind:'none',reason:'INVENTORY_MISMATCH'});
});

test('smaller surplus halves the cap; a mismatched count is plannable but never auto-approved',()=>{
 const plan=planFlashSale(policy,{...facts,count:{...facts.count,detected:8},soldPerHourMilli:2500});
 assert.equal(plan.kind,'candidate');if(plan.kind!=='candidate')return;
 assert.equal(plan.projectedSurplus,3);assert.equal(plan.allowedDiscounts.at(-1),15);
 assert.equal(plan.inventoryMismatch,true);assert.equal(autoApprovable(policy,plan,10,facts.count,0),false);
});

test('tiny integer prices only allow discounts that strictly reduce the price',()=>{
 const priced=(minor:string)=>({...product,basePrice:{...product.basePrice,amountMinor:minor},effectivePrice:{...product.effectivePrice,amountMinor:minor}});
 const plan=planFlashSale(policy,{...facts,product:priced('10')});
 assert.equal(plan.kind,'candidate');if(plan.kind!=='candidate')return;
 assert.equal(plan.allowedDiscounts[0],10);
 assert.deepEqual(planFlashSale(policy,{...facts,product:priced('3')}),{kind:'none',reason:'NO_VALID_PRICE'});
});

test('policy schema refuses auto cap above max and out-of-range leashes',()=>{
 assert.equal(flashSalePolicy.safeParse({...policy,autoApproveMaxPercent:31}).success,false);
 assert.equal(flashSalePolicy.safeParse({...policy,maxDiscountPercent:60}).success,false);
 assert.equal(flashSalePolicy.safeParse({...policy,minConfidenceBp:4000}).success,false);
});

test('bridge constrains the model to the leash enum and rejects an out-of-leash answer',async()=>{
 const input:PromotionProviderInput={jobId:'job',goal:'reduce end-of-day pastry waste',maxDiscountPercent:30,startsAt:'2026-10-30T09:00:00Z',expiresAt:'2026-10-30T10:30:00Z',products:[product],language:'en'};
 let enumSent:unknown;let answer=20;
 const router=createMetaRouter({providers:[{id:'baseten',baseUrl:'https://inference.example.test/v1',apiKey:'k',model:'meta-models/muse-spark-open-1026',weights:'open',location:'cloud',timeoutMs:5000,supportsJsonSchema:true,supportsImages:false}],fetch:async(_u,opts)=>{enumSent=JSON.parse(String(opts?.body)).response_format.json_schema.schema.properties.discountPercent.enum;return new Response(JSON.stringify({model:'meta-models/muse-spark-open-1026',choices:[{finish_reason:'stop',message:{content:JSON.stringify({productId,headline:'x',copy:'Fresh from this morning',discountPercent:answer,rationale:'Seven left with two hours to close'})}}]}));}});
 const provider=metaPromotionProvider({router,merchantId:'00000000-0000-4000-8000-000000000001',allowedDiscounts:[10,15,20]});
 const r=await provider(input);
 assert.deepEqual(enumSent,[10,15,20]);
 assert.equal(r.candidate.discountPercent,20);assert.equal(r.candidate.headline,'Croissant');
 assert.equal(r.provider,'meta-router:baseten');assert.equal(r.model,'meta-models/muse-spark-open-1026');
 answer=25;
 await assert.rejects(provider(input),(e:unknown)=>e instanceof PromotionProviderFailure&&e.code==='PROVIDER_RESPONSE_INVALID');
});
