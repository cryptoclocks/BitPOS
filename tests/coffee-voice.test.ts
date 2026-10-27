import test from 'node:test';import assert from 'node:assert/strict';
import {createVoiceInput} from '../apps/web/src/lib/voice-input';
test('tap alone obtains permission; stop while permission is pending stops late tracks without transcription',async()=>{
 let resolve!:(stream:MediaStream)=>void,calls=0,stops=0,audio=0;
 const priorWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),priorNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),priorRecorder=Object.getOwnPropertyDescriptor(globalThis,'MediaRecorder');
 Object.defineProperty(globalThis,'window',{configurable:true,value:{isSecureContext:true}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:()=>{calls++;return new Promise<MediaStream>(r=>resolve=r);}}}});
 Object.defineProperty(globalThis,'MediaRecorder',{configurable:true,value:class{static isTypeSupported(){return true;}}});
 const states:string[]=[];const voice=createVoiceInput({state:s=>states.push(s),transcript:()=>assert.fail('No auto transcript'),audio:async()=>{audio++;},error:()=>{}});
 try{assert.equal(calls,0);const start=voice.start('th',true);assert.equal(calls,1);voice.stop();resolve({getTracks:()=>[{stop:()=>stops++}]} as unknown as MediaStream);await start;assert.equal(stops,1);assert.equal(audio,0);assert.equal(states.at(-1),'idle');voice.dispose();}
 finally{for(const [key,descriptor] of [['window',priorWindow],['navigator',priorNavigator],['MediaRecorder',priorRecorder]] as const){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});
test('insecure origin never requests microphone permission',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:{isSecureContext:false}});const errors:string[]=[];
 try{const voice=createVoiceInput({state:()=>{},transcript:()=>assert.fail(),audio:async()=>assert.fail(),error:e=>errors.push(e)});await voice.start('en');assert.match(errors[0],/HTTPS/);voice.dispose();}finally{if(prior)Object.defineProperty(globalThis,'window',prior);else Reflect.deleteProperty(globalThis,'window');}
});

