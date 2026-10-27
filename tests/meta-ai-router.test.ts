// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {createMetaRouter,metaProvidersFromEnv,providerUrlAllowed} from '../packages/meta-ai/src/router';
import {MetaRouterError,type MetaInvocation,type MetaProviderConfig} from '../packages/meta-ai/src/types';

const merchantId='00000000-0000-4000-8000-000000000001';
const local:MetaProviderConfig={id:'local_mac',baseUrl:'http://127.0.0.1:8000/v1',model:'muse-spark-open',weights:'open',location:'self_hosted',timeoutMs:5000,supportsJsonSchema:true,supportsImages:true};
const baseten:MetaProviderConfig={id:'baseten',baseUrl:'https://inference.example.test/v1',apiKey:'test-key',model:'meta-models/muse-spark-open-1026',weights:'open',location:'cloud',timeoutMs:5000,supportsJsonSchema:true,supportsImages:true};
const metaApi:MetaProviderConfig={id:'meta_api',baseUrl:'https://api.example.test/v1',apiKey:'test-key',model:'muse-spark-1.3',weights:'closed',location:'cloud',timeoutMs:5000,supportsJsonSchema:true,supportsImages:false};
const output={name:'decision',schema:z.object({action:z.enum(['discount','hold'])}).strict(),jsonSchema:{type:'object'}};
const ok=(content:string,model='served')=>new Response(JSON.stringify({model,choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:10,completion_tokens:5,completion_tokens_details:{reasoning_tokens:3}}}),{status:200});
const urlOf=(input:unknown)=>String(input instanceof Request?input.url:input);

test('falls back from a failed self-hosted node to cloud and records every attempt',async()=>{
 const records:MetaInvocation[]=[];const seen:string[]=[];
 const router=createMetaRouter({providers:[local,baseten],record:async r=>{records.push(r);},fetch:async input=>{seen.push(urlOf(input));if(urlOf(input).startsWith('http://127.0.0.1'))throw new TypeError('connect refused');return ok('{"action":"discount"}');}});
 const r=await router.invoke({task:'counter_reasoning',merchantId,messages:[{role:'user',content:'x'}],output});
 assert.deepEqual(r.value,{action:'discount'});
 assert.equal(r.invocation.provider,'baseten');assert.equal(r.invocation.reasoningTokens,3);
 assert.deepEqual(records.map(x=>[x.provider,x.outcome]),[['local_mac','PROVIDER_UNREACHABLE'],['baseten','OK']]);
 assert.equal(records[0].inputSha256,records[1].inputSha256);
 assert.equal(seen.length,2);
});

test('schema-invalid output is a provider failure, never returned to the caller',async()=>{
 let calls=0;
 const router=createMetaRouter({providers:[local,baseten],fetch:async()=>++calls===1?ok('{"action":"publish_now"}'):ok('```json\n{"action":"hold"}\n```')});
 const r=await router.invoke({task:'counter_reasoning',merchantId,messages:[{role:'user',content:'x'}],output});
 assert.deepEqual(r.value,{action:'hold'});
 assert.deepEqual(r.attempts.map(a=>a.outcome),['OUTPUT_SCHEMA_INVALID','OK']);
});

test('image requests skip text-only providers; open-weight proof runs never use a closed model',async()=>{
 const router=createMetaRouter({providers:[metaApi],fetch:async()=>ok('{"action":"hold"}')});
 const image=[{role:'user' as const,content:[{type:'image_url' as const,image_url:{url:'data:image/jpeg;base64,AA=='}}]}];
 await assert.rejects(router.invoke({task:'promotion_copy',merchantId,messages:image,output}),(e:unknown)=>e instanceof MetaRouterError&&e.code==='NO_PROVIDER_AVAILABLE');
 await assert.rejects(router.invoke({task:'promotion_copy',merchantId,messages:[{role:'user',content:'x'}],output,requireOpenWeights:true}),(e:unknown)=>e instanceof MetaRouterError&&e.code==='NO_PROVIDER_AVAILABLE');
});

