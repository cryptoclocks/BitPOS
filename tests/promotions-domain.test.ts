import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {promotionPrice,derivedPromotionPrice,promotionDeriveCommandSchema,promotionWindow,validatePromotionCandidate,type PromotionProductSnapshot} from '../packages/domain/src/promotions';
import {promotionProviderConfiguration,openAICompatibleProvider,PromotionProviderFailure} from '../apps/api/src/promotion-provider';
const money={currency:'USD' as const,decimals:2 as const,amountMinor:'270'};
const product:PromotionProductSnapshot={productId:randomUUID(),name:'กาแฟ',nameEn:'Coffee',category:'coffee',stock:4,basePrice:money,effectivePrice:money,priceVersion:randomUUID(),imageUrl:'/images/menu/espresso.jpg'};
test('nonstacking canonical integer promotion price cannot exceed merchant cap or global effective price',()=>{
 assert.equal(promotionPrice(money,money,15,20).amountMinor,'230');
 assert.equal(promotionPrice({...money,amountMinor:'9007199254740993'},{...money,amountMinor:'9007199254740993'},1,10).amountMinor,'8917127262193584');
 assert.throws(()=>promotionPrice(money,{...money,amountMinor:'200'},15,20),/PROMOTION_REVIEW_REQUIRED/);
 assert.throws(()=>promotionPrice(money,money,21,20),/PROMOTION_REVIEW_REQUIRED/);
 assert.throws(()=>promotionPrice({...money,amountMinor:'1'},{...money,amountMinor:'1'},1,20),/PROMOTION_REVIEW_REQUIRED/);
});
test('manual lineage alone allows its exact source price; changing discount remains nonstacking and integer exact',()=>{
 const current={...money,amountMinor:'230'};
 assert.equal(derivedPromotionPrice(money,current,15,20,15).amountMinor,'230');
 assert.throws(()=>derivedPromotionPrice(money,current,15,20),/PROMOTION_REVIEW_REQUIRED/);
 assert.equal(derivedPromotionPrice(money,current,20,20,15).amountMinor,'216');
 assert.throws(()=>derivedPromotionPrice(money,current,10,20,15),/PROMOTION_REVIEW_REQUIRED/);
 assert.throws(()=>derivedPromotionPrice(money,{...money,amountMinor:'200'},15,20,15),/PROMOTION_REVIEW_REQUIRED/);
 assert.throws(()=>derivedPromotionPrice(money,current,15,10,15),/PROMOTION_REVIEW_REQUIRED/);
 const huge={...money,amountMinor:'9007199254740993'},price=promotionPrice(huge,huge,15,20);
 assert.deepEqual(derivedPromotionPrice(huge,price,15,20,15),price);
});
test('derivation requires explicit scope/mode/confirmation and exact bigint original routing fences',()=>{
 const input={expectedVersion:4,idempotencyKey:'reviewed-command',scope:'this_table',mode:'edit',confirmScope:true,device:{deviceId:product.productId,assignmentGeneration:'9007199254740993',authGeneration:'2',screenGeneration:'4'}};
 assert.deepEqual(promotionDeriveCommandSchema.parse(input),input);
 for(const field of ['scope','mode','confirmScope','expectedVersion','device']){const missing={...input};delete missing[field as keyof typeof missing];assert.equal(promotionDeriveCommandSchema.safeParse(missing).success,false);}
 for(const invalid of [{...input,scope:'daily'},{...input,confirmScope:false},{...input,mode:'preview'},{...input,unitPrice:'1'},{...input,device:{...input.device,assignmentGeneration:9007199254740992}},{...input,device:{...input.device,screenGeneration:'0'}},{...input,device:{...input.device,tableId:product.productId}}])assert.equal(promotionDeriveCommandSchema.safeParse(invalid).success,false);
 assert.equal(promotionDeriveCommandSchema.safeParse({...input,scope:'all_campaign_devices',mode:'regenerate'}).success,true);
});
test('strict provider candidates reject foreign product, canonical price and wallet instructions',()=>{
 const candidate={productId:product.productId,headline:'กาแฟลดราคา',copy:'Coffee special',discountPercent:15,rationale:'Real stock available'};
 assert.deepEqual(validatePromotionCandidate(candidate,[product],20),candidate);
 assert.throws(()=>validatePromotionCandidate({...candidate,productId:randomUUID()},[product],20));
 assert.throws(()=>validatePromotionCandidate({...candidate,unitPrice:'1'},[product],20));
 assert.throws(()=>validatePromotionCandidate({...candidate,walletInstructions:'send funds'},[product],20));
 assert.throws(()=>validatePromotionCandidate({...candidate,discountPercent:30},[product],20));
 assert.throws(()=>validatePromotionCandidate(candidate,[{...product,stock:0}],20));
});
test('private provider configuration is explicit HTTPS URL/model/cost caps; native OAuth is not accepted',()=>{
 assert.equal(promotionProviderConfiguration({}),null);
 assert.equal(promotionProviderConfiguration({OPENAI_API_KEY:'coding-fixture',CODEX_ACCESS_TOKEN:'coding-fixture'}),null);
 const env={BITPOS_AI_PROVIDER_URL:'https://fixture.invalid/v1/chat/completions',BITPOS_AI_API_KEY:'fixture-not-live',BITPOS_AI_MODEL:'fixture-model',BITPOS_AI_JOB_BUDGET_MICROUSD:'1000',BITPOS_AI_DAILY_BUDGET_MICROUSD:'2000'};
 assert.equal(promotionProviderConfiguration(env)?.jobBudget,1000);
 assert.equal(promotionProviderConfiguration({...env,BITPOS_AI_PROVIDER_URL:'http://fixture.invalid/v1/chat/completions'}),null);
 assert.equal(promotionProviderConfiguration({...env,BITPOS_AI_DAILY_BUDGET_MICROUSD:'999'}),null);
});
test('window bounds refuse elapsed, reversed, nonfinite and longer than seven days',()=>{
 const now=Date.parse('2026-10-12T00:00:00Z');promotionWindow('2026-10-12T00:00:00Z','2026-10-12T01:00:00Z',now);
 for(const [start,end] of [['2026-10-12T00:00:00Z','2026-10-11T23:00:00Z'],['2026-10-12T00:00:00Z','2026-10-20T00:00:00Z'],['invalid','2026-10-12T01:00:00Z']])assert.throws(()=>promotionWindow(start,end,now));
});
test('actual adapter structured boundary with explicitly mocked HTTP fixture, not actual model execution',async t=>{
 let calls=0;let sent:Record<string,unknown>|undefined;
 t.mock.method(globalThis,'fetch',async (_url:unknown,options?:RequestInit)=>{calls++;sent=JSON.parse(String(options?.body));return Response.json({id:'http-fixture-request',model:'fixture-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify({productId:product.productId,headline:'Fixture headline',copy:'Controlled fixture only',discountPercent:15,rationale:'No actual model call'})}}]});});
 const provider=openAICompatibleProvider({url:'https://fixture.invalid/v1/chat/completions',key:'fixture-not-live',model:'fixture-model',jobBudget:1000,dailyBudget:2000});
 const result=await provider({jobId:randomUUID(),goal:'Fixture goal',maxDiscountPercent:20,startsAt:'2026-10-12T00:00:00Z',expiresAt:'2026-10-12T01:00:00Z',products:[product]});
 assert.equal(calls,1);assert.equal(result.requestId,'http-fixture-request');assert.equal(result.candidate.productId,product.productId);assert.equal(sent?.max_completion_tokens,1024);
 t.mock.restoreAll();t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('fixture network ambiguity');});
 await assert.rejects(()=>provider({jobId:randomUUID(),goal:'Fixture',maxDiscountPercent:20,startsAt:'2026-10-12T00:00:00Z',expiresAt:'2026-10-12T01:00:00Z',products:[product]}),(e:unknown)=>e instanceof PromotionProviderFailure&&e.code==='PROVIDER_OUTCOME_UNKNOWN');assert.equal(calls,2,'one attempt only, no ambiguous retry');
});
for(const stage of ['headers','body'] as const)test(`provider deadline during ${stage} keeps outcome unknown without another request`,async t=>{
 const deadline=new AbortController();let calls=0,entered!:()=>void;
 const reached=new Promise<void>(resolve=>entered=resolve);
 t.mock.method(AbortSignal,'timeout',(ms:number)=>{assert.equal(ms,20000,'production request deadline remains bounded');return deadline.signal;});
 t.mock.method(globalThis,'fetch',async(_url:unknown,options?:RequestInit)=>{
  calls++;assert.equal(options?.signal,deadline.signal);
  if(stage==='headers'){entered();return new Promise<Response>((_resolve,reject)=>deadline.signal.addEventListener('abort',()=>reject(deadline.signal.reason),{once:true}));}
  return new Response(new ReadableStream<Uint8Array>({start(controller){deadline.signal.addEventListener('abort',()=>controller.error(deadline.signal.reason),{once:true});entered();}}),{status:200});
 });
 const provider=openAICompatibleProvider({url:'https://fixture.invalid/v1/chat/completions',key:'fixture-not-live',model:'fixture-model',jobBudget:1000,dailyBudget:2000});
 const pending=provider({jobId:randomUUID(),goal:'Controlled deadline fixture',maxDiscountPercent:20,startsAt:'2026-10-12T00:00:00Z',expiresAt:'2026-10-12T01:00:00Z',products:[product]});
 const failure=assert.rejects(pending,(error:unknown)=>error instanceof PromotionProviderFailure&&error.code==='PROVIDER_OUTCOME_UNKNOWN');
 await reached;deadline.abort(new DOMException('Controlled timeout','TimeoutError'));await failure;assert.equal(calls,1);
});
