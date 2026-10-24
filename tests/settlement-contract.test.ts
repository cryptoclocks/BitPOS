import test from 'node:test';import assert from 'node:assert/strict';
import {SettlementPayoutProjectionSchema,SettlementBatchReceiptSchema,SettlementPrepareCommandSchema} from '../packages/contracts/src/mobile-v1.generated';
import {USDG_ASSET} from '../packages/domain/src/payment-assets';
const id='00000000-0000-4000-8000-000000000088',money={amountMinor:'100',currency:'USD',decimals:2},payoutMoney={amountMinor:'1000000',currency:'USDG',decimals:6};
test('unavailable original payout policy cannot smuggle an estimated amount or asset',()=>{
 const required={status:'SETUP_REQUIRED',reasonCode:'SETUP_REQUIRED_ORIGINAL_RECEIPT',payoutMoney:null,asset:null};
 assert.equal(SettlementPayoutProjectionSchema.parse(required).status,'SETUP_REQUIRED');
 for(const altered of [{...required,payoutMoney},{...required,asset:USDG_ASSET},{...required,reasonCode:'WALLET_CALLBACK_VERIFIED'},{status:'ZERO_EARNING',payoutMoney,asset:null}])assert.equal(SettlementPayoutProjectionSchema.safeParse(altered).success,false);
});
test('reserve receipt cannot imply a money transfer or accept numeric/incorrectly scaled amounts',()=>{
 const receipt={kind:'BATCH_RESERVED',batchId:id,state:'RESERVED',version:'2',money,payoutMoney,asset:USDG_ASSET,reserveTransactionId:id,outwardReady:false,fundsTransferred:false};
 const parsed=SettlementBatchReceiptSchema.parse(receipt);assert.equal(parsed.fundsTransferred,false);
 for(const altered of [{...receipt,fundsTransferred:true},{...receipt,outwardReady:true},{...receipt,money:{...money,amountMinor:100}},{...receipt,payoutMoney:{...payoutMoney,decimals:2}},{...receipt,money:{...money,amountMinor:'9223372036854775808'}},{...receipt,providerVerified:true}])assert.equal(SettlementBatchReceiptSchema.safeParse(altered).success,false);
});
test('batch preparation never accepts client money, conversion or verification flags',()=>{
 const command={idempotencyKey:id,expectedVersion:'0',merchantId:id,driverId:id,beneficiaryId:id,beneficiaryVersion:'2',sourceIds:[id],sourceVersions:['2']};
 assert.equal(SettlementPrepareCommandSchema.parse(command).sourceVersions[0],'2');
 for(const extra of [{money},{payoutMoney},{denominationPolicy:{numerator:'1',denominator:'1'}},{verified:true},{fundsTransferred:true}])assert.equal(SettlementPrepareCommandSchema.safeParse({...command,...extra}).success,false);
 assert.equal(SettlementPrepareCommandSchema.safeParse({...command,sourceIds:[]}).success,false);
 assert.equal(SettlementPrepareCommandSchema.safeParse({...command,sourceVersions:[2]}).success,false);
});
