import test from 'node:test';
import assert from 'node:assert/strict';
import {createFoodRefundRuntime,createFoodRefundWorker} from '../apps/worker/src/food-refund-runtime';
import type {PayoutProvider} from '../apps/worker/src/payout-provider';

const config={sourceOwner:'4Vm9jmb7JNd7SRJiD6PWxhkxjFck1xDGzxGchTd7BAdh',feePayerOwner:'8u6kFDrJa2fhtDawyiZRrroTTTPzEqhtdThBqboERLXv',allowedAssetIds:['usdg-devnet'],maxAmountMinor:'5000000',maxFeeLamports:10000,maxTotalLamports:3000000,maxAttemptsPerTick:3};

test('refund lane is off unless explicitly enabled and never touches a database, key or RPC', async()=>{
 const runtime=createFoodRefundRuntime({});
 assert.deepEqual(await runtime.worker.tick(),{status:'UNAVAILABLE',processed:0,outcomes:{NOT_CONFIGURED:1}});
 await runtime.close();
});

test('enabled lane refuses incomplete, malformed or in-tree private configuration', ()=>{
 const base={BITPOS_FOOD_REFUND_ENABLED:'1'};
 assert.throws(()=>createFoodRefundRuntime(base),/FOOD_REFUND_PUBLIC_CONFIGURATION_INVALID/);
 assert.throws(()=>createFoodRefundRuntime({...base,BITPOS_FOOD_REFUND_PUBLIC_CONFIG:JSON.stringify({...config,extra:1})}),/FOOD_REFUND_PUBLIC_CONFIGURATION_INVALID/);
 assert.throws(()=>createFoodRefundRuntime({...base,BITPOS_FOOD_REFUND_PUBLIC_CONFIG:JSON.stringify({...config,allowedAssetIds:['other']})}),/FOOD_REFUND_PUBLIC_CONFIGURATION_INVALID/);
 assert.throws(()=>createFoodRefundRuntime({...base,BITPOS_FOOD_REFUND_PUBLIC_CONFIG:JSON.stringify(config)}),/FOOD_REFUND_PRIVATE_CONFIGURATION_REQUIRED/);
 const full={...base,BITPOS_FOOD_REFUND_PUBLIC_CONFIG:JSON.stringify(config),BITPOS_FOOD_REFUND_WORKER_DATABASE_URL:'postgresql://worker@127.0.0.1:1/x',BITPOS_FOOD_REFUND_SOURCE_KEY_PATH:'/tmp/source.json',BITPOS_FOOD_REFUND_FEE_PAYER_KEY_PATH:'/tmp/fee.json'};
 assert.throws(()=>createFoodRefundRuntime({...full,BITPOS_FOOD_REFUND_RPC_URL:'http://example.com'}),/FOOD_REFUND_RPC_CONFIGURATION_INVALID/);
 assert.throws(()=>createFoodRefundRuntime({...full,BITPOS_FOOD_REFUND_RPC_URL:'https://user:pw@api.devnet.solana.com'}),/FOOD_REFUND_RPC_CONFIGURATION_INVALID/);
 assert.throws(()=>createFoodRefundRuntime({...full,BITPOS_FOOD_REFUND_RPC_URL:'https://api.devnet.solana.com',BITPOS_FOOD_REFUND_SOURCE_KEY_PATH:'relative.json'}),/FOOD_REFUND_PRIVATE_CONFIGURATION_REQUIRED/);
});

test('unavailable provider leaves work untouched and asks SQL for nothing', async()=>{
 let queried=false;
 const worker=createFoodRefundWorker(config,{provider:{kind:'unavailable',reason:'NOT_CONFIGURED'} as PayoutProvider,transaction:async run=>run({query:async()=>{queried=true;return{rows:[]};}} as never)});
 assert.deepEqual(await worker.tick(),{status:'UNAVAILABLE',processed:0,outcomes:{PROVIDER_UNAVAILABLE:1}});
 assert.equal(queried,false);
});

test('a malformed work list is rejected instead of guessed', async()=>{
 const worker=createFoodRefundWorker(config,{provider:{kind:'ready'} as PayoutProvider,transaction:async run=>run({query:async()=>({rows:[{value:['not-a-uuid']}]})} as never)});
 await assert.rejects(worker.tick());
});

test('empty work list is a successful idle tick and the limit is bound as a parameter', async()=>{
 let args:unknown[]=[],sql='';
 const worker=createFoodRefundWorker(config,{provider:{kind:'ready'} as PayoutProvider,transaction:async run=>run({query:async(text:string,values:unknown[])=>{sql=text;args=values;return{rows:[{value:[]}]};}} as never)});
 assert.deepEqual(await worker.tick(),{status:'AVAILABLE',processed:0,outcomes:{}});
 assert.match(sql,/food_refund161_work/);assert.deepEqual(args,[3]);
});
