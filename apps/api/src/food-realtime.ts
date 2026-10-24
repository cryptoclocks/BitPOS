import {createHash,createHmac} from 'node:crypto';
import type {IncomingMessage,ServerResponse,Server} from 'node:http';
import type pg from 'pg';
import {pool} from './db';
import {config} from './config';
import {mobilePrincipal} from './mobile-auth';
import {withMobileDispatch} from './driver-platform';
import {RequestError} from './authority';
import {FoodCustomerRealtimeSnapshotSchema,FoodDriverRealtimeSnapshotSchema,FoodChatRealtimeSnapshotSchema} from '../../../packages/contracts/src/mobile-v1.generated';

const wakes=new Set<()=>void>();
const accounts=new Map<string,number>();
let activeTransports=0;
// Notifications are empty commit-time hints. Reconciliation still runs if LISTEN fails.
export function attachFoodRealtime(server:Server){
 let stopped=false,disposeListener:(()=>void)|undefined,retry:ReturnType<typeof setTimeout>|undefined;
 function schedule(){if(!stopped&&!retry)retry=setTimeout(()=>{retry=undefined;void connect();},5000);}
 async function connect(){
  let dispose:(()=>void)|undefined;
  try{
   const db=await pool.connect();let owned=true;
   dispose=()=>{if(!owned)return;owned=false;if(disposeListener===dispose)disposeListener=undefined;db.release(true);schedule();};
   if(stopped){dispose();return;}
   disposeListener=dispose;
   db.on('notification',()=>{for(const wake of wakes)wake();});
   db.on('error',dispose);
   await db.query('LISTEN bitpos_food_realtime');
  }catch{if(dispose)dispose();else schedule();}
 }
 server.once('listening',()=>void connect());
 server.once('close',()=>{stopped=true;clearTimeout(retry);disposeListener?.();for(const wake of wakes)wake();});
}
export async function foodRealtime(req:IncomingMessage,res:ServerResponse):Promise<boolean>{
 const url=new URL(req.url??'/',config.PUBLIC_URL);
 const customer=url.pathname.match(/^\/api\/mobile\/v1\/food\/orders\/([0-9a-f-]{36})\/delivery\/events$/);
 const chat=url.pathname.match(/^\/api\/mobile\/v1\/food\/assignments\/([0-9a-f-]{36})\/chat\/events$/i);
 const driver=url.pathname==='/api/mobile/v1/driver/food/work/events';
 if(!customer&&!driver&&!chat)return false;
 let account:string|undefined,closed=false,busy=false,dirty=false,previous='',lastFrame=0,nextRead=0;
 let timer:ReturnType<typeof setInterval>|undefined,lifetime:ReturnType<typeof setTimeout>|undefined,pendingWake:ReturnType<typeof setTimeout>|undefined,terminalDeadline:ReturnType<typeof setTimeout>|undefined;
 // Pump lifetime and transport ownership are distinct: end() is not closure.
 const stopWork=()=>{closed=true;clearInterval(timer);clearTimeout(lifetime);clearTimeout(pendingWake);wakes.delete(wake);};
 const cleanup=()=>{stopWork();clearTimeout(terminalDeadline);if(account){const count=(accounts.get(account)??1)-1;if(count)accounts.set(account,count);else accounts.delete(account);account=undefined;activeTransports--;}};
 const close=(force=false)=>{
  if(closed){if(force&&!res.destroyed)res.destroy();return;}
  stopWork();
  if(force){res.destroy();if(res.destroyed)cleanup();}
  else{terminalDeadline=setTimeout(()=>{res.destroy();cleanup();},250);res.end();}
 };
 const clear=()=>{if(!closed&&!res.destroyed&&!res.write('event: clear\ndata: {}\n\n')){close(true);return;}close();};
 async function snapshot(){
  // Original bearer is resolved on every read; rotation is not silently adopted.
  const actor=await mobilePrincipal(req.headers.authorization);
  if(account&&actor.accountId!==account)throw new RequestError(401,'AUTH_REQUIRED');
  return withMobileDispatch(actor,async db=>{
   await db.query("SET LOCAL statement_timeout='1500ms';SET LOCAL lock_timeout='200ms'");
   await db.query("SELECT set_config('bitpos.mobile_access_hash',$1,true)",[createHash('sha256').update(req.headers.authorization!.slice(7)).digest('hex')]);
   const raw=(await db.query(customer?'SELECT bitpos.dispatch_customer_realtime($1) AS value':chat?'SELECT bitpos.food_chat103_signal($1) AS value':'SELECT bitpos.dispatch_driver_realtime() AS value',customer?[customer[1]]:chat?[chat[1]]:[])).rows[0].value as Record<string,unknown>;
   const {serverTime,...projection}=raw;
   const cursor='f1_'+createHmac('sha256',config.APP_SECRET).update(JSON.stringify([actor.sessionId,url.pathname,projection])).digest('base64url');
   const value=(customer?FoodCustomerRealtimeSnapshotSchema:chat?FoodChatRealtimeSnapshotSchema:FoodDriverRealtimeSnapshotSchema).parse({...raw,cursor});
   if(closed||req.destroyed||res.destroyed)return;
   const now=Date.now();
   // Enqueue while authorization/lease locks remain held, never await network drain here.
   if(cursor!==previous||now-lastFrame>=5000){
    const frame=`id: ${cursor}\nevent: snapshot\ndata: ${JSON.stringify(value)}\n\n`;
    if(Buffer.byteLength(frame)>65536||res.writableLength>65536){close(true);return;}
    if(!res.headersSent)res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no','Connection':'keep-alive'});
    previous=cursor;lastFrame=now;
    if(!res.write(frame))close(true);
   }
  });
 }
 async function pump(initial=false){
  if(closed)return;if(busy){dirty=true;return;}busy=true;dirty=false;nextRead=Date.now()+250;
  try{await snapshot();}catch(error){if(initial)throw error;clear();}finally{busy=false;if(dirty&&!closed)wake();}
 }
 function wake(){if(closed)return;if(busy){dirty=true;return;}if(!pendingWake)pendingWake=setTimeout(()=>{pendingWake=undefined;void pump();},Math.max(0,nextRead-Date.now()));}
 res.once('close',cleanup);req.once('aborted',()=>close(true));
 try{
  if(req.method!=='GET'||url.search||process.env.BITPOS_MOBILE_ENABLED!=='1')throw new RequestError(400,'INVALID_REQUEST');
  const last=req.headers['last-event-id'];if(last!==undefined&&(typeof last!=='string'||!/^f1_[A-Za-z0-9_-]{43}$/.test(last)))throw new RequestError(400,'INVALID_REQUEST');
  const actor=await mobilePrincipal(req.headers.authorization);
  if(closed||req.destroyed||res.destroyed){cleanup();return true;}
  if(activeTransports>=128||(accounts.get(actor.accountId)??0)>=3)throw new RequestError(429,'INVALID_REQUEST');
  account=actor.accountId;activeTransports++;accounts.set(account,(accounts.get(account)??0)+1);wakes.add(wake);
  // First read always replaces state, irrespective of Last-Event-ID.
  await pump(true);
  if(!closed){timer=setInterval(wake,1000);lifetime=setTimeout(clear,120000);}
 }catch(error){
  if(closed)return true;
  if(!res.headersSent){const status=error instanceof RequestError?error.status:chat&&['CHAT_UNAVAILABLE','RESOURCE_NOT_FOUND'].includes((error as Error).message)?404:503;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:{code:status===401?'AUTH_REQUIRED':'REALTIME_UNAVAILABLE'}}));}else clear();close();
 }
 return true;
}
