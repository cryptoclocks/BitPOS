import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',ADMIN_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
const {default:pg}=await import('pg');
const {pool}=await import('../../apps/api/src/db');
const {MobileProfileSchema,MobileAddressSchema,MobileAddressesSchema}=await import('../../packages/contracts/src/mobile-v1.generated');
const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
const a=randomUUID(),b=randomUUID(),tokenA=randomBytes(32).toString('base64url'),tokenB=randomBytes(32).toString('base64url');
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
let assertions=0;
function check(value:unknown,message:string){assert.ok(value,message);assertions++;}
async function request(path:string,method='GET',body?:unknown,token=tokenA,expected=200){
 const response=await fetch('http://127.0.0.1:3001/api/mobile/v1/'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));assertions++;return value;
}
const fields={label:'Local fixture home',recipientName:'Fixture customer',phone:'+66900000001',addressText:'Synthetic address for local tests only',instructions:'No real delivery',latitudeE7:null,longitudeE7:null};
try{
 for(const [account,token] of [[a,tokenA],[b,tokenB]]){
  await admin.query('INSERT INTO bitpos.mobile_accounts(id,auth_subject) VALUES($1,$2)',[account,randomUUID()]);
  await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[account,randomUUID(),digest(token),digest(randomBytes(32).toString('base64url'))]);
 }
 await request('account/profile','GET',undefined,'',401);
 const initial=MobileProfileSchema.parse(await request('account/profile'));
 const profileCommand={displayName:'Local profile fixture',locale:'en',expectedVersion:initial.version,idempotencyKey:randomUUID()};
 const profile=MobileProfileSchema.parse(await request('account/profile','PUT',profileCommand));check(profile.id===a&&profile.version==='2','own profile advances once');
 assert.deepEqual(await request('account/profile','PUT',profileCommand),profile);assertions++;
 await request('account/profile','PUT',{...profileCommand,displayName:'tampered'},tokenA,409);
 await request('account/profile','PUT',{...profileCommand,idempotencyKey:randomUUID()},tokenA,409);
 check(MobileProfileSchema.parse(await request('account/profile','GET',undefined,tokenB)).displayName==='','other profile unchanged');
 const create={idempotencyKey:randomUUID(),address:fields};
 const duplicate=await Promise.all([request('account/addresses','POST',create),request('account/addresses','POST',create)]);
 const address=MobileAddressSchema.parse(duplicate[0]);check(duplicate[1].id===address.id,'double create/retry one address');
 check(MobileAddressesSchema.parse(await request('account/addresses','GET',undefined,tokenB)).addresses.length===0,'B cannot list A addresses');
 await request('account/addresses','POST',{...create,accountId:b},tokenA,422);
 await request('account/addresses','POST',{idempotencyKey:randomUUID(),address:{...fields,latitudeE7:1}},tokenA,422);
 await request('account/addresses','POST',{idempotencyKey:randomUUID(),address:{...fields,latitudeE7:900000001,longitudeE7:0}},tokenA,422);
 await request('account/addresses','POST',{idempotencyKey:randomUUID(),address:{...fields,label:'   '}},tokenA,422);
 const update={expectedVersion:address.version,idempotencyKey:randomUUID(),address:{...fields,label:'Updated fixture',latitudeE7:137563000,longitudeE7:1005018000}};
 await request('account/addresses/'+address.id,'PUT',update,tokenB,404);
 const updated=MobileAddressSchema.parse(await request('account/addresses/'+address.id,'PUT',update));check(updated.version==='2'&&updated.address.longitudeE7===1005018000,'owned address version and coordinates retained exactly');
 assert.deepEqual(await request('account/addresses/'+address.id,'PUT',update),updated);assertions++;
 await request('account/addresses/'+address.id,'PUT',{...update,idempotencyKey:randomUUID()},tokenA,409);
 await request('account/addresses/'+address.id,'PUT',{...update,address:{...update.address,label:'tampered'}},tokenA,409);
 const scoped=await pool.connect();try{
  await scoped.query('BEGIN');await scoped.query("SELECT set_config('bitpos.mobile_account',$1,true)",[b]);
  check((await scoped.query('SELECT id FROM mobile_addresses WHERE account_id=$1',[a])).rowCount===0,'RLS independently hides foreign addresses');
  check((await scoped.query('SELECT idempotency_key FROM mobile_account_commands WHERE account_id=$1',[a])).rowCount===0,'RLS independently hides foreign command snapshots');
  await scoped.query('ROLLBACK');
 }finally{scoped.release();}
 await admin.query("INSERT INTO bitpos.mobile_addresses(account_id,label,recipient_name,phone,address_text,instructions) SELECT $1,'Capacity fixture '||n,'Fixture customer','+66900000001','Synthetic address','No delivery' FROM generate_series(1,48) n",[a]);
 const cap=await Promise.all([1,2].map(async n=>{
  const response=await fetch('http://127.0.0.1:3001/api/mobile/v1/account/addresses',{method:'POST',headers:{Authorization:'Bearer '+tokenA,'Content-Type':'application/json'},body:JSON.stringify({idempotencyKey:randomUUID(),address:{...fields,label:'Last capacity '+n}})});return {status:response.status,value:await response.json()};
 }));
 check(cap.filter(r=>r.status===200).length===1&&cap.filter(r=>r.status===409&&r.value.error.code==='ADDRESS_LIMIT').length===1,'concurrent last address slot admits one winner');
 const ids=new Set<string>();let cursor:string|null=null;let pages=0;
 do{
  const page=MobileAddressesSchema.parse(await request('account/addresses'+(cursor?'?cursor='+cursor:'')));pages++;
  for(const row of page.addresses){check(!ids.has(row.id),'cursor does not duplicate address');ids.add(row.id);}cursor=page.nextCursor;
 }while(cursor);
 check(ids.size===50&&pages===3,'all50 active addresses reachable by bounded cursors');
 const archive={expectedVersion:updated.version,idempotencyKey:randomUUID()};
 await request('account/addresses/'+updated.id+'/archive','POST',archive,tokenB,404);
 const archived=MobileAddressSchema.parse(await request('account/addresses/'+updated.id+'/archive','POST',archive));check(archived.archived&&archived.version==='3','archive advances owned address once');
 assert.deepEqual(await request('account/addresses/'+updated.id+'/archive','POST',archive),archived);assertions++;
 await request('account/addresses/'+updated.id,'PUT',{...update,expectedVersion:'3',idempotencyKey:randomUUID()},tokenA,404);
 await request('account/addresses','POST',{idempotencyKey:randomUUID(),address:{...fields,label:'Replacement after archive'}});
 await admin.query('UPDATE bitpos.mobile_sessions SET revoked_at=clock_timestamp() WHERE account_id=$1',[a]);
 await request('account/profile','GET',undefined,tokenA,401);
 await request('account/addresses','POST',{idempotencyKey:randomUUID(),address:fields},tokenA,401);
 const persisted=(await admin.query('SELECT count(*) FILTER(WHERE NOT archived)::int AS active,count(*) FILTER(WHERE archived)::int AS archived FROM bitpos.mobile_addresses WHERE account_id=$1',[a])).rows[0];
 assert.deepEqual(persisted,{active:50,archived:1});assertions++;
 const receipt={environment:'local_disposable_fixture',assertions,persisted,profileVersion:profile.version,pages,coverage:['auth/revoke','profile version/idempotency','address double create','cross-account API and RLS','coordinate bounds/pair','stale update/payload conflict','last-slot concurrency','cursor completeness','archive replay'],limits:['Direct SQL-only account/session fixtures; no OTP/provider or merchant data','HTTP and persisted counterpart only; AVD surface proof separate'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-profile-address-http.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await admin.end();await pool.end();}
