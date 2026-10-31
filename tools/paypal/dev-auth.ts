// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Local sign-in stub for the PayPal preview: answers the API's password-grant call (AUTH_URL /token) for one demo
// owner of the demo shop, so the browser can sign in without a hosted auth service. Fixture database only; binds
// 127.0.0.1. The demo password is generated once into ~/.bitpos-paypal/demo-owner.env (chmod 600), never the repo.
//   pnpm exec tsx tools/paypal/dev-auth.ts
import 'dotenv/config';
import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const admin=new URL(process.env.ADMIN_DATABASE_URL??'');const auth=new URL(process.env.AUTH_URL??'');
if(admin.hostname!=='127.0.0.1'||admin.port!=='55466')throw Error('dev-auth only runs against the local PayPal fixture database (127.0.0.1:55466)');
if(auth.hostname!=='127.0.0.1')throw Error('AUTH_URL must point at 127.0.0.1 for the preview');
const SHOP='33333333-3333-4333-8333-333333333333',OWNER='33333333-3333-4333-8333-0000000000a1',EMAIL='owner@paypal-cafe.test';
const file=join(homedir(),'.bitpos-paypal/demo-owner.env');
if(!existsSync(file))writeFileSync(file,`BITPOS_DEMO_OWNER_EMAIL=${EMAIL}\nBITPOS_DEMO_OWNER_PASSWORD=${randomBytes(12).toString('base64url')}\n`,{mode:0o600});
const password=readFileSync(file,'utf8').match(/^BITPOS_DEMO_OWNER_PASSWORD=(.+)$/m)![1].trim();
const pg=(await import('pg')).default;const a=new pg.Client({connectionString:admin.href});await a.connect();
await a.query("INSERT INTO bitpos.members(user_id,merchant_id,role) VALUES($1,$2,'owner') ON CONFLICT(user_id,merchant_id) DO UPDATE SET role='owner'",[OWNER,SHOP]);await a.end();
const same=(x:string,y:string)=>x.length===y.length&&timingSafeEqual(Buffer.from(x),Buffer.from(y));
http.createServer((req,res)=>{
 const url=new URL(req.url??'/','http://x');let body='';
 req.on('data',c=>{body+=c;if(body.length>4096)req.destroy();});
 req.on('end',()=>{
  let ok=false;try{const b=JSON.parse(body);ok=req.method==='POST'&&url.pathname.endsWith('/token')&&url.searchParams.get('grant_type')==='password'&&b.email===EMAIL&&typeof b.password==='string'&&same(b.password,password);}catch{/* malformed body: reject */}
  res.writeHead(ok?200:400,{'content-type':'application/json'});res.end(JSON.stringify(ok?{user:{id:OWNER,email:EMAIL}}:{error:'invalid_grant'}));
 });
}).listen(Number(auth.port),'127.0.0.1',()=>console.log(`Demo sign-in stub on ${auth.origin} for ${EMAIL} (password in ${file})`));
