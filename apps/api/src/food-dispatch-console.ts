import {createHash} from 'node:crypto';
import {z} from 'zod';
import {mobilePrincipal} from './mobile-auth';
import {withMobileDispatch} from './driver-platform';
import {fail} from './authority';
import {FoodDispatchConsolePageSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {FoodBatchCandidatesSchema,FoodBatchDraftCommandSchema,FoodBatchDraftReceiptSchema} from '../../../packages/contracts/src/food-batch-candidates';
export async function foodDispatchConsoleRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const draft=/^\/api\/mobile\/v1\/platform\/merchants\/([^/]+)\/branches\/([^/]+)\/food-batch-drafts$/.exec(url.pathname);
 if(draft){
  if(method!=='POST')fail('INVALID_REQUEST',405);if(url.search)fail('INVALID_REQUEST',422);
  const merchant=z.string().uuid().parse(draft[1]),branch=z.string().uuid().parse(draft[2]),data=FoodBatchDraftCommandSchema.parse(input),actor=await mobilePrincipal(bearer);
  return withMobileDispatch(actor,async db=>{
   await db.query("SET LOCAL statement_timeout='2000ms'; SET LOCAL lock_timeout='200ms'");await db.query("SELECT set_config('bitpos.mobile_access_hash',$1,true)",[createHash('sha256').update(bearer!.slice(7)).digest('hex')]);
   return FoodBatchDraftReceiptSchema.parse((await db.query('SELECT bitpos.food_batch_create_draft($1,$2,$3::jsonb) value',[merchant,branch,JSON.stringify(data)])).rows[0].value);
  });
 }
 const batch=/^\/api\/mobile\/v1\/platform\/merchants\/([^/]+)\/branches\/([^/]+)\/food-batch-candidates\/([^/]+)$/.exec(url.pathname);
 if(batch){
  if(method!=='GET')fail('INVALID_REQUEST',405);if(url.search)fail('INVALID_REQUEST',422);
  const merchant=z.string().uuid().parse(batch[1]),branch=z.string().uuid().parse(batch[2]),anchor=z.string().uuid().parse(batch[3]),actor=await mobilePrincipal(bearer);
  return withMobileDispatch(actor,async db=>{
   await db.query("SET LOCAL statement_timeout='2000ms'; SET LOCAL lock_timeout='200ms'");await db.query("SELECT set_config('bitpos.mobile_access_hash',$1,true)",[createHash('sha256').update(bearer!.slice(7)).digest('hex')]);
   return FoodBatchCandidatesSchema.parse((await db.query('SELECT bitpos.food_batch_candidates($1,$2,$3) value',[merchant,branch,anchor])).rows[0].value);
  });
 }
 const match=/^\/api\/mobile\/v1\/platform\/merchants\/([^/]+)\/branches\/([^/]+)\/food-dispatch$/.exec(url.pathname);if(!match)return undefined;
 if(method!=='GET')fail('INVALID_REQUEST',405);const keys=[...url.searchParams.keys()];if(keys.length>1||keys.some(key=>key!=='afterId'))fail('INVALID_REQUEST',422);
 const merchant=z.string().uuid().parse(match[1]),branch=z.string().uuid().parse(match[2]),after=url.searchParams.has('afterId')?z.string().uuid().parse(url.searchParams.get('afterId')):null,actor=await mobilePrincipal(bearer);
 return withMobileDispatch(actor,async db=>{
  await db.query("SET LOCAL statement_timeout='2000ms'; SET LOCAL lock_timeout='200ms'");await db.query("SELECT set_config('bitpos.mobile_access_hash',$1,true)",[createHash('sha256').update(bearer!.slice(7)).digest('hex')]);
  return FoodDispatchConsolePageSchema.parse((await db.query('SELECT bitpos.food_dispatch_console_queue($1,$2,$3) value',[merchant,branch,after])).rows[0].value);
 });
}
