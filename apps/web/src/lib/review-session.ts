import {PlatformSession,PlatformError}from'./platform-session';
import{MobileFoodReviewQueueSchema,MobileFoodReviewModerationSchema,MobileFoodReviewSchema}from'../../../../packages/contracts/src/mobile-v1.generated';
import type{MobileFoodReviewModeration}from'../../../../packages/contracts/src/mobile-v1.generated';
export interface PendingReviewModeration{reviewId:string;command:MobileFoodReviewModeration}
export class ReviewSession extends PlatformSession{
 private reviewKey(){if(!this.accountId)throw new PlatformError('AUTH_REQUIRED',401);return'bitpos.platform.review.'+this.accountId;}
 pendingReview():PendingReviewModeration|null{const raw=localStorage.getItem(this.reviewKey());if(!raw)return null;const saved=JSON.parse(raw);if(!saved||typeof saved.reviewId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved.reviewId)||Object.keys(saved).length!==2)throw new PlatformError('INVALID_SAVED_COMMAND',409);return{reviewId:saved.reviewId,command:MobileFoodReviewModerationSchema.parse(saved.command)};}
 async reviews(merchantId:string,purpose:string,cursor:string|null=null){const owner=this.sessionOwner(),query=new URLSearchParams({purpose,...(cursor?{cursor}:{})}),result=MobileFoodReviewQueueSchema.parse(await this.request('platform/merchants/'+encodeURIComponent(merchantId)+'/reviews?'+query));this.requireSessionOwner(owner);return result;}
 async moderate(reviewId:string,command:MobileFoodReviewModeration){
  const owner=this.sessionOwner(),key=this.reviewKey();if(typeof navigator==='undefined'||!navigator.locks)throw new PlatformError('BROWSER_LOCK_REQUIRED',409);
  return navigator.locks.request(key,async()=>{this.requireSessionOwner(owner);const value={reviewId,command:MobileFoodReviewModerationSchema.parse(command)},encoded=JSON.stringify(value),saved=this.pendingReview();if(saved&&JSON.stringify(saved)!==encoded)throw new PlatformError('PENDING_COMMAND',409);localStorage.setItem(key,encoded);
   try{const result=MobileFoodReviewSchema.parse(await this.request('platform/reviews/'+encodeURIComponent(reviewId),value.command));this.requireSessionOwner(owner);if(result.id!==reviewId||result.state!==(command.decision==='PUBLISH'?'PUBLISHED':'REJECTED'))throw new PlatformError('INVALID_RECEIPT',409);localStorage.removeItem(key);return result;}
   catch(error){this.requireSessionOwner(owner);if(error instanceof PlatformError&&['VERSION_CONFLICT','INVALID_REQUEST'].includes(error.code))localStorage.removeItem(key);throw error;}
  });
 }
}
