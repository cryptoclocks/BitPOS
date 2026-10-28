// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Promotion drafts, owner approval and "Allow All". Muse Spark drafts one product offer, choosing the
// product, percent and duration from server-built lists (it writes no prices or numbers). The owner approves
// the first draft; "approve + Allow All" stores a bounded policy (same product or category, percent and
// duration no higher than approved, a daily cap). Later drafts inside a policy are applied automatically and
// listed for the owner, who can stop any offer or revoke the policy immediately.
// Applying always goes through the inherited product-offer command (price version, revision and audit
// checks included), exactly as if the owner pressed the button in the POS. No model call runs in a transaction.
import type pg from 'pg';
import {z} from 'zod';
import type {MetaRouter} from '../../../../packages/meta-ai/src/router';
import {MetaRouterError} from '../../../../packages/meta-ai/src/types';
import {discountedMinor} from '../../../../packages/domain/src/pricing';
import type {MetaDb,OfferDeps} from './identity';
import type {StaffView} from './staff';

export const PERCENTS=[5,10,15,20,25,30] as const;
export const DURATIONS=[2,4,8,24] as const;
const NO_DIGITS=/[0-9๐-๙]/,FORBIDDEN=/https?:|www\.|[฿$%€£]/i;
const DEFAULT_REASON=['โปรแนะนำของร้านวันนี้','Today’s pick from the shop'];

export interface OfferState {priceVersion:string;revision:string;baseMinor:string;active:boolean}
/** The inherited product-offer command, behind an interface so tests can see every write. */
export interface OfferWriter {
 current(db:pg.PoolClient,merchantId:string,productId:string):Promise<OfferState>;
 enable(db:pg.PoolClient,merchantId:string,actor:string,productId:string,o:{priceVersion:string;expectedRevision:string;basePriceMinor:string;currentPriceMinor:string;expiresAt:string;percent:number}):Promise<string>;
 disable(db:pg.PoolClient,merchantId:string,actor:string,productId:string,o:{priceVersion:string;expectedRevision:string}):Promise<void>;
}
/** Default writer: `productOffer()` from apps/api/src/offers.ts, loaded lazily (it reads the API config). */
export const inheritedOfferWriter:OfferWriter={
 async current(db,merchantId,productId){
  const {productOffer}=await import('../offers');
  const r=await productOffer(db,merchantId,'00000000-0000-0000-0000-000000000000','owner',productId,'GET',undefined);
  return {priceVersion:r.priceVersion,revision:String(r.offer?.revision??'0'),baseMinor:r.effective.basePrice.amountMinor,active:r.active};
 },
 async enable(db,merchantId,actor,productId,o){
  const {productOffer}=await import('../offers');
  const r=await productOffer(db,merchantId,actor,'owner',productId,'PUT',{priceVersion:o.priceVersion,expectedRevision:o.expectedRevision,enabled:true,basePriceMinor:o.basePriceMinor,currentPriceMinor:o.currentPriceMinor,expiresAt:o.expiresAt,discount:{kind:'percent',percent:o.percent}});
  return String(r.offer!.revision);
 },
 async disable(db,merchantId,actor,productId,o){
  const {productOffer}=await import('../offers');
  await productOffer(db,merchantId,actor,'owner',productId,'PATCH',{priceVersion:o.priceVersion,expectedRevision:o.expectedRevision,enabled:false});
 },
};

export interface OfferPolicyDeps {db:MetaDb;menu:OfferDeps['menu'];router:MetaRouter|null;writer?:OfferWriter}
export class OfferPolicyError extends Error {constructor(readonly code:'ROLE_REQUIRED'|'OWNER_REQUIRED'|'NOT_FOUND'|'NOT_OPEN'|'NO_CANDIDATES'|'INVALID_INPUT'){super(code);}}
export interface DraftView {id:string;productId:string;name:string;nameEn:string;emoji:string;category:string|null;discountPercent:number;durationHours:number;reasonTh:string;reasonEn:string;
 chosenBy:'model'|'fallback';state:string;approvalKind:'owner'|'policy'|null;policyId:string|null;offerExpiresAt:string|null;failure:string|null;createdAt:string;expiresAt:string}
export interface PolicyView {id:string;scopeKind:'product'|'category';productId:string|null;category:string|null;label:string;maxDiscountPercent:number;maxDurationHours:number;dailyLimit:number;usedToday:number;createdAt:string}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const canApprove=(me:StaffView)=>me.role==='owner'||me.role==='manager';

