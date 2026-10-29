// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Facebook Page post drafts for a live offer (migration 321). Muse Image turns the shop's own menu photo into a square
// post picture (the food stays the real photo), Muse Spark writes a short Thai/English caption with no numbers, and the
// server adds the item, price, discount and end time. An owner or manager reviews it and presses Post; only then is it
// published to the shop's Page with the Graph API (/{page-id}/photos). Errors (e.g. missing permission) are kept.
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import type {MetaRouter} from '../../../../packages/meta-ai/src/router';
import type {MetaDb} from './identity';
import type {MessengerConfig,MessengerFetch} from './messenger';
import {editImage,VisionError} from './vision';
import type {AsrConfig} from './voice';
import {formatTapAmount} from './staff';

const MENU_IMAGES=new URL('../../../web/public/images/menu/',import.meta.url);
export class SocialError extends Error {constructor(readonly code:'NOT_FOUND'|'NOT_LIVE'|'NO_PHOTO'|'MODEL_FAILED'|'NOT_DRAFT'|'NO_PAGE'){super(code);}}
export interface PostView {id:string;draftId:string;caption:string;state:'DRAFT'|'POSTED'|'FAILED'|'DISCARDED';fbPostId:string|null;failure:string|null;createdAt:string}

export async function draftPost(db:MetaDb,router:MetaRouter|null,vision:AsrConfig,merchantId:string,userId:string,draftId:string):Promise<string>{
 const d=(await db.tenant(merchantId,c=>c.query<{name:string;name_en:string;emoji:string;image_url:string|null;discount_percent:number;offer_expires_at:Date|null;state:string;price_minor:string;shop:string}>(
  `SELECT p.name,p.name_en,p.emoji,p.image_url,d.discount_percent,d.offer_expires_at,d.state,p.price_minor::text,m.name AS shop FROM meta_offer_drafts d JOIN products p ON p.merchant_id=d.merchant_id AND p.id=d.product_id JOIN merchants m ON m.id=d.merchant_id WHERE d.id=$1`,[draftId]))).rows[0];
 if(!d)throw new SocialError('NOT_FOUND');
 if(d.state!=='APPLIED'||!d.offer_expires_at||d.offer_expires_at.getTime()<=Date.now())throw new SocialError('NOT_LIVE');
 const file=d.image_url?.match(/^\/images\/menu\/([a-z0-9-]{1,60}\.jpg)$/)?.[1];
 if(!file)throw new SocialError('NO_PHOTO');
 const photo=`data:image/jpeg;base64,${(await readFile(new URL(file,MENU_IMAGES))).toString('base64')}`;
 let img;
 try{img=await editImage(vision,photo,`Make a square social media post from this exact photo of ${d.name_en.toLowerCase()}: keep the food photo real and unchanged, crop it to a square, add a soft blue-to-violet (#0866FF to #7A3FF2) frame and one rounded label with white bold text "-${d.discount_percent}%". No other words, no logos, no people, no new food.`);}
 catch(e){if(e instanceof VisionError)throw new SocialError('MODEL_FAILED');throw e;}
 // Words from Muse Spark (no numbers); facts from the server.
 let th='มาลองเมนูนี้กันค่ะ',en='Come and try it.',tags=['MuseCafe'];
 if(router){try{
  const schema=z.object({th:z.string().trim().min(1).max(220),en:z.string().trim().min(1).max(220),hashtags:z.array(z.string().regex(/^[A-Za-z฀-๿]{2,30}$/)).max(4)}).strict();
  const r=await router.invoke({task:'promotion_copy',merchantId,messages:[{role:'system',content:'Write a warm, short Facebook post for a small cafe offer: one or two sentences in Thai (th) and in English (en), plus up to four hashtags without #. No numbers, prices, percentages, dates, health claims or promises; the shop adds those.'},{role:'user',content:JSON.stringify({shop:d.shop,item:d.name_en,itemTh:d.name})}],
   output:{name:'post_copy',schema,jsonSchema:{type:'object',additionalProperties:false,required:['th','en','hashtags'],properties:{th:{type:'string',maxLength:220},en:{type:'string',maxLength:220},hashtags:{type:'array',maxItems:4,items:{type:'string'}}}}},maxOutputTokens:800,reasoningEffort:'minimal',deadlineMs:15000});
  if(!/[0-9๐-๙%$฿]/.test(r.value.th+r.value.en)){th=r.value.th;en=r.value.en;tags=[...new Set(['MuseCafe',...r.value.hashtags])].slice(0,5);}
 }catch{/* template words stay */}}
 const base=BigInt(d.price_minor),now=base*BigInt(100-d.discount_percent)/100n,until=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'}).format(d.offer_expires_at);
 const caption=`${th}\n${en}\n\n${d.emoji} ${d.name} · ${d.name_en}: ${formatTapAmount(now.toString(),'usd')} (ปกติ / was ${formatTapAmount(base.toString(),'usd')}) · −${d.discount_percent}% ถึง / until ${until}\nสั่งที่ / Order at ${d.shop} · Stripe sandbox demo\n${tags.map(t=>`#${t}`).join(' ')}\n🎨 ภาพแก้ด้วย AI จากรูปเมนูจริง / AI-edited from the real menu photo`;
 return (await db.tenant(merchantId,c=>c.query<{id:string}>(`INSERT INTO meta_social_posts(merchant_id,draft_id,caption,mime,image,created_by) VALUES(current_setting('bitpos.merchant')::uuid,$1,$2,$3,$4,$5) RETURNING id`,[draftId,caption,img.mime,img.bytes,userId]))).rows[0].id;
}

