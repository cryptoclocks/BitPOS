// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Merchant API for Café Copilot and PayPal results (staff session; owner/manager for changes). Runs outside the shared
// request transaction so a model call never holds a database transaction.
//   POST /api/paypal/copilot/runs                 {intent,language}            run the agent → draft envelope
//   POST /api/paypal/copilot/rules                {productId,maxUnits,…}       same draft from a form (no model)
//   GET  /api/paypal/copilot/runs[/:id]                                         recent runs / one run with its trace
//   GET  /api/paypal/copilot/envelopes/:id                                      envelope + campaign + units
//   POST /api/paypal/copilot/envelopes/:id/approve {campaignVersion}            owner approves campaign + limits
//   POST /api/paypal/copilot/envelopes/:id/publish {confirmAllScreens:true}     owner sends it to the shop's screens
//   POST /api/paypal/copilot/envelopes/:id/stop                                 owner stops the offer
//   GET  /api/paypal/screens                                                    screens the owner can choose
//   GET  /api/paypal/envelopes/:id/outcome · GET /api/paypal/orders/:id/evidence · GET /api/paypal/ledger
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {tenant} from '../db';
import {routingLock,RequestError} from '../authority';
import {promotionsRequest,promotionDevices} from '../promotions';
import {runCopilot,AgentFailure,type AgentModel} from './agent';
import {parseIntent,saveCampaignDraft,validateCampaign,type ToolContext} from './agent-tools';
import {minorToValue} from './money';

const uuid=z.string().uuid();
// PayPal-specific codes are not in the shared ConsumerError union; the HTTP layer only needs status + code.
const refuse=(status:number,code:string):never=>{throw new RequestError(status,code as never,code);};
const changeRole=(role:string)=>{if(!['owner','manager'].includes(role))refuse(403,'ROLE_REQUIRED');};
let model:AgentModel|undefined;
/** Tests inject a scripted model; production uses Gemini through the existing BITPOS_AI_* configuration. */
export function setCopilotModel(m:AgentModel|undefined){model=m;}
// Report formatting, not a PayPal request amount: zero (no sales yet, zero fee) must format instead of throwing.
const usd=(cents:string|number|bigint|null)=>cents===null?null:minorToValue(BigInt(cents),2);

async function runView(merchant:string,id:string){
 return tenant(merchant,async db=>{
  const run=(await db.query('SELECT id,intent,language,kind,provider,model,state,failure,question,steps,envelope_id AS "envelopeId",started_at AS "startedAt",finished_at AS "finishedAt" FROM paypal_agent_runs WHERE merchant_id=$1 AND id=$2',[merchant,id])).rows[0];
  if(!run)refuse(404,'RESOURCE_NOT_FOUND');
  const steps=(await db.query('SELECT seq,kind,tool,args,result,violations,provider_request_id AS "requestId",latency_ms AS "latencyMs",created_at AS "at" FROM paypal_agent_steps WHERE merchant_id=$1 AND run_id=$2 ORDER BY seq',[merchant,id])).rows;
  return {run,steps};
 });
}

