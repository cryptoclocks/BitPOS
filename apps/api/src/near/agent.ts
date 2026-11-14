// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// The AI agent behind the spending pass. Before it uses its pass_pay key it reads the bill (item names, quantities,
// total) and the guest's own plain-language rule for the pass, and answers "pay" or "decline" with a short reason.
// It decides only whether to pay this exact bill: it never sets an amount, a recipient or a limit. The bills
// contract still enforces the cap, the per-bill limit, the café and the expiry, so a wrong answer cannot spend more.
// With NEAR_AI_API_KEY the decision comes from NEAR AI Cloud and its response signature is verified (cfo.ts,
// nearAiChoose). Without it a fixed rule decides and the answer says so ("sample", no model called).
import {nearAiChoose,nearAiSettings,noProof,type CfoProof} from './cfo';

export interface AgentBill {shop:string;total:string;symbol:string;lines:{name:string;qty:number}[]}
export interface AgentPass {balance:string;maxBill:string;minutesLeft:number;billsPaid:number}
export interface AgentDecision {decision:'pay'|'decline';reason:string;proof:CfoProof}
export interface AgentModel {name:string|null;decide(bill:AgentBill,pass:AgentPass,rule:string):Promise<AgentDecision>}

/** The guest's rule: plain text, short, no links or markup. Empty means "pay any exact bill within the limits". */
export function cleanRule(text:unknown):string{
 const s=typeof text==='string'?text.trim().replace(/\s+/g,' ').slice(0,200):'';
 return /https?:|www\.|[<>{}]/i.test(s)?'':s;
}
const CANNED={pay:'This bill fits the pass rule and its limits, so the agent pays it.',decline:'This bill does not fit the pass rule, so the agent will not pay it.'};
/** A reason is shown to the guest: one plain sentence, no numbers, money signs or links (the page shows real amounts). */
export function cleanAgentReason(text:unknown,decision:'pay'|'decline'):string{
 const s=typeof text==='string'?text.trim().replace(/\s+/g,' '):'';
 return s.length>=10&&s.length<=240&&!/[0-9%$€£฿]|https?:|www\.|[<>{}]/i.test(s)?s:CANNED[decision];
}

/** No API key: a fixed rule. Words after "no"/"not"/"except"/"without" in the guest's rule block items that contain them. */
export const sampleAgent:AgentModel={name:null,async decide(bill,_pass,rule){
 const blocked=[...rule.toLowerCase().matchAll(/\b(?:no|not|except|without|never)\s+([a-z]{3,})/g)].map(m=>m[1].replace(/s$/,''));
 const hit=bill.lines.find(l=>blocked.some(w=>l.name.toLowerCase().includes(w)));
 const decision=hit?'decline':'pay';
 return {decision,reason:hit?'The pass rule excludes an item on this bill, so the agent will not pay it.':CANNED.pay,proof:noProof('sample','Sample decision from a fixed rule. No model was called.')};
}};

export function nearAiAgent(apiKey:string,model:string,http?:typeof fetch):AgentModel{
 return {name:model,async decide(bill,pass,rule){
  const r=await nearAiChoose({apiKey,model,http,name:'pass_decision',options:['pay','decline'],
   system:'You are a careful payment agent. A guest gave you a time-limited pass to pay cafe bills for them. Decide whether to pay this one bill. Pay only if every item fits the guest rule; if the rule is empty, pay. The limits are already checked by a contract, so judge only the rule. Write one short plain sentence as the reason. Do not write any digits, money amounts or links. Answer as JSON with the keys option and reason.',
   user:{guest_rule:rule||'(none: pay any exact bill within the limits)',bill:{shop:bill.shop,items:bill.lines.map(l=>({name:l.name,quantity:l.qty})),total:`${bill.total} ${bill.symbol}`},pass:{left:pass.balance,max_per_bill:pass.maxBill,minutes_left:pass.minutesLeft,bills_paid:pass.billsPaid}}});
  // An unreadable answer is never treated as permission to pay.
  const decision=r.option==='pay'?'pay':'decline';
  return {decision,reason:cleanAgentReason(r.reason,decision),proof:r.proof};
 }};
}
let injected:AgentModel|undefined;
/** Tests inject a stub. Production: NEAR AI Cloud when NEAR_AI_API_KEY is set, else the labelled sample rule. */
export function setAgentModel(m:AgentModel|undefined){injected=m;}
export function agentModel(env:NodeJS.ProcessEnv=process.env):AgentModel{
 if(injected)return injected;
 const ai=nearAiSettings(env);
 return ai?nearAiAgent(ai.apiKey,ai.model):sampleAgent;
}