test('prefer=cloud reorders without removing the self-hosted fallback',async()=>{
 const seen:string[]=[];
 const router=createMetaRouter({providers:[local,baseten],fetch:async input=>{seen.push(urlOf(input));return urlOf(input).startsWith('https')?new Response('busy',{status:503}):ok('{"action":"hold"}');}});
 const r=await router.invoke({task:'counter_reasoning',merchantId,messages:[{role:'user',content:'x'}],output,prefer:'cloud'});
 assert.equal(r.invocation.provider,'local_mac');
 assert.deepEqual(r.attempts.map(a=>[a.provider,a.outcome]),[['baseten','PROVIDER_UNAVAILABLE'],['local_mac','OK']]);
});

test('breaker opens after repeated failures and skips the provider during cooldown',async()=>{
 let t=0,localCalls=0;
 const router=createMetaRouter({providers:[local,baseten],now:()=>t,breakerThreshold:2,breakerCooldownMs:1000,fetch:async input=>{if(urlOf(input).startsWith('http://')){localCalls++;return new Response('',{status:500});}return ok('{"action":"hold"}');}});
 const call=()=>router.invoke({task:'counter_reasoning',merchantId,messages:[{role:'user',content:'x'}],output});
 await call();await call();await call();
 assert.equal(localCalls,2);assert.equal(router.status().providers.find(p=>p.id==='local_mac')!.breakerOpen,true);
 t=2000;await call();assert.equal(localCalls,3);
});

test('oversized and non-stop responses are rejected; all failures surface attempts',async()=>{
 const big='{"action":"hold","pad":"'+'x'.repeat(70000)+'"}';
 const router=createMetaRouter({providers:[local,baseten],fetch:async input=>urlOf(input).startsWith('http://')?ok(big):new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{"action":"hold"}'}}]}))});
 await assert.rejects(router.invoke({task:'counter_reasoning',merchantId,messages:[{role:'user',content:'x'}],output}),(e:unknown)=>e instanceof MetaRouterError&&e.code==='ALL_PROVIDERS_FAILED'&&e.attempts.map(a=>a.outcome).join()==='PROVIDER_RESPONSE_TOO_LARGE,PROVIDER_RESPONSE_INVALID');
});

test('evidence sink failure does not turn a good inference into a failure',async()=>{
 const router=createMetaRouter({providers:[baseten],record:async()=>{throw Error('db down');},fetch:async()=>ok('{"action":"hold"}')});
 const r=await router.invoke({task:'counter_reasoning',merchantId,messages:[{role:'user',content:'x'}],output});
 assert.equal(r.invocation.outcome,'OK');assert.equal(router.status().sinkFailures,1);
});

test('plain HTTP only for loopback or tailnet self-hosted nodes; cloud needs a key',()=>{
 assert.equal(providerUrlAllowed('http://127.0.0.1:8000/v1','self_hosted'),true);
 assert.equal(providerUrlAllowed('http://100.101.2.3:8000/v1','self_hosted'),true);
 assert.equal(providerUrlAllowed('http://192.168.1.10:8000/v1','self_hosted'),false);
 assert.equal(providerUrlAllowed('http://127.0.0.1:8000/v1','cloud'),false);
 assert.equal(providerUrlAllowed('https://user:pw@x.test/v1','cloud'),false);
 assert.throws(()=>metaProvidersFromEnv({META_AI_BASETEN_URL:'https://x.test/v1',META_AI_BASETEN_MODEL:'m'}),/META_PROVIDER_KEY_REQUIRED/);
 const p=metaProvidersFromEnv({META_AI_LOCAL_MAC_URL:'http://127.0.0.1:8000/v1/',META_AI_LOCAL_MAC_MODEL:'muse-spark-open',META_AI_LOCAL_MAC_IMAGES:'1'});
 assert.deepEqual(p.map(x=>[x.id,x.baseUrl,x.weights,x.location,x.supportsImages]),[['local_mac','http://127.0.0.1:8000/v1','open','self_hosted',true]]);
});
