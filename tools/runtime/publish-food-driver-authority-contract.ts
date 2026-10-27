import {readFile,writeFile} from 'node:fs/promises';
const path='packages/openapi/mobile-v1.json',spec=JSON.parse(await readFile(path,'utf8')),schemas=spec.components.schemas;
const ref=(name:string)=>({$ref:'#/components/schemas/'+name}),uuid={type:'string',format:'uuid'},positive={type:'string',pattern:'^[1-9][0-9]{0,18}$'},object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
schemas.FoodDriverAssignment.properties.access={type:'string',enum:['NORMAL']};schemas.FoodDriverAssignment.properties.shipmentVersion=positive;schemas.FoodDriverAssignment.required=Object.keys(schemas.FoodDriverAssignment.properties);
schemas.FoodDriverRestrictedAssignment=object({access:{type:'string',enum:['RESTRICTED']},id:uuid,shipmentId:uuid,generation:positive,leaseGeneration:positive,shipmentVersion:positive,custodyPhase:{type:'string',enum:['PREPICKUP','PICKED_UP']},reason:{type:'string',enum:['DRIVER_SUSPENDED','DRIVER_VERIFICATION_REQUIRED','DRIVER_DOCUMENT_EXPIRED','FOOD_SERVICE_UNAVAILABLE','INCIDENT']}});
schemas.FoodDriverDuty={oneOf:[ref('FoodDriverAssignment'),ref('FoodDriverRestrictedAssignment')],discriminator:{propertyName:'access'}};
schemas.FoodDriverWork.properties.assignment={anyOf:[ref('FoodDriverDuty'),{type:'null'}]};
schemas.FoodCustomerAssignment.properties.serviceAvailable={type:'boolean'};schemas.FoodCustomerAssignment.required=Object.keys(schemas.FoodCustomerAssignment.properties);
await writeFile(path,JSON.stringify(spec,null,2)+'\n');console.log('Published sealed normal versus restricted retained driver duty and explicit customer service availability; restricted variant has no address/contact/location/proof');