// Controlled browser-controller events only: these fixtures do not prove microphone or Opus capture acceptance.
function recorderFixture(getUserMedia:()=>Promise<MediaStream>){
 const prior:Record<'window'|'navigator'|'MediaRecorder',PropertyDescriptor|undefined>={
  window:Object.getOwnPropertyDescriptor(globalThis,'window'),
  navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator'),
  MediaRecorder:Object.getOwnPropertyDescriptor(globalThis,'MediaRecorder'),
 };
 const recorders:ControlledRecorder[]=[];
 class ControlledRecorder {
  static isTypeSupported(mime:string){return mime==='audio/webm;codecs=opus';}
  state='inactive';stopCalls=0;timeslice:number|undefined;
  ondataavailable:((event:{data:Blob})=>void)|null=null;
  onerror:(()=>void)|null=null;onstop:(()=>void)|null=null;
  constructor(readonly media:MediaStream,readonly options:{mimeType:string}){recorders.push(this);}
  start(timeslice:number){this.timeslice=timeslice;this.state='recording';}
  stop(){this.stopCalls++;this.state='inactive';}
  data(blob:Blob){this.ondataavailable?.({data:blob});}
  error(){this.onerror?.();}
  ended(){this.onstop?.();}
 }
 Object.defineProperty(globalThis,'window',{configurable:true,value:{isSecureContext:true}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia}}});
 Object.defineProperty(globalThis,'MediaRecorder',{configurable:true,value:ControlledRecorder});
 return {recorders,restore(){for(const [key,descriptor] of Object.entries(prior)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}};
}
function trackedStream(){
 const track={stopped:false,stop(){this.stopped=true;}};
 return {track,media:{getTracks:()=>[track]} as unknown as MediaStream};
}
test('controller fixture: delayed canceled A stop/data/error cannot release or cancel live B',async()=>{
 for(const order of [['stop','data','error'],['data','error','stop']] as const){
  const a=trackedStream(),b=trackedStream();let permissions=0;
  const fixture=recorderFixture(async()=>++permissions===1?a.media:b.media);
  const states:string[]=[],errors:string[]=[],transcripts:string[]=[];
  const audio:{blob:Blob;duration:number}[]=[];
  let finishTranscription!:()=>void;
  const transcription=new Promise<void>(resolve=>finishTranscription=resolve);
  const voice=createVoiceInput({state:s=>states.push(s),transcript:t=>transcripts.push(t),audio:(blob,duration)=>{audio.push({blob,duration});return transcription;},error:e=>errors.push(e)});
  try{
   await voice.start('th',true);const recorderA=fixture.recorders[0];
   recorderA.data(new Blob(['canceled A speech']));
   voice.cancel();assert.equal(a.track.stopped,true);assert.equal(recorderA.stopCalls,1);
   await voice.start('en',true);const recorderB=fixture.recorders[1];
   assert.equal(recorderB.media,b.media);assert.equal(recorderB.options.mimeType,'audio/webm;codecs=opus');assert.equal(recorderB.timeslice,250);
   const listeningStates=[...states];
   for(const event of order){
    if(event==='stop')recorderA.ended();
    else if(event==='data')recorderA.data(new Blob([new Uint8Array(2097153)]));
    else recorderA.error();
    assert.equal(b.track.stopped,false,`A ${event} must not stop B tracks`);
    assert.equal(recorderB.state,'recording');assert.equal(recorderB.stopCalls,0);
    assert.deepEqual(states,listeningStates);assert.equal(states.at(-1),'listening');
    assert.deepEqual(errors,[]);assert.deepEqual(transcripts,[]);assert.equal(audio.length,0);
   }
   recorderB.data(new Blob(['B speech']));
   voice.stop();assert.equal(recorderB.stopCalls,1);assert.equal(b.track.stopped,true);
   recorderB.ended();assert.equal(states.at(-1),'processing');assert.equal(audio.length,1);
   assert.equal(await audio[0].blob.text(),'B speech');assert.equal(audio[0].blob.type,'audio/webm;codecs=opus');
   assert.ok(audio[0].duration>=0&&audio[0].duration<=20000);
   recorderB.ended();assert.equal(audio.length,1);
   finishTranscription();await new Promise<void>(resolve=>setImmediate(resolve));
   assert.equal(states.at(-1),'idle');assert.equal(audio.length,1);assert.deepEqual(errors,[]);assert.deepEqual(transcripts,[]);
   voice.dispose();const disposedStates=[...states];
   recorderA.data(new Blob([new Uint8Array(2097153)]));recorderA.error();recorderA.ended();
   recorderB.data(new Blob([new Uint8Array(2097153)]));recorderB.error();recorderB.ended();
   assert.deepEqual(states,disposedStates);assert.deepEqual(errors,[]);assert.equal(audio.length,1);
  }finally{voice.dispose();fixture.restore();}
 }
});
test('controller fixture: late canceled A permission rejection cannot release live B',async()=>{
 const b=trackedStream();let permissions=0,rejectA!:(error:Error)=>void;
 const pendingA=new Promise<MediaStream>((_resolve,reject)=>rejectA=reject);
 const fixture=recorderFixture(()=>++permissions===1?pendingA:Promise.resolve(b.media));
 const states:string[]=[],errors:string[]=[];const audio:Blob[]=[];
 const voice=createVoiceInput({state:s=>states.push(s),transcript:()=>assert.fail('No recognition transcript'),audio:async blob=>{audio.push(blob);},error:e=>errors.push(e)});
 try{
  const startA=voice.start('th',true);voice.cancel();await voice.start('en',true);
  const recorderB=fixture.recorders[0],listeningStates=[...states];
  rejectA(new Error('Permission denied for canceled A'));await startA;
  assert.equal(b.track.stopped,false);assert.equal(recorderB.state,'recording');assert.equal(recorderB.stopCalls,0);
  assert.deepEqual(states,listeningStates);assert.equal(states.at(-1),'listening');assert.deepEqual(errors,[]);assert.equal(audio.length,0);
  recorderB.data(new Blob(['B after stale permission rejection']));
  voice.stop();assert.equal(b.track.stopped,true);assert.equal(recorderB.stopCalls,1);recorderB.ended();
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(audio.length,1);assert.equal(await audio[0].text(),'B after stale permission rejection');assert.equal(states.at(-1),'idle');assert.deepEqual(errors,[]);
 }finally{voice.dispose();fixture.restore();}
});
