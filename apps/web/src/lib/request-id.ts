// getRandomValues is available on HTTP LAN; randomUUID requires a secure context.
export function requestId():string {
 const rng=globalThis.crypto;
 if(typeof rng?.randomUUID==='function')return rng.randomUUID();
 if(typeof rng?.getRandomValues!=='function')throw new Error('Secure random identifiers are unavailable. Retain the saved request; no new submission is permitted.');
 const bytes=rng.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
