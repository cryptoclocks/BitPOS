// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Café Copilot tools. The model may only read, validate and save a DRAFT; it cannot publish, choose screens, charge or
// refund. Every price is computed here with the existing promotionPrice(); the model only proposes numbers.
import type pg from 'pg';
import {z} from 'zod';
import {effectiveCatalog} from '../catalog';
import {routingLock} from '../authority';
import {promotionsRequest,promotionDevices} from '../promotions';
import {promotionPrice} from '../../../../packages/domain/src/promotions';

export const LIMITS={maxDiscountPercent:20,maxUnitsPerCampaign:50,maxUnitsPerOrder:4,maxDurationHours:24,minLeadMinutes:10,minUnitMinor:100n};

/** Limits the owner wrote in the intent are a second ceiling on top of the shop's limits (the model may not exceed either). */
export interface IntentCaps {discountPercent:number|null;units:number|null;endsAt:string|null}
export function parseIntent(intent:string,now=new Date(),timezone='Asia/Bangkok'):IntentCaps{
 const pct=intent.match(/(?:ไม่เกิน|สูงสุด|max(?:imum)?|up to|at most|no more than)\s*(\d{1,2})\s*%/i)??intent.match(/(\d{1,2})\s*%\s*(?:max|สูงสุด)/i);
 const units=intent.match(/(\d{1,3})\s*(?:ชิ้น|อัน|แก้ว|pcs|pieces|units|items|left)/i)??intent.match(/(\d{1,3})\s+[A-Za-z-]+\s+(?:left|remaining)\b/i);
 const time=intent.match(/(?:ก่อน|ภายใน|before|by|until)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|น\.?)?/i);
 let endsAt:string|null=null;
 if(time){
  let h=Number(time[1]);const m=Number(time[2]??0),ap=time[3]?.toLowerCase();
  if(ap==='pm'&&h<12)h+=12;if(ap==='am'&&h===12)h=0;
  if(h<=23&&m<=59){
   // Wall-clock time in the shop's timezone today (Asia/Bangkok has no DST: +07:00).
   const local=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
   const at=new Date(`${local}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+07:00`);
   if(at.getTime()>now.getTime())endsAt=at.toISOString();
  }
 }
 return {discountPercent:pct?Number(pct[1]):null,units:units?Number(units[1]):null,endsAt};
}

export const toolSchemas={
 read_catalog_stock:z.object({query:z.string().max(60).optional()}).strict(),
 read_recent_sales:z.object({productId:z.string().uuid(),hours:z.number().int().min(1).max(72)}).strict(),
 read_merchant_limits:z.object({}).strict(),
 validate_campaign:z.object({productId:z.string().uuid(),maxUnits:z.number().int(),maxUnitsPerOrder:z.number().int().optional(),discountPercent:z.number().int(),endsAt:z.string().max(40)}).strict(),
 save_campaign_draft:z.object({productId:z.string().uuid(),maxUnits:z.number().int(),maxUnitsPerOrder:z.number().int().optional(),discountPercent:z.number().int(),endsAt:z.string().max(40),rationale:z.string().min(1).max(600)}).strict()
};
export type ToolName=keyof typeof toolSchemas;

/** Function declarations sent to Gemini (OpenAPI subset). Kept in step with toolSchemas. */
export const functionDeclarations=[
 {name:'read_catalog_stock',description:'List sellable products with server prices (USD) and available stock. Optional name filter.',parameters:{type:'OBJECT',properties:{query:{type:'STRING',description:'Optional product name filter (Thai or English)'}}}},
 {name:'read_recent_sales',description:'Units of one product paid in the last N hours (aggregate only).',parameters:{type:'OBJECT',properties:{productId:{type:'STRING'},hours:{type:'INTEGER'}},required:['productId','hours']}},
 {name:'read_merchant_limits',description:'Shop limits: max discount, max units, max duration, current local time, closing information and screens.',parameters:{type:'OBJECT',properties:{}}},
 {name:'validate_campaign',description:'Check a proposed offer against stock, the owner limits and the shop limits. Returns violations and the server-computed price.',parameters:{type:'OBJECT',properties:{productId:{type:'STRING'},maxUnits:{type:'INTEGER'},maxUnitsPerOrder:{type:'INTEGER'},discountPercent:{type:'INTEGER'},endsAt:{type:'STRING',description:'ISO 8601 end time'}},required:['productId','maxUnits','discountPercent','endsAt']}},
 {name:'save_campaign_draft',description:'Save the validated offer as a DRAFT for the owner to review. It is not published and not shown to customers.',parameters:{type:'OBJECT',properties:{productId:{type:'STRING'},maxUnits:{type:'INTEGER'},maxUnitsPerOrder:{type:'INTEGER'},discountPercent:{type:'INTEGER'},endsAt:{type:'STRING'},rationale:{type:'STRING',description:'Two sentences citing tool results'}},required:['productId','maxUnits','discountPercent','endsAt','rationale']}}
];

