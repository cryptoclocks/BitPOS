// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. Copied from the PayPal edition (tools/paypal/sim-screen.ts).
// SIMULATED table screen for the hosted NEAR demo. It is NOT a BitPOS Mini and draws nothing: it connects as the
// demo shop's screen device so judges can place a table order and pay on NEAR testnet while no physical Mini is
// plugged in (table orders are refused with DEVICE_OFFLINE when the table's screen is offline).
// It speaks the same device protocol as the firmware (device/firmware/main/bitpos_table_runtime.inc):
//   first CONFIG of a connection -> CAPABILITIES once, the promotion capabilities of firmware 0.3.x (no pickup notice)
//   ORDER / SNAPSHOT / CART / CATALOG / PROMOTION / PROMOTION_PLAYLIST -> ACK rendered (what a screen does once the
//   frame is on the display), so a published offer settles as it does on a real Mini instead of being re-planned
// Circuit breaker (after the 10-11 Nov 2026 runaway, see evidence/oci-deploy-2026-10-31.md): more than 6 CONFIG frames
// in a minute, or more than 15 connections in 30 minutes, closes the socket and pauses this screen for 10 minutes.
//   HEARTBEAT every 30 s (the presence lease is 60 s)
//   a settled or closed bill that the server marks canDismiss -> ORDER_DISMISS after a short delay, so the table is
//   free for the next judge (a person presses "Done" on a real Mini).
// It never touches money: payment proof is still the bills contract state read by the server; the device only acknowledges.
// The device label carries "(simulated)" so the owner screens show it is not a physical screen.
// Credentials: each file named in BITPOS_SIM_SCREEN_FILES (comma separated) is the private JSON written by
// tools/near/device-credential.ts ({ws_url,merchant,terminal}); only its token is used, sent in the Authorization
// header to BITPOS_SIM_SCREEN_API (default ws://127.0.0.1:3106, the API on the same host). Tokens are never logged.
import {readFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';

const API=process.env.BITPOS_SIM_SCREEN_API??'ws://127.0.0.1:3106';
if(!/^wss?:\/\/[a-z0-9.:-]+$/.test(API))throw Error('BITPOS_SIM_SCREEN_API must be ws(s)://host[:port]');
const DISMISS_AFTER_MS=Number(process.env.BITPOS_SIM_SCREEN_DISMISS_MS??20000);
const HEARTBEAT_MS=30000;
const files=(process.env.BITPOS_SIM_SCREEN_FILES??'').split(',').map(s=>s.trim()).filter(Boolean);
if(!files.length)throw Error('BITPOS_SIM_SCREEN_FILES is empty');

type Order={id:string;status:string;version:number;canDismiss:boolean};
type Frame={type:string;eventId?:string;deviceSeq?:string;screenGeneration?:string;connectionGeneration?:string;requestId?:string;payload?:any;result?:{ok:boolean;error?:{code?:string}}};

function tokenOf(file:string){
 const j=JSON.parse(readFileSync(file,'utf8')) as {ws_url:string;terminal:string};
 const token=new URL(j.ws_url).searchParams.get('token')??'';
 if(!/^[A-Za-z0-9_-]{32,128}$/.test(token))throw Error(`${file}: no device token`);
 return {token,terminal:j.terminal};
}
const log=(name:string,msg:string)=>console.log(`${new Date().toISOString()} sim-screen[${name}] ${msg}`);

function run(file:string){
 // Deployed before its credential is issued: wait for the private file instead of crash-looping the container.
 if(!existsSync(file)){console.log(`${new Date().toISOString()} sim-screen waiting for ${file}`);setTimeout(()=>run(file),30000);return;}
 const {token,terminal}=tokenOf(file);const name=terminal.slice(0,8);
 let attempt=0;const connects:number[]=[];let pausedUntil=0;
 const connect=()=>{
  const now=Date.now();if(now<pausedUntil){setTimeout(connect,pausedUntil-now);return;}
  connects.push(now);while(connects.length&&connects[0]<now-30*60000)connects.shift();
  if(connects.length>15){pausedUntil=now+10*60000;connects.length=0;log(name,'circuit breaker: too many connections, pausing 10 min');setTimeout(connect,10*60000);return;}
  const configs:number[]=[];let declared=false;
  const ws=new WebSocket(`${API}/api/device`,{headers:{Authorization:'Bearer '+token}});
  let generation='',beat:NodeJS.Timeout|undefined,dismiss:NodeJS.Timeout|undefined,dismissKey='';
  const send=(c:Record<string,unknown>)=>{if(generation&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({schemaVersion:2,requestId:randomUUID(),connectionGeneration:generation,...c}));};
  const ack=(f:Frame,order:Order|null)=>send({type:'ACK',eventId:f.eventId,deviceSeq:f.deviceSeq,orderId:order?.id??null,orderVersion:order?.version??null,screenGeneration:f.screenGeneration,rendered:true});
  // PAID needs our render ACK first, so the ORDER frame that announces it still says canDismiss=false; the server
  // re-checks safeRelease() on ORDER_DISMISS and refuses anything unsafe, so a refused try is simply retried.
  const closed=(o:Order|null)=>!!o&&(o.canDismiss||['PAID','EXPIRED','RECOVERY'].includes(o.status));
  const plan=(order:Order|null,screen:string|undefined)=>{
   const key=closed(order)&&screen?`${order!.id}:${order!.version}:${screen}`:'';
   if(key===dismissKey)return;
   clearTimeout(dismiss);dismissKey=key;if(!key||!order||!screen)return;
   let tries=0;const attemptDismiss=()=>{if(dismissKey!==key||tries++>=3)return;log(name,`dismiss ${order.status} bill ${order.id.slice(0,8)} (try ${tries})`);send({type:'ORDER_DISMISS',orderId:order.id,orderVersion:order.version,screenGeneration:screen});dismiss=setTimeout(attemptDismiss,DISMISS_AFTER_MS);};
   dismiss=setTimeout(attemptDismiss,DISMISS_AFTER_MS);
  };
  ws.on('open',()=>{attempt=0;log(name,'connected');});
  ws.on('message',raw=>{
   let f:Frame;try{f=JSON.parse(raw.toString());}catch{return;}
   if(f.type==='COMMAND_RESULT'){if(f.result&&!f.result.ok)log(name,`command refused: ${f.result.error?.code??'unknown'}`);return;}
   if(f.type==='CONFIG'){
    const t=Date.now();configs.push(t);while(configs.length&&configs[0]<t-60000)configs.shift();
    if(configs.length>6){pausedUntil=t+10*60000;log(name,'circuit breaker: CONFIG flood, pausing 10 min');ws.close(1000);return;}
    generation=String(f.payload?.connectionGeneration??f.connectionGeneration??'');
    if(!declared){declared=true;send({type:'CAPABILITIES',capabilities:['promotion_v1','promotion_playlist_v1','promotion_playlist_v2','promotion_bundle_v1']});
     clearInterval(beat);beat=setInterval(()=>send({type:'HEARTBEAT',sessionId:null}),HEARTBEAT_MS);log(name,'configured');}
    if(f.eventId)ack(f,null);
    return;
   }
   if(!f.eventId||!f.deviceSeq||!f.screenGeneration)return;
   // Pickup notices are never acknowledged: this simulator declared no pickup capability.
   if(f.type==='ORDER'){const o=f.payload as Order;ack(f,o);plan(o,f.screenGeneration);log(name,`order ${o.id.slice(0,8)} ${o.status} v${o.version}`);return;}
   if(f.type==='SNAPSHOT'){const s=f.payload?.screen;const o=s?.kind==='order'?{...s.order,canDismiss:!!s.canDismiss} as Order:null;ack(f,o);plan(o,f.screenGeneration);return;}
   if(f.type==='CART'||f.type==='CATALOG'||f.type==='PROMOTION'||f.type==='PROMOTION_PLAYLIST')ack(f,null);
  });
  const retry=(why:string)=>{clearInterval(beat);clearTimeout(dismiss);generation='';const wait=Math.min(30000,1000*2**Math.min(attempt++,5));log(name,`${why}; reconnect in ${wait/1000}s`);setTimeout(connect,wait);};
  ws.on('close',code=>retry(`closed ${code}`));
  ws.on('error',error=>log(name,`error ${(error as Error).message}`));
 };
 connect();
}
for(const file of files)run(file);
