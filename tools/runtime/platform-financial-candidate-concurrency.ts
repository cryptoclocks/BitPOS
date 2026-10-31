import pg from 'pg';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {parseArgs} from 'node:util';

// Proposed071 candidate only. Own schema-only loopback clone; never actual-use.
const {values}=parseArgs({options:{mode:{type:'string',default:'command'},opening:{type:'string',default:'400'},isolation:{type:'string',default:'READ COMMITTED'},shared:{type:'boolean',default:false},lifecycle:{type:'boolean',default:false}}});
assert.ok(values.mode==='command'||values.mode==='raw-fk'||values.mode==='partial'||values.mode==='refund-payout');
const refund=values.mode==='partial'||values.mode==='refund-payout';
assert.ok(values.opening==='400'||values.opening==='600');
assert.ok(values.isolation==='READ COMMITTED'||values.isolation==='SERIALIZABLE');
assert.ok(!values.shared||values.mode==='command');
assert.ok(!values.lifecycle||(values.shared&&values.mode==='command'&&values.opening==='600'),'lifecycle requires --shared --mode command --opening 600');
const base='postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture';
const bin='/opt/homebrew/opt/postgresql@17/bin/';
const root=resolve('docs/plans/database-20261017');
const candidate=join(root,'drafts/financial071');
const name='financial071_probe_'+randomUUID().replaceAll('-','');
const target=new URL(base);target.pathname='/'+name;
const scratch=await mkdtemp(join(tmpdir(),'bitpos-financial-concurrency-'));
const admin=new pg.Client({connectionString:base});await admin.connect();let created=false;
const label=[values.mode,values.opening,values.isolation.toLowerCase().replaceAll(' ','_'),values.shared?'replacement':'distinct'].join('-');
const evidencePath='.omp/work/flutter-delivery-20261016/evidence/financial071-'+(refund?'refund-':'payout-')+label+(refund?'-current082':values.lifecycle?'-lifecycle':'-observed')+'-20261017-'+Date.now()+'.json';
const evidence={status:'RUNNING',fixture:true,physicalTesting:'deferred_by_user_2026-10-16',orderedDraftIntegrated:true,copiedBusinessRows:0,cell:values,sourceHashes:{} as Record<string,string>,schemaOnlyHash:null as string|null,counterpart:null as unknown,failure:null as string|null,cleanup:false};
function run(binary:string,args:string[],env=process.env){const r=spawnSync(binary,args,{encoding:'utf8',env,maxBuffer:32*1024*1024});if(r.status!==0)throw Error(binary+' exit '+r.status+'\n'+r.stderr+'\n'+r.stdout);return r.stdout;}
try{
 await admin.query('CREATE DATABASE '+name);created=true;
 await writeFile(join(scratch,'schema.sql'),run(bin+'pg_dump',[base,'--schema-only','--no-owner','--no-privileges']));
 evidence.schemaOnlyHash=createHash('sha256').update(await readFile(join(scratch,'schema.sql'))).digest('hex');
 run(bin+'psql',[target.href,'-X','-q','-v','ON_ERROR_STOP=1','-f',join(scratch,'schema.sql')]);
 const assets=(await readFile(resolve('supabase/migrations/025_payment_assets.sql'),'utf8')).match(/INSERT INTO payment_assets VALUES[\s\S]*?;/)?.[0];assert.ok(assets);
 const drafts=(await readdir(join(root,'drafts'))).filter(n=>n.endsWith('.sql')).sort();
 assert.ok(drafts[0]==='060_platform_foundations.sql'&&drafts.at(-1)==='082_custody_financial_settlement.sql'&&drafts.includes('071_financial_closure.sql')&&drafts.includes('072_commerce_closure.sql'),'current ordered proposed060–082 chain required');
 const chain=drafts.map(n=>join(root,'drafts',n));
 const fixtureInputs=['071-fixture-base.sql','071-fixture-pickup-constructor.sql','fixture071-actors-food-payout.sql',...(refund?['071-refund-concurrency-seed.sql','refund_two_client071.py']:['071-payout-concurrency-seed.sql','payout_two_client071.py',...(values.lifecycle?['payout_acceptance071.py']:[])])];
 const inputs=[...chain,resolve('supabase/migrations/025_payment_assets.sql'),resolve('tools/runtime/platform-financial-candidate-concurrency.ts'),...fixtureInputs.map(n=>join(candidate,n))];
 for(const path of inputs)evidence.sourceHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
 await writeFile(join(scratch,'drafts.sql'),'BEGIN;SET search_path=bitpos,public;\n'+assets+'\n'+chain.map(n=>'\\ir '+n).join('\n')+'\nCOMMIT;\n');
 run(bin+'psql',[target.href,'-X','-q','-v','ON_ERROR_STOP=1','-f',join(scratch,'drafts.sql')]);
 const manifest=join(scratch,'seed.json');
 const extension=join(scratch,'extension.json');
 run(bin+'psql',[target.href,'-X','-q','-v','ON_ERROR_STOP=1','-v','payable_minor='+values.opening,'-v','shared_source='+String(values.shared),'-v','acceptance_pending='+String(values.lifecycle),'-v','extension_manifest='+extension,'-v','manifest='+manifest,'-f',join(candidate,refund?'071-refund-concurrency-seed.sql':'071-payout-concurrency-seed.sql')]);
 const receipt=join(scratch,'receipt.json');
 try{run('/tmp/bitpos-openapi-validator-20261017/bin/python',[join(candidate,refund?'refund_two_client071.py':values.lifecycle?'payout_acceptance071.py':'payout_two_client071.py'),'--manifest',manifest,'--isolation',values.isolation,'--mode',values.mode,...(values.lifecycle?['--extension',extension]:[]),'--output',receipt],{...process.env,FINANCIAL071_DISPOSABLE_DSN:target.href});}
 finally{try{evidence.counterpart=JSON.parse(await readFile(receipt,'utf8'));}catch{/* Preserve process/seed failure rather than inventing counterpart state. */}}
 for(const [check,passed] of Object.entries((evidence.counterpart as {assertions:Record<string,boolean>}).assertions))assert.equal(passed,true,check);
 evidence.status='PASS';
}catch(error){evidence.status='FAIL';evidence.failure=String(error);process.exitCode=1;}
finally{
 if(created){await admin.query('DROP DATABASE '+name);assert.equal((await admin.query('SELECT count(*)::integer n FROM pg_database WHERE datname=$1',[name])).rows[0].n,0);}
 await admin.end();await rm(scratch,{recursive:true});evidence.cleanup=true;
 await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:evidence.status,cell:values,cleanup:evidence.cleanup,failure:evidence.failure,evidencePath}));
}
