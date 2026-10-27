import {readFile,writeFile} from 'node:fs/promises';
const path='packages/openapi/mobile-v1.json',spec=JSON.parse(await readFile(path,'utf8'));
const uuid={type:'string',format:'uuid'},positive={type:'string',pattern:'^[1-9][0-9]{0,18}$'},object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties}),ref=(name:string)=>({$ref:`#/components/schemas/${name}`});
spec.components.schemas.FoodDeclineCommand=object({idempotencyKey:uuid,expectedVersion:positive,generation:positive,reason:{type:'string',enum:['UNAVAILABLE','DISTANCE','VEHICLE','SAFETY','OTHER']}});
spec.components.schemas.FoodDeclineReceipt=object({offerId:uuid,shipmentId:uuid,generation:positive,version:positive,state:{type:'string',enum:['REJECTED']}});
spec.paths['/driver/food/offers/{offerId}/decline']={parameters:[{name:'offerId',in:'path',required:true,schema:uuid}],post:{operationId:'foodDecline',security:[{mobileBearer:[]}],requestBody:{required:true,content:{'application/json':{schema:ref('FoodDeclineCommand')}}},responses:{'200':{description:'Own offer declined exactly once; no custody or financial effect.',content:{'application/json':{schema:ref('FoodDeclineReceipt')}}}}}};
await writeFile(path,JSON.stringify(spec,null,2)+'\n');console.log('Published owner-scoped exact offer refusal contract');
