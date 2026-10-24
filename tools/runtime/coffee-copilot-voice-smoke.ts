/**
 * Optional coordinator-only real transcription lever. No generated audio or mic access.
 * Run from integrated repo root, with the same normal API/private Free Gemini env
 * prerequisites as coffee-copilot-http-smoke.ts and migrations029–032 applied:
 * node_modules/.bin/tsx tools/runtime/coffee-copilot-voice-smoke.ts --execute --real-ai \
 *   --audio /absolute/outside-repo/recording.wav --mime audio/wav \
 *   --audio-kind supplied-recording
 * Alternatively --audio-kind synthetic-fixture honestly labels endpoint-only proof.
 * Exactly one real generateContent request, independently opt-in from the two-call
 * text lever. No retries, interpretation, order, payment, RPC or paid fallback.
 * The coordinator supplies an existing <=2MiB, <=20s audio file outside the repo;
 * use non-PII speech. No file path, raw audio, transcript or capability is saved in
 * evidence/logs. Container duration is inspected from actual bytes, not user claims.
 * A supplied recording does NOT prove physical mic capture, recognition accuracy,
 * editable browser UI, Android Phantom, wallet approval or final acceptance.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {once} from 'node:events';
import {mkdir,readFile,realpath,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import type {Server} from 'node:http';
import {tableFixture} from '../../tests/backend-table-fixture';
import {coffeeAudioRequest} from '../../packages/contracts/src/coffee-copilot';
import {coffeeConfiguration,decodeCoffeeAudio} from '../../apps/api/src/coffee-provider';
import {audioDurationMs} from '../../apps/api/src/coffee-audio';

class VoiceObservationFailure extends Error {constructor(readonly label:string){super(label);}}
function observed(condition:unknown,label:string):asserts condition {if(!condition)throw new VoiceObservationFailure(label);}
function equal(actual:unknown,expected:unknown,label:string){try{assert.deepEqual(actual,expected);}catch{throw new VoiceObservationFailure(label);}}
interface VoiceReceipt {
 scope:string;runId:string;observedAt:string;origin:string;actualModel:string;actualProviderCalls:number;providerHttpStatus:number;
 fixture:{merchantId:string;otherMerchantId:string;deviceId:string;visitId:string;requestId:string;devicePresence:string;audioKind:string;retained:true;wallet:'none'};
 audio:{mime:string;decodedBytes:number;containerDurationMs:number;rawAudioStored:false;transcriptStored:false};
 outcomes:{returnedTranscriptValid:true;durableNonPiiCompletionMarker:true;sameIdGetAndPostNoExtraCall:true;committedAdmissionBeforeDispatch:true;merchantAndVisitLocksAvailableAtDispatch:true;noOrderPaymentOrScreenLease:true;historicalStartsPreserved:number;chargedStartsRetained:1};
 sourceHashes:Record<string,string>;
 claims:{physicalMic:false;transcriptionAccuracy:false;editableUi:false;androidPhantom:false;walletApproval:false;transactions:false;finalAcceptance:false};
}
const runId=randomUUID();let stage='arguments';
let server:Server|undefined,pool:pg.Pool|undefined,admin:pg.Pool|undefined;
let savedFetch:typeof fetch|undefined;
let calls=0,blockedCalls=0,providerHttpStatus=0;
async function run():Promise<VoiceReceipt>{
 const argv=process.argv.slice(2);const flags:Record<string,string|true>={};
 for(let at=0;at<argv.length;at++){
  const key=argv[at];observed(['--execute','--real-ai','--audio','--mime','--audio-kind'].includes(key)&&flags[key]===undefined,'unknown_or_duplicate_argument');
  if(key==='--execute'||key==='--real-ai')flags[key]=true;
  else{observed(!!argv[at+1]&&!argv[at+1].startsWith('--'),'argument_value_missing');flags[key]=argv[++at];}
 }
 observed(flags['--execute']===true&&flags['--real-ai']===true,'execute_and_real_ai_flags_required');
 const audioPath=flags['--audio'],mime=flags['--mime'],audioKind=flags['--audio-kind'];
 observed(typeof audioPath==='string'&&path.isAbsolute(audioPath)&&typeof mime==='string','absolute_audio_path_and_mime_required');
 observed(audioKind==='supplied-recording'||audioKind==='synthetic-fixture','explicit_audio_provenance_required');
 stage='supplied_audio';
 const root=await realpath(process.cwd()),source=await realpath(audioPath);
 const relative=path.relative(root,source);observed(relative.startsWith('..'+path.sep)||path.isAbsolute(relative),'audio_must_be_outside_repository');
 const info=await stat(source);observed(info.isFile()&&info.size>0&&info.size<=2097152,'supplied_audio_size_invalid');
 const raw=await readFile(source);
 const decoded=decodeCoffeeAudio(raw.toString('base64'),mime);
 const measuredDuration=audioDurationMs(decoded,mime);
 stage='configuration';
 // Intentional module-loading boundary: private validation/DB initialization must
 // occur only after opt-in flags, inside the sanitized failure boundary.
 const {config}=await import('../../apps/api/src/config');
 const db=await import('../../apps/api/src/db');pool=db.pool;
 const model=coffeeConfiguration().model;
 admin=new pg.Pool({connectionString:config.ADMIN_DATABASE_URL,max:2,options:'-c search_path=bitpos,public'});
 admin.on('error',()=>{ /* Awaited queries fail without printing private connection data. */ });
 const historical=(await admin.query(`SELECT r.merchant_id,r.request_id,r.purpose,md5(to_jsonb(r)::text) AS fingerprint FROM ai_free_requests r
  JOIN ai_generation_jobs j ON j.merchant_id=r.merchant_id AND j.id=r.request_id
  WHERE r.purpose='promotion' AND j.attempts>0 AND j.provider_origin='https://generativelanguage.googleapis.com'`)).rows;
 observed(historical.length>=3,'historical_starts_missing');
 const globalCount=(await admin.query("SELECT count(*)::int AS n FROM ai_free_requests WHERE started_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'")).rows[0].n;
 const utcDay=(await admin.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day;
 observed(globalCount<20,'global_free_limit_no_headroom');
 stage='fixture';
 const f=await tableFixture(8),merchant=f.merchant;
 await db.tenant(merchant,client=>client.query('UPDATE merchants SET name=$2 WHERE id=$1',[merchant,'Coffee voice HTTP FIXTURE '+runId]));
 const entry=(await db.tenant(merchant,client=>client.query('SELECT entry_token FROM table_entries WHERE merchant_id=$1 AND device_id=$2 AND auth_generation=$3',[merchant,f.b.id,f.devices.get(f.b.id)!.authGeneration]))).rows[0].entry_token;
 let origin='',activeRequestId:string|null=null,visitId:string|null=null;
 savedFetch=globalThis.fetch;const transport=savedFetch;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(origin&&url.origin===origin)return transport(input,init);
  if(url.origin!=='https://generativelanguage.googleapis.com'||url.pathname!==`/v1beta/models/${model}:generateContent`||!activeRequestId||!visitId||calls>=1){blockedCalls++;throw new VoiceObservationFailure('unexpected_external_dispatch_blocked');}
  await db.tenant(merchant,async client=>{
   await client.query("SET LOCAL lock_timeout='1500ms'; SET LOCAL statement_timeout='2500ms'");
   await client.query('SELECT id FROM merchants WHERE id=$1 FOR NO KEY UPDATE',[merchant]);
   observed((await client.query('SELECT id FROM table_visits WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,visitId])).rowCount===1,'provider_visit_lock_missing');
   const operation=(await client.query('SELECT purpose,result FROM coffee_operations WHERE merchant_id=$1 AND visit_id=$2 AND request_id=$3',[merchant,visitId,activeRequestId])).rows[0];
   observed(operation?.purpose==='transcribe'&&operation.result===null,'transcription_operation_not_committed_before_dispatch');
  });
  equal((await admin!.query("SELECT count(*)::int AS n FROM ai_free_requests WHERE merchant_id=$1 AND visit_id=$2 AND request_id=$3 AND purpose='transcribe'",[merchant,visitId,activeRequestId])).rows[0].n,1,'transcription_admission_not_committed_before_dispatch');
  calls++;const response=await transport(input,init);providerHttpStatus=response.status;return response;
 };
 stage='localhost_server';
 // Intentional loading boundary: observe genuine transport before runtime adapters load.
 ({server}=await import('../../apps/api/src/index'));
 const listening=once(server,'listening');server.listen(0,'127.0.0.1');await listening;
 const address=server.address();observed(address&&typeof address!=='string','ephemeral_port_missing');origin='http://127.0.0.1:'+address.port;
 async function request(route:string,input?:unknown){
  const response=await fetch(origin+route,{method:input===undefined?'GET':'POST',signal:AbortSignal.timeout(30000),headers:input===undefined?{}:{'Content-Type':'application/json'},body:input===undefined?undefined:JSON.stringify(input)});
  observed(response.status===200&&response.headers.get('cache-control')==='no-store','http_success_and_no_store_required');
  return await response.json() as Record<string,any>;
 }
 const visitRequestId=randomUUID();
 const visit=await request('/api/table/'+entry+'/visit',{requestId:visitRequestId});
 observed(typeof visit.visitToken==='string'&&/^[A-Za-z0-9_-]{43}$/.test(visit.visitToken),'private_visit_missing');
 const row=(await db.tenant(merchant,client=>client.query('SELECT id,session_id,order_id FROM table_visits WHERE merchant_id=$1 AND request_id=$2',[merchant,visitRequestId]))).rows[0];
 observed(row?.session_id===null&&row.order_id===null,'fresh_visit_not_advisory');visitId=row.id;
 const requestId=randomUUID(),draftRevision=JSON.stringify([visitRequestId,[],'table']);
 const body=coffeeAudioRequest.parse({requestId,draftRevision,mimeType:mime,durationMs:Math.ceil(measuredDuration),audio:decoded.toString('base64')});
 const base='/api/table/'+entry+'/visit/'+visit.visitToken;
 stage='actual_free_gemini_transcription';activeRequestId=requestId;
 let result:Record<string,any>;
 try{result=await request(base+'/transcribe',body);}finally{activeRequestId=null;}
 observed(result.kind==='transcript'&&typeof result.text==='string'&&result.text.trim().length>0&&result.text.length<=2000,'returned_transcript_invalid');
 equal({requestId:result.requestId,draftRevision:result.draftRevision},{requestId,draftRevision},'transcript_binding_mismatch');
 equal(Object.keys(result).sort(),['draftRevision','kind','requestId','text'].sort(),'transcript_contains_inferred_order_fields');
 equal(calls,1,'transcription_not_exact_one_real_call');
 const marker={kind:'refused',code:'EPHEMERAL_RESULT_NOT_RETAINED',requestId,draftRevision};
 equal(await request(base+'/copilot/'+requestId),marker,'transcript_get_recovery_not_non_pii_marker');
 equal(await request(base+'/transcribe',body),marker,'transcript_post_recovery_not_non_pii_marker');equal(calls,1,'transcript_recovery_dispatched_extra_provider_call');
 const durable=(await db.tenant(merchant,client=>client.query('SELECT to_jsonb(o) AS operation FROM coffee_operations o WHERE merchant_id=$1 AND visit_id=$2 AND request_id=$3',[merchant,visitId,requestId]))).rows[0]?.operation;
 observed(durable,'durable_transcription_operation_missing');
 equal(Object.keys(durable).sort(),['merchant_id','visit_id','request_id','purpose','input_hash','draft_revision','snapshot_hash','result','started_at'].sort(),'durable_transcription_has_free_text_or_audio_column');
 equal(durable.result,marker,'durable_transcript_marker_missing');equal(durable.draft_revision,draftRevision,'durable_transcript_revision_not_identity_tuple');
 // Verify the only retained input is the exact hash of metadata and audio digest.
 // Substring checks would wrongly reject valid short speech such as \"table\",
 // which is also a legitimate non-PII collection member in the draft tuple.
 const expectedInputHash=createHash('sha256').update(JSON.stringify(['transcribe',draftRevision,mime,body.durationMs,createHash('sha256').update(decoded).digest('hex')])).digest('hex');
 equal(durable.input_hash,expectedInputHash,'durable_transcription_input_not_hash_only');
 observed(typeof durable.snapshot_hash==='string'&&/^[0-9a-f]{64}$/.test(durable.snapshot_hash),'durable_transcription_snapshot_not_hash_only');
 equal(durable.purpose,'transcribe','durable_transcription_purpose_mismatch');
 const effects=(await db.tenant(merchant,client=>client.query(`SELECT (SELECT count(*)::int FROM orders WHERE merchant_id=$1) AS orders,
  (SELECT count(*)::int FROM payments WHERE merchant_id=$1) AS payments,(SELECT count(*)::int FROM payment_attempts WHERE merchant_id=$1) AS attempts,
  (SELECT count(*)::int FROM order_quotes WHERE merchant_id=$1) AS quotes,(SELECT count(*)::int FROM device_sessions WHERE merchant_id=$1) AS sessions,
  (SELECT coalesce(sum(reserved),0)::int FROM products WHERE merchant_id=$1) AS reserved`,[merchant]))).rows[0];
 equal(effects,{orders:0,payments:0,attempts:0,quotes:0,sessions:0,reserved:0},'transcription_created_checkout_effect');
 equal((await db.tenant(merchant,client=>client.query('SELECT kind FROM device_screen_state WHERE merchant_id=$1 AND device_id=$2',[merchant,f.b.id]))).rows[0].kind,'idle','transcription_acquired_screen_lease');
 equal((await admin.query('SELECT count(*)::int AS n FROM ai_free_requests WHERE merchant_id=$1',[merchant])).rows[0].n,1,'charged_transcription_start_not_retained_once');
 for(const old of historical){equal((await admin.query('SELECT md5(to_jsonb(r)::text) AS fingerprint FROM ai_free_requests r WHERE merchant_id=$1 AND request_id=$2 AND purpose=$3',[old.merchant_id,old.request_id,old.purpose])).rows[0]?.fingerprint,old.fingerprint,'historical_start_changed_or_removed');}
 equal(blockedCalls,0,'unexpected_external_dispatch_attempt');
 equal((await admin.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day,utcDay,'run_crossed_utc_day');
 observed((await admin.query("SELECT count(*)::int AS n FROM ai_free_requests WHERE started_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'")).rows[0].n>=globalCount+1,'global_counter_reset_or_charge_missing');
 const sourceHashes:Record<string,string>={};for(const filename of ['apps/api/src/index.ts','apps/api/src/coffee-copilot.ts','apps/api/src/coffee-provider.ts','apps/api/src/coffee-audio.ts','packages/contracts/src/coffee-copilot.ts','tools/runtime/coffee-copilot-voice-smoke.ts'])sourceHashes[filename]=createHash('sha256').update(await readFile(filename)).digest('hex');
 return {scope:'coffee-copilot-x402-v2-20261012',runId,observedAt:new Date().toISOString(),origin:'actual_exported_API_ephemeral_localhost_and_dedicated_Postgres_supplied_audio',actualModel:model,actualProviderCalls:calls,providerHttpStatus,fixture:{merchantId:merchant,otherMerchantId:f.other,deviceId:f.b.id,visitId:row.id,requestId,devicePresence:'simulated_database_presence_not_physical',audioKind,retained:true,wallet:'none'},audio:{mime,decodedBytes:decoded.length,containerDurationMs:measuredDuration,rawAudioStored:false,transcriptStored:false},outcomes:{returnedTranscriptValid:true,durableNonPiiCompletionMarker:true,sameIdGetAndPostNoExtraCall:true,committedAdmissionBeforeDispatch:true,merchantAndVisitLocksAvailableAtDispatch:true,noOrderPaymentOrScreenLease:true,historicalStartsPreserved:historical.length,chargedStartsRetained:1},sourceHashes,claims:{physicalMic:false,transcriptionAccuracy:false,editableUi:false,androidPhantom:false,walletApproval:false,transactions:false,finalAcceptance:false}};
}
let receipt:VoiceReceipt|undefined,failure:unknown;
try{receipt=await run();}catch(error){failure=error;}
try{if(server?.listening)await new Promise<void>((resolve,reject)=>{server!.close(error=>error?reject(error):resolve());server!.closeAllConnections();});}catch(error){failure??=error;}
try{await pool?.end();}catch(error){failure??=error;}
try{await admin?.end();}catch(error){failure??=error;}
if(savedFetch)globalThis.fetch=savedFetch;
if(failure){console.error(JSON.stringify({scope:'coffee-copilot-x402-v2-20261012',runId,status:'failed',stage,reason:failure instanceof VoiceObservationFailure?failure.label:'sanitized_runtime_failure',actualProviderCalls:calls,blockedExternalDispatchAttempts:blockedCalls,cleanupPolicy:'retain_any_created_fixture_and_charged_rows',noSuccessEvidenceWritten:true}));process.exitCode=1;}
else{try{const directory=path.join('.omp','work','coffee-copilot-x402-v2-20261012','evidence');await mkdir(directory,{recursive:true});const destination=path.join(directory,'coffee-copilot-voice-'+runId+'.json');await writeFile(destination,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:'observed',runId,evidence:destination,actualModel:receipt!.actualModel,actualProviderCalls:calls,audioKind:receipt!.fixture.audioKind,physicalMic:false,editableUi:false,Phantom:false,finalAcceptance:false}));}catch{console.error(JSON.stringify({runId,status:'failed',stage:'evidence_write',reason:'sanitized_evidence_write_failure',actualProviderCalls:calls}));process.exitCode=1;}}
