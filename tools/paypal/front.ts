// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Front door of the hosted PayPal edition on 127.0.0.1:3103, where the existing Cloudflare tunnel already sends
// paypal-pos.<domain> and paypal-pay.<domain>. Routes by path only:
//   POST /paypal/webhooks           → API   (raw body streamed unchanged: PayPal signs these exact bytes)
//   /paypal/messenger/webhook       → API   (Messenger ordering; Meta signs the raw body too)
//   /api/demo-session               → API   (quick sign-in checks the browser's Origin, which the web proxy drops)
//   WebSocket upgrade /api/device   → API   (BitPOS Mini; Authorization header passed through)
//   everything else                 → web   (pages; the web proxies its allow-listed /api routes to the API)
// No other upgrade path is accepted. Bodies are streamed, never buffered or logged.
import http from 'node:http';
import net from 'node:net';

const PORT=Number(process.env.BITPOS_PAYPAL_FRONT_PORT??3103);
const API=Number(process.env.BITPOS_PAYPAL_API_PORT??3104);
const WEB=Number(process.env.BITPOS_PAYPAL_WEB_PORT??4361);
const pathOf=(url:string|undefined)=>{try{return new URL(url??'/','http://front').pathname;}catch{return '';}};

const server=http.createServer((req,res)=>{
 const path=pathOf(req.url);
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
