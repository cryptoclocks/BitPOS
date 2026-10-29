import type pg from 'pg';
import {z} from 'zod';
import {randomBytes} from 'node:crypto';
import {hash} from '../../../packages/domain/src/index';
import type {ConsumerError} from '../../../packages/contracts/src/index';
import {pool} from './db';
import {mobilePrincipal,type MobilePrincipal} from './mobile-auth';
import {fail,RequestError} from './authority';
import {DriverApplicationCommandSchema,DriverAvailabilityCommandSchema,DriverDecisionCommandSchema,DriverProfileResultSchema,DriverCommandReceiptSchema,DriverQueueSchema,DriverQueueItemSchema,PlatformRolesSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {DeliveryPolicyCommandSchema,DeliveryPolicyReceiptSchema,DeliveryPolicyResultSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {FoodOfferCommandSchema,FoodOfferReceiptSchema,FoodClaimCommandSchema,FoodClaimReceiptSchema,FoodArrivalCommandSchema,FoodArrivalReceiptSchema,FoodLocationCommandSchema,FoodLocationReceiptSchema,FoodProofIssueCommandSchema,FoodProofIssueReceiptSchema,FoodProofConsumeCommandSchema,FoodProofConfirmedSchema,FoodProofRefusedSchema,FoodTrackingSnapshotSchema,FoodDriverWorkSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {FoodCustomerWorkSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {FoodDeclineCommandSchema,FoodDeclineReceiptSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {FoodWithdrawCommandSchema,FoodReofferCommandSchema,FoodRecoveryReceiptSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {FoodIncidentReportCommandSchema,FoodIncidentAckCommandSchema,FoodIncidentResumeCommandSchema,FoodIncidentInspectCommandSchema,FoodIncidentReceiptSchema,FoodIncidentPageSchema,FoodIncidentInspectionSchema,FoodIncidentResumeReceiptSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {FoodIncidentReviewSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {FoodCancellationReviewRequestCommandSchema,FoodCancellationReviewDispositionCommandSchema,FoodCancellationReviewInspectCommandSchema,FoodCancellationReviewReceiptSchema,FoodCancellationReviewOwnPageSchema,FoodCancellationReviewQueueSchema,FoodCancellationReviewSnapshotSchema,FoodCancellationReviewInspectionSchema} from '../../../packages/contracts/src/mobile-v1.generated';

const errors:Record<string,[number,ConsumerError['code']]>={AUTH_REQUIRED:[401,'AUTH_REQUIRED'],ROLE_REQUIRED:[403,'ROLE_REQUIRED'],INVALID_REQUEST:[422,'INVALID_REQUEST'],RESOURCE_NOT_FOUND:[404,'RESOURCE_NOT_FOUND'],IDEMPOTENCY_CONFLICT:[409,'IDEMPOTENCY_CONFLICT'],VERSION_CONFLICT:[409,'VERSION_CONFLICT'],DRIVER_SUSPENDED:[409,'DRIVER_SUSPENDED'],DRIVER_DOCUMENT_EXPIRED:[409,'DRIVER_DOCUMENT_EXPIRED'],DRIVER_VERIFICATION_REQUIRED:[409,'DRIVER_VERIFICATION_REQUIRED']};
errors.SETUP_REQUIRED=[409,'SETUP_REQUIRED'];
for(const code of ['DISPATCH_AUTH_RETRY','DISPATCH_NOT_READY','DISPATCH_TRANSITION_INVALID','DRIVER_UNAVAILABLE','OFFER_PENDING','OFFER_UNAVAILABLE','ASSIGNMENT_CHANGED','LOCATION_STALE','LOCATION_SEQUENCE_CONFLICT','LOCATION_IMPLAUSIBLE','PROOF_UNAVAILABLE','PROOF_ROTATION_REQUIRED','DRIVER_PICKUP_PROOF_REQUIRED'] as const)errors[code]=[409,code];
errors.LOCATION_INVALID=[422,'LOCATION_INVALID'];errors.LOCATION_RATE_LIMITED=[429,'LOCATION_RATE_LIMITED'];
errors.CUSTODY_RETAINED=[409,'CUSTODY_RETAINED'];
for(const code of ['INCIDENT','INCIDENT_ACK_REQUIRED','INCIDENT_NOT_PAUSED','INCIDENT_ALREADY_ACKNOWLEDGED'] as const)errors[code]=[409,code];
for(const code of ['CANCELLATION_REVIEW_OPEN','CANCELLATION_REVIEW_CLOSED'] as const)errors[code]=[409,code];
errors.DISPATCH_READ_COMMITTED_REQUIRED=[503,'CONFIGURATION_REQUIRED'];
export function driverPlatformError(error:unknown):never{const known=error instanceof Error?errors[error.message]:undefined;if(known)throw new RequestError(known[0],known[1]);throw error;}
function boundedDispatchNumbers(data:Record<string,unknown>){for(const key of ['generation','leaseGeneration','sequence','expectedVersion','expectedReviewVersion','expectedShipmentVersion']){const value=data[key];if(typeof value==='string'&&BigInt(value)>9223372036854775807n)fail('INVALID_REQUEST',422);}}
export async function withMobileDispatch<T>(actor:MobilePrincipal,run:(db:pg.PoolClient)=>Promise<T>):Promise<T>{
 const db=await pool.connect();
 try{await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true)",[actor.accountId,actor.sessionId]);const result=await run(db);await db.query('COMMIT');return result;}
 catch(error){await db.query('ROLLBACK');driverPlatformError(error);}
 finally{db.release();}
}
// One allowlisted mobile namespace; global identity never expands merchant routes.
export async function driverPlatformRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const path=url.pathname,detail=/^\/api\/mobile\/v1\/platform\/drivers\/([^/]+)(\/decision)?$/.exec(path);
 const delivery=/^\/api\/mobile\/v1\/platform\/merchants\/([^/]+)\/branches\/([^/]+)\/delivery-policy$/.exec(path);
 const foodOffer=/^\/api\/mobile\/v1\/platform\/food\/shipments\/([^/]+)\/offers$/.exec(path),foodClaim=/^\/api\/mobile\/v1\/driver\/food\/offers\/([^/]+)\/(claim|decline)$/.exec(path);
 const foodWork=path==='/api/mobile/v1/driver/food/work',foodAssignment=/^\/api\/mobile\/v1\/driver\/food\/assignments\/([^/]+)\/(arrive|location|consume-proof)$/.exec(path);
 const foodTracking=/^\/api\/mobile\/v1\/food\/shipments\/([^/]+)\/tracking$/.exec(path),foodDeliveryProof=/^\/api\/mobile\/v1\/food\/assignments\/([^/]+)\/delivery-proof$/.exec(path);
 const foodCustomerWork=/^\/api\/mobile\/v1\/food\/orders\/([^/]+)\/delivery$/.exec(path);
 const foodRecovery=/^\/api\/mobile\/v1\/(driver|platform)\/food\/assignments\/([^/]+)\/(withdraw|reoffer)$/.exec(path);
 const foodIncidentOwn=/^\/api\/mobile\/v1\/driver\/food\/assignments\/([^/]+)\/incidents$/.exec(path);
 const foodIncidentQueue=/^\/api\/mobile\/v1\/platform\/merchants\/([^/]+)\/food\/incidents$/.exec(path);
 const foodIncidentStaff=/^\/api\/mobile\/v1\/platform\/food\/incidents\/([^/]+)\/(acknowledge|inspect|review)$/.exec(path);
 const foodIncidentResume=/^\/api\/mobile\/v1\/platform\/food\/assignments\/([^/]+)\/resume$/.exec(path);
 const incidentRoute=foodIncidentOwn||foodIncidentQueue||foodIncidentStaff||foodIncidentResume;
 const cancellationOwn=/^\/api\/mobile\/v1\/orders\/([^/]+)\/cancellation-reviews$/.exec(path);
 const cancellationQueue=/^\/api\/mobile\/v1\/platform\/merchants\/([^/]+)\/food\/cancellation-reviews$/.exec(path);
 const cancellationStaff=/^\/api\/mobile\/v1\/platform\/food\/cancellation-reviews\/([^/]+)\/(review|inspect|disposition)$/.exec(path);
 const cancellationRoute=cancellationOwn||cancellationQueue||cancellationStaff;
 if(!['/api/mobile/v1/driver/profile','/api/mobile/v1/driver/availability','/api/mobile/v1/platform/roles','/api/mobile/v1/platform/drivers'].includes(path)&&!detail&&!delivery&&!foodOffer&&!foodClaim&&!foodWork&&!foodAssignment&&!foodTracking&&!foodDeliveryProof&&!foodCustomerWork&&!foodRecovery&&!incidentRoute&&!cancellationRoute)return undefined;
 const actor=await mobilePrincipal(bearer);
 const keys=[...url.searchParams.keys()];
 if(cancellationRoute){if(keys.length)fail('INVALID_REQUEST',422);}
 else if(incidentRoute){if(keys.length>1||keys.some(k=>k!=='afterId')||keys.length&&(method!=='GET'||!foodIncidentOwn&&!foodIncidentQueue))fail('INVALID_REQUEST',422);}
 else if(keys.some(k=>k!=='cursor')||keys.length>1||keys.length&&path!=='/api/mobile/v1/platform/drivers')fail('INVALID_REQUEST',422);
 return withMobileDispatch(actor,async db=>{
  if(cancellationRoute){
   await db.query("SET LOCAL statement_timeout='2000ms';SET LOCAL lock_timeout='200ms'");
   await db.query("SELECT set_config('bitpos.mobile_access_hash',$1,true)",[hash(bearer!.slice(7))]);
   const id=z.string().uuid().parse(cancellationRoute[1]);
   if(cancellationOwn&&method==='GET')return FoodCancellationReviewOwnPageSchema.parse((await db.query('SELECT bitpos.dispatch_customer_cancellation_reviews($1) value',[id])).rows[0].value);
   if(cancellationOwn&&method==='POST'){
    const data=FoodCancellationReviewRequestCommandSchema.parse(input);boundedDispatchNumbers(data);
    return FoodCancellationReviewReceiptSchema.parse((await db.query('SELECT bitpos.dispatch_customer_cancellation_review_request($1,$2::jsonb) value',[id,JSON.stringify(data)])).rows[0].value);
   }
   if(cancellationQueue&&method==='GET')return FoodCancellationReviewQueueSchema.parse((await db.query('SELECT bitpos.dispatch_food_cancellation_review_queue($1) value',[id])).rows[0].value);
   if(cancellationStaff&&cancellationStaff[2]==='review'&&method==='GET')return FoodCancellationReviewSnapshotSchema.parse((await db.query('SELECT bitpos.dispatch_food_cancellation_review_snapshot($1) value',[id])).rows[0].value);
   if(cancellationStaff&&cancellationStaff[2]==='inspect'&&method==='POST'){
    const data=FoodCancellationReviewInspectCommandSchema.parse(input);
    return FoodCancellationReviewInspectionSchema.parse((await db.query('SELECT bitpos.dispatch_food_cancellation_review_inspect($1,$2::jsonb) value',[id,JSON.stringify(data)])).rows[0].value);
   }
   if(cancellationStaff&&cancellationStaff[2]==='disposition'&&method==='POST'){
    const data=FoodCancellationReviewDispositionCommandSchema.parse(input);boundedDispatchNumbers(data);
    return FoodCancellationReviewReceiptSchema.parse((await db.query('SELECT bitpos.dispatch_food_cancellation_review_disposition($1,$2::jsonb) value',[id,JSON.stringify(data)])).rows[0].value);
   }
   fail('RESOURCE_NOT_FOUND',404);
  }
  if(incidentRoute){
   await db.query("SET LOCAL statement_timeout='2000ms';SET LOCAL lock_timeout='200ms'");
   await db.query("SELECT set_config('bitpos.mobile_access_hash',$1,true)",[hash(bearer!.slice(7))]);
   const id=z.string().uuid().parse(incidentRoute[1]);
   if((foodIncidentOwn||foodIncidentQueue)&&method==='GET'){
    const after=url.searchParams.has('afterId')?z.string().uuid().parse(url.searchParams.get('afterId')):null;
    const sql=foodIncidentOwn?'SELECT bitpos.dispatch_food_incidents($1,$2) value':'SELECT bitpos.dispatch_food_incident_queue($1,$2) value';
    return FoodIncidentPageSchema.parse((await db.query(sql,[id,after])).rows[0].value);
   }
   if(foodIncidentOwn&&method==='POST'){
    const data=FoodIncidentReportCommandSchema.parse(input);boundedDispatchNumbers(data);
    return FoodIncidentReceiptSchema.parse((await db.query('SELECT bitpos.dispatch_food_report_incident($1,$2::jsonb) value',[id,JSON.stringify(data)])).rows[0].value);
   }
   if(foodIncidentStaff&&foodIncidentStaff[2]==='review'){
    if(method!=='GET')fail('RESOURCE_NOT_FOUND',404);
    return FoodIncidentReviewSchema.parse((await db.query('SELECT bitpos.dispatch_food_incident_review($1) value',[id])).rows[0].value);
   }
   if(foodIncidentStaff&&method==='POST'){
    if(foodIncidentStaff[2]==='inspect'){
     const data=FoodIncidentInspectCommandSchema.parse(input);
     return FoodIncidentInspectionSchema.parse((await db.query('SELECT bitpos.dispatch_food_incident_inspect($1,$2) value',[id,data.purpose])).rows[0].value);
    }
    const data=FoodIncidentAckCommandSchema.parse(input);boundedDispatchNumbers(data);
    return FoodIncidentReceiptSchema.parse((await db.query('SELECT bitpos.dispatch_food_ack_incident($1,$2::jsonb) value',[id,JSON.stringify(data)])).rows[0].value);
   }
   if(foodIncidentResume&&method==='POST'){
    const data=FoodIncidentResumeCommandSchema.parse(input);boundedDispatchNumbers(data);
    return FoodIncidentResumeReceiptSchema.parse((await db.query('SELECT bitpos.dispatch_food_resume_incidents($1,$2::jsonb) value',[id,JSON.stringify(data)])).rows[0].value);
   }
   fail('RESOURCE_NOT_FOUND',404);
  }
  if(foodRecovery&&method==='POST'){
   await db.query("SET LOCAL statement_timeout='2000ms';SET LOCAL lock_timeout='200ms'");
   await db.query("SELECT set_config('bitpos.mobile_access_hash',$1,true)",[hash(bearer!.slice(7))]);
   if(foodRecovery[1]==='driver'&&foodRecovery[3]!=='withdraw')fail('RESOURCE_NOT_FOUND',404);
   const id=z.string().uuid().parse(foodRecovery[2]),data=foodRecovery[3]==='reoffer'?FoodReofferCommandSchema.parse(input):FoodWithdrawCommandSchema.parse(input);boundedDispatchNumbers(data);
   const sql=foodRecovery[1]==='driver'?'SELECT bitpos.dispatch_food_withdraw($1,$2::jsonb) AS value':'SELECT bitpos.dispatch_food_staff_recovery($1,$2::jsonb) AS value';
   return FoodRecoveryReceiptSchema.parse((await db.query(sql,[id,JSON.stringify(data)])).rows[0].value);
  }
  if(foodCustomerWork&&method==='GET'){
   await db.query("SET LOCAL statement_timeout='2000ms';SET LOCAL lock_timeout='200ms'");
   await db.query("SELECT set_config('bitpos.mobile_access_hash',$1,true)",[hash(bearer!.slice(7))]);
   return FoodCustomerWorkSchema.parse((await db.query('SELECT bitpos.dispatch_customer_work($1) AS value',[z.string().uuid().parse(foodCustomerWork[1])])).rows[0].value);
  }
  if(foodWork&&method==='GET')return FoodDriverWorkSchema.parse((await db.query('SELECT bitpos.dispatch_driver_work() AS value')).rows[0].value);
  if(foodOffer&&method==='POST'){const id=z.string().uuid().parse(foodOffer[1]),{driverId,...data}=FoodOfferCommandSchema.parse(input);boundedDispatchNumbers(data);return FoodOfferReceiptSchema.parse((await db.query('SELECT bitpos.dispatch_food_offer($1,$2,$3::jsonb) AS value',[id,driverId,JSON.stringify(data)])).rows[0].value);}
  if(foodClaim?.[2]==='decline'&&method==='POST'){const id=z.string().uuid().parse(foodClaim[1]),data=FoodDeclineCommandSchema.parse(input);boundedDispatchNumbers(data);return FoodDeclineReceiptSchema.parse((await db.query('SELECT bitpos.dispatch_food_decline($1,$2::jsonb) AS value',[id,JSON.stringify(data)])).rows[0].value);}
  if(foodClaim&&method==='POST'){const id=z.string().uuid().parse(foodClaim[1]),data=FoodClaimCommandSchema.parse(input);boundedDispatchNumbers(data);return FoodClaimReceiptSchema.parse((await db.query('SELECT bitpos.dispatch_food_claim($1,$2::jsonb) AS value',[id,JSON.stringify(data)])).rows[0].value);}
  if(foodAssignment&&method==='POST'){
   const id=z.string().uuid().parse(foodAssignment[1]);
   if(foodAssignment[2]==='arrive'){const data=FoodArrivalCommandSchema.parse(input);boundedDispatchNumbers(data);return FoodArrivalReceiptSchema.parse((await db.query('SELECT bitpos.dispatch_food_arrive($1,$2::jsonb) AS value',[id,JSON.stringify(data)])).rows[0].value);}
   if(foodAssignment[2]==='location'){const data=FoodLocationCommandSchema.parse(input);boundedDispatchNumbers(data);return FoodLocationReceiptSchema.parse((await db.query('SELECT bitpos.dispatch_food_location($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS value',[id,data.generation,data.leaseGeneration,data.sequence,data.capturedAt,data.latitudeE7,data.longitudeE7,data.accuracyMm,data.headingMdeg,data.speedMmS])).rows[0].value);}
   const data=FoodProofConsumeCommandSchema.parse(input);boundedDispatchNumbers(data);
   const value=(await db.query('SELECT bitpos.dispatch_consume_proof($1,$2,$3,$4,$5,$6) AS value',[id,data.proofId,data.generation,data.leaseGeneration,data.idempotencyKey,hash(data.secret)])).rows[0].value;
   return value.accepted===true?FoodProofConfirmedSchema.parse(value):FoodProofRefusedSchema.parse(value);
  }
  if(foodTracking&&method==='GET'){const value=(await db.query('SELECT bitpos.dispatch_food_tracking($1) AS value',[z.string().uuid().parse(foodTracking[1])])).rows[0].value;return FoodTrackingSnapshotSchema.parse({assignment:value.assignmentId===null?null:value});}
  if(foodDeliveryProof&&method==='POST'){
   const id=z.string().uuid().parse(foodDeliveryProof[1]),data=FoodProofIssueCommandSchema.parse(input);boundedDispatchNumbers(data);const secret=randomBytes(32).toString('base64url');
   const value=(await db.query("SELECT bitpos.dispatch_issue_proof($1,'DELIVERY',$2,$3,$4,$5,$6) AS value",[id,data.generation,data.leaseGeneration,data.idempotencyKey,hash(secret),data.rotate])).rows[0].value;
   return FoodProofIssueReceiptSchema.parse({...value,secret:value.replayed?null:secret});
  }
  if(delivery){
   const merchant=z.string().uuid().parse(delivery[1]),branch=z.string().uuid().parse(delivery[2]);
   if(method==='GET')return DeliveryPolicyResultSchema.parse((await db.query('SELECT bitpos.delivery_policy_read($1,$2) AS value',[merchant,branch])).rows[0].value);
   if(method==='PUT'){
    const data=DeliveryPolicyCommandSchema.parse(input);
    return DeliveryPolicyReceiptSchema.parse((await db.query('SELECT bitpos.delivery_policy_publish($1,$2,$3::jsonb) AS value',[merchant,branch,JSON.stringify(data)])).rows[0].value);
   }
   fail('RESOURCE_NOT_FOUND',404);
  }
  if(path==='/api/mobile/v1/driver/profile'){
   if(method==='GET')return DriverProfileResultSchema.parse((await db.query('SELECT bitpos.driver_identity_snapshot() AS value')).rows[0].value);
   if(method==='PUT'){const data=DriverApplicationCommandSchema.parse(input);if([data.application.displayName,data.application.plate,data.application.brand,data.application.color].some(value=>!value.trim()))fail('INVALID_REQUEST',422);return DriverCommandReceiptSchema.parse((await db.query("SELECT bitpos.driver_identity_command('apply',NULL,$1::jsonb) AS value",[JSON.stringify(data)])).rows[0].value);}
  }
  if(path==='/api/mobile/v1/driver/availability'&&method==='PUT'){
   const data=DriverAvailabilityCommandSchema.parse(input);return DriverCommandReceiptSchema.parse((await db.query("SELECT bitpos.driver_identity_command('availability',NULL,$1::jsonb) AS value",[JSON.stringify(data)])).rows[0].value);
  }
  if(path==='/api/mobile/v1/platform/roles'&&method==='GET')return PlatformRolesSchema.parse({roles:(await db.query('SELECT bitpos.driver_staff_roles() AS value')).rows[0].value});
  if(path==='/api/mobile/v1/platform/drivers'&&method==='GET'){
   const cursor=url.searchParams.has('cursor')?z.string().uuid().parse(url.searchParams.get('cursor')):null;
   const value=(await db.query('SELECT bitpos.driver_verification_queue($1) AS value',[cursor])).rows[0].value;
   const rows=z.array(DriverQueueItemSchema).max(21).parse(value.drivers);return DriverQueueSchema.parse({drivers:rows.slice(0,20),nextCursor:rows.length>20?rows[19].id:null});
  }
  if(detail){
   const id=z.string().uuid().parse(detail[1]);
   if(!detail[2]&&method==='GET'){
    const result=DriverProfileResultSchema.parse((await db.query('SELECT bitpos.driver_identity_snapshot($1) AS value',[id])).rows[0].value);if(!result.driver)fail('RESOURCE_NOT_FOUND',404);return result;
   }
   if(detail[2]&&method==='POST'){
    const data=DriverDecisionCommandSchema.parse(input),{decision,verifiedUntil,verificationReference,...common}=data;
    if(decision==='APPROVE'?verifiedUntil===null||verificationReference===null:verifiedUntil!==null||verificationReference!==null)fail('INVALID_REQUEST',422);
    const payload=decision==='APPROVE'?{...common,verifiedUntil,verificationReference}:common;
    return DriverCommandReceiptSchema.parse((await db.query('SELECT bitpos.driver_identity_command($1,$2,$3::jsonb) AS value',[decision.toLowerCase(),id,JSON.stringify(payload)])).rows[0].value);
   }
  }
  fail('RESOURCE_NOT_FOUND',404);
 });
}
