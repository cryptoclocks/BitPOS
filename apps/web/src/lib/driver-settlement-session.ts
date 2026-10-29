import {z} from 'zod';
import {PlatformSession,PlatformError} from './platform-session';
import {
 SettlementFinancePageSchema,SettlementEligibilityCommandSchema,SettlementPrepareCommandSchema,SettlementBatchCommandSchema,
 SettlementEligibilityDecidedReceiptSchema,SettlementBatchDraftReceiptSchema,SettlementBatchReceiptSchema,
} from '../../../../packages/contracts/src/mobile-v1.generated';
import type {SettlementEligibilityDecidedReceipt,SettlementBatchDraftReceipt,SettlementBatchReceipt} from '../../../../packages/contracts/src/mobile-v1.generated';

const uuid=z.string().uuid();
const mutationSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('ELIGIBILITY'),merchantId:uuid,accrualId:uuid,command:SettlementEligibilityCommandSchema}).strict(),
 z.object({kind:z.literal('PREPARE'),command:SettlementPrepareCommandSchema}).strict(),
 z.object({kind:z.literal('BATCH'),merchantId:uuid,batchId:uuid,command:SettlementBatchCommandSchema}).strict(),
]).superRefine((saved,ctx)=>{
 if(saved.kind==='ELIGIBILITY'||saved.kind==='BATCH'&&saved.command.kind==='CANCEL_DRAFT')return;
 const command=saved.command;
 if(!('sourceIds' in command))return;
 if(command.sourceIds.length!==command.sourceVersions.length||command.sourceIds.some((id,i)=>i>0&&id<=command.sourceIds[i-1]))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Sources must be aligned, sorted and unique'});
});
const draftSchema=z.object({merchantId:uuid,driverId:uuid,receipt:SettlementBatchDraftReceiptSchema}).strict();
const journalSchema=z.object({pending:mutationSchema.nullable(),drafts:z.array(draftSchema)}).strict();
export type PendingDriverSettlement=z.infer<typeof mutationSchema>;
export type DriverSettlementJournal=z.infer<typeof journalSchema>;
export type DriverSettlementResult=
 |{kind:'ELIGIBILITY';receipt:SettlementEligibilityDecidedReceipt}
 |{kind:'PREPARE';receipt:SettlementBatchDraftReceipt}
 |{kind:'BATCH';receipt:SettlementBatchReceipt};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function response<T>(schema:z.ZodType<T>,data:unknown):T{
 const result=schema.safeParse(data);if(!result.success)throw new PlatformError('INVALID_RECEIPT',502);return result.data;
}

