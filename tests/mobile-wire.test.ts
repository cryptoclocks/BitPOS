import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {z} from 'zod';
import {MobileMoneySchema,MobileFoodQuoteRequestSchema,MobileBranchesSchema,MobileMenuSchema,FoodMerchantRiderSchema,FoodMerchantAssignmentSchema,FoodPreparationEstimateSchema,FoodMerchantAcceptanceCommandSchema} from '../packages/contracts/src/mobile-v1.generated';
const decoders:Record<string,z.ZodType>={MobileMoney:MobileMoneySchema,MobileFoodQuoteRequest:MobileFoodQuoteRequestSchema,MobileBranches:MobileBranchesSchema,MobileMenu:MobileMenuSchema,FoodMerchantRider:FoodMerchantRiderSchema,FoodMerchantAssignment:FoodMerchantAssignmentSchema,FoodPreparationEstimate:FoodPreparationEstimateSchema,FoodMerchantAcceptanceCommand:FoodMerchantAcceptanceCommandSchema};
const fixtures=JSON.parse(await readFile(new URL('../packages/openapi/fixtures/mobile-wire.json',import.meta.url),'utf8')) as {cases:{name:string;model:string;valid:boolean;value:unknown}[]};
for(const fixture of fixtures.cases)test('mobile wire: '+fixture.name,()=>{
 const decoder=decoders[fixture.model];assert.ok(decoder,'fixture decoder exists');
 const result=decoder.safeParse(fixture.value);assert.equal(result.success,fixture.valid,result.success?'unexpected acceptance':result.error.message);
 if(result.success)assert.deepEqual(result.data,fixture.value,'wire values preserve integer money and nested fields');
});
