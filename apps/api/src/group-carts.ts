import {createHash,randomBytes} from 'node:crypto';
import type pg from 'pg';
import {z} from 'zod';
import {pool} from './db';
import {fail} from './authority';

// Shared group carts: selection intents only (branch, product, qty per member). No price, quote,
// payment or order exists here; each member prices and pays through the single-branch food flow.
const uuid=z.string().uuid();
const lineInput=z.object({branchId:uuid,productId:uuid,qty:z.number().int().min(0).max(99)}).strict();
const lockInput=z.object({expectedVersion:z.string().regex(/^[1-9][0-9]{0,18}$/)}).strict();
export const maxGroupMembers=12;
export const inviteTtlSeconds=24*3600;
export interface GroupView{id:string;ownerAccountId:string;state:'OPEN'|'LOCKED'|'CANCELLED';version:string;youAreOwner:boolean;members:string[];lines:{accountId:string;branchId:string;productId:string;qty:number}[];branches:{branchId:string;qty:number;members:number}[]}
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const codes:Record<string,[Parameters<typeof fail>[0],number]>={
 AUTH_REQUIRED:['AUTH_REQUIRED',401],RESOURCE_NOT_FOUND:['RESOURCE_NOT_FOUND',404],INVALID_REQUEST:['INVALID_REQUEST',422],GROUP_LIMIT:['GROUP_LIMIT',409],GROUP_NOT_OPEN:['GROUP_NOT_OPEN',409],GROUP_FULL:['GROUP_FULL',409],GROUP_CHANGED:['GROUP_CHANGED',409],EMPTY_CART:['EMPTY_CART',409],NOT_YOUR_LINE:['NOT_YOUR_LINE',403],PRODUCT_UNAVAILABLE:['PRODUCT_UNAVAILABLE',409],CART_TOO_LARGE:['CART_TOO_LARGE',409],OWNER_CANNOT_LEAVE:['OWNER_CANNOT_LEAVE',409]};
