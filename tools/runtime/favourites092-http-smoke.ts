import assert from 'node:assert/strict';import {randomUUID,randomBytes,createHash} from 'node:crypto';import {writeFile} from 'node:fs/promises';import pg from 'pg';
const databaseUrl=process.env.BITPOS_DELIVERY_FIXTURE_DATABASE_URL??'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture';
const fixtureDatabase=new URL(databaseUrl);if(fixtureDatabase.hostname!=='127.0.0.1'||fixtureDatabase.pathname!=='/bitpos_delivery_fixture')throw Error('Refusing non-disposable favourites database URL');
const db=new pg.Client({connectionString:databaseUrl}),sessions:string[]=[],accounts:string[]=[],branch=randomUUID(),merchant=randomUUID();
const base=process.env.BITPOS_FIXTURE_API_BASE??'http://127.0.0.1:3033/api/mobile/v1/';await db.connect();
try{
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 // Create isolated synthetic identities so this check works on a clean fixture
 // without depending on another smoke test's leftovers.
 for(let i=0;i<2;i++)accounts.push((await db.query("INSERT INTO bitpos.mobile_accounts(auth_subject,display_name) VALUES($1,$2) RETURNING id",[randomUUID(),'Favourite HTTP fixture '+i])).rows[0].id);
 await db.query("INSERT INTO bitpos.merchants(id,name,treasury) VALUES($1,'Direct favourite fixture','11111111111111111111111111111111')",[merchant]);
 await db.query("INSERT INTO bitpos.marketplace_branches(merchant_id,id,name,name_en,enabled) VALUES($1,$2,'ร้านโปรดทดสอบ','Favourite fixture',true)",[merchant,branch]);
 const tokens:string[]=[];
 for(const account of accounts){const token=randomBytes(32).toString('base64url'),id=randomUUID();sessions.push(id);tokens.push(token);await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '10 minutes',clock_timestamp()+interval '10 minutes')",[id,account,randomUUID(),createHash('sha256').update(token).digest('hex'),createHash('sha256').update(randomBytes(32)).digest('hex')]);}
 async function call(account:number,path:string,method='GET',body?:unknown,status=200){const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+tokens[account],'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;}
 const path='account/favourites/'+branch;
 await Promise.all(Array.from({length:20},()=>call(0,path,'PUT',{favourite:true})));await call(0,path,'PUT',{favourite:true});
 assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.mobile_favourite_branches WHERE branch_id=$1',[branch])).rows[0].n,1);
 const own=await call(0,'account/favourites');assert.equal(own.items.find((x:any)=>x.branchId===branch).branch.nameEn,'Favourite fixture');
 assert.ok(!(await call(1,'account/favourites')).items.some((x:any)=>x.branchId===branch));await call(1,path,'PUT',{favourite:false});
 assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.mobile_favourite_branches WHERE branch_id=$1',[branch])).rows[0].n,1);
 await db.query('UPDATE bitpos.marketplace_branches SET enabled=false WHERE id=$1',[branch]);assert.equal((await call(0,'account/favourites')).items.find((x:any)=>x.branchId===branch).branch,null);
 await call(0,path,'PUT',{favourite:true},404);await call(0,path,'PUT',{favourite:false});await call(0,path,'PUT',{favourite:false});await call(0,'account/favourites?cursor=bad','GET',undefined,422);await call(0,'account/favourites?cursor=','GET',undefined,422);await call(0,'account/favourites?cursor='+branch+'&cursor='+branch,'GET',undefined,422);
 const receipt={status:'PASS_ACTUAL_LOCAL_FAVOURITES_HTTP_SQL',checks:['Twenty concurrent absolute writes complete and retain one row','Owner public branch projection','Foreign list and delete isolated','Disabled branch private projection absent','Disabled addition refused but removal works','Malformed cursor422'],limits:['Fresh synthetic sessions and branch on local disposable fixture; not AVD or production'],physicalTesting:'deferred_by_user_2026-10-16'};await writeFile('.omp/work/flutter-delivery-20261016/evidence/favourites092-http-direct-20261019.json',JSON.stringify(receipt,null,2)+'\n');console.log(receipt.status);
}finally{
 await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=ANY($1::uuid[])',[sessions]);await db.query('UPDATE bitpos.mobile_accounts SET disabled_at=COALESCE(disabled_at,clock_timestamp()) WHERE id=ANY($1::uuid[])',[accounts]);await db.query('DELETE FROM bitpos.merchant_payment_assets WHERE merchant_id=$1',[merchant]); await db.query('DELETE FROM bitpos.mobile_favourite_branches WHERE branch_id=$1',[branch]);await db.query('DELETE FROM bitpos.marketplace_branches WHERE id=$1',[branch]);await db.query('DELETE FROM bitpos.merchants WHERE id=$1',[merchant]);await db.end();
}