export async function envelopeView(merchant:string,id:string){
 return tenant(merchant,async db=>{
  const e=(await db.query(`SELECT e.*,j.state AS job_state,j.blocker AS job_blocker,coalesce(e.campaign_id,j.campaign_id) AS linked_campaign FROM paypal_campaign_envelopes e JOIN ai_generation_jobs j ON j.merchant_id=e.merchant_id AND j.id=e.job_id WHERE e.merchant_id=$1 AND e.id=$2`,[merchant,id])).rows[0];
  if(!e)refuse(404,'RESOURCE_NOT_FOUND');
  const c=e.linked_campaign?(await db.query('SELECT id,version,state,headline,copy,rationale,discount_percent AS "discountPercent",snapshot,expires_at AS "expiresAt",approved_version AS "approvedVersion",approved_by AS "approvedBy" FROM promotion_campaigns WHERE merchant_id=$1 AND id=$2',[merchant,e.linked_campaign])).rows[0]:null;
  const units=(await db.query("SELECT state,coalesce(sum(units),0)::int AS units FROM paypal_campaign_units WHERE merchant_id=$1 AND envelope_id=$2 GROUP BY state",[merchant,id])).rows;
  const by=(s:string)=>units.find(u=>u.state===s)?.units??0;
  const targets=c?(await db.query('SELECT t.id,t.state,t.target_device_id AS "deviceId",d.label,t.created_at AS "createdAt",t.rendered_at AS "renderedAt" FROM promotion_playlist_targets t JOIN devices d ON d.merchant_id=t.merchant_id AND d.id=t.target_device_id WHERE t.merchant_id=$1 AND t.campaign_id=$2 ORDER BY t.created_at DESC LIMIT 10',[merchant,c.id])).rows:[];
  const base=c?.snapshot?.basePrice,price=c&&base?{currency:base.currency,decimals:base.decimals,amountMinor:(BigInt(base.amountMinor)-BigInt(base.amountMinor)*BigInt(c.discountPercent)/100n).toString()}:null;
  return {id:e.id,state:e.state,endedReason:e.ended_reason,version:e.version,approvedVersion:e.approved_version,approvedBy:e.approved_by,approvedAt:e.approved_at,productId:e.product_id,
   maxUnits:e.max_units,maxUnitsPerOrder:e.max_units_per_order,discountPercent:e.discount_percent,startsAt:e.starts_at,endsAt:e.ends_at,agentRunId:e.agent_run_id,
   job:{id:e.job_id,state:e.job_state,blocker:e.job_blocker},
   campaign:c?{id:c.id,version:c.version,state:c.state,headline:c.headline,copy:c.copy,rationale:c.rationale,discountPercent:c.discountPercent,expiresAt:c.expiresAt,approvedVersion:c.approvedVersion,
    productName:c.snapshot?.nameEn??null,productNameTh:c.snapshot?.name??null,basePrice:base??null,offerPrice:price}:null,
   units:{reserved:by('RESERVED'),consumed:by('CONSUMED'),released:by('RELEASED'),remaining:Math.max(0,e.max_units-by('RESERVED')-by('CONSUMED'))},targets};
 });
}

async function approve(merchant:string,actor:string,role:string,id:string,input:unknown){
 changeRole(role);const {campaignVersion}=z.object({campaignVersion:z.number().int().positive()}).strict().parse(input);
 const e=await envelopeView(merchant,id);
 if(!e.campaign)refuse(409,e.job.state==='CONFIGURATION_REQUIRED'?'AI_NOT_CONFIGURED':'DRAFT_NOT_READY');
 if(e.state!=='DRAFT')refuse(409,'ENVELOPE_STATE_INVALID');
 if(Date.parse(e.endsAt)<=Date.now()+5*60_000)refuse(409,'CAMPAIGN_ENDING');
 // What customers are charged comes from the campaign; it must still be exactly the offer the envelope limits.
 if(e.campaign!.discountPercent!==e.discountPercent||new Date(e.campaign!.expiresAt).getTime()!==new Date(e.endsAt).getTime())refuse(409,'CAMPAIGN_CHANGED');
 return tenant(merchant,async db=>{
  await routingLock(db,merchant);
  // Checked again under the routing lock: two drafts for one product must not both become live.
  if((await db.query("SELECT 1 FROM paypal_campaign_envelopes WHERE merchant_id=$1 AND product_id=$2 AND state='APPROVED' AND ends_at>clock_timestamp() AND id<>$3",[merchant,e.productId,id])).rowCount)refuse(409,'ACTIVE_CAMPAIGN_EXISTS');
  // Campaign approval (existing rules) and the envelope approval commit together.
  if(e.campaign!.state!=='APPROVED'||e.campaign!.approvedVersion!==campaignVersion)
   await promotionsRequest(db,merchant,actor,role,`/api/promotions/${e.campaign!.id}/approve`,'POST',{expectedVersion:campaignVersion,idempotencyKey:'copilot-approve-'+id+'-'+campaignVersion});
  const updated=await db.query("UPDATE paypal_campaign_envelopes SET campaign_id=$3,state='APPROVED',approved_version=version,approved_by=$4,approved_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2 AND state='DRAFT' RETURNING id",[merchant,id,e.campaign!.id,actor]);
  if(!updated.rowCount)refuse(409,'ENVELOPE_STATE_INVALID');
  return {approved:true,envelopeId:id,campaignId:e.campaign!.id};
 }).then(async r=>({...r,envelope:await envelopeView(merchant,id)}));
}

