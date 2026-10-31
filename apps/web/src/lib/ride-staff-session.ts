import {PlatformError,PlatformSession} from './platform-session';
import {MobileRideFareStateSchema,MobileRideFareSchema,MobileRideFarePublishSchema,MobileRideIncidentQueueSchema,MobileRideIncidentReviewSchema,MobileRideIncidentReviewedSchema,type MobileRideFarePublish,type MobileRideIncidentReview} from '../../../../packages/contracts/src/mobile-v1.generated';

/** Staff ride facts stay in memory. Unknown writes require a fresh read; neither
 * incident text nor credentials are journalled in browser storage. */
export class RideStaffSession extends PlatformSession {
 private writing=false;
 async fare(){const owner=this.sessionOwner(),result=MobileRideFareStateSchema.parse(await this.request('rides/fare'));this.requireSessionOwner(owner);return result;}
 async incidents(){const owner=this.sessionOwner(),result=MobileRideIncidentQueueSchema.parse(await this.request('rides/incidents'));this.requireSessionOwner(owner);return result;}
 async publish(input:MobileRideFarePublish){
  const owner=this.sessionOwner(),command=MobileRideFarePublishSchema.parse(input);
  if(this.writing)throw new PlatformError('REQUEST_IN_PROGRESS',409);this.writing=true;
  try{const result=MobileRideFareSchema.parse(await this.request('rides/fare',command,'PUT'));this.requireSessionOwner(owner);
   for(const key of ['currency','decimals','baseMinor','perKmMinor','perMinuteMinor','minimumMinor','sharedDiscountBps'] as const)if(result[key]!==command[key])throw new PlatformError('INVALID_RECEIPT',409);
   if(result.rateId===command.expectedRateId)throw new PlatformError('INVALID_RECEIPT',409);return result;
  }finally{this.writing=false;}
 }
 async review(id:string,input:MobileRideIncidentReview){
  const owner=this.sessionOwner(),command=MobileRideIncidentReviewSchema.parse(input);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new PlatformError('INVALID_REQUEST',422);
  if(this.writing)throw new PlatformError('REQUEST_IN_PROGRESS',409);this.writing=true;
  try{const result=MobileRideIncidentReviewedSchema.parse(await this.request('rides/incidents/'+id+'/review',command));this.requireSessionOwner(owner);
   if(result.incidentId!==id||result.outcome!==command.outcome)throw new PlatformError('INVALID_RECEIPT',409);return result;
  }finally{this.writing=false;}
 }
}
