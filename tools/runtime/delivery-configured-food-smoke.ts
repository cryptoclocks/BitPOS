import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',ADMIN_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets',BITPOS_MOBILE_ENABLED:'1'});
const {default:pg}=await import('pg');
const {pool,tenant}=await import('../../apps/api/src/db');
const {server}=await import('../../apps/api/src/index');
const {publishPrices,captureQuote}=await import('../../apps/api/src/catalog');
const {publishProductOptions}=await import('../../apps/api/src/online-options');
const {orderView,orderViews}=await import('../../apps/api/src/orders');
const {latestOrder}=await import('../../apps/web/src/lib/fulfillment');
const {MINT,TOKEN_PROGRAM}=await import('../../packages/domain/src/index');
const {MobileMenuSchema,MobileFoodQuoteSchema,MobileFoodOrderResultSchema}=await import('../../packages/contracts/src/mobile-v1.generated');
const {MobileFoodOrdersSchema}=await import('../../packages/contracts/src/mobile-v1.generated');
const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
const merchant=randomUUID(),branch=randomUUID(),product=randomUUID(),actor=randomUUID(),group=randomUUID(),choice=randomUUID(),passed:string[]=[];
const check=(name:string,fn:()=>void)=>{fn();passed.push(name);};
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port;
async function request(path:string,method='GET',body?:unknown,token?:string){const response=await fetch(base+'/api/mobile/v1/'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
try{
 await pool.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'FIXTURE configured food authority','11111111111111111111111111111111')",[merchant]);
 await admin.query("INSERT INTO bitpos.marketplace_branches(merchant_id,id,name,name_en,enabled,pickup_enabled) VALUES($1,$2,'ร้านตัวเลือกทดสอบ','Configured food fixture',true,true)",[merchant,branch]);
 const pricing=await tenant(merchant,async db=>{await db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'กาแฟ','Coffee','',270,10)",[product,merchant]);return publishPrices(db,merchant,actor,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'CONFIGURED FOOD LOCAL FIXTURE'},prices:[{productId:product,unitMinor:'270'}],settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}});});
 const publication={expectedRevision:'0',idempotencyKey:randomUUID(),priceVersion:pricing.priceVersion,noteEnabled:true,groups:[{id:group,name:'ท็อปปิ้ง',nameEn:'Topping',enabled:true,minSelections:1,maxSelections:3,choices:[{id:choice,name:'ช็อต',nameEn:'Shot',enabled:true,maxQty:3,priceDelta:{currency:'USD',decimals:2,amountMinor:'35'}}]}]};
 const options=await tenant(merchant,db=>publishProductOptions(db,merchant,actor,'owner',product,publication));
 const auth=await request('auth/verify','POST',{phone:'+66900000001',code:'123456',deviceId:randomUUID()}),other=await request('auth/verify','POST',{phone:'+66900000002',code:'123456',deviceId:randomUUID()});assert.equal(auth.status,200);assert.equal(other.status,200);
 const menuResult=await request('branches/'+branch+'/menu');check('Public menu exposes exact active immutable option version',()=>{assert.equal(menuResult.status,200);const menu=MobileMenuSchema.parse(menuResult.body);assert.equal(menu.products[0].options.version,options.version);assert.equal(menu.products[0].options.groups[0].choices[0].priceDelta.amountMinor,'35');});
 const items=[{lineId:randomUUID(),productId:product,qty:2,optionVersion:options.version,selections:[{groupId:group,choiceId:choice,qty:2}],allergyNote:'ไม่ใส่นม\nNo dairy'},{lineId:randomUUID(),productId:product,qty:1,optionVersion:options.version,selections:[{groupId:group,choiceId:choice,qty:1}],allergyNote:null}];
 const authority={kind:'versioned' as const,source:{kind:'online' as const,accountId:auth.body.accountId,branchId:branch,channel:'customer_app' as const,label:'BitPOS customer app'},serving:{kind:'pickup' as const,label:'Pickup'},target:null,pairingGeneration:null};
 // Inject malformed evidence at the persistence boundary; real deferred DB
 // constraints, not an application validator, must abort the transaction.
 for(const [name,mutate] of [
  ['forged option label',(s:any)=>{s.lines[0].selections[0].choiceName='Forged';}],
  ['forged money',(s:any)=>{s.total.amountMinor='1';}],
  ['omitted configured line',(s:any)=>{s.lines.pop();}],
  ['forged allergy note',(s:any)=>{s.lines[0].allergyNote='Changed';}],
  ['forged choice quantity',(s:any)=>{s.lines[0].selections[0].qty=3;}],
 ] as const){
  await assert.rejects(tenant(merchant,async db=>{const altered=new Proxy(db,{get(target,key){if(key==='query')return (sql:string,values?:unknown[])=>{if(sql.startsWith('INSERT INTO quote_configured_food')){const next=[...values!],snapshot=JSON.parse(next[3] as string);mutate(snapshot);next[3]=JSON.stringify(snapshot);return target.query(sql,next);}return target.query(sql,values);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});await captureQuote(altered,merchant,{kind:'online',id:auth.body.accountId,branchId:branch},items,authority);}), (error:{code?:string})=>error.code==='23514');passed.push('Deferred SQL rejects '+name);
 }
 const invalid=await request('food/quotes','POST',{branchId:branch,serving:'pickup',items:[{...items[0],selections:[]}]},auth.body.accessToken);check('Required choice omission refused before quote',()=>assert.equal(invalid.status,422));
 const injected=await request('food/quotes','POST',{branchId:branch,serving:'pickup',items:[{...items[0],selections:[{...items[0].selections[0],priceDelta:'0'}]}]},auth.body.accessToken);check('Client option price injection refused',()=>assert.equal(injected.status,422));
 const quoted=await request('food/quotes','POST',{branchId:branch,serving:'pickup',items},auth.body.accessToken);assert.equal(quoted.status,200,JSON.stringify(quoted.body));const quote=MobileFoodQuoteSchema.parse(quoted.body);
 check('Two variants have exact payable985 and unchanged product component270',()=>{assert.equal(quote.configured.lines.length,2);assert.equal(quote.total.amountMinor,'985');assert.equal(quote.subtotal.amountMinor,'985');assert.equal(quote.discount.amountMinor,'0');assert.equal(quote.lines.length,1);assert.equal(quote.lines[0].qty,3);assert.equal(quote.lines[0].unitPrice.amountMinor,'270');assert.equal(quote.settlement.money.amountMinor,'9850000');assert.equal(quote.configured.lines.find(l=>l.lineId===items[0].lineId)!.allergyNote,items[0].allergyNote);});
 const command={branchId:branch,quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:randomUUID()};
 const wrong=await request('food/orders','POST',command,other.body.accessToken);check('Foreign account cannot confirm configured quote',()=>assert.equal(wrong.status,404));
 const results=await Promise.all([request('food/orders','POST',command,auth.body.accessToken),request('food/orders','POST',command,auth.body.accessToken)]);results.forEach(result=>assert.equal(result.status,200,JSON.stringify(result.body)));const one=MobileFoodOrderResultSchema.parse(results[0].body),two=MobileFoodOrderResultSchema.parse(results[1].body);
 check('Double tap has one configured order and exact frozen snapshot',()=>{assert.equal(one.order.id,two.order.id);assert.notEqual(one.replayed,two.replayed);assert.deepEqual(one.order.configured,quote.configured);});
 const bills=await tenant(merchant,async db=>{const row=(await db.query('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2',[merchant,one.order.id])).rows[0];return {merchant:await orderView(db,row),public:await orderView(db,row,true),list:(await orderViews(db,[row]))[0]};});
 check('Merchant and public bill preserve separate configured variants while lists stay compact',()=>{assert.deepEqual(bills.merchant.configuredFood,quote.configured);assert.deepEqual(bills.public.configuredFood,quote.configured);assert.equal(bills.list.configuredFood,undefined);assert.equal(bills.list.configuredFoodLineCount,2);assert.equal(bills.merchant.pricing.lines.length,1);assert.equal(bills.merchant.pricing.total.amountMinor,'985');});
 check('List refresh retains immutable detail without discarding newer kitchen state',()=>{const next={...bills.list,fulfillment:{...bills.merchant.fulfillment!,version:bills.merchant.fulfillment!.version+1,status:'PREPARING' as const}};const merged=latestOrder(bills.merchant,next);assert.deepEqual(merged.configuredFood,quote.configured);assert.equal(merged.fulfillment?.status,'PREPARING');assert.equal(merged.fulfillment?.version,next.fulfillment.version);});
 const history=await request('food/orders','GET',undefined,auth.body.accessToken);check('Owned history is a compact authoritative payable summary',()=>{assert.equal(history.status,200);const page=MobileFoodOrdersSchema.parse(history.body);assert.equal(page.orders[0].id,one.order.id);assert.equal(page.orders[0].total.amountMinor,'985');assert.equal('configured' in history.body.orders[0],false);assert.equal('refunds' in history.body.orders[0],false);});
 const updated=await tenant(merchant,db=>publishProductOptions(db,merchant,actor,'owner',product,{...publication,expectedRevision:'1',idempotencyKey:randomUUID(),noteEnabled:false}));
 const replay=await request('food/orders','POST',command,auth.body.accessToken);check('Committed replay survives option publication without rewriting bill',()=>{assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.deepEqual(replay.body.order.configured,quote.configured);});
 const stale=await request('food/quotes','POST',{branchId:branch,serving:'pickup',items},auth.body.accessToken);check('Stale option version cannot obtain new quote',()=>assert.equal(stale.status,409));
 const remainder={...items[1],lineId:randomUUID(),qty:7,optionVersion:updated.version};
 const lastQuotes=await Promise.all([request('food/quotes','POST',{branchId:branch,serving:'pickup',items:[remainder]},auth.body.accessToken),request('food/quotes','POST',{branchId:branch,serving:'pickup',items:[remainder]},auth.body.accessToken)]);lastQuotes.forEach(r=>assert.equal(r.status,200,JSON.stringify(r.body)));
 const claims=await Promise.all(lastQuotes.map(q=>request('food/orders','POST',{branchId:branch,quoteId:q.body.id,priceVersion:q.body.priceVersion,idempotencyKey:randomUUID()},auth.body.accessToken)));
 check('Aggregate remaining-stock concurrency has exactly one winner',()=>assert.deepEqual(claims.map(r=>r.status).sort(),[200,409]));
 const persisted=await tenant(merchant,async db=>({product:(await db.query('SELECT stock,reserved FROM products WHERE merchant_id=$1 AND id=$2',[merchant,product])).rows[0],items:(await db.query('SELECT qty,unit_minor::text FROM order_items WHERE merchant_id=$1 AND order_id=$2',[merchant,one.order.id])).rows,orders:(await db.query('SELECT count(*)::integer AS n FROM order_configured_food WHERE merchant_id=$1',[merchant])).rows[0].n,devices:(await db.query('SELECT count(*)::integer AS n FROM devices WHERE merchant_id=$1',[merchant])).rows[0].n,payments:(await db.query('SELECT count(*)::integer AS n FROM payments WHERE merchant_id=$1',[merchant])).rows[0].n}));
 check('Variants reserve only real aggregate stock with no payment/device effect',()=>{assert.deepEqual(persisted.product,{stock:10,reserved:10});assert.deepEqual(persisted.items,[{qty:3,unit_minor:'270'}]);assert.equal(persisted.orders,2);assert.equal(persisted.devices,0);assert.equal(persisted.payments,0);});
 const maximumGroups=Array.from({length:10},()=>({id:randomUUID(),name:'ก'.repeat(80),nameEn:'😀'.repeat(40),enabled:true,minSelections:0,maxSelections:20,choices:Array.from({length:20},()=>({id:randomUUID(),name:'ข'.repeat(80),nameEn:'🧋'.repeat(40),enabled:true,maxQty:1,priceDelta:{currency:'USD' as const,decimals:2,amountMinor:'0'}}))}));
 const maximumOptions=await tenant(merchant,async db=>{await db.query('UPDATE products SET stock=100 WHERE merchant_id=$1 AND id=$2',[merchant,product]);return publishProductOptions(db,merchant,actor,'owner',product,{...publication,expectedRevision:'2',idempotencyKey:randomUUID(),groups:maximumGroups});});
 const maximumSelections=maximumGroups.flatMap(g=>g.choices.map(c=>({groupId:g.id,choiceId:c.id,qty:1})));
 const maximumDraft={branchId:branch,serving:'pickup',items:Array.from({length:50},()=>({lineId:randomUUID(),productId:product,qty:1,optionVersion:maximumOptions.version,selections:maximumSelections,allergyNote:'ค'.repeat(300)}))};
 const maximumQuote=await request('food/quotes','POST',maximumDraft,auth.body.accessToken);
 check('Actual HTTP admits50x200 Unicode configured selections above old ingress and response caps',()=>{assert.ok(Buffer.byteLength(JSON.stringify(maximumDraft))>1024*1024);assert.equal(maximumQuote.status,200,JSON.stringify(maximumQuote.body));const q=MobileFoodQuoteSchema.parse(maximumQuote.body);assert.equal(q.configured.lines.length,50);assert.equal(q.configured.lines.reduce((n,l)=>n+l.selections.length,0),10000);assert.equal(q.total.amountMinor,'13500');assert.ok(Buffer.byteLength(JSON.stringify(maximumQuote.body))>1024*1024);});
 const catalogIds=[product,...Array.from({length:499},()=>randomUUID())];
 const pagePricing=await tenant(merchant,async db=>{
  await db.query("UPDATE products SET sort_order=0 WHERE merchant_id=$1 AND id=$2",[merchant,product]);
  await db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock,sort_order,description) SELECT id,$1,'เมนูทดสอบ'||position::text,'Fixture product '||position::text,'',270,10,position,repeat('ก',10000) FROM unnest($2::uuid[]) WITH ORDINALITY AS x(id,position)",[merchant,catalogIds.slice(1)]);
  return publishPrices(db,merchant,actor,'owner',{expectedRevision:'1',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'500 PRODUCT LOCAL FIXTURE'},prices:catalogIds.map(productId=>({productId,unitMinor:'270'})),settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}});
 });
 const lastProduct=catalogIds[499];
 await tenant(merchant,db=>publishProductOptions(db,merchant,actor,'owner',lastProduct,{...publication,expectedRevision:'0',priceVersion:pagePricing.priceVersion,idempotencyKey:randomUUID()}));
 const menuIds:string[]=[],pageSizes:number[]=[];let pageCursor:string|null=null,menuVersion:string|undefined,firstCursor:string|null=null;
 do{
  const query=pageCursor===null?'':'?cursor='+pageCursor+'&menuVersion='+menuVersion,result=await request('branches/'+branch+'/menu'+query);assert.equal(result.status,200,JSON.stringify(result.body));
  const page=MobileMenuSchema.parse(result.body);menuVersion??=page.menuVersion;assert.equal(page.menuVersion,menuVersion);pageSizes.push(Buffer.byteLength(JSON.stringify(result.body)));assert.ok(pageSizes.at(-1)!<=900*1024);menuIds.push(...page.products.map(p=>p.id));pageCursor=page.nextCursor;firstCursor??=pageCursor;
  if(pageCursor===null)assert.equal(page.products.at(-1)!.options.groups[0].choices[0].nameEn,'Shot');
 }while(pageCursor!==null);
 check('All500 catalog products and last-page options reachable without duplicates below900KiB per page',()=>{assert.deepEqual(menuIds,catalogIds);assert.equal(new Set(menuIds).size,500);assert.ok(pageSizes.length>=17);});
 await tenant(merchant,db=>db.query("UPDATE products SET description='Changed fixture' WHERE merchant_id=$1 AND id=$2",[merchant,lastProduct]));
 const changedMenu=await request('branches/'+branch+'/menu?cursor='+firstCursor+'&menuVersion='+menuVersion);check('Menu continuation rejects changed catalog instead of mixing pages',()=>assert.equal(changedMenu.status,409));
 const receipt={environment:'local_disposable_fixture',merchantId:merchant,branchId:branch,productId:product,orderId:one.order.id,assertions:passed.length,passed,persisted,physicalTesting:'deferred_by_user_2026-10-16',limits:['Actual local HTTP and deferred PostgreSQL only; no AVD/browser configured-order evidence yet','No payment/provider/production operation']};await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-configured-food.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}catch(error){await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-configured-food-failure-'+Date.now()+'.json',JSON.stringify({merchantId:merchant,passed,error:String(error)},null,2)+'\n');throw error;}
finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await admin.end();await pool.end();}
