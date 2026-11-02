import assert from 'node:assert/strict';
import test from 'node:test';
import {CashPriceError,discountMinor,priceCashSale,splitVat} from '../apps/api/src/cash/pricing';

const line=(qty:number,unit:bigint)=>({productId:'p',qty,unitMinor:unit});
const none={mode:'none' as const,bps:700},vat7={mode:'inclusive' as const,bps:700};
const code=(fn:()=>unknown)=>{try{fn();return null;}catch(e){return e instanceof CashPriceError?e.code:'other';}};

test('totals, change and the empty cart',()=>{
 const t=priceCashSale([line(2,6500n),line(1,5500n)],null,none,20000n);
 assert.deepEqual([t.subtotal,t.discount,t.total,t.net,t.vat,t.change],[18500n,0n,18500n,18500n,0n,1500n]);
 assert.equal(code(()=>priceCashSale([],null,none)),'EMPTY_CART');
 assert.equal(priceCashSale([line(1,100n)],null,none).change,null);
});
test('percent discount rounds down in the shop favour and must stay below the subtotal',()=>{
 assert.equal(discountMinor(999n,{kind:'percent',bps:1000}),99n);   // 99.9 -> 99
 assert.equal(discountMinor(1000n,{kind:'amount',minor:'250'}),250n);
 assert.equal(code(()=>discountMinor(1000n,{kind:'amount',minor:'1000'})),'DISCOUNT_TOO_LARGE');
 assert.equal(code(()=>discountMinor(1000n,{kind:'percent',bps:10000})),'DISCOUNT_TOO_LARGE');
 assert.equal(discountMinor(1n,{kind:'percent',bps:9999}),0n);
});
test('tax-inclusive split keeps net+vat equal to the total for every amount',()=>{
 assert.deepEqual(splitVat(10700n,{mode:'inclusive',bps:700}),{net:10000n,vat:700n});
 assert.deepEqual(splitVat(100n,vat7),{net:93n,vat:7n});
 for(let total=1n;total<=30000n;total++){
  const {net,vat}=splitVat(total,vat7);
  assert.equal(net+vat,total);assert.ok(net>0n&&vat>=0n);
  // net is the nearest integer to total/1.07: |net*107 - total*100| <= 53
  const diff=net*107n-total*100n;assert.ok((diff<0n?-diff:diff)<=53n,`total ${total}`);
 }
 assert.deepEqual(splitVat(500n,{mode:'inclusive',bps:0}),{net:500n,vat:0n});
 assert.deepEqual(splitVat(500n,none),{net:500n,vat:0n});
});
test('tender must cover the total; huge amounts are refused instead of overflowing',()=>{
 assert.equal(code(()=>priceCashSale([line(1,1000n)],null,none,999n)),'TENDER_TOO_LOW');
 assert.equal(priceCashSale([line(1,1000n)],{kind:'amount',minor:'100'},vat7,900n).change,0n);
 assert.equal(code(()=>priceCashSale([line(100,90_000_000_000_000_000n)],null,none)),'BAD_AMOUNT');
 assert.equal(code(()=>priceCashSale([line(1,1000n)],null,none,9_000_000_000_000_001n)),'BAD_AMOUNT');
});