interface Candidate {productId:string;name:string;nameEn:string;category:string|null;available:number}
async function candidates(deps:OfferPolicyDeps,merchantId:string):Promise<Candidate[]>{
 return deps.db.tenant(merchantId,async db=>{
  const menu=await deps.menu(db,merchantId);
  const open=new Set((await db.query<{product_id:string}>("SELECT product_id FROM meta_offer_drafts WHERE state='DRAFT' AND expires_at>clock_timestamp()")).rows.map(r=>r.product_id));
  return menu.products.filter(p=>p.unitPrice&&p.basePrice&&p.available>0&&!p.promotion&&!p.dailyPromotion&&!open.has(p.id)&&p.basePrice.amountMinor===p.unitPrice.amountMinor)
   .map(p=>({productId:p.id,name:p.name,nameEn:p.nameEn,category:typeof p.category==='string'?p.category:null,available:p.available}))
   .sort((a,b)=>b.available-a.available||a.productId.localeCompare(b.productId)).slice(0,20);
 });
}

type Choice={productId:string;discountPercent:number;durationHours:number;reasonTh:string;reasonEn:string;chosenBy:'model'|'fallback';invocationId:string|null};
/** No-cost fallback: the product with the most stock, a modest discount, a short window. */
const fallback=(c:Candidate[]):Choice=>({productId:c[0].productId,discountPercent:10,durationHours:4,reasonTh:DEFAULT_REASON[0],reasonEn:DEFAULT_REASON[1],chosenBy:'fallback',invocationId:null});

const SYSTEM=`You draft one promotion for a small cafe's owner to review.
Choose one productId, one discountPercent and one durationHours, only from the provided lists.
Prefer items with more stock. Keep discounts modest unless stock is high.
Write one short reason for the owner in Thai (reasonTh) and English (reasonEn), each under 120 characters.
Never write numbers, prices, percentages, currency symbols or links in the reasons; the shop shows them itself.`;

export async function chooseDraft(router:MetaRouter|null,merchantId:string,c:Candidate[],deadlineMs=8000):Promise<Choice>{
 if(!router)return fallback(c);
 const ids=c.map(x=>x.productId) as [string,...string[]];
 const schema=z.object({productId:z.enum(ids),discountPercent:z.union(PERCENTS.map(p=>z.literal(p)) as any),durationHours:z.union(DURATIONS.map(d=>z.literal(d)) as any),reasonTh:z.string().trim().min(1).max(200),reasonEn:z.string().trim().min(1).max(200)}).strict();
 const jsonSchema={type:'object',additionalProperties:false,required:['productId','discountPercent','durationHours','reasonTh','reasonEn'],properties:{productId:{type:'string',enum:ids},discountPercent:{type:'integer',enum:[...PERCENTS]},durationHours:{type:'integer',enum:[...DURATIONS]},reasonTh:{type:'string',maxLength:200},reasonEn:{type:'string',maxLength:200}}};
 try{
  const r=await router.invoke({task:'promotion_copy',merchantId,messages:[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify({products:c.map(x=>({productId:x.productId,item:x.nameEn,itemTh:x.name,category:x.category,stockLevel:x.available>=50?'high':x.available>=10?'medium':'low'}))})}],
   output:{name:'offer_draft',schema,jsonSchema},maxOutputTokens:2000,reasoningEffort:'minimal',deadlineMs});
  const v=r.value as {productId:string;discountPercent:number;durationHours:number;reasonTh:string;reasonEn:string};
  const safe=!NO_DIGITS.test(v.reasonTh+v.reasonEn)&&!FORBIDDEN.test(v.reasonTh+v.reasonEn);
  return {productId:v.productId,discountPercent:v.discountPercent,durationHours:v.durationHours,reasonTh:safe?v.reasonTh:DEFAULT_REASON[0],reasonEn:safe?v.reasonEn:DEFAULT_REASON[1],chosenBy:'model',invocationId:r.invocation.id};
 }catch(e){if(e instanceof MetaRouterError)return fallback(c);throw e;}
}

type DraftRow={id:string;product_id:string;category:string|null;discount_percent:number;duration_hours:number;reason_th:string;reason_en:string;chosen_by:'model'|'fallback';state:string;approval_kind:'owner'|'policy'|null;policy_id:string|null;offer_expires_at:Date|null;failure:string|null;created_at:Date;expires_at:Date;name:string;name_en:string;emoji:string};
const DRAFT_SQL=`SELECT d.id,d.product_id,d.category,d.discount_percent,d.duration_hours,d.reason_th,d.reason_en,d.chosen_by,CASE WHEN d.state='DRAFT' AND d.expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE d.state END AS state,
 d.approval_kind,d.policy_id,d.offer_expires_at,d.failure,d.created_at,d.expires_at,coalesce(p.name,'') AS name,coalesce(p.name_en,'') AS name_en,coalesce(p.emoji,'') AS emoji
 FROM meta_offer_drafts d LEFT JOIN products p ON p.merchant_id=d.merchant_id AND p.id=d.product_id`;
