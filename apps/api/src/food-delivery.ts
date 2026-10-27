import type pg from 'pg';
import {z} from 'zod';
import {fail} from './authority';
import {MobileConfiguredFoodSnapshotSchema,type MobileConfiguredFoodSnapshot,type MobileDeliverySelection} from '../../../packages/contracts/src/mobile-v1.generated';
import {MobileFoodDeliverySnapshotSchema} from '../../../packages/contracts/src/mobile-v1.generated';
const minor=z.string().regex(/^(0|[1-9][0-9]{0,17})$/);
export type DeliverySelection=MobileDeliverySelection;
const SnapshotSchema=z.object({merchant_id:z.string().uuid(),quote_id:z.string().uuid(),branch_id:z.string().uuid(),account_id:z.string().uuid(),address_id:z.string().uuid(),address_version:z.string(),policy_version_id:z.string().uuid(),zone_version_id:z.null(),recipient_name:z.string(),phone:z.string(),address_text:z.string(),instructions:z.string(),origin_latitude_e7:z.number().int(),origin_longitude_e7:z.number().int(),latitude_e7:z.number().int(),longitude_e7:z.number().int(),currency:z.enum(['USD','USDG']),decimals:z.number().int(),delivery_minor:minor,service_minor:minor,merchant_minor:minor,driver_minor:minor,platform_minor:minor,fixture:z.boolean()}).strict();
export type DeliverySnapshot=z.infer<typeof SnapshotSchema>;
export async function captureDeliverySnapshot(db:pg.PoolClient,merchant:string,branch:string,account:string,quote:string,selection:DeliverySelection,priceVersion:string){
 if(BigInt(selection.addressVersion)>9223372036854775807n)fail('INVALID_REQUEST',422);
 const row=(await db.query('SELECT bitpos.delivery_quote_destination($1,$2,$3,$4,$5,$6,$7,$8) AS snapshot',[merchant,branch,account,quote,selection.addressId,selection.addressVersion,selection.policyVersionId,priceVersion])).rows[0]?.snapshot;
 if(!row)fail('SERVING_UNAVAILABLE',409);
 return SnapshotSchema.parse(row);
}
export function deliveryConfiguredSnapshot(food:MobileConfiguredFoodSnapshot,delivery:DeliverySnapshot):MobileConfiguredFoodSnapshot{
 if(food.total.currency!==delivery.currency||food.total.decimals!==delivery.decimals)fail('INVALID_CURRENCY',422);
 const fees=BigInt(delivery.delivery_minor)+BigInt(delivery.service_minor),total=BigInt(food.total.amountMinor)+fees;
 if(total>999999999999999999n)fail('INVALID_PRICE',422);
 return MobileConfiguredFoodSnapshotSchema.parse({...food,fees:{...food.total,amountMinor:String(fees)},total:{...food.total,amountMinor:String(total)}});
}
export async function deliveryRequestHash(db:pg.PoolClient,account:string,branch:string,items:unknown,delivery:DeliverySnapshot){
 return (await db.query<{digest:string}>('SELECT bitpos.draft067_delivery_request_hash($1,$2,$3::jsonb,jsonb_populate_record(NULL::bitpos.quote_delivery_snapshots,$4::jsonb)) AS digest',[account,branch,JSON.stringify(items),JSON.stringify(delivery)])).rows[0].digest;
}
export async function freezeDeliverySnapshot(db:pg.PoolClient,snapshot:DeliverySnapshot){
 await db.query('INSERT INTO quote_delivery_snapshots SELECT (jsonb_populate_record(NULL::bitpos.quote_delivery_snapshots,$1::jsonb)).*',[JSON.stringify(snapshot)]);
}
export async function deliverySnapshot(db:pg.PoolClient,merchant:string,quote:string){
 const row=(await db.query('SELECT to_jsonb(d)||jsonb_build_object(\'address_version\',d.address_version::text,\'delivery_minor\',d.delivery_minor::text,\'service_minor\',d.service_minor::text,\'merchant_minor\',d.merchant_minor::text,\'driver_minor\',d.driver_minor::text,\'platform_minor\',d.platform_minor::text) AS snapshot FROM quote_delivery_snapshots d WHERE merchant_id=$1 AND quote_id=$2',[merchant,quote])).rows[0];
 return row?SnapshotSchema.parse(row.snapshot):null;
}
export function deliveryProjection(snapshot:DeliverySnapshot|null){
 if(!snapshot)return null;
 const money=(amountMinor:string)=>({currency:snapshot.currency,decimals:snapshot.decimals,amountMinor});
 return MobileFoodDeliverySnapshotSchema.parse({addressId:snapshot.address_id,addressVersion:snapshot.address_version,policyVersionId:snapshot.policy_version_id,recipientName:snapshot.recipient_name,phone:snapshot.phone,addressText:snapshot.address_text,instructions:snapshot.instructions,latitudeE7:snapshot.latitude_e7,longitudeE7:snapshot.longitude_e7,deliveryFee:money(snapshot.delivery_minor),serviceFee:money(snapshot.service_minor),fixture:snapshot.fixture});
}
