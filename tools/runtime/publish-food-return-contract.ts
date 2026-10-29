// Additive return-history compatibility only; no public return routes admitted.
import{readFile,writeFile}from'node:fs/promises';
const path='packages/openapi/mobile-v1.json',spec=JSON.parse(await readFile(path,'utf8')),s=spec.components.schemas;
function append(values:string[],value:string){if(!values.includes(value))values.push(value);}
append(s.FoodDriverHistoryItem.properties.state.enum,'RETURNED');
append(s.FoodIncident.properties.custodyPhase.enum,'RETURNED');
append(s.FoodIncidentReview.properties.assignmentState.enum,'RETURNED');
append(s.FoodIncident.properties.resolution.anyOf[0].enum,'RETURNED_TO_MERCHANT');
const uuid={type:'string',format:'uuid'},positive={type:'string',pattern:'^[1-9][0-9]{0,18}$'},time={type:'string',format:'date-time'},reason={type:'string',minLength:1,maxLength:500};
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties}),nullable=(schema:unknown)=>({anyOf:[schema,{type:'null'}]}),ref=(name:string)=>({$ref:'#/components/schemas/'+name});
Object.assign(s,{
 FoodDriverCompensation:object({assignmentId:uuid,execution:nullable(ref('FoodCompensationExecution'))}),
 FoodCompensationExecution:object({caseId:uuid,state:{type:'string',enum:['NOT_DECIDED','ZERO_APPROVED','PENDING','FUNDING_REQUIRED','PREPARED','UNKNOWN','FINALIZED','FAILED','RECONCILIATION_REQUIRED']},approvedAmount:nullable(ref('MobileMoney')),fundsTransferred:{type:'boolean'}}),
 FoodCompensationRetireCommand:object({idempotencyKey:uuid,expectedVersion:positive,policyId:uuid,reason}),
 FoodCompensationRetireReceipt:object({caseId:uuid,policyId:uuid,state:{type:'string',enum:['RETIRED']},fundsTransferred:{type:'boolean',enum:[false]}}),
 FoodCompensationPublishCommand:object({idempotencyKey:uuid,expectedVersion:positive,enabled:{type:'boolean'},returnedRateBps:{type:'integer',minimum:0,maximum:10000},maxMinor:{type:'string',pattern:'^(0|[1-9][0-9]{0,18})$'},reason}),
 FoodCompensationPublishReceipt:object({caseId:uuid,policyId:uuid,enabled:{type:'boolean'},currency:{type:'string',enum:['USD','USDG']},decimals:{type:'integer',enum:[2,4,6]},returnedRateBps:{type:'integer',minimum:0,maximum:10000},maxMinor:{type:'string',pattern:'^(0|[1-9][0-9]{0,18})$'},fundsTransferred:{type:'boolean',enum:[false]}}),
 FoodCompensationPolicy:object({policyId:uuid,currency:{type:'string',enum:['USD','USDG']},decimals:{type:'integer',enum:[2,4,6]},returnedRateBps:{type:'integer',minimum:0,maximum:10000},maxMinor:{type:'string',pattern:'^(0|[1-9][0-9]{0,18})$'}}),
 FoodCompensationSnapshot:object({caseId:uuid,shipmentVersion:positive,currency:{type:'string',enum:['USD','USDG']},decimals:{type:'integer',enum:[2,4,6]},policies:{type:'array',items:ref('FoodCompensationPolicy')},decision:nullable(ref('FoodCompensationReceipt'))}),
 FoodCompensationCommand:object({idempotencyKey:uuid,expectedVersion:positive,policyId:uuid,reason}),
 FoodCompensationReceipt:object({caseId:uuid,policyId:uuid,amountMinor:{type:'string',pattern:'^(0|[1-9][0-9]{0,18})$'},currency:{type:'string',enum:['USD','USDG']},decimals:{type:'integer',enum:[2,4,6]},state:{type:'string',enum:['APPROVED']},fundsTransferred:{type:'boolean',enum:[false]}}),
 FoodRefundReconcileCommand:object({idempotencyKey:uuid,expectedVersion:positive,reason}),
 FoodRefundReconcileReceipt:object({caseId:uuid,addedPaymentCount:{type:'integer',minimum:0,maximum:2147483647},executionState:{type:'string',enum:['PENDING']},fundsTransferred:{type:'boolean',enum:[false]}}),
 FoodCustomerRefundExecution:object({orderId:uuid,execution:nullable(ref('FoodReturnExecution'))}),
 FoodReturnExecution:object({caseId:uuid,state:{type:'string',enum:['NOT_DECIDED','NOT_REQUESTED','PENDING','PARTIAL','FAILED','FINALIZED','SELECTED_FINALIZED','RECONCILIATION_REQUIRED']},paymentCount:{type:'integer',minimum:0,maximum:2147483647},allocationCount:{type:'integer',minimum:0,maximum:2147483647},finalizedCount:{type:'integer',minimum:0,maximum:2147483647},failedCount:{type:'integer',minimum:0,maximum:2147483647},disputed:{type:'boolean'},unallocatedPaymentCount:{type:'integer',minimum:0,maximum:2147483647},allPaymentsRefunded:{type:'boolean'},selectedRefund:nullable(ref('FoodSelectedRefund'))}),
 FoodReturnFinancialCommand:{oneOf:['FoodFullRefundCommand','FoodNoRefundCommand','FoodLineRefundCommand'].map(ref),discriminator:{propertyName:'decision'}},
 FoodReturnFinancialReceipt:{oneOf:['FoodFullRefundReceipt','FoodNoRefundReceipt','FoodLineRefundReceipt'].map(ref),discriminator:{propertyName:'decision'}},
 FoodReturnFinancialSnapshot:object({caseId:uuid,shipmentVersion:positive,catalogTotal:ref('MobileMoney'),paymentCount:{type:'integer',minimum:0,maximum:2147483647},decision:nullable(ref('FoodReturnFinancialReceipt')),lines:{type:'array',maxItems:50,items:ref('FoodSelectedRefund')}}),
 FoodSelectedRefund:object({lineId:uuid,name:{type:'string',maxLength:320},nameEn:{type:'string',maxLength:320},qty:{type:'integer',minimum:1,maximum:100},selections:{type:'array',maxItems:200,items:ref('MobileSelectedOption')},catalogAmount:ref('MobileMoney'),paymentId:uuid,refundAmount:ref('MobileMoney')}),
 FoodFullRefundCommand:object({idempotencyKey:uuid,expectedVersion:positive,decision:{type:'string',enum:['FULL_REFUND']},reason}),
 FoodNoRefundCommand:object({idempotencyKey:uuid,expectedVersion:positive,decision:{type:'string',enum:['NO_REFUND']},reason}),
 FoodLineRefundCommand:object({idempotencyKey:uuid,expectedVersion:positive,decision:{type:'string',enum:['LINE_REFUND']},reason,lineId:uuid}),
 FoodFullRefundReceipt:object({caseId:uuid,decision:{type:'string',enum:['FULL_REFUND']},paymentCount:{type:'integer',minimum:1,maximum:2147483647},executionState:{type:'string',enum:['PENDING']},fundsTransferred:{type:'boolean',enum:[false]},stockRestored:{type:'boolean',enum:[false]}}),
 FoodNoRefundReceipt:object({caseId:uuid,decision:{type:'string',enum:['NO_REFUND']},paymentCount:{type:'integer',minimum:1,maximum:2147483647},executionState:{type:'string',enum:['NOT_REQUESTED']},fundsTransferred:{type:'boolean',enum:[false]},stockRestored:{type:'boolean',enum:[false]}}),
 FoodLineRefundReceipt:object({caseId:uuid,decision:{type:'string',enum:['LINE_REFUND']},paymentCount:{type:'integer',minimum:1,maximum:2147483647},executionState:{type:'string',enum:['PENDING']},fundsTransferred:{type:'boolean',enum:[false]},stockRestored:{type:'boolean',enum:[false]},selection:ref('FoodSelectedRefund')}),
 FoodReturnRequestCommand:object({idempotencyKey:uuid,expectedVersion:positive,generation:positive,leaseGeneration:positive,reason}),
 FoodReturnReceiveCommand:object({idempotencyKey:uuid,expectedVersion:positive,condition:{type:'string',enum:['SEALED','OPENED','DAMAGED']},reason}),
 FoodReturnResolveCommand:object({idempotencyKey:uuid,expectedVersion:positive,reason}),
 FoodReturnStageReceipt:object({caseId:uuid,assignmentId:uuid,state:{type:'string',enum:['RETURN_REQUESTED','RETURN_RECORDED']},custodyReleased:{type:'boolean',enum:[false]},financialResolutionReady:{type:'boolean',enum:[false]}}),
 FoodReturnResolutionReceipt:object({caseId:uuid,assignmentId:uuid,state:{type:'string',enum:['RETURN_RESOLVED']},custodyReleased:{type:'boolean',enum:[true]},financialReview:{type:'string',enum:['PENDING']},fundsTransferred:{type:'boolean',enum:[false]},stockRestored:{type:'boolean',enum:[false]}}),
 FoodReturnCase:object({caseId:uuid,state:{type:'string',enum:['RETURN_REQUESTED','RETURN_RECORDED','RETURN_RESOLVED']},requestedAt:time,receivedAt:nullable(time),condition:nullable({type:'string',enum:['SEALED','OPENED','DAMAGED']}),resolvedAt:nullable(time),custodyReleased:{type:'boolean'},financialReview:{type:'string',enum:['PENDING','NOT_OPENED']}}),
 FoodReturnSnapshot:object({assignmentId:uuid,shipmentVersion:positive,case:nullable(ref('FoodReturnCase'))}),
});
function operation(pathName:string,param:string,method:'get'|'post',operationId:string,result:string,input?:string){
 const op:any={operationId,security:[{mobileBearer:[]}],'x-bitpos-admission':pathName.endsWith('/financial-review')?'BITPOS_FOOD_RETURNS_ENABLED=1 and BITPOS_FOOD_RETURN_FINANCE_ENABLED=1 and reviewed108+109schema/grants; scoped administrator; default disabled':'BITPOS_FOOD_RETURNS_ENABLED=1 and reviewed108schema/grants; default disabled',responses:{'200':{description:'Return operational authority; financial review pending is not refund execution.',content:{'application/json':{schema:ref(result)}}},'503':{description:'Return admission disabled or schema not configured'}}};
 if(input)op.requestBody={required:true,content:{'application/json':{schema:ref(input)}}};
 spec.paths[pathName]={...(spec.paths[pathName]??{}),parameters:[{name:param,in:'path',required:true,schema:uuid}],[method]:op};
}
operation('/platform/food/assignments/{assignmentId}/return','assignmentId','get','foodReturnSnapshot','FoodReturnSnapshot');
operation('/platform/food/assignments/{assignmentId}/return','assignmentId','post','foodReturnRequest','FoodReturnStageReceipt','FoodReturnRequestCommand');
operation('/platform/food/returns/{caseId}/resolve','caseId','post','foodReturnResolve','FoodReturnResolutionReceipt','FoodReturnResolveCommand');
operation('/platform/food/returns/{caseId}/financial-review','caseId','get','foodReturnFinancialSnapshot','FoodReturnFinancialSnapshot');
operation('/platform/food/returns/{caseId}/financial-review','caseId','post','foodReturnFinancialDecision','FoodReturnFinancialReceipt','FoodReturnFinancialCommand');
operation('/platform/food/returns/{caseId}/execution','caseId','get','foodReturnExecution','FoodReturnExecution');
spec.paths['/platform/food/returns/{caseId}/execution'].get['x-bitpos-admission']='Return+finance+BITPOS_FOOD_REFUND_EXECUTION_READ_ENABLED=1; reviewed108–116 schema/grants; scoped administrator; default disabled';
operation('/food/orders/{orderId}/refund-execution','orderId','get','foodCustomerRefundExecution','FoodCustomerRefundExecution');
operation('/platform/food/returns/{caseId}/reconcile-payments','caseId','post','foodRefundReconcile','FoodRefundReconcileReceipt','FoodRefundReconcileCommand');
spec.paths['/platform/food/returns/{caseId}/reconcile-payments'].post['x-bitpos-admission']='Return+finance+BITPOS_FOOD_REFUND_RECONCILE_ENABLED=1; reviewed119schema/grants; scoped administrator; default disabled';
operation('/platform/food/returns/{caseId}/compensation','caseId','get','foodCompensationSnapshot','FoodCompensationSnapshot');
operation('/platform/food/returns/{caseId}/compensation','caseId','post','foodCompensationApprove','FoodCompensationReceipt','FoodCompensationCommand');
spec.paths['/platform/food/returns/{caseId}/compensation'].post['x-bitpos-admission']='Return+finance+BITPOS_FOOD_COMPENSATION_ENABLED=1; reviewed120 schema/grants and explicit policy; scoped administrator; default disabled';
operation('/platform/food/returns/{caseId}/compensation-policy','caseId','post','foodCompensationPublish','FoodCompensationPublishReceipt','FoodCompensationPublishCommand');
spec.paths['/platform/food/returns/{caseId}/compensation-policy'].post['x-bitpos-admission']='Return+finance+compensation+BITPOS_FOOD_COMPENSATION_POLICY_ENABLED=1; reviewed121 schema/grants; explicit scoped administrator publication; default disabled';
operation('/platform/food/returns/{caseId}/compensation-policy-retire','caseId','post','foodCompensationRetire','FoodCompensationRetireReceipt','FoodCompensationRetireCommand');
spec.paths['/platform/food/returns/{caseId}/compensation-policy-retire'].post['x-bitpos-admission']='Return+finance+compensation+policy+BITPOS_FOOD_COMPENSATION_RETIRE_ENABLED=1; reviewed122 schema/grants; scoped administrator; default disabled';
operation('/platform/food/returns/{caseId}/compensation-execution','caseId','get','foodCompensationExecution','FoodCompensationExecution');
spec.paths['/platform/food/returns/{caseId}/compensation-execution'].get['x-bitpos-admission']='Return+finance+compensation+BITPOS_FOOD_COMPENSATION_READ_ENABLED=1; reviewed133 schema/grants; scoped administrator; default disabled';
operation('/driver/food/assignments/{assignmentId}/compensation','assignmentId','get','foodDriverCompensation','FoodDriverCompensation');
spec.paths['/driver/food/assignments/{assignmentId}/compensation'].get['x-bitpos-admission']='Return+compensation+read flags; reviewed134 schema/grants; live assignment owner session; default disabled';
await writeFile(path,JSON.stringify(spec,null,2)+'\n');
console.log('Published additive returned history/incident compatibility; default-disabled return platform operations documented');