const draftView=(r:DraftRow):DraftView=>({id:r.id,productId:r.product_id,name:r.name,nameEn:r.name_en,emoji:r.emoji,category:r.category,discountPercent:r.discount_percent,durationHours:r.duration_hours,
 reasonTh:r.reason_th,reasonEn:r.reason_en,chosenBy:r.chosen_by,state:r.state,approvalKind:r.approval_kind,policyId:r.policy_id,offerExpiresAt:r.offer_expires_at?.toISOString()??null,failure:r.failure,createdAt:r.created_at.toISOString(),expiresAt:r.expires_at.toISOString()});

/** Writes the offer through the inherited command inside the caller's transaction; marks the draft. */
async function apply(deps:OfferPolicyDeps,db:pg.PoolClient,merchantId:string,draft:{id:string;product_id:string;discount_percent:number;duration_hours:number},actor:string,kind:'owner'|'policy',policyId:string|null):Promise<'APPLIED'|'FAILED'>{
 const writer=deps.writer??inheritedOfferWriter;
 const cur=await writer.current(db,merchantId,draft.product_id);
 const fail=async(code:string)=>{await db.query("UPDATE meta_offer_drafts SET state='FAILED',failure=$2,decided_by=$3,decided_at=clock_timestamp() WHERE id=$1",[draft.id,code,actor]);return 'FAILED' as const;};
 if(cur.active)return fail('ALREADY_ON_OFFER');
 const base=BigInt(cur.baseMinor),current=discountedMinor(base,{kind:'percent',percent:draft.discount_percent});
 if(current<=0n||current>=base)return fail('NO_VALID_PRICE');
 const now=new Date((await db.query<{t:Date}>('SELECT clock_timestamp() AS t')).rows[0].t);
 const expiresAt=new Date(now.getTime()+draft.duration_hours*3_600_000).toISOString();
 const revision=await writer.enable(db,merchantId,actor,draft.product_id,{priceVersion:cur.priceVersion,expectedRevision:cur.revision,basePriceMinor:cur.baseMinor,currentPriceMinor:current.toString(),expiresAt,percent:draft.discount_percent});
 await db.query("UPDATE meta_offer_drafts SET state='APPLIED',approval_kind=$2,policy_id=$3,decided_by=$4,decided_at=clock_timestamp(),price_version_id=$5,offer_revision=$6,offer_expires_at=$7 WHERE id=$1",
  [draft.id,kind,policyId,actor,cur.priceVersion,revision,expiresAt]);
 return 'APPLIED';
}

/** Inside a policy's bounds and under its daily cap: apply now and leave it for the owner to see. */
async function autoApprove(deps:OfferPolicyDeps,merchantId:string,draftId:string):Promise<boolean>{
 return deps.db.tenant(merchantId,async db=>{
  const d=(await db.query<{id:string;product_id:string;category:string|null;discount_percent:number;duration_hours:number;state:string}>("SELECT id,product_id,category,discount_percent,duration_hours,state FROM meta_offer_drafts WHERE id=$1 FOR UPDATE",[draftId])).rows[0];
  if(!d||d.state!=='DRAFT')return false;
  const p=(await db.query<{id:string;created_by:string;daily_limit:number}>(
   `SELECT id,created_by,daily_limit FROM meta_allow_all_policies WHERE revoked_at IS NULL AND max_discount_percent>=$3 AND max_duration_hours>=$4
     AND ((scope_kind='product' AND product_id=$1) OR (scope_kind='category' AND category=$2)) ORDER BY scope_kind='product' DESC,created_at LIMIT 1 FOR UPDATE`,[d.product_id,d.category,d.discount_percent,d.duration_hours])).rows[0];
  if(!p)return false;
  const used=Number((await db.query<{n:string}>("SELECT count(*)::text AS n FROM meta_offer_drafts WHERE policy_id=$1 AND approval_kind='policy' AND decided_at>clock_timestamp()-interval '24 hours'",[p.id])).rows[0].n);
  if(used>=p.daily_limit)return false;
  // The policy's owner is the actor of record; the draft row says it was approved by policy.
  return (await apply(deps,db,merchantId,d,p.created_by,'policy',p.id))==='APPLIED';
 });
}

