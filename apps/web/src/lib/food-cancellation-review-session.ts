import {z} from 'zod';
import {PlatformSession,PlatformError} from './platform-session';
import {FoodCancellationReviewQueueSchema,FoodCancellationReviewSnapshotSchema,FoodCancellationReviewInspectionSchema,FoodCancellationReviewDispositionCommandSchema,FoodCancellationReviewReceiptSchema} from '../../../../packages/contracts/src/mobile-v1.generated';
const uuid=z.string().uuid(),pendingSchema=z.object({reviewId:uuid,command:FoodCancellationReviewDispositionCommandSchema}).strict();
export type PendingFoodCancellationReview=z.infer<typeof pendingSchema>;
export class FoodCancellationReviewSession extends PlatformSession{
 reviewQueue=async(merchantId:string)=>FoodCancellationReviewQueueSchema.parse(await this.request('platform/merchants/'+uuid.parse(merchantId)+'/food/cancellation-reviews'));
 reviewSnapshot=async(reviewId:string)=>FoodCancellationReviewSnapshotSchema.parse(await this.request('platform/food/cancellation-reviews/'+uuid.parse(reviewId)+'/review'));
 inspectReview=async(reviewId:string,purpose:string)=>FoodCancellationReviewInspectionSchema.parse(await this.request('platform/food/cancellation-reviews/'+uuid.parse(reviewId)+'/inspect',{purpose}));
 pendingReview():PendingFoodCancellationReview|null{
  const account=this.accountId;if(!account)throw new PlatformError('AUTH_REQUIRED',401);
  const raw=localStorage.getItem('bitpos.platform.cancellationReview.'+account);return raw?pendingSchema.parse(JSON.parse(raw)):null;
 }
 private async journal<T>(account:string,action:()=>T):Promise<T>{
  if(typeof navigator==='undefined'||!navigator.locks)throw new PlatformError('CONFIGURATION_REQUIRED',503);
  return navigator.locks.request('bitpos.platform.cancellationReview.'+account,action);
 }
 async submitReview(input:PendingFoodCancellationReview){
  const account=this.accountId;if(!account)throw new PlatformError('AUTH_REQUIRED',401);
  const owner=this.sessionOwner(),saved=pendingSchema.parse(input),key='bitpos.platform.cancellationReview.'+account,encoded=JSON.stringify(saved);
  await this.journal(account,()=>{this.requireSessionOwner(owner);const raw=localStorage.getItem(key);if(raw&&JSON.stringify(pendingSchema.parse(JSON.parse(raw)))!==encoded)throw new PlatformError('PENDING_COMMAND',409);localStorage.setItem(key,encoded);});
  const retire=()=>this.journal(account,()=>{if(localStorage.getItem(key)===encoded)localStorage.removeItem(key);});
  this.requireSessionOwner(owner);
  try{
   const receipt=FoodCancellationReviewReceiptSchema.parse(await this.request('platform/food/cancellation-reviews/'+saved.reviewId+'/disposition',saved.command)),review=receipt.review;
   if(review.state!=='REVIEWED'||review.reviewId!==saved.reviewId||review.decision!==saved.command.decision||review.customerExplanation!==saved.command.customerExplanation||review.reviewedShipmentVersion!==saved.command.expectedShipmentVersion)throw new PlatformError('INVALID_RECEIPT',502);
   await retire();return receipt;
  }catch(error){
   if(error instanceof PlatformError&&['INVALID_REQUEST','VERSION_CONFLICT','RESOURCE_NOT_FOUND','CANCELLATION_REVIEW_CLOSED'].includes(error.code))await retire();
   throw error;
  }
 }
}
