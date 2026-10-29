import {createHash, randomBytes} from 'node:crypto';
import type pg from 'pg';
import {z} from 'zod';
import {pool} from './db';
import {config} from './config';
import {fail, RequestError} from './authority';
import {OtpRequestSchema,OtpVerificationSchema,RefreshRequestSchema,LogoutRequestSchema} from '../../../packages/contracts/src/mobile-v1.generated';

const digest = (value:string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const uuid = z.string().uuid();
const subject = z.object({id:uuid,phone:z.string().min(1),phone_confirmed_at:z.string().min(1)});
export interface MobilePrincipal {accountId:string;sessionId:string;deviceId:string;}

async function transaction<T>(run:(db:pg.PoolClient)=>Promise<T>):Promise<T> {
 const db=await pool.connect();
 try {await db.query('BEGIN');const value=await run(db);await db.query('COMMIT');return value;}
 catch(error){await db.query('ROLLBACK');throw error;}
 finally{db.release();}
}
async function limit(identity:string, operation:string, maximum:number) {
 const result=await pool.query(`INSERT INTO mobile_auth_limits(bucket_hash,window_start,attempts)
 VALUES($1,date_trunc('hour',clock_timestamp()),1)
 ON CONFLICT(bucket_hash,window_start) DO UPDATE SET attempts=mobile_auth_limits.attempts+1
 RETURNING attempts`,[digest(operation+':'+identity)]);
 if(result.rows[0].attempts>maximum)throw new RequestError(429,'PROVIDER_RATE_LIMITED','Mobile authentication rate limit');
}
async function authProvider(path:string, input:unknown) {
 let response:Response;
 try {response=await fetch(config.AUTH_URL+path,{method:'POST',headers:{apikey:config.AUTH_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(10000)});}
 catch{throw new RequestError(503,'CONFIGURATION_REQUIRED','Mobile OTP provider unavailable');}
 if(response.status===429)throw new RequestError(429,'PROVIDER_RATE_LIMITED','OTP provider rate limit');
 if(!response.ok){if(response.status>=500)throw new RequestError(503,'CONFIGURATION_REQUIRED','Mobile OTP provider unavailable');fail('AUTH_REQUIRED',401);}
 if(path!=='/verify')return null;
 try {return z.object({user:subject}).parse(await response.json()).user;}
 catch {throw new RequestError(503,'PROVIDER_RESPONSE_INVALID','Mobile OTP provider response invalid');}
}
async function issue(db:pg.PoolClient, accountId:string, deviceId:string) {
 const accessToken=token(),refreshToken=token();
 const row=(await db.query(`INSERT INTO mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at)
 VALUES($1,$2,$3,$4,clock_timestamp()+interval '15 minutes',clock_timestamp()+interval '30 days') RETURNING id,access_expires_at,refresh_expires_at`,[accountId,deviceId,digest(accessToken),digest(refreshToken)])).rows[0];
 await db.query('INSERT INTO mobile_refresh_history(token_hash,session_id,consumed_at) VALUES($1,$2,NULL)',[digest(refreshToken),row.id]);
 await db.query("INSERT INTO mobile_identity_audit(account_id,session_id,action) VALUES($1,$2,'session.login')",[accountId,row.id]);
 return {accountId,sessionId:row.id,accessToken,refreshToken,accessExpiresAt:row.access_expires_at.toISOString(),refreshExpiresAt:row.refresh_expires_at.toISOString()};
}
export async function mobilePrincipal(bearer:string|undefined,connection:Pick<pg.PoolClient,'query'>=pool):Promise<MobilePrincipal> {
 const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(bearer??'');if(!match)fail('AUTH_REQUIRED',401);
 const row=(await connection.query(`SELECT s.id,s.account_id,s.device_id FROM mobile_sessions s JOIN mobile_accounts a ON a.id=s.account_id
 WHERE s.access_hash=$1 AND s.revoked_at IS NULL AND s.access_expires_at>clock_timestamp() AND s.refresh_expires_at>clock_timestamp() AND a.disabled_at IS NULL`,[digest(match[1])])).rows[0];
 if(!row)fail('AUTH_REQUIRED',401);
 return {accountId:row.account_id,sessionId:row.id,deviceId:row.device_id};
}
export async function mobileAuthRequest(path:string, method:string, input:unknown, bearer:string|undefined, remoteAddress:string) {
 if(!path.startsWith('/api/mobile/v1/'))return undefined;
 if(process.env.BITPOS_MOBILE_ENABLED!=='1')throw new RequestError(503,'CONFIGURATION_REQUIRED','Mobile API admission disabled');
 if(path==='/api/mobile/v1/auth/otp'&&method==='POST') {
  const data=OtpRequestSchema.parse(input);
  await limit(remoteAddress,'otp-ip',20);await limit(data.phone,'otp-phone',5);
  await authProvider('/otp',{phone:data.phone,create_user:true});return {sent:true};
 }
 if(path==='/api/mobile/v1/auth/verify'&&method==='POST') {
  const data=OtpVerificationSchema.parse(input);
  await limit(remoteAddress,'verify-ip',40);await limit(data.phone,'verify-phone',10);
  const verified=await authProvider('/verify',{phone:data.phone,token:data.code,type:'sms'});
  if(!verified||verified.phone.replace(/^\+?/,'+')!==data.phone)fail('AUTH_REQUIRED',401);
  return transaction(async db=>{
   const account=(await db.query(`INSERT INTO mobile_accounts(auth_subject) VALUES($1)
    ON CONFLICT(auth_subject) DO UPDATE SET auth_subject=EXCLUDED.auth_subject RETURNING id,disabled_at`,[verified.id])).rows[0];
   if(account.disabled_at)fail('AUTH_REQUIRED',401);
   return issue(db,account.id,data.deviceId);
  });
 }
 if(path==='/api/mobile/v1/auth/refresh'&&method==='POST') {
  const data=RefreshRequestSchema.parse(input);
  await limit(remoteAddress,'refresh-ip',120);
  const result=await transaction(async db=>{
   const tokenHash=digest(data.refreshToken);
   const row=(await db.query(`SELECT s.*,a.disabled_at,h.consumed_at FROM mobile_refresh_history h
    JOIN mobile_sessions s ON s.id=h.session_id JOIN mobile_accounts a ON a.id=s.account_id
    WHERE h.token_hash=$1 FOR UPDATE OF s`,[tokenHash])).rows[0];
   if(!row)return null;
   if(row.consumed_at||row.refresh_hash!==tokenHash){
    await db.query('UPDATE mobile_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1',[row.id]);
    await db.query("INSERT INTO mobile_identity_audit(account_id,session_id,action) VALUES($1,$2,'session.refresh_replay_revoked')",[row.account_id,row.id]);return null;
   }
   if(row.revoked_at||row.disabled_at||row.device_id!==data.deviceId||row.refresh_expires_at<=new Date())return null;
   const accessToken=token(),refreshToken=token();
   await db.query('UPDATE mobile_refresh_history SET consumed_at=clock_timestamp() WHERE token_hash=$1',[tokenHash]);
   await db.query('INSERT INTO mobile_refresh_history(token_hash,session_id,consumed_at) VALUES($1,$2,NULL)',[digest(refreshToken),row.id]);
   const updated=(await db.query(`UPDATE mobile_sessions SET access_hash=$2,refresh_hash=$3,access_expires_at=LEAST(clock_timestamp()+interval '15 minutes',refresh_expires_at)
    WHERE id=$1 RETURNING access_expires_at,refresh_expires_at`,[row.id,digest(accessToken),digest(refreshToken)])).rows[0];
   return {accountId:row.account_id,sessionId:row.id,accessToken,refreshToken,accessExpiresAt:updated.access_expires_at.toISOString(),refreshExpiresAt:updated.refresh_expires_at.toISOString()};
  });
  // Replay revocation must commit before returning an authentication error.
  if(!result)fail('AUTH_REQUIRED',401);return result;
 }
 if(path==='/api/mobile/v1/auth/logout'&&method==='POST') {
  const data=LogoutRequestSchema.parse(input);
  const actor=await mobilePrincipal(bearer);const all=data.allDevices;
  await transaction(async db=>{
   await db.query(`UPDATE mobile_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE account_id=$1 AND ($2 OR id=$3)`,[actor.accountId,all,actor.sessionId]);
   await db.query("INSERT INTO mobile_identity_audit(account_id,session_id,action) VALUES($1,$2,$3)",[actor.accountId,actor.sessionId,all?'session.logout_all':'session.logout']);
  });return {revoked:true};
 }
 if(path==='/api/mobile/v1/account'&&method==='GET') {
  const actor=await mobilePrincipal(bearer);
  const row=(await pool.query('SELECT id,display_name,locale FROM mobile_accounts WHERE id=$1',[actor.accountId])).rows[0];
  return {id:row.id,displayName:row.display_name,locale:row.locale};
 }
 return undefined;
}