/** One draft by Muse Spark (or the free fallback); applied at once when an Allow All policy covers it. */
export async function draftOffer(deps:OfferPolicyDeps,me:StaffView):Promise<{draft:DraftView;autoApplied:boolean}>{
 if(!canApprove(me))throw new OfferPolicyError('ROLE_REQUIRED');
 const c=await candidates(deps,me.merchantId);
 if(!c.length)throw new OfferPolicyError('NO_CANDIDATES');
 const choice=await chooseDraft(deps.router,me.merchantId,c);
 const cand=c.find(x=>x.productId===choice.productId)!;
 const id=await deps.db.tenant(me.merchantId,async db=>(await db.query<{id:string}>(
  `WITH n AS (SELECT clock_timestamp() AS t) INSERT INTO meta_offer_drafts(merchant_id,product_id,category,discount_percent,duration_hours,reason_th,reason_en,chosen_by,invocation_id,created_at,expires_at)
   SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,t,t+interval '30 minutes' FROM n ON CONFLICT (merchant_id,product_id) WHERE state='DRAFT' DO NOTHING RETURNING id`,
  [me.merchantId,choice.productId,cand.category,choice.discountPercent,choice.durationHours,choice.reasonTh,choice.reasonEn,choice.chosenBy,choice.invocationId])).rows[0]?.id);
 if(!id)throw new OfferPolicyError('NOT_OPEN');
 const autoApplied=await autoApprove(deps,me.merchantId,id);
 return {draft:(await getDraft(deps,me.merchantId,id))!,autoApplied};
}

async function getDraft(deps:OfferPolicyDeps,merchantId:string,id:string):Promise<DraftView|null>{
 const r=await deps.db.tenant(merchantId,db=>db.query<DraftRow>(`${DRAFT_SQL} WHERE d.id=$1`,[id]));
 return r.rows[0]?draftView(r.rows[0]):null;
}

/** Owner or manager approves once; only the owner can turn it into an Allow All policy. */
export async function approveDraft(deps:OfferPolicyDeps,me:StaffView,draftId:string,allowAll?:{scope:'product'|'category';dailyLimit:number}):Promise<DraftView>{
 if(!canApprove(me))throw new OfferPolicyError('ROLE_REQUIRED');
 if(allowAll&&me.role!=='owner')throw new OfferPolicyError('OWNER_REQUIRED');
 if(!UUID.test(draftId)||allowAll&&(!['product','category'].includes(allowAll.scope)||!Number.isInteger(allowAll.dailyLimit)||allowAll.dailyLimit<1||allowAll.dailyLimit>10))throw new OfferPolicyError('INVALID_INPUT');
 await deps.db.tenant(me.merchantId,async db=>{
  const d=(await db.query<{id:string;product_id:string;category:string|null;discount_percent:number;duration_hours:number;state:string;live:boolean}>("SELECT id,product_id,category,discount_percent,duration_hours,state,expires_at>clock_timestamp() AS live FROM meta_offer_drafts WHERE id=$1 FOR UPDATE",[draftId])).rows[0];
  if(!d)throw new OfferPolicyError('NOT_FOUND');
  if(d.state!=='DRAFT'||!d.live)throw new OfferPolicyError('NOT_OPEN');
  if(allowAll?.scope==='category'&&!d.category)throw new OfferPolicyError('INVALID_INPUT');
  if((await apply(deps,db,me.merchantId,d,me.userId,'owner',null))!=='APPLIED'||!allowAll)return;
  // A newer Allow All for the same scope replaces the old one.
  await db.query("UPDATE meta_allow_all_policies SET revoked_at=clock_timestamp(),revoked_by=$3 WHERE revoked_at IS NULL AND scope_kind=$1 AND coalesce(product_id::text,category)=$2",
   [allowAll.scope,allowAll.scope==='product'?d.product_id:d.category,me.userId]);
  await db.query('INSERT INTO meta_allow_all_policies(merchant_id,scope_kind,product_id,category,max_discount_percent,max_duration_hours,daily_limit,created_from_draft,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
   [me.merchantId,allowAll.scope,allowAll.scope==='product'?d.product_id:null,allowAll.scope==='category'?d.category:null,d.discount_percent,d.duration_hours,allowAll.dailyLimit,d.id,me.userId]);
 });
 return (await getDraft(deps,me.merchantId,draftId))!;
}

