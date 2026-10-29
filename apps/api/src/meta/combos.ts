// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Two-item offers (migration 322) and offer animations. Muse Spark drafts a pair that goes together with a reason; an
// owner or manager approves it (the cart applies the pair discount, cart.ts); on approval Muse Image generates a new
// picture of the two items (labelled AI-generated). Animations (anim.ts) are made once per offer and size and cached:
// single offers from the approved banner or the real menu photo, pairs from the generated picture.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import type {MetaRouter} from '../../../../packages/meta-ai/src/router';
import type {MetaDb} from './identity';
import {listMenu,type AgentDeps,type MenuItem} from './agent-orders';
import {generateImage,VisionError} from './vision';
import type {AsrConfig} from './voice';
import {offerGif} from './anim';

const MENU_IMAGES=new URL('../../../web/public/images/menu/',import.meta.url);
export class ComboError extends Error {constructor(readonly code:'NOT_FOUND'|'NOT_OPEN'|'TOO_FEW_ITEMS'){super(code);}}
export interface ComboView {id:string;a:{id:string;name:string;nameEn:string;emoji:string};b:{id:string;name:string;nameEn:string;emoji:string};discountPercent:number;durationHours:number;
 reasonTh:string;reasonEn:string;chosenBy:'model'|'fallback';state:'DRAFT'|'APPLIED'|'REJECTED'|'STOPPED';expiresAt:string|null;hasImage:boolean;live:boolean;createdAt:string}

