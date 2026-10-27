import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'});
const migration=await readFile('supabase/migrations/087_mobile_push.sql','utf8'),checks:string[]=[];
const hash=(value:string)=>createHash('sha256').update(value).digest('hex'),key0=hash('fixture installation zero'),key1=hash('fixture installation one'),key2=hash('fixture installation two');
await db.connect();
try{
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');await db.query('BEGIN');await db.query(migration);
 const account=randomUUID(),session=randomUUID(),device=randomUUID(),access=hash(randomUUID());
 await db.query('INSERT INTO bitpos.mobile_accounts(id,auth_subject) VALUES($1,$2)',[account,randomUUID()]);
 await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[session,account,device,access,hash(randomUUID())]);
 await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_device',$3,true),set_config('bitpos.mobile_access_hash',$4,true)",[account,session,device,access]);
 async function status(key:string){return(await db.query("SELECT bitpos.mobile_push_binding_status('CUSTOMER',$1) v",[key])).rows[0].v;}
 async function command(payload:any,key:string,next:string|null,endpoint:string|null=hash('fixture fid'),cipher:string|null='fixture-ciphertext-not-real-encryption-0000'){
  return(await db.query("SELECT bitpos.mobile_push_binding_command('CUSTOMER',$1,$2,$3,$4,$5,$6) v",[payload,key,next,endpoint,cipher,endpoint?'fixture-key':null])).rows[0].v;
 }
 async function denied(code:string,fn:()=>Promise<unknown>){await db.query('SAVEPOINT expected_denial');try{await assert.rejects(fn,new RegExp(code));}finally{await db.query('ROLLBACK TO SAVEPOINT expected_denial');await db.query('RELEASE SAVEPOINT expected_denial');}}
 assert.deepEqual(await status(key0),{kind:'UNREGISTERED',revision:'0'});
 const enable={kind:'ENABLE',idempotencyKey:randomUUID(),expectedRevision:'0',capability:'authorized',locale:'th',platform:'android',consentVersion:'food-transactional-v1'};
 await db.query('SAVEPOINT first_enable_revocation');
 const initialOff=await command({kind:'DISABLE',idempotencyKey:randomUUID(),expectedRevision:'0',capability:'denied',locale:'th',reason:'USER_OPT_OUT'},key0,null,null,null);
 assert.equal(initialOff.revision,'1');assert.equal((await status(key0)).consentEnabled,false);
 await denied('VERSION_CONFLICT',()=>command(enable,key0,key1));
 await db.query('ROLLBACK TO SAVEPOINT first_enable_revocation');await db.query('RELEASE SAVEPOINT first_enable_revocation');
 checks.push('Opt-out before an ambiguous first ENABLE creates a revocation tombstone that rejects late initial enable instead of silently remaining unregistered');
 await denied('INVALID_REQUEST',()=>command({...enable,kind:null},key0,key1));
 await denied('INVALID_REQUEST',()=>command({...enable,consentVersion:undefined,unknown:'value'},key0,key1));
 const first=await command(enable,key0,key1);assert.equal(first.revision,'1');assert.equal(first.generation,'1');assert.equal((await status(key1)).consentEnabled,true);
 await denied('PUSH_INSTALLATION_CONFLICT',()=>status(key0));
 const replay=await command(enable,key0,key1,hash('fixture fid'),'different-random-ciphertext-same-endpoint');assert.deepEqual(replay,{...first,replayed:true});
 await denied('IDEMPOTENCY_CONFLICT',()=>command({...enable,locale:'en'},key0,key1));
 checks.push('Strict nullable and unknown missing fields rejected; explicit enable rotates installation proof; semantic retry ignores ciphertext nonce without repeating effects');
 const rotate={kind:'ROTATE',idempotencyKey:randomUUID(),expectedRevision:'1',capability:'authorized',locale:'th'};
 const same=await command(rotate,key1,null);assert.equal(same.revision,'1');assert.equal(same.generation,'1');
 const changed=await command({...rotate,idempotencyKey:randomUUID()},key1,null,hash('replacement fixture fid'));assert.equal(changed.revision,'2');assert.equal(changed.generation,'2');
 const disable={kind:'DISABLE',idempotencyKey:randomUUID(),expectedRevision:'2',capability:'denied',locale:'th',reason:'USER_OPT_OUT'};
 const off=await command(disable,key1,null,null,null);assert.equal(off.revision,'3');assert.equal((await status(key1)).consentEnabled,false);
 await denied('PUSH_CONSENT_REQUIRED',()=>command({...rotate,expectedRevision:'3',idempotencyKey:randomUUID()},key1,null));
 const enabled=await command({...enable,idempotencyKey:randomUUID(),expectedRevision:'3'},key1,key2);assert.equal(enabled.revision,'4');
 assert.equal((await command(enable,key0,key1)).replayed,true);assert.equal((await status(key2)).revision,'4');
 checks.push('Same FID rotation is a no-op; changed FID fences generation; opt-out works without encryption/provider; late historical enable receipt never re-enables or takes proof back');
 await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=clock_timestamp() WHERE id=$1',[session]);
 const revoked=(await db.query('SELECT consent_enabled,endpoint_ciphertext,generation::text FROM bitpos.mobile_push_bindings WHERE owner_session_id=$1',[session])).rows[0];assert.deepEqual(revoked,{consent_enabled:false,endpoint_ciphertext:null,generation:'5'});
 await denied('AUTH_REQUIRED',()=>status(key2));checks.push('Canonical session revocation atomically clears endpoint and invalidates generation; revoked bearer cannot read installation');
 assert.equal((await db.query('SELECT bitpos.mobile_push_expand(1) n')).rows[0].n,0);assert.deepEqual((await db.query('SELECT bitpos.mobile_push_claim(1) v')).rows[0].v,[]);
 assert.equal((await db.query('SELECT bitpos.mobile_push_prepare($1,$2) v',[randomUUID(),randomUUID()])).rows[0].v,null);
 assert.equal((await db.query("SELECT bitpos.mobile_push_finish($1,$2,'RETRY',NULL,10) v",[randomUUID(),randomUUID()])).rows[0].v,false);
 checks.push('Worker functions compile and missing work/unknown lease cannot authorize sends or finish effects; no event-source/outbox retry/concurrency coverage claimed');
 const receipt={status:'PASS_ROLLBACK_ONLY_PUSH_BINDING_AUTHORITY_SUBUNIT',sha256:hash(migration),checks,fixture:'Synthetic accounts/session/FID hashes and non-encrypted placeholder ciphertext accepted only by internal SQL test. No API crypto, provider I/O, actual-use migration or notification delivery.',physicalTesting:'deferred_by_user_2026-10-16'};
 await db.query('ROLLBACK');await writeFile('.omp/work/flutter-delivery-20261016/evidence/notification087-binding-sql-20261019.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await db.query('ROLLBACK');await db.end();}
