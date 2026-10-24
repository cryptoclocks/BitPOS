import assert from 'node:assert/strict';import {randomBytes,randomUUID,createHash} from 'node:crypto';import {writeFile} from 'node:fs/promises';import pg from 'pg';
const base=process.env.BITPOS_PUSH_FIXTURE_BASE??'http://127.0.0.1:3019',root='/api/mobile/v1/notifications/customer',db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'});
assert.ok(['http://127.0.0.1:3019','http://127.0.0.1:3020'].includes(base));
const proof=()=>randomBytes(32).toString('base64url'),hash=(value:string)=>createHash('sha256').update(value).digest('hex'),checks:string[]=[],sessions:string[]=[];
await db.connect();
async function actor(account?:string,device=randomUUID()){
 account??=(await db.query('INSERT INTO bitpos.mobile_accounts(auth_subject) VALUES($1) RETURNING id',[randomUUID()])).rows[0].id;
 const id=randomUUID(),access=proof(),refresh=proof();await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[id,account,device,hash(access),hash(refresh)]);await db.query('INSERT INTO bitpos.mobile_refresh_history(token_hash,session_id,consumed_at) VALUES($1,$2,NULL)',[hash(refresh),id]);sessions.push(id);return{account:account!,device,session:id,access,refresh};
}
async function call(path:string,method:string,body:unknown,bearer:string|undefined,key:string|undefined,next?:string,expected=200){
 const response=await fetch(base+root+path,{method,headers:{...(bearer?{Authorization:'Bearer '+bearer}:{}),...(key?{'X-BitPOS-Push-Installation-Key':key}:{}),...(next?{'X-BitPOS-Push-Next-Key':next}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();assert.equal(response.status,expected,method+' private notification route');return value;
}
try{
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 const owner=await actor(),otherDevice=await actor(owner.account),otherAccount=await actor(),keys=[proof(),proof(),proof()],fid='synthetic087-fid-'+randomUUID();
 const enable={kind:'ENABLE',idempotencyKey:randomUUID(),expectedRevision:'0',capability:'authorized',locale:'th',platform:'android',consentVersion:'food-transactional-v1',fid};
 assert.equal((await call('/installation','GET',undefined,undefined,keys[0],undefined,401)).error.code,'AUTH_REQUIRED');
 await call('/installation?recipient='+otherAccount.account,'GET',undefined,owner.access,keys[0],undefined,422);
 await call('/installation','GET',undefined,owner.access,'not-a-proof',undefined,422);
 await call('/installation','PUT',{},owner.access,keys[0],undefined,405);
 await call('/installation','POST',{...enable,accountId:otherAccount.account},owner.access,keys[0],keys[1],422);
 await call('/installation','POST',enable,owner.access,keys[0],keys[0],422);
 await call('/installation','POST',{...enable,fid:'ก'.repeat(1000)},owner.access,keys[0],keys[1],422);
 const before=await call('/installation','GET',undefined,owner.access,keys[0]);assert.equal(before.installation.kind,'UNREGISTERED');
 if(!before.endpointEncryptionAvailable){
  await call('/installation','POST',enable,owner.access,keys[0],keys[1],503);
  const off=await call('/installation','POST',{kind:'DISABLE',idempotencyKey:randomUUID(),expectedRevision:'0',capability:'unknown',locale:'en',reason:'USER_OPT_OUT'},owner.access,keys[0]);assert.equal(off.revision,'1');
  const disabled=await call('/installation','GET',undefined,owner.access,keys[0]);assert.equal(disabled.installation.consentEnabled,false);
  checks.push('Unconfigured actual API reports encryption unavailable, refuses ENABLE503 and persists initial DISABLE tombstone without provider or encryption keys');
 }else{
  const concurrent=await Promise.all([call('/installation','POST',enable,owner.access,keys[0],keys[1]),call('/installation','POST',enable,owner.access,keys[0],keys[1])]);const first=concurrent.find(v=>!v.replayed)!;assert.ok(first);assert.equal(first.generation,'1');assert.deepEqual(concurrent.find(v=>v.replayed),{...first,replayed:true});
  const replay=await call('/installation','POST',enable,owner.access,keys[0],keys[1]);assert.deepEqual(replay,{...first,replayed:true});
  const current=await call('/installation','GET',undefined,owner.access,keys[1]);assert.equal(current.installation.consentEnabled,true);
  await db.query('BEGIN');await db.query('SELECT installation_id FROM bitpos.mobile_push_bindings WHERE binding_id=$1 FOR UPDATE',[first.bindingId]);
  const queued=fetch(base+root+'/installation',{headers:{Authorization:'Bearer '+owner.access,'X-BitPOS-Push-Installation-Key':keys[1]}}).then(async response=>({status:response.status,value:await response.json()}));let observed=false;
  const until=Date.now()+140;
  while(Date.now()<until){await db.query('SELECT pg_stat_clear_snapshot()');observed=(await db.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND pg_backend_pid()=ANY(pg_blocking_pids(pid)) AND query LIKE '%mobile_push_binding_status%') v")).rows[0].v;if(observed)break;}
  if(!observed){const waiting=(await db.query("SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND query LIKE '%mobile_push_binding_status%'")).rows;await db.query('ROLLBACK');const response=await queued;throw Error('No observed notification binding waiter: '+JSON.stringify({waiting,responseStatus:response.status}));}
  const refreshed=await fetch(base+'/api/mobile/v1/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:owner.refresh,deviceId:owner.device})});assert.equal(refreshed.status,200);const rotated=await refreshed.json();await db.query('COMMIT');const stale=await queued;assert.equal(stale.status,401);assert.equal(stale.value.error.code,'AUTH_REQUIRED');owner.access=rotated.accessToken;owner.refresh=rotated.refreshToken;
  assert.equal((await call('/installation','GET',undefined,owner.access,keys[1])).installation.revision,'1');
  checks.push('Two simultaneous exact ENABLE requests commit one binding command; actual status waits on binding while real refresh completes, then old bearer401 and rotated bearer reads unchanged revision1');
  await call('/installation','GET',undefined,owner.access,keys[0],undefined,409);
  const privateRow=(await db.query('SELECT endpoint_hash,endpoint_ciphertext,installation_key_hash FROM bitpos.mobile_push_bindings WHERE binding_id=$1',[first.bindingId])).rows[0];
  assert.equal(privateRow.endpoint_hash,hash(fid));assert.equal(privateRow.endpoint_ciphertext.includes(fid),false);assert.equal(privateRow.installation_key_hash,hash(keys[1]));
  const journal=JSON.stringify((await db.query('SELECT request_hash,response FROM bitpos.mobile_push_commands WHERE account_id=$1',[owner.account])).rows);for(const secret of [fid,...keys])assert.equal(journal.includes(secret),false);
  const unrelated=await call('/installation','GET',undefined,otherDevice.access,keys[1]);assert.equal(unrelated.installation.kind,'UNREGISTERED');
  const foreignOpen={bindingId:first.bindingId,bindingGeneration:first.generation};for(const who of [otherDevice,otherAccount])assert.deepEqual(await call('/events/'+randomUUID()+'/open','POST',foreignOpen,who.access,keys[1]),{kind:'UNAVAILABLE'});
  checks.push('Real API strict body/query/header/byte bounds; exact ENABLE retry one effect; endpoint encrypted and only proof hashes in DB; other device/account cannot resolve binding');
  await call('/installation','POST',{...enable,idempotencyKey:randomUUID()},otherDevice.access,proof(),proof(),409);
  assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.mobile_push_bindings WHERE app=$1 AND device_id=$2',['CUSTOMER',otherDevice.device])).rows[0].n,0);
  checks.push('Same active FID cannot be enabled on a different installation; endpoint collision409 rolls back binding creation');
  const replacement=await actor(owner.account,owner.device),notOwned=await call('/installation','GET',undefined,replacement.access,keys[1]);assert.equal(notOwned.installation.boundToCurrentSession,false);assert.equal(notOwned.installation.bindingId,null);assert.equal(notOwned.installation.consentEnabled,false);
  const rotate={kind:'ROTATE',idempotencyKey:randomUUID(),expectedRevision:'1',capability:'authorized',locale:'th',fid};await call('/installation','POST',rotate,replacement.access,keys[1],undefined,409);
  const handoff=await call('/installation','POST',{...enable,idempotencyKey:randomUUID(),expectedRevision:'1'},replacement.access,keys[1],keys[2]);assert.notEqual(handoff.bindingId,first.bindingId);assert.equal(handoff.generation,'2');
  assert.equal((await call('/installation','POST',enable,owner.access,keys[0],keys[1])).replayed,true);
  await call('/installation','GET',undefined,owner.access,keys[1],undefined,409);assert.equal((await call('/installation','GET',undefined,replacement.access,keys[2])).installation.consentEnabled,true);
  checks.push('Same device fresh session sees no prior binding identity/consent; ROTATE cannot claim it; explicit ENABLE rotates proof+binding and old historical retry never steals it back');
  await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=clock_timestamp() WHERE id=$1',[replacement.session]);
  const revoked=(await db.query('SELECT consent_enabled,endpoint_ciphertext,generation::text FROM bitpos.mobile_push_bindings WHERE binding_id=$1',[handoff.bindingId])).rows[0];assert.deepEqual(revoked,{consent_enabled:false,endpoint_ciphertext:null,generation:'3'});
  await call('/installation','GET',undefined,replacement.access,keys[2],undefined,401);checks.push('Canonical session revocation persists consent false, cleared recoverable endpoint and next generation; revoked bearer reads401');
  const foreignSameDevice=await actor(otherAccount.account,owner.device),foreignProof=proof(),foreignStatus=await call('/installation','GET',undefined,foreignSameDevice.access,keys[2]);assert.equal(foreignStatus.installation.boundToCurrentSession,false);assert.equal(foreignStatus.installation.bindingId,null);assert.equal(foreignStatus.installation.consentEnabled,false);
  await call('/installation','POST',{...rotate,idempotencyKey:randomUUID(),expectedRevision:'3'},foreignSameDevice.access,keys[2],undefined,409);
  const foreignEnable={...enable,idempotencyKey:randomUUID(),expectedRevision:'3'},foreignHandoff=await call('/installation','POST',foreignEnable,foreignSameDevice.access,keys[2],foreignProof);assert.notEqual(foreignHandoff.bindingId,handoff.bindingId);assert.equal(foreignHandoff.generation,'4');
  await call('/installation','GET',undefined,owner.access,keys[2],undefined,409);assert.equal((await call('/installation','GET',undefined,foreignSameDevice.access,foreignProof)).installation.boundToCurrentSession,true);
  checks.push('Different account same secure installation sees no prior binding/consent, cannot ROTATE ownership, and explicit ENABLE creates generation4 with a new binding/proof; old account cannot reclaim with old proof');
  const activeProof=proof(),activeHandoff=await call('/installation','POST',{...enable,idempotencyKey:randomUUID(),expectedRevision:'4'},owner.access,foreignProof,activeProof);assert.notEqual(activeHandoff.bindingId,foreignHandoff.bindingId);assert.equal(activeHandoff.generation,'5');
  assert.equal((await call('/installation','POST',foreignEnable,foreignSameDevice.access,keys[2],foreignProof)).replayed,true);
  await call('/installation','GET',undefined,foreignSameDevice.access,foreignProof,undefined,409);const activeStatus=await call('/installation','GET',undefined,owner.access,activeProof);assert.equal(activeStatus.installation.boundToCurrentSession,true);assert.equal(activeStatus.installation.generation,'5');
  assert.deepEqual((await db.query('SELECT account_id,owner_session_id,consent_enabled FROM bitpos.mobile_push_bindings WHERE binding_id=$1',[activeHandoff.bindingId])).rows[0],{account_id:owner.account,owner_session_id:owner.session,consent_enabled:true});
  checks.push('Active prior-owner different-account explicit handoff rotates binding/proof to generation5; old account exact historical ENABLE replay cannot steal current account/session ownership or consent');
 }
 const receipt={status:'PASS_ACTUAL_PUSH_INSTALLATION_HTTP_AND_PERSISTENCE',base,checks,fixtures:['Synthetic isolated mobile identities, random private installation proofs and explicit fixture FID; no provider access or messages'],limits:['Installation API authority only, plus actual queued bearer-refresh and exact-command concurrency; source fanout/outbox worker/native/open flows have separate receipts'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/notification087-installation-'+(before.endpointEncryptionAvailable?'configured':'unconfigured')+'-http-20261019.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await db.query('ROLLBACK');await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=ANY($1::uuid[])',[sessions]);await db.end();}
