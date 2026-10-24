import {z} from 'zod';
import {PlatformSession,PlatformError} from './platform-session';
import {FoodIncidentPageSchema,FoodIncidentReviewSchema,FoodIncidentInspectionSchema,FoodIncidentAckCommandSchema,FoodIncidentResumeCommandSchema,FoodIncidentReceiptSchema,FoodIncidentResumeReceiptSchema} from '../../../../packages/contracts/src/mobile-v1.generated';
import type {FoodIncidentAckCommand,FoodIncidentResumeCommand} from '../../../../packages/contracts/src/mobile-v1.generated';
const uuid=z.string().uuid();
const pendingSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('ACK'),incidentId:uuid,command:FoodIncidentAckCommandSchema}).strict(),
 z.object({kind:z.literal('RESUME'),assignmentId:uuid,command:FoodIncidentResumeCommandSchema}).strict(),
]);
export type PendingFoodIncident=z.infer<typeof pendingSchema>;
// Reuse the separate global staff identity; merchant cookies never become staff authority.
export class FoodIncidentSession extends PlatformSession{
 incidentQueue=async(merchantId:string,afterId:string|null)=>FoodIncidentPageSchema.parse(await this.request('platform/merchants/'+uuid.parse(merchantId)+'/food/incidents'+(afterId?'?afterId='+encodeURIComponent(uuid.parse(afterId)):'')));
 incidentReview=async(incidentId:string)=>FoodIncidentReviewSchema.parse(await this.request('platform/food/incidents/'+uuid.parse(incidentId)+'/review'));
 inspectIncident=async(incidentId:string,purpose:string)=>FoodIncidentInspectionSchema.parse(await this.request('platform/food/incidents/'+uuid.parse(incidentId)+'/inspect',{purpose}));
 pendingIncident():PendingFoodIncident|null{
  const account=this.accountId;if(!account)throw new PlatformError('AUTH_REQUIRED',401);
  const raw=localStorage.getItem('bitpos.platform.foodIncident.'+account);return raw?pendingSchema.parse(JSON.parse(raw)):null;
 }
 acknowledgeIncident=(incidentId:string,command:FoodIncidentAckCommand)=>this.submitIncident({kind:'ACK',incidentId,command});
 resumeIncident=(assignmentId:string,command:FoodIncidentResumeCommand)=>this.submitIncident({kind:'RESUME',assignmentId,command});
 private async journal<T>(account:string,action:()=>T):Promise<T>{
  if(typeof navigator==='undefined'||!navigator.locks)throw new PlatformError('CONFIGURATION_REQUIRED',503);
  return navigator.locks.request('bitpos.platform.foodIncident.'+account,action);
 }
 async submitIncident(input:PendingFoodIncident){
  const account=this.accountId;if(!account)throw new PlatformError('AUTH_REQUIRED',401);
  const owner=this.sessionOwner(),saved=pendingSchema.parse(input),key='bitpos.platform.foodIncident.'+account,encoded=JSON.stringify(saved);
  await this.journal(account,()=>{this.requireSessionOwner(owner);const raw=localStorage.getItem(key);if(raw&&JSON.stringify(pendingSchema.parse(JSON.parse(raw)))!==encoded)throw new PlatformError('PENDING_COMMAND',409);localStorage.setItem(key,encoded);});
  const retire=()=>this.journal(account,()=>{if(localStorage.getItem(key)===encoded)localStorage.removeItem(key);});
  this.requireSessionOwner(owner);
  try{
   if(saved.kind==='ACK'){
    const receipt=FoodIncidentReceiptSchema.parse(await this.request('platform/food/incidents/'+saved.incidentId+'/acknowledge',saved.command));
    if(receipt.incident.incidentId!==saved.incidentId)throw new PlatformError('INVALID_RECEIPT',502);
    await retire();return {kind:'ACK' as const,receipt};
   }
   const receipt=FoodIncidentResumeReceiptSchema.parse(await this.request('platform/food/assignments/'+saved.assignmentId+'/resume',saved.command));
   if(receipt.assignmentId!==saved.assignmentId||receipt.generation!==saved.command.generation||receipt.leaseGeneration!==saved.command.leaseGeneration)throw new PlatformError('INVALID_RECEIPT',502);
   await retire();return {kind:'RESUME' as const,receipt};
  }catch(error){
   if(error instanceof PlatformError&&['INVALID_REQUEST','VERSION_CONFLICT','RESOURCE_NOT_FOUND','INCIDENT_ALREADY_ACKNOWLEDGED','INCIDENT_ACK_REQUIRED','INCIDENT_NOT_PAUSED','DRIVER_SUSPENDED','DRIVER_DOCUMENT_EXPIRED','DRIVER_VERIFICATION_REQUIRED','FOOD_SERVICE_UNAVAILABLE','DRIVER_UNAVAILABLE','DISPATCH_TRANSITION_INVALID','ASSIGNMENT_CHANGED'].includes(error.code))await retire();
   throw error;
  }
 }
}
