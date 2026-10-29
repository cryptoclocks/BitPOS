import {readFile,writeFile} from 'node:fs/promises';
const path='packages/openapi/mobile-v1.json',spec=JSON.parse(await readFile(path,'utf8'));
const uuid={type:'string',format:'uuid'},positive={type:'string',pattern:'^[1-9][0-9]{0,18}$'},version={type:'string',pattern:'^(0|[1-9][0-9]{0,18})$'},ref=(name:string)=>({$ref:'#/components/schemas/'+name}),nullable=(schema:unknown)=>({anyOf:[schema,{type:'null'}]}),object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties}),literal=(value:string)=>({type:'string',enum:[value]});
const capability={type:'string',enum:['unknown','denied','authorized','provisional','unsupported','unavailable']},common={idempotencyKey:uuid,expectedRevision:version,capability,locale:{type:'string',enum:['th','en']}},fid={type:'string',minLength:1,maxLength:2048,pattern:'^[^\\s\\u0000-\\u001f\\u007f]+$'};
Object.assign(spec.components.schemas,{
 MobilePushEnable:object({kind:literal('ENABLE'),...common,platform:{type:'string',enum:['android','ios']},consentVersion:literal('food-transactional-v1'),fid}),
 MobilePushRotate:object({kind:literal('ROTATE'),...common,fid}),
 MobilePushDisable:object({kind:literal('DISABLE'),...common,reason:{type:'string',enum:['USER_OPT_OUT','OS_PERMISSION','DEVICE_UNAVAILABLE']}}),
 MobilePushCommand:{oneOf:[ref('MobilePushEnable'),ref('MobilePushRotate'),ref('MobilePushDisable')],discriminator:{propertyName:'kind'}},
 MobilePushUnregistered:object({kind:literal('UNREGISTERED'),revision:literal('0')}),
 MobilePushRegistered:object({kind:literal('REGISTERED'),installationId:uuid,bindingId:nullable(uuid),revision:positive,generation:nullable(positive),boundToCurrentSession:{type:'boolean'},consentEnabled:{type:'boolean'},capability,endpointRegistered:{type:'boolean'}}),
 MobilePushInstallation:{oneOf:[ref('MobilePushUnregistered'),ref('MobilePushRegistered')],discriminator:{propertyName:'kind'}},
 MobilePushStatus:object({installation:ref('MobilePushInstallation'),endpointEncryptionAvailable:{type:'boolean'}}),
 MobilePushReceipt:object({installationId:uuid,bindingId:uuid,revision:positive,generation:positive,action:{type:'string',enum:['ENABLE','ROTATE','DISABLE']},replayed:{type:'boolean'}}),
 MobilePushOpenRequest:object({bindingId:uuid,bindingGeneration:positive}),
 MobilePushOpenUnavailable:object({kind:literal('UNAVAILABLE')}),
 MobilePushOpenCustomerOrder:object({kind:literal('CUSTOMER_ORDER'),orderId:uuid}),
 MobilePushOpenDriverWork:object({kind:literal('DRIVER_WORK')}),
 MobilePushOpenResult:{oneOf:[ref('MobilePushOpenUnavailable'),ref('MobilePushOpenCustomerOrder'),ref('MobilePushOpenDriverWork')],discriminator:{propertyName:'kind'}},
});
const key={name:'X-BitPOS-Push-Installation-Key',in:'header',required:true,schema:{type:'string',pattern:'^[A-Za-z0-9_-]{43}$'},description:'Secure random32byte installation proof. Never log or put in URLs.'};
const response=(name:string,description:string)=>({200:{description,content:{'application/json':{schema:ref(name)}}}});
for(const app of ['customer','driver']){
 spec.paths['/notifications/'+app+'/installation']={parameters:[key],get:{operationId:'mobilePush'+app+'Status',security:[{mobileBearer:[]}],responses:response('MobilePushStatus','Current authenticated session installation status; no FID or endpoint material.')},post:{operationId:'mobilePush'+app+'Command',security:[{mobileBearer:[]}],parameters:[{...key,name:'X-BitPOS-Push-Next-Key',required:false,description:'New random installation proof, required only for explicit ENABLE; persisted before request.'}],requestBody:{required:true,content:{'application/json':{schema:ref('MobilePushCommand')}}},responses:response('MobilePushReceipt','Historical idempotent command receipt, not current effective consent; use GET to reconcile.')}};
 spec.paths['/notifications/'+app+'/events/{eventId}/open']={parameters:[key,{name:'eventId',in:'path',required:true,schema:uuid}],post:{operationId:'mobilePush'+app+'Open',security:[{mobileBearer:[]}],requestBody:{required:true,content:{'application/json':{schema:ref('MobilePushOpenRequest')}}},responses:response('MobilePushOpenResult','Opaque event resolution rechecks account/session/device/binding generation and current job authority; refetch existing authorized order/work APIs.')}};
}
await writeFile(path,JSON.stringify(spec,null,2)+'\n');console.log('Published strict private notification installation and opaque-open contracts for customer and driver; no merchant proxy expansion');
