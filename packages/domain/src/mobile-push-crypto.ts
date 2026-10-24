import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
export class MobilePushCryptoError extends Error{constructor(){super('PUSH_ENCRYPTION_UNAVAILABLE');}}
export type MobilePushEndpointContext={app:'CUSTOMER'|'DRIVER';deviceId:string;endpointHash:string};
export type MobilePushCipher={ciphertext:string;keyId:string;endpointHash:string};
export interface MobilePushCrypto{encrypt(fid:string,context:Omit<MobilePushEndpointContext,'endpointHash'>):MobilePushCipher;decrypt(cipher:MobilePushCipher,context:Omit<MobilePushEndpointContext,'endpointHash'>):string;}
const digest=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
const aad=(context:MobilePushEndpointContext)=>Buffer.from(JSON.stringify([context.app,context.deviceId,context.endpointHash]),'utf8');
function validFid(fid:string){return typeof fid==='string'&&Buffer.byteLength(fid)>=1&&Buffer.byteLength(fid)<=2048&&!/\s|[\x00-\x1f\x7f]/u.test(fid);}
export function createMobilePushCrypto(keyring:unknown):MobilePushCrypto{
 try{
  if(!keyring||typeof keyring!=='object'||Array.isArray(keyring))throw new MobilePushCryptoError();
  const raw=keyring as Record<string,unknown>;
  if(Object.keys(raw).sort().join(',')!=='active,keys'||typeof raw.active!=='string'||!/^[A-Za-z0-9_-]{1,40}$/.test(raw.active)||!raw.keys||typeof raw.keys!=='object'||Array.isArray(raw.keys))throw new MobilePushCryptoError();
  const keys=new Map<string,Buffer>(),entries=Object.entries(raw.keys);
  if(entries.length<1||entries.length>8)throw new MobilePushCryptoError();
  for(const [id,value]of entries){if(!/^[A-Za-z0-9_-]{1,40}$/.test(id)||typeof value!=='string')throw new MobilePushCryptoError();const key=Buffer.from(value,'base64');if(key.length!==32||key.toString('base64')!==value)throw new MobilePushCryptoError();keys.set(id,key);}
  const active=raw.active;if(!keys.has(active))throw new MobilePushCryptoError();
  return{
   encrypt(fid,context){try{if(!validFid(fid))throw new MobilePushCryptoError();const endpointHash=digest(fid),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keys.get(active)!,nonce);cipher.setAAD(aad({...context,endpointHash}));const ciphertext=Buffer.concat([nonce,cipher.update(fid,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64url');return{ciphertext,keyId:active,endpointHash};}catch{throw new MobilePushCryptoError();}},
   decrypt(value,context){try{const key=keys.get(value.keyId);if(!key||!/^[0-9a-f]{64}$/.test(value.endpointHash)||typeof value.ciphertext!=='string'||value.ciphertext.length>8192)throw new MobilePushCryptoError();const bytes=Buffer.from(value.ciphertext,'base64url');if(bytes.length<29||bytes.toString('base64url')!==value.ciphertext)throw new MobilePushCryptoError();const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAAD(aad({...context,endpointHash:value.endpointHash}));decipher.setAuthTag(bytes.subarray(-16));const fid=Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString('utf8');if(!validFid(fid)||digest(fid)!==value.endpointHash)throw new MobilePushCryptoError();return fid;}catch{throw new MobilePushCryptoError();}},
  };
 }catch{throw new MobilePushCryptoError();}
}
export function mobilePushCryptoPath(env:NodeJS.ProcessEnv):string|null{
 const value=env.BITPOS_PUSH_ENDPOINT_KEYRING_FILE;if(!value)return null;if(!isAbsolute(value))throw new MobilePushCryptoError();return value;
}
export async function loadMobilePushCrypto(path:string|null,reader:(path:string)=>Promise<string>=(p)=>readFile(p,'utf8')):Promise<MobilePushCrypto|null>{
 if(path===null)return null;try{if(!isAbsolute(path))throw new MobilePushCryptoError();const text=await reader(path);if(Buffer.byteLength(text)>8192)throw new MobilePushCryptoError();return createMobilePushCrypto(JSON.parse(text));}catch{throw new MobilePushCryptoError();}
}