/** Independent mobile staff identity. No merchant session, worker API or wallet authority. */
export class DriverSettlementSession extends PlatformSession{
 private key(account:string){return 'bitpos.platform.driverSettlement.'+account;}
 private readJournal(account:string):DriverSettlementJournal{
  try{const raw=localStorage.getItem(this.key(account));if(!raw)return {pending:null,drafts:[]};const parsed=journalSchema.safeParse(JSON.parse(raw));if(!parsed.success)throw new PlatformError('INVALID_SAVED_COMMAND',409);return parsed.data;}
  catch(error){if(error instanceof PlatformError)throw error;throw new PlatformError('JOURNAL_UNAVAILABLE',503);}
 }
 private writeJournal(account:string,state:DriverSettlementJournal){
  try{localStorage.setItem(this.key(account),JSON.stringify(state));}
  catch{throw new PlatformError('JOURNAL_UNAVAILABLE',503);}
 }
 private async locked<T>(account:string,action:()=>T):Promise<T>{
  if(typeof navigator==='undefined'||!navigator.locks)throw new PlatformError('JOURNAL_UNAVAILABLE',503);
  return navigator.locks.request(this.key(account),action);
 }
 journal():DriverSettlementJournal{
  const account=this.accountId;if(!account)throw new PlatformError('AUTH_REQUIRED',401);
  if(typeof navigator==='undefined'||!navigator.locks)throw new PlatformError('JOURNAL_UNAVAILABLE',503);
  return this.readJournal(account);
 }
 isJournalEvent(key:string|null){return !!this.accountId&&(key===null||key===this.key(this.accountId));}
 async financePage(merchantId:string,afterId:string|null){
  const merchant=uuid.safeParse(merchantId),after=afterId===null?null:uuid.safeParse(afterId);
  if(!merchant.success||after&&!after.success)throw new PlatformError('INVALID_INPUT',422);
  const page=response(SettlementFinancePageSchema,await this.request('platform/merchants/'+merchant.data.toLowerCase()+'/earnings'+(after?.success?'?afterId='+after.data.toLowerCase():'')));
  if(page.merchantId!==merchant.data.toLowerCase()||page.items.some(item=>item.merchantId!==page.merchantId))throw new PlatformError('INVALID_RECEIPT',502);
  return page;
 }
 async submitSettlement(input:PendingDriverSettlement):Promise<DriverSettlementResult>{
  const account=this.accountId;if(!account)throw new PlatformError('AUTH_REQUIRED',401);
  const owner=this.sessionOwner(),parsed=mutationSchema.safeParse(input);if(!parsed.success)throw new PlatformError('INVALID_INPUT',422);
  const saved=parsed.data;
  // Cross-tab compare-and-set BEFORE any request. Never replace an unresolved command.
  await this.locked(account,()=>{this.requireSessionOwner(owner);const state=this.readJournal(account);if(state.pending&&!equal(state.pending,saved))throw new PlatformError('PENDING_COMMAND',409);this.writeJournal(account,{...state,pending:saved});});
  this.requireSessionOwner(owner);
  const retire=()=>this.locked(account,()=>{const state=this.readJournal(account);if(equal(state.pending,saved))this.writeJournal(account,{...state,pending:null});});
  let result:DriverSettlementResult;
  try{
   switch(saved.kind){
    case 'ELIGIBILITY':{
     const receipt=response(SettlementEligibilityDecidedReceiptSchema,await this.request('platform/earnings/'+saved.accrualId+'/eligibility',saved.command));
     if(receipt.accrualId!==saved.accrualId||BigInt(receipt.version)!==BigInt(saved.command.expectedVersion)+1n||receipt.state!==(saved.command.decision==='HOLD'?'HELD':'AVAILABLE'))throw new PlatformError('INVALID_RECEIPT',502);
     result={kind:saved.kind,receipt};break;
    }
    case 'PREPARE':{
     const receipt=response(SettlementBatchDraftReceiptSchema,await this.request('platform/settlement-batches',saved.command));
     if(receipt.beneficiaryId!==saved.command.beneficiaryId||receipt.beneficiaryVersion!==saved.command.beneficiaryVersion||!equal(receipt.sourceIds,saved.command.sourceIds)||!equal(receipt.sourceVersions,saved.command.sourceVersions))throw new PlatformError('INVALID_RECEIPT',502);
     result={kind:saved.kind,receipt};break;
    }
    case 'BATCH':{
     const receipt=response(SettlementBatchReceiptSchema,await this.request('platform/settlement-batches/'+saved.batchId+'/commands',saved.command));
     if(receipt.batchId!==saved.batchId||BigInt(receipt.version)!==BigInt(saved.command.expectedVersion)+1n||receipt.kind!==(saved.command.kind==='APPROVE_RESERVE'?'BATCH_RESERVED':'BATCH_CANCELLED'))throw new PlatformError('INVALID_RECEIPT',502);
     result={kind:saved.kind,receipt};break;
    }
   }
  }catch(error){
   // These exact API errors conclusively roll back this command. Auth/scope changes,
   // transport/refresh failures, malformed receipts, 5xx and unknown errors stay pending.
   if(error instanceof PlatformError&&(error.status===422&&error.code==='INVALID_REQUEST'||error.status===409&&['VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','SETUP_REQUIRED','SETTLEMENT_NOT_READY'].includes(error.code)))await retire();
   throw error;
  }
  this.requireSessionOwner(owner);const completed=result;
  await this.locked(account,()=>{
   this.requireSessionOwner(owner);const state=this.readJournal(account);
   if(!equal(state.pending,saved))throw new PlatformError('PENDING_COMMAND',409);
   let drafts=state.drafts;
   if(completed.kind==='PREPARE'&&saved.kind==='PREPARE'){
    const receipt=completed.receipt;
    drafts=[...drafts.filter(draft=>draft.receipt.batchId!==receipt.batchId),{merchantId:saved.command.merchantId,driverId:saved.command.driverId,receipt}];
   }else if(completed.kind==='BATCH'){
    const batchId=completed.receipt.batchId;drafts=drafts.filter(draft=>draft.receipt.batchId!==batchId);
   }
   // Store the exact draft source/version receipt atomically with retiring pending.
   // A storage failure leaves pending intact, so replay can recover the same receipt.
   this.writeJournal(account,{pending:null,drafts});
  });
  this.requireSessionOwner(owner);return result;
 }
}
