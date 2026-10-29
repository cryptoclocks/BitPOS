// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Live transcript while the customer speaks: a WebSocket proxy between the voice order page and Muse Voice
// Transcribe realtime (wss://api.meta.ai/v1/asr/realtime, dev.meta.ai/docs/api-reference/voice/realtime).
// The browser never sees the API key: it opens /meta/order/live (same origin, signed-in customer, model-call cap),
// streams 24 kHz 16-bit mono PCM as binary frames and sends {"type":"end"} when done. The server opens one upstream
// session, sends the handshake with the key, relays the audio, and passes back only {transcript, final}.
// A session is capped at 20 s of audio; audio and text are never stored.
import type http from 'node:http';
import type {Duplex} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {WebSocket,WebSocketServer} from 'ws';
import type {AsrConfig} from './voice';

export const LIVE_PATH='/meta/order/live';
const MAX_SECONDS=20,BYTES_PER_SECOND=24000*2,MAX_FRAME=BYTES_PER_SECOND;

export interface LiveDeps {asr:AsrConfig|null;publicOrigin:string;
 /** The signed-in customer's link id for this upgrade request, or null. */
 customer:(req:http.IncomingMessage)=>Promise<string|null>;
 /** Shared per-customer model-call cap; true when this session may start. */
 allow:(linkId:string)=>boolean;
 log:(m:string)=>void;
 /** Menu names to bias recognition toward (the shop's own items). */
 keywords?:(req:http.IncomingMessage)=>Promise<string[]>;
 /** Upstream URL override for tests. */
 upstreamUrl?:string}

const wss=new WebSocketServer({noServer:true,maxPayload:MAX_FRAME});
const refuse=(socket:Duplex,code:number,text:string)=>{socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);socket.destroy();};

/** For http.Server 'upgrade'; returns false for paths it does not own. */
export function handleLiveUpgrade(req:http.IncomingMessage,socket:Duplex,head:Buffer,deps:LiveDeps):boolean{
 if((req.url??'').split('?')[0]!==LIVE_PATH)return false;
 void (async()=>{
  if(req.headers.origin!==deps.publicOrigin)return refuse(socket,403,'Forbidden');
  if(!deps.asr)return refuse(socket,503,'Service Unavailable');
  const linkId=await deps.customer(req).catch(()=>null);
  if(!linkId)return refuse(socket,401,'Unauthorized');
  if(!deps.allow(linkId))return refuse(socket,429,'Too Many Requests');
  const keywords=await deps.keywords?.(req).catch(()=>[])??[];
  wss.handleUpgrade(req,socket,head,client=>relay(client,deps.asr!,deps,keywords));
 })().catch(()=>refuse(socket,500,'Internal Server Error'));
 return true;
}

function relay(client:WebSocket,asr:AsrConfig,deps:LiveDeps,keywords:string[]){
 const base=deps.upstreamUrl??`${asr.baseUrl.replace(/^https:/,'wss:')}/asr/realtime`;
 const up=new WebSocket(`${base}?sessionId=${randomUUID()}`,{handshakeTimeout:8000,maxPayload:1<<20});
 let ready=false,ended=false,bytes=0;const pending:Buffer[]=[];
 const send=(o:unknown)=>{if(client.readyState===WebSocket.OPEN)client.send(JSON.stringify(o));};
 const end=()=>{if(ended)return;ended=true;if(up.readyState===WebSocket.OPEN&&ready)up.send(JSON.stringify({type:'endStream'}));else up.close();};
 const cap=setTimeout(()=>{send({type:'limit'});end();},(MAX_SECONDS+2)*1000);
 const done=(why:string)=>{clearTimeout(cap);if(client.readyState===WebSocket.OPEN)client.close(1000,why);if(up.readyState===WebSocket.OPEN||up.readyState===WebSocket.CONNECTING)up.terminate();};
 up.on('open',()=>up.send(JSON.stringify({authorization:{accessToken:`Bearer ${asr.apiKey}`},audioEncoding:'PCM_24KHZ',model:asr.model,mode:'PUSH_TO_TALK',languageBias:['Thai','English'],
  ...(keywords.length?{keywords:[...new Set(keywords.map(k=>k.trim()).filter(k=>k&&k.length<=40))].slice(0,40)}:{})})));
 up.on('message',(data,binary)=>{
  if(binary)return;
  let m:any;try{m=JSON.parse(data.toString());}catch{return;}
  if(!ready){if(typeof m?.sessionId==='string'&&!m.type){ready=true;send({type:'ready'});for(const p of pending.splice(0))up.send(p);if(ended)up.send(JSON.stringify({type:'endStream'}));}return;}
  if(m?.type==='transcript'&&typeof m.transcript==='string')send({type:'transcript',transcript:m.transcript.slice(0,300),final:m.final===true});
  else if(m?.type==='error'){deps.log('Live voice upstream error');send({type:'error'});}
 });
 up.on('close',code=>{deps.log(`Live voice session closed (${code})`);send({type:'closed',ok:code===1000});done('upstream closed');});
 up.on('error',()=>{send({type:'error'});done('upstream error');});
 client.on('message',(data,binary)=>{
  if(!binary){let m:any;try{m=JSON.parse(data.toString());}catch{return;}if(m?.type==='end')end();return;}
  if(ended)return;
  const buf=Buffer.isBuffer(data)?data:Buffer.from(data as ArrayBuffer);
  if(buf.length%2||(bytes+=buf.length)>MAX_SECONDS*BYTES_PER_SECOND){send({type:'limit'});end();return;}
  if(ready&&up.readyState===WebSocket.OPEN)up.send(buf);else if(pending.length<64)pending.push(buf);
 });
 client.on('close',()=>{if(!ended)end();setTimeout(()=>done('client closed'),3000).unref();});
 client.on('error',()=>done('client error'));
}
