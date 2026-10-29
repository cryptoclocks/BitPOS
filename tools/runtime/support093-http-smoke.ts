import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import pg from 'pg';
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'}),sessions:string[]=[],created:string[]=[];
const base='http://127.0.0.1:3040/api/mobile/v1/',tokens:string[]=[];await db.connect();
try{
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 const accounts=(await db.query('SELECT id FROM bitpos.mobile_accounts WHERE disabled_at IS NULL ORDER BY id LIMIT 2')).rows;assert.equal(accounts.length,2);
 for(const account of accounts){const token=randomBytes(32).toString('base64url'),id=randomUUID();sessions.push(id);tokens.push(token);await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '10 minutes',clock_timestamp()+interval '10 minutes')",[id,account.id,randomUUID(),createHash('sha256').update(token).digest('hex'),createHash('sha256').update(randomBytes(32)).digest('hex')]);}
 async function call(account:number,path:string,method='GET',body?:unknown,status=200){const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+tokens[account],'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;}
 const command={commandId:randomUUID(),subject:'Local support fixture',message:'Question persisted once',order:null};
 const responses=await Promise.all(Array.from({length:12},()=>call(0,'account/support','POST',command)));const ticket=responses[0];created.push(ticket.id);assert.ok(responses.every(r=>r.id===ticket.id));
 assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.mobile_support_cases WHERE account_id=$1 AND command_id=$2',[accounts[0].id,command.commandId])).rows[0].n,1);
 await call(0,'account/support','POST',{...command,subject:'Changed replay'},409);
 assert.ok((await call(0,'account/support')).items.some((r:any)=>r.id===ticket.id));assert.ok(!(await call(1,'account/support')).items.some((r:any)=>r.id===ticket.id));
 const path=`account/support/${ticket.id}/messages`,message={commandId:randomUUID(),message:'Follow-up'};
 await call(1,path,'GET',undefined,404);await call(1,path,'POST',message,404);
 const replies=await Promise.all(Array.from({length:12},()=>call(0,path,'POST',message)));assert.ok(replies.every(r=>r.id===replies[0].id));await call(0,path,'POST',{...message,message:'Changed replay'},409);
 const page=await call(0,path);assert.equal(page.items.length,2);assert.equal(page.items[0].body,command.message);assert.equal(page.items[1].body,message.message);
 await call(0,path+'?cursor=','GET',undefined,422);await call(0,path+'?cursor='+randomUUID(),'GET',undefined,404);await call(0,path,'POST',{...message,authorKind:'STAFF'},422);
 const linked=(await db.query('SELECT merchant_id,order_id,account_id FROM bitpos.online_food_orders WHERE account_id<>$1 LIMIT 1',[accounts[0].id])).rows[0];assert.ok(linked);await call(0,'account/support','POST',{...command,commandId:randomUUID(),order:{merchantId:linked.merchant_id,orderId:linked.order_id}},404);
 await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=clock_timestamp() WHERE id=$1',[sessions[0]]);await call(0,path,'GET',undefined,401);
 const receipt={status:'PASS_ACTUAL_LOCAL_SUPPORT_HTTP_SQL',checks:['12 concurrent case replays persist one case and initial message','Changed case/message replay409','Foreign read/write404','12 concurrent message replays persist one reply','Chronological messages','Empty cursor422 / unknown cursor404','Forged author422','Foreign linked order404','Revoked session401'],limits:['Synthetic sessions and local fixture only; no staff workflow or native acceptance']};await writeFile('.omp/work/flutter-delivery-20261016/evidence/support093-http-direct-20261019.json',JSON.stringify(receipt,null,2)+'\n');console.log(receipt.status);
}finally{
 await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=clock_timestamp() WHERE id=ANY($1::uuid[])',[sessions]);
 // Remove only fresh fixture command IDs, including cases committed before a client assertion failed.
 for(const id of created){await db.query('DELETE FROM bitpos.mobile_support_messages WHERE case_id=$1',[id]);await db.query('DELETE FROM bitpos.mobile_support_cases WHERE id=$1',[id]);}await db.end();
}
