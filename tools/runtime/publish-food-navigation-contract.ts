import {readFile,writeFile} from 'node:fs/promises';
const path='packages/openapi/mobile-v1.json',spec=JSON.parse(await readFile(path,'utf8'));
const ref=(name:string)=>({$ref:`#/components/schemas/${name}`});
const nullable=(value:object)=>({anyOf:[value,{type:'null'}]});
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const uuid={type:'string',format:'uuid'},generation={type:'string',pattern:'^[1-9][0-9]{0,18}$'};
const schemas=spec.components.schemas;
schemas.FoodMapPoint=object({latitudeE7:{type:'integer',minimum:-900000000,maximum:900000000},longitudeE7:{type:'integer',minimum:-1800000000,maximum:1800000000}});
schemas.FoodNavigationAssignment=object({assignmentId:uuid,generation,leaseGeneration:generation,shipmentId:uuid,state:{type:'string',enum:['ACCEPTED','AT_PICKUP','PICKED_UP','AT_DROPOFF','INCIDENT']},fixture:{type:'boolean'},target:{type:'string',enum:['PICKUP','DROPOFF']},targetLatitudeE7:{type:'integer',minimum:-900000000,maximum:900000000},targetLongitudeE7:{type:'integer',minimum:-1800000000,maximum:1800000000},location:nullable(ref('FoodTrackedLocation'))});
schemas.FoodNavigationRoute=object({points:{type:'array',minItems:2,maxItems:2048,items:ref('FoodMapPoint')},durationSeconds:{type:'integer',minimum:0},distanceMetres:{type:'integer',minimum:0},fixture:{type:'boolean'},attribution:{type:'string',minLength:1,maxLength:512}});
schemas.FoodNavigationSnapshot=object({serverTime:{type:'string',format:'date-time'},assignment:nullable(ref('FoodNavigationAssignment')),route:nullable(ref('FoodNavigationRoute')),routeUnavailable:nullable({type:'string',enum:['unconfigured','no_assignment','location_unavailable','location_stale','provider_unavailable','invalid_response']}),tilesAvailable:{type:'boolean'},tileAttribution:nullable({type:'string',minLength:1,maxLength:512}),tileFixture:{type:'boolean'}});
schemas.FoodNavigationTile=object({pngBase64:{type:'string',minLength:1,maxLength:349528},fixture:{type:'boolean'},attribution:{type:'string',minLength:1,maxLength:512}});
const fence=[{name:'assignmentId',in:'query',required:true,schema:uuid},...['generation','leaseGeneration'].map(name=>({name,in:'query',required:true,schema:generation}))];
for(const [url,operationId] of [['/food/orders/{orderId}/delivery/navigation','foodDeliveryNavigation'],['/driver/food/navigation','foodDriverNavigation']]){
 spec.paths[url]={...(url.includes('{orderId}')?{parameters:[{name:'orderId',in:'path',required:true,schema:uuid}]}:{}),get:{operationId,security:[{mobileBearer:[]}],parameters:fence,responses:{'200':{description:'Current authorized assignment route. Exact assignment and generations required; provider I/O outside SQL locks, then authority revalidated. No guessed route or financial effects.',content:{'application/json':{schema:ref('FoodNavigationSnapshot')}}}}}};
}
for(const [url,operationId] of [['/food/orders/{orderId}/delivery/navigation/tile','foodDeliveryTile'],['/driver/food/navigation/tile','foodDriverTile']]){
 spec.paths[url]={...(url.includes('{orderId}')?{parameters:[{name:'orderId',in:'path',required:true,schema:uuid}]}:{}),get:{operationId,security:[{mobileBearer:[]}],parameters:[...fence,...['z','x','y'].map(name=>({name,in:'query',required:true,schema:{type:'integer',minimum:name==='z'?12:0,maximum:name==='z'?18:262143}}))],responses:{'200':{description:'Private bounded PNG tile within assigned job corridor. Provider credentials never reach app; no arbitrary-world proxy.',content:{'application/json':{schema:ref('FoodNavigationTile')}}}}}};
}
await writeFile(path,JSON.stringify(spec,null,2)+'\n');
console.log('Published fenced food navigation contracts; run generate-mobile-contracts.ts');
