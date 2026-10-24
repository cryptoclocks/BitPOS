import {createPrivateKey,sign,type KeyObject} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
const credentialsSchema=z.object({type:z.literal('service_account'),project_id:z.string().regex(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/),client_email:z.string().email(),private_key:z.string().min(100)});
export type MobilePushProviderConfig={kind:'unavailable'}|{kind:'fcm';projectId:string;credentialsPath:string};
export type MobilePushResult={status:'ACCEPTED';providerMessageId:string}|{status:'UNAVAILABLE'|'RETRY'|'TOKEN_INVALID';retryAfterSeconds:number};
export interface MobilePushMessage{fid:string;eventId:string;expiresAt:string;bindingId:string;bindingGeneration:string;app:'CUSTOMER'|'DRIVER';locale:'th'|'en';}
export function mobilePushProviderConfig(env:NodeJS.ProcessEnv):MobilePushProviderConfig{
 const projectId=env.BITPOS_PUSH_FCM_PROJECT_ID,credentialsPath=env.BITPOS_PUSH_FCM_CREDENTIALS_FILE;
 if(projectId===undefined&&credentialsPath===undefined)return {kind:'unavailable'};
 if(!projectId||!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)||!credentialsPath?.startsWith('/')||credentialsPath.includes('\0'))throw Error('INVALID_MOBILE_PUSH_CONFIGURATION');
 return {kind:'fcm',projectId,credentialsPath};
}
/** Provider transport acceptance is not phone delivery. No domain or recipient facts enter this adapter. */
export function createMobilePushProvider(config:MobilePushProviderConfig,options:{fetch?:typeof fetch;readCredentials?:(path:string)=>Promise<string>;now?:()=>number}={}){
 const request=options.fetch??fetch,now=options.now??Date.now;let key:KeyObject|undefined,email:string|undefined,token:string|undefined,expiresAt=0,refreshing:Promise<string>|undefined;
 async function access(signal:AbortSignal):Promise<string>{
  if(token&&expiresAt>now()+60000)return token;
  if(refreshing)return refreshing;
  const current=(async()=>{
   if(config.kind!=='fcm')throw Error('MOBILE_PUSH_UNAVAILABLE');
   if(!key){const parsed=credentialsSchema.parse(JSON.parse(await (options.readCredentials??(path=>readFile(path,'utf8')))(config.credentialsPath)));if(parsed.project_id!==config.projectId)throw Error('MOBILE_PUSH_PROJECT_MISMATCH');key=createPrivateKey(parsed.private_key);if(key.asymmetricKeyType!=='rsa')throw Error('MOBILE_PUSH_RSA_KEY_REQUIRED');email=parsed.client_email;}
   const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url'),seconds=Math.floor(now()/1000),unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:seconds,exp:seconds+3600}),assertion=unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),key).toString('base64url');
   const response=await request('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal});
   if(!response.ok)throw Error('MOBILE_PUSH_AUTH_UNAVAILABLE');
   const body=z.object({access_token:z.string().min(1).max(8192),expires_in:z.number().int().min(60).max(3600),token_type:z.literal('Bearer')}).parse(await boundedJson(response));token=body.access_token;expiresAt=now()+body.expires_in*1000;return token;
  })();refreshing=current;try{return await current;}finally{if(refreshing===current)refreshing=undefined;}
 }
 return {async send(message:MobilePushMessage,signal?:AbortSignal,beforeSend?:()=>Promise<boolean>):Promise<MobilePushResult>{
  if(config.kind==='unavailable')return {status:'UNAVAILABLE',retryAfterSeconds:300};
  const expiry=Date.parse(message.expiresAt);
  if(!Number.isFinite(expiry)||expiry<=now())return {status:'UNAVAILABLE',retryAfterSeconds:300};
  const deadline=AbortSignal.any([AbortSignal.timeout(Math.max(1,Math.min(10000,expiry-now()))),...(signal?[signal]:[])]);
  try{
   const bearer=await access(deadline);
   if(beforeSend&&!await beforeSend())return {status:'UNAVAILABLE',retryAfterSeconds:300};
   deadline.throwIfAborted();
   const sentAt=now(),remaining=Math.floor((expiry-sentAt)/1000);
   if(remaining<1)return {status:'UNAVAILABLE',retryAfterSeconds:300};
   const ttl=Math.min(60,remaining);
   const response=await request('https://fcm.googleapis.com/v1/projects/'+config.projectId+'/messages:send',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},body:JSON.stringify({message:{fid:message.fid,notification:{title:'BitPOS',body:message.locale==='th'?'เปิด BitPOS เพื่อตรวจสอบข้อมูลล่าสุด':'Open BitPOS to check your latest update.'},data:{eventId:message.eventId,bindingId:message.bindingId,bindingGeneration:message.bindingGeneration,app:message.app},android:{ttl:ttl+'s',priority:'high',notification:{channel_id:'bitpos_updates_v1',tag:'bitpos-push',visibility:'PRIVATE'}},apns:{headers:{'apns-expiration':String(Math.floor(Math.min(expiry,sentAt+ttl*1000)/1000))},payload:{aps:{sound:'default'}}}}}),signal:deadline});
   if(response.status===401){token=undefined;expiresAt=0;return {status:'UNAVAILABLE',retryAfterSeconds:300};}
   if(response.ok){const value=z.object({name:z.string().max(1024).regex(/^projects\/[a-z0-9-]+\/messages\/[A-Za-z0-9%_:.-]+$/)}).parse(await boundedJson(response));if(!value.name.startsWith('projects/'+config.projectId+'/messages/'))throw Error('MOBILE_PUSH_RESPONSE_PROJECT_MISMATCH');return {status:'ACCEPTED',providerMessageId:value.name};}
   const value=await boundedJson(response).catch(()=>null),unregistered=Array.isArray(value?.error?.details)&&value.error.details.some((detail:unknown)=>typeof detail==='object'&&detail!==null&&'@type' in detail&&detail['@type']==='type.googleapis.com/google.firebase.fcm.v1.FcmError'&&'errorCode' in detail&&detail.errorCode==='UNREGISTERED');
   if(unregistered)return {status:'TOKEN_INVALID',retryAfterSeconds:0};
   const raw=response.headers.get('retry-after'),delay=raw&&/^\d+$/.test(raw)?Number(raw):raw?Math.ceil((Date.parse(raw)-now())/1000):60;
   return {status:response.status===403?'UNAVAILABLE':'RETRY',retryAfterSeconds:Number.isFinite(delay)?Math.max(30,Math.min(3600,delay)):60};
  }catch{return {status:'UNAVAILABLE',retryAfterSeconds:300};}
 }};
}
async function boundedJson(response:Response):Promise<any>{
 if(!response.body)throw Error('MOBILE_PUSH_PROVIDER_RESPONSE');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768)throw Error('MOBILE_PUSH_PROVIDER_RESPONSE_LIMIT');chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
