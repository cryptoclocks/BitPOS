// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Host split: customer pages on META_PUBLIC_URL's host, staff pages on META_STAFF_URL's host, and the shop's
// menu photos served by the /meta container itself. No database is touched by these routes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {serveMeta,type MetaRouteDeps} from '../apps/api/src/meta/routes';

const db={query:async()=>{throw Error('no db');},tenant:async()=>{throw Error('no db');}} as unknown as MetaRouteDeps['identity']['db'];
const routeDeps:MetaRouteDeps={identity:{db,masterKey:Buffer.alloc(16),publicOrigin:'https://meta-pay.example.test'},messenger:null,offers:null,
 staff:{db,config:{origin:'https://meta-pos.example.test',authUrl:'http://127.0.0.1:9',anonKey:'x',demoLoginFile:null}} as unknown as MetaRouteDeps['staff']};

async function withServer(fn:(get:(path:string,host:string)=>Promise<{status:number;location?:string;type?:string;bytes:number}>)=>Promise<void>){
 const server=http.createServer(async(req,res)=>{if(!(await serveMeta(req,res,routeDeps))){res.writeHead(404);res.end();}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as AddressInfo).port;
 const get=(path:string,host:string)=>new Promise<{status:number;location?:string;type?:string;bytes:number}>((resolve,reject)=>{
  http.get({host:'127.0.0.1',port,path,headers:{host}},res=>{let bytes=0;res.on('data',c=>{bytes+=c.length;});res.on('end',()=>resolve({status:res.statusCode??0,location:res.headers.location,type:res.headers['content-type'],bytes}));}).on('error',reject);
 });
 try{await fn(get);}finally{server.close();}
}

test('staff pages redirect to the staff host; the staff host answers nothing else',async()=>{
 await withServer(async get=>{
  const fromPay=await get('/meta/staff/offers','meta-pay.example.test');
  assert.equal(fromPay.status,302);assert.equal(fromPay.location,'https://meta-pos.example.test/meta/staff/offers');
  assert.equal((await get('/meta/staff','pay.example.test')).location,'https://meta-pos.example.test/meta/staff','legacy shared host');
  assert.equal((await get('/meta/staff','meta-pos.example.test')).status,200);
  for(const p of ['/meta/order','/meta/messenger/webhook','/meta/images/menu/latte.jpg','/meta/t/abcd'])assert.equal((await get(p,'meta-pos.example.test')).status,404,p);
  assert.equal((await get('/meta/staff',`127.0.0.1`)).status,200,'loopback health check is not redirected');
 });
});

test('menu photos are served from /meta/images/menu, with no path traversal',async()=>{
 await withServer(async get=>{
  const ok=await get('/meta/images/menu/latte.jpg','meta-pay.example.test');
  assert.equal(ok.status,200);assert.equal(ok.type,'image/jpeg');assert.ok(ok.bytes>1000);
  assert.equal((await get('/meta/images/menu/missing.jpg','meta-pay.example.test')).status,404);
  for(const p of ['/meta/images/menu/..%2f..%2fpackage.json','/meta/images/menu/../../x.jpg','/meta/images/menu/LATTE.JPG'])assert.notEqual((await get(p,'meta-pay.example.test')).status,200,p);
 });
});
