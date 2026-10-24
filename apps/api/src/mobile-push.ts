import {createHash} from 'node:crypto';
import type {IncomingHttpHeaders} from 'node:http';
import {z} from 'zod';
import {MobilePushCommandSchema,MobilePushOpenRequestSchema,MobilePushOpenResultSchema,MobilePushReceiptSchema,MobilePushStatusSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {loadMobilePushCrypto,mobilePushCryptoPath,MobilePushCryptoError,type MobilePushCrypto} from '../../../packages/domain/src/mobile-push-crypto';
import {mobilePrincipal} from './mobile-auth';
import {withMobileDispatch} from './driver-platform';
import {fail,RequestError} from './authority';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function installationProof(headers:IncomingHttpHeaders,name:string,required:boolean){
 const value=headers[name];if(value===undefined&&!required)return null;
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value)||Buffer.from(value,'base64url').toString('base64url')!==value)fail('INVALID_REQUEST',422);
 return hash(value);
}
let loaded:Promise<MobilePushCrypto|null>|undefined;
async function encryption(){return loaded??=(async()=>loadMobilePushCrypto(mobilePushCryptoPath(process.env)))();}
export async function mobilePushRequest(url:URL,method:string,input:unknown,bearer:string|undefined,headers:IncomingHttpHeaders){
 const installation=/^\/api\/mobile\/v1\/notifications\/(customer|driver)\/installation$/.exec(url.pathname),open=/^\/api\/mobile\/v1\/notifications\/(customer|driver)\/events\/([^/]+)\/open$/.exec(url.pathname);
 if(!installation&&!open)return undefined;
 if(url.search)fail('INVALID_REQUEST',422);if(installation&&!['GET','POST'].includes(method)||open&&method!=='POST')fail('INVALID_REQUEST',405);
 const app=(installation??open)![1].toUpperCase() as 'CUSTOMER'|'DRIVER',key=installationProof(headers,'x-bitpos-push-installation-key',true)!,next=installationProof(headers,'x-bitpos-push-next-key',false),actor=await mobilePrincipal(bearer);
 const command=installation&&method==='POST'?MobilePushCommandSchema.parse(input):null;
 const openData=open?MobilePushOpenRequestSchema.parse(input):null,eventId=open?z.string().uuid().parse(open[2]):null;
 if(command?.kind==='ENABLE'?!next||next===key:next!==null)fail('INVALID_REQUEST',422);
 for(const value of [command?.expectedRevision,openData?.bindingGeneration])if(value!==undefined&&BigInt(value)>9223372036854775807n)fail('INVALID_REQUEST',422);
 if(command&&command.kind!=='DISABLE'&&Buffer.byteLength(command.fid,'utf8')>2048)fail('INVALID_REQUEST',422);
 let crypto:MobilePushCrypto|null=null;
 if(installation){try{crypto=await encryption();}catch(error){if(!(error instanceof MobilePushCryptoError))throw error;}}
 if(command&&command.kind!=='DISABLE'&&!crypto)throw new RequestError(503,'CONFIGURATION_REQUIRED','Push endpoint encryption unavailable');
 const encrypted=command&&command.kind!=='DISABLE'?crypto!.encrypt(command.fid,{app,deviceId:actor.deviceId}):null;
 try{return await withMobileDispatch(actor,async db=>{
  await db.query("SET LOCAL statement_timeout='2000ms';SET LOCAL lock_timeout='200ms'");
  await db.query("SELECT set_config('bitpos.mobile_device',$1,true),set_config('bitpos.mobile_access_hash',$2,true)",[actor.deviceId,hash(bearer!.slice(7))]);
  if(openData)return MobilePushOpenResultSchema.parse((await db.query('SELECT bitpos.mobile_push_open($1,$2,$3,$4,$5) v',[app,key,eventId,openData.bindingId,openData.bindingGeneration])).rows[0].v);
  if(command){const payload={...command} as Record<string,unknown>;delete payload.fid;
   return MobilePushReceiptSchema.parse((await db.query('SELECT bitpos.mobile_push_binding_command($1,$2,$3,$4,$5,$6,$7) v',[app,payload,key,next,encrypted?.endpointHash??null,encrypted?.ciphertext??null,encrypted?.keyId??null])).rows[0].v);
  }
  return MobilePushStatusSchema.parse({installation:(await db.query('SELECT bitpos.mobile_push_binding_status($1,$2) v',[app,key])).rows[0].v,endpointEncryptionAvailable:crypto!==null});
 });}catch(error){
  if(error instanceof Error&&['PUSH_INSTALLATION_CONFLICT','PUSH_ENDPOINT_CONFLICT'].includes(error.message))throw new RequestError(409,'VERSION_CONFLICT','Notification installation changed; reconcile current installation');
  if(error instanceof Error&&error.message==='PUSH_CONSENT_REQUIRED')throw new RequestError(409,'CONFIGURATION_REQUIRED','Explicit notification consent required');
  throw error;
 }
}
