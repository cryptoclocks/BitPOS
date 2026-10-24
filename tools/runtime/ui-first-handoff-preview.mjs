// Explicit local presentation fixture. No database, provider or business mutation.
// Run: node tools/runtime/ui-first-handoff-preview.mjs; inspect loopback URLs.
import {build} from '../../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const states=['WAITING_MERCHANT','WAITING_PAYMENT','READY_FOR_DISPATCH','OFFERING','ASSIGNED','AT_PICKUP','PICKED_UP','AT_DROPOFF','DELIVERED','CANCELLED','FAILED','INCIDENT'];
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const requests=[];
const source=`import React from 'react';import{createRoot}from'react-dom/client';import FoodHandoff from './apps/web/src/components/FoodHandoff.tsx';import './apps/web/src/styles/app.css';import './apps/web/src/styles/order-center-fidelity.css';
const params=new URL(location.href).searchParams;const language=params.get('lang')==='th'?'th':'en';
 const recoveryKey='bitpos.foodReturn.receive.${id(1)}.${id(2)}.${id(3)}';if(params.has('pending'))localStorage.setItem(recoveryKey,JSON.stringify({assignmentId:'${id(5)}',caseId:'${id(6)}',command:{idempotencyKey:'${id(7)}',expectedVersion:'1',condition:'SEALED',reason:'LOCAL unresolved receipt fixture'}}));else localStorage.removeItem(recoveryKey);
createRoot(document.getElementById('root')).render(<div className="shell" lang={language}><main className="incoming-board"><section className="fulfillment-detail"><p role="note">LOCAL PRESENTATION FIXTURE — no real order, payment or delivery</p><FoodHandoff session={{token:'presentation-fixture-not-a-session',merchantId:'${id(1)}',userId:'${id(2)}',role:'owner'}} orderId="${id(3)}" language={language} onChange={()=>{}}/></section></main></div>);`;
const bundled=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},external:['/fonts/*'],bundle:true,write:false,outdir:'/tmp/bitpos-ui-first-handoff',format:'esm',jsx:'automatic'});
const js=bundled.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundled.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(js);}
 if(url.pathname.startsWith('/fonts/')){const font=url.pathname.slice(7);if(!['bitpos-noto-sans-thai-variable.ttf','bitpos-inter-variable.ttf'].includes(font)){res.writeHead(404);return res.end();}res.setHeader('Content-Type','font/ttf');return res.end(await readFile('apps/web/public/fonts/'+font));}
 if(url.pathname==='/fixture-requests'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(requests));}
 if(url.pathname.startsWith('/api/')){
  res.setHeader('Content-Type','application/json');
  if(req.method!=='GET'){let body='';for await(const chunk of req)body+=chunk;requests.push({method:req.method,path:url.pathname,body:JSON.parse(body)});res.writeHead(503);return res.end(JSON.stringify({error:{code:'UNAVAILABLE',message:'Synthetic unresolved response; exact command must remain saved'}}));}
  const params=new URL(req.headers.referer??'http://127.0.0.1').searchParams;
  if(params.get('failure')==='denied'){res.writeHead(403);return res.end(JSON.stringify({error:{code:'FORBIDDEN',message:'Synthetic denied fixture'}}));}
  if(params.get('failure')==='connection'){res.writeHead(503);return res.end(JSON.stringify({error:{code:'UNAVAILABLE',message:'Synthetic unavailable fixture'}}));}
  const state=params.get('state')??'WAITING_MERCHANT';if(!states.includes(state)){res.writeHead(400);return res.end(JSON.stringify({error:{code:'INVALID_REQUEST',message:'Unknown fixture state'}}));}
   if(url.pathname.includes('/food/assignments/')){
    const state=params.get('return');
    return res.end(JSON.stringify({assignmentId:id(5),shipmentVersion:'1',case:state?{caseId:id(6),state,requestedAt:'2026-10-23T00:00:00.000Z',receivedAt:state==='RETURN_REQUESTED'?null:'2026-10-23T00:01:00.000Z',condition:state==='RETURN_REQUESTED'?null:'SEALED',resolvedAt:state==='RETURN_RESOLVED'?'2026-10-23T00:02:00.000Z':null,custodyReleased:state==='RETURN_RESOLVED',financialReview:'NOT_OPENED'}:null}));
   }
  const assignmentState=({ASSIGNED:'ACCEPTED',AT_PICKUP:'AT_PICKUP',PICKED_UP:'PICKED_UP',AT_DROPOFF:'AT_DROPOFF',INCIDENT:'INCIDENT'})[state];
  return res.end(JSON.stringify({shipmentId:id(4),state,version:'1',generation:'1',assignment:assignmentState?{id:id(5),state:assignmentState,generation:'1',leaseGeneration:'1',rider:null,pickupProof:null}:null}));
 }
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>'+css+'</style><div id="root"></div><script type="module" src="/fixture.js"></script>');
});
server.listen(4399,'127.0.0.1',()=>console.log('LOCAL_HANDOFF_PRESENTATION_READY http://127.0.0.1:4399/?state=AT_PICKUP&lang=en'));