/** Daily offers go to every current screen of the shop (existing rule: a subset is refused). The owner confirms the list. */
async function publish(merchant:string,actor:string,role:string,id:string,input:unknown){
 changeRole(role);z.object({confirmAllScreens:z.literal(true)}).strict().parse(input);
 const e=await envelopeView(merchant,id);
 if(e.state!=='APPROVED'||!e.campaign)refuse(409,'APPROVAL_REQUIRED');
 return tenant(merchant,async db=>{
  await routingLock(db,merchant);
  const devices=await promotionDevices(db,merchant);if(!devices.length)refuse(409,'NO_SCREENS');
  // Publishing bumps the campaign version, so a request key cannot dedupe a retry. Instead: if every current screen
  // already has a live target for the campaign's approved version (same assignment), a repeat publish changes nothing.
  // Targets of an older approved version do not count: the daily price only follows the approved version.
  const live=(await db.query<{device:string;generation:string}>(`SELECT t.target_device_id AS device,t.assignment_generation::text AS generation FROM promotion_playlist_targets t
   JOIN promotion_campaigns c ON c.merchant_id=t.merchant_id AND c.id=t.campaign_id AND t.campaign_version=c.approved_version
   WHERE t.merchant_id=$1 AND t.campaign_id=$2 AND t.state NOT IN ('REVOKED','EXPIRED','TARGET_CHANGED')`,[merchant,e.campaign!.id])).rows;
  if(devices.every(x=>live.some(t=>t.device===x.deviceId&&t.generation===x.assignmentGeneration)))return {published:true,alreadyPublished:true};
  const targets=devices.map(x=>({deviceId:x.deviceId,assignmentGeneration:x.assignmentGeneration,authGeneration:x.authGeneration,screenGeneration:x.screenGeneration}));
  const c=(await db.query('SELECT version FROM promotion_campaigns WHERE merchant_id=$1 AND id=$2',[merchant,e.campaign!.id])).rows[0];
  const result=await promotionsRequest(db,merchant,actor,role,`/api/promotions/${e.campaign!.id}/publish`,'POST',{expectedVersion:c.version,idempotencyKey:'copilot-publish-'+randomUUID(),confirmTargets:true,targets});
  return {published:true,result};
 });
}

async function stop(merchant:string,actor:string,role:string,id:string){
 changeRole(role);const e=await envelopeView(merchant,id);
 return tenant(merchant,async db=>{
  await routingLock(db,merchant);
  await db.query("UPDATE paypal_campaign_envelopes SET state='REVOKED',ended_reason='REVOKED' WHERE merchant_id=$1 AND id=$2 AND state IN ('DRAFT','APPROVED')",[merchant,id]);
  if(e.campaign&&e.campaign.state==='APPROVED'){
   const c=(await db.query('SELECT version FROM promotion_campaigns WHERE merchant_id=$1 AND id=$2',[merchant,e.campaign.id])).rows[0];
   await promotionsRequest(db,merchant,actor,role,`/api/promotions/${e.campaign.id}/revoke`,'POST',{expectedVersion:c.version,idempotencyKey:'copilot-stop-'+id});
  }
  return {stopped:true};
 });
}

