import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from './authority';
import {audit} from './db';

const uuid=z.string().uuid();
const text=(max:number)=>z.string().trim().max(max);
const fields=z.object({story:text(600),storyEn:text(600),ingredients:text(300),ingredientsEn:text(300),benefits:text(300),benefitsEn:text(300),videoUrl:z.string().regex(/^(\/videos\/menu\/[a-z0-9-]{1,40}\.mp4)?$/)}).strict();
export type ProductStory=z.infer<typeof fields>;
export const emptyStory:ProductStory={story:'',storyEn:'',ingredients:'',ingredientsEn:'',benefits:'',benefitsEn:'',videoUrl:''};
type Row={product_id:string;story:string;story_en:string;ingredients:string;ingredients_en:string;benefits:string;benefits_en:string;video_url:string};
const toStory=(r:Row):ProductStory=>({story:r.story,storyEn:r.story_en,ingredients:r.ingredients,ingredientsEn:r.ingredients_en,benefits:r.benefits,benefitsEn:r.benefits_en,videoUrl:r.video_url});

/** Stories for a page of products; a product without a row has the empty story. Text only: nothing here is a payment, price or reward fact. */
export async function storiesFor(db:pg.PoolClient,merchant:string,productIds:readonly string[]):Promise<Map<string,ProductStory>>{
 const rows=productIds.length?(await db.query<Row>('SELECT product_id,story,story_en,ingredients,ingredients_en,benefits,benefits_en,video_url FROM product_stories WHERE merchant_id=$1 AND product_id=ANY($2::uuid[])',[merchant,productIds])).rows:[];
 const found=new Map(rows.map(r=>[r.product_id,toStory(r)]));
 return new Map(productIds.map(id=>[id,found.get(id)??emptyStory]));
}
async function requireProduct(db:pg.PoolClient,merchant:string,id:unknown){
 const parsed=uuid.safeParse(id);if(!parsed.success)fail('INVALID_REQUEST',422);
 if(!(await db.query('SELECT 1 FROM products WHERE merchant_id=$1 AND id=$2',[merchant,parsed.data])).rowCount)fail('RESOURCE_NOT_FOUND',404);
 return parsed.data;
}
export async function readProductStory(db:pg.PoolClient,merchant:string,role:string,id:unknown){
 requireRole(role);
 return (await storiesFor(db,merchant,[await requireProduct(db,merchant,id)])).values().next().value as ProductStory;
}
/** Owner/manager only. Replaces the whole story; sending every field keeps one edit from silently keeping stale text. */
export async function writeProductStory(db:pg.PoolClient,merchant:string,actor:string,role:string,id:unknown,input:unknown){
 requireRole(role);
 const productId=await requireProduct(db,merchant,id),data=fields.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
 const s=data.data;
 await db.query(`INSERT INTO product_stories(merchant_id,product_id,story,story_en,ingredients,ingredients_en,benefits,benefits_en,video_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
  ON CONFLICT(merchant_id,product_id) DO UPDATE SET story=excluded.story,story_en=excluded.story_en,ingredients=excluded.ingredients,ingredients_en=excluded.ingredients_en,benefits=excluded.benefits,benefits_en=excluded.benefits_en,video_url=excluded.video_url,updated_at=clock_timestamp()`,
  [merchant,productId,s.story,s.storyEn,s.ingredients,s.ingredientsEn,s.benefits,s.benefitsEn,s.videoUrl]);
 await audit(db,merchant,actor,'catalog.product.story.update',productId);
 return s;
}
