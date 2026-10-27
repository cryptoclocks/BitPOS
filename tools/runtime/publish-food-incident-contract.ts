import {readFile,writeFile} from 'node:fs/promises';
const path='packages/openapi/mobile-v1.json',spec=JSON.parse(await readFile(path,'utf8'));
const uuid={type:'string',format:'uuid'},positive={type:'string',pattern:'^[1-9][0-9]{0,18}$'},time={type:'string',format:'date-time'},reason={type:'string',minLength:1,maxLength:500};
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties}),ref=(name:string)=>({$ref:`#/components/schemas/${name}`}),nullable=(schema:unknown)=>({anyOf:[schema,{type:'null'}]});
const kind={type:'string',enum:['SUPPORT','SOS','COLLISION','HARASSMENT','MISSING_ITEM','CUSTODY','FRAUD']},phase={type:'string',enum:['ACCEPTED','AT_PICKUP','PICKED_UP','AT_DROPOFF','DELIVERED','RELEASED','INCIDENT','RETURNED']};
Object.assign(spec.components.schemas,{
 FoodIncidentReportCommand:object({idempotencyKey:uuid,generation:positive,leaseGeneration:positive,kind,body:{type:'string',minLength:1,maxLength:4000}}),
 FoodIncidentAckCommand:object({idempotencyKey:uuid,expectedVersion:positive,reason}),
 FoodIncidentResumeCommand:object({idempotencyKey:uuid,expectedVersion:positive,generation:positive,leaseGeneration:positive,reason}),
 FoodIncidentInspectCommand:object({purpose:reason}),
 FoodIncident:object({incidentId:uuid,assignmentId:uuid,shipmentId:uuid,generation:positive,leaseGeneration:positive,incidentVersion:positive,kind,custodyPhase:phase,blocksDuty:{type:'boolean'},reportedAt:time,acknowledgedAt:nullable(time),resolvedAt:nullable(time),resolution:nullable({type:'string',enum:['SAME_CUSTODY_RESUMED','RETURNED_TO_MERCHANT']})}),
 FoodIncidentReceipt:object({incident:ref('FoodIncident'),shipmentVersion:positive,paused:{type:'boolean'}}),
 FoodIncidentPage:object({incidents:{type:'array',items:ref('FoodIncident'),maxItems:30},nextCursor:nullable(uuid)}),
 FoodIncidentInspection:object({incident:ref('FoodIncident'),body:{type:'string',minLength:1,maxLength:4000},auditId:uuid}),
 FoodIncidentReview:object({incident:ref('FoodIncident'),shipmentVersion:positive,assignmentState:phase,leaseState:{type:'string',enum:['ACTIVE','RELEASED']},currentDuty:{type:'boolean'},unresolvedBlocking:{type:'integer',minimum:0},unacknowledgedBlocking:{type:'integer',minimum:0}}),
 FoodIncidentResumeReceipt:object({assignmentId:uuid,shipmentId:uuid,generation:positive,leaseGeneration:positive,shipmentVersion:positive,state:{type:'string',enum:['ACCEPTED','AT_PICKUP','PICKED_UP','AT_DROPOFF']},resolvedCount:{type:'integer',minimum:1}}),
});
function operation(pathName:string,param:string,method:'get'|'post',operationId:string,result:string,input?:string){
 const parameters=[{name:param,in:'path',required:true,schema:uuid}];
 const op:any={operationId,security:[{mobileBearer:[]}],responses:{'200':{description:'Food incident authority; acknowledgement is not resume, cancellation, emergency contact, refund or payout.',content:{'application/json':{schema:ref(result)}}}}};
 if(input)op.requestBody={required:true,content:{'application/json':{schema:ref(input)}}};
 else op.parameters=[{name:'afterId',in:'query',required:false,schema:uuid}];
 spec.paths[pathName]={...(spec.paths[pathName]??{}),parameters,[method]:op};
}
operation('/driver/food/assignments/{assignmentId}/incidents','assignmentId','post','foodIncidentReport','FoodIncidentReceipt','FoodIncidentReportCommand');
operation('/driver/food/assignments/{assignmentId}/incidents','assignmentId','get','foodOwnIncidents','FoodIncidentPage');
operation('/platform/merchants/{merchantId}/food/incidents','merchantId','get','foodIncidentQueue','FoodIncidentPage');
operation('/platform/food/incidents/{incidentId}/acknowledge','incidentId','post','foodIncidentAcknowledge','FoodIncidentReceipt','FoodIncidentAckCommand');
operation('/platform/food/incidents/{incidentId}/inspect','incidentId','post','foodIncidentInspect','FoodIncidentInspection','FoodIncidentInspectCommand');
operation('/platform/food/assignments/{assignmentId}/resume','assignmentId','post','foodIncidentResume','FoodIncidentResumeReceipt','FoodIncidentResumeCommand');
operation('/platform/food/incidents/{incidentId}/review','incidentId','get','foodIncidentReview','FoodIncidentReview');
delete spec.paths['/platform/food/incidents/{incidentId}/review'].get.parameters;
await writeFile(path,JSON.stringify(spec,null,2)+'\n');console.log('Published narrow incident report ACK separate resume and audited inspection contracts');
