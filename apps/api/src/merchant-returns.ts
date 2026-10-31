import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from './authority';

const query=z.object({limit:z.coerce.number().int().min(1).max(200).default(50)}).strict();
export type ReturnStage='REQUESTED'|'RECEIVED'|'RESOLVED'|'REFUNDING'|'REFUNDED';
export interface MerchantReturn{caseId:string;orderId:string;reason:string;requestedAt:string;receivedAt:string|null;resolvedAt:string|null;condition:string|null;amount:{currency:string;decimals:number;totalMinor:string}|null;refund:'NONE'|'IN_PROGRESS'|'REFUNDED';stage:ReturnStage}
/** Owner/manager only. A read of the shop's own return and refund cases, newest activity first; money is the catalog amount of the financial review and is never summed here. */
export async function merchantReturns(db:pg.PoolClient,merchant:string,role:string,url:URL):Promise<{returns:MerchantReturn[]}>{
 requireRole(role);
 const keys=[...url.searchParams.keys()];if(new Set(keys).size!==keys.length)fail('INVALID_REQUEST',422);
 const q=query.safeParse(Object.fromEntries(url.searchParams));if(!q.success)fail('INVALID_REQUEST',422);
 const rows=(await db.query<{value:MerchantReturn[]}>('SELECT bitpos.merchant_returns163_list($1,$2) value',[merchant,q.data.limit])).rows;
 return{returns:rows[0]?.value??[]};
}
