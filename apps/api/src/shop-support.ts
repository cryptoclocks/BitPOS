import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole,uuid} from './authority';
import {audit} from './db';

// Shop-side support requests (owner/manager). A shop sees only its own cases (RLS + explicit merchant filters); messages are insert-only; the staff answer
// arrives through the staff routes (shop-support-staff.ts). A request never contains secrets by design: only a subject and free text the shop typed.
const key=z.string().min(8).max(128);
const createBody=z.object({subject:z.string().trim().min(3).max(120),body:z.string().trim().min(1).max(4000),idempotencyKey:key}).strict();
const replyBody=z.object({body:z.string().trim().min(1).max(4000),idempotencyKey:key}).strict();
export const maxOpenCases=20,maxMessages=200;
export interface SupportCase{id:string;subject:string;state:'OPEN'|'ANSWERED'|'RESOLVED';version:string;createdAt:string;updatedAt:string}
export interface SupportMessage{id:string;authorKind:'SHOP'|'STAFF';body:string;createdAt:string}
type Row={id:string;subject:string;state:SupportCase['state'];version:string;created_at:Date;updated_at:Date};
const view=(r:Row):SupportCase=>({id:r.id,subject:r.subject,state:r.state,version:r.version,createdAt:r.created_at.toISOString(),updatedAt:r.updated_at.toISOString()});
const COLS='id,subject,state,version::text,created_at,updated_at';

export async function listSupportCases(db:pg.PoolClient,merchant:string,role:string):Promise<{cases:SupportCase[]}>{
 requireRole(role);
 return {cases:(await db.query<Row>(`SELECT ${COLS} FROM merchant_support_cases WHERE merchant_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 100`,[merchant])).rows.map(view)};
}
export async function readSupportCase(db:pg.PoolClient,merchant:string,role:string,id:unknown):Promise<{case:SupportCase;messages:SupportMessage[]}>{
 requireRole(role);
 const u=uuid.safeParse(id);if(!u.success)fail('INVALID_REQUEST',422);
 const c=(await db.query<Row>(`SELECT ${COLS} FROM merchant_support_cases WHERE merchant_id=$1 AND id=$2`,[merchant,u.data])).rows[0];if(!c)fail('RESOURCE_NOT_FOUND',404);
 const m=(await db.query<{id:string;author_kind:'SHOP'|'STAFF';body:string;created_at:Date}>('SELECT id,author_kind,body,created_at FROM merchant_support_messages WHERE merchant_id=$1 AND case_id=$2 ORDER BY created_at,id',[merchant,u.data])).rows;
 return {case:view(c),messages:m.map(x=>({id:x.id,authorKind:x.author_kind,body:x.body,createdAt:x.created_at.toISOString()}))};
}
/** Idempotent on idempotencyKey: the same key with the same text returns the same case; the same key with other text is IDEMPOTENCY_CONFLICT. */
export async function createSupportCase(db:pg.PoolClient,merchant:string,actor:string,role:string,input:unknown):Promise<{case:SupportCase;replayed:boolean}>{
 requireRole(role);
 const d=createBody.safeParse(input);if(!d.success)fail('INVALID_REQUEST',422);
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['shop-support:'+merchant]);
 const prior=(await db.query<Row&{first:string}>(`SELECT ${COLS},(SELECT body FROM merchant_support_messages m WHERE m.merchant_id=c.merchant_id AND m.case_id=c.id ORDER BY created_at,id LIMIT 1) AS first FROM merchant_support_cases c WHERE merchant_id=$1 AND idempotency_key=$2`,[merchant,d.data.idempotencyKey])).rows[0];
 if(prior){if(prior.subject!==d.data.subject||prior.first!==d.data.body)fail('IDEMPOTENCY_CONFLICT');return {case:view(prior),replayed:true};}
 if(Number((await db.query<{n:string}>("SELECT count(*)::text n FROM merchant_support_cases WHERE merchant_id=$1 AND state<>'RESOLVED'",[merchant])).rows[0].n)>=maxOpenCases)fail('SUPPORT_LIMIT',409);
 const c=(await db.query<Row>(`INSERT INTO merchant_support_cases(merchant_id,subject,created_by,idempotency_key) VALUES($1,$2,$3,$4) RETURNING ${COLS}`,[merchant,d.data.subject,actor,d.data.idempotencyKey])).rows[0]!;
 await db.query("INSERT INTO merchant_support_messages(merchant_id,case_id,author_kind,author,body,idempotency_key) VALUES($1,$2,'SHOP',$3,$4,$5)",[merchant,c.id,actor,d.data.body,d.data.idempotencyKey]);
 await audit(db,merchant,actor,'support.case.create',c.id);
 return {case:view(c),replayed:false};
}
export async function replySupportCase(db:pg.PoolClient,merchant:string,actor:string,role:string,id:unknown,input:unknown):Promise<{case:SupportCase;replayed:boolean}>{
 requireRole(role);
 const u=uuid.safeParse(id),d=replyBody.safeParse(input);if(!u.success||!d.success)fail('INVALID_REQUEST',422);
 const c=(await db.query<Row>(`SELECT ${COLS} FROM merchant_support_cases WHERE merchant_id=$1 AND id=$2 FOR UPDATE`,[merchant,u.data])).rows[0];if(!c)fail('RESOURCE_NOT_FOUND',404);
 const same=(await db.query<{body:string}>('SELECT body FROM merchant_support_messages WHERE merchant_id=$1 AND case_id=$2 AND idempotency_key=$3',[merchant,u.data,d.data.idempotencyKey])).rows[0];
 if(same){if(same.body!==d.data.body)fail('IDEMPOTENCY_CONFLICT');return {case:view(c),replayed:true};}
 if(c.state==='RESOLVED')fail('SUPPORT_CASE_CLOSED',409);
 if(Number((await db.query<{n:string}>('SELECT count(*)::text n FROM merchant_support_messages WHERE merchant_id=$1 AND case_id=$2',[merchant,u.data])).rows[0].n)>=maxMessages)fail('SUPPORT_LIMIT',409);
 await db.query("INSERT INTO merchant_support_messages(merchant_id,case_id,author_kind,author,body,idempotency_key) VALUES($1,$2,'SHOP',$3,$4,$5)",[merchant,u.data,actor,d.data.body,d.data.idempotencyKey]);
 const n=(await db.query<Row>(`UPDATE merchant_support_cases SET state='OPEN',version=version+1,updated_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2 RETURNING ${COLS}`,[merchant,u.data])).rows[0]!;
 await audit(db,merchant,actor,'support.case.reply',u.data);
 return {case:view(n),replayed:false};
}
/** The shop closes its own request. Idempotent. */
export async function resolveSupportCase(db:pg.PoolClient,merchant:string,actor:string,role:string,id:unknown):Promise<{case:SupportCase}>{
 requireRole(role);
 const u=uuid.safeParse(id);if(!u.success)fail('INVALID_REQUEST',422);
 const c=(await db.query<Row>(`SELECT ${COLS} FROM merchant_support_cases WHERE merchant_id=$1 AND id=$2 FOR UPDATE`,[merchant,u.data])).rows[0];if(!c)fail('RESOURCE_NOT_FOUND',404);
 if(c.state==='RESOLVED')return {case:view(c)};
 const n=(await db.query<Row>(`UPDATE merchant_support_cases SET state='RESOLVED',version=version+1,updated_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2 RETURNING ${COLS}`,[merchant,u.data])).rows[0]!;
 await audit(db,merchant,actor,'support.case.resolve',u.data);
 return {case:view(n)};
}
