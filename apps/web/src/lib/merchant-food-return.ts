import {z} from 'zod';
import {api,ApiError} from './api';
import type {Session} from './table';
import {FoodCustomerRefundExecutionSchema,FoodReturnReceiveCommandSchema,FoodReturnSnapshotSchema,FoodReturnStageReceiptSchema} from '../../../../packages/contracts/src/mobile-v1.generated';
const uuid=z.string().uuid();
const pendingSchema=z.object({assignmentId:uuid,caseId:uuid,command:FoodReturnReceiveCommandSchema}).strict();
export type PendingMerchantReturn=z.infer<typeof pendingSchema>;
export class MerchantFoodReturn{
 constructor(private session:Session,private orderId:string,private current:()=>boolean){}
 private get key(){return `bitpos.foodReturn.receive.${this.session.merchantId}.${this.session.userId}.${this.orderId}`;}
 pending():PendingMerchantReturn|null{const raw=localStorage.getItem(this.key);return raw?pendingSchema.parse(JSON.parse(raw)):null;}
 private requireOwner(){if(!this.current())throw new ApiError(409,'SESSION_CHANGED','Session changed',false);}
 async execution(){this.requireOwner();const result=FoodCustomerRefundExecutionSchema.parse(await api('/food/orders/'+uuid.parse(this.orderId)+'/refund-execution',undefined,this.session.token));this.requireOwner();if(result.orderId!==this.orderId)throw new ApiError(502,'INVALID_RECEIPT','Refund order mismatch',true);return result;}
 async snapshot(assignmentId:string){this.requireOwner();const id=uuid.parse(assignmentId),result=FoodReturnSnapshotSchema.parse(await api('/food/assignments/'+id+'/return',undefined,this.session.token));this.requireOwner();if(result.assignmentId!==id)throw new ApiError(502,'INVALID_RECEIPT','Return snapshot mismatch',true);return result;}
 async receive(input:PendingMerchantReturn){
  const saved=pendingSchema.parse(input),encoded=JSON.stringify(saved),key=this.key;
  if(typeof navigator==='undefined'||!navigator.locks)throw new ApiError(503,'CONFIGURATION_REQUIRED','Secure command storage unavailable',false);
  await navigator.locks.request(key,()=>{this.requireOwner();const raw=localStorage.getItem(key);if(raw&&JSON.stringify(pendingSchema.parse(JSON.parse(raw)))!==encoded)throw new ApiError(409,'PENDING_COMMAND','Recover the original command first',false);localStorage.setItem(key,encoded);});
  this.requireOwner();
  let raw:unknown;
  try{raw=await api('/food/returns/'+saved.caseId+'/receive',saved.command,this.session.token);}
  catch(error){
   if(error instanceof ApiError&&['QUOTE_CHANGED','INVALID_REQUEST'].includes(error.code))await navigator.locks.request(key,()=>{if(localStorage.getItem(key)===encoded)localStorage.removeItem(key);});
   throw error;
  }
  const receipt=FoodReturnStageReceiptSchema.parse(raw);
  this.requireOwner();if(receipt.assignmentId!==saved.assignmentId||receipt.caseId!==saved.caseId||receipt.state!=='RETURN_RECORDED')throw new ApiError(502,'INVALID_RECEIPT','Return receipt mismatch',true);
  await navigator.locks.request(key,()=>{if(localStorage.getItem(key)===encoded)localStorage.removeItem(key);});
  return receipt;
 }
}
