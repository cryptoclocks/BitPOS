import test from'node:test';import assert from'node:assert/strict';import{priceCoupon,COUPON_MAX_MINOR,type CouponPricingTerms}from'../packages/domain/src/coupon-pricing';
const fixed=(amount:string,overrides:Partial<CouponPricingTerms>={}):CouponPricingTerms=>({minimumFoodMinor:'0',maximumDiscountMinor:'999999999999999999',discount:{kind:'FIXED',fixedMinor:amount},merchantFundingBps:10000,...overrides});
test('fixed coupon preserves food and funding conservation with odd quantities/line totals',()=>{
 const result=priceCoupon(fixed('101',{merchantFundingBps:3333}),[{lineId:'b',amountMinor:'100'},{lineId:'a',amountMinor:'100'},{lineId:'c',amountMinor:'100'}]);assert.equal(result.discountMinor,'101');assert.equal(result.payableFoodMinor,'199');assert.equal(result.merchantFundingMinor,'33');assert.equal(result.platformFundingMinor,'68');assert.deepEqual(result.lines.map(l=>[l.lineId,l.discountMinor]),[['a','34'],['b','34'],['c','33']]);
});
test('percentage uses integer floor then fixed cap; values above JS safe integer retain exact units',()=>{
 const result=priceCoupon({...fixed('1'),discount:{kind:'BASIS_POINTS',basisPoints:3333},maximumDiscountMinor:'999999999999999999'},[{lineId:'a',amountMinor:'9007199254740993'}]);assert.equal(result.discountMinor,(9007199254740993n*3333n/10000n).toString());
 assert.equal(priceCoupon({...fixed('1'),discount:{kind:'BASIS_POINTS',basisPoints:5000},maximumDiscountMinor:'25'},[{lineId:'a',amountMinor:'101'}]).discountMinor,'25');
});
test('fully funded food is represented as zero food payable without fabricating a payment',()=>{
 const result=priceCoupon(fixed('1000'),[{lineId:'free',amountMinor:'0'},{lineId:'food',amountMinor:'75'}]);assert.equal(result.discountMinor,'75');assert.equal(result.payableFoodMinor,'0');assert.equal(result.lines[1].discountMinor,'0');assert.ok(!('paid'in result));
});
test('reject malformed amounts, duplicate IDs, under-minimum, zero/overflow and invalid basis points',()=>{
 for(const amount of['-1','01','1.5','1e2',' 1','1000000000000000000'])assert.throws(()=>priceCoupon(fixed('1'),[{lineId:'a',amountMinor:amount}]));
 assert.throws(()=>priceCoupon(fixed('1'),[{lineId:'a',amountMinor:'1'},{lineId:'a',amountMinor:'2'}]));assert.throws(()=>priceCoupon(fixed('1',{minimumFoodMinor:'10'}),[{lineId:'a',amountMinor:'9'}]),/MINIMUM/);
 assert.throws(()=>priceCoupon(fixed('1'),[{lineId:'a',amountMinor:'0'}]),/NO_DISCOUNTABLE/);assert.throws(()=>priceCoupon(fixed('1'),[{lineId:'a',amountMinor:String(COUPON_MAX_MINOR)},{lineId:'b',amountMinor:'1'}]),/OVERFLOW/);
 for(const value of[-1,1.5,10001,NaN,Infinity])assert.throws(()=>priceCoupon(fixed('1',{merchantFundingBps:value}),[{lineId:'a',amountMinor:'100'}]));
 assert.throws(()=>priceCoupon({...fixed('1'),discount:{kind:'BASIS_POINTS',basisPoints:1}},[{lineId:'a',amountMinor:'1'}]),/ROUNDS_TO_ZERO/);
});
test('permutation-independent allocation conserves every minor unit across many sparse baskets',()=>{
 for(let size=1;size<=50;size++){const lines=Array.from({length:size},(_,i)=>({lineId:String(i).padStart(3,'0'),amountMinor:String((i*37+size)%101)}));const total=lines.reduce((n,l)=>n+BigInt(l.amountMinor),0n);if(total===0n)continue;for(const discount of[1n,total/2n||1n,total]){const a=priceCoupon(fixed(String(discount)),lines),b=priceCoupon(fixed(String(discount)),[...lines].reverse());assert.deepEqual(a,b);assert.equal(a.lines.reduce((n,l)=>n+BigInt(l.discountMinor),0n),discount);for(const l of a.lines){assert.equal(BigInt(l.foodMinor),BigInt(l.discountMinor)+BigInt(l.payableFoodMinor));assert.ok(BigInt(l.discountMinor)<=BigInt(l.foodMinor));}}}
});
