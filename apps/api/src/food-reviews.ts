import {createHash}from'node:crypto';import {z}from'zod';import {pool}from'./db';import {mobilePrincipal}from'./mobile-auth';import {RequestError,fail}from'./authority';
import {MobileFoodReviewSnapshotSchema,MobileFoodReviewSchema,MobileFoodReviewCommandSchema,MobileBranchReviewsSchema,MobileFoodReviewQueueSchema,MobileFoodReviewModerationSchema}from'../../../packages/contracts/src/mobile-v1.generated';
export async function foodReviewsRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const own=/^\/api\/mobile\/v1\/orders\/([^/]+)\/review$/.exec(url.pathname),pub=/^\/api\/mobile\/v1\/branches\/([^/]+)\/reviews$/.exec(url.pathname),queue=/^\/api\/mobile\/v1\/platform\/merchants\/([^/]+)\/reviews$/.exec(url.pathname),mod=/^\/api\/mobile\/v1\/platform\/reviews\/([^/]+)$/.exec(url.pathname);
 if(!own&&!pub&&!queue&&!mod)return undefined;
 if(own&&!['GET','POST'].includes(method)||(pub||queue)&&method!=='GET'||mod&&method!=='POST')fail('RESOURCE_NOT_FOUND',404);
 const uuid=z.string().uuid(),target=uuid.parse((own??pub??queue??mod)![1]),keys=[...url.searchParams.keys()],allowed=method==='GET'&&(pub||queue)?queue?['cursor','purpose']:['cursor']:[];
 if(keys.some(k=>!allowed.includes(k)||url.searchParams.getAll(k).length!==1))fail('INVALID_REQUEST',422);
 const cursor=url.searchParams.has('cursor')?uuid.parse(url.searchParams.get('cursor')):null,purpose=queue?z.string().trim().min(1).max(300).parse(url.searchParams.get('purpose')):null,actor=pub?null:await mobilePrincipal(bearer),db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='3000ms';SET LOCAL lock_timeout='300ms'");
  if(!(await db.query("SELECT to_regclass('bitpos.mobile_food_reviews') n")).rows[0].n)fail('CONFIGURATION_REQUIRED',503);
  if(actor)await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true)",[actor.accountId,actor.sessionId,createHash('sha256').update(bearer!.slice(7)).digest('hex')]);
  let result:unknown;
  if(pub)result=MobileBranchReviewsSchema.parse((await db.query('SELECT bitpos.food_review_public($1,$2)value',[target,cursor])).rows[0].value);
  else if(queue)result=MobileFoodReviewQueueSchema.parse((await db.query('SELECT bitpos.food_review_queue($1,$2,$3)value',[target,cursor,purpose])).rows[0].value);
  else if(mod)result=MobileFoodReviewSchema.parse((await db.query('SELECT bitpos.food_review_moderate($1,$2::jsonb)value',[target,JSON.stringify(MobileFoodReviewModerationSchema.parse(input))])).rows[0].value);
  else if(method==='GET')result=MobileFoodReviewSnapshotSchema.parse((await db.query('SELECT bitpos.food_review_snapshot($1)value',[target])).rows[0].value);
  else result=MobileFoodReviewSchema.parse((await db.query('SELECT bitpos.food_review_command($1,$2::jsonb)value',[target,JSON.stringify(MobileFoodReviewCommandSchema.parse(input))])).rows[0].value);
  await db.query('COMMIT');return result;
 }catch(error){await db.query('ROLLBACK');if(error instanceof Error){const msg=error.message,code=(error as {code?:string}).code;if(msg==='AUTH_REQUIRED')throw new RequestError(401,'AUTH_REQUIRED');if(msg==='ROLE_REQUIRED')throw new RequestError(403,'ROLE_REQUIRED');if(msg==='RESOURCE_NOT_FOUND')throw new RequestError(404,'RESOURCE_NOT_FOUND');if(msg==='INVALID_REQUEST')fail('INVALID_REQUEST',422);if(msg==='REVIEW_NOT_ELIGIBLE')throw new RequestError(409,'VERSION_CONFLICT','Review requires a paid and completed owned order');if(['VERSION_CONFLICT','IDEMPOTENCY_CONFLICT'].includes(msg))throw new RequestError(409,msg as 'VERSION_CONFLICT'|'IDEMPOTENCY_CONFLICT');if(['55P03','57014','40001','40P01'].includes(code??''))throw new RequestError(409,'DISPATCH_AUTH_RETRY');}throw error;}finally{db.release();}
}
