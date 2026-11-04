import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {tableFixture,staffToken} from './backend-table-fixture';
// M02: category/product ordering over the real HTTP server and real SQL.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});

test('owner/manager reorder products and categories; stale and foreign requests are refused; every menu reads the new order',integration,async()=>{
 const f=await tableFixture();const {server}=await import('../apps/api/src/index');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const tok={owner:await staffToken(f.pool,f.merchant,randomUUID(),'owner'),manager:await staffToken(f.pool,f.merchant,randomUUID(),'manager'),staff:await staffToken(f.pool,f.merchant,randomUUID(),'staff'),other:await staffToken(f.pool,f.other,randomUUID(),'owner')};
 const call=async(who:keyof typeof tok|null,method:string,path:string,body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:`Bearer ${tok[who]}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 try{
  // four more products: fixture coffee is #1 (sort_order from migration default 0)
  const mk=async(n:string,c:string)=>(await call('owner','POST','/api/products',{name:n,nameEn:n,category:c,description:''})).body.id as string;
  const coffee=f.product;
  await f.tenant(f.merchant,db=>db.query("UPDATE products SET category='Drinks',sort_order=1 WHERE id=$1",[coffee]));
  const cake=await mk('Cake','Food'),tea=await mk('Tea','Drinks'),soup=await mk('Soup','Food'),water=await mk('Water','');
  const order=async()=>(await f.tenant(f.merchant,db=>db.query<{id:string}>('SELECT id FROM products WHERE merchant_id=$1 AND archived_at IS NULL ORDER BY sort_order,id',[f.merchant]))).rows.map(r=>r.id);
  const cats=async()=>[...new Set((await f.tenant(f.merchant,db=>db.query<{category:string}>('SELECT category FROM products WHERE merchant_id=$1 AND archived_at IS NULL ORDER BY sort_order,id',[f.merchant]))).rows.map(r=>r.category))];
  const start=await order();assert.deepEqual(start,[coffee,cake,tea,soup,water]);
  assert.deepEqual(await cats(),['Drinks','Food','']);

  // access
  assert.equal((await call(null,'POST','/api/products/reorder',{ids:start,expected:start})).status,401);
  assert.equal((await call('staff','POST','/api/products/reorder',{ids:start,expected:start})).status,403);
  assert.equal((await call('staff','POST','/api/categories/reorder',{categories:['Food','Drinks',''],expected:['Drinks','Food','']})).status,403);
  // strict bodies
  for(const bad of [{ids:start},{ids:start,expected:start,x:1},{ids:[],expected:start},{ids:['nope'],expected:['nope']},{ids:[...start,start[0]],expected:start}])assert.equal((await call('owner','POST','/api/products/reorder',bad)).status,422,JSON.stringify(bad));
  // the same list in the same order is a no-op and writes no audit row
  const auditCount=async(a:string)=>Number((await f.tenant(f.merchant,db=>db.query('SELECT count(*) FROM audit_logs WHERE merchant_id=$1 AND action=$2',[f.merchant,a]))).rows[0].count);
  assert.equal((await call('owner','POST','/api/products/reorder',{ids:start,expected:start})).body.changed,false);
  assert.equal(await auditCount('catalog.order.update'),0);

  // reorder products: manager moves Water first
  const next=[water,coffee,cake,tea,soup];
  const r1=await call('manager','POST','/api/products/reorder',{ids:next,expected:start});assert.equal(r1.status,200);assert.equal(r1.body.changed,true);
  assert.deepEqual(await order(),next);assert.equal(await auditCount('catalog.order.update'),1);
  // stale: the same proposal with the old "expected" is refused and changes nothing
  assert.equal((await call('owner','POST','/api/products/reorder',{ids:start,expected:start})).status,409);
  assert.deepEqual(await order(),next);
  // set mismatch (missing / foreign id) with the right expected
  assert.equal((await call('owner','POST','/api/products/reorder',{ids:next.slice(1),expected:next})).status,422);
  assert.equal((await call('owner','POST','/api/products/reorder',{ids:[randomUUID(),...next.slice(1)],expected:next})).status,422);
  // another shop cannot see or move these products, and its own list is independent
  const other=await call('other','POST','/api/products/reorder',{ids:next,expected:next});assert.ok([409,422].includes(other.status));assert.deepEqual(await order(),next);

  // the public menu (what POS, QR and cash register read) follows the same order
  const menu=await call('staff','GET','/api/menu');assert.equal(menu.status,200);
  const menuIds=(menu.body.products as {id:string}[]).map(p=>p.id);
  assert.deepEqual(menuIds.filter(id=>next.includes(id)),next,'the menu every screen reads follows the saved order');

  // categories: Food, '', Drinks — products keep their relative order inside each category
  const c1=await call('owner','POST','/api/categories/reorder',{categories:['Food','','Drinks'],expected:await cats()});
  assert.equal(c1.status,200);assert.equal(c1.body.changed,true);
  assert.deepEqual(await cats(),['Food','','Drinks']);
  assert.deepEqual(await order(),[cake,soup,water,coffee,tea]);
  assert.equal(await auditCount('catalog.category.reorder'),1);
  assert.equal((await call('owner','POST','/api/categories/reorder',{categories:['Drinks','Food',''],expected:['Drinks','Food','']})).status,409);
  assert.equal((await call('owner','POST','/api/categories/reorder',{categories:['Food','Drinks'],expected:await cats()})).status,422);
  assert.equal((await call('owner','POST','/api/categories/reorder',{categories:['Food','Food',''],expected:await cats()})).status,422);

  // archived products are left out and keep working; a new product goes to the end
  await f.tenant(f.merchant,db=>db.query('UPDATE products SET stock=0 WHERE id=$1',[water]));
  assert.equal((await call('owner','POST',`/api/products/${water}/archive`,{})).status,200);
  const live=await order();assert.deepEqual(live,[cake,soup,coffee,tea]);
  assert.equal((await call('owner','POST','/api/products/reorder',{ids:[tea,coffee,soup,cake],expected:live})).status,200);
  assert.deepEqual(await order(),[tea,coffee,soup,cake]);
  const late=await mk('Late','Food');assert.deepEqual((await order()).at(-1),late);

  // two racing reorders from the same screen: exactly one wins, the other is stale
  const base2=await order();const a=[...base2].reverse(),b=[...base2.slice(1),base2[0]!];
  const rs=await Promise.all([call('owner','POST','/api/products/reorder',{ids:a,expected:base2}),call('manager','POST','/api/products/reorder',{ids:b,expected:base2})]);
  assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);
 }finally{await new Promise(r=>server.close(r));}
});
