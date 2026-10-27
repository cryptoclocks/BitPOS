import {FoodDriverCompensationSchema,FoodCompensationExecutionSchema,FoodCompensationRetireCommandSchema,FoodCompensationRetireReceiptSchema,FoodCompensationPublishCommandSchema,FoodCompensationPublishReceiptSchema,FoodCompensationSnapshotSchema,FoodCompensationCommandSchema,FoodCompensationReceiptSchema,FoodRefundReconcileCommandSchema,FoodRefundReconcileReceiptSchema,FoodCustomerRefundExecutionSchema,FoodReturnExecutionSchema,FoodReturnFinancialCommandSchema,FoodReturnFinancialReceiptSchema,FoodReturnFinancialSnapshotSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import type pg from'pg';import{z}from'zod';import{RequestError}from'./authority';
const uuid=z.string().uuid(),version=z.string().regex(/^[1-9][0-9]{0,18}$/).refine(v=>BigInt(v)<=9223372036854775807n);
export const FoodReturnRequestCandidateSchema=z.object({idempotencyKey:uuid,expectedVersion:version,generation:version,leaseGeneration:version,reason:z.string().trim().min(1).max(500)}).strict();
export const FoodReturnReceiveCandidateSchema=z.object({idempotencyKey:uuid,expectedVersion:version,condition:z.enum(['SEALED','OPENED','DAMAGED']),reason:z.string().trim().min(1).max(500)}).strict();
const receipt=z.object({caseId:uuid,assignmentId:uuid,state:z.enum(['RETURN_REQUESTED','RETURN_RECORDED']),custodyReleased:z.literal(false),financialResolutionReady:z.literal(false)}).strict();
function boundary(error:unknown):never{
 if(error instanceof RequestError)throw error;
 if(error instanceof Error){
  const code=(error as{code?:string}).code;
  if(error.message==='INVALID_REQUEST')throw new RequestError(422,'INVALID_REQUEST');
  if(error.message==='AUTH_REQUIRED')throw new RequestError(401,'AUTH_REQUIRED');
  if(error.message==='ROLE_REQUIRED')throw new RequestError(403,'ROLE_REQUIRED');
  if(error.message==='RESOURCE_NOT_FOUND')throw new RequestError(404,'RESOURCE_NOT_FOUND');
  if(['55P03','57014','40001','40P01'].includes(code??''))throw new RequestError(409,'DISPATCH_AUTH_RETRY');
  if(['42501','42883','42P01'].includes(code??''))throw new RequestError(503,'CONFIGURATION_REQUIRED');
  if(error.message==='IDEMPOTENCY_CONFLICT')throw new RequestError(409,'IDEMPOTENCY_CONFLICT');
  if(['VERSION_CONFLICT','ASSIGNMENT_CHANGED','RETURN_REQUIRES_RETAINED_INCIDENT','RETURN_CASE_EXISTS','RETURN_ASSIGNMENT_CHANGED','RETURN_ALREADY_RECORDED','RETURN_CASE_REQUIRES_RESOLUTION','RETURN_RECEIPT_REQUIRED','RETURN_ALREADY_RESOLVED','INCIDENT_ACK_REQUIRED','RETURN_FINANCIAL_RECONCILIATION_REQUIRED','RETURN_FINANCIAL_REVIEW_REQUIRED','RETURN_FINANCIAL_ALREADY_DECIDED','COMPENSATION_ALREADY_DECIDED','COMPENSATION_POLICY_UNAVAILABLE','COMPENSATION_POLICY_RETIRED','COMPENSATION_REVIEW_REQUIRED'].includes(error.message))throw new RequestError(409,'QUOTE_CHANGED',error.message,{reasonCode:error.message});
 }
 throw error;
}
/** Private only: caller owns transaction + live actor/session/tenant context.
 * No public registration/grants, custody release or financial admission.
 */
export async function prepareFoodReturnCandidate(db:pg.Client|pg.PoolClient,assignmentId:string,input:unknown){
 uuid.parse(assignmentId);const data=FoodReturnRequestCandidateSchema.parse(input);
 try{const value=receipt.parse((await db.query('SELECT bitpos.food_return108_request($1,$2::jsonb) value',[assignmentId,JSON.stringify(data)])).rows[0].value);if(value.assignmentId!==assignmentId||value.state!=='RETURN_REQUESTED')throw Error('Return request receipt mismatch');return value;}catch(error){boundary(error);}
}
export async function recordFoodReturnCandidate(db:pg.Client|pg.PoolClient,caseId:string,merchantSessionHash:string,input:unknown){
 uuid.parse(caseId);z.string().regex(/^[a-f0-9]{64}$/).parse(merchantSessionHash);const data=FoodReturnReceiveCandidateSchema.parse(input);
 try{const value=receipt.parse((await db.query('SELECT bitpos.food_return108_receive($1,$2,$3::jsonb) value',[caseId,merchantSessionHash,JSON.stringify(data)])).rows[0].value);if(value.caseId!==caseId||value.state!=='RETURN_RECORDED')throw Error('Return receipt mismatch');return value;}catch(error){boundary(error);}
}
export const FoodReturnResolveCandidateSchema=z.object({idempotencyKey:uuid,expectedVersion:version,reason:z.string().trim().min(1).max(500)}).strict();
const resolution=z.object({caseId:uuid,assignmentId:uuid,state:z.literal('RETURN_RESOLVED'),custodyReleased:z.literal(true),financialReview:z.literal('PENDING'),fundsTransferred:z.literal(false),stockRestored:z.literal(false)}).strict();
export async function resolveFoodReturnCandidate(db:pg.Client|pg.PoolClient,caseId:string,input:unknown){
 uuid.parse(caseId);const data=FoodReturnResolveCandidateSchema.parse(input);
 try{const value=resolution.parse((await db.query('SELECT bitpos.food_return108_resolve($1,$2::jsonb) value',[caseId,JSON.stringify(data)])).rows[0].value);if(value.caseId!==caseId)throw Error('Return resolution receipt mismatch');return value;}catch(error){boundary(error);}
}
export const FoodReturnSnapshotCandidateSchema=z.object({assignmentId:uuid,shipmentVersion:version,case:z.object({caseId:uuid,state:z.enum(['RETURN_REQUESTED','RETURN_RECORDED','RETURN_RESOLVED']),requestedAt:z.string().datetime({offset:true}),receivedAt:z.string().datetime({offset:true}).nullable(),condition:z.enum(['SEALED','OPENED','DAMAGED']).nullable(),resolvedAt:z.string().datetime({offset:true}).nullable(),custodyReleased:z.boolean(),financialReview:z.enum(['PENDING','NOT_OPENED'])}).strict().nullable()}).strict().refine(v=>v.case===null||(v.case.state==='RETURN_RESOLVED')===v.case.custodyReleased).refine(v=>v.case===null||(v.case.state==='RETURN_RESOLVED')===(v.case.financialReview==='PENDING'));
export async function readFoodReturnCandidate(db:pg.Client|pg.PoolClient,assignmentId:string,merchantSessionHash?:string){
 uuid.parse(assignmentId);if(merchantSessionHash!==undefined)z.string().regex(/^[a-f0-9]{64}$/).parse(merchantSessionHash);
 try{const value=FoodReturnSnapshotCandidateSchema.parse((await db.query('SELECT bitpos.food_return108_snapshot($1,$2) value',[assignmentId,merchantSessionHash??null])).rows[0].value);if(value.assignmentId!==assignmentId)throw Error('Return snapshot identity mismatch');return value;}catch(error){boundary(error);}
}

export async function decideFoodReturnFinancialCandidate(db:pg.Client|pg.PoolClient,caseId:string,input:unknown){
 uuid.parse(caseId);const data=FoodReturnFinancialCommandSchema.parse(input);
 try{const value=FoodReturnFinancialReceiptSchema.parse((await db.query('SELECT bitpos.food_return109_decide($1,$2::jsonb) value',[caseId,JSON.stringify(data)])).rows[0].value);
  if(value.caseId!==caseId||value.decision!==data.decision||value.executionState!==(value.decision==='NO_REFUND'?'NOT_REQUESTED':'PENDING')||value.decision==='LINE_REFUND'&&(data.decision!=='LINE_REFUND'||value.selection.lineId!==data.lineId))throw Error('Financial decision receipt mismatch');return value;
 }catch(error){boundary(error);}
}
export async function readFoodReturnFinancialCandidate(db:pg.Client|pg.PoolClient,caseId:string){
 uuid.parse(caseId);
 try{const value=FoodReturnFinancialSnapshotSchema.parse((await db.query('SELECT bitpos.food_return109_snapshot($1) value',[caseId])).rows[0].value);
  if(value.caseId!==caseId||value.decision&&value.decision.caseId!==caseId)throw Error('Financial review identity mismatch');return value;
 }catch(error){boundary(error);}
}

export async function readFoodReturnExecutionCandidate(db:pg.Client|pg.PoolClient,caseId:string){uuid.parse(caseId);try{const value=FoodReturnExecutionSchema.parse((await db.query('SELECT bitpos.food_refund116_execution($1) value',[caseId])).rows[0].value);if(value.caseId!==caseId||value.allPaymentsRefunded!==(value.state==='FINALIZED'))throw Error('Execution snapshot mismatch');return value;}catch(error){boundary(error);}}

export async function readMerchantRefundExecutionCandidate(db:pg.PoolClient,orderId:string,sessionHash:string){uuid.parse(orderId);z.string().regex(/^[a-f0-9]{64}$/).parse(sessionHash);try{const value=FoodCustomerRefundExecutionSchema.parse((await db.query('SELECT bitpos.food_refund118_merchant($1,$2) value',[orderId,sessionHash])).rows[0].value);if(value.orderId!==orderId)throw Error('Merchant refund order mismatch');return value;}catch(error){boundary(error);}}

export async function reconcileRefundPaymentsCandidate(db:pg.PoolClient,caseId:string,input:unknown){uuid.parse(caseId);const data=FoodRefundReconcileCommandSchema.parse(input);if(BigInt(data.expectedVersion)>9223372036854775807n)throw new RequestError(422,'INVALID_REQUEST');try{const value=FoodRefundReconcileReceiptSchema.parse((await db.query('SELECT bitpos.food_refund119_reconcile($1,$2::jsonb) value',[caseId,JSON.stringify(data)])).rows[0].value);if(value.caseId!==caseId)throw Error('Reconciliation receipt mismatch');return value;}catch(error){boundary(error);}}

export async function approveFoodCompensationCandidate(db:pg.Client|pg.PoolClient,caseId:string,input:unknown){
 uuid.parse(caseId);const data=FoodCompensationCommandSchema.parse(input);
 if(BigInt(data.expectedVersion)>9223372036854775807n)throw new RequestError(422,'INVALID_REQUEST');
 try{const value=FoodCompensationReceiptSchema.parse((await db.query('SELECT bitpos.food_compensation120_approve($1,$2::jsonb) value',[caseId,JSON.stringify(data)])).rows[0].value);
  if(value.caseId!==caseId||value.policyId!==data.policyId||BigInt(value.amountMinor)>9223372036854775807n)throw Error('Compensation receipt mismatch');return value;
 }catch(error){boundary(error);}
}

export async function readFoodCompensationCandidate(db:pg.Client|pg.PoolClient,caseId:string){
 uuid.parse(caseId);try{const value=FoodCompensationSnapshotSchema.parse((await db.query('SELECT bitpos.food_compensation120_snapshot($1) value',[caseId])).rows[0].value);if(value.caseId!==caseId||value.decision&&value.decision.caseId!==caseId)throw Error('Compensation snapshot mismatch');return value;}catch(error){boundary(error);}
}

export async function publishFoodCompensationCandidate(db:pg.Client|pg.PoolClient,caseId:string,input:unknown){
 uuid.parse(caseId);const data=FoodCompensationPublishCommandSchema.parse(input);
 if(BigInt(data.expectedVersion)>9223372036854775807n||BigInt(data.maxMinor)>9223372036854775807n)throw new RequestError(422,'INVALID_REQUEST');
 try{const value=FoodCompensationPublishReceiptSchema.parse((await db.query('SELECT bitpos.food_compensation121_publish($1,$2::jsonb) value',[caseId,JSON.stringify(data)])).rows[0].value);
 if(value.caseId!==caseId||value.enabled!==data.enabled||value.returnedRateBps!==data.returnedRateBps||value.maxMinor!==data.maxMinor)throw Error('Compensation policy receipt mismatch');return value;}catch(error){boundary(error);}
}

export async function retireFoodCompensationCandidate(db:pg.Client|pg.PoolClient,caseId:string,input:unknown){
 uuid.parse(caseId);const data=FoodCompensationRetireCommandSchema.parse(input);if(BigInt(data.expectedVersion)>9223372036854775807n)throw new RequestError(422,'INVALID_REQUEST');
 try{const value=FoodCompensationRetireReceiptSchema.parse((await db.query('SELECT bitpos.food_compensation122_retire($1,$2::jsonb) value',[caseId,JSON.stringify(data)])).rows[0].value);if(value.caseId!==caseId||value.policyId!==data.policyId)throw Error('Policy retirement receipt mismatch');return value;}catch(error){boundary(error);}
}

export async function readFoodCompensationExecutionCandidate(db:pg.Client|pg.PoolClient,caseId:string){
 uuid.parse(caseId);try{const value=FoodCompensationExecutionSchema.parse((await db.query('SELECT bitpos.food_compensation133_execution($1)value',[caseId])).rows[0].value);if(value.caseId!==caseId||value.fundsTransferred!==(value.state==='FINALIZED'))throw Error('Compensation execution receipt mismatch');return value;}catch(error){boundary(error);}
}

export async function readDriverCompensationCandidate(db:pg.Client|pg.PoolClient,assignmentId:string){
 uuid.parse(assignmentId);try{const value=FoodDriverCompensationSchema.parse((await db.query('SELECT bitpos.food_compensation134_driver($1)value',[assignmentId])).rows[0].value);if(value.assignmentId!==assignmentId||value.execution&&value.execution.fundsTransferred!==(value.execution.state==='FINALIZED'))throw Error('Driver compensation identity mismatch');return value;}catch(error){boundary(error);}
}
