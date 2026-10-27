import type pg from'pg';import{createHash}from'node:crypto';import{z}from'zod';
import{mobilePrincipal}from'./mobile-auth';import{withMobileDispatch}from'./driver-platform';import{fail}from'./authority';
import{prepareFoodReturnCandidate,recordFoodReturnCandidate,resolveFoodReturnCandidate,readFoodReturnCandidate,decideFoodReturnFinancialCandidate,readFoodReturnFinancialCandidate,readFoodReturnExecutionCandidate,readMerchantRefundExecutionCandidate,reconcileRefundPaymentsCandidate,approveFoodCompensationCandidate,readFoodCompensationCandidate,publishFoodCompensationCandidate,retireFoodCompensationCandidate,readFoodCompensationExecutionCandidate,readDriverCompensationCandidate}from'./food-return-candidate';
import{FoodCustomerRefundExecutionSchema,FoodReturnRequestCommandSchema,FoodReturnReceiveCommandSchema,FoodReturnResolveCommandSchema,FoodReturnStageReceiptSchema,FoodReturnResolutionReceiptSchema,FoodReturnSnapshotSchema}from'../../../packages/contracts/src/mobile-v1.generated';
const uuid=z.string().uuid();
// Explicit admission: candidate migration stays uninstalled by normal fixture.
// This switch is required for isolated integration, never inferred from SQL files.
function admitted(){if(process.env.BITPOS_FOOD_RETURNS_ENABLED!=='1')fail('CONFIGURATION_REQUIRED',503);}
export async function foodReturnRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const driver=/^\/api\/mobile\/v1\/driver\/food\/assignments\/([^/]+)\/compensation$/.exec(url.pathname);
 if(driver){
  if(url.search)fail('INVALID_REQUEST',422);if(method!=='GET')fail('INVALID_REQUEST',405);const id=uuid.parse(driver[1]),actor=await mobilePrincipal(bearer);admitted();
  if(process.env.BITPOS_FOOD_COMPENSATION_ENABLED!=='1'||process.env.BITPOS_FOOD_COMPENSATION_READ_ENABLED!=='1')fail('CONFIGURATION_REQUIRED',503);
  return withMobileDispatch(actor,async db=>{await db.query("SET LOCAL statement_timeout='2000ms';SET LOCAL lock_timeout='200ms'");await db.query("SELECT set_config('bitpos.mobile_access_hash',$1,true)",[createHash('sha256').update(bearer!.slice(7)).digest('hex')]);return readDriverCompensationCandidate(db,id);});
 }
 const customer=/^\/api\/mobile\/v1\/food\/orders\/([^/]+)\/refund-execution$/.exec(url.pathname);
 if(customer){
  if(url.search)fail('INVALID_REQUEST',422);if(method!=='GET')fail('INVALID_REQUEST',405);
  const id=uuid.parse(customer[1]),actor=await mobilePrincipal(bearer);admitted();
  if(process.env.BITPOS_FOOD_REFUND_EXECUTION_READ_ENABLED!=='1')fail('CONFIGURATION_REQUIRED',503);
  return withMobileDispatch(actor,async db=>{await db.query("SET LOCAL statement_timeout='2000ms';SET LOCAL lock_timeout='200ms'");await db.query("SELECT set_config('bitpos.mobile_access_hash',$1,true)",[createHash('sha256').update(bearer!.slice(7)).digest('hex')]);const value=FoodCustomerRefundExecutionSchema.parse((await db.query('SELECT bitpos.food_refund117_customer($1) value',[id])).rows[0].value);if(value.orderId!==id)throw Error('Refund order identity mismatch');return value;});
 }
 const match=/^\/api\/mobile\/v1\/platform\/food\/(?:assignments\/([^/]+)\/(return)|returns\/([^/]+)\/(resolve|financial-review|execution|reconcile-payments|compensation|compensation-policy|compensation-policy-retire|compensation-execution))$/.exec(url.pathname);if(!match)return undefined;
 if(url.search)fail('INVALID_REQUEST',422);const allowedMethods=['execution','compensation-execution'].includes(match[4])?['GET']:match[2]||['financial-review','compensation'].includes(match[4])?['GET','POST']:['POST'];if(!allowedMethods.includes(method))fail('INVALID_REQUEST',405);
 const id=uuid.parse(match[1]??match[3]);const actor=await mobilePrincipal(bearer);admitted();if(['financial-review','execution','reconcile-payments','compensation','compensation-policy','compensation-policy-retire','compensation-execution'].includes(match[4])&&process.env.BITPOS_FOOD_RETURN_FINANCE_ENABLED!=='1')fail('CONFIGURATION_REQUIRED',503);
 if(match[4]==='execution'&&process.env.BITPOS_FOOD_REFUND_EXECUTION_READ_ENABLED!=='1')fail('CONFIGURATION_REQUIRED',503);
 if(['compensation','compensation-policy','compensation-policy-retire','compensation-execution'].includes(match[4])&&process.env.BITPOS_FOOD_COMPENSATION_ENABLED!=='1')fail('CONFIGURATION_REQUIRED',503);
 if(match[4]==='reconcile-payments'&&process.env.BITPOS_FOOD_REFUND_RECONCILE_ENABLED!=='1')fail('CONFIGURATION_REQUIRED',503);
 if(['compensation-policy','compensation-policy-retire'].includes(match[4])&&process.env.BITPOS_FOOD_COMPENSATION_POLICY_ENABLED!=='1')fail('CONFIGURATION_REQUIRED',503);
 if(match[4]==='compensation-policy-retire'&&process.env.BITPOS_FOOD_COMPENSATION_RETIRE_ENABLED!=='1')fail('CONFIGURATION_REQUIRED',503);
 if(match[4]==='compensation-execution'&&process.env.BITPOS_FOOD_COMPENSATION_READ_ENABLED!=='1')fail('CONFIGURATION_REQUIRED',503);
 return withMobileDispatch(actor,async db=>{
  await db.query("SET LOCAL statement_timeout='2000ms'; SET LOCAL lock_timeout='200ms'");await db.query("SELECT set_config('bitpos.mobile_access_hash',$1,true)",[createHash('sha256').update(bearer!.slice(7)).digest('hex')]);
  if(match[4]==='compensation-execution')return readFoodCompensationExecutionCandidate(db,id);
  if(match[4]==='compensation-policy-retire')return retireFoodCompensationCandidate(db,id,input);
  if(match[4]==='compensation-policy')return publishFoodCompensationCandidate(db,id,input);
  if(match[4]==='compensation')return method==='GET'?readFoodCompensationCandidate(db,id):approveFoodCompensationCandidate(db,id,input);
  if(match[4]==='reconcile-payments')return reconcileRefundPaymentsCandidate(db,id,input);
  if(match[4]==='execution')return readFoodReturnExecutionCandidate(db,id);
  if(match[4]==='financial-review')return method==='GET'?readFoodReturnFinancialCandidate(db,id):decideFoodReturnFinancialCandidate(db,id,input);
  if(match[2]){
   if(method==='GET')return FoodReturnSnapshotSchema.parse(await readFoodReturnCandidate(db,id));
   return FoodReturnStageReceiptSchema.parse(await prepareFoodReturnCandidate(db,id,FoodReturnRequestCommandSchema.parse(input)));
  }
  return FoodReturnResolutionReceiptSchema.parse(await resolveFoodReturnCandidate(db,id,FoodReturnResolveCommandSchema.parse(input)));
 });
}
export async function merchantFoodReturnRequest(db:pg.PoolClient,url:URL,method:string,input:unknown,role:string,sessionHash:string){
 const execution=/^\/api\/food\/orders\/([^/]+)\/refund-execution$/.exec(url.pathname);
 if(execution){
  if(url.search)fail('INVALID_REQUEST',422);if(method!=='GET')fail('INVALID_REQUEST',405);if(!['owner','manager'].includes(role))fail('ROLE_REQUIRED',403);admitted();
  if(process.env.BITPOS_FOOD_REFUND_EXECUTION_READ_ENABLED!=='1')fail('CONFIGURATION_REQUIRED',503);
  return readMerchantRefundExecutionCandidate(db,uuid.parse(execution[1]),sessionHash);
 }
 const match=/^\/api\/food\/(?:assignments\/([^/]+)\/(return)|returns\/([^/]+)\/(receive))$/.exec(url.pathname);if(!match)return undefined;
 if(url.search)fail('INVALID_REQUEST',422);if(match[2]?method!=='GET':method!=='POST')fail('INVALID_REQUEST',405);
 if(!['owner','manager'].includes(role))fail('ROLE_REQUIRED',403);const id=uuid.parse(match[1]??match[3]);admitted();
 if(match[2])return FoodReturnSnapshotSchema.parse(await readFoodReturnCandidate(db,id,sessionHash));
 return FoodReturnStageReceiptSchema.parse(await recordFoodReturnCandidate(db,id,sessionHash,FoodReturnReceiveCommandSchema.parse(input)));
}
