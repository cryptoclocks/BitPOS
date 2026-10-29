import pg from 'pg';
import {z} from 'zod';
import {loadMobilePushCrypto,mobilePushCryptoPath,type MobilePushCrypto} from '../../../packages/domain/src/mobile-push-crypto';
import {createMobilePushProvider,mobilePushProviderConfig,type MobilePushResult} from './mobile-push-provider';
export interface MobilePushWorker{tick:()=>Promise<void>;close:()=>Promise<void>;}
type Dependencies={provider?:ReturnType<typeof createMobilePushProvider>;crypto?:MobilePushCrypto|null};
const leaseSchema=z.object({deliveryId:z.string().uuid(),leaseId:z.string().uuid()}).strict();
const preparedSchema=z.object({eventId:z.string().uuid(),expiresAt:z.string().datetime({offset:true}),bindingId:z.string().uuid(),bindingGeneration:z.string().regex(/^[1-9][0-9]{0,18}$/),app:z.enum(['CUSTOMER','DRIVER']),locale:z.enum(['th','en']),deviceId:z.string().uuid(),endpointHash:z.string().regex(/^[0-9a-f]{64}$/),ciphertext:z.string().max(8192),keyId:z.string().regex(/^[A-Za-z0-9_-]{1,40}$/)}).strict();
/** At-least-once opaque notification transport, never payment or device-delivery authority. */
export function createMobilePushWorker(connectionString:string|undefined,env:NodeJS.ProcessEnv=process.env,dependencies:Dependencies={}):MobilePushWorker|null{
 if(connectionString===undefined)return null;
 try{const url=new URL(connectionString);if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||url.pathname.length<2)throw Error();}catch{throw Error('Invalid BITPOS_MOBILE_PUSH_DATABASE_URL');}
 const provider=dependencies.provider??createMobilePushProvider(mobilePushProviderConfig(env)),keyringPath=mobilePushCryptoPath(env);
 const pool=new pg.Pool({connectionString,max:1,connectionTimeoutMillis:1500,idleTimeoutMillis:10000,application_name:'bitpos_mobile_push'});
 pool.on('connect',client=>client.on('error',()=>console.error('Private mobile push connection lost; durable delivery retained')));
 pool.on('error',()=>console.error('Private mobile push idle connection removed; next tick reconnects'));
 let crypto:Promise<MobilePushCrypto|null>|undefined;
 async function transaction<T>(run:(db:pg.PoolClient)=>Promise<T>):Promise<T>{
  const db=await pool.connect();try{
   await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');await db.query("SET LOCAL statement_timeout='2000ms';SET LOCAL lock_timeout='200ms'");
   const authority=(await db.query<{allowed:boolean}>(`SELECT current_user=session_user AND pg_has_role(session_user,'bitpos_mobile_push_worker','USAGE')
    AND NOT pg_has_role(session_user,'bitpos_app','MEMBER') AND NOT(r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls OR r.rolreplication) AS allowed FROM pg_roles r WHERE r.rolname=session_user`)).rows[0];
   if(!authority?.allowed)throw Error('MOBILE_PUSH_WORKER_ROLE_REQUIRED');const result=await run(db);await db.query('COMMIT');return result;
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
 }
 return{async tick(){
  await transaction(async db=>{await db.query('SELECT bitpos.mobile_push_expand(100)');});
  const claims=await transaction(async db=>z.array(leaseSchema).max(1).parse((await db.query('SELECT bitpos.mobile_push_claim(1) v')).rows[0].v));
  for(const claim of claims){
   const prepared=await transaction(async db=>{const value=(await db.query('SELECT bitpos.mobile_push_prepare($1,$2) v',[claim.deliveryId,claim.leaseId])).rows[0].v;return value===null?null:preparedSchema.parse(value);});
   if(!prepared)continue;let result:MobilePushResult;
   try{
    const encryption=await(crypto??=(dependencies.crypto!==undefined?Promise.resolve(dependencies.crypto):loadMobilePushCrypto(keyringPath)));
    if(!encryption)result={status:'UNAVAILABLE',retryAfterSeconds:300};
    else{const fid=encryption.decrypt({ciphertext:prepared.ciphertext,keyId:prepared.keyId,endpointHash:prepared.endpointHash},{app:prepared.app,deviceId:prepared.deviceId});result=await provider.send({fid,eventId:prepared.eventId,expiresAt:prepared.expiresAt,bindingId:prepared.bindingId,bindingGeneration:prepared.bindingGeneration,app:prepared.app,locale:prepared.locale},undefined,()=>transaction(async db=>(await db.query('SELECT bitpos.mobile_push_prepare($1,$2) v',[claim.deliveryId,claim.leaseId])).rows[0].v!==null));}
   }catch{result={status:'UNAVAILABLE',retryAfterSeconds:300};}
   await transaction(async db=>{await db.query('SELECT bitpos.mobile_push_finish($1,$2,$3,$4,$5)',[claim.deliveryId,claim.leaseId,result.status,result.status==='ACCEPTED'?result.providerMessageId:null,result.status==='ACCEPTED'||result.status==='TOKEN_INVALID'?1:result.retryAfterSeconds]);});
  }
 },close:()=>pool.end()};
}
