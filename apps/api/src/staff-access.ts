import type pg from 'pg';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {fail,requireRole} from './authority';
import {audit} from './db';

// M04. Everything here is decided on the server. The browser only shows what these endpoints return; hiding a button is never the control.
export const PIN_MAX_FAILURES=5,PIN_LOCK_MINUTES=5;
const uuid=z.string().uuid();
const hhmm=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const pinText=z.string().regex(/^[0-9]{4,8}$/);

export function hashPin(pin:string):string{const salt=randomBytes(16);return `scrypt$${salt.toString('base64')}$${scryptSync(pin,salt,32,{N:16384,r:8,p:1}).toString('base64')}`;}
export function verifyPin(pin:string,stored:string|null):boolean{
 // Always spend the same work, whether or not a PIN exists, so the response time does not tell a guesser which accounts have one.
 const parts=(stored??'').split('$');const salt=parts[0]==='scrypt'&&parts[1]?Buffer.from(parts[1],'base64'):Buffer.alloc(16);
 const want=parts[0]==='scrypt'&&parts[2]?Buffer.from(parts[2],'base64'):Buffer.alloc(32);
 const got=scryptSync(pin,salt,32,{N:16384,r:8,p:1});return !!stored&&got.length===want.length&&timingSafeEqual(got,want);
}

export interface StaffRow{userId:string;role:'owner'|'manager'|'staff';you:boolean;displayName:string;active:boolean;accessFrom:string|null;accessTo:string|null;hasPin:boolean;pinLockedUntil:string|null;revision:string}
type Raw={user_id:string;role:StaffRow['role'];display_name:string|null;active:boolean|null;access_from:string|null;access_to:string|null;has_pin:boolean|null;pin_locked_until:Date|null;revision:string|null};
const LIST=`SELECT m.user_id,m.role,sp.display_name,sp.active,to_char(sp.access_from,'HH24:MI') AS access_from,to_char(sp.access_to,'HH24:MI') AS access_to,(sp.pin_hash IS NOT NULL) AS has_pin,sp.pin_locked_until,sp.revision::text AS revision
 FROM members m LEFT JOIN staff_profiles sp ON sp.merchant_id=m.merchant_id AND sp.user_id=m.user_id WHERE m.merchant_id=$1`;
const view=(r:Raw,actor:string):StaffRow=>({userId:r.user_id,role:r.role,you:r.user_id===actor,displayName:r.display_name??'',active:r.active??true,accessFrom:r.access_from,accessTo:r.access_to,hasPin:!!r.has_pin,pinLockedUntil:r.pin_locked_until&&r.pin_locked_until.getTime()>Date.now()?r.pin_locked_until.toISOString():null,revision:r.revision??'0'});

/** Owner: the whole team with profile fields. */
export async function listStaff(db:pg.PoolClient,merchant:string,actor:string,role:string){
 requireRole(role,true);
 const rows=(await db.query<Raw>(`${LIST} ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,coalesce(sp.display_name,''),m.user_id`,[merchant])).rows;
 return {members:rows.map(r=>view(r,actor))};
}

const profileBody=z.object({
 expectedRevision:z.string().regex(/^[0-9]{1,18}$/),
 displayName:z.string().trim().max(60).optional(),
 active:z.boolean().optional(),
 access:z.union([z.null(),z.object({from:hhmm,to:hhmm}).strict().refine(a=>a.from!==a.to)]).optional(),
}).strict().refine(b=>b.displayName!==undefined||b.active!==undefined||b.access!==undefined);

