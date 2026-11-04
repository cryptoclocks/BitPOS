import {createHash} from 'node:crypto';
import {z} from 'zod';
import {pool} from './db';
import {mobilePrincipal} from './mobile-auth';
import {RequestError,fail} from './authority';

// Platform staff answer shop requests. Authority is the existing per-merchant scope check inside the SQL functions (migration 195); this file only authenticates the
// staff mobile session, validates the wire shape and maps database refusals to typed errors. List needs a merchant id (the "queue"), a stated purpose is mandatory.
const uuid=z.string().uuid();
const purposeOf=(url:URL)=>z.string().trim().min(1).max(300).parse(url.searchParams.get('purpose'));
const commandBody=z.object({commandId:uuid,expectedVersion:z.string().regex(/^[1-9][0-9]{0,17}$/),action:z.enum(['REPLY','RESOLVE','REOPEN']),message:z.string().max(4000),reason:z.string().trim().min(1).max(300)}).strict();
export async function shopSupportStaffRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const root='/api/mobile/v1/platform/merchant-support',collection=url.pathname===root,match=/^\/api\/mobile\/v1\/platform\/merchant-support\/([^/]+)$/.exec(url.pathname);
 if(!collection&&!match)return undefined;
 if(collection&&method!=='GET'||match&&!['GET','POST'].includes(method))fail('RESOURCE_NOT_FOUND',404);
 const allowed=method==='POST'?[]:collection?['queue','purpose']:['purpose'];
 if([...url.searchParams.keys()].some(k=>!allowed.includes(k)||url.searchParams.getAll(k).length!==1))fail('INVALID_REQUEST',422);
 let args:unknown[],sql:string;
 try{
  if(collection){args=[uuid.parse(url.searchParams.get('queue')),purposeOf(url)];sql='SELECT bitpos.merchant_support_staff_list($1,$2) value';}
  else if(method==='GET'){args=[uuid.parse(match![1]),purposeOf(url)];sql='SELECT bitpos.merchant_support_staff_read($1,$2) value';}
  else{args=[uuid.parse(match![1]),JSON.stringify(commandBody.parse(input))];sql='SELECT bitpos.merchant_support_staff_command($1,$2::jsonb) value';}
 }catch{fail('INVALID_REQUEST',422);}
 const actor=await mobilePrincipal(bearer),db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='3000ms';SET LOCAL lock_timeout='300ms'");
  await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true)",[actor.accountId,actor.sessionId,createHash('sha256').update(bearer!.slice(7)).digest('hex')]);
  if(!(await db.query("SELECT to_regclass('bitpos.merchant_support_cases') n")).rows[0].n)fail('CONFIGURATION_REQUIRED',503);
  const value=(await db.query(sql,args)).rows[0].value;
  await db.query('COMMIT');return value;
 }catch(error){
  await db.query('ROLLBACK');
  const message=error instanceof Error?error.message:'',code=(error as {code?:string}).code;
  const typed:Record<string,number>={AUTH_REQUIRED:401,ROLE_REQUIRED:403,RESOURCE_NOT_FOUND:404,INVALID_REQUEST:422,VERSION_CONFLICT:409,SUPPORT_CASE_CLOSED:409,DISPATCH_AUTH_RETRY:409};
  if(message in typed)throw new RequestError(typed[message]!,message as never,message);
  if(code==='40001')throw new RequestError(409,'DISPATCH_AUTH_RETRY','DISPATCH_AUTH_RETRY');
  throw error;
 }finally{db.release();}
}
