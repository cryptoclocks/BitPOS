import {z} from 'zod';
import {createHash} from 'node:crypto';
import {fail} from './authority';
import {mobilePrincipal} from './mobile-auth';
import {withMobileDispatch} from './driver-platform';
import {FoodDiscoverySnapshotSchema,FoodDiscoveryConsentCommandSchema,FoodDiscoveryConsentReceiptSchema,FoodDiscoveryLocationCommandSchema,FoodDiscoveryLocationReceiptSchema,FoodDiscoveryServiceCommandSchema,FoodDiscoveryServiceReceiptSchema} from '../../../packages/contracts/src/mobile-v1.generated';
const uuid=z.string().uuid();
export async function foodDiscoveryRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const path=url.pathname,own=path==='/api/mobile/v1/driver/food/discovery',location=path==='/api/mobile/v1/driver/food/discovery/location',service=/^\/api\/mobile\/v1\/platform\/merchants\/([^/]+)\/branches\/([^/]+)\/drivers\/([^/]+)\/food-service$/.exec(path);
 if(!own&&!location&&!service)return undefined;
 if([...url.searchParams].length)fail('INVALID_REQUEST',422);
 if(!(own&&(method==='GET'||method==='PUT')||location&&method==='POST'||service&&method==='PUT'))fail('INVALID_REQUEST',405);
 const actor=await mobilePrincipal(bearer);
 return withMobileDispatch(actor,async db=>{
  await db.query("SET LOCAL statement_timeout='2000ms'");await db.query("SET LOCAL lock_timeout='200ms'");
  await db.query("SELECT set_config('bitpos.mobile_access_hash',$1,true)",[createHash('sha256').update(bearer!.slice(7)).digest('hex')]);
  if(own&&method==='GET')return FoodDiscoverySnapshotSchema.parse((await db.query('SELECT bitpos.food_discovery_own_snapshot() value')).rows[0].value);
  if(own){const data=FoodDiscoveryConsentCommandSchema.parse(input);bound(data.expectedVersion);return FoodDiscoveryConsentReceiptSchema.parse((await db.query('SELECT bitpos.food_discovery_consent($1::jsonb) value',[JSON.stringify(data)])).rows[0].value);}
  if(location){const data=FoodDiscoveryLocationCommandSchema.parse(input);bound(data.revision);bound(data.sequence);return FoodDiscoveryLocationReceiptSchema.parse((await db.query('SELECT bitpos.food_discovery_location($1,$2,$3,$4,$5,$6) value',[data.revision,data.sequence,data.capturedAt,data.latitudeE7,data.longitudeE7,data.accuracyMm])).rows[0].value);}
  const merchant=uuid.parse(service![1]),branch=uuid.parse(service![2]),driver=uuid.parse(service![3]),data=FoodDiscoveryServiceCommandSchema.parse(input);bound(data.expectedVersion);
  return FoodDiscoveryServiceReceiptSchema.parse((await db.query('SELECT bitpos.food_discovery_service_command($1,$2,$3,$4::jsonb) value',[driver,merchant,branch,JSON.stringify(data)])).rows[0].value);
 });
}
function bound(value:string){if(BigInt(value)>9223372036854775807n)fail('INVALID_REQUEST',422);}
