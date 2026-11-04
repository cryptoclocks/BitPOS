import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from './authority';
import {audit} from './db';

const uuid=z.string().uuid();
const text=(max:number,min=0)=>z.string().trim().min(min).max(max);
const base={name:text(80,1),nameEn:text(80,1),category:text(40),description:text(200)};
// imageUrl is optional: absent means "leave the photo alone". A new value must be an uploaded /images/products/<id>.
const imagePath=/^\/images\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const fields=z.object({...base,imageUrl:z.string().regex(imagePath).nullable().optional()}).strict();
const expectedFields=z.object({...base,imageUrl:z.string().max(300).nullable().optional()}).strict();
const edit=z.object({...fields.shape,expected:expectedFields}).strict();
/** The photo must be one this merchant uploaded; null clears it. */
async function checkImage(db:pg.PoolClient,merchant:string,value:string|null|undefined,keep?:string|null){
 if(value==null||value===keep)return;
 const m=imagePath.exec(value);
 if(!m||!(await db.query('SELECT 1 FROM product_images WHERE merchant_id=$1 AND id=$2',[merchant,m[1]])).rowCount)fail('INVALID_REQUEST',422);
}
const rename=z.object({from:text(40),to:text(40),expectedCount:z.number().int().min(1).max(10000)}).strict().refine(v=>v.from!==v.to);
export type ProductDetails=z.infer<typeof fields>;
type Details=Omit<ProductDetails,'imageUrl'>;
const current=(r:{name:string;name_en:string;category:string;description:string}):Details=>({name:r.name,nameEn:r.name_en,category:r.category,description:r.description});
/** Owner/manager only. Edits descriptive fields only: price, stock, offers and options keep their own authorities.
 * `expected` must equal the stored values, so a concurrent edit is refused instead of overwritten. */
