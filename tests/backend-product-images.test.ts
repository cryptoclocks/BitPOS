import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {tableFixture,staffToken} from './backend-table-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const png=(pad=0)=>Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from('0000000d49484452','hex'),Buffer.alloc(pad,7)]);
const jpeg=Buffer.concat([Buffer.from('ffd8ffe0','hex'),Buffer.alloc(64,1)]);
const webp=Buffer.concat([Buffer.from('RIFF'),Buffer.from([0x40,0,0,0]),Buffer.from('WEBPVP8 '),Buffer.alloc(64,2)]);
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

test('product images: role/tenant fenced upload, magic bytes, size cap, SVG refused, dedupe, product link with expected-version, public serving headers',integration,async()=>{
 const f=await tableFixture(5);
 const {uploadProductImage}=await import('../apps/api/src/product-images');
 const {editProduct,createProduct}=await import('../apps/api/src/catalog-edit');
 const up=(merchant:string,role:string,bytes:Buffer)=>f.tenant(merchant,db=>uploadProductImage(db,merchant,f.actor,role,bytes));

 const first=await up(f.merchant,'owner',png(100));
 assert.match(first.path,/^\/images\/products\/[0-9a-f-]{36}$/);assert.equal(first.mime,'image/png');assert.equal(first.deduped,false);
 const again=await up(f.merchant,'manager',png(100));
 assert.deepEqual([again.id,again.deduped],[first.id,true],'same bytes, same merchant: same image');
 const otherTenant=await up(f.other,'owner',png(100));
 assert.notEqual(otherTenant.id,first.id,'another merchant gets its own row');
 assert.equal((await up(f.merchant,'owner',jpeg)).mime,'image/jpeg');
 assert.equal((await up(f.merchant,'owner',webp)).mime,'image/webp');

 await assert.rejects(up(f.merchant,'staff',png(5)),/ROLE_REQUIRED/);
 await assert.rejects(up(f.merchant,'owner',svg),/INVALID_REQUEST/,'SVG is refused');
 await assert.rejects(up(f.merchant,'owner',Buffer.from('GIF89a......')),/INVALID_REQUEST/,'bad magic bytes');
 await assert.rejects(up(f.merchant,'owner',Buffer.alloc(0)),/INVALID_REQUEST/);
 await assert.rejects(up(f.merchant,'owner',png(1024*1024)),/REQUEST_TOO_LARGE/,'over 1 MiB');
 assert.equal((await up(f.merchant,'owner',png(1024*1024-16))).deduped,false,'exactly 1 MiB is accepted');

 // The database refuses what the API would never send.
 const raw=(sql:string,args:unknown[])=>f.tenant(f.merchant,db=>db.query(sql,args));
 const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
 const bad=Buffer.from('<svg/>');
 await assert.rejects(raw('INSERT INTO product_images(merchant_id,content_sha256,mime,bytes,size) VALUES($1,$2,$3,$4,$5)',[f.merchant,sha(bad),'image/png',bad,bad.length]),/check/i,'DB magic-byte check');
 await assert.rejects(raw('INSERT INTO product_images(merchant_id,content_sha256,mime,bytes,size) VALUES($1,$2,$3,$4,$5)',[f.merchant,sha(bad),'image/svg+xml',bad,bad.length]),/check/i,'DB mime check');
 const big=png(1024*1024);
 await assert.rejects(raw('INSERT INTO product_images(merchant_id,content_sha256,mime,bytes,size) VALUES($1,$2,$3,$4,$5)',[f.merchant,sha(big),'image/png',big,big.length]),/check/i,'DB size check');
 await assert.rejects(raw('INSERT INTO product_images(merchant_id,content_sha256,mime,bytes,size) VALUES($1,$2,$3,$4,$5)',[f.other,sha(png(9)),'image/png',png(9),png(9).length]),/row-level|policy/i,'RLS fences other merchant');
 await assert.rejects(raw('UPDATE product_images SET mime=mime WHERE id=$1',[first.id]),/permission denied|immutable/i,'rows are immutable');

 // Linking through the existing edit path.
 const details=async()=>(await f.tenant(f.merchant,async db=>(await db.query('SELECT name,name_en,category,description,image_url FROM products WHERE id=$1',[f.product])).rows[0]));
 const before=await details();assert.equal(before.image_url,null);
 const expected={name:before.name,nameEn:before.name_en,category:before.category,description:before.description,imageUrl:null};
 const edit=(merchant:string,role:string,input:unknown)=>f.tenant(merchant,db=>editProduct(db,merchant,f.actor,role,f.product,input));
 const next={name:before.name,nameEn:before.name_en,category:before.category,description:before.description};
 await assert.rejects(edit(f.merchant,'staff',{...next,imageUrl:first.path,expected}),/ROLE_REQUIRED/);
 await assert.rejects(edit(f.merchant,'owner',{...next,imageUrl:otherTenant.path,expected}),/INVALID_REQUEST/,"another merchant's image cannot be linked");
 await assert.rejects(edit(f.merchant,'owner',{...next,imageUrl:'/images/products/'+randomUUID(),expected}),/INVALID_REQUEST/,'unknown image');
 await assert.rejects(edit(f.merchant,'owner',{...next,imageUrl:'/images/menu/x.jpg',expected}),/INVALID_REQUEST/,'only uploaded paths');
 await assert.rejects(edit(f.merchant,'owner',{...next,imageUrl:first.path,expected:{...expected,imageUrl:'/images/products/'+randomUUID()}}),/PRODUCT_CHANGED/,'stale expected photo');
 await assert.rejects(edit(f.merchant,'owner',{...next,imageUrl:first.path,expected:next}),/INVALID_REQUEST/,'changing the photo requires naming the expected one');
 assert.equal((await details()).image_url,null,'refusals change nothing');
 assert.equal((await edit(f.merchant,'owner',{...next,imageUrl:first.path,expected}) as {imageUrl:string}).imageUrl,first.path);
 assert.equal((await details()).image_url,first.path);
 assert.equal((await edit(f.merchant,'owner',{...next,imageUrl:first.path,expected:{...expected,imageUrl:first.path}}) as {imageUrl:string}).imageUrl,first.path,'replay is a no-op');
 await edit(f.merchant,'owner',{...next,expected:{...expected,imageUrl:first.path}});
 assert.equal((await details()).image_url,first.path,'omitting imageUrl leaves the photo alone');
 await edit(f.merchant,'owner',{...next,imageUrl:null,expected:{...expected,imageUrl:first.path}});
 assert.equal((await details()).image_url,null,'null removes the photo');

 const made=await f.tenant(f.merchant,db=>createProduct(db,f.merchant,f.actor,'owner',{name:'มีรูป',nameEn:'With photo',category:'',description:'',imageUrl:first.path}));
 assert.equal((await f.tenant(f.merchant,async db=>(await db.query('SELECT image_url FROM products WHERE id=$1',[made.id])).rows[0])).image_url,first.path);
 await assert.rejects(f.tenant(f.merchant,db=>createProduct(db,f.merchant,f.actor,'owner',{name:'x',nameEn:'Bad photo',category:'',description:'',imageUrl:otherTenant.path})),/INVALID_REQUEST/);

 // HTTP: raw upload (role from the session), public read headers.
 const {server}=await import('../apps/api/src/index');
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
  const owner=await staffToken(f.pool,f.merchant,f.actor,'owner'),staff=await staffToken(f.pool,f.merchant,randomUUID(),'staff');
  const post=(token:string|null,body:Buffer)=>fetch(base+'/api/product-images',{method:'POST',headers:{'Content-Type':'application/octet-stream',...(token?{Authorization:'Bearer '+token}:{})},body});
  assert.equal((await post(null,png(3))).status,401);
  assert.equal((await post(staff,png(3))).status,403);
  assert.equal((await post(owner,svg)).status,415);
  assert.equal((await post(owner,Buffer.alloc(1024*1024+1,1))).status,413);
  const ok=await post(owner,jpeg);assert.equal(ok.status,200);
  const stored=await ok.json() as {id:string;path:string;deduped:boolean};assert.equal(stored.deduped,true,'idempotent over HTTP');
  const got=await fetch(base+'/api/product-images/'+stored.id);
  assert.equal(got.status,200);assert.equal(got.headers.get('content-type'),'image/jpeg');
  assert.equal(got.headers.get('cache-control'),'public,max-age=31536000,immutable');assert.equal(got.headers.get('x-content-type-options'),'nosniff');
  assert.ok(Buffer.from(await got.arrayBuffer()).equals(jpeg));
  assert.equal((await fetch(base+'/api/product-images/'+randomUUID())).status,404);
 }finally{server.close();}
});
