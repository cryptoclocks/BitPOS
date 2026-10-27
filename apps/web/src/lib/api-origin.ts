/** Server-only upstream selection. Never derived from request headers or query. */
export function localApiOrigin(configured: string | undefined): string {
 if(configured===undefined)return 'http://127.0.0.1:3001';
 const url=new URL(configured);
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('BITPOS_WEB_API_ORIGIN must be a plain loopback HTTP origin');
 return url.origin;
}
