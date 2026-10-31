// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// One real Café Copilot run against Gemini on the local demo shop (fixture DB only), then the existing promotion
// generator writes the draft copy with the same Gemini key. Prints the trace; never prints the key.
//   pnpm exec tsx tools/paypal/copilot-live.ts ["intent"] [th|en]
import 'dotenv/config';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const db=new URL(process.env.DATABASE_URL??'');
if(db.hostname!=='127.0.0.1'||db.port!=='55466')throw Error('copilot-live only runs against the local PayPal fixture database (127.0.0.1:55466)');
for(const line of readFileSync(join(homedir(),'.bitpos-paypal/gemini.env'),'utf8').split('\n')){const m=line.match(/^(BITPOS_AI_[A-Z_]+)=(.*)$/);if(m)process.env[m[1]]=m[2].trim();}
const SHOP='33333333-3333-4333-8333-333333333333',OWNER='33333333-3333-4333-8333-0000000000a1';
const end=new Date(Date.now()+90*60_000);
const hhmm=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false}).format(end);
const intent=process.argv[2]??`ขายครัวซองต์ที่เหลือ 8 ชิ้นก่อน ${hhmm} ลดไม่เกิน 10%`;
const language=(process.argv[3]==='en'?'en':'th') as 'th'|'en';

const {runCopilot}=await import('../../apps/api/src/paypal/agent');
const {envelopeView}=await import('../../apps/api/src/paypal/copilot');
const {runPromotionJob}=await import('../../apps/worker/src/promotions');
const {pool,tenant}=await import('../../apps/api/src/db');
try{
 const t0=Date.now();
 const r=await runCopilot({merchant:SHOP,actor:OWNER,role:'owner',intent,language});
 console.log(JSON.stringify({intent,state:r.state,failure:r.failure,question:r.question,envelopeId:r.envelopeId,ms:Date.now()-t0}));
 const steps=(await tenant(SHOP,d=>d.query('SELECT seq,kind,tool,args,result,violations,provider_request_id,latency_ms FROM paypal_agent_steps WHERE merchant_id=$1 AND run_id=$2 ORDER BY seq',[SHOP,r.runId]))).rows;
 for(const s of steps)console.log(JSON.stringify({seq:s.seq,kind:s.kind,tool:s.tool,args:s.args,violations:s.violations,result:s.kind==='model_call'?s.result:JSON.stringify(s.result).slice(0,240),requestId:s.provider_request_id,ms:s.latency_ms}));
 const run=(await tenant(SHOP,d=>d.query('SELECT provider,model FROM paypal_agent_runs WHERE merchant_id=$1 AND id=$2',[SHOP,r.runId]))).rows[0];
 console.log(JSON.stringify({run:r.runId,provider:run.provider,model:run.model}));
 if(r.envelopeId){
  await runPromotionJob(SHOP);// existing generator, real provider from BITPOS_AI_* (writes headline/copy, renders the image)
  const e=await envelopeView(SHOP,r.envelopeId);
  console.log(JSON.stringify({envelope:{state:e.state,maxUnits:e.maxUnits,discountPercent:e.discountPercent,endsAt:e.endsAt,job:e.job,campaign:e.campaign&&{state:e.campaign.state,headline:e.campaign.headline,copy:e.campaign.copy,rationale:e.campaign.rationale,offerPrice:e.campaign.offerPrice}}}));
 }
}finally{await pool.end();}
