/**
 * Coordinator-only, rerunnable actual HTTP/Postgres lever; never run during integration.
 * Usage (from the integrated repo root):
 *   node_modules/.bin/tsx tools/runtime/coffee-copilot-http-smoke.ts --execute
 *   node_modules/.bin/tsx tools/runtime/coffee-copilot-http-smoke.ts --execute --real-ai
 * --skip-ai is an explicit synonym for the first invocation; it cannot accompany --real-ai.
 * Requires the dedicated BitPOS DB with migrations029–032 applied, installed dependencies,
 * and normal API config: DATABASE_URL, ADMIN_DATABASE_URL, AUTH_URL, AUTH_ANON_KEY,
 * APP_SECRET, PUBLIC_URL, SOLANA_RPC=https://api.devnet.solana.com, DEVNET_PRIVATE_DIR.
 * With --real-ai only: privately supplied BITPOS_AI_PROVIDER_URL (authorized Gemini
 * origin), BITPOS_AI_API_KEY, BITPOS_AI_MODEL (existing authorized Free model).
 * Run inside the OCI container where those credentials already exist, or privately
 * provision its environment. No credential discovery, paid fallback, retries or RPC.
 * At least six global Free slots must remain for isolated guard setup (rolled back);
 * --real-ai consumes only two of them. Other AI writers should be quiescent.
 * The isolated day-limit case needs UTC day age >65s to distinguish it from minute limits.
 * Creates fresh UUID fixture tenants and retains them, quotes and real charged starts.
 * Simulated DB device presence is NOT a physical display/microphone/wallet observation.
 * SQL admission fixtures are savepoint-rolled-back, never a quota reset or ledger deletion.
 * Successful observed runs alone write new-scope evidence; no raw text, capabilities,
 * credentials or customer records are printed/stored in evidence. No final acceptance claim.
 */
import assert from 'node:assert/strict';
import 'dotenv/config';
import pg from 'pg';
import {coffeeConfiguration} from '../../apps/api/src/coffee-provider';
import {reserveAiFree} from '../../apps/api/src/ai-free-policy';
import {coffeeCandidate,coffeeDraftRevision} from '../../packages/contracts/src/coffee-copilot';
import {tableFixture,staffToken} from '../../tests/backend-table-fixture';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Server} from 'node:http';
import type {CoffeeResult} from '../../packages/contracts/src/coffee-copilot';

type Item={productId:string;qty:number};
type Visit={requestId:string;id:string;token:string;base:string;draftRevision:string};
type Quote={id:string;priceVersion:string;total:{currency:string;decimals:number;amountMinor:string};lines:{productId:string;qty:number;unitPrice:{amountMinor:string}}[];collection:{kind:string;policyVersion:number};authority:{target:{deviceId:string};serving:{kind:string;tableId:string}}};
type ProviderObservation={requestId:string;model:string;status:number;committedReservation:true;merchantAndVisitLocksAvailable:true};
interface Receipt {
 scope:string;runId:string;observedAt:string;origin:string;
 fixture:{merchantId:string;otherMerchantId:string;tableId:string;deviceId:string;visitId:string;visitRequestId:string;retained:true;devicePresence:string;treasury:string;wallet:string};
 aiMode:string;actualModel:string|null;actualProviderCalls:number;providerObservations:ProviderObservation[];
 outcomes:Record<string,unknown>;sourceHashes:Record<string,string>;
 claims:{physicalDisplay:false;physicalMic:false;voiceTranscription:false;androidPhantom:false;walletApproval:false;transactions:false;finalAcceptance:false};
}
class ObservationFailure extends Error {constructor(readonly label:string){super(label);}}
function requireObserved(condition:unknown,label:string):asserts condition {if(!condition)throw new ObservationFailure(label);}
function same(actual:unknown,expected:unknown,label:string){try{assert.deepEqual(actual,expected);}catch{throw new ObservationFailure(label);}}
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const runId=randomUUID();
let stage='arguments';
let server:Server|undefined,appPool:pg.Pool|undefined,admin:pg.Pool|undefined;
let originalFetch:typeof fetch|undefined;
let providerCalls=0,blockedProviderCalls=0;
const observations:Record<string,unknown>={};
const providerObservations:ProviderObservation[]=[];

