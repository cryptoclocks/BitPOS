import {readFile,writeFile} from 'node:fs/promises';
const path='packages/openapi/mobile-v1.json',spec=JSON.parse(await readFile(path,'utf8'));
const uuid={type:'string',format:'uuid'},positive={type:'string',pattern:'^[1-9][0-9]{0,18}$'},object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties}),ref=(name:string)=>({$ref:`#/components/schemas/${name}`});
const common={idempotencyKey:uuid,expectedVersion:positive,generation:positive,leaseGeneration:positive,reason:{type:'string',enum:['UNAVAILABLE','VEHICLE','SAFETY','OTHER']}};
spec.components.schemas.FoodWithdrawCommand=object(common);
spec.components.schemas.FoodReofferCommand=object({...common,driverId:uuid});
spec.components.schemas.FoodRecoveryReceipt=object({assignmentId:uuid,shipmentId:uuid,generation:positive,leaseGeneration:positive,shipmentGeneration:positive,shipmentVersion:positive,state:{type:'string',enum:['RELEASED']},searchEpoch:{anyOf:[positive,{type:'null'}]},replacementOffer:{anyOf:[ref('FoodOfferReceipt'),{type:'null'}]}});
for(const [pathName,operationId,input] of [['/driver/food/assignments/{assignmentId}/withdraw','foodWithdraw','FoodWithdrawCommand'],['/platform/food/assignments/{assignmentId}/withdraw','foodStaffWithdraw','FoodWithdrawCommand'],['/platform/food/assignments/{assignmentId}/reoffer','foodStaffReoffer','FoodReofferCommand']]){
 spec.paths[pathName!]={parameters:[{name:'assignmentId',in:'path',required:true,schema:uuid}],post:{operationId,security:[{mobileBearer:[]}],requestBody:{required:true,content:{'application/json':{schema:ref(input!)}}},responses:{'200':{description:'Pre-custody assignment released exactly once. Replacement is only an offer requiring driver acceptance; no stock/payment/refund/earning effect.',content:{'application/json':{schema:ref('FoodRecoveryReceipt')}}}}}};
}
await writeFile(path,JSON.stringify(spec,null,2)+'\n');console.log('Published strict purpose-specific pre-custody recovery contracts');
