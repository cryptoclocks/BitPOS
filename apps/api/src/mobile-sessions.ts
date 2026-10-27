import {z} from 'zod';
import {pool} from './db';
import {fail} from './authority';
import {mobilePrincipal} from './mobile-auth';
import {MobileSessionRevokeSchema,MobileAccountSessionsSchema,MobileSessionRevokedSchema} from '../../../packages/contracts/src/mobile-v1.generated';
const uuid=z.string().uuid();
export async function mobileSessionsRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const root='/api/mobile/v1/account/sessions',match=new RegExp('^'+root+'/([^/]+)$').exec(url.pathname);
 if(url.pathname!==root&&!match)return undefined;
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SET LOCAL lock_timeout='2s'");
  await db.query("SET LOCAL statement_timeout='5s'");
  let actor=await mobilePrincipal(bearer,db);
  await db.query('SELECT id FROM mobile_accounts WHERE id=$1 FOR UPDATE',[actor.accountId]);
  actor=await mobilePrincipal(bearer,db);
  if(url.pathname===root&&method==='GET'){
   for(const key of url.searchParams.keys())if(key!=='cursor')fail('INVALID_REQUEST',422);
   if(url.searchParams.getAll('cursor').length>1)fail('INVALID_REQUEST',422);
   const raw=url.searchParams.get('cursor'),cursor=raw===null?null:uuid.parse(raw);
   const anchor=cursor?(await db.query('SELECT id FROM mobile_sessions WHERE id=$1 AND account_id=$2',[cursor,actor.accountId])).rows[0]:null;
   if(cursor&&!anchor)fail('INVALID_REQUEST',422);
   const rows=(await db.query(`SELECT id,created_at,refresh_expires_at FROM mobile_sessions
    WHERE account_id=$1 AND revoked_at IS NULL AND refresh_expires_at>clock_timestamp()
    AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM mobile_sessions WHERE id=$2 AND account_id=$1))
    ORDER BY created_at DESC,id DESC LIMIT 31`,[actor.accountId,cursor])).rows;
   const result=MobileAccountSessionsSchema.parse({sessions:rows.slice(0,30).map(row=>({id:row.id,current:row.id===actor.sessionId,createdAt:row.created_at.toISOString(),expiresAt:row.refresh_expires_at.toISOString()})),nextCursor:rows.length>30?rows[29].id:null});
   await db.query('COMMIT');return result;
  }
  if(match&&method==='PUT'){
   if(url.search)fail('INVALID_REQUEST',422);
   const id=uuid.parse(match[1]).toLowerCase();MobileSessionRevokeSchema.parse(input);
   if(id===actor.sessionId)fail('CURRENT_SESSION_REQUIRES_LOGOUT',409);
   const changed=(await db.query('UPDATE mobile_sessions SET revoked_at=clock_timestamp() WHERE account_id=$1 AND id=$2 AND revoked_at IS NULL RETURNING id',[actor.accountId,id])).rowCount;
   if(!changed&&!(await db.query('SELECT id FROM mobile_sessions WHERE account_id=$1 AND id=$2',[actor.accountId,id])).rowCount)fail('RESOURCE_NOT_FOUND',404);
   if(changed)await db.query("INSERT INTO mobile_identity_audit(account_id,session_id,action) VALUES($1,$2,'session.revoke')",[actor.accountId,id]);
   await db.query('COMMIT');return MobileSessionRevokedSchema.parse({sessionId:id,revoked:true});
  }
  fail('RESOURCE_NOT_FOUND',404);
 }catch(error){await db.query('ROLLBACK');if(['55P03','40P01','57014'].includes((error as {code?:string}).code??''))fail('DISPATCH_AUTH_RETRY',409);throw error;}finally{db.release();}
}
