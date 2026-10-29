import type pg from 'pg';
import type {PromotionDestination} from '../../../packages/contracts/src/promotion-destination';
import {fail} from './authority';
export async function guardPromotionDestination(db:pg.PoolClient,merchant:string,d:PromotionDestination){
 const valid=(await db.query('SELECT 1 FROM devices d JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id WHERE d.merchant_id=$1 AND d.id=$2 AND d.table_id=$3 AND d.assignment_generation=$4 AND d.auth_generation=$5 AND d.revoked_at IS NULL AND t.retired_at IS NULL',[merchant,d.deviceId,d.tableId,d.assignmentGeneration,d.authGeneration])).rowCount;
 if(!valid)fail('PROMOTION_TARGET_CHANGED');
}
export async function jobPromotionDestination(db:pg.PoolClient,merchant:string,job:string):Promise<PromotionDestination|null>{const row=(await db.query('SELECT destination FROM promotion_generation_destinations WHERE merchant_id=$1 AND job_id=$2',[merchant,job])).rows[0];if(row)await guardPromotionDestination(db,merchant,row.destination);return row?.destination??null;}
export async function campaignPromotionDestination(db:pg.PoolClient,merchant:string,campaign:string):Promise<PromotionDestination|null>{return (await db.query('SELECT g.destination FROM promotion_generation_destinations g JOIN promotion_campaigns c ON c.merchant_id=g.merchant_id AND c.job_id=g.job_id WHERE c.merchant_id=$1 AND c.id=$2 AND NOT c.manual_derived AND NOT EXISTS(SELECT 1 FROM promotion_derivations x WHERE x.merchant_id=c.merchant_id AND x.campaign_id=c.id)',[merchant,campaign])).rows[0]?.destination??null;}
