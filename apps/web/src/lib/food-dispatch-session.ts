import {z} from 'zod';
import {PlatformSession,PlatformError} from './platform-session';
import {FoodBatchCandidatesSchema,FoodBatchDraftCommandSchema,FoodBatchDraftReceiptSchema} from '../../../../packages/contracts/src/food-batch-candidates';
import {FoodDispatchConsolePageSchema,FoodDispatchPolicySnapshotSchema,FoodDispatchPolicyCommandSchema,FoodDispatchPolicyReceiptSchema,FoodDispatchSearchCommandSchema,FoodDispatchSearchSchema,FoodOfferCommandSchema,FoodOfferReceiptSchema,FoodWithdrawCommandSchema,FoodReofferCommandSchema,FoodRecoveryReceiptSchema} from '../../../../packages/contracts/src/mobile-v1.generated';
const uuid=z.string().uuid(),pendingSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('POLICY'),merchantId:uuid,branchId:uuid,command:FoodDispatchPolicyCommandSchema}).strict(),
 z.object({kind:z.literal('BATCH_DRAFT'),merchantId:uuid,branchId:uuid,command:FoodBatchDraftCommandSchema}).strict(),
 z.object({kind:z.literal('SEARCH'),shipmentId:uuid,command:FoodDispatchSearchCommandSchema}).strict(),
 z.object({kind:z.literal('OFFER'),shipmentId:uuid,command:FoodOfferCommandSchema}).strict(),
 z.object({kind:z.literal('WITHDRAW'),shipmentId:uuid,assignmentId:uuid,command:FoodWithdrawCommandSchema}).strict(),
 z.object({kind:z.literal('REOFFER'),shipmentId:uuid,assignmentId:uuid,command:FoodReofferCommandSchema}).strict(),
]);
export type PendingFoodDispatch=z.infer<typeof pendingSchema>;
const savedBatchSchema=z.object({merchantId:uuid,branchId:uuid,receipt:FoodBatchDraftReceiptSchema}).strict();
export type SavedBatchDraft=z.infer<typeof savedBatchSchema>;
export class FoodDispatchSession extends PlatformSession{
 dispatchQueue=async(merchant:string,branch:string,after:string|null)=>FoodDispatchConsolePageSchema.parse(await this.request('platform/merchants/'+uuid.parse(merchant)+'/branches/'+uuid.parse(branch)+'/food-dispatch'+(after?'?afterId='+uuid.parse(after):'')));
 batchCandidates=async(merchant:string,branch:string,anchor:string)=>FoodBatchCandidatesSchema.parse(await this.request('platform/merchants/'+uuid.parse(merchant)+'/branches/'+uuid.parse(branch)+'/food-batch-candidates/'+uuid.parse(anchor)));
 policy=async(merchant:string,branch:string)=>FoodDispatchPolicySnapshotSchema.parse(await this.request('platform/merchants/'+uuid.parse(merchant)+'/branches/'+uuid.parse(branch)+'/food-dispatch-policy'));
 pendingDispatch():PendingFoodDispatch|null{if(!this.accountId)throw new PlatformError('AUTH_REQUIRED',401);const raw=localStorage.getItem('bitpos.platform.foodDispatch.'+this.accountId);return raw?pendingSchema.parse(JSON.parse(raw)):null;}
 lastBatchDraft():SavedBatchDraft|null{if(!this.accountId)throw new PlatformError('AUTH_REQUIRED',401);const raw=localStorage.getItem('bitpos.platform.foodBatchDraft.'+this.accountId);return raw?savedBatchSchema.parse(JSON.parse(raw)):null;}
 private async journal<T>(account:string,action:()=>T):Promise<T>{if(typeof navigator==='undefined'||!navigator.locks)throw new PlatformError('CONFIGURATION_REQUIRED',503);return navigator.locks.request('bitpos.platform.foodDispatch.'+account,action);}
 async submitDispatch(input:PendingFoodDispatch){
  const account=this.accountId;if(!account)throw new PlatformError('AUTH_REQUIRED',401);const owner=this.sessionOwner(),saved=pendingSchema.parse(input),encoded=JSON.stringify(saved),key='bitpos.platform.foodDispatch.'+account;
  await this.journal(account,()=>{this.requireSessionOwner(owner);const raw=localStorage.getItem(key);if(raw&&JSON.stringify(pendingSchema.parse(JSON.parse(raw)))!==encoded)throw new PlatformError('PENDING_COMMAND',409);localStorage.setItem(key,encoded);});
  const retire=()=>this.journal(account,()=>{if(localStorage.getItem(key)===encoded)localStorage.removeItem(key);});this.requireSessionOwner(owner);
  try{
   switch(saved.kind){
    case 'BATCH_DRAFT':{const receipt=FoodBatchDraftReceiptSchema.parse(await this.request('platform/merchants/'+saved.merchantId+'/branches/'+saved.branchId+'/food-batch-drafts',saved.command));if(JSON.stringify(receipt.items)!==JSON.stringify(saved.command.items))throw new PlatformError('INVALID_RECEIPT',502);await this.journal(account,()=>{this.requireSessionOwner(owner);if(localStorage.getItem(key)!==encoded)throw new PlatformError('PENDING_COMMAND',409);localStorage.setItem('bitpos.platform.foodBatchDraft.'+account,JSON.stringify({merchantId:saved.merchantId,branchId:saved.branchId,receipt}));localStorage.removeItem(key);});return {kind:saved.kind,receipt};}
    case 'POLICY':{const receipt=FoodDispatchPolicyReceiptSchema.parse(await this.request('platform/merchants/'+saved.merchantId+'/branches/'+saved.branchId+'/food-dispatch-policy',saved.command,'PUT'));if(BigInt(receipt.revision)!==BigInt(saved.command.expectedVersion)+1n)throw new PlatformError('INVALID_RECEIPT',502);await retire();return {kind:saved.kind,receipt};}
    case 'SEARCH':{const receipt=FoodDispatchSearchSchema.parse(await this.request('platform/food/shipments/'+saved.shipmentId+'/search',saved.command,'PUT'));if(receipt.shipmentId!==saved.shipmentId||BigInt(receipt.version)!==BigInt(saved.command.expectedVersion)+1n||receipt.mode!==(saved.command.action==='MANUAL'?'MANUAL':'AUTO'))throw new PlatformError('INVALID_RECEIPT',502);await retire();return {kind:saved.kind,receipt};}
    case 'OFFER':{const receipt=FoodOfferReceiptSchema.parse(await this.request('platform/food/shipments/'+saved.shipmentId+'/offers',saved.command));if(receipt.shipmentId!==saved.shipmentId||BigInt(receipt.version)!==BigInt(saved.command.expectedVersion)+1n)throw new PlatformError('INVALID_RECEIPT',502);await retire();return {kind:saved.kind,receipt};}
    case 'WITHDRAW':case 'REOFFER':{const receipt=FoodRecoveryReceiptSchema.parse(await this.request('platform/food/assignments/'+saved.assignmentId+'/'+(saved.kind==='WITHDRAW'?'withdraw':'reoffer'),saved.command)),increment=saved.kind==='WITHDRAW'?1n:2n;if(receipt.assignmentId!==saved.assignmentId||receipt.shipmentId!==saved.shipmentId||receipt.generation!==saved.command.generation||receipt.leaseGeneration!==saved.command.leaseGeneration||BigInt(receipt.shipmentVersion)!==BigInt(saved.command.expectedVersion)+increment||BigInt(receipt.shipmentGeneration)!==BigInt(saved.command.generation)+increment||(saved.kind==='WITHDRAW'?receipt.replacementOffer!==null:receipt.replacementOffer?.shipmentId!==saved.shipmentId||receipt.replacementOffer.version!==receipt.shipmentVersion||receipt.replacementOffer.generation!==receipt.shipmentGeneration))throw new PlatformError('INVALID_RECEIPT',502);await retire();return {kind:saved.kind,receipt};}
   }
  }catch(error){if(error instanceof PlatformError&&['INVALID_REQUEST','VERSION_CONFLICT','RESOURCE_NOT_FOUND','DISPATCH_NOT_READY','OFFER_PENDING','CUSTODY_RETAINED','ASSIGNMENT_CHANGED','DRIVER_SUSPENDED','DRIVER_DOCUMENT_EXPIRED','DRIVER_VERIFICATION_REQUIRED','FOOD_SERVICE_UNAVAILABLE','DRIVER_UNAVAILABLE','DISPATCH_TRANSITION_INVALID'].includes(error.code))await retire();throw error;}
 }
}
