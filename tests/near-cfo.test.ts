// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Café CFO. The model is a stub in every test (no credits spent); the NEAR AI Cloud client is exercised against a
// scripted HTTP double that signs like the documented gateway, so the verification code runs for real.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ed25519} from '@noble/curves/ed25519';
import {cfoOptions,cleanReason,nearAiModel,sampleModel,verifyResponseSignature,type CfoFacts} from '../apps/api/src/near/cfo';

const facts:CfoFacts={paidBills7d:40,sales7d:'212.50',tips7d:'21.25',staffOnShift:2,openInvoices:1,invoicesRemaining:'96.40',invoiceRateBps:1200,taxBps:700,tipsBps:1000};
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');

test('options are small bounded steps computed by the server; impossible ones are never offered',()=>{
 assert.deepEqual(cfoOptions(facts).map(o=>[o.id,o.taxBps,o.tipsBps]),[['keep',700,1000],['tips_up',700,1200],['tips_down',700,800],['tax_up',800,1000],['tax_down',600,1000]]);
 assert.deepEqual(cfoOptions({taxBps:0,tipsBps:0,invoiceRateBps:0}).map(o=>o.id),['keep','tips_up','tax_up','balanced']);
 assert.deepEqual(cfoOptions({taxBps:3000,tipsBps:3000,invoiceRateBps:3000}).map(o=>o.id),['keep','tips_down','tax_down','balanced'],'nothing above the 90% cap or the per-share limits');
});
test('a reason with numbers, money signs or links is replaced by the server\'s own sentence',()=>{
 assert.equal(cleanReason('Sales look steady so the team can share a little more.','tips_up'),'Sales look steady so the team can share a little more.');
 for(const bad of ['Raise tips to 12%','Pay $5 more','see https://evil.example','<b>bold</b>','short',5,null,'x'.repeat(301)])
  assert.equal(cleanReason(bad,'tips_up'),'Sales are steady, so the team on shift can share a little more of each bill.',String(bad));
});
test('without a key the suggestion is a labelled sample and no model is called',async()=>{
 const answer=await sampleModel.propose(facts,cfoOptions(facts));
 assert.equal(answer.proof.mode,'sample');assert.equal(answer.proof.signature_verified,false);assert.match(answer.proof.note,/No model was called/);assert.equal(answer.optionId,'keep');
});

