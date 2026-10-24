import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Keypair} from '@solana/web3.js';
import {ed25519} from '@noble/curves/ed25519';
import bs58 from 'bs58';
import type {OrderView,Quote,PromotionCampaign,PromotionGenerate,PromotionJob} from '../packages/contracts/src/index';
import type {PersonalTargetInput,PromotionRecipientsView} from '../packages/contracts/src/personal-promotions';
import type {CustomerAuthChallenge,CustomerAuthVerification} from '../packages/contracts/src/customer-auth';
import type {EffectiveMenu} from '../apps/api/src/offers';
import type {PromotionProviderInput} from '../apps/api/src/promotion-provider';
import type {AttemptRow} from '../apps/api/src/types';
import {promotionFixture} from './backend-promotions-fixture';
import {fixturePaymentAttempt} from './backend-payment-fixture';
import {success} from './backend-table-fixture';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1',timeout:180000};
// Opt-in HTTP/API/worker fixtures only, migrated through 040 and run serially.
// Structured provider responses and SQL verifier facts are explicit fixtures,
// never real AI/chain evidence. Native Ed25519 proves only message authentication.
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});
type Guest={id:string;token:string;base:string};
type ApiError={error:{code:string}};
async function personalHttpFixture(){
 const f=await promotionFixture(),addon=randomUUID(),{publishPrices}=await import('../apps/api/src/catalog'),{runPromotionJob}=await import('../apps/worker/src/promotions');
 await f.inspect("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock,image_url) VALUES($1,$2,'ขนม','Add-on','',3500,20,'/images/menu/espresso.jpg')",[addon,f.merchant]);
 await f.tenant(f.merchant,db=>publishPrices(db,f.merchant,f.actor,'owner',{...f.configuration,expectedRevision:f.pricing.revision,prices:[{productId:f.product,unitMinor:'270'},{productId:addon,unitMinor:'270'}]}));
 // Nonempty paused permission detects accidental changes to payment authority.
 // It deliberately claims no SPL approval or usable delegate key.
 await f.inspect("INSERT INTO delegated_owner_sessions(merchant_id,owner,domain,token_hash,expires_at) VALUES($1,'SQL-only-personal-owner','https://fixture.invalid',$2,clock_timestamp()+interval '1 hour')",[f.merchant,randomUUID()]);
 await f.inspect("INSERT INTO delegated_grants(merchant_id,id,policy,policy_hash,owner,source_ata,delegate,status,spent,reserved) VALUES($1,$2,$3,'SQL-only-personal-policy','SQL-only-personal-owner',$4,$5,'PAUSED',7,0)",[f.merchant,randomUUID(),{totalMinor:'100',label:'PERSONAL TEST FIXTURE; NO CHAIN APPROVAL'},randomUUID(),randomUUID()]);
 const entry=await f.entry(),entryBase='/api/table/'+entry;
 async function visit(proof:{sourceVisitToken?:string;customerSessionToken?:string}={}):Promise<Guest>{
  const result=await f.ok<{visitToken:string}>(entryBase+'/visit',{requestId:randomUUID(),...proof},null);
  const row=(await f.inspect('SELECT id FROM table_visits WHERE merchant_id=$1 AND access_token=$2',[f.merchant,result.visitToken])).rows[0];
  return {id:row.id,token:result.visitToken,base:entryBase+'/visit/'+result.visitToken};
 }
 async function quote(v:Guest,product=addon,qty=1){return (await f.ok<{quote:Quote}>(v.base+'/quotes',{items:[{productId:product,qty}],confirmJoin:true},null)).quote;}
 async function release(v:Guest){await f.ok(v.base+'/release',{},null);}
 function orderInput(q:Quote){return {quoteId:q.id,priceVersion:q.priceVersion,idempotencyKey:randomUUID()};}
 async function create(v:Guest,q:Quote){const input=orderInput(q);return {...await f.ok<{order:OrderView;replayed:boolean}>(v.base+'/orders',input,null),input};}
 async function paidAndDismiss(v:Guest,order:OrderView,existingAttempt?:AttemptRow){
  const {settleAttempt}=await import('../apps/api/src/orders');
  const attempt=existingAttempt??await f.tenant(f.merchant,async db=>(await fixturePaymentAttempt(db,{merchant:f.merchant,order:order.id,status:'SUBMITTED',signature:'SQL-only-personal-'+randomUUID()})).rows[0]);
  assert.ok(attempt,'canonical selected payment asset is frozen by the existing fixture seam');
  await f.tenant(f.merchant,db=>settleAttempt(db,attempt,true));
  const facts=(await f.inspect('SELECT o.status,p.state,a.status AS attempt_status FROM orders o JOIN payments p ON p.merchant_id=o.merchant_id AND p.order_id=o.id JOIN payment_attempts a ON a.merchant_id=p.merchant_id AND a.id=p.attempt_id WHERE o.merchant_id=$1 AND o.id=$2',[f.merchant,order.id])).rows;
  assert.deepEqual(facts,[{status:'PAID',state:'SETTLED',attempt_status:'FINALIZED'}]);
  const event=(await f.inspect('SELECT * FROM outbox_events WHERE merchant_id=$1 AND order_id=$2 ORDER BY device_seq DESC LIMIT 1',[f.merchant,order.id])).rows[0];assert.ok(event);
  await f.inspect('INSERT INTO device_event_deliveries(merchant_id,device_id,event_id,device_seq,connection_generation) VALUES($1,$2,$3,$4,$5)',[f.merchant,f.b.id,event.id,event.device_seq,f.devices.get(f.b.id)!.connectionGeneration]);
  success(await f.command(f.b.id,{type:'ACK',eventId:event.id,deviceSeq:String(event.device_seq),orderId:order.id,orderVersion:event.order_version,screenGeneration:String(event.screen_generation),rendered:true}));
  await f.ok(v.base+'/dismiss',{},null);
 }
 async function source(){const v=await visit(),q=await quote(v,f.product),created=await create(v,q);return {v,q,...created};}
 function personal(v:Guest,extra:Pick<PersonalTargetInput,'customerId'|'sourceOrderId'>):PersonalTargetInput{return {tableId:f.table.id,occupancyGeneration:'1',recipientVisitId:v.id,confirmRecipient:true,...extra};}
 function generation(target:PersonalTargetInput,audience:'customer'|'from_order'):PromotionGenerate{
  const {daily,...input}=f.input;return {...input,productIds:[addon],audience,personal:target,maxDiscountPercent:30,idempotencyKey:randomUUID()};
 }
 let calls=0;
 async function enqueue(target:PersonalTargetInput,audience:'customer'|'from_order'){
  return (await f.ok<{job:PromotionJob}>('/api/promotions/generate',generation(target,audience))).job;
 }
 async function run(discountPercent=20,observe?:(input:PromotionProviderInput)=>void){
  await runPromotionJob(f.merchant,{kind:'fixture_provider',configuration:f.config,provider:async input=>{
   calls++;observe?.(input);assert.equal(input.minimumUnitMinor,'1');
   return {kind:'fixture_provider',provider:new URL(f.config.url).origin,model:f.config.model,requestId:'personal-fixture-'+input.jobId,candidate:{productId:addon,headline:'Add-on for this visit',copy:'Explicit structured fixture',discountPercent,rationale:'Fixture only, not a real model'}};
  }});
 }
 async function generate(target:PersonalTargetInput,audience:'customer'|'from_order',observe?:(input:PromotionProviderInput)=>void){
  const job=await enqueue(target,audience);await run(20,observe);const finished=(await f.ok<{job:PromotionJob}>('/api/promotions/jobs/'+job.id)).job;
  assert.equal(finished.state,'SUCCEEDED');assert.equal(finished.provenance?.kind,'fixture_provider');assert.ok(finished.campaignId);return f.campaign(finished.campaignId);
 }
 async function batch(c:PromotionCampaign){const input=await f.batch(c);return {...input,targets:input.targets.filter(t=>t.deviceId===f.b.id)};}
 async function publish(c:PromotionCampaign){return (await f.ok<{campaign:PromotionCampaign}>('/api/promotions/'+c.id+'/publish',await batch(c))).campaign;}
 async function denied(path:string,input:unknown,codes:string[],token:string|null=null){const result=await f.request<ApiError>(path,input,token);assert.ok(result.status>=400,JSON.stringify(result));assert.ok(codes.includes(result.value.error.code),JSON.stringify(result));}
 async function auth(order:OrderView){
  const {customerOrigin}=await import('../apps/api/src/config'),seed=randomBytes(32),wallet=Keypair.fromSeed(seed).publicKey.toBase58();
  const access=(await f.inspect('SELECT access_token FROM orders WHERE merchant_id=$1 AND id=$2',[f.merchant,order.id])).rows[0].access_token,path='/api/pay/'+access+'/customer/';
  async function request<T>(operation:string,input:unknown){const response=await fetch(f.origin+path+operation,{method:'POST',headers:{Origin:customerOrigin,'Content-Type':'application/json'},body:JSON.stringify(input)});const value=await response.json() as T;assert.equal(response.status,200,JSON.stringify(value));return value;}
  const challenge=await request<CustomerAuthChallenge>('challenge',{walletAddress:wallet});
  const identity=await request<CustomerAuthVerification>('verify',{challengeId:challenge.challengeId,walletAddress:wallet,signature:bs58.encode(ed25519.sign(new TextEncoder().encode(challenge.message),seed)),consent:{version:challenge.consentVersion,profile:true,purchaseHistory:true}});seed.fill(0);
  return {...identity,revoke:()=>request('revoke',{sessionToken:identity.sessionToken})};
 }
 async function financial(){
  const result:Record<string,unknown>={};
  // Constant identifiers, isolated random merchant: compare real rows, not counts.
  for(const table of ['orders','order_items','order_authority','order_line_prices','payments','payment_attempts','payment_attempt_assets','payment_quotes','order_payment_selection','products','delegated_grants','delegated_owner_sessions'])result[table]=(await f.inspect(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) AS rows FROM ${table} r WHERE merchant_id=$1`,[f.merchant])).rows[0].rows;
  result.original_quotes=(await f.inspect("SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]'::jsonb) AS rows FROM order_quotes q JOIN order_authority a ON a.merchant_id=q.merchant_id AND a.quote_id=q.id WHERE q.merchant_id=$1",[f.merchant])).rows[0].rows;
  return result;
 }
 async function frozenQuote(q:Quote){return {quote:(await f.inspect('SELECT to_jsonb(q) AS row FROM order_quotes q WHERE merchant_id=$1 AND id=$2',[f.merchant,q.id])).rows[0].row,promotions:(await f.inspect('SELECT * FROM personal_quote_promotions WHERE merchant_id=$1 AND quote_id=$2 ORDER BY product_id',[f.merchant,q.id])).rows};}
 return {...f,addon,entry,entryBase,visit,quote,release,orderInput,create,paidAndDismiss,source,personal,generation,enqueue,run,generate,batch,publish,denied,auth,financial,frozenQuote,calls:()=>calls,quoteCounter:f.quote,createCounter:f.create,generateDaily:()=>f.generate({productIds:[addon],maxDiscountPercent:30}),publishDaily:f.publish};
}

test('staff selects a known profile through HTTP; reviewed personal publication targets only its original screen and active recipient, not a verified wallet',integration,async()=>{
 const f=await personalHttpFixture();try{
  const source=await f.source();await f.paidAndDismiss(source.v,source.order);
  const customer=(await f.inspect('SELECT customer_id FROM orders WHERE merchant_id=$1 AND id=$2',[f.merchant,source.order.id])).rows[0].customer_id;
  await f.inspect("UPDATE customers SET name='Recognized private fixture',phone='private-phone',email='private@example.invalid',notes='private-notes' WHERE merchant_id=$1 AND id=$2",[f.merchant,customer]);
  const target=f.personal(source.v,{customerId:customer}),before=await f.financial();
  const draft=await f.generate(target,'customer',input=>{
   assert.deepEqual(input.context?.kind,'customer');assert.ok(input.context&&input.context.kind==='customer');
   assert.equal(input.context.historyBasis,'staff_confirmed_profile');assert.equal(input.context.historyIncluded,true);assert.deepEqual(input.context.currentOrderItems,[]);
   assert.deepEqual(input.context.items.map(i=>({productId:i.productId,quantity:i.quantity})),[{productId:f.product,quantity:1}]);
   for(const secret of [customer,'Recognized private fixture','private-phone','private@example.invalid','private-notes'])assert.equal(JSON.stringify(input).includes(secret),false);
  });
  assert.equal(draft.state,'DRAFT');assert.deepEqual(draft.playlistTargets,[]);
  const recipients=await f.ok<PromotionRecipientsView>('/api/promotions/recipients');assert.equal(recipients.tables[0].guests.find(g=>g.visitId===source.v.id)?.recognition,'staff_confirmed_profile');
  assert.equal(draft.scope?.binding?.originBasis,'staff_recognition');assert.equal(draft.scope?.binding?.customerAuthSessionId,null);
  await f.denied('/api/promotions/'+draft.id+'/approve',{expectedVersion:draft.version,idempotencyKey:randomUUID()},['ROLE_REQUIRED'],f.staff);
  const approved=await f.approve(draft),beforePublication=await f.visit({sourceVisitToken:source.v.token}),privateDraft=await f.quote(beforePublication);
  assert.equal(privateDraft.total.amountMinor,'270');assert.equal(privateDraft.lines[0].personalPromotion,undefined);await f.release(beforePublication);
  const request=await f.batch(approved);
  await f.denied('/api/promotions/'+approved.id+'/publish',{...request,targets:request.targets.map(t=>({...t,deviceId:f.a.id}))},['PROMOTION_TARGET_CHANGED'],f.owner);
  const exact=await f.batch(approved),stale={...exact,targets:exact.targets.map(t=>({...t,screenGeneration:String(BigInt(t.screenGeneration)+1n)}))};
  await f.denied('/api/promotions/'+approved.id+'/publish',stale,['PROMOTION_TARGET_CHANGED'],f.owner);
  assert.deepEqual((await f.campaign(approved.id)).playlistTargets,[],'denied publication creates no partial recipient target');
  const sent=await f.publish(approved);assert.deepEqual(sent.playlistTargets?.map(t=>({deviceId:t.deviceId,audience:t.audience,campaignVersion:t.campaignVersion})),[{deviceId:f.b.id,audience:'personal',campaignVersion:approved.version}]);
  assert.equal((await f.ok<{menu:EffectiveMenu}>(f.entryBase,undefined,null)).menu.products.find(p=>p.id===f.addon)?.unitPrice?.amountMinor,'270');
  const next=await f.visit({sourceVisitToken:source.v.token}),q=await f.quote(next);assert.equal(q.total.amountMinor,'216');assert.equal(q.lines[0].personalPromotion?.recipientId,draft.scope?.binding?.recipientId);
  await f.release(next);assert.deepEqual(await f.financial(),before,'staff recognition/model/publication/quote never rewrites the original bill, settlement, stock or payment permission');
 }finally{await f.close();}
});

test('from-order requires finalized settlement, excludes the purchased product, and private guest continuation alone redeems a qty-one recipient revision exactly once',integration,async()=>{
 const f=await personalHttpFixture();try{
  const source=await f.source(),target=f.personal(source.v,{sourceOrderId:source.order.id});
  await f.denied('/api/promotions/generate',f.generation(target,'from_order'),['PROMOTION_OFFER_INVALID'],f.owner);
  const {settleAttempt}=await import('../apps/api/src/orders');
  const attempt=await f.tenant(f.merchant,async db=>(await fixturePaymentAttempt(db,{merchant:f.merchant,order:source.order.id,status:'SUBMITTED',signature:'SQL-only-confirmed-'+randomUUID()})).rows[0]);assert.ok(attempt);
  await f.tenant(f.merchant,db=>settleAttempt(db,attempt,false));
  await f.denied('/api/promotions/generate',f.generation(target,'from_order'),['PROMOTION_OFFER_INVALID'],f.owner);
  // Finalize the SAME synthetic verifier fact, then ACK/dismiss via the real public lifecycle.
  await f.paidAndDismiss(source.v,source.order,attempt);
  await f.denied('/api/promotions/generate',{...f.generation(target,'from_order'),productIds:[f.product,f.addon]},['PROMOTION_REVIEW_REQUIRED'],f.owner);
  const draft=await f.generate(target,'from_order',input=>{
   assert.ok(input.context?.kind==='from_order');assert.equal(input.context.historyBasis,'current_order_only');assert.equal(input.context.historyIncluded,false);assert.deepEqual(input.context.items,[]);assert.deepEqual(input.context.currentOrderItems,[{productId:f.product,quantity:1}]);assert.deepEqual(input.products.map(p=>p.productId),[f.addon]);
  }),approved=await f.approve(draft),sent=await f.publish(approved),binding=draft.scope?.binding;assert.ok(binding);
  assert.equal(binding.originBasis,'private_paid_visit');assert.deepEqual(binding.excludedProductIds,[f.product]);assert.equal(binding.sourceOrderId,source.order.id);
  const originalPricing=(await f.ok<OrderView>('/api/orders/'+source.order.id)).pricing;
  assert.equal(originalPricing.total.amountMinor,'270');assert.equal(originalPricing.lines[0].personalPromotion,undefined);
  const counter=await f.createCounter(await f.quoteCounter()),newWallet=await f.auth(counter.order);
  const strangers:Guest[]=[];
  for(const proof of [{},{customerSessionToken:newWallet.sessionToken}]){
   const unrelated=await f.visit(proof),q=await f.quote(unrelated);assert.equal(q.total.amountMinor,'270');assert.equal(q.lines[0].personalPromotion,undefined);
   strangers.push(unrelated);
   await f.denied('/api/promotions/generate',f.generation(f.personal(unrelated,{sourceOrderId:source.order.id}),'from_order'),['PROMOTION_OFFER_INVALID'],f.owner);await f.release(unrelated);
  }
  const before=await f.financial();
  await f.denied(f.entryBase+'/visit',{requestId:randomUUID(),sourceVisitToken:f.entry},['TABLE_OCCUPANCY_CHANGED']);
  assert.deepEqual(await f.financial(),before);
  const publicMenu=await f.ok<{menu:EffectiveMenu}>(f.entryBase,undefined,null);assert.equal(publicMenu.menu.products.find(p=>p.id===f.addon)?.personalPromotion,undefined);
  const registerQuote=await f.ok<Quote>('/api/registers/'+f.register.id+'/quotes',{items:[{productId:f.addon,qty:1}],serving:{kind:'counter'}});assert.equal(registerQuote.total.amountMinor,'270');
  const next=await f.visit({sourceVisitToken:source.v.token}),q=await f.quote(next),evidence=q.lines[0].personalPromotion;assert.ok(evidence);
  assert.equal(q.total.amountMinor,'216');assert.equal(q.lines[0].qty,1);assert.equal(q.lines[0].promotion,null);assert.equal(q.lines[0].dailyPromotion,undefined);assert.equal(q.lines[0].scopedPromotion,undefined);
  assert.equal(evidence.recipientId,binding.recipientId);assert.equal(evidence.occupancyId,binding.occupancyId);assert.equal(evidence.occupancyGeneration,'1');assert.equal(evidence.campaignVersion,approved.version);
  const protectedFinance=await f.financial();for(const stranger of strangers)await f.denied(stranger.base+'/orders',f.orderInput(q),['QUOTE_CHANGED']);assert.deepEqual(await f.financial(),protectedFinance,'an unrelated visit cannot submit the recipient quote');
  await f.denied(next.base+'/quotes',{items:[{productId:f.addon,qty:2}],confirmJoin:true},['PROMOTION_LIMIT_EXCEEDED']);
  const created=await f.create(next,q);assert.equal(created.order.pricing.total.amountMinor,'216');assert.deepEqual(created.order.pricing.lines,q.lines);
  for(const [table,idColumn,id] of [['personal_quote_promotions','quote_id',q.id],['personal_order_promotions','order_id',created.order.id]] as const){
   const rows=(await f.inspect(`SELECT product_id,target_id,campaign_id,campaign_version,recipient_id,evidence FROM ${table} WHERE merchant_id=$1 AND ${idColumn}=$2`,[f.merchant,id])).rows;
   assert.deepEqual(rows,[{product_id:f.addon,target_id:evidence.targetId,campaign_id:approved.id,campaign_version:approved.version,recipient_id:binding.recipientId,evidence}]);
   await assert.rejects(()=>f.inspect(`UPDATE ${table} SET evidence='{}' WHERE merchant_id=$1 AND ${idColumn}=$2`,[f.merchant,id]));
   assert.deepEqual((await f.inspect(`SELECT product_id,target_id,campaign_id,campaign_version,recipient_id,evidence FROM ${table} WHERE merchant_id=$1 AND ${idColumn}=$2`,[f.merchant,id])).rows,rows,'attempted sidecar mutation leaves canonical authority unchanged');
  }
  const orderCount=(await f.inspect('SELECT count(*)::int AS n FROM orders WHERE merchant_id=$1',[f.merchant])).rows[0].n;
  const replay=await f.ok<{order:OrderView;replayed:boolean}>(next.base+'/orders',created.input,null);assert.equal(replay.replayed,true);assert.equal(replay.order.id,created.order.id);assert.deepEqual(replay.order.pricing,created.order.pricing);
  await f.paidAndDismiss(next,created.order);
  const again=await f.visit({sourceVisitToken:source.v.token}),afterUse=await f.quote(again);assert.equal(afterUse.total.amountMinor,'270');assert.equal(afterUse.lines[0].personalPromotion,undefined);await f.release(again);
  assert.equal((await f.inspect('SELECT count(*)::int AS n FROM orders WHERE merchant_id=$1',[f.merchant])).rows[0].n,orderCount);assert.equal((await f.inspect('SELECT count(*)::int AS n FROM personal_order_promotions WHERE merchant_id=$1',[f.merchant])).rows[0].n,1);
  await f.ok('/api/promotions/'+sent.id+'/revoke',{expectedVersion:sent.version,idempotencyKey:randomUUID()});
  const frozen=await f.financial(),lateReplay=await f.ok<{order:OrderView;replayed:boolean}>(next.base+'/orders',created.input,null);assert.equal(lateReplay.replayed,true);assert.deepEqual(lateReplay.order.pricing,created.order.pricing);assert.deepEqual(await f.financial(),frozen);
  assert.deepEqual((await f.ok<OrderView>('/api/orders/'+source.order.id)).pricing,originalPricing);
 }finally{await f.close();}
});

test('040 compares personal quotes only against actual public daily prices: approved unpublished cheaper draft is private; published equal and better daily prices win',integration,async()=>{
 const f=await personalHttpFixture();try{
  const v=await f.visit();await f.quote(v);await f.release(v);
  const customer=(await f.inspect('INSERT INTO customers(merchant_id) VALUES($1) RETURNING id',[f.merchant])).rows[0].id,target=f.personal(v,{customerId:customer});
  const draft=await f.generate(target,'customer'),approved=await f.approve(draft);await f.publish(approved);
  async function daily(percent:number){
   const generated=await f.generateDaily();const edited=await f.ok<{campaign:PromotionCampaign}>('/api/promotions/'+generated.id,{expectedVersion:generated.version,idempotencyKey:randomUUID(),discountPercent:percent},f.owner,'PATCH');return f.approve(edited.campaign);
  }
  const cheaper=await daily(25);assert.equal(cheaper.unitPrice.amountMinor,'203');assert.deepEqual(cheaper.playlistTargets,[]);
  const next=v,q=await f.quote(next);assert.equal(q.total.amountMinor,'216');assert.equal(q.lines[0].personalPromotion?.campaignId,approved.id);
  assert.equal((await f.ok<{menu:EffectiveMenu}>(f.entryBase,undefined,null)).menu.products.find(p=>p.id===f.addon)?.unitPrice?.amountMinor,'270');
  assert.equal((await f.inspect('SELECT count(*)::int AS n FROM personal_quote_promotions WHERE merchant_id=$1 AND quote_id=$2',[f.merchant,q.id])).rows[0].n,1,'real capture commits the personal sidecar despite the approved-only lower draft');
  const equal=await daily(20);await f.publishDaily(equal);
  const equalQuote=await f.quote(next);assert.equal(equalQuote.total.amountMinor,'216');assert.equal(equalQuote.lines[0].personalPromotion,undefined);assert.equal(equalQuote.lines[0].dailyPromotion?.campaignId,equal.id);
  // Refresh the old draft against the newly published public snapshot before review.
  const refreshed=await f.ok<{campaign:PromotionCampaign}>('/api/promotions/'+cheaper.id+'/preview',{expectedVersion:cheaper.version,idempotencyKey:randomUUID()});const better=await f.approve(refreshed.campaign);await f.publishDaily(better);
  const betterQuote=await f.quote(next);assert.equal(betterQuote.total.amountMinor,'203');assert.equal(betterQuote.lines[0].personalPromotion,undefined);assert.equal(betterQuote.lines[0].dailyPromotion?.campaignId,better.id);
  const bill=await f.create(next,betterQuote);assert.equal(bill.order.pricing.total.amountMinor,'203');assert.equal(bill.order.pricing.lines[0].personalPromotion,undefined);
 }finally{await f.close();}
});

test('invalidated daily publication does not block a still-valid private recipient quote with a stale SQL public price floor',integration,async()=>{
 const f=await personalHttpFixture();try{
  const v=await f.visit();await f.quote(v);await f.release(v);
  const customer=(await f.inspect('INSERT INTO customers(merchant_id) VALUES($1) RETURNING id',[f.merchant])).rows[0].id;
  const generated=await f.generateDaily(),edited=await f.ok<{campaign:PromotionCampaign}>('/api/promotions/'+generated.id,{expectedVersion:generated.version,idempotencyKey:randomUUID(),discountPercent:25},f.owner,'PATCH');
  const daily=await f.approve(edited.campaign);await f.publishDaily(daily);
  assert.equal((await f.quote(v)).total.amountMinor,'203');
  await f.inspect("UPDATE promotion_playlist_targets SET state='TARGET_CHANGED' WHERE merchant_id=$1 AND campaign_id=$2",[f.merchant,daily.id]);
  const personal=await f.approve(await f.generate(f.personal(v,{customerId:customer}),'customer'));await f.publish(personal);
  for(const state of ['TARGET_CHANGED','EXPIRED','REVOKED']){
   await f.inspect('UPDATE promotion_playlist_targets SET state=$3 WHERE merchant_id=$1 AND campaign_id=$2',[f.merchant,daily.id,state]);
   const menu=(await f.ok<{menu:EffectiveMenu}>(f.entryBase,undefined,null)).menu;
   assert.equal(menu.products.find(p=>p.id===f.addon)?.unitPrice?.amountMinor,'270');
   const quote=await f.quote(v);assert.equal(quote.total.amountMinor,'216');assert.equal(quote.lines[0].personalPromotion?.campaignId,personal.id);
   assert.equal((await f.inspect('SELECT count(*)::int AS n FROM personal_quote_promotions WHERE merchant_id=$1 AND quote_id=$2',[f.merchant,quote.id])).rows[0].n,1);
  }
 }finally{await f.close();}
});

for(const reason of ['expired','revoked','cleared','consent_revoked'] as const)test(`${reason} fences personal quote/order/publication and preserves original finance and payment permission`,integration,async()=>{
 const f=await personalHttpFixture();try{
  const source=await f.source();await f.paidAndDismiss(source.v,source.order);
  const identity=reason==='consent_revoked'?await f.auth(source.order):null,target=f.personal(source.v,{sourceOrderId:source.order.id});
  const approved=await f.approve(await f.generate(target,'from_order')),sent=await f.publish(approved);
  if(identity){assert.equal(approved.scope?.binding?.originBasis,'verified_wallet_consent');assert.equal(approved.scope?.binding?.customerAuthSessionId,identity.sessionId);assert.equal(approved.scope?.context.kind,'from_order');assert.equal(approved.scope?.context.kind==='from_order'?approved.scope.context.historyBasis:null,'verified_wallet_consent');}
  const unpublished=await f.approve(await f.generate(target,'from_order'));
  const queuedExpiry=new Date(Date.now()+20000).toISOString();
  const queued=reason==='expired'?(await f.ok<{job:PromotionJob}>('/api/promotions/generate',{...f.generation(target,'from_order'),expiresAt:queuedExpiry})).job:reason==='cleared'||reason==='consent_revoked'?await f.enqueue(target,'from_order'):null;
  const next=await f.visit({sourceVisitToken:source.v.token}),captured=await f.quote(next);assert.equal(captured.total.amountMinor,'216');
  const calls=f.calls(),before=await f.financial(),frozen=await f.frozenQuote(captured),originalPricing=(await f.ok<OrderView>('/api/orders/'+source.order.id)).pricing;
  if(reason==='expired'){
   // Controlled local wall-clock fixtures; target identity/expiry stays immutable.
   await f.inspect("UPDATE promotion_campaigns SET starts_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '1 second' WHERE merchant_id=$1 AND id=ANY($2::uuid[])",[f.merchant,[sent.id,unpublished.id]]);
   assert.ok(queued);const {setTimeout:delay}=await import('node:timers/promises');await delay(Math.max(0,Date.parse(queuedExpiry)-Date.now()+50));
  }else if(reason==='revoked'){
   for(const c of [sent,unpublished])await f.ok('/api/promotions/'+c.id+'/revoke',{expectedVersion:c.version,idempotencyKey:randomUUID()});
  }else if(reason==='cleared'){
   const cleared=await f.ok<{generation:string}>('/api/tables/'+f.table.id+'/clear',{expectedGeneration:'1',idempotencyKey:randomUUID(),confirmClear:true});assert.equal(cleared.generation,'2');
  }else{assert.ok(identity);await identity.revoke();}
  await f.denied(next.base+'/orders',f.orderInput(captured),reason==='cleared'?['TABLE_OCCUPANCY_CHANGED']:['PROMOTION_OFFER_INVALID']);
  if(reason==='cleared'){
   await f.denied(next.base+'/quotes',{items:[{productId:f.addon,qty:1}],confirmJoin:true},['TABLE_OCCUPANCY_CHANGED']);
   await f.denied(f.entryBase+'/visit',{requestId:randomUUID(),sourceVisitToken:source.v.token},['TABLE_OCCUPANCY_CHANGED']);
   await f.denied('/api/promotions/generate',f.generation(target,'from_order'),['TABLE_OCCUPANCY_CHANGED'],f.owner);
   const fresh=await f.visit(),q=await f.quote(fresh);assert.equal(q.total.amountMinor,'270');assert.equal(q.lines[0].personalPromotion,undefined);await f.release(fresh);
  }else{
   const fresh=await f.quote(next);assert.equal(fresh.total.amountMinor,'270');assert.equal(fresh.lines[0].personalPromotion,undefined);
  }
  const current=await f.campaign(unpublished.id);await f.denied('/api/promotions/'+current.id+'/publish',await f.batch(current),reason==='consent_revoked'?['PROMOTION_TARGET_CHANGED']:['PROMOTION_STATE_INVALID'],f.owner);
  if(queued){
   await f.run();assert.equal(f.calls(),calls,'invalid work is refused before provider admission');
   const job=(await f.ok<{job:PromotionJob}>('/api/promotions/jobs/'+queued.id)).job;assert.equal(job.state,'FAILED');
   const admission=(await f.inspect('SELECT attempts,reserved_microusd::text FROM ai_generation_jobs WHERE merchant_id=$1 AND id=$2',[f.merchant,queued.id])).rows[0];assert.deepEqual(admission,{attempts:0,reserved_microusd:'0'});
  }
  assert.deepEqual((await f.campaign(unpublished.id)).playlistTargets,[]);assert.deepEqual(await f.financial(),before,'refusal changes no bill/payment/stock/delegation permission');
  assert.deepEqual(await f.frozenQuote(captured),frozen,'invalidating authority refuses new redemption without editing the captured quote or its immutable evidence');
  assert.deepEqual((await f.ok<OrderView>('/api/orders/'+source.order.id)).pricing,originalPricing);
  const replay=await f.ok<{order:OrderView;replayed:boolean}>(source.v.base+'/orders',source.input,null);assert.equal(replay.replayed,true);assert.equal(replay.order.id,source.order.id);assert.deepEqual(replay.order.pricing,originalPricing);
 }finally{await f.close();}
});
