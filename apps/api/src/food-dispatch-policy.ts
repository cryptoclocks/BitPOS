import {createHash} from 'node:crypto';
import {z} from 'zod';
import {mobilePrincipal} from './mobile-auth';
import {withMobileDispatch} from './driver-platform';
import {fail} from './authority';
import {FoodDispatchPolicyCommandSchema,FoodDispatchPolicySnapshotSchema,FoodDispatchPolicyReceiptSchema} from '../../../packages/contracts/src/mobile-v1.generated';
export async function foodDispatchPolicyRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const match=/^\/api\/mobile\/v1\/platform\/merchants\/([^/]+)\/branches\/([^/]+)\/food-dispatch-policy$/.exec(url.pathname);if(!match)return undefined;
 if([...url.searchParams].length)fail('INVALID_REQUEST',422);if(method!=='GET'&&method!=='PUT')fail('INVALID_REQUEST',405);
 const merchant=z.string().uuid().parse(match[1]),branch=z.string().uuid().parse(match[2]),actor=await mobilePrincipal(bearer);
 return withMobileDispatch(actor,async db=>{
  await db.query("SET LOCAL statement_timeout='2000ms'; SET LOCAL lock_timeout='200ms'");await db.query("SELECT set_config('bitpos.mobile_access_hash',$1,true)",[createHash('sha256').update(bearer!.slice(7)).digest('hex')]);
  if(method==='GET')return FoodDispatchPolicySnapshotSchema.parse((await db.query('SELECT bitpos.food_dispatch_policy_snapshot($1,$2) value',[merchant,branch])).rows[0].value);
  const data=FoodDispatchPolicyCommandSchema.parse(input);if(BigInt(data.expectedVersion)>9223372036854775807n||data.overallSeconds<data.cycleSeconds)fail('INVALID_REQUEST',422);
  return FoodDispatchPolicyReceiptSchema.parse((await db.query('SELECT bitpos.food_dispatch_policy_command($1,$2,$3::jsonb) value',[merchant,branch,JSON.stringify(data)])).rows[0].value);
 });
}