const NO_DIGITS=/[0-9๐-๙%$฿]/;
export async function draftCombo(deps:AgentDeps,router:MetaRouter|null,merchantId:string,userId:string):Promise<string>{
 const items=(await listMenu(deps,merchantId)).filter(i=>i.payable);
 if(items.length<2)throw new ComboError('TOO_FEW_ITEMS');
 const fallback=()=>{const drink=items.find(i=>/coffee|tea/i.test(i.category??''))??items[0],food=items.find(i=>i.productId!==drink.productId&&/bakery|dessert/i.test(i.category??''))??items.find(i=>i.productId!==drink.productId)!;
  return {a:drink.productId,b:food.productId,pct:10,hours:6,th:'เครื่องดื่มกับขนมคู่กันพอดี',en:'A drink and a bite that go well together',by:'fallback' as 'model'|'fallback'};};
 let pick=fallback();
 if(router){try{
  const ids=items.map(i=>i.productId) as [string,...string[]];
  const schema=z.object({productA:z.enum(ids),productB:z.enum(ids),discountPercent:z.number().int().min(5).max(20),durationHours:z.number().int().min(2).max(12),reasonTh:z.string().trim().min(1).max(160),reasonEn:z.string().trim().min(1).max(160)}).strict();
  const r=await router.invoke({task:'promotion_copy',merchantId,messages:[{role:'system',content:'Suggest one two-item deal for a small cafe: two different items from the list that customers enjoy together (usually a drink and a bakery or dessert item), a discount on the pair (5-20%) and how many hours it should run (2-12). Give a short reason in Thai and English without numbers. Use only productIds from the list.'},
   {role:'user',content:JSON.stringify({items:items.map(i=>({productId:i.productId,item:i.nameEn,itemTh:i.name,category:i.category,available:i.available,onOffer:!!i.offer}))})}],
   output:{name:'combo_offer',schema,jsonSchema:{type:'object',additionalProperties:false,required:['productA','productB','discountPercent','durationHours','reasonTh','reasonEn'],properties:{productA:{type:'string',enum:ids},productB:{type:'string',enum:ids},discountPercent:{type:'integer',minimum:5,maximum:20},durationHours:{type:'integer',minimum:2,maximum:12},reasonTh:{type:'string',maxLength:160},reasonEn:{type:'string',maxLength:160}}}},
   maxOutputTokens:1200,reasoningEffort:'minimal',deadlineMs:15000});
  const v=r.value;
  if(v.productA!==v.productB)pick={a:v.productA,b:v.productB,pct:v.discountPercent,hours:v.durationHours,th:NO_DIGITS.test(v.reasonTh)?pick.th:v.reasonTh,en:NO_DIGITS.test(v.reasonEn)?pick.en:v.reasonEn,by:'model'};
 }catch{/* fallback pair */}}
 return (await deps.db.tenant(merchantId,c=>c.query<{id:string}>(`INSERT INTO meta_combo_offers(merchant_id,product_a,product_b,discount_percent,duration_hours,reason_th,reason_en,chosen_by,created_by)
  VALUES(current_setting('bitpos.merchant')::uuid,$1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[pick.a,pick.b,pick.pct,pick.hours,pick.th,pick.en,pick.by,userId]))).rows[0].id;
}

export async function decideCombo(db:MetaDb,merchantId:string,userId:string,id:string,action:'approve'|'reject'|'stop'):Promise<void>{
 const r=await db.tenant(merchantId,c=>action==='approve'?c.query("UPDATE meta_combo_offers SET state='APPLIED',expires_at=clock_timestamp()+make_interval(hours=>duration_hours),decided_by=$2,decided_at=clock_timestamp() WHERE id=$1 AND state='DRAFT'",[id,userId])
  :action==='reject'?c.query("UPDATE meta_combo_offers SET state='REJECTED',decided_by=$2,decided_at=clock_timestamp() WHERE id=$1 AND state='DRAFT'",[id,userId])
  :c.query("UPDATE meta_combo_offers SET state='STOPPED',decided_by=$2,decided_at=clock_timestamp() WHERE id=$1 AND state='APPLIED'",[id,userId]));
 if(!r.rowCount)throw new ComboError('NOT_OPEN');
}

/** Muse Image generates a new picture of the pair (after approval); kept on the offer. Failures leave it without one. */
export async function illustrateCombo(db:MetaDb,vision:AsrConfig,merchantId:string,id:string):Promise<boolean>{
 const c=(await db.tenant(merchantId,q=>q.query<{a:string;b:string}>('SELECT pa.name_en AS a,pb.name_en AS b FROM meta_combo_offers o JOIN products pa ON pa.merchant_id=o.merchant_id AND pa.id=o.product_a JOIN products pb ON pb.merchant_id=o.merchant_id AND pb.id=o.product_b WHERE o.id=$1',[id]))).rows[0];
 if(!c)return false;
 try{
  const img=await generateImage(vision,`A bright, appetizing square photo of one ${c.a.toLowerCase()} and one ${c.b.toLowerCase()} side by side on a light wooden cafe table, soft natural window light, shallow depth of field, cozy modern cafe. No text, no logos, no people, no hands.`);
  await db.tenant(merchantId,q=>q.query('UPDATE meta_combo_offers SET image=$2,image_mime=$3 WHERE id=$1',[id,img.bytes,img.mime]));
  return true;
 }catch(e){if(e instanceof VisionError)return false;throw e;}
}

export async function listCombos(db:MetaDb,merchantId:string,liveOnly=false):Promise<ComboView[]>{
 const rows=(await db.tenant(merchantId,c=>c.query<{id:string;a_id:string;a_name:string;a_en:string;a_emoji:string;b_id:string;b_name:string;b_en:string;b_emoji:string;discount_percent:number;duration_hours:number;reason_th:string;reason_en:string;chosen_by:'model'|'fallback';state:ComboView['state'];expires_at:Date|null;has_image:boolean;live:boolean;created_at:Date}>(
  `SELECT o.id,pa.id AS a_id,pa.name AS a_name,pa.name_en AS a_en,pa.emoji AS a_emoji,pb.id AS b_id,pb.name AS b_name,pb.name_en AS b_en,pb.emoji AS b_emoji,o.discount_percent,o.duration_hours,o.reason_th,o.reason_en,o.chosen_by,o.state,o.expires_at,
    o.image IS NOT NULL AS has_image,(o.state='APPLIED' AND o.expires_at>clock_timestamp()) AS live,o.created_at
   FROM meta_combo_offers o JOIN products pa ON pa.merchant_id=o.merchant_id AND pa.id=o.product_a JOIN products pb ON pb.merchant_id=o.merchant_id AND pb.id=o.product_b
   WHERE ${liveOnly?"o.state='APPLIED' AND o.expires_at>clock_timestamp()":"o.created_at>clock_timestamp()-interval '7 days'"} ORDER BY o.created_at DESC LIMIT 20`))).rows;
 return rows.map(r=>({id:r.id,a:{id:r.a_id,name:r.a_name,nameEn:r.a_en,emoji:r.a_emoji},b:{id:r.b_id,name:r.b_name,nameEn:r.b_en,emoji:r.b_emoji},discountPercent:r.discount_percent,durationHours:r.duration_hours,
  reasonTh:r.reason_th,reasonEn:r.reason_en,chosenBy:r.chosen_by,state:r.state,expiresAt:r.expires_at?.toISOString()??null,hasImage:r.has_image,live:r.live,createdAt:r.created_at.toISOString()}));
}
export async function comboImage(db:MetaDb,merchantId:string,id:string){return (await db.tenant(merchantId,c=>c.query<{image:Buffer|null;image_mime:string|null}>('SELECT image,image_mime FROM meta_combo_offers WHERE id=$1',[id]))).rows[0]??null;}

/** An animation and a short tag of what it shows; URLs carry the tag (…/480-<tag>.gif) so the CDN never serves an old one. */
export interface Anim {gif:Buffer;tag:string}
async function cached(db:MetaDb,merchantId:string,key:string,make:()=>Promise<Buffer|null>):Promise<Anim|null>{
 const tag=createHash('sha256').update(key).digest('hex').slice(0,8);
 const hit=(await db.tenant(merchantId,c=>c.query<{gif:Buffer}>('SELECT gif FROM meta_offer_animations WHERE cache_key=$1',[key]))).rows[0];
 if(hit)return {gif:hit.gif,tag};
 const gif=await make();if(!gif||gif.length>6_000_000)return null;
 await db.tenant(merchantId,c=>c.query(`INSERT INTO meta_offer_animations(merchant_id,cache_key,gif) VALUES(current_setting('bitpos.merchant')::uuid,$1,$2) ON CONFLICT(merchant_id,cache_key) DO UPDATE SET gif=EXCLUDED.gif,created_at=clock_timestamp()`,[key,gif]));
 return {gif,tag};
}
const photoOf=async(m:{imageUrl:string|null})=>{const f=m.imageUrl?.match(/^\/images\/menu\/([a-z0-9-]{1,60}\.jpg)$/)?.[1];return f?readFile(new URL(f,MENU_IMAGES)).catch(()=>null):null;};

/** Animation for the live single-item offer of a product (approved banner if any, else the menu photo). */
export async function offerAnimation(deps:AgentDeps,merchantId:string,productId:string,size:240|480):Promise<Anim|null>{
 const m=(await listMenu(deps,merchantId)).find(i=>i.productId===productId);
 if(!m?.offer)return null;
 const banner=(await deps.db.tenant(merchantId,c=>c.query<{id:string;image:Buffer;mime:string}>(`SELECT b.id,b.image,b.mime FROM meta_offer_banners b JOIN meta_offer_drafts d ON d.merchant_id=b.merchant_id AND d.id=b.draft_id
  WHERE b.product_id=$1 AND b.state='APPROVED' AND d.state='APPLIED' AND d.offer_expires_at>clock_timestamp() ORDER BY b.decided_at DESC LIMIT 1`,[productId]))).rows[0];
 const key=`v2:offer:${productId}:${m.offer.offerId.slice(0,36)}:${banner?.id.slice(0,8)??'photo'}:${size}`.toLowerCase().replace(/[^a-z0-9:._-]/g,'');
 return cached(deps.db,merchantId,key,async()=>{
  const photo=await photoOf(m),spec={badge:`−${m.offer!.discountPercent}%`,title:size>300?`${m.name} · ${m.nameEn}`:m.nameEn,subtitle:size>300?'โปรสำหรับคุณ · For you today':'',size,frames:size>300?20:16};
  return (banner?await offerGif({...spec,image:banner.image,mime:banner.mime}):null)??(photo?await offerGif({...spec,image:photo,mime:'image/jpeg'}):null);
 });
}
/** Animation for a live two-item offer (the generated picture, or the first item's photo while it is being made). */
export async function comboAnimation(deps:AgentDeps,merchantId:string,id:string,size:240|480):Promise<Anim|null>{
 const c=(await listCombos(deps.db,merchantId,true)).find(x=>x.id===id);if(!c)return null;
 const img=c.hasImage?await comboImage(deps.db,merchantId,id):null;
 const key=`v2:combo:${id}:${img?.image?'img':'photo'}:${size}`;
 return cached(deps.db,merchantId,key,async()=>{
  const spec={badge:`−${c.discountPercent}%`,title:size>300?`${c.a.name} + ${c.b.name}`:`${c.a.nameEn} + ${c.b.nameEn}`,size,frames:size>300?20:16};
  if(img?.image){const g=await offerGif({...spec,image:img.image,mime:img.image_mime??'image/png',subtitle:size>300?`โปรคู่ · ${c.a.nameEn} + ${c.b.nameEn} · ภาพสร้างด้วย AI`:''});if(g)return g;}
  const a=(await listMenu(deps,merchantId)).find(i=>i.productId===c.a.id),photo=a?await photoOf(a):null;
  return photo?offerGif({...spec,image:photo,mime:'image/jpeg',subtitle:size>300?`โปรคู่ · ${c.a.nameEn} + ${c.b.nameEn}`:''}):null;
 });
}
export type {MenuItem};
