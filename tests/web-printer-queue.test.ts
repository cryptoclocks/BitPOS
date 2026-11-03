import assert from 'node:assert/strict';
import test from 'node:test';
import {PrintQueue,type PrintTransport} from '../apps/web/src/lib/printer/queue';
import {loadPrinterSettings,savePrinterSettings,type PrinterSettings} from '../apps/web/src/lib/printer/settings';

const wait=(ms=5)=>new Promise(r=>setTimeout(r,ms));
const packets=(n=4)=>async()=>Array.from({length:n},(_,i)=>Uint8Array.of(i));
function fake(opts:{failAt?:number;delay?:number}={}){
 const log:number[][]=[];let concurrent=0,maxConcurrent=0;
 const t:PrintTransport={async send(p,{onProgress,signal}){
  concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);
  try{for(let i=0;i<p.length;i++){if(signal.aborted)throw new Error('CANCELLED');if(opts.failAt===i)throw new Error('DISCONNECTED');await wait(opts.delay??1);log.push(Array.from(p[i]!));onProgress(i+1,p.length);}}
  finally{concurrent--;}
 }};
 return {t,log,max:()=>maxConcurrent};
}
async function settle(q:PrintQueue){for(let i=0;i<200&&q.snapshot().some(j=>['queued','preparing','sending'].includes(j.state));i++)await wait();}

test('jobs run one at a time, in order, and their packets never interleave',async()=>{
 const f=fake({delay:2}),q=new PrintQueue(()=>f.t);
 q.enqueue('a','A',async()=>[Uint8Array.of(1),Uint8Array.of(2),Uint8Array.of(3)]);q.enqueue('b','B',async()=>[Uint8Array.of(7),Uint8Array.of(8)]);
 await settle(q);assert.deepEqual(f.log,[[1],[2],[3],[7],[8]]);assert.equal(f.max(),1);assert.deepEqual(q.snapshot().map(j=>j.state),['sent','sent']);
});
test('a second tap on the same receipt while it is queued or sending is refused, not printed twice',async()=>{
 const f=fake({delay:3}),q=new PrintQueue(()=>f.t);
 const first=q.enqueue('order-1','Receipt',packets());const again=q.enqueue('order-1','Receipt',packets());
 assert.ok('refused' in again&&again.refused==='DUPLICATE');await settle(q);assert.equal(f.log.length,4);
 const next=q.enqueue('order-1','Receipt',packets());assert.ok(!('refused' in next));await settle(q);assert.equal(f.log.length,8);void first;
});
test('a failure before any byte is a plain failure; a failure after bytes went out is "uncertain" and is never retried automatically',async()=>{
 const before=fake({failAt:0}),q1=new PrintQueue(()=>before.t);q1.enqueue('x','X',packets());await settle(q1);
 assert.equal(q1.snapshot()[0]!.state,'failed');assert.equal(before.log.length,0);
 const mid=fake({failAt:2}),q2=new PrintQueue(()=>mid.t);q2.enqueue('y','Y',packets());await settle(q2);await wait(30);
 const j=q2.snapshot()[0]!;assert.equal(j.state,'uncertain');assert.equal(j.sentPackets,2);assert.equal(mid.log.length,2,'no automatic resend');assert.match(j.error!,/DISCONNECTED/);
});
test('an uncertain job can only be printed again by an explicit reprint',async()=>{
 const f=fake({failAt:1}),q=new PrintQueue(()=>f.t);q.enqueue('r','R',packets());await settle(q);
 const refused=q.enqueue('r','R',packets());assert.ok('refused' in refused&&refused.refused==='UNCERTAIN_REPRINT_REQUIRED');
 const ok=q.enqueue('r','R',packets(),{reprint:true});assert.ok(!('refused' in ok));await settle(q);
});
test('a job that cannot be built fails without touching the printer, and the next job still runs',async()=>{
 const f=fake(),q=new PrintQueue(()=>f.t);
 q.enqueue('bad','Bad',async()=>{throw new Error('RECEIPT_TOO_LONG');});q.enqueue('good','Good',packets(2));await settle(q);
 const s=q.snapshot();assert.equal(s[0]!.state,'failed');assert.equal(s[0]!.error,'RECEIPT_TOO_LONG');assert.equal(s[1]!.state,'sent');assert.equal(f.log.length,2);
});
test('cancel stops a waiting job and aborts a sending one (which is then uncertain)',async()=>{
 const f=fake({delay:10}),q=new PrintQueue(()=>f.t);
 const a=q.enqueue('a','A',packets(20)) as {id:number};const b=q.enqueue('b','B',packets(3)) as {id:number};
 await wait(25);q.cancel(b.id);q.cancel(a.id);await settle(q);
 const s=q.snapshot();assert.equal(s.find(j=>j.id===b.id)!.state,'cancelled');assert.equal(s.find(j=>j.id===a.id)!.state,'uncertain');assert.ok(f.log.length<20);
});
test('subscribers get stable snapshots, and finished history is trimmed',async()=>{
 const f=fake(),q=new PrintQueue(()=>f.t,3);let calls=0;const off=q.subscribe(()=>{calls++;});
 for(let i=0;i<6;i++){q.enqueue('k'+i,'K',packets(1));await settle(q);}
 off();assert.ok(calls>6);assert.equal(q.snapshot().length,3);assert.equal(q.snapshot(),q.snapshot());
});

const mem=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);},removeItem:(k:string)=>{m.delete(k);},m};};
const good:PrinterSettings={version:1,model:'peripage-a9smax',deviceId:'abc',deviceName:'PeriPage_A9sMAX_BLE',contentMm:80,density:1};
test('printer settings are saved per shop, can be forgotten, and reject tampered or other-model data',()=>{
 const s=mem();assert.equal(savePrinterSettings('shop-1',good,s),true);
 assert.deepEqual(loadPrinterSettings('shop-1',s),good);assert.equal(loadPrinterSettings('shop-2',s),null);
 s.setItem('bitpos.printer.shop-1',JSON.stringify({...good,density:9,contentMm:12}));assert.deepEqual([loadPrinterSettings('shop-1',s)!.density,loadPrinterSettings('shop-1',s)!.contentMm],[2,107]);
 s.setItem('bitpos.printer.shop-1',JSON.stringify({...good,model:'other'}));assert.equal(loadPrinterSettings('shop-1',s),null);
 s.setItem('bitpos.printer.shop-1','{bad');assert.equal(loadPrinterSettings('shop-1',s),null);
 savePrinterSettings('shop-1',good,s);savePrinterSettings('shop-1',null,s);assert.equal(loadPrinterSettings('shop-1',s),null);
});
test('settings storage that throws never breaks the screen',()=>{
 const bad={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}};
 assert.equal(loadPrinterSettings('s',bad),null);assert.equal(savePrinterSettings('s',good,bad),false);
});
