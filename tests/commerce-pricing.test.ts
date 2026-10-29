import test from'node:test';import assert from'node:assert/strict';import{priceCommerce,type CommercePricingInput}from'../packages/domain/src/commerce-pricing';
const basket=():CommercePricingInput=>({currency:'USD',decimals:2,serving:'delivery',foodLines:[{lineId:'a',amountMinor:'300'},{lineId:'b',amountMinor:'901'}],deliveryFeeMinor:'99',serviceFeeMinor:'51',feeAllocation:{merchantMinor:'25',driverMinor:'100',platformMinor:'25'},coupon:{versionId:'coupon-v1',terms:{minimumFoodMinor:'1000',maximumDiscountMinor:'200',merchantFundingBps:2500,discount:{kind:'BASIS_POINTS',basisPoints:1000}}},taxPolicy:{id:'tax-v1',basisPoints:1000,taxableDelivery:true,taxableService:false},tipPolicy:{id:'tip-v1',maximumMinor:'150',maximumFoodBps:1000,party:'DRIVER'},tipMinor:'80'});
test('coupon discounts only food, tax follows policy, subsidy and every receivable conserve funds',()=>{
 const r=priceCommerce(basket());assert.equal(r.couponDiscount.amountMinor,'120');assert.equal(r.foodAfterDiscount.amountMinor,'1081');assert.equal(r.taxableBase.amountMinor,'1180');assert.equal(r.tax.amountMinor,'118');assert.equal(r.total.amountMinor,'1429');assert.equal(r.platformContribution.amountMinor,'90');assert.deepEqual(Object.fromEntries(Object.entries(r.receivables).map(([k,v])=>[k,v.amountMinor])),{merchant:'1196',driver:'180',platform:'25',tax:'118'});assert.equal(BigInt(r.total.amountMinor)+BigInt(r.platformContribution.amountMinor),Object.values(r.receivables).reduce((n,v)=>n+BigInt(v.amountMinor),0n));
});
test('optional coupon and zero-tax/tip preserve existing non-discounted food and delivery totals',()=>{
 const input=basket();delete input.coupon;input.tipMinor='0';input.taxPolicy.basisPoints=0;const r=priceCommerce(input);assert.equal(r.total.amountMinor,'1351');assert.equal(r.platformContribution.amountMinor,'0');assert.equal(r.coupon,null);assert.equal(r.requiresPayment,true);
});
test('100percent merchant-funded food can total zero without marking an order paid',()=>{
 const input=basket();input.serving='pickup';input.deliveryFeeMinor='0';input.serviceFeeMinor='0';input.feeAllocation={merchantMinor:'0',driverMinor:'0',platformMinor:'0'};input.coupon!.terms={minimumFoodMinor:'0',maximumDiscountMinor:'9999',merchantFundingBps:10000,discount:{kind:'BASIS_POINTS',basisPoints:10000}};input.tipMinor='0';const r=priceCommerce(input);assert.equal(r.total.amountMinor,'0');assert.equal(r.requiresPayment,false);assert.ok(!('paid'in r));
});
test('reject unbalanced fees, pickup driver claims, oversized tips and malformed policies',()=>{
 const mismatch=basket();mismatch.feeAllocation.platformMinor='26';assert.throws(()=>priceCommerce(mismatch),/ALLOCATION/);
 const pickup=basket();pickup.serving='pickup';assert.throws(()=>priceCommerce(pickup),/REQUIRES_DELIVERY/);
 const tip=basket();tip.tipMinor='109';assert.throws(()=>priceCommerce(tip),/TIP_LIMIT/);
 const denomination=basket();denomination.decimals=6;assert.throws(()=>priceCommerce(denomination),/DENOMINATION/);
 const bps=basket();bps.taxPolicy.basisPoints=0.5;assert.throws(()=>priceCommerce(bps),/RATE/);
 const overflow=basket();overflow.foodLines=[{lineId:'a',amountMinor:'999999999999999999'}];delete overflow.coupon;overflow.tipMinor='0';assert.throws(()=>priceCommerce(overflow),/OVERFLOW/);
});
