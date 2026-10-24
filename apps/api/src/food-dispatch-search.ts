import {createHash} from 'node:crypto';
import {z} from 'zod';
import {mobilePrincipal} from './mobile-auth';
import {withMobileDispatch} from './driver-platform';
import {fail} from './authority';
import {FoodDispatchSearchCommandSchema,FoodDispatchSearchSnapshotSchema,FoodDispatchSearchSchema} from '../../../packages/contracts/src/mobile-v1.generated';
export async function foodDispatchSearchRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const match=/^\/api\/mobile\/v1\/platform\/food\/shipments\/([^/]+)\/search$/.exec(url.pathname);if(!match)return undefined;
 if([...url.searchParams].length)fail('INVALID_REQUEST',422);if(method!=='GET'&&method!=='PUT')fail('INVALID_REQUEST',405);
 const shipment=z.string().uuid().parse(match[1]),actor=await mobilePrincipal(bearer);
 return withMobileDispatch(actor,async db=>{
  await db.query("SET LOCAL statement_timeout='2000ms'; SET LOCAL lock_timeout='200ms'");await db.query("SELECT set_config('bitpos.mobile_access_hash',$1,true)",[createHash('sha256').update(bearer!.slice(7)).digest('hex')]);
  if(method==='GET')return FoodDispatchSearchSnapshotSchema.parse((await db.query('SELECT bitpos.food_dispatch_search_snapshot($1) value',[shipment])).rows[0].value);
  const data=FoodDispatchSearchCommandSchema.parse(input);if(BigInt(data.expectedVersion)>9223372036854775807n)fail('INVALID_REQUEST',422);
  return FoodDispatchSearchSchema.parse((await db.query('SELECT bitpos.food_dispatch_search_command($1,$2::jsonb) value',[shipment,JSON.stringify(data)])).rows[0].value);
 });
}