export async function postsByDraft(db:MetaDb,merchantId:string):Promise<Map<string,PostView[]>>{
 const rows=(await db.tenant(merchantId,c=>c.query<{id:string;draft_id:string;caption:string;state:PostView['state'];fb_post_id:string|null;failure:string|null;created_at:Date}>("SELECT id,draft_id,caption,state,fb_post_id,failure,created_at FROM meta_social_posts WHERE created_at>clock_timestamp()-interval '7 days' AND state<>'DISCARDED' ORDER BY created_at DESC LIMIT 30"))).rows;
 const out=new Map<string,PostView[]>();
 for(const r of rows)out.set(r.draft_id,[...(out.get(r.draft_id)??[]),{id:r.id,draftId:r.draft_id,caption:r.caption,state:r.state,fbPostId:r.fb_post_id,failure:r.failure,createdAt:r.created_at.toISOString()}]);
 return out;
}
export async function postImage(db:MetaDb,merchantId:string,id:string){return (await db.tenant(merchantId,c=>c.query<{mime:string;image:Buffer}>('SELECT mime,image FROM meta_social_posts WHERE id=$1',[id]))).rows[0]??null;}
export async function discardPost(db:MetaDb,merchantId:string,userId:string,id:string){await db.tenant(merchantId,c=>c.query("UPDATE meta_social_posts SET state='DISCARDED',decided_by=$2,decided_at=clock_timestamp() WHERE id=$1 AND state IN ('DRAFT','FAILED')",[id,userId]));}

/** Publish a reviewed draft to the shop's Page (owner/manager pressed Post). Returns the post id or keeps the error. */
export async function publishPost(db:MetaDb,messenger:MessengerConfig,merchantId:string,userId:string,id:string,caption:string|null,fetchImpl:MessengerFetch=fetch):Promise<{ok:boolean;detail:string}>{
 const p=(await db.tenant(merchantId,c=>c.query<{state:string;caption:string;mime:string;image:Buffer;page_id:string|null}>(
  "SELECT s.state,s.caption,s.mime,s.image,(SELECT page_id FROM meta_messenger_pages WHERE retired_at IS NULL LIMIT 1) AS page_id FROM meta_social_posts s WHERE s.id=$1 FOR UPDATE",[id]))).rows[0];
 if(!p)throw new SocialError('NOT_FOUND');
 if(!['DRAFT','FAILED'].includes(p.state))throw new SocialError('NOT_DRAFT');
 if(!p.page_id)throw new SocialError('NO_PAGE');
 const text=(caption??p.caption).slice(0,2200);
 const form=new FormData();form.append('caption',text);form.append('published','true');form.append('source',new Blob([new Uint8Array(p.image)],{type:p.mime}),`post.${p.mime.split('/')[1]}`);
 let ok=false,detail='';
 try{const r=await fetchImpl(`${messenger.graphBase??'https://graph.facebook.com'}/${messenger.graphVersion}/${p.page_id}/photos`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${messenger.pageToken}`},body:form});
  const j=await r.json().catch(()=>null) as {post_id?:string;id?:string;error?:{code?:number;error_subcode?:number;message?:string}}|null;
  if(r.ok&&(j?.post_id||j?.id)){ok=true;detail=String(j.post_id??j.id).replace(/[^0-9_]/g,'').slice(0,80);}
  else detail=`${r.status}/${j?.error?.code??'?'}/${j?.error?.error_subcode??'-'}`;}
 catch{detail='UNREACHABLE';}
 await db.tenant(merchantId,c=>c.query("UPDATE meta_social_posts SET state=$2,fb_post_id=$3,failure=$4,caption=$5,decided_by=$6,decided_at=clock_timestamp() WHERE id=$1",[id,ok?'POSTED':'FAILED',ok?detail:null,ok?null:detail,text,userId]));
 return {ok,detail};
}
