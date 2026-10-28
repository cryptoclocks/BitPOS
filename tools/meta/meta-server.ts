// Meta hackathon work (2026-10-26..11-04).
// A /meta-only HTTP server for exposing the tap, Messenger and Stripe webhook routes through a temporary
// tunnel without publishing the rest of the BitPOS API. Every non-/meta path is 404.
// Usage: npx tsx tools/meta/meta-server.ts <env-file>
// The env file (outside the repo) needs META_DB_URL (a disposable/test database, never the actual-use stack),
// META_TAP_MASTER_KEY, META_PUBLIC_URL and optionally the Messenger and Stripe test variables.
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import type {MetaDb} from '../../apps/api/src/meta/identity';

const envFile=process.argv[2];
if(!envFile)throw Error('usage: meta-server.ts <env-file>');
const env:Record<string,string>={};
for(const line of readFileSync(envFile,'utf8').split('\n')){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2];}
const dbUrl=env.META_DB_URL;
if(!dbUrl||!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)(:\d+)?\//.test(dbUrl))throw Error('META_DB_URL must point at a local test database');

// The inherited catalog module reads the API config at import; give it inert local values.
Object.assign(process.env,{DATABASE_URL:dbUrl,ADMIN_DATABASE_URL:dbUrl,AUTH_URL:'http://127.0.0.1:9',AUTH_ANON_KEY:'unused',APP_SECRET:randomBytes(32).toString('hex'),
 PUBLIC_URL:env.META_PUBLIC_URL,SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/nonexistent'});
const {effectiveCatalog}=await import('../../apps/api/src/catalog');
const {serveMeta,metaRouteDepsFromEnv}=await import('../../apps/api/src/meta/routes');

const pool=new pg.Pool({connectionString:dbUrl,max:5,options:'-c search_path=bitpos,public'});
pool.on('connect',c=>{c.query('SET ROLE bitpos_app');});
const db:MetaDb={
 query:(sql,params)=>pool.query(sql,params as unknown[]),
 tenant:async(merchant,fn)=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}},
};
const deps=metaRouteDepsFromEnv(env,db,effectiveCatalog);
if(!deps)throw Error('META_TAP_MASTER_KEY and META_PUBLIC_URL are required');
deps.log=msg=>console.log(new Date().toISOString(),msg);
const port=Number(env.META_PORT??3101);

http.createServer(async(req,res)=>{
 const started=Date.now();
 try{if(!(await serveMeta(req,res,deps))){res.writeHead(404,{'Content-Type':'text/plain'});res.end('not found');}}
 catch{if(!res.headersSent){res.writeHead(500,{'Content-Type':'text/plain'});res.end('error');}}
 // Path only: query strings can carry one-time tokens.
 console.log(new Date().toISOString(),req.method,(req.url??'').split('?')[0],res.statusCode,`${Date.now()-started}ms`);
}).listen(port,'127.0.0.1',()=>console.log(`meta-only server on http://127.0.0.1:${port} (messenger ${deps.messenger?'on':'off'}, stripe ${deps.stripe?'on':'off'}, offers ${deps.offers?.router?'muse spark':'fallback'})`));
