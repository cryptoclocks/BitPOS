import {createHash} from 'node:crypto';
import {z} from 'zod';
import {pool,tenant} from './db';
import {fail,routingLock} from './authority';
import {effectiveCatalog} from './catalog';
import {coffeeTextRequest,coffeeAudioRequest,type CoffeeResult} from '../../../packages/contracts/src/coffee-copilot';
import {coffeeConfiguration,interpretCoffee,transcribeCoffee,decodeCoffeeAudio,CoffeeProviderError} from './coffee-provider';
import {reserveAiFree} from './ai-free-policy';
import {audioDurationMs} from './coffee-audio';
import type {EffectiveMenu} from './offers';
import {assertVisitOccupancy} from './table-occupancy';
const capability=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function coffeeCopilotRequest(path:string,method:string,input:unknown):Promise<unknown|undefined>{
 try{
 const m=path.match(/^\/api\/table\/([^/]+)\/visit\/([^/]+)\/(copilot(?:\/([^/]+))?|transcribe)$/);if(!m)return undefined;
 const entry=capability.parse(m[1]),access=capability.parse(m[2]);const requestGet=method==='GET'&&!!m[4];if(!requestGet&&!(method==='POST'&&!m[4]))fail('RESOURCE_NOT_FOUND',404);
 const purpose=m[3]==='transcribe'?'transcribe':'copilot';const d=requestGet?null:purpose==='transcribe'?coffeeAudioRequest.parse(input):coffeeTextRequest.parse(input);const requestId=requestGet?z.string().uuid().parse(m[4]):d!.requestId;
 const audio=d&&'audio' in d?decodeCoffeeAudio(d.audio,d.mimeType):null;
 if(audio&&d&&'mimeType' in d)audioDurationMs(audio,d.mimeType);
 const inputHash=d?digest(purpose==='transcribe'&&'audio' in d?[purpose,d.draftRevision,d.mimeType,d.durationMs,createHash('sha256').update(audio!).digest('hex')]:[purpose,d.draftRevision,'text' in d?d.text:null]):null;
 const merchant=(await pool.query('SELECT bitpos.resolve_table_entry($1) AS merchant',[entry])).rows[0]?.merchant;if(!merchant)fail('RESOURCE_NOT_FOUND',404);
 const snapshot=await tenant<{existing:CoffeeResult}|{visitId:string;hash:string;menu:EffectiveMenu;counter:boolean}>(merchant,async db=>{
  await routingLock(db,merchant);
  const v=(await db.query(`SELECT v.*,e.device_id,e.assignment_generation,e.auth_generation FROM table_visits v JOIN table_entries e ON e.merchant_id=v.merchant_id AND e.id=v.entry_id WHERE v.merchant_id=$1 AND e.entry_token=$2 AND v.access_token=$3 FOR UPDATE OF v`,[merchant,entry,access])).rows[0];if(!v)fail('RESOURCE_NOT_FOUND',404);
  const old=(await db.query('SELECT * FROM coffee_operations WHERE merchant_id=$1 AND visit_id=$2 AND request_id=$3',[merchant,v.id,requestId])).rows[0];if(old&&d&&(old.input_hash!==inputHash||old.purpose!==purpose))fail('IDEMPOTENCY_CONFLICT');
  if(v.order_id||new Date(v.expires_at).getTime()<=Date.now())fail('LEASE_EXPIRED');
  await assertVisitOccupancy(db,merchant,v.id);
  if(!(await db.query('SELECT 1 FROM devices d JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id WHERE d.merchant_id=$1 AND d.id=$2 AND d.assignment_generation=$3 AND d.auth_generation=$4 AND d.revoked_at IS NULL AND t.retired_at IS NULL',[merchant,v.device_id,v.assignment_generation,v.auth_generation])).rowCount)fail('ASSIGNMENT_CHANGED');
  const destination=(await db.query('SELECT table_id FROM devices WHERE merchant_id=$1 AND id=$2',[merchant,v.device_id])).rows[0];const menu=await effectiveCatalog(db,merchant,destination.table_id);
  // Migration032 is a REQUIRED rollout dependency; missing relation is an error.
  const policy=(await db.query('SELECT counter_enabled,version FROM merchant_collection_policy WHERE merchant_id=$1',[merchant])).rows[0];const counter=policy?.counter_enabled===true;
  const hash=digest([menu.menuVersion,policy?.version??'0',counter]);
  if(old){let result=old.result as CoffeeResult|null;const newer=(await db.query('SELECT 1 FROM coffee_operations WHERE merchant_id=$1 AND visit_id=$2 AND started_at>$3 AND draft_revision<>$4 LIMIT 1',[merchant,v.id,old.started_at,old.draft_revision])).rowCount;if(newer||old.snapshot_hash!==hash)result={kind:'refused',code:'COPILOT_STALE',requestId,draftRevision:old.draft_revision};if(!result&&Date.now()-new Date(old.started_at).getTime()>20000)result={kind:'refused',code:'PROVIDER_OUTCOME_UNKNOWN',requestId,draftRevision:old.draft_revision};return {existing:result??{kind:'pending',requestId,draftRevision:old.draft_revision}};}
  if(requestGet)fail('RESOURCE_NOT_FOUND',404);
  coffeeConfiguration();const admitted=await reserveAiFree(db,merchant,requestId,purpose,v.id,inputHash!);
  const refused:CoffeeResult={kind:'refused',code:'AI_FREE_LIMIT',requestId,draftRevision:d!.draftRevision};
  await db.query('INSERT INTO coffee_operations(merchant_id,visit_id,request_id,purpose,input_hash,draft_revision,snapshot_hash,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[merchant,v.id,requestId,purpose,inputHash,d!.draftRevision,hash,admitted?null:refused]);
  return admitted?{visitId:v.id,hash,menu,counter}:{existing:refused};
 });
 if('existing' in snapshot)return snapshot.existing;
 let result:CoffeeResult;
 try{if(purpose==='transcribe'&&d&&'mimeType' in d)result={kind:'transcript',text:await transcribeCoffee(audio!,d.mimeType),requestId,draftRevision:d.draftRevision};else{const candidate=await interpretCoffee('text' in d! ? d!.text : '',snapshot.menu.products.filter(p=>!!p.unitPrice),snapshot.counter);result=candidate.kind==='proposal'?{...candidate,requestId,draftRevision:d!.draftRevision,expiresAt:new Date(Date.now()+60000).toISOString()}:{...candidate,requestId,draftRevision:d!.draftRevision};}}
 catch(e){result={kind:'refused',code:e instanceof CoffeeProviderError?e.code:'PROVIDER_RESPONSE_INVALID',requestId,draftRevision:d!.draftRevision};}
 // Speech and model free text can contain PII. Return them only in this live
 // response; durable recovery retains a safe completion marker, never the words.
 const ephemeral=result.kind==='transcript'||result.kind==='clarification';
 const retained:CoffeeResult=ephemeral?{kind:'refused',code:'EPHEMERAL_RESULT_NOT_RETAINED',requestId,draftRevision:d!.draftRevision}:result;
 await tenant(merchant,async db=>{await db.query('UPDATE coffee_operations SET result=$4 WHERE merchant_id=$1 AND visit_id=$2 AND request_id=$3 AND result IS NULL',[merchant,snapshot.visitId,requestId,retained]);});
 const recovered=await coffeeCopilotRequest(path.replace(/\/transcribe$/,'/copilot')+'/'+requestId,'GET',null) as CoffeeResult;
 return ephemeral&&recovered.kind==='refused'&&recovered.code==='EPHEMERAL_RESULT_NOT_RETAINED'?result:recovered;
 }catch(error){
  if(error instanceof CoffeeProviderError)fail(error.code,error.code==='INVALID_AUDIO'||error.code==='AUDIO_DURATION_INVALID'||error.code==='EMPTY_TRANSCRIPT'?422:error.code==='PROVIDER_RATE_LIMITED'?429:503);
  throw error;
 }
}
