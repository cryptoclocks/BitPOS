// Synthetic W01 data only, cloned privately; no source mutation or API interruption.
import assert from'node:assert/strict';import pg from'pg';import{mkdtemp,readFile,writeFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{randomUUID,createHash}from'node:crypto';import{execFile}from'node:child_process';import{promisify}from'node:util';
const exec=promisify(execFile),bin='/opt/homebrew/opt/postgresql@17/bin',dir=await mkdtemp(join(tmpdir(),'bitpos-return108-')),admin=new pg.Client({host:'127.0.0.1',port:55446,database:'bitpos_w01_fixture'});await admin.connect();
const source=await readFile('supabase/migrations/108_food_return_cases.sql','utf8'),prior=JSON.parse(await readFile('.omp/work/flutter-delivery-20261016/evidence/w02-delivery-issue-avd-20261021.json','utf8')),results:any[]=[];const databases:string[]=[];
try{
 assert.equal((await admin.query('SELECT current_database() n')).rows[0].n,'bitpos_w01_fixture');assert.equal((await admin.query('SELECT count(*)::int n FROM public.bitpos_fixture_migrations')).rows[0].n,102);
 await exec(bin+'/pg_dump',['-h','127.0.0.1','-p','55446','-d','bitpos_w01_fixture','-Fc','-f',join(dir,'fixture.dump')]);
 for(const requestFirst of [true,false]){
  const name='bitpos_return108_probe_'+randomUUID().replaceAll('-','').slice(0,12);databases.push(name);assert.match(name,/^bitpos_return108_probe_[a-f0-9]{12}$/);
  await admin.query('CREATE DATABASE '+name);
  await exec(bin+'/pg_restore',['-h','127.0.0.1','-p','55446','-d',name,'--no-owner','--disable-triggers','--exit-on-error',join(dir,'fixture.dump')],{maxBuffer:1024*1024});
  const make=async()=>{const c=new pg.Client({host:'127.0.0.1',port:55446,database:name});await c.connect();return c;};
  const setup=await make(),request=await make(),resume=await make();let pending:Promise<any>[]=[];
  try{
   await setup.query(source);const row=(await setup.query('SELECT a.*,s.merchant_id FROM bitpos.food_assignments a JOIN bitpos.food_shipments s ON s.id=a.shipment_id WHERE a.id=$1',[prior.assignmentId])).rows[0];
   const actor=randomUUID(),sid=randomUUID(),grant=randomUUID(),access=createHash('sha256').update(sid).digest('hex');
   await setup.query('INSERT INTO bitpos.mobile_accounts(id,auth_subject)VALUES($1,$1)',[actor]);
   await setup.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at)VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[sid,actor,randomUUID(),access,createHash('sha256').update('refresh'+sid).digest('hex')]);
   await setup.query("INSERT INTO bitpos.platform_staff_role_grants(id,account_id,role,granted_by,expires_at)VALUES($1,$2,'dispatcher','108 cloned fixture',clock_timestamp()+interval '1 hour')",[grant,actor]);await setup.query('INSERT INTO bitpos.platform_role_scopes VALUES($1,$2)',[grant,row.merchant_id]);
   async function context(c:pg.Client){await c.query("SELECT set_config('bitpos.mobile_account',$1,false),set_config('bitpos.mobile_session',$2,false),set_config('bitpos.mobile_access_hash',$3,false),set_config('bitpos.merchant',$4,false)",[actor,sid,access,row.merchant_id]);}
   await context(setup);
   // The source cohort was deliberately disabled during cleanup. Reactivate
   // only its synthetic assigned driver in this private clone and issue a fresh
   // real scoped service grant, instead of weakening resume authority.
   await setup.query('UPDATE bitpos.mobile_accounts SET disabled_at=NULL WHERE id=(SELECT account_id FROM bitpos.driver_profiles WHERE id=$1)',[row.driver_id]);
   const service=(await setup.query('SELECT branch_id,revision::text FROM bitpos.driver_food_service_grants WHERE driver_id=$1 AND merchant_id=$2',[row.driver_id,row.merchant_id])).rows[0];assert.ok(service);
   await setup.query('SELECT bitpos.food_discovery_service_command($1,$2,$3,$4)',[row.driver_id,row.merchant_id,service.branch_id,{idempotencyKey:randomUUID(),expectedVersion:service.revision,enabled:true,validUntil:new Date(Date.now()+600000).toISOString(),reason:'Synthetic clone-scoped service authority for race'}]);
   const incident=(await setup.query('SELECT id,version::text FROM bitpos.food_assignment_incidents WHERE assignment_id=$1 AND blocks_duty AND resolved_at IS NULL',[row.id])).rows[0];assert.ok(incident);
   await setup.query('SELECT bitpos.dispatch_food_ack_incident($1,$2)',[incident.id,{idempotencyKey:randomUUID(),expectedVersion:incident.version,reason:'Synthetic ACK for return versus resume race'}]);
   const version=(await setup.query('SELECT version::text FROM bitpos.food_shipments WHERE id=$1',[row.shipment_id])).rows[0].version;
   const payload={expectedVersion:version,generation:String(row.generation),leaseGeneration:String(row.lease_generation),reason:'Synthetic cloned concurrency authority'};
   await context(request);await context(resume);
   await setup.query('BEGIN');await setup.query('SELECT id FROM bitpos.food_shipments WHERE id=$1 FOR UPDATE',[row.shipment_id]);
   const send=(client:pg.Client,fn:string)=>client.query('SELECT bitpos.'+fn+'($1,$2) value',[row.id,{...payload,idempotencyKey:randomUUID()}]).then(r=>({status:'ok',value:r.rows[0].value}),e=>({status:'error',message:e.message}));
   async function waitFor(n:number){const until=Date.now()+1000;while(Date.now()<until){await setup.query('SELECT pg_stat_clear_snapshot()');const count=(await setup.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND query LIKE 'SELECT bitpos.%'",[name])).rows[0].n;if(count>=n)return;await new Promise(r=>setTimeout(r,5));}throw Error('Did not observe'+n+' actual locked SQL contenders');}
   pending.push(requestFirst?send(request,'food_return108_request'):send(resume,'dispatch_food_resume_incidents'));await waitFor(1);
   pending.push(requestFirst?send(resume,'dispatch_food_resume_incidents'):send(request,'food_return108_request'));await waitFor(2);await setup.query('COMMIT');
   const outcomes=await Promise.all(pending);assert.equal(outcomes[0].status,'ok',JSON.stringify({requestFirst,outcomes}));assert.equal(outcomes[1].status,'error');assert.equal(outcomes[1].message,requestFirst?'RETURN_CASE_REQUIRES_RESOLUTION':'VERSION_CONFLICT');
   const state=(await setup.query("SELECT a.state,l.state lease,(SELECT count(*)::int FROM bitpos.food_return108_cases WHERE assignment_id=a.id) cases,(SELECT count(*)::int FROM bitpos.food_assignment_incidents WHERE assignment_id=a.id AND blocks_duty AND resolved_at IS NULL) blocking,(SELECT count(*)::int FROM bitpos.refunds WHERE order_id=s.order_id) refunds,(SELECT count(*)::int FROM bitpos.earning_accruals WHERE food_assignment_id=a.id) earnings FROM bitpos.food_assignments a JOIN bitpos.driver_assignment_leases l ON l.id=a.lease_id JOIN bitpos.food_shipments s ON s.id=a.shipment_id WHERE a.id=$1",[row.id])).rows[0];
   assert.deepEqual(state,{state:'PICKED_UP',lease:'ACTIVE',cases:requestFirst?1:0,blocking:requestFirst?1:0,refunds:0,earnings:0});let closure:any=null;
   if(requestFirst){
    const caseId=outcomes[0].value.caseId,user=randomUUID(),sessionHash=createHash('sha256').update(randomUUID()).digest('hex');
    await setup.query("INSERT INTO bitpos.members VALUES($1,$2,'owner');",[user,row.merchant_id]);await setup.query("INSERT INTO bitpos.sessions VALUES($1,$2,$3,'owner',clock_timestamp()+interval '1 hour')",[sessionHash,user,row.merchant_id]);
    const version=async()=>String((await setup.query('SELECT version::text FROM bitpos.food_shipments WHERE id=$1',[row.shipment_id])).rows[0].version);
    await setup.query('SELECT bitpos.food_return108_receive($1,$2,$3)',[caseId,sessionHash,{idempotencyKey:randomUUID(),expectedVersion:await version(),condition:'DAMAGED',reason:'Synthetic received-back attestation, not physical proof'}]);
    const cmd={idempotencyKey:randomUUID(),expectedVersion:await version(),reason:'Synthetic explicit return completion; financial review remains pending'};
    const resolve=(client:pg.Client)=>client.query('SELECT bitpos.food_return108_resolve($1,$2) value',[caseId,cmd]).then(r=>({status:'ok',value:r.rows[0].value}),e=>({status:'error',message:e.message}));
    await setup.query('BEGIN');await setup.query('SELECT id FROM bitpos.food_shipments WHERE id=$1 FOR UPDATE',[row.shipment_id]);pending=[];
    pending.push(resolve(request));await waitFor(1);pending.push(resolve(resume));await waitFor(2);await setup.query('COMMIT');
    const replies=await Promise.all(pending);assert.equal(replies[0].status,'ok',JSON.stringify(replies));assert.deepEqual(replies[0],replies[1]);
    const final=(await setup.query("SELECT a.state,l.state lease,s.state shipment,(SELECT count(*)::int FROM bitpos.food_return108_resolutions WHERE case_id=$2) resolutions,(SELECT count(*)::int FROM bitpos.food_return108_financial_reviews WHERE case_id=$2) reviews,(SELECT count(*)::int FROM bitpos.shipment_events WHERE shipment_id=s.id AND type='DELIVERY_RETURN_RESOLVED') events,(SELECT count(*)::int FROM bitpos.earning_accruals WHERE food_assignment_id=a.id) earnings,(SELECT count(*)::int FROM bitpos.refunds WHERE order_id=s.order_id) refunds FROM bitpos.food_assignments a JOIN bitpos.driver_assignment_leases l ON l.id=a.lease_id JOIN bitpos.food_shipments s ON s.id=a.shipment_id WHERE a.id=$1",[row.id,caseId])).rows[0];
    assert.deepEqual(final,{state:'RETURNED',lease:'RELEASED',shipment:'FAILED',resolutions:1,reviews:1,events:1,earnings:0,refunds:0});closure={observedRootContenders:2,replies,final};
   }
   results.push({requestFirst,observedRootContenders:2,outcomes,state,closure});
  }finally{await setup.query('ROLLBACK');await Promise.allSettled(pending);await Promise.all([setup.end(),request.end(),resume.end()]);}
  await admin.query('DROP DATABASE '+name);databases.splice(databases.indexOf(name),1);
 }
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/w02-return108-resume-race-20261021.json',JSON.stringify({status:'PASS_PRIVATE_RETURN_RESUME_CONCURRENT_ROOT_ORDERINGS',checkedAtUtc:new Date().toISOString(),migrationSha256:createHash('sha256').update(source).digest('hex'),results,cleanup:'Both private synthetic clones dropped; dump removed in finally',limits:['Private SQL candidate, no API/UI/actual-use admission or terminal resolution','Source fixture read only; actual 2concurrent SQL functions on cloned complete schema','No provider/funds/physical return proof','Operational closure tested; refund/compensation execution remains pending']},null,2)+'\n');console.log('PASS_PRIVATE_RETURN_RESUME_CONCURRENT_ROOT_ORDERINGS');
}finally{for(const name of databases)await admin.query('DROP DATABASE '+name);await admin.end();await rm(dir,{recursive:true,force:true});}
