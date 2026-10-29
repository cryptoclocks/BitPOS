import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRepeatLimit,repeatRequest,type RepeatLimit} from '../apps/api/src/coffee-order-constraints';
import {assetSettlement,USDG_ASSET} from '../packages/domain/src/payment-assets';
const now=Date.UTC(2026,9,12,15),recipient='11111111111111111111111111111111';
const limit:RepeatLimit={sourceOrderId:'00000000-0000-4000-8000-000000000001',asset:USDG_ASSET,recipient,maxAtomic:'9007199254740993',expiresAt:new Date(now+60000).toISOString()};
const exact=assetSettlement(USDG_ASSET,limit.maxAtomic,{id:'repeat-unit-cap',numerator:'1',denominator:'1'},recipient);
test('repeat caps compare integer amounts beyond floating-point precision',()=>{
 assert.throws(()=>assertRepeatLimit(limit,{...exact,amountMinor:'9007199254740994'},now),/REPEAT_CAP_EXCEEDED/);
});
test('repeat authorization rejects changing asset, program, mint, genesis, recipient or decimals',()=>{
 for(const mutation of [{assetId:'usdc-devnet'},{tokenProgram:'wrong'},{mint:'wrong'},{genesisHash:'wrong'},{recipient:'wrong'},{decimals:2}] as const)assert.throws(()=>assertRepeatLimit(limit,{...exact,...mutation} as typeof exact,now),/REPEAT_CAP_EXCEEDED/);
});
test('repeat cap expires at the deadline, not after another payment window',()=>{
 assert.throws(()=>assertRepeatLimit(limit,exact,now+60000),/REPEAT_CAP_EXPIRED/);
});
test('repeat request cannot substitute public order ID for private paid visit or decimal amount for atomic cap',()=>{
 const valid={sourceVisitToken:'a'.repeat(43),requestId:'00000000-0000-4000-8000-000000000002',assetId:'usdg-devnet',maxAtomic:'1',expiresAt:limit.expiresAt};
 assert.equal(repeatRequest.safeParse({...valid,sourceVisitToken:limit.sourceOrderId}).success,false);
 assert.equal(repeatRequest.safeParse({...valid,maxAtomic:'1.0'}).success,false);
 assert.equal(repeatRequest.safeParse({...valid,orderId:limit.sourceOrderId}).success,false);
});
