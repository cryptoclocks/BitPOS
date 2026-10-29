import {createHash} from 'node:crypto';
import type pg from 'pg';
import {z} from 'zod';
import {assertAssetDescriptor} from '../../../packages/domain/src/payment-assets';
import {payoutAssetSchema,payoutPreparedSchema,payoutReceiptDigest} from './payout-provider';
import type {RefundExecutionSnapshot,RefundExecutionStore} from './food-refund-execution';
export type RefundSqlTransaction=<T>(run:(db:Pick<pg.PoolClient,'query'>)=>Promise<T>)=>Promise<T>;
export class RefundStoreError extends Error{constructor(code:'WORKER_ROLE_REQUIRED'|'INVALID_SQL_RESULT'|'IDENTITY_CONFLICT'|'FUNDING_ADMISSION_REQUIRED'|'LEDGER_ADMISSION_REQUIRED'){super('REFUND_'+code);}}
const uuid=z.string().uuid(),version=z.string().regex(/^[1-9][0-9]{0,18}$/).refine(v=>BigInt(v)<=9223372036854775807n);
const snapshotSchema=z.object({attemptId:uuid,caseId:uuid,paymentId:uuid,version,state:z.enum(['SIGNING','PREPARED','UNKNOWN','FINALIZED','FAILED']),amountMinor:version,asset:payoutAssetSchema,beneficiaryOwner:z.string().min(1).max(128),sourceOwner:z.string().min(1).max(128),feePayerOwner:z.string().min(1).max(128),fundingReservationId:uuid,fundingAvailable:z.boolean(),maxFeeLamports:z.number().int().min(1).max(1000000),maxTotalLamports:z.number().int().min(1).max(10000000),prepared:payoutPreparedSchema.nullable()}).strict().refine(s=>(s.state==='SIGNING')===(s.prepared===null)&&s.maxTotalLamports>=s.maxFeeLamports);
/** A dedicated restricted login pool only. Never creates infrastructure, reads
 * .env/signing keys, or runs inside an API tenant connection. */
export function createRefundSqlTransaction(pool:Pick<pg.Pool,'connect'>):RefundSqlTransaction{
 return async run=>{
  const db=await pool.connect();
  try{
   await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
   await db.query("SET LOCAL statement_timeout='2000ms';SET LOCAL lock_timeout='200ms'");
   const result=await db.query(`SELECT current_user=session_user AND pg_has_role(session_user,to_regrole('bitpos_refund_worker'),'USAGE') AND NOT pg_has_role(session_user,'bitpos_app','MEMBER') AND NOT(r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls OR r.rolreplication) allowed FROM pg_roles r WHERE r.rolname=session_user`);
   if(result.rows[0]?.allowed!==true)throw new RefundStoreError('WORKER_ROLE_REQUIRED');
   const value=await run(db);await db.query('COMMIT');return value;
  }catch(error){try{await db.query('ROLLBACK');}catch{}throw error;}finally{db.release();}
 };
}
export function createFoodRefundSqlStore(transaction:RefundSqlTransaction,admission:{receipts?:'112';submission?:'114'}={}):RefundExecutionStore{
 async function call(sql:string,args:unknown[]){return transaction(async db=>{const result=await db.query(sql,args);if(result.rows.length!==1||!Object.hasOwn(result.rows[0],'value'))throw new RefundStoreError('INVALID_SQL_RESULT');return result.rows[0].value;});}
 return{
  async snapshot(attemptId){
   const id=uuid.parse(attemptId),value=snapshotSchema.parse(await call(admission.submission==='114'?'SELECT bitpos.food_refund114_snapshot($1) value':admission.receipts==='112'?'SELECT bitpos.food_refund112_snapshot($1) value':'SELECT bitpos.food_refund110_snapshot($1) value',[id]));assertAssetDescriptor(value.asset);
   if(admission.submission!=='114'&&value.fundingAvailable)throw new RefundStoreError('FUNDING_ADMISSION_REQUIRED');
   if(value.attemptId!==id||value.prepared&&(value.prepared.attemptId!==id||value.prepared.batchId!==value.caseId||value.prepared.amountMinor!==value.amountMinor||value.prepared.recipientOwner!==value.beneficiaryOwner))throw new RefundStoreError('IDENTITY_CONFLICT');
   return value as RefundExecutionSnapshot;
  },
  async persistPrepared(snapshot,prepared){
   const data=payoutPreparedSchema.parse(prepared);if(data.attemptId!==snapshot.attemptId||data.batchId!==snapshot.caseId)throw new RefundStoreError('IDENTITY_CONFLICT');
   return z.boolean().parse(await call('SELECT bitpos.food_refund110_prepare($1,$2,$3::jsonb) value',[uuid.parse(snapshot.attemptId),version.parse(snapshot.version),JSON.stringify(data)]));
  },
  async recordUnknown(snapshot,reason){await call('SELECT bitpos.food_refund110_unknown($1,$2,$3) value',[uuid.parse(snapshot.attemptId),version.parse(snapshot.version),z.string().min(1).max(100).parse(reason)]);},
  // These missing authorities must never silently succeed. Replaced only after
  // verified funding/reservations and receipt+ledger transactions are admitted.
  async authorizeSubmission(snapshot){
   if(admission.submission!=='114'||admission.receipts!=='112')throw new RefundStoreError('FUNDING_ADMISSION_REQUIRED');
   const p=payoutPreparedSchema.parse(snapshot.prepared),raw=await call('SELECT bitpos.food_refund114_submit($1,$2,$3) value',[uuid.parse(snapshot.attemptId),version.parse(snapshot.version),p.signedBytesSha256]);
   if(raw===null)return null;const value=snapshotSchema.parse(raw);
   if(value.attemptId!==snapshot.attemptId||value.prepared?.signedBase64!==p.signedBase64||value.prepared.signature!==p.signature||!value.fundingAvailable||value.state!=='UNKNOWN')throw new RefundStoreError('IDENTITY_CONFLICT');return value;
  },
  async recordVerified(snapshot,observation){
   if(admission.receipts!=='112')throw new RefundStoreError('LEDGER_ADMISSION_REQUIRED');
   const p=payoutPreparedSchema.parse(snapshot.prepared);let evidence:unknown,digest:string;
   if(observation.status==='FINALIZED'){
    const e=observation.receipt.evidence;evidence=e;digest=observation.receipt.digest;
    if(e.commitment!=='finalized'||e.attemptId!==snapshot.attemptId||e.batchId!==snapshot.caseId||e.amountMinor!==snapshot.amountMinor||e.recipientOwner!==snapshot.beneficiaryOwner||e.signature!==p.signature||e.intentDigest!==p.intentDigest||e.signedBytesSha256!==p.signedBytesSha256||digest!==payoutReceiptDigest(e))throw new RefundStoreError('IDENTITY_CONFLICT');
   }else{
    evidence=observation.evidence;digest=observation.digest;
    if(observation.signature!==p.signature||observation.evidence.intentDigest!==p.intentDigest||observation.evidence.signedBytesSha256!==p.signedBytesSha256||digest!==createHash('sha256').update(JSON.stringify(['BitPOS/PayoutFailure/v1',p.signature,observation.evidence])).digest('hex'))throw new RefundStoreError('IDENTITY_CONFLICT');
   }
   z.object({receiptId:uuid,postingId:uuid.nullable(),quarantined:z.boolean()}).strict().parse(await call('SELECT bitpos.food_refund112_record($1,$2,$3::jsonb,$4) value',[uuid.parse(snapshot.attemptId),observation.status,JSON.stringify(evidence),digest]));
  },
 };
}
