import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from './authority';
import {audit} from './db';

export interface TeamMember{userId:string;role:'owner'|'manager'|'staff';you:boolean}
const uuid=z.string().uuid();
const change=z.object({role:z.enum(['manager','staff']),expectedRole:z.enum(['manager','staff'])}).strict();
/** Owner only. Lists the shop's members and lets the owner move a manager or staff member between those two roles. Owners are never
 * changed here, the owner cannot change their own entry, and a change also updates that person's open sessions so it takes effect at
 * once. `members` has no row-level security, so every statement names the merchant explicitly. Names and invitations live in the auth
 * service and are not offered. */
export async function teamRequest(db:pg.PoolClient,merchant:string,actor:string,role:string,url:URL,method:string,input:unknown){
 requireRole(role,true);
 if(url.pathname==='/api/team'&&method==='GET'){
  if(url.search)fail('INVALID_REQUEST',422);
  const rows=(await db.query<{user_id:string;role:TeamMember['role']}>("SELECT user_id,role FROM members WHERE merchant_id=$1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,user_id",[merchant])).rows;
  return {members:rows.map((r):TeamMember=>({userId:r.user_id,role:r.role,you:r.user_id===actor}))};
 }
 const match=/^\/api\/team\/([0-9a-f-]{36})$/.exec(url.pathname);
 if(match&&method==='PATCH'){
  const id=uuid.safeParse(match[1]),data=change.safeParse(input);if(!id.success||!data.success)fail('INVALID_REQUEST',422);
  if(id.data===actor)fail('ROLE_REQUIRED',403);
  const row=(await db.query<{role:string}>('SELECT role FROM members WHERE merchant_id=$1 AND user_id=$2 FOR UPDATE',[merchant,id.data])).rows[0];
  if(!row)fail('RESOURCE_NOT_FOUND',404);
  if(row.role==='owner')fail('ROLE_REQUIRED',403);
  if(row.role!==data.data.expectedRole)fail('VERSION_CONFLICT');
  await db.query('UPDATE members SET role=$3 WHERE merchant_id=$1 AND user_id=$2',[merchant,id.data,data.data.role]);
  await db.query('UPDATE sessions SET role=$3 WHERE merchant_id=$1 AND user_id=$2',[merchant,id.data,data.data.role]);
  await audit(db,merchant,actor,'team.role',id.data+':'+row.role+'>'+data.data.role);
  return {userId:id.data,role:data.data.role};
 }
 fail('RESOURCE_NOT_FOUND',404);
}
