import {createCipheriv,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto';
import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from './authority';
import {audit} from './db';
import {GrabFoodClient,GrabError} from './channels/grabfood-client';

const SOURCES=['grabfood','lineman'] as const,ENVS=['sandbox','production'] as const;
const text=(max:number)=>z.string().trim().max(max);
// Field names are the owner-facing slots; which of them a provider actually uses is confirmed from its documentation later.
const input=z.object({
 source:z.enum(SOURCES),environment:z.enum(ENVS),externalStoreId:text(120),clientId:text(200),
 // undefined = keep the stored secret, '' = clear it, otherwise replace it.
 clientSecret:text(512).optional(),webhookSecret:text(512).optional()
}).strict();
const target=z.object({source:z.enum(SOURCES),environment:z.enum(ENVS)}).strict();
type Secrets={clientSecret:string;webhookSecret:string};
type Row={source:string;environment:string;state:string;external_store_id:string;client_id:string;secret_ciphertext:string;has_client_secret:boolean;has_webhook_secret:boolean;last_check_at:Date|null;last_check_result:string;updated_at:Date};
export interface ChannelConnectionView{source:string;environment:string;state:string;externalStoreId:string;clientId:string;hasClientSecret:boolean;hasWebhookSecret:boolean;lastCheckAt:string|null;lastCheckResult:string;updatedAt:string}
const view=(r:Row):ChannelConnectionView=>({source:r.source,environment:r.environment,state:r.state,externalStoreId:r.external_store_id,clientId:r.client_id,hasClientSecret:r.has_client_secret,hasWebhookSecret:r.has_webhook_secret,lastCheckAt:r.last_check_at?.toISOString()??null,lastCheckResult:r.last_check_result,updatedAt:r.updated_at.toISOString()});

const key=()=>Buffer.from(hkdfSync('sha256',process.env.APP_SECRET??fail('INTERNAL_ERROR',500),'bitpos-channel-credentials','v1',32));
const aad=(merchant:string,source:string,env:string)=>Buffer.from(`${merchant}|${source}|${env}`);
export function sealSecrets(s:Secrets,merchant:string,source:string,env:string):string{
 const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);c.setAAD(aad(merchant,source,env));
 const body=Buffer.concat([c.update(JSON.stringify(s),'utf8'),c.final()]);
 return 'v1.'+[iv,c.getAuthTag(),body].map(b=>b.toString('base64url')).join('.');
}
/** Server-side only (adapters). Fails closed if the ciphertext was moved to another merchant/source/environment. */
export function openSecrets(sealed:string,merchant:string,source:string,env:string):Secrets{
 const [v,iv,tag,body]=sealed.split('.');if(v!=='v1'||!iv||!tag||!body)fail('INTERNAL_ERROR',500);
 try{const d=createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'base64url'));d.setAAD(aad(merchant,source,env));d.setAuthTag(Buffer.from(tag,'base64url'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(body,'base64url')),d.final()]).toString('utf8')) as Secrets;}
 catch{fail('INTERNAL_ERROR',500);}
}

/** Owner only. The response never contains a secret, only whether one is stored. */
export async function channelConnectionsRequest(db:pg.PoolClient,merchant:string,actor:string,role:string,method:string,body:unknown){
 requireRole(role,true);
 if(method==='GET'){
  const rows=(await db.query<Row>('SELECT * FROM channel_connections WHERE merchant_id=$1 ORDER BY source,environment',[merchant])).rows;
  const active=(await db.query<{source:string;active_environment:string}>('SELECT source,active_environment FROM channel_settings WHERE merchant_id=$1',[merchant])).rows;
  const activeEnvironment=Object.fromEntries(SOURCES.map(x=>[x,active.find(a=>a.source===x)?.active_environment??'sandbox']));
  return {connections:rows.map(view),activeEnvironment};
 }
 if(method==='PUT'){
  const p=input.safeParse(body);if(!p.success)fail('INVALID_REQUEST',422);const d=p.data;
  const prior=(await db.query<Row>('SELECT * FROM channel_connections WHERE merchant_id=$1 AND source=$2 AND environment=$3 FOR UPDATE',[merchant,d.source,d.environment])).rows[0];
  const old=prior?.secret_ciphertext?openSecrets(prior.secret_ciphertext,merchant,d.source,d.environment):{clientSecret:'',webhookSecret:''};
  const next:Secrets={clientSecret:d.clientSecret??old.clientSecret,webhookSecret:d.webhookSecret??old.webhookSecret};
  const sealed=next.clientSecret||next.webhookSecret?sealSecrets(next,merchant,d.source,d.environment):'';
  // Changing anything resets verification: a different credential has not been proven by the provider.
  const row=(await db.query<Row>(`INSERT INTO channel_connections(merchant_id,source,environment,state,external_store_id,client_id,secret_ciphertext,has_client_secret,has_webhook_secret,updated_by)
   VALUES($1,$2,$3,'credentials_saved',$4,$5,$6,$7,$8,$9)
   ON CONFLICT(merchant_id,source,environment) DO UPDATE SET state='credentials_saved',last_check_at=NULL,last_check_result='',external_store_id=excluded.external_store_id,client_id=excluded.client_id,secret_ciphertext=excluded.secret_ciphertext,has_client_secret=excluded.has_client_secret,has_webhook_secret=excluded.has_webhook_secret,updated_by=excluded.updated_by,updated_at=clock_timestamp() RETURNING *`,
   [merchant,d.source,d.environment,d.externalStoreId,d.clientId,sealed,!!next.clientSecret,!!next.webhookSecret,actor])).rows[0];
  await audit(db,merchant,actor,'channel.credentials.save',`${d.source}:${d.environment}`);
  return view(row);
 }
 if(method==='POST'){  // delete: bodies are only parsed for POST/PUT/PATCH
  const p=target.safeParse(body);if(!p.success)fail('INVALID_REQUEST',422);
  const gone=await db.query('DELETE FROM channel_connections WHERE merchant_id=$1 AND source=$2 AND environment=$3',[merchant,p.data.source,p.data.environment]);
  if(!gone.rowCount)fail('RESOURCE_NOT_FOUND',404);
  await audit(db,merchant,actor,'channel.credentials.delete',`${p.data.source}:${p.data.environment}`);
  return {deleted:true};
 }
 fail('RESOURCE_NOT_FOUND',404);
}

