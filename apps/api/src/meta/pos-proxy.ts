// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// meta-pos is the POS (Meta edition, infra/meta/pos-compose.yaml) plus the Meta pages under /meta/. The Cloudflare
// route for the meta-pos host points at this Meta server, so requests to that host outside /meta/ are passed to the
// POS web server on loopback, streaming both ways (pages, /api JSON, server-sent events and WebSocket upgrades).
import http from 'node:http';
import net from 'node:net';
import type {Duplex} from 'node:stream';

export interface PosProxy {host:string;target:URL}
/** META_POS_WEB_ORIGIN (loopback http only) + the staff host; null when not configured. */
export function posProxyFromEnv(env:Record<string,string|undefined>):PosProxy|null{
 const t=env.META_POS_WEB_ORIGIN,s=env.META_STAFF_URL;
 if(!t||!s)return null;
 const target=new URL(t);
 if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname)||target.pathname!=='/')return null;
 return {host:new URL(s).host,target};
}
const mine=(p:PosProxy,req:http.IncomingMessage)=>(req.headers.host??'').toLowerCase()===p.host&&!(req.url??'/').startsWith('/meta/');

/** Returns true when it took the request. */
export function proxyPos(p:PosProxy,req:http.IncomingMessage,res:http.ServerResponse):boolean{
 if(!mine(p,req))return false;
 const up=http.request({host:p.target.hostname,port:p.target.port,method:req.method,path:req.url,headers:{...req.headers,'x-forwarded-host':req.headers.host??'','x-forwarded-proto':'https'}},r=>{
  res.writeHead(r.statusCode??502,r.headers);r.pipe(res);
 });
 up.on('error',()=>{if(!res.headersSent){res.writeHead(502,{'Content-Type':'text/plain'});res.end('meta-pos is restarting, try again');}else res.destroy();});
 req.pipe(up);
 return true;
}
export function proxyPosUpgrade(p:PosProxy,req:http.IncomingMessage,socket:Duplex,head:Buffer):boolean{
 if(!mine(p,req))return false;
 const up=net.connect(Number(p.target.port),p.target.hostname,()=>{
  up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).flatMap(([k,v])=>(Array.isArray(v)?v:[v]).map(x=>`${k}: ${x}`)).join('\r\n')}\r\n\r\n`);
  if(head.length)up.write(head);
  up.pipe(socket);socket.pipe(up);
 });
 const close=()=>{up.destroy();socket.destroy();};up.on('error',close);socket.on('error',close);
 return true;
}
