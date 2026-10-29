// Product merchant component against an explicitly owned running disposable clone.
import assert from 'node:assert/strict';import pg from 'pg';import {randomUUID,randomBytes,createHash} from 'node:crypto';import {createServer} from 'node:http';import {build} from '../../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js';
const name=process.argv[2];assert.match(name??'',/^bitpos_refund_commit_[a-f0-9]{12}$/);const db=new pg.Client({host:'127.0.0.1',port:55446,database:name});await db.connect();let server:ReturnType<typeof createServer>|undefined;
try{
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,name);
 const records=(await db.query('SELECT r.order_id,r.merchant_id,c.assignment_id FROM bitpos.food_return108_financial_reviews r JOIN bitpos.food_return108_cases c ON c.id=r.case_id JOIN bitpos.food_return109_decisions d ON d.case_id=r.case_id WHERE d.decision=\'LINE_REFUND\'')).rows;assert.equal(records.length,1);const record=records[0];
 await db.query('GRANT EXECUTE ON FUNCTION bitpos.food_refund118_merchant(uuid,text),bitpos.food_return108_snapshot(uuid,text) TO bitpos_app');
 const token=randomBytes(32).toString('base64url'),user=randomUUID(),hash=createHash('sha256').update(token).digest('hex');await db.query("INSERT INTO bitpos.members(user_id,merchant_id,role)VALUES($1,$2,'owner')",[user,record.merchant_id]);await db.query("INSERT INTO bitpos.sessions VALUES($1,$2,$3,'owner',clock_timestamp()+interval '1 hour')",[hash,user,record.merchant_id]);
 const session={token,userId:user,merchantId:record.merchant_id,role:'owner'};
 const source=`import React from 'react';import{createRoot}from'react-dom/client';import MerchantFoodReturn from './apps/web/src/components/MerchantFoodReturn.tsx';import './apps/web/src/styles/platform.css';const f=await(await fetch('/bootstrap')).json();createRoot(document.getElementById('root')).render(<main className="platform"><h1>Merchant selected refund · local fixture</h1><MerchantFoodReturn session={f.session} orderId={f.orderId} assignmentId={f.assignmentId} language={new URLSearchParams(location.search).get('lang')==='th'?'th':'en'} onChange={()=>{}}/></main>);`;
 const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'/tmp/bitpos-refund135-merchant',format:'esm',jsx:'automatic'});const js=bundle.outputFiles?.find(f=>f.path.endsWith('.js'))?.text,css=bundle.outputFiles?.find(f=>f.path.endsWith('.css'))?.text;assert.ok(js&&css);
 let finish!:()=>void;const finished=new Promise<void>(resolve=>{finish=resolve;});
 server=createServer(async(req,res)=>{try{
  if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return;}
  if(req.url==='/bootstrap'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({session,orderId:record.order_id,assignmentId:record.assignment_id}));return;}
  if(req.url==='/revoke'&&req.method==='POST'){await db.query('DELETE FROM bitpos.sessions WHERE token_hash=$1',[hash]);res.end('{}');return;}
  if(req.url==='/finish'&&req.method==='POST'){res.end('{}');finish();return;}
  if(req.url?.startsWith('/api/')){const response=await fetch('http://127.0.0.1:3048'+req.url,{headers:{...(req.headers.authorization?{Authorization:req.headers.authorization}:{})}});res.statusCode=response.status;res.setHeader('Content-Type','application/json');res.end(await response.text());return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><meta name="viewport" content="width=device-width"><style>'+css+'</style><div id="root"></div><script type="module" src="/app.js"></script></html>');
 }catch{res.statusCode=502;res.end('{}');}});
 await new Promise<void>(resolve=>server!.listen(4424,'127.0.0.1',resolve));console.log('REFUND135_MERCHANT_READY');await finished;
}finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await db.end();}
