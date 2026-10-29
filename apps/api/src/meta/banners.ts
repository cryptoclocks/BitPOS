// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Offer banners (migration 319): Muse Image puts the offer badge on the shop's own menu photo for an applied offer.
// A banner is PENDING until an owner or manager approves it; meta-pay shows an approved banner only while its offer
// is applied and unexpired, always with an "AI-edited" label. The badge text comes from the server's offer, not the model.
import {readFile} from 'node:fs/promises';
import type {MetaDb} from './identity';
import {editImage,VisionError} from './vision';
import type {AsrConfig} from './voice';

const MENU_IMAGES=new URL('../../../web/public/images/menu/',import.meta.url);
export class BannerError extends Error {constructor(readonly code:'NOT_FOUND'|'NOT_APPLIED'|'NO_PHOTO'|'MODEL_FAILED'){super(code);}}
export interface BannerView {id:string;draftId:string;state:'PENDING'|'APPROVED'|'REJECTED';createdAt:string}

export async function createBanner(db:MetaDb,config:AsrConfig,merchantId:string,userId:string,draftId:string):Promise<string>{
 const d=await db.tenant(merchantId,c=>c.query<{product_id:string;discount_percent:number;state:string;live:boolean;image_url:string|null;name_en:string}>(
  'SELECT d.product_id,d.discount_percent,d.state,coalesce(d.offer_expires_at>clock_timestamp(),false) AS live,p.image_url,p.name_en FROM meta_offer_drafts d JOIN products p ON p.merchant_id=d.merchant_id AND p.id=d.product_id WHERE d.id=$1',[draftId])).then(r=>r.rows[0]);
 if(!d)throw new BannerError('NOT_FOUND');
 if(d.state!=='APPLIED'||!d.live)throw new BannerError('NOT_APPLIED');
 const file=d.image_url?.match(/^\/images\/menu\/([a-z0-9-]{1,60}\.jpg)$/)?.[1];
 if(!file)throw new BannerError('NO_PHOTO');
 const photo=`data:image/jpeg;base64,${(await readFile(new URL(file,MENU_IMAGES))).toString('base64')}`;
 const prompt=`Keep this exact photo of ${d.name_en.toLowerCase()} unchanged: same food, same composition, same colours. Add one small clean promotional badge in the top-right corner: a rounded Meta-blue (#0866FF) label with white bold text "-${d.discount_percent}%". No other text, no logos, no new food, no people.`;
 let img;try{img=await editImage(config,photo,prompt);}catch(e){if(e instanceof VisionError)throw new BannerError('MODEL_FAILED');throw e;}
 return (await db.tenant(merchantId,c=>c.query<{id:string}>(`INSERT INTO meta_offer_banners(merchant_id,draft_id,product_id,mime,image,created_by) VALUES(current_setting('bitpos.merchant')::uuid,$1,$2,$3,$4,$5) RETURNING id`,
  [draftId,d.product_id,img.mime,img.bytes,userId]))).rows[0].id;
}
export async function decideBanner(db:MetaDb,merchantId:string,userId:string,id:string,approve:boolean):Promise<boolean>{
 return (await db.tenant(merchantId,c=>c.query("UPDATE meta_offer_banners SET state=$2,decided_by=$3,decided_at=clock_timestamp() WHERE id=$1 AND state='PENDING'",[id,approve?'APPROVED':'REJECTED',userId]))).rowCount===1;
}
export async function bannersByDraft(db:MetaDb,merchantId:string):Promise<Map<string,BannerView[]>>{
 const rows=(await db.tenant(merchantId,c=>c.query<{id:string;draft_id:string;state:BannerView['state'];created_at:Date}>("SELECT id,draft_id,state,created_at FROM meta_offer_banners WHERE created_at>clock_timestamp()-interval '7 days' ORDER BY created_at DESC LIMIT 50"))).rows;
 const out=new Map<string,BannerView[]>();
 for(const r of rows)out.set(r.draft_id,[...(out.get(r.draft_id)??[]),{id:r.id,draftId:r.draft_id,state:r.state,createdAt:r.created_at.toISOString()}]);
 return out;
}
/** The image bytes; public callers pass approvedOnly (the banner must be approved and its offer still applied). */
export async function bannerImage(db:MetaDb,merchantId:string,id:string,approvedOnly:boolean):Promise<{mime:string;image:Buffer}|null>{
 const r=(await db.tenant(merchantId,c=>c.query<{mime:string;image:Buffer}>(`SELECT b.mime,b.image FROM meta_offer_banners b JOIN meta_offer_drafts d ON d.merchant_id=b.merchant_id AND d.id=b.draft_id
  WHERE b.id=$1${approvedOnly?" AND b.state='APPROVED' AND d.state='APPLIED' AND d.offer_expires_at>clock_timestamp()":''}`,[id]))).rows[0];
 return r??null;
}
/** productId → approved banner id for offers that are applied now (newest approval wins). */
export async function liveBanners(db:MetaDb,merchantId:string):Promise<Map<string,string>>{
 const rows=(await db.tenant(merchantId,c=>c.query<{product_id:string;id:string}>(`SELECT DISTINCT ON (b.product_id) b.product_id,b.id FROM meta_offer_banners b JOIN meta_offer_drafts d ON d.merchant_id=b.merchant_id AND d.id=b.draft_id
  WHERE b.state='APPROVED' AND d.state='APPLIED' AND d.offer_expires_at>clock_timestamp() ORDER BY b.product_id,b.decided_at DESC`))).rows;
 return new Map(rows.map(r=>[r.product_id,r.id]));
}