/** Rules baseline: the same validation and draft path, filled from a form instead of a model (labelled kind=rules_baseline). */
async function rules(merchant:string,actor:string,role:string,input:unknown){
 changeRole(role);
 const d=z.object({productId:uuid,maxUnits:z.number().int(),maxUnitsPerOrder:z.number().int().optional(),discountPercent:z.number().int(),endsAt:z.string().max(40),language:z.enum(['th','en']).default('th')}).strict().parse(input);
 const runId=randomUUID();const intent=`Form: ${d.maxUnits} units, ${d.discountPercent}% off until ${d.endsAt}`;
 await tenant(merchant,db=>db.query("INSERT INTO paypal_agent_runs(merchant_id,id,actor,intent,language,kind) VALUES($1,$2,$3,$4,$5,'rules_baseline')",[merchant,runId,actor,intent,d.language]));
 const ctx:ToolContext={merchant,actor,role,runId,intent,language:d.language,caps:{discountPercent:null,units:null,endsAt:null},now:()=>new Date(),tenant:fn=>tenant(merchant,fn)};
 const v=await validateCampaign(ctx,d);
 const saved=v.ok?await saveCampaignDraft(ctx,{...d,rationale:'Created from the form (no AI).'}):{saved:false as const,violations:v.violations};
 const envelopeId='envelopeId' in saved?saved.envelopeId:null;
 await tenant(merchant,async db=>{
  await db.query('INSERT INTO paypal_agent_steps(merchant_id,run_id,seq,kind,tool,args,result,violations) VALUES($1,$2,1,$3,$4,$5,$6,$7)',[merchant,runId,'tool_call','save_campaign_draft',JSON.stringify(d),JSON.stringify(saved),v.violations.length?v.violations:null]);
  await db.query('UPDATE paypal_agent_runs SET state=$3,failure=$4,envelope_id=$5,steps=1,finished_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2',[merchant,runId,envelopeId?'DRAFTED':'FAILED',envelopeId?null:'VALIDATION_FAILED',envelopeId]);
 });
 return {runId,state:envelopeId?'DRAFTED':'FAILED',envelopeId,violations:v.violations,computed:v.computed??null};
}

/** Campaign outcome from verified facts only: units by state and PayPal money from settled captures. */
export async function envelopeOutcome(merchant:string,id:string){
 const env=await envelopeView(merchant,id);
 return tenant(merchant,async db=>{
  const orders=(await db.query(`SELECT u.order_id AS "orderId",u.units,u.state AS "unitState",o.status,o.created_at AS "createdAt",o.paid_at AS "paidAt",a.serving_label_snapshot AS "serving",
   s.capture_id AS "captureId",s.state AS "settlement",c.gross_cents::text AS gross,c.fee_cents::text AS fee,c.net_cents::text AS net,f.status AS "fulfillment"
   FROM paypal_campaign_units u JOIN orders o ON o.merchant_id=u.merchant_id AND o.id=u.order_id
   LEFT JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id
   LEFT JOIN paypal_settlements s ON s.merchant_id=o.merchant_id AND s.order_id=o.id
   LEFT JOIN paypal_captures c ON c.merchant_id=s.merchant_id AND c.capture_id=s.capture_id
   LEFT JOIN LATERAL (SELECT status FROM order_fulfillment f WHERE f.merchant_id=o.merchant_id AND f.order_id=o.id LIMIT 1) f ON true
   WHERE u.merchant_id=$1 AND u.envelope_id=$2 ORDER BY o.created_at`,[merchant,id])).rows;
  const refunds=(await db.query(`SELECT coalesce(sum(p.amount_cents),0)::text AS cents,count(*)::int AS n FROM paypal_payment_events p JOIN paypal_settlements s ON s.merchant_id=p.merchant_id AND s.capture_id=p.capture_id
   JOIN paypal_campaign_units u ON u.merchant_id=s.merchant_id AND u.order_id=s.order_id WHERE u.merchant_id=$1 AND u.envelope_id=$2 AND p.kind IN ('REFUNDED','PARTIALLY_REFUNDED','REVERSED')`,[merchant,id])).rows[0];
  const settled=orders.filter(o=>o.settlement==='SETTLED');
  const sum=(k:'gross'|'fee'|'net')=>settled.reduce((a,o)=>a+BigInt(o[k]??0),0n);
  return {envelope:env,environment:'PayPal Sandbox',
   totals:{unitsPaid:env.units.consumed,unitsReserved:env.units.reserved,unitsRemaining:env.units.remaining,maxUnits:env.maxUnits,ordersPaid:settled.length,
    collected:orders.filter(o=>o.fulfillment==='COLLECTED').length,recovery:orders.filter(o=>o.settlement==='RECOVERY').length,
    gross:usd(sum('gross')),fee:usd(sum('fee')),net:usd(sum('net')),refunded:refunds.n?usd(refunds.cents):'0.00',refunds:refunds.n,currency:'USD'},
   orders:orders.map(o=>({...o,gross:usd(o.gross),fee:usd(o.fee),net:usd(o.net)}))};
 });
}

