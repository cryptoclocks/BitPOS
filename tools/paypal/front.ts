// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Front door of the hosted PayPal edition on 127.0.0.1:3103, where the existing Cloudflare tunnel already sends
// paypal-pos.<domain> and paypal-pay.<domain>. Routes by path only:
//   POST /paypal/webhooks           → API   (raw body streamed unchanged: PayPal signs these exact bytes)
//   /paypal/messenger/webhook       → API   (Messenger ordering; Meta signs the raw body too)
//   /api/demo-session               → API   (quick sign-in checks the browser's Origin, which the web proxy drops)
//   WebSocket upgrade /api/device   → API   (BitPOS Mini; Authorization header passed through)
//   everything else                 → web   (pages; the web proxies its allow-listed /api routes to the API)
//   Host paypal.<domain> (BITPOS_PAYPAL_SITE_HOST) → the static presentation site in tools/paypal/site (GET/HEAD only)
// No other upgrade path is accepted. Bodies are streamed, never buffered or logged.
import http from 'node:http';
import net from 'node:net';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const PORT=Number(process.env.BITPOS_PAYPAL_FRONT_PORT??3103);
const API=Number(process.env.BITPOS_PAYPAL_API_PORT??3104);
const WEB=Number(process.env.BITPOS_PAYPAL_WEB_PORT??4361);
const SITE_HOST=(process.env.BITPOS_PAYPAL_SITE_HOST??'paypal.cashlessthailand.com').toLowerCase();
const SITE=fileURLToPath(new URL('./site/',import.meta.url));
const TYPES:Record<string,string>={html:'text/html; charset=utf-8',jpg:'image/jpeg',png:'image/png'};
/** Only index.html and img/<name>.(jpg|png) are served: no directory listing, no traversal. */
function serveSite(path:string,method:string,res:http.ServerResponse){
 if(method!=='GET'&&method!=='HEAD'){res.writeHead(405,{allow:'GET, HEAD'});res.end();return;}
 const file=path==='/'||path==='/index.html'?'index.html':/^\/img\/[a-z0-9-]{1,40}\.(jpg|png)$/.test(path)?path.slice(1):null;
 if(!file||!existsSync(SITE+file)){res.writeHead(file?404:path.startsWith('/img/')?404:302,file||path.startsWith('/img/')?{'content-type':'text/plain'}:{location:'/'});res.end(file?'not found':'');return;}
 const body=readFileSync(SITE+file);const ext=file.split('.').pop()!;
 res.writeHead(200,{'content-type':TYPES[ext],'cache-control':ext==='html'?'no-cache':'public, max-age=86400','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','content-length':String(body.length)});
 res.end(method==='HEAD'?undefined:body);
}
const pathOf=(url:string|undefined)=>{try{return new URL(url??'/','http://front').pathname;}catch{return '';}};

const server=http.createServer((req,res)=>{
 const path=pathOf(req.url);
 if((req.headers.host??'').toLowerCase().split(':')[0]===SITE_HOST){serveSite(path,req.method??'GET',res);return;}
 const port=path==='/paypal/webhooks'||path==='/paypal/messenger/webhook'||path==='/api/demo-session'?API:WEB;
 const upstream=http.request({host:'127.0.0.1',port,method:req.method,path:req.url,headers:req.headers},r=>{res.writeHead(r.statusCode??502,r.headers);r.pipe(res);});
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'content-type':'application/json'});res.end('{"error":"UPSTREAM_UNAVAILABLE"}');});
 req.pipe(upstream);
});
server.on('upgrade',(req,socket,head)=>{
 if(pathOf(req.url)!=='/api/device'){socket.destroy();return;}
 const upstream=net.connect(API,'127.0.0.1',()=>{
  const lines=[`${req.method} ${req.url} HTTP/1.1`];
  for(let i=0;i<req.rawHeaders.length;i+=2)lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i+1]}`);
  upstream.write(lines.join('\r\n')+'\r\n\r\n');if(head.length)upstream.write(head);
  socket.pipe(upstream).pipe(socket);
 });
 const close=()=>{socket.destroy();upstream.destroy();};
 upstream.on('error',close);socket.on('error',close);upstream.on('close',()=>socket.destroy());socket.on('close',()=>upstream.destroy());
});
server.listen(PORT,'127.0.0.1',()=>console.log(`PayPal front on 127.0.0.1:${PORT} → api ${API} (webhooks, device) · web ${WEB}`));