const envInput=z.object({source:z.enum(SOURCES),environment:z.enum(ENVS),confirmProduction:z.boolean().optional()}).strict();
/** Owner only. Default is sandbox; production needs stored credentials for it and confirmProduction:true. */
export async function setActiveEnvironment(db:pg.PoolClient,merchant:string,actor:string,role:string,body:unknown){
 requireRole(role,true);
 const p=envInput.safeParse(body);if(!p.success)fail('INVALID_REQUEST',422);const d=p.data;
 if(d.environment==='production'){
  if(d.confirmProduction!==true)fail('INVALID_REQUEST',422);
  if(!(await db.query('SELECT 1 FROM channel_connections WHERE merchant_id=$1 AND source=$2 AND environment=$3 AND has_client_secret',[merchant,d.source,'production'])).rowCount)fail('RESOURCE_NOT_FOUND',404);
 }
 await db.query(`INSERT INTO channel_settings(merchant_id,source,active_environment,updated_by) VALUES($1,$2,$3,$4)
  ON CONFLICT(merchant_id,source) DO UPDATE SET active_environment=excluded.active_environment,updated_by=excluded.updated_by,updated_at=clock_timestamp()`,[merchant,d.source,d.environment,actor]);
 await audit(db,merchant,actor,'channel.environment.set',`${d.source}:${d.environment}`);
 return {source:d.source,activeEnvironment:d.environment};
}

export type GrabHttp=ConstructorParameters<typeof GrabFoodClient>[2];
type Http=GrabHttp;
/** Builds a provider client from the stored, decrypted credentials. Server-side only. */
export async function grabClientFor(db:pg.PoolClient,merchant:string,environment:typeof ENVS[number],http?:Http){
 const row=(await db.query<Row>('SELECT * FROM channel_connections WHERE merchant_id=$1 AND source=$2 AND environment=$3',[merchant,'grabfood',environment])).rows[0];
 if(!row||!row.secret_ciphertext||!row.client_id||!row.external_store_id)fail('RESOURCE_NOT_FOUND',404);
 const s=openSecrets(row.secret_ciphertext,merchant,'grabfood',environment);
 return new GrabFoodClient(environment,{clientId:row.client_id,clientSecret:s.clientSecret,merchantId:row.external_store_id},http);
}
/**
 * Owner only. Live check against the provider: OAuth token + store status for the stored store ID. Success marks the connection
 * 'linked'; failure keeps it 'credentials_saved' and records a short code. LINE MAN has no public API documentation, so it cannot be tested.
 */
export async function testChannelConnection(db:pg.PoolClient,merchant:string,actor:string,role:string,body:unknown,http?:Http){
 requireRole(role,true);
 const p=target.safeParse(body);if(!p.success)fail('INVALID_REQUEST',422);const {source,environment}=p.data;
 if(source!=='grabfood')fail('INVALID_REQUEST',422);
 const client=await grabClientFor(db,merchant,environment,http);
 let result='ok',state='linked',store:{isOpen:boolean;closeReason:string}|null=null;
 try{store=await client.storeStatus();}catch(e){state='credentials_saved';result=e instanceof GrabError?e.message:'GRAB_UNKNOWN_ERROR';}
 await db.query('UPDATE channel_connections SET state=$4,last_check_at=clock_timestamp(),last_check_result=$5 WHERE merchant_id=$1 AND source=$2 AND environment=$3',[merchant,source,environment,state,result]);
 await audit(db,merchant,actor,'channel.credentials.test',`${source}:${environment}:${result}`);
 return {source,environment,ok:result==='ok',state,result,store};
}
