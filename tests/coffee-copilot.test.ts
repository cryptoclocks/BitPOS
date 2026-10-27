import test from 'node:test';
import assert from 'node:assert/strict';
import {coffeeCandidate,coffeeAudioRequest,coffeeDraftRevision} from '../packages/contracts/src/coffee-copilot';
import {decodeCoffeeAudio,coffeeConfiguration} from '../apps/api/src/coffee-provider';
import {audioDurationMs} from '../apps/api/src/coffee-audio';
import {finishGuestOrder,guestKey,priorPaidVisit,restoreGuest} from '../apps/web/src/lib/table-guest';
const id='f11cb4b1-5022-4e4b-bf59-3c297d0572fe';
test('live WebM without Duration derives bounded length from cluster/block timestamps and Opus packets',()=>{
 // Explicit parser fixture, not real microphone or encoded-speech evidence.
 const element=(tag:number[],body:Buffer)=>Buffer.concat([Buffer.from(tag),Buffer.from([0x80|body.length]),body]);
 const block=(relative:number)=>{const payload=Buffer.from([0x81,0,0,0x80,0x98,0]);payload.writeInt16BE(relative,1);return element([0xa3],payload);};
 const webm=(clusterTime:number)=>{const timestamp=Buffer.alloc(2);timestamp.writeUInt16BE(clusterTime);const cluster=element([0x1f,0x43,0xb6,0x75],Buffer.concat([element([0xe7],timestamp),block(0),block(1000)]));return Buffer.concat([element([0x1a,0x45,0xdf,0xa3],Buffer.alloc(0)),Buffer.from([0x18,0x53,0x80,0x67,0xff]),element([0x16,0x54,0xae,0x6b],Buffer.from('A_OPUS')),cluster]);};
 assert.equal(audioDurationMs(webm(0),'audio/webm;codecs=opus'),1020);
 assert.equal(audioDurationMs(webm(1500),'audio/webm;codecs=opus'),2520);
 assert.throws(()=>audioDurationMs(webm(20000),'audio/webm;codecs=opus'));
});
test('streaming unknown-size WebM clusters stay siblings and retain the 20-second bound',()=>{
 const element=(tag:number[],body:Buffer)=>Buffer.concat([Buffer.from(tag),Buffer.from([0x80|body.length]),body]);
 const unknown=Buffer.from([1,255,255,255,255,255,255,255]);
 const cluster=(time:number)=>{const stamp=Buffer.alloc(2);stamp.writeUInt16BE(time);return Buffer.concat([Buffer.from([0x1f,0x43,0xb6,0x75]),unknown,element([0xe7],stamp),element([0xa3],Buffer.from([0x81,0,0,0x80,0x98,0]))]);};
 const webm=(last:number)=>Buffer.concat([element([0x1a,0x45,0xdf,0xa3],Buffer.alloc(0)),Buffer.from([0x18,0x53,0x80,0x67]),unknown,element([0x16,0x54,0xae,0x6b],Buffer.from('A_OPUS')),...Array.from({length:10},(_,i)=>cluster(i===9?last:i*250))]);
 assert.equal(audioDurationMs(webm(2250),'audio/webm;codecs=opus'),2270);
 assert.throws(()=>audioDurationMs(webm(20000),'audio/webm;codecs=opus'),/AUDIO_DURATION_INVALID/);
 const truncated=webm(2250).subarray(0,-1);
 assert.throws(()=>audioDurationMs(truncated,'audio/webm;codecs=opus'),/INVALID_AUDIO/);
});
test('durable draft revision accepts only cart identity, never arbitrary transcript or PII',()=>{
 assert.equal(coffeeDraftRevision.safeParse(JSON.stringify([id,[],'table'])).success,true);
 for(const revision of ['customer@example.com',JSON.stringify([id,[],'table','private spoken words']),JSON.stringify([id,[{productId:id,qty:1,note:'private spoken words'}],'table'])])assert.equal(coffeeDraftRevision.safeParse(revision).success,false);
});
test('proposal boundary excludes invented options, canonical money and duplicate products',()=>{
 const proposal={kind:'proposal',items:[{productId:id,qty:1}],collection:'table'};
 assert.equal(coffeeCandidate.parse(proposal).kind,'proposal');
 for(const input of [{...proposal,total:1},{...proposal,items:[{productId:id,qty:1,sugar:'none'}]},{...proposal,items:[...proposal.items,...proposal.items]}])assert.throws(()=>coffeeCandidate.parse(input));
});
test('audio is actual container bytes, bounded decoded size and duration, not a trusted MIME/duration claim',()=>{
 assert.throws(()=>decodeCoffeeAudio(Buffer.from('not audio').toString('base64'),'audio/webm'));
 assert.throws(()=>decodeCoffeeAudio('!','audio/wav'));
 assert.throws(()=>coffeeAudioRequest.parse({requestId:id,draftRevision:JSON.stringify([id,[],'table']),mimeType:'audio/wav',durationMs:20001,audio:'AAAA'}));
 const wav=Buffer.alloc(44+32000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt32LE(32000,28);wav.write('data',36);wav.writeUInt32LE(32000,40);
 assert.equal(audioDurationMs(decodeCoffeeAudio(wav.toString('base64'),'audio/wav'),'audio/wav'),1000);
 const excessive=Buffer.alloc(44+32000*21);wav.copy(excessive,0,0,44);excessive.writeUInt32LE(32000*21,40);assert.throws(()=>audioDurationMs(excessive,'audio/wav'));
});
test('provider config forbids non-Gemini paid fallback or malformed model',()=>{
 assert.throws(()=>coffeeConfiguration({BITPOS_AI_PROVIDER_URL:'https://other.invalid/chat/completions',BITPOS_AI_API_KEY:'test-not-a-secret',BITPOS_AI_MODEL:'gemini-2.5-flash'}));
});
test('paid prior capability remains isolated from next guest cart and unverified prior order does not replace it',()=>{
 const store=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>store.set(key,value)}});
 try{store.set(guestKey('entry'),JSON.stringify({phase:'order',items:[],requestId:id,visitToken:'a'.repeat(43),order:{id,status:'AWAITING_WALLET'}}));finishGuestOrder('entry',{id,status:'PAID'});assert.deepEqual(priorPaidVisit('entry'),{visitToken:'a'.repeat(43),orderId:id});assert.equal(JSON.parse(store.get(guestKey('entry'))!).visitToken,undefined);
 store.set(guestKey('entry'),JSON.stringify({phase:'order',items:[],requestId:id,visitToken:'b'.repeat(43),order:{id,status:'CONFIRMING'}}));finishGuestOrder('entry',{id,status:'CONFIRMING'});assert.equal(priorPaidVisit('entry')?.visitToken,'a'.repeat(43));
 }finally{Reflect.deleteProperty(globalThis,'localStorage');}
});
test('reload of an unresolved delegated ORDER retains its confirmation nonce and refuses malformed saved authority',()=>{
 const store=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>store.set(key,value)}});
 try{
  const saved={phase:'pending',items:[{productId:id,qty:1}],requestId:id,visitToken:'a'.repeat(43),quote:{id},request:{quoteId:id,priceVersion:id,idempotencyKey:id},delegatedCheckout:{permission:{grantId:id,owner:'GQT3Je4HGa5JpN2tWvDjRFJV9mv29kwaWTmZgdTmJjLE',sessionToken:'b'.repeat(43),expiresAt:'2026-10-13T16:00:00Z'},nonce:'00000000-0000-4000-8000-000000000001'}};
  store.set(guestKey('entry'),JSON.stringify(saved));const recovered=restoreGuest('entry');assert.equal(recovered.phase,'pending');assert.equal(recovered.delegatedCheckout?.nonce,saved.delegatedCheckout.nonce);
  store.set(guestKey('entry'),JSON.stringify({...saved,delegatedCheckout:{...saved.delegatedCheckout,nonce:'replacement'}}));assert.throws(()=>restoreGuest('entry'));
 }finally{Reflect.deleteProperty(globalThis,'localStorage');}
});
