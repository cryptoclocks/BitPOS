import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateReturnedFoodCompensation as calculate,type FoodCompensationPolicy,type ReturnedFoodCompensationFacts} from '../packages/domain/src/food-compensation';
const policy:FoodCompensationPolicy={id:'fixture-policy-v1',enabled:true,currency:'USDG',decimals:6,returnedRateBps:3333,maxMinor:1000000n};
const facts:ReturnedFoodCompensationFacts={assignmentState:'RETURNED',shipmentState:'FAILED',merchantReceiptRecorded:true,blockersAcknowledged:true,ordinaryEarningExists:false,quotedDriverMinor:1000001n,currency:'USDG',decimals:6};
test('returned compensation uses integer floor and explicit policy cap; no implicit full earning',()=>{
 assert.deepEqual(calculate(policy,facts),{state:'CALCULATED',policyId:policy.id,amountMinor:333300n,currency:'USDG',decimals:6});
 assert.equal(calculate({...policy,maxMinor:5n},facts).amountMinor,5n);
 assert.equal(calculate({...policy,returnedRateBps:10000,maxMinor:9223372036854775807n},{...facts,quotedDriverMinor:9223372036854775807n}).amountMinor,9223372036854775807n);
});
test('incomplete custody, existing earning and denomination mismatch require review',()=>{
 for(const change of [{assignmentState:'DELIVERED'},{shipmentState:'DELIVERED'},{merchantReceiptRecorded:false},{blockersAcknowledged:false},{ordinaryEarningExists:true},{currency:'USDC'},{decimals:4}])assert.deepEqual(calculate(policy,{...facts,...change}),{state:'REVIEW_REQUIRED',amountMinor:0n});
 assert.deepEqual(calculate({...policy,enabled:false},facts),{state:'DISABLED',amountMinor:0n});
});
test('reject invalid rates, negative amounts and int64 overflow',()=>{
 for(const rate of [-1,10001,0.5,NaN])assert.throws(()=>calculate({...policy,returnedRateBps:rate},facts));
 for(const amount of [-1n,9223372036854775808n]){assert.throws(()=>calculate({...policy,maxMinor:amount},facts));assert.throws(()=>calculate(policy,{...facts,quotedDriverMinor:amount}));}
});
