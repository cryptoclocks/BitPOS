// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. Adapted from the PayPal edition's dev tool.
// Local sign-in stub for the NEAR preview: answers the API's password-grant call (AUTH_URL /token) for the three demo
// accounts of Orbit Café, so the browser's Quick sign-in works without a hosted auth service. Fixture database only;
// binds 127.0.0.1. Passwords are the random ones seed-demo wrote to local/private/demo-login.json (ignored by git).
//   pnpm exec tsx tools/near/dev-auth.ts
import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import {timingSafeEqual} from 'node:crypto';

const admin=new URL(process.env.ADMIN_DATABASE_URL??'');const auth=new URL(process.env.AUTH_URL??'');
if(admin.hostname!=='127.0.0.1'||admin.port!=='55477')throw Error('dev-auth only runs against the local NEAR fixture database (127.0.0.1:55477)');
if(auth.hostname!=='127.0.0.1')throw Error('AUTH_URL must point at 127.0.0.1 for the preview');
const IDS:Record<string,string>={owner:'4e454152-4e45-4152-8e45-0000000000a1',manager:'4e454152-4e45-4152-8e45-0000000000a2',staff:'4e454152-4e45-4152-8e45-0000000000a3'};
const accounts=JSON.parse(fs.readFileSync('local/private/demo-login.json','utf8')) as {email:string;password:string;role:string}[];
const same=(x:string,y:string)=>x.length===y.length&&timingSafeEqual(Buffer.from(x),Buffer.from(y));
http.createServer((req,res)=>{
 const url=new URL(req.url??'/','http://x');let body='';
 req.on('data',c=>{body+=c;if(body.length>4096)req.destroy();});
 req.on('end',()=>{
  let found:{email:string;role:string}|undefined;
  try{const b=JSON.parse(body);if(req.method==='POST'&&url.pathname.endsWith('/token')&&url.searchParams.get('grant_type')==='password'&&typeof b.email==='string'&&typeof b.password==='string')found=accounts.find(a=>a.email===b.email&&same(a.password,b.password));}catch{/* malformed body: reject */}
  res.writeHead(found?200:400,{'content-type':'application/json'});res.end(JSON.stringify(found?{user:{id:IDS[found.role],email:found.email}}:{error:'invalid_grant'}));
 });
}).listen(Number(auth.port),'127.0.0.1',()=>console.log(`Demo sign-in stub on ${auth.origin} for ${accounts.map(a=>a.email).join(', ')}`));
