import{test}from'node:test';import assert from'node:assert/strict';
import{FoodReturnRequestCommandSchema,FoodReturnReceiveCommandSchema,FoodReturnResolutionReceiptSchema,FoodReturnSnapshotSchema}from'../packages/contracts/src/mobile-v1.generated';
const id='00000000-0000-4000-8000-000000000108';
test('return commands reject client money, custody shortcuts and missing fences',()=>{
 const request={idempotencyKey:id,expectedVersion:'1',generation:'1',leaseGeneration:'1',reason:'Return review'};assert.ok(FoodReturnRequestCommandSchema.safeParse(request).success);
 assert.equal(FoodReturnRequestCommandSchema.safeParse({...request,refundMinor:'390'}).success,false);
 assert.equal(FoodReturnRequestCommandSchema.safeParse({...request,generation:undefined}).success,false);
 assert.equal(FoodReturnReceiveCommandSchema.safeParse({idempotencyKey:id,expectedVersion:'2',condition:'RESTOCKED',reason:'Unsafe automatic stock'}).success,false);
});
test('operational closure receipt cannot claim transferred money or stock restoration',()=>{
 const value={caseId:id,assignmentId:id,state:'RETURN_RESOLVED',custodyReleased:true,financialReview:'PENDING',fundsTransferred:false,stockRestored:false};assert.ok(FoodReturnResolutionReceiptSchema.safeParse(value).success);
 for(const key of ['fundsTransferred','stockRestored'])assert.equal(FoodReturnResolutionReceiptSchema.safeParse({...value,[key]:true}).success,false);
 assert.ok(FoodReturnSnapshotSchema.safeParse({assignmentId:id,shipmentVersion:'1',case:null}).success);
});
