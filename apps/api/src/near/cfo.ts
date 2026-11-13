// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Café CFO on NEAR AI Cloud. The model sees a few aggregated shop numbers (no customer or staff identity) and picks
// ONE option id from a list the server built; it can also write a short reason. It never sets a number: every
// percentage comes from the option the server computed. A person approves before the recipe changes.
// The answer is checked the way NEAR AI documents it: the exact request and response bytes are hashed, the response
// signature is fetched and verified, and its signer must be one named in the attestation report fetched before the call.
// Not done here: verifying the TEE hardware quote inside that report. The proof says so (`quote_verified:false`).
import {createHash,randomBytes} from 'node:crypto';
import {ed25519} from '@noble/curves/ed25519';
import {MAX_SHARE_BPS} from './recipe';

export const NEAR_AI_BASE='https://cloud-api.near.ai/v1';
export interface CfoOption {id:string;taxBps:number;tipsBps:number}
export interface CfoFacts {paidBills7d:number;sales7d:string;tips7d:string;staffOnShift:number;openInvoices:number;invoicesRemaining:string;invoiceRateBps:number;taxBps:number;tipsBps:number}
export interface CfoProof {mode:'near_ai'|'sample';model:string|null;signature_kind:string|null;request_sha256:string|null;response_sha256:string|null;signer:string|null;
 signature_verified:boolean;signer_in_attestation_report:boolean;nonce_echoed:boolean;quote_verified:false;note:string}
export interface CfoAnswer {optionId:string;reason:string;proof:CfoProof}
export interface CfoModel {name:string|null;propose(facts:CfoFacts,options:CfoOption[]):Promise<CfoAnswer>}

/** The choices offered to the model: small, bounded steps around the current recipe. Server arithmetic only. */
export function cfoOptions(facts:Pick<CfoFacts,'taxBps'|'tipsBps'|'invoiceRateBps'>):CfoOption[]{
 const {taxBps:tax,tipsBps:tips}=facts;
 const candidates:CfoOption[]=[{id:'keep',taxBps:tax,tipsBps:tips},{id:'tips_up',taxBps:tax,tipsBps:tips+200},{id:'tips_down',taxBps:tax,tipsBps:tips-200},
  {id:'tax_up',taxBps:tax+100,tipsBps:tips},{id:'tax_down',taxBps:tax-100,tipsBps:tips},{id:'balanced',taxBps:700,tipsBps:1000}];
 const seen=new Set<string>();
 return candidates.filter(o=>{const key=o.taxBps+':'+o.tipsBps;const ok=o.taxBps>=0&&o.taxBps<=3000&&o.tipsBps>=0&&o.tipsBps<=3000&&o.taxBps+o.tipsBps+facts.invoiceRateBps<=MAX_SHARE_BPS&&!seen.has(key);seen.add(key);return ok;});
}
const CANNED:Record<string,string>={keep:'The current split already fits the recent sales and open supplier invoices.',tips_up:'Sales are steady, so the team on shift can share a little more of each bill.',
 tips_down:'Open supplier invoices need room, so a slightly smaller tip share keeps the owner share healthy.',tax_up:'A slightly larger tax reserve builds a safer buffer from each bill.',
 tax_down:'The tax reserve is ahead of need, so the owner can keep a little more of each bill.',balanced:'A balanced split keeps tax, tips and supplier funding in a familiar range.'};
/** A reason may not carry numbers, money signs or links: the numbers people see come from the server. */
export function cleanReason(text:unknown,optionId:string):string{
 const s=typeof text==='string'?text.trim().replace(/\s+/g,' '):'';
 return s.length>=10&&s.length<=300&&!/[0-9%$€£฿]|https?:|www\.|[<>{}]/i.test(s)?s:CANNED[optionId]??CANNED.keep;
}
const noProof=(mode:CfoProof['mode'],note:string):CfoProof=>({mode,model:null,signature_kind:null,request_sha256:null,response_sha256:null,signer:null,signature_verified:false,signer_in_attestation_report:false,nonce_echoed:false,quote_verified:false,note});

