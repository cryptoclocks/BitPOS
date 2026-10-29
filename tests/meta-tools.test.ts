// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {createMetaRouter} from '../packages/meta-ai/src/router';
import {LANG,localizeStaff} from '../apps/api/src/meta/staff-i18n';

const provider={id:'meta_api' as const,baseUrl:'https://api.meta.example/v1',apiKey:'k',model:'muse-spark-1.3',weights:'closed' as const,location:'cloud' as const,timeoutMs:5000,supportsJsonSchema:true,supportsImages:true};
const reply=(message:unknown)=>new Response(JSON.stringify({model:'muse-spark-1.3',choices:[{finish_reason:'stop',message}],usage:{prompt_tokens:10,completion_tokens:5}}),{status:200});

test('tool calling: parallel calls run on the server with checked arguments, results go back, every round is recorded',async()=>{
 const bodies:any[]=[],recorded:any[]=[];let round=0;
 const f=async(_u:string,i:RequestInit)=>{bodies.push(JSON.parse(String(i.body)));round++;
  if(round===1)return reply({content:null,tool_calls:[{id:'a',type:'function',function:{name:'add',arguments:'{"n":2}'}},{id:'b',type:'function',function:{name:'add',arguments:'{"n":"x"}'}},{id:'c',type:'function',function:{name:'nope',arguments:'{}'}}]});
  return reply({content:'เพิ่มให้แล้วค่ะ'});};
 const router=createMetaRouter({providers:[provider],fetch:f as any,record:async i=>{recorded.push(i);}});
 let total=0;
 const r=await router.invokeTools({task:'agent_tools',merchantId:'m',model:'muse-wonder-1.0',messages:[{role:'user',content:'add two'}],
  tools:[{name:'add',description:'add',parameters:{type:'object'},args:z.object({n:z.number().int()}),run:async(a:{n:number})=>{total+=a.n;return {total};}}]});
 assert.equal(r.text,'เพิ่มให้แล้วค่ะ');assert.equal(total,2,'only the valid call ran');
 assert.deepEqual(r.calls.map(c=>[c.name,c.ok]),[['add',true],['add',false],['nope',false]]);
 assert.equal(bodies[0].model,'muse-wonder-1.0');assert.equal(bodies[0].parallel_tool_calls,true);assert.equal(bodies[0].tools[0].function.name,'add');
 const toolMsgs=bodies[1].messages.filter((m:any)=>m.role==='tool');assert.equal(toolMsgs.length,3);assert.match(toolMsgs[1].content,/INVALID_ARGUMENTS/);
 assert.equal(recorded.length,2);assert.equal(recorded[0].task,'agent_tools');assert.deepEqual(recorded[0].output.toolCalls,['add','add','nope']);
});

test('tool calling: stops after max rounds; provider errors are recorded and thrown',async()=>{
 const loop=createMetaRouter({providers:[provider],fetch:(async()=>reply({content:null,tool_calls:[{id:'a',type:'function',function:{name:'t',arguments:'{}'}}]}))as any});
 await assert.rejects(loop.invokeTools({task:'agent_tools',merchantId:'m',maxRounds:2,messages:[],tools:[{name:'t',description:'',parameters:{},args:z.object({}),run:async()=>({})}]}));
 const recorded:any[]=[];const bad=createMetaRouter({providers:[provider],fetch:(async()=>new Response('x',{status:500}))as any,record:async i=>{recorded.push(i);}});
 await assert.rejects(bad.invokeTools({task:'agent_tools',merchantId:'m',messages:[],tools:[]}));assert.equal(recorded[0].outcome,'PROVIDER_UNAVAILABLE');
});

test('English pages never rewrite text the owner edits or sends (textarea, pre)',()=>{
 const html=LANG.run('en',()=>localizeStaff('<html lang="th"><p>ปกติ</p><textarea name="caption">ราคา ปกติ $5</textarea><pre>ถึง</pre></html>'));
 assert.equal(html,'<html lang="en"><p>Regular</p><textarea name="caption">ราคา ปกติ $5</textarea><pre>ถึง</pre></html>');
});