export async function rejectDraft(deps:OfferPolicyDeps,me:StaffView,draftId:string):Promise<void>{
 if(!canApprove(me))throw new OfferPolicyError('ROLE_REQUIRED');
 if(!UUID.test(draftId))throw new OfferPolicyError('INVALID_INPUT');
 const n=await deps.db.tenant(me.merchantId,db=>db.query("UPDATE meta_offer_drafts SET state='REJECTED',decided_by=$2,decided_at=clock_timestamp() WHERE id=$1 AND state='DRAFT'",[draftId,me.userId]));
 if(!n.rowCount)throw new OfferPolicyError('NOT_OPEN');
}

/** Stops an applied offer now (owner or manager), through the same inherited command. */
export async function stopOffer(deps:OfferPolicyDeps,me:StaffView,draftId:string):Promise<void>{
 if(!canApprove(me))throw new OfferPolicyError('ROLE_REQUIRED');
 if(!UUID.test(draftId))throw new OfferPolicyError('INVALID_INPUT');
 const writer=deps.writer??inheritedOfferWriter;
 await deps.db.tenant(me.merchantId,async db=>{
  const d=(await db.query<{product_id:string;state:string;price_version_id:string|null;offer_revision:string|null}>('SELECT product_id,state,price_version_id,offer_revision FROM meta_offer_drafts WHERE id=$1 FOR UPDATE',[draftId])).rows[0];
  if(!d)throw new OfferPolicyError('NOT_FOUND');
  if(d.state!=='APPLIED')throw new OfferPolicyError('NOT_OPEN');
  const cur=await writer.current(db,me.merchantId,d.product_id);
  // Only switch off the offer this draft created: a later edit in the POS (new revision or price version) wins.
  if(cur.active&&cur.priceVersion===d.price_version_id&&cur.revision===d.offer_revision)await writer.disable(db,me.merchantId,me.userId,d.product_id,{priceVersion:cur.priceVersion,expectedRevision:cur.revision});
  await db.query("UPDATE meta_offer_drafts SET state='STOPPED' WHERE id=$1",[draftId]);
 });
}

export async function revokePolicy(deps:OfferPolicyDeps,me:StaffView,policyId:string):Promise<void>{
 if(me.role!=='owner')throw new OfferPolicyError('OWNER_REQUIRED');
 if(!UUID.test(policyId))throw new OfferPolicyError('INVALID_INPUT');
 const n=await deps.db.tenant(me.merchantId,db=>db.query('UPDATE meta_allow_all_policies SET revoked_at=clock_timestamp(),revoked_by=$2 WHERE id=$1 AND revoked_at IS NULL',[policyId,me.userId]));
 if(!n.rowCount)throw new OfferPolicyError('NOT_FOUND');
}

export async function listOffersOverview(deps:OfferPolicyDeps,me:StaffView):Promise<{drafts:DraftView[];policies:PolicyView[]}>{
 if(!canApprove(me))throw new OfferPolicyError('ROLE_REQUIRED');
 return deps.db.tenant(me.merchantId,async db=>{
  const drafts=(await db.query<DraftRow>(`${DRAFT_SQL} WHERE d.created_at>clock_timestamp()-interval '3 days' ORDER BY d.created_at DESC LIMIT 30`)).rows.map(draftView);
  const policies=(await db.query<{id:string;scope_kind:'product'|'category';product_id:string|null;category:string|null;max_discount_percent:number;max_duration_hours:number;daily_limit:number;created_at:Date;label:string;used:string}>(
   `SELECT a.id,a.scope_kind,a.product_id,a.category,a.max_discount_percent,a.max_duration_hours,a.daily_limit,a.created_at,coalesce(p.emoji||' '||p.name_en,a.category,'') AS label,
     (SELECT count(*)::text FROM meta_offer_drafts d WHERE d.policy_id=a.id AND d.approval_kind='policy' AND d.decided_at>clock_timestamp()-interval '24 hours') AS used
    FROM meta_allow_all_policies a LEFT JOIN products p ON p.merchant_id=a.merchant_id AND p.id=a.product_id WHERE a.revoked_at IS NULL ORDER BY a.created_at DESC`)).rows
   .map(r=>({id:r.id,scopeKind:r.scope_kind,productId:r.product_id,category:r.category,label:r.label,maxDiscountPercent:r.max_discount_percent,maxDurationHours:r.max_duration_hours,dailyLimit:r.daily_limit,usedToday:Number(r.used),createdAt:r.created_at.toISOString()}));
  return {drafts,policies};
 });
}
