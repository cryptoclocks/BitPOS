import test from 'node:test';import assert from 'node:assert/strict';
import {createFoodRefundFunding} from '../apps/worker/src/food-refund-funding';
import type {RefundSqlTransaction} from '../apps/worker/src/food-refund-store';
import type pg from 'pg';
import {fundingFixture,recipient} from './payout-provider.fixture';
import {USDG_ASSET} from '../packages/domain/src/payment-assets';
const id='00000000-0000-4000-8000-000000000001',signature='2'.repeat(88);
const input={policyId:id,expectedConfigVersion:'1',signature};
function transaction(value:unknown,calls:string[]):RefundSqlTransaction{return async run=>run({query:async(sql:string)=>{calls.push(sql);return {rows:[{value}]};}}as unknown as Pick<pg.PoolClient,'query'>);}
test('unconfigured refund funding never discovers configuration or touches a provider',async()=>{
 const f=createFoodRefundFunding();assert.deepEqual(await f.record(input),{status:'UNAVAILABLE',reason:'NOT_CONFIGURED'});assert.deepEqual(await f.reserve({}),{status:'UNAVAILABLE',reason:'NOT_CONFIGURED'});
});
test('client verified flags are rejected before SQL; disabled or changed policy cannot reach chain',async()=>{
 const fixture=await fundingFixture(USDG_ASSET),calls:string[]=[];
 fixture.connection.getGenesisHash=async()=>{throw Error('Disabled configuration must not reach provider');};
 const config={policyId:id,configVersion:'1',enabled:false,senderPublicKey:recipient.publicKey.toBase58(),asset:USDG_ASSET,registryAsset:USDG_ASSET};
 const f=createFoodRefundFunding({transaction:transaction(config,calls),connection:fixture.connection});
 await assert.rejects(f.record({...input,verified:true}));assert.equal(calls.length,0);
 assert.deepEqual(await f.record(input),{status:'UNAVAILABLE',reason:'CONFIGURATION_CHANGED'});assert.equal(calls.length,1);
 const changed=createFoodRefundFunding({transaction:transaction({...config,enabled:true,configVersion:'2'},[]),connection:fixture.connection});assert.deepEqual(await changed.record(input),{status:'UNAVAILABLE',reason:'CONFIGURATION_CHANGED'});
});