export async function editProduct(db:pg.PoolClient,merchant:string,actor:string,role:string,productId:string,input:unknown):Promise<ProductDetails|Details>{
 requireRole(role);
 const id=uuid.safeParse(productId);if(!id.success)fail('INVALID_REQUEST',422);
 const data=edit.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
 const row=(await db.query<{name:string;name_en:string;category:string;description:string;image_url:string|null}>('SELECT name,name_en,category,description,image_url FROM products WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,id.data])).rows[0];
 if(!row)fail('RESOURCE_NOT_FOUND',404);
 const now=current(row),{expected:{imageUrl:expectedImage,...expected},imageUrl:nextImage,...next}=data.data;
 if(JSON.stringify(now)!==JSON.stringify(expected))fail('PRODUCT_CHANGED');
 // Expected-version rule for the photo: when the caller names one it must be what is stored, and changing it requires naming it.
 if(expectedImage!==undefined&&expectedImage!==row.image_url)fail('PRODUCT_CHANGED');
 if(nextImage!==undefined&&expectedImage===undefined)fail('INVALID_REQUEST',422);
 const imageChanged=nextImage!==undefined&&nextImage!==row.image_url;
 if(imageChanged)await checkImage(db,merchant,nextImage,row.image_url);
 const out=nextImage===undefined?next:{...next,imageUrl:nextImage};
 if(JSON.stringify(now)===JSON.stringify(next)&&!imageChanged)return out;
 await db.query('UPDATE products SET name=$3,name_en=$4,category=$5,description=$6,image_url=CASE WHEN $7::boolean THEN $8 ELSE image_url END WHERE merchant_id=$1 AND id=$2',[merchant,id.data,next.name,next.nameEn,next.category,next.description,imageChanged,nextImage??null]);
 await audit(db,merchant,actor,imageChanged?'catalog.product.update+image':'catalog.product.update',id.data);
 return out;
}
/** Renames (or merges into an existing) category across this merchant's products. */
export async function renameCategory(db:pg.PoolClient,merchant:string,actor:string,role:string,input:unknown):Promise<{updated:number}>{
 requireRole(role);
 const data=rename.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
 const ids=(await db.query<{id:string}>('SELECT id FROM products WHERE merchant_id=$1 AND category=$2 ORDER BY id FOR UPDATE',[merchant,data.data.from])).rows;
 if(ids.length!==data.data.expectedCount)fail('PRODUCT_CHANGED');
 await db.query('UPDATE products SET category=$3 WHERE merchant_id=$1 AND category=$2',[merchant,data.data.from,data.data.to]);
 await audit(db,merchant,actor,'catalog.category.rename',data.data.from+' -> '+data.data.to);
 return {updated:ids.length};
}

// M02: menu ordering. Every screen (POS, table menu, cash register, catalog) lists the menu by products.sort_order and takes
// category order from the first product of each category, so one ordering of live products is the whole truth: no second table.
const orderBody=z.object({ids:z.array(uuid).min(1).max(200),expected:z.array(uuid).min(1).max(200)}).strict();
const categoryOrderBody=z.object({categories:z.array(text(40)).min(1).max(200),expected:z.array(text(40)).min(1).max(200)}).strict();
const same=(a:string[],b:string[])=>a.length===b.length&&a.every((v,i)=>v===b[i]);
async function lockedLiveOrder(db:pg.PoolClient,merchant:string){
 await db.query('SELECT id FROM merchants WHERE id=$1 FOR NO KEY UPDATE',[merchant]);
 return (await db.query<{id:string;category:string}>('SELECT id,category FROM products WHERE merchant_id=$1 AND archived_at IS NULL ORDER BY sort_order,id FOR UPDATE',[merchant])).rows;
}
async function writeOrder(db:pg.PoolClient,merchant:string,ids:string[]){
 await db.query('UPDATE products p SET sort_order=v.pos FROM unnest($2::uuid[]) WITH ORDINALITY AS v(id,pos) WHERE p.merchant_id=$1 AND p.id=v.id',[merchant,ids]);
}
/** Owner/manager only. `ids` is the complete new order of live products; `expected` is the order the caller saw. Stale = PRODUCT_CHANGED. */
export async function reorderProducts(db:pg.PoolClient,merchant:string,actor:string,role:string,input:unknown):Promise<{changed:boolean;ids:string[]}>{
 requireRole(role);
 const data=orderBody.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
 const live=await lockedLiveOrder(db,merchant),current=live.map(r=>r.id);
 if(!same(current,data.data.expected))fail('PRODUCT_CHANGED');
 if(new Set(data.data.ids).size!==data.data.ids.length||data.data.ids.length!==current.length||!data.data.ids.every(id=>current.includes(id)))fail('INVALID_REQUEST',422);
 if(same(current,data.data.ids))return {changed:false,ids:current};
 await writeOrder(db,merchant,data.data.ids);
 await audit(db,merchant,actor,'catalog.order.update',String(current.length)+' products');
 return {changed:true,ids:data.data.ids};
}
/** Owner/manager only. Orders categories (blank = uncategorised). Products keep their relative order inside a category. */
export async function reorderCategories(db:pg.PoolClient,merchant:string,actor:string,role:string,input:unknown):Promise<{changed:boolean;categories:string[]}>{
 requireRole(role);
 const data=categoryOrderBody.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
 const live=await lockedLiveOrder(db,merchant),current=[...new Set(live.map(r=>r.category))];
 if(!same(current,data.data.expected))fail('PRODUCT_CHANGED');
 if(new Set(data.data.categories).size!==data.data.categories.length||data.data.categories.length!==current.length||!data.data.categories.every(c=>current.includes(c)))fail('INVALID_REQUEST',422);
 if(same(current,data.data.categories))return {changed:false,categories:current};
 await writeOrder(db,merchant,data.data.categories.flatMap(c=>live.filter(r=>r.category===c).map(r=>r.id)));
 await audit(db,merchant,actor,'catalog.category.reorder',data.data.categories.length+' categories');
 return {changed:true,categories:data.data.categories};
}

export const maxProducts=200;
/** Owner/manager only. A new product starts with stock 0 and NO price: it cannot be sold until the owner
 * publishes a price version that includes it. The legacy price column holds a placeholder that nothing reads. */
export async function createProduct(db:pg.PoolClient,merchant:string,actor:string,role:string,input:unknown):Promise<{id:string}&ProductDetails>{
 requireRole(role);
 const data=fields.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
 await db.query('SELECT id FROM merchants WHERE id=$1 FOR NO KEY UPDATE',[merchant]);
 const state=(await db.query<{n:number;next:number;dup:boolean}>('SELECT count(*)::int AS n,coalesce(max(sort_order),0)+1 AS next,bool_or(lower(name_en)=lower($2)) AS dup FROM products WHERE merchant_id=$1',[merchant,data.data.nameEn])).rows[0];
 if(state.n>=maxProducts)fail('INVALID_REQUEST',422);
 if(state.dup)fail('PRODUCT_CHANGED');
 const d=data.data;
 await checkImage(db,merchant,d.imageUrl);
 const row=(await db.query<{id:string}>("INSERT INTO products(merchant_id,name,name_en,emoji,price_minor,stock,category,description,sort_order,image_url) VALUES($1,$2,$3,'',1,0,$4,$5,$6,$7) RETURNING id",[merchant,d.name,d.nameEn,d.category,d.description,state.next,d.imageUrl??null])).rows[0];
 await audit(db,merchant,actor,'catalog.product.create',row.id);
 return {id:row.id,...d};
}
/** Owner/manager only. Archives a product that is sold out and unreserved; never deletes. Idempotent. */
export async function archiveProduct(db:pg.PoolClient,merchant:string,actor:string,role:string,productId:string):Promise<{id:string;archived:true}>{
 requireRole(role);
 const id=uuid.safeParse(productId);if(!id.success)fail('INVALID_REQUEST',422);
 const row=(await db.query<{stock:number;reserved:number;archived_at:Date|null}>('SELECT stock,reserved,archived_at FROM products WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,id.data])).rows[0];
 if(!row)fail('RESOURCE_NOT_FOUND',404);
 if(row.archived_at)return {id:id.data,archived:true};
 if(row.reserved>0)fail('PRODUCT_HAS_RESERVATIONS',409);
 if(row.stock>0)fail('PRODUCT_HAS_STOCK',409);
 await db.query('UPDATE products SET archived_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2',[merchant,id.data]);
 await audit(db,merchant,actor,'catalog.product.archive',id.data);
 return {id:id.data,archived:true};
}
/** Owner/manager only. Brings an archived product back (stock stays 0; it needs a price publication before it sells). Idempotent. */
export async function unarchiveProduct(db:pg.PoolClient,merchant:string,actor:string,role:string,productId:string):Promise<{id:string;archived:false}>{
 requireRole(role);
 const id=uuid.safeParse(productId);if(!id.success)fail('INVALID_REQUEST',422);
 const row=(await db.query<{archived_at:Date|null}>('SELECT archived_at FROM products WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,id.data])).rows[0];
 if(!row)fail('RESOURCE_NOT_FOUND',404);
 if(!row.archived_at)return {id:id.data,archived:false};
 await db.query('UPDATE products SET archived_at=NULL WHERE merchant_id=$1 AND id=$2',[merchant,id.data]);
 await audit(db,merchant,actor,'catalog.product.unarchive',id.data);
 return {id:id.data,archived:false};
}
