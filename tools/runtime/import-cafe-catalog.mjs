import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import {z} from 'zod';

const product=z.object({key:z.string().regex(/^cafe\.[a-z0-9-]+$/),nameEn:z.string().min(1).max(120),nameTh:z.string().min(1).max(120),priceMinor:z.string().regex(/^[1-9][0-9]*$/).refine(v=>BigInt(v)<=100000000n),initialStock:z.number().int().min(0).max(1000000),imageUrl:z.string().regex(/^\/images\/menu\/[a-z0-9-]+\.jpg$/),category:z.string().min(1).max(80),description:z.string().min(1).max(500),sortOrder:z.number().int().min(0),existingProductId:z.string().uuid().nullable(),photo:z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/)})});
const bytes=fs.readFileSync('data/cafe-catalog.json');
const catalog=z.object({version:z.string().min(1),merchantId:z.literal('11111111-1111-4111-8111-111111111111'),storeName:z.string().min(1),currency:z.literal('THB'),locale:z.literal('en'),products:z.array(product).min(1).max(100)}).parse(JSON.parse(bytes));
assert.equal(new Set(catalog.products.map(p=>p.key)).size,catalog.products.length,'duplicate catalog key');
const mappings=catalog.products.filter(p=>p.existingProductId).map(p=>p.existingProductId);
assert.equal(new Set(mappings).size,mappings.length,'duplicate existing product mapping');
for(const p of catalog.products){const file=path.join('apps/web/public',p.imageUrl);assert.ok(!fs.lstatSync(file).isSymbolicLink());assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),p.photo.sha256,'licensed asset hash mismatch');}
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
async function protectedState(){return {stocks:(await db.query('SELECT id,merchant_id,stock,reserved FROM bitpos.products ORDER BY id')).rows,receipts:(await db.query('SELECT order_id,merchant_id,product_id,name,name_en,qty,unit_minor::text FROM bitpos.order_items ORDER BY order_id,product_id')).rows,orders:(await db.query('SELECT id,merchant_id,status,version,thb_minor::text,usdg_minor::text,paid_at FROM bitpos.orders ORDER BY id')).rows,otherProducts:(await db.query('SELECT * FROM bitpos.products WHERE merchant_id<>$1 ORDER BY id',[catalog.merchantId])).rows};}
try{
 await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['cafe-import:'+catalog.merchantId]);
 await db.query('SELECT id FROM bitpos.products WHERE merchant_id=$1 FOR UPDATE',[catalog.merchantId]);
 const before=await protectedState();let inserted=0,updated=0;const products=[];
 for(const p of catalog.products){
  const current=(await db.query('SELECT id,catalog_key FROM bitpos.products WHERE merchant_id=$1 AND (catalog_key=$2 OR id=$3)',[catalog.merchantId,p.key,p.existingProductId])).rows;
  assert.ok(current.length<=1,'catalog key conflicts with mapped existing ID');
  const row=current[0];
  if(p.existingProductId)assert.equal(row?.id,p.existingProductId,'existing mapping missing or wrong tenant');
  if(row){assert.ok(row.catalog_key===null||row.catalog_key===p.key,'existing mapping belongs to a different catalog key');await db.query('UPDATE bitpos.products SET catalog_key=$2,name=$3,name_en=$4,price_minor=$5,image_url=$6,category=$7,description=$8,sort_order=$9 WHERE id=$1',[row.id,p.key,p.nameTh,p.nameEn,p.priceMinor,p.imageUrl,p.category,p.description,p.sortOrder]);updated++;products.push({id:row.id,key:p.key,existing:true});}
  else{const id=crypto.randomUUID();await db.query("INSERT INTO bitpos.products(id,merchant_id,catalog_key,name,name_en,emoji,price_minor,stock,image_url,category,description,sort_order) VALUES($1,$2,$3,$4,$5,'',$6,$7,$8,$9,$10,$11)",[id,catalog.merchantId,p.key,p.nameTh,p.nameEn,p.priceMinor,p.initialStock,p.imageUrl,p.category,p.description,p.sortOrder]);inserted++;products.push({id,key:p.key,existing:false});}
 }
 const after=await protectedState();const originals=new Set(before.stocks.map(p=>p.id));
 assert.deepEqual(after.stocks.filter(p=>originals.has(p.id)),before.stocks,'existing stock or reservations changed');
 assert.deepEqual(after.receipts,before.receipts,'quoted historical receipts changed');assert.deepEqual(after.orders,before.orders,'historical orders changed');assert.deepEqual(after.otherProducts,before.otherProducts,'merchant B changed');
 await db.query('COMMIT');
 const evidence={origin:'actual_single_stack_transactional_cafe_import',version:catalog.version,merchantId:catalog.merchantId,dataset_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),inserted,updated,products,existing_stock_reserved_preserved:true,receipt_hash_before:hash(before.receipts),receipt_hash_after:hash(after.receipts),orders_hash_before:hash(before.orders),orders_hash_after:hash(after.orders),other_merchant_unchanged:true,initial_stock_only_on_insert:true};
 const output=inserted?'.omp/work/evidence/cafe-import-first.json':'.omp/work/evidence/cafe-import-rerun.json';fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({inserted,updated,existing_stock_reserved_preserved:true,historical_receipts_preserved:true,merchant_b_unchanged:true,evidence:output}));
}catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
