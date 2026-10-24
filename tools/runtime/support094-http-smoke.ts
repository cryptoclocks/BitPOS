import assert from 'node:assert/strict';import {randomUUID,randomBytes,createHash} from 'node:crypto';import {writeFile} from 'node:fs/promises';import pg from 'pg';
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'}),accounts:string[]=[],sessions:string[]=[],tokens:string[]=[],grants:string[]=[];let ticket:string|undefined;
await db.connect();
try{
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 for(let i=0;i<3;i++){const account=randomUUID(),id=randomUUID(),token=randomBytes(32).toString('base64url');accounts.push(account);sessions.push(id);tokens.push(token);await db.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,display_name)VALUES($1,$2,'Support HTTP fixture')",[account,randomUUID()]);await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at)VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes',now()+interval '10 minutes')",[id,account,randomUUID(),createHash('sha256').update(token).digest('hex'),createHash('sha256').update(randomBytes(32)).digest('hex')]);}
 const grant=(await db.query("INSERT INTO bitpos.platform_staff_role_grants(account_id,role,granted_by,expires_at)VALUES($1,'support','support094 HTTP fixture',now()+interval '10 minutes')RETURNING id",[accounts[1]])).rows[0].id;grants.push(grant);
 async function call(account:number,path:string,method='GET',body?:unknown,status=200){const r=await fetch('http://127.0.0.1:3040/api/mobile/v1/'+path,{method,headers:{Authorization:'Bearer '+tokens[account],'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const value=await r.json();assert.equal(r.status,status,JSON.stringify(value));return value;}
 const c=await call(0,'account/support','POST',{commandId:randomUUID(),subject:'Support HTTP fixture',message:'Customer question',order:null});ticket=c.id;
 const queue='platform/support?queue=general&purpose=Resolve%20fixture';await call(0,queue,'GET',undefined,403);await call(1,queue,'GET',undefined,403);
 await db.query("INSERT INTO bitpos.platform_support_general_grants(grant_id,granted_by)VALUES($1,'direct HTTP fixture')",[grant]);assert.ok((await call(1,queue)).items.some((x:any)=>x.id===ticket));
 const path='platform/support/'+ticket,read=()=>call(1,path+'?purpose=Resolve%20fixture');let detail=await read();assert.equal(detail.ticket.version,'2');
 const reply={commandId:randomUUID(),expectedVersion:'2',action:'REPLY',message:'Support team response',reason:'Answer question'};
 const values=await Promise.all(Array.from({length:8},()=>call(1,path,'POST',reply)));assert.ok(values.every(v=>v.version==='3'));
 await call(1,path,'POST',{...reply,message:'Changed'},409);
 const customer=await call(0,'account/support/'+ticket+'/messages');assert.equal(customer.items.length,2);assert.equal(customer.items[1].authorKind,'STAFF');
 await call(2,'account/support/'+ticket+'/messages','GET',undefined,404);await call(2,path+'?purpose=Forbidden','GET',undefined,403);
 detail=await read();await call(1,path,'POST',{...reply,commandId:randomUUID(),action:'RESOLVE',message:'',expectedVersion:'2'},409);
 const resolved=await call(1,path,'POST',{...reply,commandId:randomUUID(),action:'RESOLVE',message:'',expectedVersion:detail.ticket.version});assert.equal(resolved.state,'RESOLVED');
 await call(0,'account/support/'+ticket+'/messages','POST',{commandId:randomUUID(),message:'After close'},409);
 const reopened=await call(1,path,'POST',{...reply,commandId:randomUUID(),action:'REOPEN',message:'',expectedVersion:resolved.version});assert.equal(reopened.state,'OPEN');
 const waiting=await call(1,path,'POST',{...reply,commandId:randomUUID(),action:'WAIT',message:'',expectedVersion:reopened.version});assert.equal(waiting.state,'WAITING_CUSTOMER');
 await call(0,'account/support/'+ticket+'/messages','POST',{commandId:randomUUID(),message:'More details'});detail=await read();assert.equal(detail.ticket.state,'OPEN');assert.equal(detail.messages.items.length,3);
 await db.query('UPDATE bitpos.platform_staff_role_grants SET revoked_at=now() WHERE id=$1',[grant]);await call(1,queue,'GET',undefined,403);
 const counts=(await db.query('SELECT (SELECT count(*)::int FROM bitpos.mobile_support_staff_commands WHERE case_id=$1) commands,(SELECT count(*)::int FROM bitpos.mobile_support_access_audit WHERE case_id=$1) audits',[ticket])).rows[0];assert.equal(counts.commands,4);assert.ok(counts.audits>=7);
 const receipt={status:'PASS_ACTUAL_LOCAL_SUPPORT_STAFF_HTTP_SQL',ticket,counts,checks:['Explicit general scope required','8 concurrent reply replays one effect','Changed replay and stale resolution409','Customer sees staff response','Unrelated accounts denied','Resolve blocks messages; reopen permits; customer reply reopens waiting case','Revoked grant403'],limits:['Synthetic identities, local fixture; immutable command/access audit retained, all test accounts disabled and sessions/grants revoked in finally','No native/browser acceptance']};await writeFile('.omp/work/flutter-delivery-20261016/evidence/support094-http-direct-20261019.json',JSON.stringify(receipt,null,2)+'\n');console.log(receipt.status);
}finally{
 await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=ANY($1::uuid[])',[sessions]);await db.query('UPDATE bitpos.platform_staff_role_grants SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=ANY($1::uuid[])',[grants]);await db.query('UPDATE bitpos.mobile_accounts SET disabled_at=clock_timestamp() WHERE id=ANY($1::uuid[])',[accounts]);await db.end();
}