async function run():Promise<Receipt>{
 const args=new Set(process.argv.slice(2));
 requireObserved(args.size===process.argv.slice(2).length&&[...args].every(a=>['--execute','--real-ai','--skip-ai'].includes(a)),'unknown_or_duplicate_argument');
 requireObserved(args.has('--execute'),'execute_flag_required');
 requireObserved(!(args.has('--real-ai')&&args.has('--skip-ai')),'conflicting_ai_flags');
 const realAi=args.has('--real-ai');
 stage='configuration';
 // Intentional opt-in module-loading boundary: config, DB and their transitive
 // runtime imports cannot be static, since private config validation would throw
 // outside the sanitized catch (and skipped invocations must not initialize a DB).
 const {config}=await import('../../apps/api/src/config');
 const db=await import('../../apps/api/src/db');appPool=db.pool;
 admin=new pg.Pool({connectionString:config.ADMIN_DATABASE_URL,max:2,options:'-c search_path=bitpos,public'});
 admin.on('error',()=>{ /* A subsequent awaited query fails; never log connection material. */ });
 const model=realAi?coffeeConfiguration().model:null;
 const {registry}=await import('../../apps/api/src/registry');
 const {effectiveCatalog}=await import('../../apps/api/src/catalog');
 stage='schema_and_historical_starts';
 for(const relation of ['ai_free_requests','coffee_operations','merchant_collection_policy','quote_coffee_constraints','order_coffee_constraints','repeat_quote_requests']){
  requireObserved((await admin.query('SELECT to_regclass($1) AS relation',['bitpos.'+relation])).rows[0].relation!==null,'required_migrations_missing');
 }
 const historical=(await admin.query(`SELECT r.merchant_id,r.request_id,r.purpose,md5(to_jsonb(r)::text) AS fingerprint
  FROM ai_free_requests r JOIN ai_generation_jobs j ON j.merchant_id=r.merchant_id AND j.id=r.request_id
  WHERE r.purpose='promotion' AND j.attempts>0 AND j.provider_origin='https://generativelanguage.googleapis.com' ORDER BY r.merchant_id,r.request_id`)).rows;
 requireObserved(historical.length>=3,'historical_gemini_starts_not_preserved');
 const utcDay=String((await admin.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day);
 const initialGlobalCount=Number((await admin.query("SELECT count(*)::int AS n FROM ai_free_requests WHERE started_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'")).rows[0].n);
 requireObserved(initialGlobalCount<=14,'admission_guard_requires_six_free_slots');

 stage='fixture';
 const f=await tableFixture(8);
 const merchant=f.merchant;
 await db.tenant(merchant,client=>client.query('UPDATE merchants SET name=$2 WHERE id=$1',[merchant,'Coffee HTTP smoke FIXTURE '+runId]));
 const token=await staffToken(db.pool,merchant,f.actor);
 const entry=String((await db.tenant(merchant,client=>client.query('SELECT entry_token FROM table_entries WHERE merchant_id=$1 AND device_id=$2 AND auth_generation=$3',[merchant,f.b.id,f.devices.get(f.b.id)!.authGeneration]))).rows[0].entry_token);
 const base='/api/table/'+entry;
 // Narrow foreign fixture uses the same registry/credential lifecycle; its presence is simulated.
 const otherTable=await db.tenant(f.other,client=>registry(client,f.other,f.actor,'owner','/api/tables','POST',{label:'Foreign fixture table'}));
 const otherDevice=await db.tenant(f.other,client=>registry(client,f.other,f.actor,'owner','/api/devices','POST',{label:'Foreign fixture device',tableId:otherTable.id}));
 await db.tenant(f.other,client=>registry(client,f.other,f.actor,'owner','/api/devices/'+otherDevice.id+'/credential','POST',{}));
 await db.tenant(f.other,client=>client.query("UPDATE device_presence SET connected_until=clock_timestamp()+interval '1 hour' WHERE merchant_id=$1 AND device_id=$2",[f.other,otherDevice.id]));
 const otherEntry=String((await db.tenant(f.other,client=>client.query('SELECT entry_token FROM table_entries WHERE merchant_id=$1 AND device_id=$2 ORDER BY auth_generation DESC LIMIT 1',[f.other,otherDevice.id]))).rows[0].entry_token);
 const foreignProduct=randomUUID();
 await db.tenant(f.other,client=>client.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'กาแฟ','Foreign coffee','',3500,8)",[foreignProduct,f.other]));

 let origin='';
 let dispatch:{requestId:string;visit:Visit}|null=null;
 originalFetch=globalThis.fetch;
 const actualFetch=originalFetch;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(origin&&url.origin===origin)return actualFetch(input,init);
  // Observes the genuine provider transport without injecting a response/provider.
  const match=url.pathname.match(/^\/v1beta\/models\/(gemini-[a-z0-9.-]+):generateContent$/);
  if(url.origin!=='https://generativelanguage.googleapis.com'||!match||!realAi||!dispatch||providerCalls>=2){blockedProviderCalls++;throw new ObservationFailure('unexpected_external_dispatch_blocked');}
  same(match[1],model,'actual_provider_model_mismatch');
  const current=dispatch;
  // A separate connection must see the committed admission AND acquire both actor locks.
  // If the provider is called inside the snapshot SQL transaction, this probe fails.
  await db.tenant(merchant,async client=>{
   await client.query("SET LOCAL lock_timeout='1500ms'; SET LOCAL statement_timeout='2500ms'");
   await client.query('SELECT id FROM merchants WHERE id=$1 FOR NO KEY UPDATE',[merchant]);
   requireObserved((await client.query('SELECT id FROM table_visits WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,current.visit.id])).rowCount===1,'provider_visit_lock_probe_missing');
   const operation=(await client.query('SELECT purpose,result FROM coffee_operations WHERE merchant_id=$1 AND visit_id=$2 AND request_id=$3',[merchant,current.visit.id,current.requestId])).rows[0];
   requireObserved(operation?.purpose==='copilot'&&operation.result===null,'provider_operation_not_committed_before_dispatch');
  });
  const admission=(await admin!.query("SELECT count(*)::int AS n FROM ai_free_requests WHERE merchant_id=$1 AND visit_id=$2 AND request_id=$3 AND purpose='copilot'",[merchant,current.visit.id,current.requestId])).rows[0];
  same(admission.n,1,'provider_reservation_not_committed_before_dispatch');
  providerCalls++;
  const response=await actualFetch(input,init); // No retries and no replacement result.
  providerObservations.push({requestId:current.requestId,model:match[1],status:response.status,committedReservation:true,merchantAndVisitLocksAvailable:true});
  return response;
 };
 stage='localhost_server';
 // Intentional module-loading boundary: attach the real-transport observer before
 // evaluating the exported server and all of its runtime adapters.
 ({server}=await import('../../apps/api/src/index'));
 const listening=once(server,'listening');server.listen(0,'127.0.0.1');await listening;
 const address=server.address();requireObserved(address&&typeof address!=='string','ephemeral_port_missing');origin='http://127.0.0.1:'+address.port;
 async function http(route:string,body?:unknown,authorization?:string,method=body===undefined?'GET':'POST'){
  const response=await fetch(origin+route,{method,signal:AbortSignal.timeout(30000),headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(authorization?{Authorization:'Bearer '+authorization}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json() as Record<string,any>;
  requireObserved(response.headers.get('cache-control')==='no-store','http_capability_response_cacheable');
  return {status:response.status,value};
 }
 async function ok(route:string,body?:unknown,authorization?:string,method?:string){const response=await http(route,body,authorization,method);requireObserved(response.status===200,'http_success_expected');return response.value;}
 async function denied(route:string,body:unknown,code:string,status=409){const before=providerCalls;const response=await http(route,body);same(response.status,status,'http_guard_status');same(response.value.error?.code,code,'http_guard_code');same(providerCalls,before,'guard_dispatched_provider');}
 async function visit(entryBase:string,tenantId:string):Promise<Visit>{
  const requestId=randomUUID();const value=await ok(entryBase+'/visit',{requestId});
  requireObserved(typeof value.visitToken==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value.visitToken),'private_visit_missing');
  const replay=await ok(entryBase+'/visit',{requestId});same(replay.visitToken,value.visitToken,'visit_same_id_not_recovered');
  const row=(await db.tenant(tenantId,client=>client.query('SELECT id,session_id,order_id,review_quote_id FROM table_visits WHERE merchant_id=$1 AND request_id=$2',[tenantId,requestId]))).rows[0];
  requireObserved(row&&row.session_id===null&&row.order_id===null&&row.review_quote_id===null,'fresh_visit_has_checkout_side_effect');
  const draftRevision=JSON.stringify([requestId,[],'table']);requireObserved(coffeeDraftRevision.safeParse(draftRevision).success,'draft_tuple_invalid');
  return {requestId,id:row.id,token:value.visitToken,base:entryBase+'/visit/'+value.visitToken,draftRevision};
 }
 const own=await visit(base,merchant),competitor=await visit(base,merchant),foreign=await visit('/api/table/'+otherEntry,f.other);
 requireObserved(own.token!==competitor.token&&own.token!==foreign.token,'fresh_visits_share_private_capability');
 async function effects(){return db.tenant(merchant,async client=>{
  const counts=(await client.query(`SELECT (SELECT count(*)::int FROM orders WHERE merchant_id=$1) AS orders,
   (SELECT count(*)::int FROM payments WHERE merchant_id=$1) AS payments,
   (SELECT count(*)::int FROM payment_attempts WHERE merchant_id=$1) AS attempts,
   (SELECT count(*)::int FROM payment_quotes WHERE merchant_id=$1) AS payment_quotes,
   (SELECT count(*)::int FROM order_quotes WHERE merchant_id=$1) AS review_quotes,
   (SELECT coalesce(sum(reserved),0)::int FROM products WHERE merchant_id=$1) AS reserved`,[merchant])).rows[0];
  const screen=(await client.query('SELECT kind,screen_generation::text,session_id,order_id,lease_until FROM device_screen_state WHERE merchant_id=$1 AND device_id=$2',[merchant,f.b.id])).rows[0];
  return {counts,screen};
 });}
 const beforeAi=await effects();
 same(beforeAi.counts,{orders:0,payments:0,attempts:0,payment_quotes:0,review_quotes:0,reserved:0},'fixture_financial_state_not_empty');

 stage='rollback_only_free_admission';
 const admissionClient=await admin.connect();
 try{
  await admissionClient.query('BEGIN');
  await admissionClient.query("SET LOCAL lock_timeout='2500ms'; SET LOCAL statement_timeout='5000ms'");
  await admissionClient.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);
  await admissionClient.query('SELECT pg_advisory_xact_lock(730029)');
  const ledger=async()=>(await admissionClient.query('SELECT merchant_id,request_id,purpose,md5(to_jsonb(r)::text) AS fingerprint FROM ai_free_requests r ORDER BY merchant_id,request_id,purpose')).rows;
  const originalLedger=await ledger();
  const globalNow=Number((await admissionClient.query("SELECT count(*)::int AS n FROM ai_free_requests WHERE started_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'")).rows[0].n);
  requireObserved(globalNow<=14,'admission_guard_requires_six_free_slots');
  requireObserved(Number((await admissionClient.query("SELECT extract(epoch FROM clock_timestamp()-(date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')) AS seconds")).rows[0].seconds)>65,'day_guard_requires_utc_day_age_over_65_seconds');
  async function isolated(fn:()=>Promise<void>){await admissionClient.query('SAVEPOINT admission_case');try{await fn();}finally{await admissionClient.query('ROLLBACK TO SAVEPOINT admission_case');await admissionClient.query('RELEASE SAVEPOINT admission_case');}same(await ledger(),originalLedger,'admission_fixture_ledger_not_rolled_back');}
  const admit=(id:string,purpose:'copilot'|'transcribe'|'promotion'='copilot',visitId:string|null=own.id)=>reserveAiFree(admissionClient,merchant,id,purpose,visitId,sha('non-PII admission fixture'));
  await isolated(async()=>{
   const id=randomUUID();same(await admit(id),true,'first_free_reservation_denied');same(await admit(id),false,'duplicate_free_reservation_admitted');
   // Exercise operation writes under the same rollback scope, not permanent charged rows.
   await admissionClient.query(`INSERT INTO coffee_operations(merchant_id,visit_id,request_id,purpose,input_hash,draft_revision,snapshot_hash,result)
    VALUES($1,$2,$3,'copilot',$4,$5,$4,$6)`,[merchant,own.id,id,sha('rollback-only operation fixture'),own.draftRevision,{kind:'refused',code:'AI_FREE_LIMIT',requestId:id,draftRevision:own.draftRevision}]);
  });
  same((await admissionClient.query('SELECT count(*)::int AS n FROM coffee_operations WHERE merchant_id=$1',[merchant])).rows[0].n,0,'admission_fixture_operations_not_rolled_back');
  await isolated(async()=>{for(let i=0;i<3;i++)same(await admit(randomUUID()),true,'minute_guard_setup_denied');same(await admit(randomUUID()),false,'visit_minute_limit_not_enforced');});
  await isolated(async()=>{
   for(let i=0;i<5;i++)await admissionClient.query(`INSERT INTO ai_free_requests(merchant_id,request_id,purpose,visit_id,input_hash,started_at)
    VALUES($1,$2,$3,$4,$5,date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,[merchant,randomUUID(),i%2?'transcribe':'copilot',own.id,sha('day-limit rollback fixture')]);
   same(await admit(randomUUID()),false,'visit_day_limit_not_enforced');
   same(await admit(randomUUID(),'copilot',competitor.id),true,'visit_day_limit_wrongly_global');
  });
  await isolated(async()=>{
   for(let i=globalNow;i<20;i++)await admissionClient.query('INSERT INTO ai_free_requests(merchant_id,request_id,purpose,input_hash) VALUES($1,$2,$3,$4)',[merchant,randomUUID(),i%3===0?'promotion':i%3===1?'transcribe':'copilot',sha('global-limit rollback fixture')]);
   for(const purpose of ['copilot','transcribe','promotion'] as const)same(await admit(randomUUID(),purpose,null),false,'global_limit_not_shared_across_purposes');
  });
  await isolated(async()=>{
   await admissionClient.query("SELECT set_config('bitpos.merchant',$1,true)",[f.other]);
   await admissionClient.query('SAVEPOINT tenant_mismatch');let rejected=false;
   try{await admit(randomUUID());}catch{rejected=true;await admissionClient.query('ROLLBACK TO SAVEPOINT tenant_mismatch');}
   await admissionClient.query('RELEASE SAVEPOINT tenant_mismatch');requireObserved(rejected,'free_admission_wrong_tenant_accepted');
  });
  same(await ledger(),originalLedger,'global_or_historical_ledger_changed_by_guards');
  observations.freeAdmission={duplicate:true,visitPerMinute:3,visitPerUtcDay:5,globalPerUtcDay:20,sharedPurposes:['copilot','transcribe','promotion'],admissionModelParameter:'none_global_ledger',tenantGuard:true,allSyntheticLedgerAndOperationRowsRolledBack:true,globalCountBeforeAndAfterGuards:globalNow};
 }finally{try{await admissionClient.query('ROLLBACK');}finally{admissionClient.release();}}
 same(providerCalls,0,'admission_checks_dispatched_provider');

 stage='tenant_and_query_bound_guards';
 const guardRequest=()=>({requestId:randomUUID(),draftRevision:own.draftRevision,text:'กาแฟหนึ่งแก้ว รับที่โต๊ะ'});
 await denied(base+'/visit/'+foreign.token+'/copilot',guardRequest(),'RESOURCE_NOT_FOUND',404);
 await denied('/api/table/'+otherEntry+'/visit/'+own.token+'/copilot',guardRequest(),'RESOURCE_NOT_FOUND',404);
 await denied(base+'/visit/'+randomBytes(32).toString('base64url')+'/copilot',guardRequest(),'RESOURCE_NOT_FOUND',404);
 await denied(own.base+'/quotes',{items:[{productId:foreignProduct,qty:1}],collection:'table'},'RESOURCE_NOT_FOUND',404);
 for(const column of ['assignment_generation','auth_generation'] as const){
  const generation=String((await db.tenant(merchant,client=>client.query(`SELECT ${column}::text AS generation FROM devices WHERE merchant_id=$1 AND id=$2`,[merchant,f.b.id]))).rows[0].generation);
  try{
   await db.tenant(merchant,client=>client.query(`UPDATE devices SET ${column}=${column}+1 WHERE merchant_id=$1 AND id=$2`,[merchant,f.b.id]));
   await denied(own.base+'/copilot',guardRequest(),'ASSIGNMENT_CHANGED');
   await denied(own.base+'/quotes',{items:[{productId:f.product,qty:1}],collection:'table'},'ASSIGNMENT_CHANGED');
  }finally{await db.tenant(merchant,client=>client.query(`UPDATE devices SET ${column}=$3 WHERE merchant_id=$1 AND id=$2`,[merchant,f.b.id,generation]));}
 }
 const expiredId=randomUUID(),expiredRequest=randomUUID();
 const expired=(await db.tenant(merchant,client=>client.query(`INSERT INTO table_visits(merchant_id,id,entry_id,request_id,created_at,expires_at)
  SELECT $1,$2,id,$3,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour' FROM table_entries WHERE merchant_id=$1 AND entry_token=$4 RETURNING access_token`,[merchant,expiredId,expiredRequest,entry]))).rows[0];
 await denied(base+'/visit/'+expired.access_token+'/copilot',{requestId:randomUUID(),draftRevision:JSON.stringify([expiredRequest,[],'table']),text:'กาแฟหนึ่งแก้ว'},'LEASE_EXPIRED');
 same((await db.tenant(merchant,client=>client.query('SELECT count(*)::int AS n FROM coffee_operations WHERE merchant_id=$1',[merchant]))).rows[0].n,0,'failed_query_bound_guard_created_operation');
 same((await admin.query('SELECT count(*)::int AS n FROM ai_free_requests WHERE merchant_id=$1',[merchant])).rows[0].n,0,'failed_query_bound_guard_consumed_free_start');
 observations.queryBoundGuards={privateVisit:true,crossTenant:true,assignmentGeneration:true,authGeneration:true,expiredVisit:true,providerCalls:0,operationsCreated:0,freeStartsConsumed:0};

 let proposal:Extract<CoffeeResult,{kind:'proposal'}>|null=null;
 let clarificationRequest:{requestId:string;draftRevision:string;text:string}|null=null;
 stage=realAi?'actual_free_gemini_two_requests':'ai_explicitly_not_exercised';
 if(realAi){
  const plain={requestId:randomUUID(),draftRevision:own.draftRevision,text:'กาแฟหนึ่งแก้ว รับที่โต๊ะ'};
  async function invoke(body:{requestId:string;draftRevision:string;text:string}){dispatch={requestId:body.requestId,visit:own};try{return await ok(own.base+'/copilot',body) as CoffeeResult;}finally{dispatch=null;}}
  const first=await invoke(plain);
  observations.realProviderResult={kind:first.kind,...(first.kind==='refused'?{code:first.code}:{})};
  requireObserved(first.kind==='proposal','real_thai_plain_request_not_proposal');proposal=first;
  same({requestId:first.requestId,draftRevision:first.draftRevision},{requestId:plain.requestId,draftRevision:plain.draftRevision},'proposal_request_binding_mismatch');
  same(coffeeCandidate.parse({kind:first.kind,items:first.items,collection:first.collection}),{kind:'proposal',items:[{productId:f.product,qty:1}],collection:'table'},'plain_coffee_proposal_not_exact_fixture_catalog');
  same(Object.keys(first).sort(),['collection','draftRevision','expiresAt','items','kind','requestId'].sort(),'proposal_contains_money_or_unsupported_options');
  requireObserved(Date.parse(first.expiresAt)>Date.now(),'proposal_already_expired');same(providerCalls,1,'thai_request_provider_call_count');
  same(await ok(own.base+'/copilot/'+plain.requestId),first,'durable_same_id_get_not_exact');
  same(await ok(own.base+'/copilot',plain),first,'durable_same_id_post_not_exact');
  same(providerCalls,1,'same_id_recovery_dispatched_provider');
  await denied(own.base+'/copilot',{...plain,text:'กาแฟสองแก้ว'},'IDEMPOTENCY_CONFLICT');
  clarificationRequest={requestId:randomUUID(),draftRevision:JSON.stringify([own.requestId,[{productId:f.product,qty:1}],'table']),text:'I want something like coffee, with oat milk and no sugar.'};
  const clarified=await invoke(clarificationRequest);
  requireObserved(clarified.kind==='clarification','unsupported_ambiguous_english_request_not_clarified');
  requireObserved(/[\u0e01-\u0e5b]/.test(clarified.message)&&/[A-Za-z]/.test(clarified.message),'clarification_not_bilingual');
  const marker={kind:'refused',code:'EPHEMERAL_RESULT_NOT_RETAINED',requestId:clarificationRequest.requestId,draftRevision:clarificationRequest.draftRevision};
  same(await ok(own.base+'/copilot/'+clarificationRequest.requestId),marker,'clarification_recovery_not_safe_marker');
  same(await ok(own.base+'/copilot',clarificationRequest),marker,'clarification_repost_not_safe_marker');
  same(providerCalls,2,'two_real_requests_not_exact_two_calls');
  const rows=(await db.tenant(merchant,client=>client.query('SELECT to_jsonb(o) AS operation FROM coffee_operations o WHERE merchant_id=$1 AND visit_id=$2 ORDER BY started_at',[merchant,own.id]))).rows.map(r=>r.operation);
  same(rows.length,2,'unexpected_durable_operation_count');
  for(const operation of rows){
   same(Object.keys(operation).sort(),['merchant_id','visit_id','request_id','purpose','input_hash','draft_revision','snapshot_hash','result','started_at'].sort(),'durable_operation_has_free_text_column');
   requireObserved(coffeeDraftRevision.safeParse(operation.draft_revision).success,'durable_revision_not_identity_tuple');
   requireObserved(!JSON.stringify(operation).includes(plain.text)&&!JSON.stringify(operation).includes(clarificationRequest.text)&&!JSON.stringify(operation).includes(clarified.message),'durable_operation_retains_prompt_or_clarification');
  }
  same(rows.find(r=>r.request_id===clarificationRequest!.requestId)?.result,marker,'durable_clarification_marker_missing');
  same(rows.find(r=>r.request_id===plain.requestId)?.result,first,'durable_proposal_missing');
  const stale=await ok(own.base+'/copilot/'+plain.requestId);
  same(stale,{kind:'refused',code:'COPILOT_STALE',requestId:plain.requestId,draftRevision:plain.draftRevision},'newer_draft_did_not_stale_old_operation');
  same(providerCalls,2,'stale_operation_dispatched_provider');
  same(await effects(),beforeAi,'copilot_created_order_payment_stock_or_screen_lease');
  const charged=(await admin.query('SELECT request_id,purpose,visit_id FROM ai_free_requests WHERE merchant_id=$1 ORDER BY request_id',[merchant])).rows;
  same(charged.map(r=>r.request_id).sort(),[plain.requestId,clarificationRequest.requestId].sort(),'real_calls_not_exactly_charged_once');
  requireObserved(charged.every(r=>r.purpose==='copilot'&&r.visit_id===own.id),'real_charge_visit_or_purpose_mismatch');
  observations.ai={status:'observed',thaiExactPlainCoffeeProposal:true,englishAmbiguousUnsupportedModifiersClarified:true,bilingualClarification:true,exactProviderCalls:2,sameIdGetAndPostRecoveryWithoutNewCall:true,idempotencyConflictWithoutNewCall:true,newerDraftStalesOldOperation:true,durableProposal:true,durableClarificationIsNonPiiMarker:true,providerDispatchOutsideMerchantAndVisitLocks:true,committedAdmissionBeforeDispatch:true,copilotCreatesNoOrderPaymentQuoteReservationOrScreenLease:true};
 }else{
  same(providerCalls,0,'skip_ai_dispatched_provider');
  observations.ai={status:'skipped',reason:args.has('--skip-ai')?'explicit_skip_ai':'real_ai_coordinator_flag_absent',exactProviderCalls:0,aiPassClaim:false,durableProviderRecovery:'not_exercised',clarificationMarker:'not_exercised'};
 }

 stage='canonical_customer_review';
 const reviewItems:Item[]=proposal?.items??[{productId:f.product,qty:1}];
 await denied(own.base+'/quotes',{items:[{productId:f.product,qty:9}],collection:'table'},'STOCK_UNAVAILABLE');
 await denied(own.base+'/quotes',{items:reviewItems,collection:'counter'},'COUNTER_COLLECTION_UNAVAILABLE',422);
 await db.tenant(merchant,client=>client.query('UPDATE device_presence SET connected_until=NULL WHERE merchant_id=$1 AND device_id=$2',[merchant,f.b.id]));
 try{await denied(own.base+'/quotes',{items:reviewItems,collection:'table'},'DEVICE_OFFLINE',503);}finally{await db.tenant(merchant,client=>client.query("UPDATE device_presence SET connected_until=clock_timestamp()+interval '1 hour' WHERE merchant_id=$1 AND device_id=$2",[merchant,f.b.id]));}
 const q=(await ok(own.base+'/quotes',{items:reviewItems,collection:'table'})).quote as Quote;
 same(q.lines.map(l=>({productId:l.productId,qty:l.qty,unitMinor:l.unitPrice.amountMinor})),[{productId:f.product,qty:1,unitMinor:'270'}],'canonical_review_line_not_authoritative');
 same(q.total,{currency:'USD',decimals:2,amountMinor:'270'},'canonical_review_total_not_integer_authoritative');
 same(q.collection,{kind:'table',policyVersion:1},'canonical_review_collection_not_frozen');
 same(q.authority.target.deviceId,f.b.id,'canonical_review_wrong_device');same(q.authority.serving.tableId,f.table.id,'canonical_review_wrong_table');same(q.authority.serving.kind,'table','counter_choice_changed_serving_authority');
 await denied(competitor.base+'/quotes',{items:reviewItems,collection:'table'},'DEVICE_BUSY');
 await denied(own.base+'/orders',{quoteId:q.id,priceVersion:q.priceVersion,idempotencyKey:randomUUID(),items:reviewItems},'INVALID_REQUEST',422);
 await db.tenant(merchant,client=>client.query('UPDATE products SET stock=0 WHERE merchant_id=$1 AND id=$2',[merchant,f.product]));
 try{await denied(own.base+'/orders',{quoteId:q.id,priceVersion:q.priceVersion,idempotencyKey:randomUUID()},'STOCK_UNAVAILABLE');}finally{await db.tenant(merchant,client=>client.query('UPDATE products SET stock=8 WHERE merchant_id=$1 AND id=$2',[merchant,f.product]));}
 const pricing=await ok('/api/settings/pricing',undefined,token);
 await ok('/api/settings/pricing',{...f.configuration,expectedRevision:pricing.revision,prices:[{productId:f.product,unitMinor:'310'}]},token,'PUT');
 await denied(own.base+'/orders',{quoteId:q.id,priceVersion:q.priceVersion,idempotencyKey:randomUUID()},'PRICE_VERSION_CHANGED');
 const fresh=(await ok(own.base+'/quotes',{items:reviewItems,collection:'table'})).quote as Quote;
 same(fresh.total,{currency:'USD',decimals:2,amountMinor:'310'},'revised_price_not_authoritative');requireObserved(fresh.priceVersion!==q.priceVersion,'price_change_not_new_review_version');
 await denied(own.base+'/orders',{quoteId:q.id,priceVersion:q.priceVersion,idempotencyKey:randomUUID()},'QUOTE_CHANGED');
 const collection=await ok('/api/settings/collection',undefined,token);
 await ok('/api/settings/collection',{counterEnabled:true,expectedVersion:collection.version},token,'PUT');
 const counter=(await ok(own.base+'/quotes',{items:reviewItems,collection:'counter'})).quote as Quote;
 same(counter.collection.kind,'counter','enabled_counter_collection_not_reviewed');same(counter.authority.target.deviceId,f.b.id,'counter_collection_lost_device_authority');same(counter.authority.serving.tableId,f.table.id,'counter_collection_lost_table_authority');
 const enabled=await ok('/api/settings/collection',undefined,token);
 await ok('/api/settings/collection',{counterEnabled:false,expectedVersion:enabled.version},token,'PUT');
 await denied(own.base+'/orders',{quoteId:counter.id,priceVersion:counter.priceVersion,idempotencyKey:randomUUID()},'COLLECTION_POLICY_CHANGED');
 if(clarificationRequest){
  same(await ok(own.base+'/copilot',clarificationRequest),{kind:'refused',code:'COPILOT_STALE',requestId:clarificationRequest.requestId,draftRevision:clarificationRequest.draftRevision},'snapshot_changed_operation_not_stale');
  same(providerCalls,2,'snapshot_stale_post_dispatched_provider');
  const generation=String((await db.tenant(merchant,client=>client.query('SELECT assignment_generation::text AS generation FROM devices WHERE merchant_id=$1 AND id=$2',[merchant,f.b.id]))).rows[0].generation);
  try{await db.tenant(merchant,client=>client.query('UPDATE devices SET assignment_generation=assignment_generation+1 WHERE merchant_id=$1 AND id=$2',[merchant,f.b.id]));await denied(own.base+'/copilot',clarificationRequest,'ASSIGNMENT_CHANGED');}finally{await db.tenant(merchant,client=>client.query('UPDATE devices SET assignment_generation=$3 WHERE merchant_id=$1 AND id=$2',[merchant,f.b.id,generation]));}
 }
 // Existing valid-domain pending operation fixture also exercises stale read recovery in skip-AI mode.
 // It is explicitly synthetic and has NO charged ledger entry/provider result claim.
 const syntheticId=randomUUID();
 const menu=await db.tenant(merchant,client=>effectiveCatalog(client,merchant));
 const policy=await ok('/api/settings/collection',undefined,token);
 const snapshotHash=sha(JSON.stringify([menu.menuVersion,policy.version,policy.counterEnabled]));
 await db.tenant(merchant,client=>client.query(`INSERT INTO coffee_operations(merchant_id,visit_id,request_id,purpose,input_hash,draft_revision,snapshot_hash,result,started_at)
  VALUES($1,$2,$3,'copilot',$4,$5,$6,NULL,clock_timestamp()-interval '21 seconds')`,[merchant,competitor.id,syntheticId,sha('explicit synthetic pending operation'),competitor.draftRevision,snapshotHash]));
 same(await ok(competitor.base+'/copilot/'+syntheticId),{kind:'refused',code:'PROVIDER_OUTCOME_UNKNOWN',requestId:syntheticId,draftRevision:competitor.draftRevision},'old_pending_operation_not_unknown');
 await ok('/api/settings/collection',{counterEnabled:false,expectedVersion:policy.version},token,'PUT');
 same(await ok(competitor.base+'/copilot/'+syntheticId),{kind:'refused',code:'COPILOT_STALE',requestId:syntheticId,draftRevision:competitor.draftRevision},'existing_fixture_operation_snapshot_not_stale');
 const currentGeneration=String((await db.tenant(merchant,client=>client.query('SELECT assignment_generation::text AS generation FROM devices WHERE merchant_id=$1 AND id=$2',[merchant,f.b.id]))).rows[0].generation);
 const callsBeforeBoundFailure=providerCalls;
 try{
  await db.tenant(merchant,client=>client.query('UPDATE devices SET assignment_generation=assignment_generation+1 WHERE merchant_id=$1 AND id=$2',[merchant,f.b.id]));
  const rejected=await http(competitor.base+'/copilot/'+syntheticId);
  same(rejected.status,409,'existing_operation_query_bound_status');same(rejected.value.error?.code,'ASSIGNMENT_CHANGED','existing_operation_query_bound_code');
 }finally{await db.tenant(merchant,client=>client.query('UPDATE devices SET assignment_generation=$3 WHERE merchant_id=$1 AND id=$2',[merchant,f.b.id,currentGeneration]));}
 same(providerCalls,callsBeforeBoundFailure,'existing_operation_query_bound_failure_dispatched_provider');
 observations.syntheticPendingRecovery={fixture:true,actualProviderCall:false,pendingOutcome:'PROVIDER_OUTCOME_UNKNOWN',changedPolicyOutcome:'COPILOT_STALE',failedAssignmentQueryOutcome:'ASSIGNMENT_CHANGED',newCalls:0};
 await ok(own.base+'/release',{});
 const finalEffects=await effects();
 same({...finalEffects.counts,review_quotes:0},{orders:0,payments:0,attempts:0,payment_quotes:0,review_quotes:0,reserved:0},'failed_checkout_guard_created_financial_or_stock_effect');
 same(finalEffects.screen.kind,'idle','fixture_cart_release_not_idle');
 const isolatedRows=await db.tenant(f.other,client=>client.query('SELECT count(*)::int AS n FROM coffee_operations WHERE merchant_id=$1',[merchant]));same(isolatedRows.rows[0].n,0,'durable_operation_tenant_rls_leak');
 observations.canonicalReview={unitMinorBefore:'270',unitMinorAfter:'310',currency:'USD',integerCanonicalPrice:true,stockAtReview:true,stockAtOrder:true,deviceOffline:true,competingVisitBusy:true,unsupportedOrderFieldsRejected:true,changedPriceRequiresFreshReview:true,oldQuoteRejected:true,counterUnavailableGuard:true,enabledCounterRetainsTableAndDeviceAuthority:true,collectionPolicyChangeRejectsOrder:true,orderAndPaymentRowsCreated:0,stockReserved:0,fixtureReviewQuotesRetained:finalEffects.counts.review_quotes,durableOperationTenantRls:true};

 stage='preserved_history_and_counts';
 for(const old of historical){const now=(await admin.query('SELECT md5(to_jsonb(r)::text) AS fingerprint FROM ai_free_requests r WHERE merchant_id=$1 AND request_id=$2 AND purpose=$3',[old.merchant_id,old.request_id,old.purpose])).rows[0];same(now?.fingerprint,old.fingerprint,'historical_charged_start_changed_or_removed');}
 const ownLedger=(await admin.query('SELECT count(*)::int AS n FROM ai_free_requests WHERE merchant_id=$1',[merchant])).rows[0].n;
 same(ownLedger,realAi?2:0,'retained_fixture_charged_starts_not_exact');same(providerCalls,realAi?2:0,'actual_provider_request_count_not_exact');same(blockedProviderCalls,0,'unexpected_external_dispatch_attempt');
 const finalUtcDay=String((await admin.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day);same(finalUtcDay,utcDay,'run_crossed_utc_day_repeat_on_new_day');
 const finalGlobalCount=Number((await admin.query("SELECT count(*)::int AS n FROM ai_free_requests WHERE started_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'")).rows[0].n);
 requireObserved(finalGlobalCount>=initialGlobalCount+ownLedger,'global_counter_reset_or_charge_missing');
 observations.ledger={historicalActualStartsPreserved:historical.length,globalUtcDay:utcDay,globalCountBefore:initialGlobalCount,globalCountAfter:finalGlobalCount,ownActualChargedStartsRetained:ownLedger,noHistoricalOrFinancialDeletion:true};
 const sourceFiles=['apps/api/src/index.ts','apps/api/src/coffee-copilot.ts','apps/api/src/coffee-provider.ts','apps/api/src/coffee-audio.ts','apps/api/src/table-ordering.ts','apps/api/src/coffee-order-constraints.ts','apps/api/src/ai-free-policy.ts','packages/contracts/src/coffee-copilot.ts','supabase/migrations/029_coffee_copilot.sql','supabase/migrations/032_coffee_order_constraints.sql','tools/runtime/coffee-copilot-http-smoke.ts'];
 const sourceHashes:Record<string,string>={};for(const filename of sourceFiles)sourceHashes[filename]=sha(await readFile(filename,'utf8'));
 const evidence:Receipt={scope:'coffee-copilot-x402-v2-20261012',runId,observedAt:new Date().toISOString(),origin:'actual_exported_API_ephemeral_localhost_and_dedicated_Postgres',fixture:{merchantId:merchant,otherMerchantId:f.other,tableId:f.table.id,deviceId:f.b.id,visitId:own.id,visitRequestId:own.requestId,retained:true,devicePresence:'simulated_database_presence_not_physical',treasury:'fixture_system_address_no_transaction',wallet:'none_no_wallet_flow'},aiMode:realAi?'actual_authorized_free_gemini':'skipped_no_AI_pass',actualModel:model,actualProviderCalls:providerCalls,providerObservations,outcomes:observations,sourceHashes,claims:{physicalDisplay:false,physicalMic:false,voiceTranscription:false,androidPhantom:false,walletApproval:false,transactions:false,finalAcceptance:false}};
 return evidence;
}

async function close(){
 const failures:string[]=[];
 if(server){try{if(server.listening){await new Promise<void>((resolve,reject)=>{server!.close(error=>error?reject(error):resolve());server!.closeAllConnections();});}}catch{failures.push('server_close_failed');}}
 if(appPool){try{await appPool.end();}catch{failures.push('app_pool_close_failed');}}
 if(admin){try{await admin.end();}catch{failures.push('admin_pool_close_failed');}}
 if(originalFetch)globalThis.fetch=originalFetch;
 requireObserved(failures.length===0,'resource_cleanup_failed');
}
let receipt:Receipt|undefined;
let failure:unknown;
try{receipt=await run();}catch(error){failure=error;}
try{await close();}catch(error){failure??=error;}
if(failure){
 // Never print exception messages, stacks, HTTP bodies, DB rows, URLs or config.
 const failed={scope:'coffee-copilot-x402-v2-20261012',runId,status:'failed',stage,reason:failure instanceof ObservationFailure?failure.label:'sanitized_runtime_failure',actualProviderCalls:providerCalls,providerObservations,realProviderResult:observations.realProviderResult??null,blockedExternalDispatchAttempts:blockedProviderCalls,cleanupPolicy:'retain_any_created_fixture_and_charged_rows',noSuccessEvidenceWritten:true};console.error(JSON.stringify(failed));try{const directory=path.join('.omp','work','coffee-copilot-x402-v2-20261012','evidence');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'coffee-copilot-http-failed-'+runId+'.json'),JSON.stringify(failed,null,2)+'\n',{flag:'wx',mode:0o600});}catch{console.error(JSON.stringify({runId,reason:'sanitized_failed_evidence_write_failure'}));}process.exitCode=1;
}else{
 try{
  const directory=path.join('.omp','work','coffee-copilot-x402-v2-20261012','evidence');await mkdir(directory,{recursive:true});
  const destination=path.join(directory,'coffee-copilot-http-'+runId+'.json');
  await writeFile(destination,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'observed',runId,evidence:destination,aiMode:receipt!.aiMode,actualModel:receipt!.actualModel,actualProviderCalls:providerCalls,physical:false,voice:false,Phantom:false,finalAcceptance:false}));
 }catch{console.error(JSON.stringify({runId,status:'failed',stage:'evidence_write',reason:'sanitized_evidence_write_failure',actualProviderCalls:providerCalls}));process.exitCode=1;}
}
