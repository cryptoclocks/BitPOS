import {z} from 'zod';
import {FoodIncidentSession} from './food-incident-session';
import {PlatformError} from './platform-session';
import {FoodCompensationExecutionSchema,FoodCompensationRetireCommandSchema,FoodCompensationRetireReceiptSchema,FoodCompensationPublishCommandSchema,FoodCompensationPublishReceiptSchema,FoodCompensationCommandSchema,FoodCompensationReceiptSchema,FoodCompensationSnapshotSchema,FoodRefundReconcileCommandSchema,FoodRefundReconcileReceiptSchema,FoodReturnExecutionSchema,FoodReturnRequestCommandSchema,FoodReturnResolveCommandSchema,FoodReturnSnapshotSchema,FoodReturnStageReceiptSchema,FoodReturnResolutionReceiptSchema,FoodReturnFinancialCommandSchema,FoodReturnFinancialReceiptSchema,FoodReturnFinancialSnapshotSchema} from '../../../../packages/contracts/src/mobile-v1.generated';
const uuid=z.string().uuid();
const pendingSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('REQUEST'),assignmentId:uuid,command:FoodReturnRequestCommandSchema}).strict(),
 z.object({kind:z.literal('RESOLVE'),caseId:uuid,assignmentId:uuid,command:FoodReturnResolveCommandSchema}).strict(),
]);
const retirementPendingSchema=z.object({caseId:uuid,command:FoodCompensationRetireCommandSchema}).strict();
export type PendingCompensationRetirement=z.infer<typeof retirementPendingSchema>;
const publicationPendingSchema=z.object({caseId:uuid,command:FoodCompensationPublishCommandSchema}).strict();
export type PendingCompensationPublication=z.infer<typeof publicationPendingSchema>;
const compensationPendingSchema=z.object({caseId:uuid,command:FoodCompensationCommandSchema}).strict();
export type PendingFoodCompensation=z.infer<typeof compensationPendingSchema>;
const reconcilePendingSchema=z.object({caseId:uuid,command:FoodRefundReconcileCommandSchema}).strict();
export type PendingRefundReconciliation=z.infer<typeof reconcilePendingSchema>;
const financialPendingSchema=z.object({caseId:uuid,command:FoodReturnFinancialCommandSchema}).strict();
export type PendingFoodReturnFinancial=z.infer<typeof financialPendingSchema>;
export type PendingFoodReturn=z.infer<typeof pendingSchema>;
// Commands survive a lost response and reload. Tokens remain memory-only.
export class FoodReturnSession extends FoodIncidentSession{
 async returnSnapshot(assignmentId:string){
  const id=uuid.parse(assignmentId),result=FoodReturnSnapshotSchema.parse(await this.request('platform/food/assignments/'+id+'/return'));
  if(result.assignmentId!==id)throw new PlatformError('INVALID_RECEIPT',502);
  return result;
 }
 pendingReturn():PendingFoodReturn|null{
  if(!this.accountId)throw new PlatformError('AUTH_REQUIRED',401);
  const raw=localStorage.getItem('bitpos.platform.foodReturn.'+this.accountId);
  return raw?pendingSchema.parse(JSON.parse(raw)):null;
 }
 async executionSnapshot(caseId:string){const id=uuid.parse(caseId),result=FoodReturnExecutionSchema.parse(await this.request('platform/food/returns/'+id+'/execution'));if(result.caseId!==id||result.allPaymentsRefunded!==(result.state==='FINALIZED'))throw new PlatformError('INVALID_RECEIPT',502);return result;}
 async financialSnapshot(caseId:string){
  const id=uuid.parse(caseId),value=FoodReturnFinancialSnapshotSchema.parse(await this.request('platform/food/returns/'+id+'/financial-review'));
  if(value.caseId!==id||value.decision&&value.decision.caseId!==id)throw new PlatformError('INVALID_RECEIPT',502);return value;
 }
 pendingFinancial():PendingFoodReturnFinancial|null{
  if(!this.accountId)throw new PlatformError('AUTH_REQUIRED',401);
  const raw=localStorage.getItem('bitpos.platform.foodReturnFinancial.'+this.accountId);return raw?financialPendingSchema.parse(JSON.parse(raw)):null;
 }
 async compensationExecution(caseId:string){const id=uuid.parse(caseId),value=FoodCompensationExecutionSchema.parse(await this.request('platform/food/returns/'+id+'/compensation-execution'));if(value.caseId!==id||value.fundsTransferred!==(value.state==='FINALIZED'))throw new PlatformError('INVALID_RECEIPT',502);return value;}
 async compensationSnapshot(caseId:string){const id=uuid.parse(caseId),value=FoodCompensationSnapshotSchema.parse(await this.request('platform/food/returns/'+id+'/compensation'));if(value.caseId!==id||value.decision&&value.decision.caseId!==id)throw new PlatformError('INVALID_RECEIPT',502);return value;}
 pendingCompensationPublication():PendingCompensationPublication|null{
  if(!this.accountId)throw new PlatformError('AUTH_REQUIRED',401);const raw=localStorage.getItem('bitpos.platform.compensationPublication.'+this.accountId);return raw?publicationPendingSchema.parse(JSON.parse(raw)):null;
 }
 async publishCompensation(input:PendingCompensationPublication){
  const account=this.accountId;if(!account)throw new PlatformError('AUTH_REQUIRED',401);
  const owner=this.sessionOwner(),saved=publicationPendingSchema.parse(input),encoded=JSON.stringify(saved),key='bitpos.platform.compensationPublication.'+account;
  if(typeof navigator==='undefined'||!navigator.locks)throw new PlatformError('CONFIGURATION_REQUIRED',503);
  await navigator.locks.request(key,()=>{this.requireSessionOwner(owner);const raw=localStorage.getItem(key);if(raw&&JSON.stringify(publicationPendingSchema.parse(JSON.parse(raw)))!==encoded)throw new PlatformError('PENDING_COMMAND',409);localStorage.setItem(key,encoded);});
  const retire=()=>navigator.locks.request(key,()=>{if(localStorage.getItem(key)===encoded)localStorage.removeItem(key);});this.requireSessionOwner(owner);let raw:unknown;
  try{raw=await this.request('platform/food/returns/'+saved.caseId+'/compensation-policy',saved.command);}
  catch(error){if(error instanceof PlatformError&&['QUOTE_CHANGED','INVALID_REQUEST','VERSION_CONFLICT'].includes(error.code))await retire();throw error;}
  const value=FoodCompensationPublishReceiptSchema.parse(raw);if(value.caseId!==saved.caseId||value.maxMinor!==saved.command.maxMinor||value.returnedRateBps!==saved.command.returnedRateBps||value.enabled!==saved.command.enabled)throw new PlatformError('INVALID_RECEIPT',502);await retire();return value;
 }
 pendingCompensationRetirement():PendingCompensationRetirement|null{
  if(!this.accountId)throw new PlatformError('AUTH_REQUIRED',401);const raw=localStorage.getItem('bitpos.platform.compensationRetirement.'+this.accountId);return raw?retirementPendingSchema.parse(JSON.parse(raw)):null;
 }
 async retireCompensation(input:PendingCompensationRetirement){
  const account=this.accountId;if(!account)throw new PlatformError('AUTH_REQUIRED',401);
  const owner=this.sessionOwner(),saved=retirementPendingSchema.parse(input),encoded=JSON.stringify(saved),key='bitpos.platform.compensationRetirement.'+account;
  if(typeof navigator==='undefined'||!navigator.locks)throw new PlatformError('CONFIGURATION_REQUIRED',503);
  await navigator.locks.request(key,()=>{this.requireSessionOwner(owner);const raw=localStorage.getItem(key);if(raw&&JSON.stringify(retirementPendingSchema.parse(JSON.parse(raw)))!==encoded)throw new PlatformError('PENDING_COMMAND',409);localStorage.setItem(key,encoded);});
  const retire=()=>navigator.locks.request(key,()=>{if(localStorage.getItem(key)===encoded)localStorage.removeItem(key);});this.requireSessionOwner(owner);let raw:unknown;
  try{raw=await this.request('platform/food/returns/'+saved.caseId+'/compensation-policy-retire',saved.command);}
  catch(error){if(error instanceof PlatformError&&['QUOTE_CHANGED','INVALID_REQUEST','VERSION_CONFLICT'].includes(error.code))await retire();throw error;}
  const value=FoodCompensationRetireReceiptSchema.parse(raw);if(value.caseId!==saved.caseId||value.policyId!==saved.command.policyId)throw new PlatformError('INVALID_RECEIPT',502);await retire();return value;
 }
 pendingCompensation():PendingFoodCompensation|null{
  if(!this.accountId)throw new PlatformError('AUTH_REQUIRED',401);const raw=localStorage.getItem('bitpos.platform.foodCompensation.'+this.accountId);return raw?compensationPendingSchema.parse(JSON.parse(raw)):null;
 }
 async approveCompensation(input:PendingFoodCompensation){
  const account=this.accountId;if(!account)throw new PlatformError('AUTH_REQUIRED',401);
  const owner=this.sessionOwner(),saved=compensationPendingSchema.parse(input),encoded=JSON.stringify(saved),key='bitpos.platform.foodCompensation.'+account;
  if(typeof navigator==='undefined'||!navigator.locks)throw new PlatformError('CONFIGURATION_REQUIRED',503);
  await navigator.locks.request(key,()=>{this.requireSessionOwner(owner);const raw=localStorage.getItem(key);if(raw&&JSON.stringify(compensationPendingSchema.parse(JSON.parse(raw)))!==encoded)throw new PlatformError('PENDING_COMMAND',409);localStorage.setItem(key,encoded);});
  const retire=()=>navigator.locks.request(key,()=>{if(localStorage.getItem(key)===encoded)localStorage.removeItem(key);});this.requireSessionOwner(owner);let raw:unknown;
  try{raw=await this.request('platform/food/returns/'+saved.caseId+'/compensation',saved.command);}
  catch(error){if(error instanceof PlatformError&&['QUOTE_CHANGED','INVALID_REQUEST','VERSION_CONFLICT'].includes(error.code))await retire();throw error;}
  const value=FoodCompensationReceiptSchema.parse(raw);if(value.caseId!==saved.caseId||value.policyId!==saved.command.policyId||BigInt(value.amountMinor)>9223372036854775807n)throw new PlatformError('INVALID_RECEIPT',502);await retire();return value;
 }
 pendingReconciliation():PendingRefundReconciliation|null{
  if(!this.accountId)throw new PlatformError('AUTH_REQUIRED',401);const raw=localStorage.getItem('bitpos.platform.refundReconcile.'+this.accountId);return raw?reconcilePendingSchema.parse(JSON.parse(raw)):null;
 }
 async reconcilePayments(input:PendingRefundReconciliation){
  const account=this.accountId;if(!account)throw new PlatformError('AUTH_REQUIRED',401);
  const owner=this.sessionOwner(),saved=reconcilePendingSchema.parse(input),encoded=JSON.stringify(saved),key='bitpos.platform.refundReconcile.'+account;
  if(typeof navigator==='undefined'||!navigator.locks)throw new PlatformError('CONFIGURATION_REQUIRED',503);
  await navigator.locks.request(key,()=>{this.requireSessionOwner(owner);const raw=localStorage.getItem(key);if(raw&&JSON.stringify(reconcilePendingSchema.parse(JSON.parse(raw)))!==encoded)throw new PlatformError('PENDING_COMMAND',409);localStorage.setItem(key,encoded);});
  const retire=()=>navigator.locks.request(key,()=>{if(localStorage.getItem(key)===encoded)localStorage.removeItem(key);});this.requireSessionOwner(owner);let raw:unknown;
  try{raw=await this.request('platform/food/returns/'+saved.caseId+'/reconcile-payments',saved.command);}
  catch(error){if(error instanceof PlatformError&&['QUOTE_CHANGED','INVALID_REQUEST','VERSION_CONFLICT'].includes(error.code))await retire();throw error;}
  const value=FoodRefundReconcileReceiptSchema.parse(raw);if(value.caseId!==saved.caseId)throw new PlatformError('INVALID_RECEIPT',502);await retire();return value;
 }
 async decideFinancial(input:PendingFoodReturnFinancial){
  const account=this.accountId;if(!account)throw new PlatformError('AUTH_REQUIRED',401);
  const owner=this.sessionOwner(),saved=financialPendingSchema.parse(input),encoded=JSON.stringify(saved),key='bitpos.platform.foodReturnFinancial.'+account;
  if(typeof navigator==='undefined'||!navigator.locks)throw new PlatformError('CONFIGURATION_REQUIRED',503);
  await navigator.locks.request(key,()=>{this.requireSessionOwner(owner);const raw=localStorage.getItem(key);if(raw&&JSON.stringify(financialPendingSchema.parse(JSON.parse(raw)))!==encoded)throw new PlatformError('PENDING_COMMAND',409);localStorage.setItem(key,encoded);});
  const retire=()=>navigator.locks.request(key,()=>{if(localStorage.getItem(key)===encoded)localStorage.removeItem(key);});
  this.requireSessionOwner(owner);let raw:unknown;
  try{raw=await this.request('platform/food/returns/'+saved.caseId+'/financial-review',saved.command);}
  catch(error){if(error instanceof PlatformError&&['QUOTE_CHANGED','INVALID_REQUEST','VERSION_CONFLICT'].includes(error.code))await retire();throw error;}
  const value=FoodReturnFinancialReceiptSchema.parse(raw);
  if(value.caseId!==saved.caseId||value.decision!==saved.command.decision||value.executionState!==(value.decision==='NO_REFUND'?'NOT_REQUESTED':'PENDING')||value.decision==='LINE_REFUND'&&(saved.command.decision!=='LINE_REFUND'||value.selection.lineId!==saved.command.lineId))throw new PlatformError('INVALID_RECEIPT',502);
  await retire();return value;
 }
 async submitReturn(input:PendingFoodReturn){
  const account=this.accountId;if(!account)throw new PlatformError('AUTH_REQUIRED',401);
  const owner=this.sessionOwner(),saved=pendingSchema.parse(input),encoded=JSON.stringify(saved),key='bitpos.platform.foodReturn.'+account;
  if(typeof navigator==='undefined'||!navigator.locks)throw new PlatformError('CONFIGURATION_REQUIRED',503);
  const locked=<T>(action:()=>T)=>navigator.locks.request(key,action);
  await locked(()=>{this.requireSessionOwner(owner);const raw=localStorage.getItem(key);if(raw&&JSON.stringify(pendingSchema.parse(JSON.parse(raw)))!==encoded)throw new PlatformError('PENDING_COMMAND',409);localStorage.setItem(key,encoded);});
  const retire=()=>locked(()=>{if(localStorage.getItem(key)===encoded)localStorage.removeItem(key);});
  this.requireSessionOwner(owner);
  // Ambiguous network errors, invalid receipts and auth revocation retain evidence.
  let raw:unknown;
  try{raw=await this.request(saved.kind==='REQUEST'?'platform/food/assignments/'+saved.assignmentId+'/return':'platform/food/returns/'+saved.caseId+'/resolve',saved.command);}
  catch(error){
   // SQL rejects these before committing a command; exact committed replay wins
   // before version checks. Keep transport/auth/idempotency ambiguity intact.
   if(error instanceof PlatformError&&['QUOTE_CHANGED','INVALID_REQUEST','INCIDENT_ACK_REQUIRED','VERSION_CONFLICT','ASSIGNMENT_CHANGED'].includes(error.code))await retire();
   throw error;
  }
  if(saved.kind==='REQUEST'){
   const receipt=FoodReturnStageReceiptSchema.parse(raw);
   if(receipt.assignmentId!==saved.assignmentId||receipt.state!=='RETURN_REQUESTED')throw new PlatformError('INVALID_RECEIPT',502);
   await retire();return {kind:'REQUEST' as const,receipt};
  }
  const receipt=FoodReturnResolutionReceiptSchema.parse(raw);
  if(receipt.assignmentId!==saved.assignmentId||receipt.caseId!==saved.caseId)throw new PlatformError('INVALID_RECEIPT',502);
  await retire();return {kind:'RESOLVE' as const,receipt};
 }
}
