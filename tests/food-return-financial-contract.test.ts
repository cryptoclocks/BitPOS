import test from 'node:test';import assert from 'node:assert/strict';
import {FoodReturnFinancialCommandSchema,FoodReturnFinancialReceiptSchema} from '../packages/contracts/src/mobile-v1.generated';
const caseId='00000000-0000-4000-8000-000000000001';
test('financial decision wire rejects client money, missing authority fences and execution shortcuts',()=>{
 const command={idempotencyKey:caseId,expectedVersion:'1',decision:'FULL_REFUND',reason:'Review received payment facts'};
 assert.equal(FoodReturnFinancialCommandSchema.safeParse(command).success,true);
 for(const extra of [{amountMinor:'1'},{beneficiary:'client-wallet'},{currency:'THB'}])assert.equal(FoodReturnFinancialCommandSchema.safeParse({...command,...extra}).success,false);
 assert.equal(FoodReturnFinancialCommandSchema.safeParse({...command,expectedVersion:undefined}).success,false);
 const receipt={caseId,decision:'FULL_REFUND',paymentCount:1,executionState:'PENDING',fundsTransferred:false,stockRestored:false};
 assert.equal(FoodReturnFinancialReceiptSchema.safeParse(receipt).success,true);
 assert.equal(FoodReturnFinancialReceiptSchema.safeParse({...receipt,fundsTransferred:true}).success,false);
 assert.equal(FoodReturnFinancialReceiptSchema.safeParse({...receipt,stockRestored:true}).success,false);
});
test('selected original line requires its immutable identity and never accepts client monetary authority',()=>{
 const command={idempotencyKey:caseId,expectedVersion:'1',decision:'LINE_REFUND',reason:'Review original configured food line',lineId:'00000000-0000-4000-8000-000000000002'};
 assert.equal(FoodReturnFinancialCommandSchema.safeParse(command).success,true);
 for(const invalid of [{...command,lineId:undefined},{...command,lineId:'product-id'},{...command,amountMinor:'100'},{...command,paymentId:caseId},{...command,decision:'FULL_REFUND'}])assert.equal(FoodReturnFinancialCommandSchema.safeParse(invalid).success,false);
});
