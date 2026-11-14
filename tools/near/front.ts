// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. Adapted from the PayPal edition (tools/paypal/front.ts).
// Front door of the hosted NEAR edition on 127.0.0.1:3105, where the Cloudflare tunnel sends near.<domain>,
// near-pos.<domain> and near-pay.<domain>. Routes by host, then path:
//   Host near.<domain> (BITPOS_NEAR_SITE_HOST) → the static presentation site in apps/near-site (GET/HEAD only)
//   /api/demo-session               → API   (quick sign-in checks the browser's Origin, which the web proxy drops)
//   /near/device/*                  → API   (BitPOS Mini witness protocol: state, register, ack)
//   /near/anim/<name>.gif           → the site's offer animations (BitPOS Mini idle screen)
//   WebSocket upgrade /api/device   → API   (screens; Authorization header passed through)
//   everything else                 → web   (pages; the web proxies its allow-listed /api routes to the API)
// Bodies are streamed, never buffered or logged.
import http from 'node:http';
import net from 'node:net';
import {createReadStream,existsSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {normalize} from 'node:path';

const PORT=Number(process.env.BITPOS_NEAR_FRONT_PORT??3105);
const API=Number(process.env.BITPOS_NEAR_API_PORT??3106);
const WEB=Number(process.env.BITPOS_NEAR_WEB_PORT??4381);
const SITE_HOST=(process.env.BITPOS_NEAR_SITE_HOST??'near.cashlessthailand.com').toLowerCase();
const SITE=fileURLToPath(new URL(process.env.BITPOS_NEAR_SITE_DIR?`file://${process.env.BITPOS_NEAR_SITE_DIR}/`:'../../apps/near-site/',import.meta.url));
const TYPES:Record<string,string>={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',json:'application/json',svg:'image/svg+xml',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',ico:'image/x-icon',mp4:'video/mp4',woff2:'font/woff2',woff:'font/woff',ttf:'font/ttf',txt:'text/plain; charset=utf-8',xml:'application/xml'};
const CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'";
/** Files under apps/near-site only (no listing, no traversal, no dotfiles); Range requests for video. */
function serveSite(req:http.IncomingMessage,path:string,res:http.ServerResponse){
 const method=req.method??'GET';
 if(method!=='GET'&&method!=='HEAD'){res.writeHead(405,{allow:'GET, HEAD'});res.end();return;}
 let rel=decodeURIComponent(path);if(rel.endsWith('/'))rel+='index.html';
 rel=normalize(rel).replace(/^(\.\.(\/|\\|$))+/,'');
 const ext=(rel.split('.').pop()??'').toLowerCase();
 if(rel.split('/').some(p=>p.startsWith('.'))||!TYPES[ext]){res.writeHead(404,{'content-type':'text/plain'});res.end('not found');return;}
 const file=SITE+rel.replace(/^\//,'');
 if(!file.startsWith(SITE)||!existsSync(file)||!statSync(file).isFile()){res.writeHead(404,{'content-type':'text/plain'});res.end('not found');return;}
 const size=statSync(file).size;
 const head:Record<string,string>={'content-type':TYPES[ext],'cache-control':ext==='html'?'no-cache':'public, max-age=86400','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','accept-ranges':'bytes'};
 if(ext==='html')head['content-security-policy']=CSP;
 const range=/^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range??''));
 if(range&&(range[1]||range[2])){
  let start=range[1]?Number(range[1]):Math.max(0,size-Number(range[2]));let end=range[1]&&range[2]?Number(range[2]):size-1;end=Math.min(end,size-1);
  if(start>end||start>=size){res.writeHead(416,{'content-range':`bytes */${size}`});res.end();return;}
  res.writeHead(206,{...head,'content-range':`bytes ${start}-${end}/${size}`,'content-length':String(end-start+1)});
  if(method==='HEAD'){res.end();return;}createReadStream(file,{start,end}).pipe(res);return;
 }
 res.writeHead(200,{...head,'content-length':String(size)});
 if(method==='HEAD'){res.end();return;}createReadStream(file).pipe(res);
}
const pathOf=(url:string|undefined)=>{try{return new URL(url??'/','http://front').pathname;}catch{return '';}};

const server=http.createServer((req,res)=>{
 const path=pathOf(req.url);
 if((req.headers.host??'').toLowerCase().split(':')[0]===SITE_HOST){serveSite(req,path,res);return;}
 // Offer animations for the BitPOS Mini idle screen (files in apps/near-site/assets/anim), on any of the three hosts.
 const anim=path.match(/^\/near\/anim\/([a-z0-9-]{1,40}\.gif)$/);if(anim){serveSite(req,'/assets/anim/'+anim[1],res);return;}
 const port=path==='/api/demo-session'||path.startsWith('/near/device/')?API:WEB;
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
server.listen(PORT,'127.0.0.1',()=>console.log(`NEAR front on 127.0.0.1:${PORT} → api ${API} (demo session, witness, device) · web ${WEB} · site ${SITE_HOST}`));