function mapped(error:unknown):never{
 if(error instanceof Error){const hit=Object.keys(codes).find(c=>error.message===c||error.message.startsWith(c+'\n')||error.message.includes('error: '+c));if(hit)fail(codes[hit][0],codes[hit][1]);}
 throw error;
}
async function as<T>(account:string,run:(db:pg.PoolClient)=>Promise<T>):Promise<T>{
 const db=await pool.connect();
 try{await db.query('BEGIN');await db.query("SELECT set_config('bitpos.mobile_account',$1,true)",[account]);const out=await run(db);await db.query('COMMIT');return out;}
 catch(error){await db.query('ROLLBACK').catch(()=>undefined);return mapped(error);}finally{db.release();}
}
async function view(db:pg.PoolClient,account:string,id:string):Promise<GroupView>{
 const g=(await db.query('SELECT * FROM group_carts WHERE id=$1',[id])).rows[0];if(!g)fail('RESOURCE_NOT_FOUND',404);
 const members=(await db.query('SELECT account_id FROM group_cart_members WHERE group_id=$1 ORDER BY joined_at,account_id',[id])).rows.map(r=>r.account_id as string);
 const lines=(await db.query('SELECT account_id,branch_id,product_id,qty FROM group_cart_lines WHERE group_id=$1 ORDER BY branch_id,product_id,account_id',[id])).rows.map(r=>({accountId:r.account_id as string,branchId:r.branch_id as string,productId:r.product_id as string,qty:r.qty as number}));
 const by=new Map<string,{branchId:string;qty:number;who:Set<string>}>();
 for(const l of lines){const b=by.get(l.branchId)??{branchId:l.branchId,qty:0,who:new Set<string>()};b.qty+=l.qty;b.who.add(l.accountId);by.set(l.branchId,b);}
 return {id:g.id,ownerAccountId:g.owner_account_id,state:g.state,version:String(g.version),youAreOwner:g.owner_account_id===account,members,lines,branches:[...by.values()].map(b=>({branchId:b.branchId,qty:b.qty,members:b.who.size}))};
}
export async function createGroup(account:string):Promise<GroupView>{return as(account,async db=>view(db,account,(await db.query('SELECT group_cart_create() AS id')).rows[0].id));}
export async function getGroup(account:string,groupId:string):Promise<GroupView>{const id=uuid.safeParse(groupId);if(!id.success)fail('INVALID_REQUEST',422);return as(account,db=>view(db,account,id.data));}
export async function currentGroups(account:string):Promise<{groups:GroupView[]}>{
 return as(account,async db=>{const ids=(await db.query("SELECT id FROM group_carts WHERE state IN('OPEN','LOCKED') ORDER BY created_at DESC LIMIT 20")).rows.map(r=>r.id as string);const groups:GroupView[]=[];for(const i of ids)groups.push(await view(db,account,i));return {groups};});
}
/** The invite token is returned once and stored as a hash; it expires after 24h and is revoked on lock/cancel. */
export async function inviteGroup(account:string,groupId:string):Promise<{token:string;expiresAt:string}>{
 const id=uuid.safeParse(groupId);if(!id.success)fail('INVALID_REQUEST',422);
 const token=randomBytes(24).toString('base64url');
 return as(account,async db=>{const at=(await db.query('SELECT group_cart_invite($1,$2,$3) AS at',[id.data,sha(token),inviteTtlSeconds])).rows[0].at;return {token,expiresAt:new Date(at).toISOString()};});
}
export async function joinGroup(account:string,token:unknown):Promise<GroupView>{
 const t=z.string().regex(/^[A-Za-z0-9_-]{20,64}$/).safeParse(token);if(!t.success)fail('INVALID_REQUEST',422);
 return as(account,async db=>view(db,account,(await db.query('SELECT group_cart_join($1,$2) AS id',[sha(t.data),maxGroupMembers])).rows[0].id));
}
/** A member sets their own line (qty 0 removes it). */
export async function setMyLine(account:string,groupId:string,input:unknown):Promise<GroupView>{
 const id=uuid.safeParse(groupId),d=lineInput.safeParse(input);if(!id.success||!d.success)fail('INVALID_REQUEST',422);
 return as(account,async db=>{await db.query('SELECT group_cart_set_line($1,$2,$3,$4,$5)',[id.data,account,d.data.branchId,d.data.productId,d.data.qty]);return view(db,account,id.data);});
}
/** The owner removes another member's line. */
export async function removeLine(account:string,groupId:string,memberId:string,input:unknown):Promise<GroupView>{
 const id=uuid.safeParse(groupId),m=uuid.safeParse(memberId),d=lineInput.safeParse(input);if(!id.success||!m.success||!d.success||d.data.qty!==0)fail('INVALID_REQUEST',422);
 return as(account,async db=>{await db.query('SELECT group_cart_set_line($1,$2,$3,$4,0)',[id.data,m.data,d.data.branchId,d.data.productId]);return view(db,account,id.data);});
}
export async function lockGroup(account:string,groupId:string,input:unknown):Promise<GroupView>{
 const id=uuid.safeParse(groupId),d=lockInput.safeParse(input);if(!id.success||!d.success)fail('INVALID_REQUEST',422);
 return as(account,async db=>{await db.query('SELECT group_cart_lock($1,$2)',[id.data,d.data.expectedVersion]);return view(db,account,id.data);});
}
export async function cancelGroup(account:string,groupId:string):Promise<GroupView>{
 const id=uuid.safeParse(groupId);if(!id.success)fail('INVALID_REQUEST',422);
 return as(account,async db=>{await db.query('SELECT group_cart_cancel($1)',[id.data]);return view(db,account,id.data);});
}
export async function leaveGroup(account:string,groupId:string):Promise<{left:true}>{
 const id=uuid.safeParse(groupId);if(!id.success)fail('INVALID_REQUEST',422);
 return as(account,async db=>{await db.query('SELECT group_cart_leave($1)',[id.data]);return {left:true};});
}
