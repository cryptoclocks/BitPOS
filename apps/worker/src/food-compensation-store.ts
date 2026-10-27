import {createHash} from 'node:crypto';
import type pg from 'pg';
import {z} from 'zod';
import {payoutReceiptDigest,payoutAssetSchema,payoutPreparedSchema,type ReconcilePayoutResult,type PreparedPayout} from './payout-provider';
import {validateCompensationPrepared} from './food-compensation-prepared';
export type CompensationSqlTransaction=<T>(run:(db:Pick<pg.PoolClient,'query'>)=>Promise<T>)=>Promise<T>;
const uuid=z.string().uuid();
const schema=z.object({attemptId:uuid,reservationId:uuid,recipientOwner:z.string(),sourceOwner:z.string(),feePayerOwner:z.string(),amountMinor:z.string().regex(/^[1-9][0-9]{0,17}$/),asset:payoutAssetSchema,maxFeeLamports:z.number().int().min(1).max(1000000).nullable(),maxTotalLamports:z.number().int().min(1).max(10000000).nullable(),submissionSequence:z.string().regex(/^(0|[1-9][0-9]{0,18})$/),state:z.enum(['ALLOCATED','PREPARED','UNKNOWN','FINALIZED','FAILED','RECONCILIATION_REQUIRED']),fundingAvailable:z.boolean(),prepared:payoutPreparedSchema.nullable()}).strict();
/** A separately provisioned restricted login pool; no API/admin connections. */
export function createCompensationSqlTransaction(pool:Pick<pg.Pool,'connect'>):CompensationSqlTransaction{
 return async run=>{const db=await pool.connect();try{
  await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');await db.query("SET LOCAL statement_timeout='2000ms';SET LOCAL lock_timeout='200ms'");
  const role=await db.query("SELECT current_user=session_user AND pg_has_role(session_user,to_regrole('bitpos_compensation_worker'),'USAGE') AND NOT pg_has_role(session_user,'bitpos_app','MEMBER') AND NOT(r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls OR r.rolreplication) allowed FROM pg_roles r WHERE r.rolname=session_user");
  if(role.rows[0]?.allowed!==true)throw Error('COMPENSATION_WORKER_ROLE_REQUIRED');const value=await run(db);await db.query('COMMIT');return value;
 }catch(error){try{await db.query('ROLLBACK');}catch{}throw error;}finally{db.release();}};
}
export function createCompensationSqlStore(transaction:CompensationSqlTransaction){
 async function snapshot(attemptId:string){const id=uuid.parse(attemptId);return transaction(async db=>{
  const value=schema.parse((await db.query('SELECT bitpos.food_compensation132_snapshot($1)value',[id])).rows[0]?.value);if(value.attemptId!==id)throw Error('COMPENSATION_IDENTITY_CONFLICT');
  if(value.prepared){if(value.maxFeeLamports===null||value.maxTotalLamports===null)throw Error('COMPENSATION_FEE_REQUIRED');validateCompensationPrepared({...value,maxFeeLamports:value.maxFeeLamports,maxTotalLamports:value.maxTotalLamports},value.prepared);}return value;
 });}
 return {snapshot,async recordVerified(attemptId:string,observation:Extract<ReconcilePayoutResult,{status:'FINALIZED'|'FAILED'}>){
  const current=await snapshot(attemptId),p=current.prepared;if(!p)throw Error('COMPENSATION_PREPARED_REQUIRED');let evidence:unknown,digest:string;
  if(observation.status==='FINALIZED'){
   const e=observation.receipt.evidence;evidence=e;digest=observation.receipt.digest;
   if(digest!==payoutReceiptDigest(e)||e.commitment!=='finalized'||e.signature!==p.signature||e.attemptId!==p.attemptId||e.batchId!==p.batchId||e.amountMinor!==p.amountMinor||e.recipientOwner!==p.recipientOwner||e.sourceOwner!==p.sourceOwner||e.intentDigest!==p.intentDigest||e.signedBytesSha256!==p.signedBytesSha256||e.genesisHash!==p.genesisHash)throw Error('COMPENSATION_RECEIPT_CONFLICT');
  }else{
   evidence=observation.evidence;digest=observation.digest;
   if(observation.signature!==p.signature||observation.evidence.intentDigest!==p.intentDigest||observation.evidence.signedBytesSha256!==p.signedBytesSha256||observation.evidence.genesisHash!==p.genesisHash||digest!==createHash('sha256').update(JSON.stringify(['BitPOS/PayoutFailure/v1',p.signature,observation.evidence])).digest('hex'))throw Error('COMPENSATION_RECEIPT_CONFLICT');
  }
  return transaction(async db=>z.object({receiptId:uuid,postingId:uuid.nullable(),quarantined:z.boolean()}).strict().parse((await db.query('SELECT bitpos.food_compensation131_record($1,$2,$3::jsonb,$4)value',[current.attemptId,observation.status,JSON.stringify(evidence),digest])).rows[0]?.value));
 },async authorizeSubmission(attemptId:string,expectedSequence:string){
  const id=uuid.parse(attemptId);if(!/^(0|[1-9][0-9]{0,18})$/.test(expectedSequence)||BigInt(expectedSequence)>=9223372036854775807n)throw Error('COMPENSATION_INVALID_SEQUENCE');
  const current=await snapshot(id);if(['FINALIZED','FAILED','RECONCILIATION_REQUIRED'].includes(current.state))throw Error('COMPENSATION_TERMINAL');if(!current.prepared||!current.fundingAvailable)throw Error('COMPENSATION_FUNDING_REQUIRED');
  return transaction(async db=>{const raw=(await db.query('SELECT bitpos.food_compensation130_authorize($1,$2,$3)value',[id,expectedSequence,current.prepared!.signedBytesSha256])).rows[0]?.value;if(raw===null)return null;
   const receipt=z.object({attemptId:uuid,sequence:z.string().regex(/^[1-9][0-9]{0,18}$/),state:z.literal('UNKNOWN'),signedBytesSha256:z.string().regex(/^[a-f0-9]{64}$/),fundsTransferred:z.literal(false)}).strict().parse(raw);
   if(receipt.attemptId!==id||BigInt(receipt.sequence)!==BigInt(expectedSequence)+1n||receipt.signedBytesSha256!==current.prepared!.signedBytesSha256)throw Error('COMPENSATION_IDENTITY_CONFLICT');return receipt;
  });
 },async persistPrepared(attemptId:string,payload:PreparedPayout){
  const current=await snapshot(attemptId);if(!current.fundingAvailable||current.maxFeeLamports===null||current.maxTotalLamports===null)throw Error('COMPENSATION_FUNDING_REQUIRED');
  const prepared=validateCompensationPrepared({...current,maxFeeLamports:current.maxFeeLamports,maxTotalLamports:current.maxTotalLamports},payload);
  return transaction(async db=>{const value=(await db.query('SELECT bitpos.food_compensation128_prepare($1,$2::jsonb)value',[current.attemptId,JSON.stringify(prepared)])).rows[0]?.value;if(typeof value!=='boolean')throw Error('COMPENSATION_INVALID_SQL_RESULT');return value;});
 }};
}
