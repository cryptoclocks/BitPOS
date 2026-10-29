import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import pg from 'pg';
import {FoodDispatchConsolePageSchema} from '../../packages/contracts/src/mobile-v1.generated';
type Actor={account:string;session:string;device:string;access:string;refresh:string};
type Call=(path:string,method?:string,body?:unknown,token?:string,status?:number)=>Promise<any>;
export async function verifyFoodDispatchConsoleHttp(c:{db:pg.Client;base:string;merchant:string;foreignMerchant:string;branch:string;product:string;policy:string;grant:string;shipment:string;address:any;customerToken:string;dispatcher:Actor;outsider:Actor;call:Call}){
 const {db,base,merchant,branch,dispatcher,call}=c,root='/api/mobile/v1',path=root+`/platform/merchants/${merchant}/branches/${branch}/food-dispatch`;
 assert.equal(new URL(base).hostname,'127.0.0.1');assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 let pending:Promise<{status:number;value:any}>|undefined;
 const other=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'});await other.connect();
 async function queued(){
  await db.query('BEGIN');await db.query('SELECT id FROM bitpos.merchants WHERE id=$1 FOR NO KEY UPDATE',[merchant]);
  pending=fetch(base+path,{headers:{Authorization:'Bearer '+dispatcher.access}}).then(async r=>({status:r.status,value:await r.json()}));
  const deadline=Date.now()+140;
  while(Date.now()<deadline){await db.query('SELECT pg_stat_clear_snapshot()');if((await db.query("SELECT count(*)::int n FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND datname=current_database() AND wait_event_type='Lock' AND query LIKE '%food_dispatch_console_queue%' ")).rows[0].n>0)return;}
  assert.fail('Actual console queue did not reach observed canonical merchant root wait');
 }
 try{
  assert.equal((await call(path,'GET',undefined,undefined,401)).code,'AUTH_REQUIRED');
  for(const token of [c.customerToken,c.outsider.access])assert.equal((await call(path,'GET',undefined,token,403)).code,'ROLE_REQUIRED');
  assert.equal((await call(root+`/platform/merchants/${c.foreignMerchant}/branches/${branch}/food-dispatch`,'GET',undefined,dispatcher.access,403)).code,'ROLE_REQUIRED');
  assert.equal((await call(root+`/platform/merchants/${merchant}/branches/${randomUUID()}/food-dispatch`,'GET',undefined,dispatcher.access,404)).code,'RESOURCE_NOT_FOUND');
  for(const query of ['?unexpected=true','?afterId=not-a-uuid','?afterId='+randomUUID()+'&afterId='+randomUUID()])assert.equal((await call(path+query,'GET',undefined,dispatcher.access,422)).code,'INVALID_REQUEST');
  assert.equal((await call(path,'POST',{},dispatcher.access,405)).code,'INVALID_REQUEST');
  // Only this newly generated synthetic fixture stock is expanded; every row below is admitted by the actual canonical quote/order APIs.
  await db.query('BEGIN');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);await db.query('UPDATE bitpos.products SET stock=100 WHERE merchant_id=$1 AND id=$2',[merchant,c.product]);await db.query('COMMIT');
  for(let n=0;n<51;n++){
   const quote=await call(root+'/food/quotes','POST',{branchId:branch,serving:'delivery',items:[{lineId:randomUUID(),productId:c.product,qty:1,optionVersion:null,selections:[],allergyNote:null}],delivery:{addressId:c.address.id,addressVersion:c.address.version,policyVersionId:c.policy}},c.customerToken);
   await call(root+'/food/orders','POST',{branchId:branch,quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:randomUUID()},c.customerToken);
  }
  const expected=(await db.query(`SELECT s.id FROM bitpos.food_shipments s JOIN bitpos.quote_delivery_snapshots q ON(q.merchant_id,q.quote_id)=(s.merchant_id,s.quote_id) WHERE s.merchant_id=$1 AND q.branch_id=$2 AND s.state NOT IN('DELIVERED','CANCELLED','FAILED') ORDER BY s.id`,[merchant,branch])).rows.map(r=>r.id);
  assert.equal(expected.length,52);const pages=[];let after:string|null=null;
  do{const page=FoodDispatchConsolePageSchema.parse(await call(path+(after?'?afterId='+after:''),'GET',undefined,dispatcher.access));assert.equal(page.merchantId,merchant);assert.equal(page.branchId,branch);pages.push(page);after=page.nextAfterId;assert.ok(pages.length<=2);}while(after);
  assert.deepEqual(pages.map(p=>p.items.length),[50,2]);assert.deepEqual(pages.flatMap(p=>p.items.map(r=>r.shipmentId)),expected);
  assert.equal(pages[0].nextAfterId,expected[49]);assert.equal(pages[1].nextAfterId,null);
  function privacy(value:unknown){if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){assert.ok(!/address|recipient|phone|latitude|longitude|proof|payment|wallet/i.test(key),'Private or financial field leaked: '+key);privacy(item);}}
  pages.forEach(privacy);
  await queued();const rotated=await call(root+'/auth/refresh','POST',{refreshToken:dispatcher.refresh,deviceId:dispatcher.device});dispatcher.access=rotated.accessToken;dispatcher.refresh=rotated.refreshToken;
  await db.query('COMMIT');const stale=await pending!;assert.equal(stale.status,401,JSON.stringify(stale));assert.equal(stale.value.error.code,'AUTH_REQUIRED');
  FoodDispatchConsolePageSchema.parse(await call(path,'GET',undefined,dispatcher.access));
  await queued();await other.query('UPDATE bitpos.platform_staff_role_grants SET revoked_at=clock_timestamp() WHERE id=$1',[c.grant]);await db.query('COMMIT');const revoked=await pending!;assert.equal(revoked.status,403,JSON.stringify(revoked));assert.equal(revoked.value.error.code,'ROLE_REQUIRED');
  const receipt={status:'PASS_ACTUAL_HTTP_DISPATCH_CONSOLE_SCOPE_PAGING_PRIVACY_AND_WAIT_FENCES',merchant,branch,canonicalOrders:52,pageSizes:pages.map(p=>p.items.length),checks:['No bearer401, customer/outsider/wrongmerchant403, wrongbranch404','Unknown/duplicate/invalid cursor422 and write405','52 actual canonical quote/order API rows traverse50+2 exactly against persisted UUID order; no duplicates or omissions','Strict generated pages exclude recipient, contact, address, coordinates, proof and financial fields','Actual auth refresh during observed merchant-root wait denies old bearer401; rotated bearer succeeds','Actual scoped grant revocation during observed merchant-root wait denies403'],fixture:'Only new synthetic merchant stock expanded; actual canonical APIs, live authentication and lock waits. Additional paging orders deliberately unpaid/unaccepted, no real money or delivery.',physicalTesting:'deferred_by_user_2026-10-16'};
  await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch085-console-http-20261019.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 }finally{await db.query('ROLLBACK');if(pending)await pending;await other.end();}
}
