import {readFile,writeFile} from 'node:fs/promises';
const path='packages/openapi/mobile-v1.json',spec=JSON.parse(await readFile(path,'utf8'));
const uuid={type:'string',format:'uuid'},positive={type:'string',pattern:'^[1-9][0-9]{0,18}$'},time={type:'string',format:'date-time'},text={type:'string',minLength:1,maxLength:500},noEffect={type:'boolean',enum:[false]},state={type:'string',enum:['WAITING_MERCHANT','WAITING_PAYMENT','READY_FOR_DISPATCH','OFFERING','ASSIGNED','AT_PICKUP','PICKED_UP','AT_DROPOFF','DELIVERED','CANCELLED','FAILED','INCIDENT']},reasonCode={type:'string',enum:['NO_DRIVER','LATE_ORDER','WRONG_ORDER','CHANGE_OF_PLANS','OTHER']},decision={type:'string',enum:['COMPENSATION_REVIEW_REQUIRED','DECLINED']};
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties}),ref=(name:string)=>({$ref:`#/components/schemas/${name}`});
const common={reviewId:uuid,shipmentId:uuid,reviewVersion:positive,reasonCode,requestedShipmentVersion:positive,requestedShipmentState:state,requestedAt:time};
Object.assign(spec.components.schemas,{
 FoodCancellationReviewRequestCommand:object({idempotencyKey:uuid,expectedVersion:positive,reasonCode,detail:{type:'string',minLength:1,maxLength:2000}}),
 FoodCancellationReviewDispositionCommand:object({idempotencyKey:uuid,expectedReviewVersion:positive,expectedShipmentVersion:positive,decision,customerExplanation:text}),
 FoodCancellationReviewInspectCommand:object({purpose:text}),
 FoodCancellationReviewOpen:object({...common,state:{type:'string',enum:['OPEN']}}),
 FoodCancellationReviewReviewed:object({...common,state:{type:'string',enum:['REVIEWED']},reviewedAt:time,decision,customerExplanation:text,reviewedShipmentVersion:positive,reviewedShipmentState:state}),
 FoodCancellationReview:{oneOf:[ref('FoodCancellationReviewOpen'),ref('FoodCancellationReviewReviewed')],discriminator:{propertyName:'state'}},
 FoodCancellationReviewReceipt:object({review:ref('FoodCancellationReview'),shipmentVersion:positive,orderCancelled:noEffect,refundExecuted:noEffect,custodyReleased:noEffect,stockReturned:noEffect}),
 FoodCancellationReviewOwnPage:object({items:{type:'array',items:ref('FoodCancellationReview'),maxItems:20},historyLimit:{type:'integer',enum:[20]},shipmentVersion:positive,shipmentState:state}),
 FoodCancellationReviewQueue:object({items:{type:'array',items:ref('FoodCancellationReview'),maxItems:50},historyLimit:{type:'integer',enum:[50]}}),
 FoodCancellationReviewSnapshot:object({review:ref('FoodCancellationReview'),shipmentVersion:positive,shipmentState:state}),
 FoodCancellationReviewInspection:object({reviewId:uuid,detail:{type:'string',minLength:1,maxLength:2000},inspectionId:uuid}),
});
function operation(pathName:string,param:string,method:'get'|'post',operationId:string,result:string,input?:string){
 const op:any={operationId,security:[{mobileBearer:[]}],responses:{'200':{description:'Review-only cancellation request/triage. Never executes order cancellation, refund, stock return or custody release.',content:{'application/json':{schema:ref(result)}}}}};
 if(input)op.requestBody={required:true,content:{'application/json':{schema:ref(input)}}};
 spec.paths[pathName]={...(spec.paths[pathName]??{}),parameters:[{name:param,in:'path',required:true,schema:uuid}],[method]:op};
}
operation('/orders/{orderId}/cancellation-reviews','orderId','post','foodCustomerCancellationReviewRequest','FoodCancellationReviewReceipt','FoodCancellationReviewRequestCommand');
operation('/orders/{orderId}/cancellation-reviews','orderId','get','foodCustomerCancellationReviews','FoodCancellationReviewOwnPage');
operation('/platform/merchants/{merchantId}/food/cancellation-reviews','merchantId','get','foodCancellationReviewQueue','FoodCancellationReviewQueue');
operation('/platform/food/cancellation-reviews/{reviewId}/review','reviewId','get','foodCancellationReviewSnapshot','FoodCancellationReviewSnapshot');
operation('/platform/food/cancellation-reviews/{reviewId}/inspect','reviewId','post','foodCancellationReviewInspect','FoodCancellationReviewInspection','FoodCancellationReviewInspectCommand');
operation('/platform/food/cancellation-reviews/{reviewId}/disposition','reviewId','post','foodCancellationReviewDisposition','FoodCancellationReviewReceipt','FoodCancellationReviewDispositionCommand');
await writeFile(path,JSON.stringify(spec,null,2)+'\n');console.log('Published strict cancellation review-only request/triage tagged contracts; all physical/financial effects false');