/** Evidence trace for one order: intent → tools → approval → screen → quote → PayPal → settlement → outbox/render. */
export async function orderEvidence(merchant:string,orderId:string){
 return tenant(merchant,async db=>{
  const o=(await db.query('SELECT id,status,version,created_at,paid_at,quote_expires_at FROM orders WHERE merchant_id=$1 AND id=$2',[merchant,orderId])).rows[0];if(!o)refuse(404,'RESOURCE_NOT_FOUND');
  const a=(await db.query('SELECT quote_id,serving_label_snapshot,target_device_id,total_minor::text,catalog_decimals FROM order_authority WHERE merchant_id=$1 AND order_id=$2',[merchant,orderId])).rows[0];
  const unit=(await db.query('SELECT envelope_id,units,state,created_at FROM paypal_campaign_units WHERE merchant_id=$1 AND order_id=$2',[merchant,orderId])).rows[0];
  const env=unit?(await db.query('SELECT e.*,r.intent,r.model,r.provider,r.kind,r.steps,r.started_at AS run_at FROM paypal_campaign_envelopes e LEFT JOIN paypal_agent_runs r ON r.merchant_id=e.merchant_id AND r.id=e.agent_run_id WHERE e.merchant_id=$1 AND e.id=$2',[merchant,unit.envelope_id])).rows[0]:null;
  const tools=env?.agent_run_id?(await db.query("SELECT tool,violations,created_at FROM paypal_agent_steps WHERE merchant_id=$1 AND run_id=$2 AND kind='tool_call' ORDER BY seq",[merchant,env.agent_run_id])).rows:[];
  const target=env?.campaign_id?(await db.query('SELECT t.id,t.created_at,t.rendered_at,d.label FROM promotion_playlist_targets t JOIN devices d ON d.merchant_id=t.merchant_id AND d.id=t.target_device_id WHERE t.merchant_id=$1 AND t.campaign_id=$2 ORDER BY t.rendered_at NULLS LAST,t.created_at LIMIT 1',[merchant,env.campaign_id])).rows[0]:null;
  const checkouts=(await db.query('SELECT id,status,paypal_order_id,amount_cents::text,created_at,approved_at,capture_started_at,last_issue FROM paypal_checkouts WHERE merchant_id=$1 AND order_id=$2 ORDER BY created_at',[merchant,orderId])).rows;
  const captures=(await db.query('SELECT c.capture_id,c.status,c.gross_cents::text,c.fee_cents::text,c.net_cents::text,c.verified_via,c.first_seen_at,s.state AS settlement,s.recovery_reason,s.created_at AS settled_at FROM paypal_captures c JOIN paypal_checkouts k ON k.merchant_id=c.merchant_id AND k.id=c.checkout_id LEFT JOIN paypal_settlements s ON s.merchant_id=c.merchant_id AND s.capture_id=c.capture_id WHERE c.merchant_id=$1 AND k.order_id=$2',[merchant,orderId])).rows;
  const webhooks=(await db.query('SELECT * FROM bitpos.paypal_webhook_recent($1,100)',[merchant])).rows.filter(w=>checkouts.some(k=>k.id===w.checkout_id));
  const events=(await db.query('SELECT e.type,e.order_version,e.created_at,d.status AS delivery,d.rendered_at FROM outbox_events e LEFT JOIN device_event_deliveries d ON d.merchant_id=e.merchant_id AND d.event_id=e.id WHERE e.merchant_id=$1 AND e.order_id=$2 ORDER BY e.created_at',[merchant,orderId])).rows;
  const steps:{step:string;at:string|null;detail:string;source:string}[]=[];
  if(env){
   steps.push({step:'intent',at:env.run_at,detail:env.intent??'',source:env.kind==='rules_baseline'?'form (no AI)':`${env.model??'model'} · run ${String(env.agent_run_id).slice(0,8)}`});
   steps.push({step:'tools',at:env.run_at,detail:tools.map(t=>t.tool+(t.violations?` (${t.violations.join(',')})`:'')).join(' → '),source:'paypal_agent_steps'});
   steps.push({step:'approved',at:env.approved_at,detail:`v${env.approved_version} by ${env.approved_by} · ${env.max_units} units · ${env.discount_percent}% off · until ${new Date(env.ends_at).toISOString()}`,source:'paypal_campaign_envelopes'});
  }
  if(target)steps.push({step:'published',at:target.created_at,detail:`${target.label}${target.rendered_at?' · shown '+new Date(target.rendered_at).toISOString():''}`,source:'promotion_targets'});
  steps.push({step:'order',at:o.created_at,detail:`${a?.serving_label_snapshot??''} · quote ${String(a?.quote_id??'').slice(0,8)} · valid until ${new Date(o.quote_expires_at).toISOString()}`,source:'orders/order_quotes'});
  if(unit)steps.push({step:'units',at:unit.created_at,detail:`${unit.units} unit(s) ${unit.state}`,source:'paypal_campaign_units'});
  for(const k of checkouts)steps.push({step:'paypal_order',at:k.created_at,detail:`${k.paypal_order_id??'(creating)'} · ${k.status} · USD ${usd(k.amount_cents)}`,source:'paypal_checkouts'});
  for(const c of captures)steps.push({step:'capture',at:c.first_seen_at,detail:`${c.capture_id} · ${c.status} · gross ${usd(c.gross_cents)} fee ${usd(c.fee_cents)} net ${usd(c.net_cents)} · via ${c.verified_via}`,source:'PayPal (server-verified)'});
  for(const w of webhooks)steps.push({step:'webhook',at:w.received_at,detail:`${w.event_type} · delivered ${w.deliveries}× · ${w.processed_at?'applied once':'pending'}`,source:'paypal_webhook_inbox'});
  for(const c of captures)if(c.settlement)steps.push({step:'settled',at:c.settled_at,detail:`${c.settlement}${c.recovery_reason?' ('+c.recovery_reason+')':''} · order ${o.status}`,source:'paypal_settlements'});
  for(const e of events)steps.push({step:'screen',at:e.created_at,detail:`${e.type} v${e.order_version}${e.delivery?` · ${e.delivery}`:''}${e.rendered_at?' · rendered '+new Date(e.rendered_at).toISOString():''}`,source:'outbox_events'});
  return {orderId,status:o.status,environment:'PayPal Sandbox',steps};
 });
}