async function target(db:pg.PoolClient,merchant:string,id:string){
 return (await db.query<{role:StaffRow['role'];revision:string|null;pin_hash:string|null}>(`SELECT m.role,sp.revision::text AS revision,sp.pin_hash FROM members m LEFT JOIN staff_profiles sp ON sp.merchant_id=m.merchant_id AND sp.user_id=m.user_id WHERE m.merchant_id=$1 AND m.user_id=$2 FOR UPDATE OF m`,[merchant,id])).rows[0];
}
async function bump(db:pg.PoolClient,merchant:string,actor:string,id:string,expected:string,sets:string,args:unknown[]){
 const have=(await db.query<{revision:string}>('SELECT revision::text FROM staff_profiles WHERE merchant_id=$1 AND user_id=$2 FOR UPDATE',[merchant,id])).rows[0];
 if(!have){ if(expected!=='0')fail('PRODUCT_CHANGED'); await db.query('INSERT INTO staff_profiles(merchant_id,user_id) VALUES($1,$2)',[merchant,id]); }
 else if(have.revision!==expected)fail('PRODUCT_CHANGED');
 await db.query(`UPDATE staff_profiles SET ${sets}${sets?',':''}revision=revision+1,updated_at=clock_timestamp(),updated_by=$3 WHERE merchant_id=$1 AND user_id=$2`,[merchant,id,actor,...args]);
}
const one=async(db:pg.PoolClient,merchant:string,actor:string,id:string)=>view((await db.query<Raw>(`${LIST} AND m.user_id=$2`,[merchant,id])).rows[0]!,actor);

/** Owner. Name, active flag and allowed daily hours (shop time). Revision-checked. Owners and the caller's own entry are never disabled or time-limited.
 * Disabling revokes every open session of that person in the same transaction, so it takes effect on their very next request. */
export async function updateProfile(db:pg.PoolClient,merchant:string,actor:string,role:string,userId:string,input:unknown){
 requireRole(role,true);
 const id=uuid.safeParse(userId),data=profileBody.safeParse(input);if(!id.success||!data.success)fail('INVALID_REQUEST',422);
 const t=await target(db,merchant,id.data);if(!t)fail('RESOURCE_NOT_FOUND',404);
 const d=data.data,restrictive=d.active===false||(d.access!==undefined&&d.access!==null);
 if(restrictive&&(t.role==='owner'||id.data===actor))fail('ROLE_REQUIRED',403);
 const sets:string[]=[],args:unknown[]=[];
 const arg=(v:unknown)=>{args.push(v);return '$'+(3+args.length);};
 if(d.displayName!==undefined)sets.push('display_name='+arg(d.displayName));
 if(d.active!==undefined)sets.push('active='+arg(d.active));
 if(d.access===null)sets.push('access_from=NULL','access_to=NULL');else if(d.access)sets.push('access_from='+arg(d.access.from)+'::time','access_to='+arg(d.access.to)+'::time');
 await bump(db,merchant,actor,id.data,d.expectedRevision,sets.join(','),args);
 if(d.active===false)await db.query('DELETE FROM sessions WHERE merchant_id=$1 AND user_id=$2',[merchant,id.data]);
 await audit(db,merchant,actor,d.active===false?'team.disable':d.active===true?'team.enable':'team.profile',id.data);
 return one(db,merchant,actor,id.data);
}

const pinBody=z.object({expectedRevision:z.string().regex(/^[0-9]{1,18}$/),pin:z.union([z.null(),pinText])}).strict();
/** Owner sets, resets or clears a manager's/staff member's PIN. The PIN is hashed with scrypt, never stored or logged in clear, and a reset clears the lockout. */
export async function setPin(db:pg.PoolClient,merchant:string,actor:string,role:string,userId:string,input:unknown){
 requireRole(role,true);
 const id=uuid.safeParse(userId),data=pinBody.safeParse(input);if(!id.success||!data.success)fail('INVALID_REQUEST',422);
 const t=await target(db,merchant,id.data);if(!t)fail('RESOURCE_NOT_FOUND',404);
 if(t.role==='owner')fail('ROLE_REQUIRED',403);
 const hash=data.data.pin===null?null:hashPin(data.data.pin);
 await bump(db,merchant,actor,id.data,data.data.expectedRevision,'pin_hash=$4,pin_set_at=CASE WHEN $4::text IS NULL THEN NULL ELSE clock_timestamp() END,pin_failed=0,pin_locked_until=NULL',[hash]);
 await audit(db,merchant,actor,hash?'team.pin.set':'team.pin.clear',id.data);
 return one(db,merchant,actor,id.data);
}