/** No API key: a simple rule picks the option, clearly labelled as a sample. No model is called. */
export const sampleModel:CfoModel={name:null,async propose(facts,options){
 const want=facts.staffOnShift===0?'keep':facts.openInvoices>0&&facts.tipsBps>1000?'tips_down':facts.tipsBps<1000?'tips_up':'keep';
 const optionId=options.some(o=>o.id===want)?want:'keep';
 return {optionId,reason:CANNED[optionId],proof:noProof('sample','Sample suggestion from a fixed rule. No model was called.')};
}};

const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const hex32=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{64}$/i.test(v);
type Fetch=typeof fetch;
/** Verifies a response signature (ed25519) against the exact bytes and the signers named before the call. Pure. */
export function verifyResponseSignature(input:{signature:{text?:unknown;signature?:unknown;signing_address?:unknown;signing_algo?:unknown;signature_kind?:unknown};requestBytes:Uint8Array;responseBytes:Uint8Array;model:string;gatewaySigner:string|null;modelSigners:string[]}){
 const {signature:s}=input;const kind=s.signature_kind==='provider_tee'||s.signature_kind==='gateway'?s.signature_kind:null;
 const hashes=`${sha(input.requestBytes)}:${sha(input.responseBytes)}`;
 const expected=kind==='provider_tee'?`${input.model}:${hashes}`:kind==='gateway'?hashes:null;
 let valid=false;
 if(expected!==null&&s.text===expected&&s.signing_algo==='ed25519'&&hex32(s.signing_address)&&typeof s.signature==='string'&&/^[0-9a-f]{128}$/i.test(s.signature)){
  try{valid=ed25519.verify(Buffer.from(s.signature,'hex'),Buffer.from(expected,'utf8'),Buffer.from(s.signing_address,'hex'));}catch{valid=false;}
 }
 const signer=hex32(s.signing_address)?s.signing_address.toLowerCase():null;
 const named=!!signer&&(kind==='provider_tee'?input.modelSigners.filter(m=>m===signer).length===1:kind==='gateway'?input.gatewaySigner===signer:false);
 return {kind,signer,signature_verified:valid,signer_in_attestation_report:valid&&named};
}