/** Merchant PayPal ledger (newest first). */
async function ledger(merchant:string){
 return tenant(merchant,async db=>({environment:'PayPal Sandbox',rows:(await db.query(`SELECT k.order_id AS "orderId",k.paypal_order_id AS "paypalOrderId",k.status,k.amount_cents::text AS amount,k.created_at AS "createdAt",k.last_issue AS issue,
  c.capture_id AS "captureId",c.status AS "captureStatus",c.gross_cents::text AS gross,c.fee_cents::text AS fee,c.net_cents::text AS net,c.verified_via AS "verifiedVia",s.state AS settlement,s.recovery_reason AS "recoveryReason"
  FROM paypal_checkouts k LEFT JOIN paypal_captures c ON c.merchant_id=k.merchant_id AND c.checkout_id=k.id LEFT JOIN paypal_settlements s ON s.merchant_id=c.merchant_id AND s.capture_id=c.capture_id
  WHERE k.merchant_id=$1 ORDER BY k.created_at DESC LIMIT 100`,[merchant])).rows.map(r=>({...r,amount:usd(r.amount),gross:usd(r.gross),fee:usd(r.fee),net:usd(r.net)}))}));
}

export async function paypalMerchantRequest(merchant:string,actor:string,role:string,url:URL,method:string,input:unknown):Promise<unknown>{
 const p=url.pathname;let m;
 try{
  if(p==='/api/paypal/copilot/runs'&&method==='POST'){
   changeRole(role);const d=z.object({intent:z.string().min(3).max(600),language:z.enum(['th','en']).default('th')}).strict().parse(input);
   const r=await runCopilot({merchant,actor,role,intent:d.intent,language:d.language},model);
   return {...r,trace:await runView(merchant,r.runId),envelope:r.envelopeId?await envelopeView(merchant,r.envelopeId):null};
  }
  if(p==='/api/paypal/copilot/rules'&&method==='POST')return rules(merchant,actor,role,input);
  if(p==='/api/paypal/copilot/runs'&&method==='GET')return tenant(merchant,async db=>({runs:(await db.query('SELECT id,intent,kind,state,model,envelope_id AS "envelopeId",started_at AS "startedAt" FROM paypal_agent_runs WHERE merchant_id=$1 ORDER BY started_at DESC LIMIT 10',[merchant])).rows}));
  // Recent campaigns, so a draft or a live offer can be reopened (and stopped) after a reload.
  if(p==='/api/paypal/copilot/envelopes'&&method==='GET')return tenant(merchant,async db=>({envelopes:(await db.query(`SELECT e.id,e.state,e.max_units AS "maxUnits",e.discount_percent AS "discountPercent",e.ends_at AS "endsAt",e.created_at AS "createdAt",p.name AS "productNameTh",p.name_en AS "productName"
   FROM paypal_campaign_envelopes e LEFT JOIN products p ON p.merchant_id=e.merchant_id AND p.id=e.product_id WHERE e.merchant_id=$1 ORDER BY e.created_at DESC LIMIT 10`,[merchant])).rows}));
  if((m=p.match(/^\/api\/paypal\/copilot\/runs\/([0-9a-f-]{36})$/))&&method==='GET')return runView(merchant,uuid.parse(m[1]));
  if((m=p.match(/^\/api\/paypal\/copilot\/envelopes\/([0-9a-f-]{36})(?:\/(approve|publish|stop))?$/))){
   const id=uuid.parse(m[1]);
   if(!m[2]&&method==='GET')return envelopeView(merchant,id);
   if(m[2]==='approve'&&method==='POST')return approve(merchant,actor,role,id,input);
   if(m[2]==='publish'&&method==='POST')return publish(merchant,actor,role,id,input);
   if(m[2]==='stop'&&method==='POST')return stop(merchant,actor,role,id);
  }
  if(p==='/api/paypal/screens'&&method==='GET')return tenant(merchant,async db=>({screens:await promotionDevices(db,merchant)}));
  if((m=p.match(/^\/api\/paypal\/envelopes\/([0-9a-f-]{36})\/outcome$/))&&method==='GET')return envelopeOutcome(merchant,uuid.parse(m[1]));
  if((m=p.match(/^\/api\/paypal\/orders\/([0-9a-f-]{36})\/evidence$/))&&method==='GET')return orderEvidence(merchant,uuid.parse(m[1]));
  if(p==='/api/paypal/ledger'&&method==='GET')return ledger(merchant);
  if(p==='/api/paypal/copilot/intent-preview'&&method==='POST'){const d=z.object({intent:z.string().min(1).max(600)}).strict().parse(input);return parseIntent(d.intent);}
 }catch(e){
  if(e instanceof AgentFailure)throw new RequestError(e.code==='ROLE_REQUIRED'?403:e.code==='DAILY_LIMIT'||e.code==='AI_FREE_LIMIT'?429:e.code==='INVALID_INTENT'?422:503,e.code as never,e.code);
  throw e;
 }
 return refuse(404,'RESOURCE_NOT_FOUND');
}
