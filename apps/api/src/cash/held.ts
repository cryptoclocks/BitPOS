import type pg from 'pg';
import {z} from 'zod';
import {fail} from '../authority';
import {audit} from '../db';
import {cart} from './sales';

const discount=z.discriminatedUnion('kind',[z.object({kind:z.literal('percent'),bps:z.number().int().min(1).max(9999)}).strict(),z.object({kind:z.literal('amount'),minor:z.string().regex(/^(0|[1-9][0-9]{0,17})$/)}).strict()]).nullable().default(null);
const hold=z.object({label:z.string().trim().min(1).max(40),items:cart,discount}).strict();
const MAX_HELD=50;
const staffUp=(role:string)=>{if(!['owner','manager','staff'].includes(role))fail('ROLE_REQUIRED',403);};
type Row={id:string;label:string;items:unknown;discount:unknown;created_by:string;created_at:Date};
const view=(r:Row)=>({id:r.id,label:r.label,items:r.items,discount:r.discount,createdBy:r.created_by,createdAt:r.created_at.toISOString()});

/** Parks a bill under a table/bar label. Nothing is reserved or priced: stock and prices are checked again when it is recalled and sold. */
export async function holdBill(db:pg.PoolClient,merchant:string,actor:string,role:string,input:unknown){
 staffUp(role);
 const p=hold.safeParse(input);if(!p.success)fail('INVALID_REQUEST',422);
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['cash-held:'+merchant]);
 if((await db.query<{n:number}>('SELECT count(*)::int n FROM cash_held_bills WHERE merchant_id=$1',[merchant])).rows[0].n>=MAX_HELD)fail('INVALID_REQUEST',409);
 const ids=[...new Set(p.data.items.map(i=>i.productId))];
 if((await db.query<{n:number}>('SELECT count(*)::int n FROM products WHERE merchant_id=$1 AND id=ANY($2::uuid[]) AND archived_at IS NULL',[merchant,ids])).rows[0].n!==ids.length)fail('RESOURCE_NOT_FOUND',404);
 const r=(await db.query<Row>('INSERT INTO cash_held_bills(merchant_id,label,items,discount,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,label,items,discount,created_by,created_at',[merchant,p.data.label,JSON.stringify(p.data.items),p.data.discount?JSON.stringify(p.data.discount):null,actor])).rows[0];
 await audit(db,merchant,actor,'cash.hold',r.id);
 return {held:view(r)};
}
export async function listHeld(db:pg.PoolClient,merchant:string,role:string){
 staffUp(role);
 return {held:(await db.query<Row>('SELECT id,label,items,discount,created_by,created_at FROM cash_held_bills WHERE merchant_id=$1 ORDER BY created_at',[merchant])).rows.map(view)};
}
/** Takes a held bill back to the register. It is removed in the same statement, so two cashiers can never both recall it. */
export async function recallHeld(db:pg.PoolClient,merchant:string,actor:string,role:string,id:unknown){
 staffUp(role);
 const u=z.string().uuid().safeParse(id);if(!u.success)fail('INVALID_REQUEST',422);
 const r=(await db.query<Row>('DELETE FROM cash_held_bills WHERE merchant_id=$1 AND id=$2 RETURNING id,label,items,discount,created_by,created_at',[merchant,u.data])).rows[0];
 if(!r)fail('RESOURCE_NOT_FOUND',404);
 await audit(db,merchant,actor,'cash.recall',r.id);
 return {held:view(r)};
}
/** Throws a held bill away: its creator, or an owner/manager. */
export async function discardHeld(db:pg.PoolClient,merchant:string,actor:string,role:string,id:unknown){
 staffUp(role);
 const u=z.string().uuid().safeParse(id);if(!u.success)fail('INVALID_REQUEST',422);
 const cur=(await db.query<{created_by:string}>('SELECT created_by FROM cash_held_bills WHERE merchant_id=$1 AND id=$2',[merchant,u.data])).rows[0];
 if(!cur)fail('RESOURCE_NOT_FOUND',404);
 if(role==='staff'&&cur.created_by!==actor)fail('ROLE_REQUIRED',403);
 await db.query('DELETE FROM cash_held_bills WHERE merchant_id=$1 AND id=$2',[merchant,u.data]);
 await audit(db,merchant,actor,'cash.discard',u.data);
 return {id:u.data};
}
