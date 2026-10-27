// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// NTAG 424 DNA Secure Unique NFC (SUN) verification for the BitPOS Mini tap sticker.
// The sticker mirrors encrypted PICCData (UID + read counter) and a truncated AES-CMAC into its URL on
// every tap (NXP NT4H2421Gx datasheet, AN12196). Proving the CMAC shows a physical tap of this sticker;
// the caller must still require counter > last accepted counter atomically to stop replays.
import {createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';

export class SunError extends Error {constructor(readonly code:'MALFORMED'|'BAD_PICC_DATA'|'BAD_CMAC'|'UID_MISMATCH'){super(code);}}
export interface SunKeys {metaReadKey:Buffer;fileReadKey:Buffer}
export interface SunResult {uid:string;counter:number}

const ZERO=Buffer.alloc(16);
function aesEcb(key:Buffer,block:Buffer):Buffer{const c=createCipheriv('aes-128-ecb',key,null);c.setAutoPadding(false);return Buffer.concat([c.update(block),c.final()]);}
function shift1(b:Buffer):Buffer{const o=Buffer.alloc(16);for(let i=0;i<16;i++)o[i]=((b[i]<<1)|(i<15?b[i+1]>>7:0))&0xff;if(b[0]&0x80)o[15]^=0x87;return o;}

/** AES-CMAC (RFC 4493). */
export function aesCmac(key:Buffer,message:Buffer):Buffer{
 if(key.length!==16)throw Error('AES-128 key required');
 const k1=shift1(aesEcb(key,ZERO)),k2=shift1(k1);
 const n=Math.max(1,Math.ceil(message.length/16)),complete=message.length>0&&message.length%16===0;
 const last=Buffer.alloc(16);message.copy(last,0,(n-1)*16);
 if(!complete)last[message.length-(n-1)*16]=0x80;
 for(let i=0;i<16;i++)last[i]^=(complete?k1:k2)[i];
 let x:Buffer=Buffer.alloc(16);
 for(let b=0;b<n;b++){const block=b===n-1?last:message.subarray(b*16,b*16+16);const y=Buffer.alloc(16);for(let i=0;i<16;i++)y[i]=x[i]^block[i];x=aesEcb(key,y);}
 return x;
}

/** Per-sticker keys from a server-held master key, so one leaked sticker exposes only itself. */
export function deriveTagKeys(masterKey:Buffer,tagId:string):SunKeys{
 if(masterKey.length!==16||!/^[A-Za-z0-9_-]{4,64}$/.test(tagId))throw Error('Invalid tag key derivation input');
 const label=(n:number)=>Buffer.concat([Buffer.from([n]),Buffer.from('bitpos-meta-sdm-v1:','ascii'),Buffer.from(tagId,'ascii')]);
 return {metaReadKey:aesCmac(masterKey,label(1)),fileReadKey:aesCmac(masterKey,label(2))};
}

const HEX32=/^[0-9A-Fa-f]{32}$/,HEX16=/^[0-9A-Fa-f]{16}$/;

/**
 * @param piccHex 16-byte encrypted PICCData from the URL.
 * @param macHex 8-byte truncated SDMMAC from the URL.
 * @param macInput bytes between SDMMACInputOffset and SDMMACOffset (empty when the sticker is configured with them equal).
 * @param expectedUid the UID registered for this sticker, if already known.
 */
export function verifySun(keys:SunKeys,piccHex:string,macHex:string,macInput:Buffer=Buffer.alloc(0),expectedUid?:string):SunResult{
 if(!HEX32.test(piccHex)||!HEX16.test(macHex))throw new SunError('MALFORMED');
 const d=createDecipheriv('aes-128-cbc',keys.metaReadKey,ZERO);d.setAutoPadding(false);
 const plain=Buffer.concat([d.update(Buffer.from(piccHex,'hex')),d.final()]);
 const tag=plain[0];
 // Require UID and counter mirroring with a 7-byte UID: the only layout BitPOS provisions.
 if((tag&0x80)===0||(tag&0x40)===0||(tag&0x0f)!==7)throw new SunError('BAD_PICC_DATA');
 const uid=plain.subarray(1,8),ctr=plain.subarray(8,11);
 const sv2=Buffer.concat([Buffer.from([0x3c,0xc3,0x00,0x01,0x00,0x80]),uid,ctr]);
 const full=aesCmac(aesCmac(keys.fileReadKey,sv2),macInput);
 const truncated=Buffer.from([1,3,5,7,9,11,13,15].map(i=>full[i]));
 if(!timingSafeEqual(truncated,Buffer.from(macHex,'hex')))throw new SunError('BAD_CMAC');
 const uidHex=uid.toString('hex').toUpperCase();
 if(expectedUid!==undefined&&expectedUid.toUpperCase()!==uidHex)throw new SunError('UID_MISMATCH');
 return {uid:uidHex,counter:ctr[0]|(ctr[1]<<8)|(ctr[2]<<16)};
}
