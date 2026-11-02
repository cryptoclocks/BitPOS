import assert from 'node:assert/strict';
import test from 'node:test';

const store=new Map<string,string>();
const scheduled:string[]=[];
class FakeParam{setValueAtTime(){}exponentialRampToValueAtTime(){}}
class FakeCtx{state='running';currentTime=0;destination={};resume(){}
 createOscillator(){const o={type:'',frequency:{value:0},connect(n:unknown){return n},start(){scheduled.push('start')},stop(){}};return o}
 createGain(){return {gain:new FakeParam(),connect(n:unknown){return n}}}}
Object.assign(globalThis,{window:{AudioContext:FakeCtx},localStorage:{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v)}}});
const {cueForChange,isMuted,play,setMuted}=await import('../apps/web/src/lib/sfx');

test('cart cues follow the direction of change and the first reading is silent',()=>{
 assert.equal(cueForChange('cart',null,3),null);
 assert.equal(cueForChange('cart',2,3),'add');
 assert.equal(cueForChange('cart',3,2),'remove');
 assert.equal(cueForChange('cart',3,3),null);
});
test('only a rise in paid orders announces a new order',()=>{
 assert.equal(cueForChange('paid',null,4),null);
 assert.equal(cueForChange('paid',1,2),'order');
 assert.equal(cueForChange('paid',2,1),null);
});
test('mute is remembered and silences every cue',()=>{
 scheduled.length=0;
 assert.equal(isMuted(),false);assert.equal(play('add'),true);assert.ok(scheduled.length>=2);
 setMuted(true);assert.equal(isMuted(),true);scheduled.length=0;
 assert.equal(play('order'),false);assert.equal(scheduled.length,0);
 setMuted(false);assert.equal(play('remove'),true);
});
test('a missing or failing audio engine stays silent instead of throwing',()=>{
 (globalThis as any).window={};assert.equal(play('add'),false);
 (globalThis as any).window={AudioContext:FakeCtx};
 FakeCtx.prototype.createOscillator=()=>{throw new Error('audio device lost')};assert.equal(play('add'),false);
});