/** A scripted NEAR AI Cloud: attestation report, completion and response signature, signed like the gateway. */
function fakeCloud(over:{tamperResponse?:boolean;wrongSigner?:boolean;choice?:unknown;noSignature?:boolean}={}){
 const gatewayKey=ed25519.utils.randomPrivateKey(),gateway=Buffer.from(ed25519.getPublicKey(gatewayKey)).toString('hex');
 const strangerKey=ed25519.utils.randomPrivateKey();
 const seen:{url:string;headers:Record<string,string>;body?:string}[]=[];let requestBytes=Buffer.alloc(0),responseBytes=Buffer.alloc(0);
 const http=(async(input:string|URL|Request,init?:RequestInit)=>{
  const url=String(input);const headers=Object.fromEntries(Object.entries((init?.headers??{}) as Record<string,string>).map(([k,v])=>[k.toLowerCase(),v]));
  seen.push({url,headers,body:init?.body?Buffer.from(init.body as Uint8Array).toString('utf8'):undefined});
  const reply=(status:number,bytes:Buffer)=>new Response(new Uint8Array(bytes),{status,headers:{'content-type':'application/json'}});
  if(url.includes('/attestation/report')){const nonce=new URL(url).searchParams.get('nonce');
   return reply(200,Buffer.from(JSON.stringify({gateway_attestation:{signing_address:gateway,signing_algo:'ed25519',request_nonce:nonce},model_attestations:[{model_name:'z-ai/glm-5.3-flash',signing_address:'ab'.repeat(32),signing_algo:'ed25519',request_nonce:nonce}]})));}
  if(url.endsWith('/chat/completions')){requestBytes=Buffer.from(init!.body as Uint8Array);
   responseBytes=Buffer.from(JSON.stringify({id:'chatcmpl-test123',choices:[{message:{content:JSON.stringify(over.choice??{option:'tips_up',reason:'Sales are steady and the team is busy.'})}}]}));
   return reply(200,responseBytes);}
  if(url.includes('/signature/')){if(over.noSignature)return reply(404,Buffer.from('{}'));
   const text=`${sha(requestBytes)}:${sha(over.tamperResponse?Buffer.from('other'):responseBytes)}`;const key=over.wrongSigner?strangerKey:gatewayKey;
   return reply(200,Buffer.from(JSON.stringify({text,signature:Buffer.from(ed25519.sign(Buffer.from(text),key)).toString('hex'),signing_address:Buffer.from(ed25519.getPublicKey(key)).toString('hex'),signing_algo:'ed25519',signature_kind:'gateway'})));}
  return reply(404,Buffer.from('{}'));
 }) as typeof fetch;
 return {http,seen,gateway};
}
test('NEAR AI Cloud answer: exact bytes hashed, signature verified, signer must be the one named before the call',async()=>{
 const cloud=fakeCloud();
 const answer=await nearAiModel('k'.repeat(40),'z-ai/glm-5.3-flash',cloud.http).propose(facts,cfoOptions(facts));
 assert.equal(answer.optionId,'tips_up');assert.equal(answer.reason,'Sales are steady and the team is busy.');
 assert.deepEqual({...answer.proof,request_sha256:'x',response_sha256:'x',note:'x'},{mode:'near_ai',model:'z-ai/glm-5.3-flash',signature_kind:'gateway',request_sha256:'x',response_sha256:'x',signer:cloud.gateway,signature_verified:true,signer_in_attestation_report:true,nonce_echoed:true,quote_verified:false,note:'x'});
 assert.match(answer.proof.note,/hardware quote in that report was not verified/);
 const completion=cloud.seen.find(s=>s.url.endsWith('/chat/completions'))!;
 assert.equal(answer.proof.request_sha256,sha(completion.body!));assert.equal(completion.headers['x-no-aliasing'],'true');
 const sent=JSON.parse(completion.body!);assert.deepEqual(sent.response_format.json_schema.schema.properties.option.enum,['keep','tips_up','tips_down','tax_up','tax_down']);
 assert.ok(!/orbit|testnet|@|[0-9a-f]{8}-[0-9a-f]{4}/.test(completion.body!),'no shop, account or person identity is sent to the model');
 assert.ok(cloud.seen.findIndex(s=>s.url.includes('/attestation/report'))<cloud.seen.indexOf(completion),'the report is fetched before the call');
});
test('NEAR AI Cloud answer that cannot be verified stays an unverified suggestion; an unknown option falls back to keep',{timeout:30000},async()=>{
 for(const over of [{tamperResponse:true},{noSignature:true}]){
  const a=await nearAiModel('k'.repeat(40),'z-ai/glm-5.3-flash',fakeCloud(over).http).propose(facts,cfoOptions(facts));
  assert.equal(a.proof.signature_verified,false,JSON.stringify(over));assert.equal(a.proof.signer_in_attestation_report,false);assert.match(a.proof.note,/could not be verified/);
 }
 const stranger=await nearAiModel('k'.repeat(40),'z-ai/glm-5.3-flash',fakeCloud({wrongSigner:true}).http).propose(facts,cfoOptions(facts));
 assert.equal(stranger.proof.signature_verified,true,'a valid signature…');assert.equal(stranger.proof.signer_in_attestation_report,false,'…from a signer the report did not name proves nothing');assert.match(stranger.proof.note,/could not be verified/);
 const invented=await nearAiModel('k'.repeat(40),'z-ai/glm-5.3-flash',fakeCloud({choice:{option:'give_all_to_me',reason:'Set tips to 99%'}}).http).propose(facts,cfoOptions(facts));
 assert.equal(invented.optionId,'keep');assert.ok(!/\d/.test(invented.reason));
});
test('signature check is strict about kind, text, algorithm and signer',()=>{
 const key=ed25519.utils.randomPrivateKey(),pk=Buffer.from(ed25519.getPublicKey(key)).toString('hex');const req=Buffer.from('req'),res=Buffer.from('res');
 const sign=(text:string)=>Buffer.from(ed25519.sign(Buffer.from(text),key)).toString('hex');
 const teeText=`m:${sha(req)}:${sha(res)}`;
 const base={requestBytes:req,responseBytes:res,model:'m',gatewaySigner:null,modelSigners:[pk]};
 assert.deepEqual(verifyResponseSignature({...base,signature:{text:teeText,signature:sign(teeText),signing_address:pk,signing_algo:'ed25519',signature_kind:'provider_tee'}}),{kind:'provider_tee',signer:pk,signature_verified:true,signer_in_attestation_report:true});
 assert.equal(verifyResponseSignature({...base,modelSigners:[pk,pk],signature:{text:teeText,signature:sign(teeText),signing_address:pk,signing_algo:'ed25519',signature_kind:'provider_tee'}}).signer_in_attestation_report,false,'an ambiguous match is not a match');
 assert.equal(verifyResponseSignature({...base,signature:{text:teeText,signature:sign(teeText),signing_address:pk,signing_algo:'ed25519'}}).signature_verified,false,'no kind, no inference');
 assert.equal(verifyResponseSignature({...base,signature:{text:teeText,signature:sign(teeText),signing_address:pk,signing_algo:'ecdsa',signature_kind:'provider_tee'}}).signature_verified,false);
 assert.equal(verifyResponseSignature({...base,model:'other',signature:{text:teeText,signature:sign(teeText),signing_address:pk,signing_algo:'ed25519',signature_kind:'provider_tee'}}).signature_verified,false);
});

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
test('N-09: the CFO only proposes; an owner or manager approves; staff can do neither; the recipe changes only on approval',integration,async()=>{
 const {setupNearShop}=await import('./near-fixture');const {setCfoModel}=await import('../apps/api/src/near/cfo');
 const {api,f}=await setupNearShop();
 setCfoModel({name:'stub-model',async propose(_facts,options){return {optionId:'tips_up',reason:'Raise it to 12% now',proof:{...(await sampleModel.propose(_facts,options)).proof,mode:'near_ai',model:'stub-model'}};}});
 try{
  const code=(c:string)=>(e:Error&{code?:string})=>e.code===c||e.message===c;
  await assert.rejects(api('staff','cfo/runs','POST',{}),code('ROLE_REQUIRED'));
  const run=await api('manager','cfo/runs','POST',{}) as {id:string;option:string;taxBps:number;tipsBps:number;reason:string};
  assert.deepEqual([run.option,run.taxBps,run.tipsBps],['tips_up',700,1200]);assert.ok(!/\d/.test(run.reason),'the model\'s numbers never reach the page');
  const recipe=async()=>(await api('staff','account') as {recipe:{taxBps:number;tipsBps:number}}).recipe;
  assert.deepEqual([(await recipe()).taxBps,(await recipe()).tipsBps],[700,1000],'nothing changed yet');
  await assert.rejects(api('staff',`cfo/runs/${run.id}/approve`,'POST',{}),code('ROLE_REQUIRED'));
  assert.deepEqual(await api('owner',`cfo/runs/${run.id}/approve`,'POST',{}),{ok:true,status:'APPROVED',recipe:{taxBps:700,tipsBps:1200}});
  assert.deepEqual([(await recipe()).taxBps,(await recipe()).tipsBps],[700,1200]);
  await assert.rejects(api('owner',`cfo/runs/${run.id}/approve`,'POST',{}),code('NEAR_CFO_ALREADY_DECIDED'));
  const second=await api('owner','cfo/runs','POST',{}) as {id:string};await api('owner',`cfo/runs/${second.id}/dismiss`,'POST',{});
  const list=await api('staff','cfo') as {mode:string;runs:{status:string}[]};assert.equal(list.mode,'near_ai');assert.deepEqual(list.runs.map(r=>r.status),['DISMISSED','APPROVED']);
  void f;
 }finally{setCfoModel(undefined);}
});