export interface ToolContext {merchant:string;actor:string;role:string;runId:string;intent:string;language:'th'|'en';caps:IntentCaps;now:()=>Date;tenant:<T>(fn:(db:pg.PoolClient)=>Promise<T>)=>Promise<T>;}
const money=(m:{currency:string;decimals:number;amountMinor:string})=>({currency:m.currency,value:(Number(m.amountMinor)/10**m.decimals).toFixed(m.decimals>2?2:m.decimals)});

export interface Validation {ok:boolean;violations:string[];computed?:{productName:string;basePrice:ReturnType<typeof money>;offerPrice:ReturnType<typeof money>;savings:ReturnType<typeof money>;available:number;endsAtLocal:string};
 normalized?:{productId:string;maxUnits:number;maxUnitsPerOrder:number;discountPercent:number;endsAt:string}}

export async function validateCampaign(ctx:ToolContext,args:z.infer<typeof toolSchemas.validate_campaign>):Promise<Validation>{
 const v:string[]=[];const now=ctx.now();
 const menu=await ctx.tenant(db=>effectiveCatalog(db,ctx.merchant));
 const p=menu.products.find(x=>x.id===args.productId);
 if(!p||!p.basePrice||!p.unitPrice)return {ok:false,violations:['PRODUCT_UNKNOWN']};
 const perOrder=args.maxUnitsPerOrder??1;
 if(args.maxUnits<1||args.maxUnits>LIMITS.maxUnitsPerCampaign)v.push('UNITS_OUT_OF_RANGE');
 if(args.maxUnits>p.available)v.push('STOCK_SHORT');
 if(ctx.caps.units!==null&&args.maxUnits>ctx.caps.units)v.push('UNITS_OVER_OWNER_LIMIT');
 if(perOrder<1||perOrder>LIMITS.maxUnitsPerOrder||perOrder>args.maxUnits)v.push('PER_ORDER_OUT_OF_RANGE');
 if(args.discountPercent<1)v.push('DISCOUNT_TOO_SMALL');
 if(args.discountPercent>LIMITS.maxDiscountPercent||ctx.caps.discountPercent!==null&&args.discountPercent>ctx.caps.discountPercent)v.push('DISCOUNT_OVER_LIMIT');
 const end=Date.parse(args.endsAt);
 if(!Number.isFinite(end)||end<=now.getTime()+LIMITS.minLeadMinutes*60_000)v.push('END_IN_PAST');
 else if(end>now.getTime()+LIMITS.maxDurationHours*3600_000||ctx.caps.endsAt!==null&&end>Date.parse(ctx.caps.endsAt))v.push('END_TOO_LATE');
 let offer=null;
 try{offer=promotionPrice(p.basePrice,p.unitPrice,Math.max(1,Math.min(args.discountPercent,LIMITS.maxDiscountPercent)),LIMITS.maxDiscountPercent);}catch{v.push('PRICE_INVALID');}
 if(offer&&(offer.currency!=='USD'||BigInt(offer.amountMinor)<LIMITS.minUnitMinor*(offer.decimals===4?100n:1n)))v.push('PRICE_BELOW_FLOOR');
 if(offer&&offer.decimals===4&&BigInt(offer.amountMinor)%100n!==0n)v.push('PRICE_NOT_EXACT_CENTS');
 const active=await ctx.tenant(db=>db.query("SELECT 1 FROM paypal_campaign_envelopes WHERE merchant_id=$1 AND product_id=$2 AND state='APPROVED' AND ends_at>clock_timestamp()",[ctx.merchant,args.productId]));
 if(active.rowCount)v.push('ACTIVE_CAMPAIGN_EXISTS');
 const computed=offer?{productName:ctx.language==='th'?p.name:p.nameEn,basePrice:money(p.basePrice),offerPrice:money(offer),savings:money({...offer,amountMinor:(BigInt(p.basePrice.amountMinor)-BigInt(offer.amountMinor)).toString()}),available:p.available,
  endsAtLocal:Number.isFinite(end)?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'}).format(new Date(end)):''}:undefined;
 return {ok:v.length===0,violations:v,computed,normalized:{productId:args.productId,maxUnits:args.maxUnits,maxUnitsPerOrder:perOrder,discountPercent:args.discountPercent,endsAt:Number.isFinite(end)?new Date(end).toISOString():args.endsAt}};
}

/** Saves the DRAFT through the existing generate pipeline (which writes copy, renders the image and validates again). */
export async function saveCampaignDraft(ctx:ToolContext,args:z.infer<typeof toolSchemas.save_campaign_draft>){
 const check=await validateCampaign(ctx,args);
 if(!check.ok)return {saved:false,violations:check.violations};
 const n=check.normalized!;
 return ctx.tenant(async db=>{
  await routingLock(db,ctx.merchant);
  const name=check.computed!.productName;
  const goal=(`Café Copilot (owner-approved limits): sell up to ${n.maxUnits} × ${name} at ${n.discountPercent}% off until ${check.computed!.endsAtLocal} Bangkok time. Owner intent: ${ctx.intent}`).slice(0,500);
  const generated=await promotionsRequest(db,ctx.merchant,ctx.actor,ctx.role,'/api/promotions/generate','POST',{productIds:[n.productId],goal,requestedDiscountPercent:n.discountPercent,maxDiscountPercent:n.discountPercent,
   startsAt:ctx.now().toISOString(),expiresAt:n.endsAt,idempotencyKey:'copilot-'+ctx.runId,audience:'daily',daily:{},minimumUnitMinor:'1',language:ctx.language}) as {job:{id:string;state:string}};
  // A repeated save in the same run replays the same generate request; keep its one envelope.
  const existing=(await db.query<{id:string}>('SELECT id FROM paypal_campaign_envelopes WHERE merchant_id=$1 AND job_id=$2',[ctx.merchant,generated.job.id])).rows[0];
  if(existing)return {saved:true,envelopeId:existing.id,jobId:generated.job.id,jobState:generated.job.state,computed:check.computed,note:'Draft already saved for this run.'};
  const env=(await db.query<{id:string}>(`INSERT INTO paypal_campaign_envelopes(merchant_id,job_id,agent_run_id,product_id,max_units,max_units_per_order,discount_percent,max_discount_percent,starts_at,ends_at,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10) RETURNING id`,[ctx.merchant,generated.job.id,ctx.runId,n.productId,n.maxUnits,n.maxUnitsPerOrder,n.discountPercent,ctx.now().toISOString(),n.endsAt,ctx.actor])).rows[0];
  return {saved:true,envelopeId:env.id,jobId:generated.job.id,jobState:generated.job.state,computed:check.computed,note:'Draft only. The owner reviews, approves and chooses the screen.'};
 });
}

export async function runTool(ctx:ToolContext,name:string,rawArgs:unknown):Promise<{result:unknown;violations?:string[]}>{
 if(!(name in toolSchemas))return {result:{error:'UNKNOWN_TOOL',allowed:Object.keys(toolSchemas)},violations:['UNKNOWN_TOOL']};
 const parsed=toolSchemas[name as ToolName].safeParse(rawArgs??{});
 if(!parsed.success)return {result:{error:'INVALID_ARGS',detail:parsed.error.issues.slice(0,3).map(i=>i.path.join('.')+': '+i.message)},violations:['INVALID_ARGS']};
 const a=parsed.data as never;
 switch(name as ToolName){
  case 'read_catalog_stock':{
   const q=(a as {query?:string}).query?.toLowerCase();const menu=await ctx.tenant(db=>effectiveCatalog(db,ctx.merchant));
   return {result:{products:menu.products.filter(p=>p.basePrice&&p.unitPrice&&(!q||p.name.toLowerCase().includes(q)||p.nameEn.toLowerCase().includes(q))).slice(0,30)
    .map(p=>({productId:p.id,nameTh:p.name,nameEn:p.nameEn,price:money(p.unitPrice!),available:p.available}))}};
  }
  case 'read_recent_sales':{
   const {productId,hours}=a as {productId:string;hours:number};
   const r=(await ctx.tenant(db=>db.query(`SELECT coalesce(sum(i.qty),0)::int AS units,count(DISTINCT o.id)::int AS orders,max(o.paid_at) AS last FROM orders o JOIN order_items i ON i.merchant_id=o.merchant_id AND i.order_id=o.id
    WHERE o.merchant_id=$1 AND i.product_id=$2 AND o.status='PAID' AND o.paid_at>clock_timestamp()-($3||' hours')::interval`,[ctx.merchant,productId,String(hours)]))).rows[0];
   return {result:{productId,windowHours:hours,unitsPaid:r.units,ordersPaid:r.orders,lastPaidAt:r.last}};
  }
  case 'read_merchant_limits':{
   const screens=await ctx.tenant(db=>promotionDevices(db,ctx.merchant));
   return {result:{maxDiscountPercent:LIMITS.maxDiscountPercent,maxUnitsPerCampaign:LIMITS.maxUnitsPerCampaign,maxUnitsPerOrder:LIMITS.maxUnitsPerOrder,maxDurationHours:LIMITS.maxDurationHours,
    ownerLimits:ctx.caps,nowLocal:new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'}).format(ctx.now()),nowIso:ctx.now().toISOString(),timezone:'Asia/Bangkok (+07:00)',
    screens:screens.map(s=>({label:s.label,online:s.online,busy:s.busy})),note:'The owner chooses the screen after approval.'}};
  }
  case 'validate_campaign':{const r=await validateCampaign(ctx,a);return {result:{ok:r.ok,violations:r.violations,computed:r.computed},violations:r.violations};}
  case 'save_campaign_draft':{const r=await saveCampaignDraft(ctx,a);return {result:r,violations:'violations' in r?r.violations:undefined};}
 }
}
