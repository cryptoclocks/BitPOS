import {createHash} from 'node:crypto';
import {z} from 'zod';
import {pool} from './db';
import {mobilePrincipal} from './mobile-auth';
import {fail} from './authority';
const uuid=z.string().uuid();
export const supportCreateSchema=z.object({commandId:uuid,subject:z.string().trim().min(1).max(160),message:z.string().trim().min(1).max(4000),order:z.object({merchantId:uuid,orderId:uuid}).strict().nullable()}).strict();
export const supportMessageSchema=z.object({commandId:uuid,message:z.string().trim().min(1).max(4000)}).strict();
function pageCursor(url:URL){if([...url.searchParams.keys()].some(k=>k!=='cursor')||url.searchParams.getAll('cursor').length>1)fail('INVALID_REQUEST',422);const value=url.searchParams.get('cursor');if(value!==null&&!uuid.safeParse(value).success)fail('INVALID_REQUEST',422);return value;}
const caseProjection=(r:any)=>({id:r.id,subject:r.subject,state:r.state,createdAt:r.created_at.toISOString(),order:r.order_id?{merchantId:r.merchant_id,orderId:r.order_id}:null});
const messageProjection=(r:any)=>({id:r.id,body:r.body,authorKind:r.author_kind,createdAt:r.created_at.toISOString()});
export async function mobileSupportRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const root='/api/mobile/v1/account/support',collection=url.pathname===root,detail=/^\/api\/mobile\/v1\/account\/support\/([^/]+)$/.exec(url.pathname),match=/^\/api\/mobile\/v1\/account\/support\/([^/]+)\/messages$/.exec(url.pathname);
 if(!collection&&!match&&!detail)return undefined;
 if(!['GET','POST'].includes(method)||detail&&method!=='GET')fail('RESOURCE_NOT_FOUND',404);
 const caseId=match?uuid.parse(match[1]):detail?uuid.parse(detail[1]):null,cursor=method==='GET'?pageCursor(url):null;
 if(method==='POST'&&url.search)fail('INVALID_REQUEST',422);
 const actor=await mobilePrincipal(bearer),db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SELECT set_config('bitpos.mobile_account',$1,true)",[actor.accountId]);
  if(!(await db.query("SELECT to_regclass('bitpos.mobile_support_cases') ready")).rows[0].ready)fail('CONFIGURATION_REQUIRED',503);
  if(method==='GET'){
   if(detail){if(url.search)fail('INVALID_REQUEST',422);const row=(await db.query('SELECT * FROM mobile_support_cases WHERE account_id=$1 AND id=$2',[actor.accountId,caseId])).rows[0];if(!row)fail('RESOURCE_NOT_FOUND',404);await db.query('COMMIT');return caseProjection(row);}
   if(caseId&&!(await db.query('SELECT 1 FROM mobile_support_cases WHERE account_id=$1 AND id=$2',[actor.accountId,caseId])).rowCount)fail('RESOURCE_NOT_FOUND',404);
   const table=caseId?'mobile_support_messages':'mobile_support_cases';
   let after:Date|null=null;
   if(cursor){const row=(await db.query(`SELECT created_at FROM ${table} WHERE account_id=$1 AND id=$2${caseId?' AND case_id=$3':''}`,caseId?[actor.accountId,cursor,caseId]:[actor.accountId,cursor])).rows[0];if(!row)fail('RESOURCE_NOT_FOUND',404);after=row.created_at;}
   const rows=(await db.query(`SELECT * FROM ${table} WHERE account_id=$1 AND ($2::uuid IS NULL OR (created_at,id)>($3::timestamptz,$2::uuid))${caseId?' AND case_id=$4':''} ORDER BY created_at,id LIMIT 51`,caseId?[actor.accountId,cursor,after,caseId]:[actor.accountId,cursor,after])).rows;
   await db.query('COMMIT');return {items:rows.slice(0,50).map(row=>caseId?messageProjection(row):caseProjection(row)),nextCursor:rows.length>50?rows[49].id:null};
  }
  await db.query('SELECT id FROM mobile_accounts WHERE id=$1 FOR UPDATE',[actor.accountId]);
  const current=await mobilePrincipal(bearer,db);if(current.sessionId!==actor.sessionId)fail('AUTH_REQUIRED',401);
  if(collection){
   const c=supportCreateSchema.parse(input),hash=createHash('sha256').update(JSON.stringify({subject:c.subject,message:c.message,order:c.order})).digest('hex');
   const prior=(await db.query('SELECT * FROM mobile_support_cases WHERE account_id=$1 AND command_id=$2',[actor.accountId,c.commandId])).rows[0];
   if(prior){if(prior.request_hash!==hash)fail('INVALID_REQUEST',409);await db.query('COMMIT');return caseProjection(prior);}
   if(c.order)await db.query("SELECT set_config('bitpos.merchant',$1,true)",[c.order.merchantId]);
   if(c.order&&!(await db.query('SELECT 1 FROM online_food_orders WHERE account_id=$1 AND merchant_id=$2 AND order_id=$3',[actor.accountId,c.order.merchantId,c.order.orderId])).rowCount)fail('RESOURCE_NOT_FOUND',404);
   if(Number((await db.query("SELECT count(*)::int n FROM mobile_support_cases WHERE account_id=$1 AND created_at>now()-interval '24 hours'",[actor.accountId])).rows[0].n)>=20)fail('PROVIDER_RATE_LIMITED',429);
   const row=(await db.query('INSERT INTO mobile_support_cases(account_id,command_id,request_hash,subject,merchant_id,order_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[actor.accountId,c.commandId,hash,c.subject,c.order?.merchantId??null,c.order?.orderId??null])).rows[0];
   await db.query('INSERT INTO mobile_support_messages(account_id,case_id,command_id,body) VALUES($1,$2,$3,$4)',[actor.accountId,row.id,c.commandId,c.message]);await db.query('COMMIT');return caseProjection(row);
  }
  const c=supportMessageSchema.parse(input),ticket=(await db.query('SELECT state FROM mobile_support_cases WHERE account_id=$1 AND id=$2',[actor.accountId,caseId])).rows[0];if(!ticket)fail('RESOURCE_NOT_FOUND',404);
  const prior=(await db.query('SELECT * FROM mobile_support_messages WHERE account_id=$1 AND case_id=$2 AND command_id=$3',[actor.accountId,caseId,c.commandId])).rows[0];
  if(prior){if(prior.body!==c.message)fail('INVALID_REQUEST',409);await db.query('COMMIT');return messageProjection(prior);}
  if(ticket.state==='RESOLVED')fail('INVALID_REQUEST',409);
  if(Number((await db.query('SELECT count(*)::int n FROM mobile_support_messages WHERE account_id=$1 AND case_id=$2',[actor.accountId,caseId])).rows[0].n)>=500)fail('INVALID_REQUEST',422);
  const row=(await db.query('INSERT INTO mobile_support_messages(account_id,case_id,command_id,body) VALUES($1,$2,$3,$4) RETURNING *',[actor.accountId,caseId,c.commandId,c.message])).rows[0];await db.query('COMMIT');return messageProjection(row);
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
