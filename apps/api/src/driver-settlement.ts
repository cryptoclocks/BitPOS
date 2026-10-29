import {z} from 'zod';
import {pool} from './db';
import {mobilePrincipal} from './mobile-auth';
import {hash} from '../../../packages/domain/src/index';
import {RequestError,fail} from './authority';
import {SettlementDriverPageSchema,SettlementFinancePageSchema,SettlementEligibilityCommandSchema,SettlementEligibilityDecidedReceiptSchema,SettlementEnrollCommandSchema,SettlementBeneficiaryPendingReceiptSchema,SettlementPrepareCommandSchema,SettlementBatchDraftReceiptSchema,SettlementBatchCommandSchema,SettlementBatchReceiptSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {verifySettlementBeneficiary} from './settlement-beneficiary-verifier';
import {SettlementBeneficiaryVerifyCommandSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {SettlementAuthorityRetirementCommandSchema,SettlementAuthorityRetiredReceiptSchema} from '../../../packages/contracts/src/mobile-v1.generated';
const uuid=z.string().uuid();
const invalid=new Set(['INVALID_REQUEST','INVALID_INTEGER','INVALID_UUID','INVALID_HASH','INVALID_MONEY','SOURCE_IDS_MUST_BE_SORTED_UNIQUE','AMOUNT_OVERFLOW','INVALID_CURSOR']);
const notReady=new Set(['EARNING_NOT_REVIEWABLE','EARNING_REQUIRES_DELIVERY','EARNING_NOT_AVAILABLE','BENEFICIARY_SUSPENDED','BENEFICIARY_PENDING','BATCH_NOT_DRAFT','SOURCE_FACTS_CONFLICT','PAYOUT_PAYABLE_BALANCE','PAYABLE_NOT_FOUND','SOURCE_RECONCILIATION_REQUIRED','FUNDING_RECONCILIATION_REQUIRED']);
function boundary(error:unknown):never{
 if(error instanceof Error){const message=error.message;
  if(invalid.has(message))throw new RequestError(422,'INVALID_REQUEST');
  if(message==='SETTLEMENT_AUTH_RETRY'||(error as {code?:string}).code==='55P03'||(error as {code?:string}).code==='57014')throw new RequestError(409,'SETTLEMENT_AUTH_RETRY');
  if(message==='SETTLEMENT_READ_COMMITTED_REQUIRED')throw new RequestError(503,'CONFIGURATION_REQUIRED');
  if(message==='AUTH_REQUIRED')throw new RequestError(401,'AUTH_REQUIRED');
  if(message==='ROLE_REQUIRED')throw new RequestError(403,'ROLE_REQUIRED');
  if(message==='RESOURCE_NOT_FOUND')throw new RequestError(404,'RESOURCE_NOT_FOUND');
  if(message==='VERSION_CONFLICT'||message==='IDEMPOTENCY_CONFLICT')throw new RequestError(409,message);
  if(message==='BENEFICIARY_AUTHORITY_STILL_LIVE')throw new RequestError(409,message);
  if(message.startsWith('SETUP_REQUIRED_'))throw new RequestError(409,'SETUP_REQUIRED','Original settlement facts require setup',{reasonCode:message});
  if(message==='PROVIDER_UNAVAILABLE')throw new RequestError(503,'CONFIGURATION_REQUIRED');
  if(notReady.has(message))throw new RequestError(409,'SETTLEMENT_NOT_READY','Settlement is not ready',{reasonCode:message});
 }
 throw error;
}
/** Global mobile identity is confined to narrow financial entrypoints, never a merchant proxy. */
export async function driverSettlementRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const path=url.pathname,own=path==='/api/mobile/v1/driver/earnings',finance=/^\/api\/mobile\/v1\/platform\/merchants\/([^/]+)\/earnings$/.exec(path),eligibility=/^\/api\/mobile\/v1\/platform\/earnings\/([^/]+)\/eligibility$/.exec(path),enroll=path==='/api/mobile/v1/driver/payout-beneficiaries',prepare=path==='/api/mobile/v1/platform/settlement-batches',batch=/^\/api\/mobile\/v1\/platform\/settlement-batches\/([^/]+)\/commands$/.exec(path);
 const verify=/^\/api\/mobile\/v1\/driver\/payout-beneficiaries\/([^/]+)\/verify$/.exec(path);
 const retirement=path==='/api/mobile/v1/driver/payout-beneficiaries/retired-authority';
 if(verify){
  if(method!=='POST'||url.search)fail('INVALID_REQUEST',422);
  const actor=await mobilePrincipal(bearer);
  try{return await verifySettlementBeneficiary(actor,hash(bearer!.slice(7)),uuid.parse(verify[1]),SettlementBeneficiaryVerifyCommandSchema.parse(input));}catch(error){boundary(error);}
 }
 if(!own&&!finance&&!eligibility&&!enroll&&!prepare&&!batch&&!retirement)return undefined;
 const actor=await mobilePrincipal(bearer),keys=[...url.searchParams.keys()];
 if(keys.length>1||keys.some(key=>key!=='afterId')||keys.length&&(method!=='GET'||!own&&!finance))fail('INVALID_REQUEST',422);
 if((own||finance)&&method!=='GET'||(eligibility||enroll||prepare||batch||retirement)&&method!=='POST')fail('RESOURCE_NOT_FOUND',404);
 const after=url.searchParams.has('afterId')?uuid.parse(url.searchParams.get('afterId')):null;
 const db=await pool.connect();try{
  await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');await db.query("SET LOCAL statement_timeout='2000ms';SET LOCAL lock_timeout='200ms'");
  await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_device',$3,true),set_config('bitpos.mobile_access_hash',$4,true)",[actor.accountId,actor.sessionId,actor.deviceId,hash(bearer!.slice(7))]);
  let result:unknown;
  if(own)result=SettlementDriverPageSchema.parse((await db.query('SELECT bitpos.settlement088_driver_snapshot($1) value',[after])).rows[0].value);
  else if(finance)result=SettlementFinancePageSchema.parse((await db.query('SELECT bitpos.settlement088_finance_snapshot($1,$2) value',[uuid.parse(finance[1]),after])).rows[0].value);
  else if(eligibility){const command=SettlementEligibilityCommandSchema.parse(input);result=SettlementEligibilityDecidedReceiptSchema.parse((await db.query('SELECT bitpos.settlement088_eligibility($1,$2::jsonb) value',[uuid.parse(eligibility[1]),JSON.stringify(command)])).rows[0].value);}
  else if(enroll){const command=SettlementEnrollCommandSchema.parse(input);result=SettlementBeneficiaryPendingReceiptSchema.parse((await db.query('SELECT bitpos.settlement088_beneficiary_enroll($1::jsonb) value',[JSON.stringify(command)])).rows[0].value);}
  else if(retirement){const command=SettlementAuthorityRetirementCommandSchema.parse(input);result=SettlementAuthorityRetiredReceiptSchema.parse((await db.query('SELECT bitpos.settlement090_beneficiary_authority_retired($1) value',[command.originalSessionId])).rows[0].value);}
  else if(prepare){const command=SettlementPrepareCommandSchema.parse(input);result=SettlementBatchDraftReceiptSchema.parse((await db.query('SELECT bitpos.settlement088_batch_prepare($1::jsonb) value',[JSON.stringify(command)])).rows[0].value);}
  else if(batch){const command=SettlementBatchCommandSchema.parse(input);result=SettlementBatchReceiptSchema.parse((await db.query('SELECT bitpos.settlement088_batch_command($1,$2::jsonb) value',[uuid.parse(batch[1]),JSON.stringify(command)])).rows[0].value);}
  await db.query('COMMIT');return result;
 }catch(error){await db.query('ROLLBACK');boundary(error);}finally{db.release();}
}
