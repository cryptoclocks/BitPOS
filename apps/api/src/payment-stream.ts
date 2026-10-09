import type {IncomingMessage,ServerResponse} from 'node:http';
import {pool,tenant} from './db';
import {orderView} from './orders';
import type {OrderRow} from './types';
const listeners=new Set<()=>void>();let listening=false;
async function notifications(){if(listening)return;listening=true;try{const db=await pool.connect();await db.query('LISTEN bitpos_device_outbox');db.on('notification',()=>{for(const refresh of listeners)refresh();});db.once('error',()=>{listening=false;db.release(true);setTimeout(()=>void notifications(),5000).unref();});}catch{listening=false;}}
/** Same opaque bill capability as GET /pay; only public order fields leave here. */
export async function paymentStream(req:IncomingMessage,res:ServerResponse,token:string){
 if(listeners.size>=64){res.writeHead(503);res.end();return;}
 const merchant=(await pool.query('SELECT bitpos.resolve_access($1) AS merchant',[token])).rows[0]?.merchant;
 if(!merchant){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.write(': connected\n\n');
 let closed=false,inFlight=false,previous='';
 const refresh=()=>{if(closed||inFlight)return;inFlight=true;void tenant(merchant,async db=>{
  const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE access_token=$1',[token])).rows[0];if(!o)return null;
  const view=await orderView(db,o,true);const payment=(await db.query("SELECT signature FROM payments WHERE order_id=$1 AND state='SETTLED' LIMIT 1",[o.id])).rows[0];return {...view,...(payment?{paymentSignature:payment.signature}:{})};
 }).then(view=>{if(closed||!view)return;const value=JSON.stringify(view);if(value!==previous){previous=value;res.write('data: '+value+'\n\n');}}).catch(()=>{if(!closed)res.write(': reconnecting\n\n');}).finally(()=>{inFlight=false;});};
 listeners.add(refresh);void notifications();refresh();
 const timer=setInterval(()=>{if(!closed){res.write(': heartbeat\n\n');refresh();}},5000);
 res.once('close',()=>{closed=true;clearInterval(timer);listeners.delete(refresh);});
}
