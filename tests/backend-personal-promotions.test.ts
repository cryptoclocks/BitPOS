import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {PersonalCampaignBinding} from '../packages/contracts/src/personal-promotions';
import type {EffectiveMenu} from '../apps/api/src/offers';
import {tableFixture} from './backend-table-fixture';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
// Runtime imports stay inside opt-in tests: no private config, provider or DB work when skipped.
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
async function personalFixture(){
 const f=await tableFixture(),personal=await import('../apps/api/src/personal-promotions'),{tableRequest}=await import('../apps/api/src/table-ordering');
 const entry=(await f.tenant(f.merchant,db=>db.query(`SELECT e.id,e.entry_token FROM table_entries e JOIN devices d ON d.merchant_id=e.merchant_id AND d.id=e.device_id
 WHERE e.merchant_id=$1 AND e.device_id=$2 AND e.assignment_generation=d.assignment_generation AND e.auth_generation=d.auth_generation`,[f.merchant,f.b.id]))).rows[0];
 async function visit(){
  const requestId=randomUUID();await tableRequest('/api/table/'+entry.entry_token+'/visit','POST',{requestId});
  return (await f.tenant(f.merchant,db=>db.query('SELECT id,access_token FROM table_visits WHERE merchant_id=$1 AND entry_id=$2 AND request_id=$3',[f.merchant,entry.id,requestId]))).rows[0] as {id:string;access_token:string};
 }
 async function acquire(v:{id:string;access_token:string}){
  await tableRequest('/api/table/'+entry.entry_token+'/visit/'+v.access_token+'/quotes','POST',{items:[{productId:f.product,qty:1}],confirmJoin:true});
  return (await f.tenant(f.merchant,db=>db.query('SELECT r.*,v.session_id FROM table_visit_recipients r JOIN table_visits v ON v.merchant_id=r.merchant_id AND v.id=r.visit_id WHERE r.merchant_id=$1 AND r.visit_id=$2',[f.merchant,v.id]))).rows[0];
 }
 async function release(v:{access_token:string}){await tableRequest('/api/table/'+entry.entry_token+'/visit/'+v.access_token+'/release','POST',{});}
 async function select(v:{id:string}){
  const customer=(await f.tenant(f.merchant,db=>db.query("INSERT INTO customers(merchant_id,name,phone,email,notes) VALUES($1,'Staff-recognized fixture','private-phone','private@example.invalid','private-notes') RETURNING id",[f.merchant]))).rows[0].id;
  const result=await f.tenant(f.merchant,db=>personal.personalPromotionContext(db,f.merchant,'customer',{tableId:f.table.id,occupancyGeneration:'1',recipientVisitId:v.id,customerId:customer,confirmRecipient:true}));
  return {customer,...result};
 }
 async function saveJob(binding:PersonalCampaignBinding,state:'QUEUED'|'RUNNING'='QUEUED'){
  const job=randomUUID();await f.tenant(f.merchant,async db=>{
   await db.query(`INSERT INTO ai_generation_jobs(merchant_id,id,actor_id,input,products,state,lease_id,lease_until,attempts,reserved_microusd)
   VALUES($1,$2,$3,'{}','[]',$4,CASE WHEN $4='RUNNING' THEN gen_random_uuid() ELSE NULL END,CASE WHEN $4='RUNNING' THEN clock_timestamp()+interval '1 minute' ELSE NULL END,CASE WHEN $4='RUNNING' THEN 1 ELSE 0 END,CASE WHEN $4='RUNNING' THEN 1000 ELSE 0 END)`,[f.merchant,job,f.actor,state]);
   await personal.savePersonalJobBinding(db,f.merchant,job,binding);
  });return job;
 }
 return {...f,personal,entry,visit,acquire,release,select,saveJob};
}
test('advisory scan/proof is inert; acquired visitors remain separate and public QR cannot continue a private recipient',integration,async()=>{
 const f=await personalFixture(),one=await f.visit();
 await f.tenant(f.merchant,db=>f.personal.rememberVisitRecipientProof(db,f.merchant,one.id,{}));
 const inert=(await f.tenant(f.merchant,db=>db.query('SELECT (SELECT count(*)::int FROM table_occupancies WHERE merchant_id=$1) AS groups,(SELECT count(*)::int FROM table_occupancy_recipients WHERE merchant_id=$1) AS recipients',[f.merchant]))).rows[0];
 assert.deepEqual(inert,{groups:0,recipients:0});
 await assert.rejects(()=>f.tenant(f.merchant,db=>f.personal.bindVisitRecipient(db,f.merchant,one.id,{})),/TABLE_OCCUPANCY_CHANGED/);
 const a=await f.acquire(one);assert.ok(a?.recipient_id);await f.release(one);
 const two=await f.visit();
 await assert.rejects(()=>f.tenant(f.merchant,db=>f.personal.rememberVisitRecipientProof(db,f.merchant,two.id,{sourceVisitToken:f.entry.entry_token})),/TABLE_OCCUPANCY_CHANGED/);
 const b=await f.acquire(two);assert.equal(b.occupancy_id,a.occupancy_id);assert.notEqual(b.recipient_id,a.recipient_id);
 await assert.rejects(()=>f.tenant(f.merchant,db=>db.query('UPDATE table_visit_recipients SET recipient_id=$3 WHERE merchant_id=$1 AND visit_id=$2',[f.merchant,two.id,a.recipient_id])),/permission denied|immutable authority record/);
});
test('explicit staff relationship is tenant-bound, not wallet proof, immutable; current-order-only refuses an unpaid source',integration,async()=>{
 const f=await personalFixture(),v=await f.visit();await f.acquire(v);const selected=await f.select(v);
 assert.equal(selected.context.historyBasis,'staff_confirmed_profile');assert.equal(selected.binding.originBasis,'staff_recognition');assert.equal(selected.binding.customerAuthSessionId,null);
 assert.deepEqual(selected.context.items,[]);assert.deepEqual(selected.excludedProductIds,[]);
 const encoded=JSON.stringify(selected.context);for(const privateValue of ['Staff-recognized','private-phone','private@example.invalid','private-notes',selected.customer])assert.equal(encoded.includes(privateValue),false);
 const discovery=await f.tenant(f.merchant,db=>f.personal.personalRecipientsView(db,f.merchant));assert.equal(discovery.tables[0].guests[0].recognition,'staff_confirmed_profile');assert.equal(discovery.tables[0].guests[0].customerId,selected.customer);
 const other=(await f.tenant(f.other,db=>db.query('INSERT INTO customers(merchant_id) VALUES($1) RETURNING id',[f.other]))).rows[0].id;
 await assert.rejects(()=>f.tenant(f.merchant,db=>f.personal.personalPromotionContext(db,f.merchant,'customer',{tableId:f.table.id,occupancyGeneration:'1',recipientVisitId:v.id,customerId:other,confirmRecipient:true})),/RESOURCE_NOT_FOUND/);
 const replacement=(await f.tenant(f.merchant,db=>db.query('INSERT INTO customers(merchant_id) VALUES($1) RETURNING id',[f.merchant]))).rows[0].id;
 await assert.rejects(()=>f.tenant(f.merchant,db=>f.personal.personalPromotionContext(db,f.merchant,'customer',{tableId:f.table.id,occupancyGeneration:'1',recipientVisitId:v.id,customerId:replacement,confirmRecipient:true})),/WALLET_CONFLICT/);
 await assert.rejects(()=>f.tenant(f.merchant,db=>f.personal.personalPromotionContext(db,f.merchant,'from_order',{tableId:f.table.id,occupancyGeneration:'1',recipientVisitId:v.id,sourceOrderId:randomUUID(),confirmRecipient:true})),/PROMOTION_OFFER_INVALID/);
});
test('clear fences queued/running work, preserves unknown provider budget, and cannot silently rebind a stale visit',integration,async()=>{
 const f=await personalFixture(),v=await f.visit();await f.acquire(v);const {binding}=await f.select(v),queued=await f.saveJob(binding),running=await f.saveJob(binding,'RUNNING');
 await f.tenant(f.merchant,db=>f.personal.guardPersonalJob(db,f.merchant,running));
 await f.tenant(f.merchant,async db=>{
  await f.personal.cancelPersonalTable(db,f.merchant,f.table.id,'1');
  await db.query("UPDATE table_occupancies SET closed_at=clock_timestamp(),close_reason='STAFF_CLEAR' WHERE merchant_id=$1 AND id=$2",[f.merchant,binding.occupancyId]);
  await db.query('UPDATE merchant_tables SET occupancy_generation=2 WHERE merchant_id=$1 AND id=$2',[f.merchant,f.table.id]);
 });
 const jobs=(await f.tenant(f.merchant,db=>db.query('SELECT id,state,blocker,attempts,reserved_microusd::text FROM ai_generation_jobs WHERE merchant_id=$1 ORDER BY attempts',[f.merchant]))).rows;
 assert.deepEqual(jobs,[{id:queued,state:'FAILED',blocker:'TABLE_CLEARED',attempts:0,reserved_microusd:'0'},{id:running,state:'FAILED',blocker:'TABLE_CLEARED_PROVIDER_OUTCOME_UNKNOWN',attempts:1,reserved_microusd:'1000'}]);
 await assert.rejects(()=>f.tenant(f.merchant,db=>f.personal.guardPersonalJob(db,f.merchant,running)),/PROMOTION_TARGET_CHANGED/);
 await assert.rejects(()=>f.tenant(f.merchant,db=>f.personal.bindVisitRecipient(db,f.merchant,v.id,{})),/TABLE_OCCUPANCY_CHANGED/);
 assert.deepEqual(await f.tenant(f.merchant,db=>f.personal.personalCampaignBinding(db,f.merchant,running)),binding,'clear retains immutable private history');
 await f.tenant(f.merchant,db=>f.personal.cancelPersonalTable(db,f.merchant,f.table.id,'1'));
});
test('approved but unrendered personal target requires exact acquired recipient and beats daily/global price plus minimum',integration,async()=>{
 const f=await personalFixture(),v=await f.visit(),recipient=await f.acquire(v),{binding}=await f.select(v),job=await f.saveJob(binding);
 const campaign=randomUUID(),target=randomUUID(),expiry=new Date(Date.now()+3600000).toISOString(),base={currency:'USD' as const,decimals:2 as const,amountMinor:'270'};
 const content={discountPercent:20,snapshot:{productId:f.product,priceVersion:f.pricing.priceVersion,basePrice:base,effectivePrice:base,imageUrl:null,stock:100}};
 await f.tenant(f.merchant,async db=>{
  await db.query(`INSERT INTO promotion_campaigns(merchant_id,id,job_id,product_id,headline,copy,rationale,discount_percent,max_discount_percent,snapshot,starts_at,expires_at,provenance,state,approved_version)
  VALUES($1,$2,$3,$4,'Fixture','Fixture','No provider called',20,20,$5,clock_timestamp()-interval '1 second',$6,'{}','APPROVED',1)`,[f.merchant,campaign,job,f.product,content.snapshot,expiry]);
  await db.query('INSERT INTO promotion_revisions(merchant_id,campaign_id,version,content,approved_by) VALUES($1,$2,1,$3,$4)',[f.merchant,campaign,content,f.actor]);
  await db.query("INSERT INTO promotion_scopes VALUES($1,$2,'customer',$3,200)",[f.merchant,campaign,{kind:'customer',items:[],currentOrderItems:[],historyIncluded:true,historyBasis:'staff_confirmed_profile'}]);
  await db.query(`INSERT INTO promotion_playlist_targets(merchant_id,id,campaign_id,campaign_version,audience,target_device_id,assignment_generation,auth_generation,table_id,occupancy_id,occupancy_generation,recipient_id,expires_at)
  VALUES($1,$2,$3,1,'personal',$4,$5,$6,$7,$8,$9,$10,$11)`,[f.merchant,target,campaign,binding.targetDeviceId,binding.assignmentGeneration,binding.authGeneration,binding.tableId,binding.occupancyId,binding.occupancyGeneration,binding.recipientId,expiry]);
 });
 const {effectiveCatalog}=await import('../apps/api/src/catalog');const menu=await f.tenant(f.merchant,db=>effectiveCatalog(db,f.merchant));
 const personal=await f.tenant(f.merchant,db=>f.personal.personalPromotionMenu(db,f.merchant,menu,recipient.session_id));
 assert.equal(personal.products[0].unitPrice?.amountMinor,'216');assert.equal(personal.products[0].personalPromotion?.targetId,target);assert.equal(personal.products[0].promotion,null);assert.equal(personal.products[0].dailyPromotion,undefined);
 assert.deepEqual(await f.tenant(f.merchant,db=>f.personal.personalPromotionMenu(db,f.merchant,menu,null)),menu);
 assert.deepEqual(await f.tenant(f.merchant,db=>f.personal.personalPromotionMenu(db,f.merchant,menu,randomUUID())),menu);
 const lower:EffectiveMenu={...menu,products:menu.products.map(p=>({...p,unitPrice:{...base,amountMinor:'210'}}))};
 assert.deepEqual(await f.tenant(f.merchant,db=>f.personal.personalPromotionMenu(db,f.merchant,lower,recipient.session_id)),lower);
 await f.release(v);const other=await f.visit(),otherRecipient=await f.acquire(other);
 const denied=await f.tenant(f.merchant,db=>f.personal.personalPromotionMenu(db,f.merchant,menu,otherRecipient.session_id));assert.deepEqual(denied,menu);
 await f.release(other);
 const minimumJob=await f.saveJob(binding),minimumCampaign=randomUUID(),minimumTarget=randomUUID();
 await f.tenant(f.merchant,async db=>{
  await db.query("UPDATE promotion_playlist_targets SET state='REVOKED' WHERE merchant_id=$1 AND id=$2",[f.merchant,target]);
  await db.query(`INSERT INTO promotion_campaigns(merchant_id,id,job_id,product_id,headline,copy,rationale,discount_percent,max_discount_percent,snapshot,starts_at,expires_at,provenance,state,approved_version)
  SELECT merchant_id,$3,$4,product_id,headline,copy,rationale,discount_percent,max_discount_percent,snapshot,starts_at,expires_at,provenance,state,approved_version
  FROM promotion_campaigns WHERE merchant_id=$1 AND id=$2`,[f.merchant,campaign,minimumCampaign,minimumJob]);
  await db.query('INSERT INTO promotion_revisions(merchant_id,campaign_id,version,content,approved_by) VALUES($1,$2,1,$3,$4)',[f.merchant,minimumCampaign,content,f.actor]);
  await db.query("INSERT INTO promotion_scopes SELECT merchant_id,$3,audience,context,220 FROM promotion_scopes WHERE merchant_id=$1 AND campaign_id=$2",[f.merchant,campaign,minimumCampaign]);
  await db.query(`INSERT INTO promotion_playlist_targets(merchant_id,id,campaign_id,campaign_version,audience,target_device_id,assignment_generation,auth_generation,table_id,occupancy_id,occupancy_generation,recipient_id,expires_at)
  VALUES($1,$2,$3,1,'personal',$4,$5,$6,$7,$8,$9,$10,$11)`,[f.merchant,minimumTarget,minimumCampaign,binding.targetDeviceId,binding.assignmentGeneration,binding.authGeneration,binding.tableId,binding.occupancyId,binding.occupancyGeneration,binding.recipientId,expiry]);
 });
 const resumed=await f.acquire(v);
 assert.deepEqual(await f.tenant(f.merchant,db=>f.personal.personalPromotionMenu(db,f.merchant,menu,resumed.session_id)),menu,'216 is below the configured minimum of 220');
});
test('verified continuation stays in the current group, never swaps another guest customer, and revoked pending auth cannot claim',integration,async()=>{
 const f=await personalFixture(),original=await f.visit(),first=await f.acquire(original),selected=await f.select(original);await f.release(original);
 const counter=await f.create(await f.quote());
 // Explicit synthetic persisted-auth fixture tests recipient/consent boundaries, not wallet signature verification.
 // Private config cannot be statically imported while integration tests are skipped.
 const {customerOrigin}=await import('../apps/api/src/config');
 async function auth(customer:string,wallet:string){
  const token=randomBytes(32).toString('base64url'),session=randomUUID(),challenge=randomUUID();
  await f.tenant(f.merchant,async db=>{
   await db.query('INSERT INTO customer_wallets(merchant_id,customer_id,address) VALUES($1,$2,$3)',[f.merchant,customer,wallet]);
   await db.query(`INSERT INTO customer_auth_challenges(merchant_id,id,order_id,wallet_address,origin,order_context,nonce,issued_at,expires_at,consent_version,message,consumed_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()-interval '2 seconds',clock_timestamp()+interval '2 minutes','bitpos-personal-offers-v1','Synthetic persisted auth fixture',clock_timestamp()-interval '1 second')`,[f.merchant,challenge,counter.order.id,wallet,customerOrigin,{orderId:counter.order.id},randomBytes(32).toString('base64url')]);
   await db.query(`INSERT INTO customer_auth_sessions(merchant_id,id,challenge_id,customer_id,wallet_address,origin,token_hash,consent_version,consent_profile,consent_purchase_history,expires_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,'bitpos-personal-offers-v1',true,true,clock_timestamp()+interval '1 day')`,[f.merchant,session,challenge,customer,wallet,customerOrigin,createHash('sha256').update(token).digest('hex')]);
  });return {token,session};
 }
 const known=await auth(selected.customer,'11111111111111111111111111111111'),next=await f.visit();
 await f.tenant(f.merchant,db=>f.personal.rememberVisitRecipientProof(db,f.merchant,next.id,{customerSessionToken:known.token}));
 const continuation=await f.acquire(next);assert.equal(continuation.recipient_id,first.recipient_id);assert.equal(continuation.occupancy_id,first.occupancy_id);await f.release(next);
 const newcomer=(await f.tenant(f.merchant,db=>db.query('INSERT INTO customers(merchant_id) VALUES($1) RETURNING id',[f.merchant]))).rows[0].id;
 const fresh=await auth(newcomer,'11111111111111111111111111111112'),different=await f.visit();
 await f.tenant(f.merchant,db=>f.personal.rememberVisitRecipientProof(db,f.merchant,different.id,{customerSessionToken:fresh.token}));
 const separate=await f.acquire(different);assert.notEqual(separate.recipient_id,first.recipient_id);
 const profiles=(await f.tenant(f.merchant,db=>db.query('SELECT recipient_id,customer_id FROM table_recipient_profiles WHERE merchant_id=$1',[f.merchant]))).rows;
 assert.equal(profiles.find(p=>p.recipient_id===first.recipient_id)?.customer_id,selected.customer);
 assert.equal(profiles.find(p=>p.recipient_id===separate.recipient_id)?.customer_id,newcomer);
 const originalOrder=(await f.tenant(f.merchant,db=>db.query('SELECT customer_id,payer,request_hash,usdg_minor FROM orders WHERE merchant_id=$1 AND id=$2',[f.merchant,counter.order.id]))).rows[0];
 await f.tenant(f.merchant,db=>f.personal.bindOrderCustomer(db,f.merchant,counter.order.id,known.token));
 await assert.rejects(()=>f.tenant(f.merchant,db=>f.personal.bindOrderCustomer(db,f.merchant,counter.order.id,fresh.token)),/WALLET_CONFLICT/);
 assert.deepEqual((await f.tenant(f.merchant,db=>db.query('SELECT customer_id,payer,request_hash,usdg_minor FROM orders WHERE merchant_id=$1 AND id=$2',[f.merchant,counter.order.id]))).rows[0],originalOrder);
 await f.release(different);const pending=await f.visit();
 await f.tenant(f.merchant,db=>f.personal.rememberVisitRecipientProof(db,f.merchant,pending.id,{customerSessionToken:fresh.token}));
 await f.tenant(f.merchant,db=>db.query('UPDATE customer_auth_sessions SET revoked_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2',[f.merchant,fresh.session]));
 await assert.rejects(()=>f.acquire(pending),/TABLE_OCCUPANCY_CHANGED/);
 assert.equal((await f.tenant(f.merchant,db=>db.query('SELECT count(*)::int AS n FROM table_visit_recipients WHERE merchant_id=$1 AND visit_id=$2',[f.merchant,pending.id]))).rows[0].n,0);
});
