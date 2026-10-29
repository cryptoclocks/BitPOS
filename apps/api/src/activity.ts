import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from './authority';

const cursor=z.string().uuid();
export interface ActivityEntry{id:string;actor:string;action:string;subject:string;createdAt:string}
/** Owner/manager only, read-only, merchant-scoped keyset page of the audit log (newest first). */
export async function activityHistory(db:pg.PoolClient,merchant:string,role:string,url:URL):Promise<{entries:ActivityEntry[];nextCursor:string|null}>{
 requireRole(role);
 const keys=[...url.searchParams.keys()];if(keys.some(k=>k!=='cursor')||keys.length>1)fail('INVALID_REQUEST',422);
 const after=url.searchParams.has('cursor')?cursor.safeParse(url.searchParams.get('cursor')):null;
 if(after&&!after.success)fail('INVALID_REQUEST',422);
 const rows=(await db.query<{id:string;actor:string;action:string;subject:string;created_at:Date}>(
  `SELECT id,actor,action,subject,created_at FROM audit_logs WHERE merchant_id=$1
   AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM audit_logs WHERE merchant_id=$1 AND id=$2))
   ORDER BY created_at DESC,id DESC LIMIT 51`,[merchant,after?.data??null])).rows;
 if(after&&!rows.length&&!(await db.query('SELECT 1 FROM audit_logs WHERE merchant_id=$1 AND id=$2',[merchant,after.data])).rowCount)fail('RESOURCE_NOT_FOUND',404);
 return {entries:rows.slice(0,50).map(r=>({id:r.id,actor:r.actor,action:r.action,subject:r.subject,createdAt:r.created_at.toISOString()})),nextCursor:rows.length>50?rows[49].id:null};
}
