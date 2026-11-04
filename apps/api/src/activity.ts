import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from './authority';
import {defaultTimeZone} from './opening-hours';

// M09: the audit viewer. Owner/manager only and strictly read-only (the application role has no UPDATE/DELETE on audit_logs, migration 191).
// Filters are applied on the server, so a page is always a page of the filtered log, never a client-side filter of one page.
const day=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).refine(v=>!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v);
export const auditCategories=['sales','cash','stock','catalog','team','settings','reports'] as const;
export type AuditCategory=typeof auditCategories[number];
/** LIKE patterns per category. A category is a view over action names, not stored data, so a new action appears under "all" immediately. */
export const categoryPatterns:Record<AuditCategory,string[]>={
 sales:['order.%','bill.%','receipt.reprint','refund.%'],
 cash:['cash.%','shift.%'],
 stock:['inventory.%','supplier.%'],
 catalog:['catalog.%','pricing.%','product.%','opening_hours.%'],
 team:['team.%','session.%','profile.%','register.%','device.%'],
 settings:['payment_asset.%','treasury.%','collection.%','channel.%','rewards.%','loyalty.%','receipt.settings','table.%'],
 reports:['report.%'],
};
const query=z.object({
 cursor:z.string().uuid().optional(),category:z.enum(auditCategories).optional(),
 actor:z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/).optional(),
 from:day.optional(),to:day.optional(),
}).strict();
export interface ActivityEntry{id:string;actor:string;actorRole:'owner'|'manager'|'staff'|null;actorName:string|null;action:string;subject:string;createdAt:string}
export async function activityHistory(db:pg.PoolClient,merchant:string,role:string,url:URL):Promise<{entries:ActivityEntry[];nextCursor:string|null;timeZone:string}>{
 requireRole(role);
 const keys=[...url.searchParams.keys()];if(new Set(keys).size!==keys.length)fail('INVALID_REQUEST',422);
 const parsed=query.safeParse(Object.fromEntries(url.searchParams));if(!parsed.success)fail('INVALID_REQUEST',422);
 const q=parsed.data;if(q.from&&q.to&&q.to<q.from)fail('INVALID_REQUEST',422);
 const timeZone=(await db.query<{time_zone:string}>('SELECT time_zone FROM merchant_opening_hours WHERE merchant_id=$1',[merchant])).rows[0]?.time_zone??defaultTimeZone;
 const args:unknown[]=[merchant,timeZone];const arg=(v:unknown)=>{args.push(v);return '$'+args.length;};
 const where:string[]=['merchant_id=$1','$2::text IS NOT NULL'];
 if(q.cursor)where.push(`(created_at,id)<(SELECT created_at,id FROM audit_logs WHERE merchant_id=$1 AND id=${arg(q.cursor)})`);
 if(q.category)where.push(`action LIKE ANY(${arg(categoryPatterns[q.category])}::text[])`);
 if(q.actor)where.push(`actor=${arg(q.actor)}`);
 if(q.from)where.push(`created_at>=(${arg(q.from)}::date::timestamp AT TIME ZONE $2)`);
 if(q.to)where.push(`created_at<((${arg(q.to)}::date+1)::timestamp AT TIME ZONE $2)`);
 const rows=(await db.query<{id:string;actor:string;action:string;subject:string;created_at:Date;actor_role:'owner'|'manager'|'staff'|null;actor_name:string|null}>(
  `WITH page AS(SELECT id,actor,action,subject,created_at FROM audit_logs WHERE ${where.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT 51)
   SELECT p.*,m.role AS actor_role,nullif(sp.display_name,'') AS actor_name FROM page p
   LEFT JOIN members m ON m.merchant_id=$1 AND p.actor ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND m.user_id::text=p.actor
   LEFT JOIN staff_profiles sp ON sp.merchant_id=$1 AND sp.user_id=m.user_id
   ORDER BY p.created_at DESC,p.id DESC`,args)).rows;
 if(q.cursor&&!rows.length&&!(await db.query('SELECT 1 FROM audit_logs WHERE merchant_id=$1 AND id=$2',[merchant,q.cursor])).rowCount)fail('RESOURCE_NOT_FOUND',404);
 return {entries:rows.slice(0,50).map(r=>({id:r.id,actor:r.actor,actorRole:r.actor_role,actorName:r.actor_name,action:r.action,subject:r.subject,createdAt:r.created_at.toISOString()})),nextCursor:rows.length>50?rows[49].id:null,timeZone};
}
