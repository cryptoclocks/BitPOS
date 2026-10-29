import {readFile,writeFile} from 'node:fs/promises';
const path='packages/openapi/mobile-v1.json',spec=JSON.parse(await readFile(path,'utf8'));
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties}),ref=(name:string)=>({$ref:'#/components/schemas/'+name}),nullable=(schema:unknown)=>({anyOf:[schema,{type:'null'}]});
const time={type:'string',format:'date-time'},positive={type:'string',pattern:'^[1-9][0-9]{0,18}$'};
Object.assign(spec.components.schemas,{
 FoodCustomerDispatchSearch:object({version:positive,expiresAt:time}),
 FoodCustomerReassignment:object({count:{type:'integer',minimum:1,maximum:2147483647},lastReleasedAt:time}),
 FoodCustomerDispatch:object({phase:{type:'string',enum:['NOT_STARTED','SEARCHING','OFFERED','ASSIGNED','NEEDS_ATTENTION','CLOSED']},attentionReason:nullable({type:'string',enum:['PROVIDER_UNAVAILABLE','NO_CANDIDATE','DEADLINE','BUDGET','POLICY_UNAVAILABLE','MANUAL']}),search:nullable(ref('FoodCustomerDispatchSearch')),reassignment:nullable(ref('FoodCustomerReassignment'))}),
});
spec.components.schemas.FoodCustomerWork.properties.dispatch=ref('FoodCustomerDispatch');
if(!spec.components.schemas.FoodCustomerWork.required.includes('dispatch'))spec.components.schemas.FoodCustomerWork.required.push('dispatch');
await writeFile(path,JSON.stringify(spec,null,2)+'\n');
console.log('Published required owner-safe customer dispatch progress on existing REST/SSE work contract; no staff fields or new route');