export function nearAiModel(apiKey:string,model:string,http:Fetch=fetch,base=NEAR_AI_BASE):CfoModel{
 return {name:model,async propose(facts,options){
  const proof=noProof('near_ai','');proof.model=model;
  // 1. Before the call: who is allowed to sign answers (attestation report with our own nonce).
  const nonce=randomBytes(32).toString('hex');let gatewaySigner:string|null=null,modelSigners:string[]=[];
  try{
   const report=await (await http(`${base}/attestation/report?model=${encodeURIComponent(model)}&provider=near&signing_algo=ed25519&nonce=${nonce}`,{headers:{accept:'application/json','x-no-aliasing':'true'},signal:AbortSignal.timeout(30_000)})).json() as {gateway_attestation?:Record<string,unknown>;model_attestations?:Record<string,unknown>[]};
   const g=report.gateway_attestation,models=Array.isArray(report.model_attestations)?report.model_attestations:[];
   proof.nonce_echoed=g?.request_nonce===nonce&&models.length>0&&models.every(m=>m.request_nonce===nonce);
   if(g?.signing_algo==='ed25519'&&hex32(g.signing_address))gatewaySigner=g.signing_address.toLowerCase();
   modelSigners=models.filter(m=>m.signing_algo==='ed25519'&&hex32(m.signing_address)).map(m=>(m.signing_address as string).toLowerCase());
  }catch{/* without a report the answer simply stays unverified */}
  // 2. The call: exact request bytes are kept; the model must answer with one of the option ids.
  const body=Buffer.from(JSON.stringify({model,temperature:0,max_tokens:200,stream:false,
   response_format:{type:'json_schema',json_schema:{name:'cfo_choice',strict:true,schema:{type:'object',additionalProperties:false,required:['option','reason'],properties:{option:{type:'string',enum:options.map(o=>o.id)},reason:{type:'string'}}}}},
   messages:[{role:'system',content:'You advise a small cafe owner on how each paid bill is split between the owner, a tax reserve, tips for staff on shift and supplier invoices. Choose exactly one option id from the list. Write one short plain sentence as the reason. Do not write any digits, percentages, money amounts or links. Answer as JSON with the keys option and reason.'},
    {role:'user',content:JSON.stringify({shop_last_seven_days:facts,options:options.map(o=>({id:o.id,tax_basis_points:o.taxBps,tips_basis_points:o.tipsBps}))})}]}),'utf8');
  proof.request_sha256=sha(body);
  const response=await http(`${base}/chat/completions`,{method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json',accept:'application/json','accept-encoding':'identity','x-no-aliasing':'true'},body,signal:AbortSignal.timeout(45_000)});
  const raw=Buffer.from(await response.arrayBuffer());
  if(!response.ok)throw new Error('NEAR_AI_HTTP_'+response.status);
  proof.response_sha256=sha(raw);
  const parsed=JSON.parse(raw.toString('utf8')) as {id?:unknown;choices?:{message?:{content?:unknown}}[]};
  let choice:{option?:unknown;reason?:unknown}={};try{choice=JSON.parse(String(parsed.choices?.[0]?.message?.content??''));}catch{/* handled below */}
  const optionId=options.some(o=>o.id===choice.option)?choice.option as string:'keep';
  // 3. After the call: the response signature over those exact bytes, from a signer named in step 1.
  if(typeof parsed.id==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(parsed.id)){
   for(let attempt=0;attempt<4&&!proof.signature_verified;attempt++){
    try{
     const r=await http(`${base}/signature/${parsed.id}?signing_algo=ed25519`,{headers:{authorization:`Bearer ${apiKey}`,accept:'application/json'},signal:AbortSignal.timeout(15_000)});
     if(r.ok){const signature=await r.json() as Record<string,unknown>;
      if(!('error_code' in signature)){const v=verifyResponseSignature({signature,requestBytes:body,responseBytes:raw,model,gatewaySigner,modelSigners});
       proof.signature_kind=v.kind;proof.signer=v.signer;proof.signature_verified=v.signature_verified;proof.signer_in_attestation_report=v.signer_in_attestation_report;if(v.signature_verified)break;}}
    }catch{/* retried below */}
    await new Promise(resolve=>setTimeout(resolve,1200));
   }
  }
  proof.note=proof.signature_verified&&proof.signer_in_attestation_report?'Response signature verified over the exact request and response bytes; signer named in the attestation report fetched before the call. The TEE hardware quote in that report was not verified by BitPOS.'
   :'The answer could not be verified (no matching response signature). Treat it as an unverified suggestion.';
  return {optionId,reason:cleanReason(choice.reason,optionId),proof};
 }};
}
let model:CfoModel|undefined;
/** Tests inject a stub model. Production uses NEAR AI Cloud when NEAR_AI_API_KEY is set, else the labelled sample. */
export function setCfoModel(m:CfoModel|undefined){model=m;}
export function cfoModel(env:NodeJS.ProcessEnv=process.env):CfoModel{
 if(model)return model;
 const key=env.NEAR_AI_API_KEY;
 return key&&/^[A-Za-z0-9._-]{20,300}$/.test(key)?nearAiModel(key,env.NEAR_AI_MODEL&&/^[A-Za-z0-9._\/-]{3,100}$/.test(env.NEAR_AI_MODEL)?env.NEAR_AI_MODEL:'z-ai/glm-5.3-flash'):sampleModel;
}
