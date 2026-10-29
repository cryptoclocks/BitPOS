import type pg from 'pg';
import {MobileConfiguredCartItemSchema,MobileConfiguredFoodSnapshotSchema,type MobileConfiguredCartItem,type MobileConfiguredFoodSnapshot} from '../../../packages/contracts/src/mobile-v1.generated';
import type {EffectiveLine} from '../../../packages/contracts/src/index';
import {aggregateConfiguredCart,configuredLines,productOptionsFor} from './online-options';
import {fail} from './authority';
import {deliveryConfiguredSnapshot,deliverySnapshot} from './food-delivery';

export function configuredItems(input:unknown):MobileConfiguredCartItem[]{
 const items=MobileConfiguredCartItemSchema.array().min(1).max(50).parse(input);
 aggregateConfiguredCart(items);
 return items.sort((a,b)=>a.lineId.localeCompare(b.lineId)).map(i=>({...i,selections:[...i.selections].sort((a,b)=>a.groupId.localeCompare(b.groupId)||a.choiceId.localeCompare(b.choiceId))}));
}
export async function configuredSnapshot(db:pg.PoolClient,merchant:string,items:readonly MobileConfiguredCartItem[],products:readonly EffectiveLine[]):Promise<MobileConfiguredFoodSnapshot>{
 const options=await productOptionsFor(db,merchant,products.map(p=>p.productId));
 const lines=configuredLines(items,products,options),denomination=lines[0].unitPrice;
 const money=(amount:bigint)=>{if(amount<0n||amount>999999999999999999n)fail('INVALID_PRICE',422);return {...denomination,amountMinor:String(amount)};};
 const subtotal=lines.reduce((n,l)=>n+BigInt(l.basePrice.amountMinor)*BigInt(l.qty),0n),total=lines.reduce((n,l)=>n+BigInt(l.lineTotal.amountMinor),0n);
 return MobileConfiguredFoodSnapshotSchema.parse({lines,subtotal:money(subtotal),discount:money(subtotal-total),fees:money(0n),tax:money(0n),total:money(total)});
}
export async function configuredRequestHash(db:pg.PoolClient,account:string,branch:string,items:readonly MobileConfiguredCartItem[]):Promise<string>{
 return (await db.query<{digest:string}>('SELECT bitpos.configured_request_hash($1,$2,$3) AS digest',[account,branch,JSON.stringify(items)])).rows[0].digest;
}
export async function freezeConfiguredQuote(db:pg.PoolClient,merchant:string,quote:string,items:readonly MobileConfiguredCartItem[],snapshot:MobileConfiguredFoodSnapshot){
 await db.query('INSERT INTO quote_configured_food(merchant_id,quote_id,items,snapshot) VALUES($1,$2,$3,$4)',[merchant,quote,JSON.stringify(items),JSON.stringify(snapshot)]);
}
export async function configuredQuote(db:pg.PoolClient,merchant:string,quote:string){
 const row=(await db.query('SELECT items,snapshot FROM quote_configured_food WHERE merchant_id=$1 AND quote_id=$2',[merchant,quote])).rows[0];
 if(!row)fail('QUOTE_CHANGED',409,{reason:'CONFIGURED_QUOTE_REQUIRED'});
 return {items:configuredItems(row.items),snapshot:MobileConfiguredFoodSnapshotSchema.parse(row.snapshot)};
}
export async function validateConfiguredQuote(db:pg.PoolClient,merchant:string,quote:string,products:readonly EffectiveLine[],delivery=false){
 const frozen=await configuredQuote(db,merchant,quote);let current=await configuredSnapshot(db,merchant,frozen.items,products);
 if(delivery){const destination=await deliverySnapshot(db,merchant,quote);if(!destination)fail('QUOTE_CHANGED');current=deliveryConfiguredSnapshot(current,destination);}
 // Definitions and product snapshots are immutable; only current option pointers
 // are consulted here, never when reading historical bills or settling payments.
 if(JSON.stringify(current)!==JSON.stringify(frozen.snapshot))fail('QUOTE_CHANGED',409,{reason:'CONFIGURED_QUOTE_CHANGED'});
}
export async function freezeConfiguredOrder(db:pg.PoolClient,merchant:string,order:string,quote:string){
 const result=await db.query('INSERT INTO order_configured_food(merchant_id,order_id,quote_id,snapshot) SELECT merchant_id,$2,quote_id,snapshot FROM quote_configured_food WHERE merchant_id=$1 AND quote_id=$3',[merchant,order,quote]);
 if(result.rowCount!==1)fail('QUOTE_CHANGED',409,{reason:'CONFIGURED_QUOTE_REQUIRED'});
}