/** Any signed-in member: the people who can be switched to (active, have a PIN, not owners). Names only; no PIN data. */
export async function directory(db:pg.PoolClient,merchant:string){
 const rows=(await db.query<{user_id:string;role:string;display_name:string}>(`SELECT m.user_id,m.role,sp.display_name FROM members m JOIN staff_profiles sp ON sp.merchant_id=m.merchant_id AND sp.user_id=m.user_id WHERE m.merchant_id=$1 AND m.role<>'owner' AND sp.active AND sp.pin_hash IS NOT NULL ORDER BY sp.display_name,m.user_id`,[merchant])).rows;
 return {people:rows.map(r=>({userId:r.user_id,role:r.role,displayName:r.display_name}))};
}

const switchBody=z.object({userId:uuid,pin:pinText}).strict();
export type SwitchResult={kind:'ok';userId:string;role:'manager'|'staff'}|{kind:'refused';code:'AUTH_REQUIRED'|'PIN_LOCKED'|'ACCOUNT_DISABLED'|'OUTSIDE_ACCESS_HOURS';status:number};
/** A signed-in till switches to another cashier with that person's PIN. Never to an owner; five wrong PINs lock that person for five minutes;
 * every attempt is audited. It RETURNS a refusal instead of throwing, because the caller must commit the failure counter and the audit row
 * before it answers with an error (a thrown error would roll them back and let a guesser try forever). */
export async function checkSwitch(db:pg.PoolClient,merchant:string,actor:string,input:unknown):Promise<SwitchResult>{
 const data=switchBody.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
 const row=(await db.query<{role:string;active:boolean|null;pin_hash:string|null;pin_failed:number|null;locked:boolean|null;denied:string|null}>(
  `SELECT m.role,sp.active,sp.pin_hash,sp.pin_failed,(sp.pin_locked_until>clock_timestamp()) AS locked,bitpos.staff_access_denied($1,m.user_id,clock_timestamp()) AS denied FROM members m LEFT JOIN staff_profiles sp ON sp.merchant_id=m.merchant_id AND sp.user_id=m.user_id WHERE m.merchant_id=$1 AND m.user_id=$2 FOR UPDATE OF m`,[merchant,data.data.userId])).rows[0];
 const ok=verifyPin(data.data.pin,row?.pin_hash??null); // same work for every outcome
 if(!row||row.role==='owner'||!row.pin_hash||row.active===false){await audit(db,merchant,actor,'session.switch.refused',data.data.userId);return {kind:'refused',code:'AUTH_REQUIRED',status:401};}
 if(row.locked){await audit(db,merchant,actor,'session.switch.locked',data.data.userId);return {kind:'refused',code:'PIN_LOCKED',status:429};}
 if(!ok){
  const failed=(row.pin_failed??0)+1;
  await db.query('UPDATE staff_profiles SET pin_failed=$3::int,pin_locked_until=CASE WHEN $3::int>=$4::int THEN clock_timestamp()+make_interval(mins=>$5::int) ELSE pin_locked_until END WHERE merchant_id=$1 AND user_id=$2',[merchant,data.data.userId,failed,PIN_MAX_FAILURES,PIN_LOCK_MINUTES]);
  await audit(db,merchant,actor,'session.switch.refused',data.data.userId);
  return {kind:'refused',code:failed>=PIN_MAX_FAILURES?'PIN_LOCKED':'AUTH_REQUIRED',status:failed>=PIN_MAX_FAILURES?429:401};
 }
 if(row.denied){await audit(db,merchant,actor,'session.switch.refused',data.data.userId);return {kind:'refused',code:row.denied==='DISABLED'?'ACCOUNT_DISABLED':'OUTSIDE_ACCESS_HOURS',status:403};}
 await db.query('UPDATE staff_profiles SET pin_failed=0,pin_locked_until=NULL WHERE merchant_id=$1 AND user_id=$2',[merchant,data.data.userId]);
 await audit(db,merchant,actor,'session.switch',data.data.userId);
 return {kind:'ok',userId:data.data.userId,role:row.role as 'manager'|'staff'};
}
