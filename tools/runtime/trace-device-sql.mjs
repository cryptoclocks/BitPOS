/* Diagnostic preload only; not acceptance latency instrumentation.
 * node --env-file=.env --import tsx --import ./tools/runtime/trace-device-sql.mjs apps/api/src/index.ts
 * BITPOS_TRACE_PATH must name an evidence JSONL. Never records SQL, parameters,
 * frame bodies, wallet keys, provisioning, access tokens or connection strings.
 * Synchronous diagnostic writes add overhead: do not use this run as p95 proof.
 */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import pg from 'pg';
import WebSocket from 'ws';

const path=process.env.BITPOS_TRACE_PATH;
if(!/^\.omp\/work\/evidence\/device-wire-trace-[a-zA-Z0-9_-]+\.jsonl$/.test(path||''))throw Error('Explicit sanitized device trace evidence path required');
function record(value){fs.appendFileSync(path,JSON.stringify({origin:'diagnostic_actual_API_query_and_socket_boundary',hostPid:process.pid,...value})+'\n',{mode:0o600});}
const originalQuery=pg.Client.prototype.query;
let querySequence=0;
pg.Client.prototype.query=function(...args){
 const sql=typeof args[0]==='string'?args[0]:args[0]?.text;
 if(typeof sql!=='string')return originalQuery.apply(this,args);
 const at=new Date().toISOString(),started=performance.now(),pid=this.processID,queryId=++querySequence;
 const sqlHash=createHash('sha256').update(sql).digest('hex');
 const routine=sql.match(/\b(?:bitpos\.)?(device_[a-z_]+)\s*\(/i)?.[1]||null;
 const verb=sql.trim().match(/^[A-Z]+/i)?.[0]?.toUpperCase()||'OTHER';
 record({boundary:'SQL_invocation',queryId,at,pid,verb,routine,sqlHash});
 let completed=false;
 const finish=error=>{if(completed)return;completed=true;record({boundary:'SQL_callback',queryId,at,finishedAt:new Date().toISOString(),ms:performance.now()-started,pid,verb,routine,sqlHash,error:!!error});};
 const callbackIndex=args.findLastIndex(value=>typeof value==='function');
 if(callbackIndex>=0){const callback=args[callbackIndex];args[callbackIndex]=function(error,...rest){finish(error);return callback.call(this,error,...rest)};}
 try{
  const result=originalQuery.apply(this,args);
  if(callbackIndex<0&&result?.then)return result.then(value=>{finish(null);return value},error=>{finish(error);throw error});
  return result;
 }catch(error){finish(error);throw error;}
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeId=value=>typeof value==='string'&&uuid.test(value)?value:null;
const originalEmit=WebSocket.prototype.emit;
WebSocket.prototype.emit=function(event,...args){
 if(event==='message'){
  let command;try{command=JSON.parse(Buffer.isBuffer(args[0])?args[0].toString('utf8'):String(args[0]))}catch{}
  if(command&&['ACK','HEARTBEAT','SESSION_SYNC','CART_SAVE','ORDER_SUBMIT','ORDER_DISMISS'].includes(command.type)){
   record({boundary:'socket_command_arrival',at:new Date().toISOString(),type:command.type,requestId:safeId(command.requestId),eventId:safeId(command.eventId)});
  }
 }
 return originalEmit.call(this,event,...args);
};
const originalSend=WebSocket.prototype.send;
WebSocket.prototype.send=function(data,...args){
 let frame;try{frame=JSON.parse(typeof data==='string'?data:Buffer.isBuffer(data)?data.toString('utf8'):'null')}catch{}
 if(frame&&['ORDER','SNAPSHOT','COMMAND_RESULT','CONFIG','CATALOG'].includes(frame.type)){
  // Only scheduling identifiers; never paymentUrl, payload text or identities.
  record({boundary:'socket_send_invocation',at:new Date().toISOString(),type:frame.type,eventId:safeId(frame.eventId),requestId:safeId(frame.requestId),deviceSeq:typeof frame.deviceSeq==='string'&&/^\d{1,20}$/.test(frame.deviceSeq)?frame.deviceSeq:null});
 }
 return originalSend.call(this,data,...args);
};
record({boundary:'observer_loaded',at:new Date().toISOString(),acceptance_latency_claim:false});
