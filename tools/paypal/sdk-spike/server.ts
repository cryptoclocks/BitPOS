// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Phase 0 spike: PayPal JS SDK v6 one-time payment against a server that creates and captures the order.
// Loopback only (http://127.0.0.1:4329). Sandbox only (sandbox-lib refuses anything else). Not product code.
//   pnpm exec tsx tools/paypal/sdk-spike/server.ts   → open http://127.0.0.1:4329
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {call,view,verify,save,load,newCheckout,env} from '../sandbox-lib';

const PORT=4329;
const page=readFileSync(join(import.meta.dirname,'index.html'),'utf8').replace('__CLIENT_ID__',env.PAYPAL_CLIENT_ID);
const json=(res:any,status:number,body:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};

createServer(async(req,res)=>{
 try{
  const url=new URL(req.url??'/','http://127.0.0.1');
  if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(page);}
  // The browser never sends an amount: the server decides it (fixture USD 4.50).
  if(req.method==='POST'&&url.pathname==='/api/orders'){
   const {s,payload}=newCheckout('4.50');
   const r=await call('POST','/v2/checkout/orders',s.createRequestId,payload);
   console.log(JSON.stringify({step:'create',http:r.status,debugId:r.debugId,orderId:r.body?.id,status:r.body?.status}));
   if(!r.body?.id)return json(res,502,{error:'CREATE_FAILED',issues:view(r.body).issues});
   save({...s,orderId:r.body.id,createdAt:new Date().toISOString(),createPayload:payload,source:'sdk-spike'});
   return json(res,201,{orderId:r.body.id});
  }
  const m=url.pathname.match(/^\/api\/orders\/([A-Z0-9]{10,30})\/capture$/);
  if(req.method==='POST'&&m){
   const s=load(m[1]);
   const r=await call('POST',`/v2/checkout/orders/${m[1]}/capture`,s.captureRequestId,{});
   const v=view(r.body),fail=r.status<300?verify(s,r.body):['http '+r.status];
   console.log(JSON.stringify({step:'capture',http:r.status,debugId:r.debugId,orderStatus:v.orderStatus,capture:v.capture?.id,captureStatus:v.capture?.status,reason:v.capture?.reason,verified:!fail.length,fail,issues:v.issues}));
   // "Paid" is decided by the server's verification, never by the SDK callback.
   return json(res,r.status<300?200:502,{paid:!fail.length,orderStatus:v.orderStatus,captureStatus:v.capture?.status,reason:v.capture?.reason,captureId:v.capture?.id,fail,issues:v.issues});
  }
  json(res,404,{error:'NOT_FOUND'});
 }catch(e){console.error(e);json(res,500,{error:String((e as Error).message).slice(0,200)});}
}).listen(PORT,'127.0.0.1',()=>console.log(`SDK spike on http://127.0.0.1:${PORT} (sandbox)`));
