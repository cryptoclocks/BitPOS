// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {WebSocket,WebSocketServer} from 'ws';
import {handleLiveUpgrade,LIVE_PATH,type LiveDeps} from '../apps/api/src/meta/live-voice';

test('live voice proxy: key stays on the server, audio relayed, only transcripts back; origin, session and cap enforced',async()=>{
 // Fake Muse realtime: checks the handshake, acks, sends a partial and a final, closes 1000 after endStream.
 const seen:{handshake?:any;bytes:number;ended:boolean}={bytes:0,ended:false};
 const fake=new WebSocketServer({port:0});
 fake.on('connection',s=>{s.on('message',(d,bin)=>{
  if(bin){seen.bytes+=(d as Buffer).length;if(seen.bytes===9600)s.send(JSON.stringify({type:'transcript',transcript:'ขอลาเต้',final:false}));return;}
  const m=JSON.parse(d.toString());
  if(!seen.handshake){seen.handshake=m;s.send(JSON.stringify({sessionId:'abc'}));return;}
  if(m.type==='endStream'){seen.ended=true;s.send(JSON.stringify({type:'transcript',transcript:'ขอลาเต้สองแก้ว',final:true,secret:'x'}));s.close(1000);}
 });});
 await new Promise(ok=>fake.once('listening',ok));
 let allowed=true;
 const deps:LiveDeps={asr:{baseUrl:'https://api.meta.example/v1',apiKey:'sk-test',model:'muse-voice-transcribe-1.0'},publicOrigin:'https://pay.example.test',log:()=>{},
  allow:()=>allowed,keywords:async()=>['ลาเต้','Latte'],customer:async req=>/bitpos_meta=good/.test(req.headers.cookie??'')?'link-1':null,upstreamUrl:`ws://127.0.0.1:${(fake.address() as AddressInfo).port}`};
 const server=http.createServer((_q,r)=>{r.writeHead(404);r.end();});
 server.on('upgrade',(req,socket,head)=>{if(!handleLiveUpgrade(req,socket,head,deps))socket.destroy();});
 await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));
 const url=`ws://127.0.0.1:${(server.address() as AddressInfo).port}${LIVE_PATH}`;
 const status=(headers:Record<string,string>)=>new Promise<number>(ok=>{const w=new WebSocket(url,{headers});w.on('unexpected-response',(_r,res)=>ok(res.statusCode??0));w.on('open',()=>{w.close();ok(101);});w.on('error',()=>{});});
 try{
  assert.equal(await status({origin:'https://evil.example',cookie:'bitpos_meta=good'}),403);
  assert.equal(await status({origin:'https://pay.example.test'}),401,'signed-in customers only');
  allowed=false;assert.equal(await status({origin:'https://pay.example.test',cookie:'bitpos_meta=good'}),429);allowed=true;
  const w=new WebSocket(url,{headers:{origin:'https://pay.example.test',cookie:'bitpos_meta=good'}});
  const got:any[]=[];w.on('message',d=>got.push(JSON.parse(d.toString())));
  await new Promise(ok=>w.on('open',ok));
  for(let i=0;i<5;i++)w.send(Buffer.alloc(1920));   // 5 × 40 ms of 24 kHz PCM16
  await new Promise(r=>setTimeout(r,150));w.send(JSON.stringify({type:'end'}));
  await new Promise(ok=>w.on('close',ok));
  assert.deepEqual(seen.handshake,{authorization:{accessToken:'Bearer sk-test'},audioEncoding:'PCM_24KHZ',model:'muse-voice-transcribe-1.0',mode:'PUSH_TO_TALK',languageBias:['Thai','English'],keywords:['ลาเต้','Latte']});
  assert.equal(seen.bytes,9600);assert.ok(seen.ended,'endStream sent upstream');
  assert.deepEqual(got.filter(m=>m.type==='transcript'),[{type:'transcript',transcript:'ขอลาเต้',final:false},{type:'transcript',transcript:'ขอลาเต้สองแก้ว',final:true}],'only transcript fields pass through');
  assert.ok(!JSON.stringify(got).includes('sk-test'),'the key never reaches the browser');
 }finally{server.close();fake.close();}
});
