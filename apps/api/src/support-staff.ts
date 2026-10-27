import {createHash} from 'node:crypto';
import {z} from 'zod';
import {pool} from './db';
import {mobilePrincipal} from './mobile-auth';
import {RequestError,fail} from './authority';
import {MobileSupportStaffCommandSchema,MobileSupportStaffCasesSchema,MobileSupportStaffCaseSchema,MobileSupportStaffDetailSchema} from '../../../packages/contracts/src/mobile-v1.generated';
export async function supportStaffRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const root='/api/mobile/v1/platform/support',collection=url.pathname===root,match=/^\/api\/mobile\/v1\/platform\/support\/([^/]+)$/.exec(url.pathname);if(!collection&&!match)return undefined;
 if(collection&&method!=='GET'||match&&!['GET','POST'].includes(method))fail('RESOURCE_NOT_FOUND',404);
 const uuid=z.string().uuid(),id=match?uuid.parse(match[1]):null;
 const allowed=method==='POST'?[]:collection?['queue','cursor','purpose']:['cursor','purpose'];if([...url.searchParams.keys()].some(k=>!allowed.includes(k)||url.searchParams.getAll(k).length!==1))fail('INVALID_REQUEST',422);
 const queue=collection?url.searchParams.get('queue'):null;if(collection&&queue!=='general'&&!uuid.safeParse(queue).success)fail('INVALID_REQUEST',422);
 const cursor=url.searchParams.has('cursor')?uuid.parse(url.searchParams.get('cursor')):null,purpose=method==='GET'?z.string().trim().min(1).max(300).parse(url.searchParams.get('purpose')):null;
 const command=method==='POST'?MobileSupportStaffCommandSchema.parse(input):null,actor=await mobilePrincipal(bearer),db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='3000ms';SET LOCAL lock_timeout='300ms'");
  await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true)",[actor.accountId,actor.sessionId,createHash('sha256').update(bearer!.slice(7)).digest('hex')]);
  if(!(await db.query("SELECT to_regclass('bitpos.mobile_support_staff_commands') n")).rows[0].n)fail('CONFIGURATION_REQUIRED',503);
  let result:unknown;
  if(collection)result=MobileSupportStaffCasesSchema.parse((await db.query('SELECT bitpos.support_staff_list($1,$2,$3) value',[queue==='general'?null:queue,cursor,purpose])).rows[0].value);
  else if(method==='GET')result=MobileSupportStaffDetailSchema.parse((await db.query('SELECT bitpos.support_staff_read($1,$2,$3) value',[id,cursor,purpose])).rows[0].value);
  else result=MobileSupportStaffCaseSchema.parse((await db.query('SELECT bitpos.support_staff_command($1,$2::jsonb) value',[id,JSON.stringify(command)])).rows[0].value);
  await db.query('COMMIT');return result;
 }catch(error){await db.query('ROLLBACK');if(error instanceof Error){const message=error.message,code=(error as {code?:string}).code;if(['AUTH_REQUIRED','ROLE_REQUIRED','RESOURCE_NOT_FOUND'].includes(message))throw new RequestError(message==='AUTH_REQUIRED'?401:message==='ROLE_REQUIRED'?403:404,message as 'AUTH_REQUIRED'|'ROLE_REQUIRED'|'RESOURCE_NOT_FOUND');if(['VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','SUPPORT_CASE_CLOSED'].includes(message))throw new RequestError(409,message==='SUPPORT_CASE_CLOSED'?'VERSION_CONFLICT':message as 'VERSION_CONFLICT'|'IDEMPOTENCY_CONFLICT');if(message==='INVALID_REQUEST')fail('INVALID_REQUEST',422);if(['55P03','57014','40001','40P01'].includes(code??''))throw new RequestError(409,'DISPATCH_AUTH_RETRY');}throw error;}finally{db.release();}
}
