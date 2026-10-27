import pg from 'pg';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cp,symlink,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const base='postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture';
const bin='/opt/homebrew/opt/postgresql@17/bin/';
const root=resolve('docs/plans/database-20261017');
const candidate=process.env.BITPOS_COMMERCE_FIXTURE_ROOT??join(root,'drafts/commerce077/fixtures-r2');
const name='probe_'+randomUUID().replaceAll('-','')+'_commerce072_disposable';
const target=new URL(base);target.pathname='/'+name;
const scratch=await mkdtemp(join(tmpdir(),'bitpos-commerce-concurrency-'));
const admin=new pg.Client({connectionString:base});await admin.connect();let created=false;
const evidencePath=process.env.BITPOS_COMMERCE_EVIDENCE??'.omp/work/flutter-delivery-20261016/evidence/commerce077-candidate-concurrency-20261017.json';
const evidence={status:'RUNNING',fixture:true,physicalTesting:'deferred_by_user_2026-10-16',orderedDraftIntegrated:true,copiedBusinessRows:0,sourceSha256:{} as Record<string,string>,counterpart:null as unknown,failure:null as string|null,cleanup:false};
function run(binary:string,args:string[],env=process.env){const r=spawnSync(binary,args,{encoding:'utf8',env,maxBuffer:32*1024*1024});if(r.status!==0)throw Error(binary+' exit '+r.status+'\n'+r.stderr+'\n'+r.stdout);return r.stdout;}
try{
 const runtimeRoot=process.env.COMMERCE077_RUNTIME_ROOT??join(scratch,'runtime');
 if(!process.env.COMMERCE077_RUNTIME_ROOT){
  for(const path of ['apps/api/src','apps/worker/src','packages/contracts','packages/domain','package.json','tsconfig.json'])await cp(resolve(path),join(runtimeRoot,path),{recursive:true});
  await symlink(resolve('node_modules'),join(runtimeRoot,'node_modules'),'dir');
  const patch=join(root,'drafts/commerce077/node-cutover.NOT-ACTIVATED.patch');
  for(const args of [['apply','--check',patch],['apply',patch]]){const result=spawnSync('git',args,{cwd:runtimeRoot,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
 }
 await admin.query('CREATE DATABASE '+name);created=true;
 await writeFile(join(scratch,'schema.sql'),run(bin+'pg_dump',[base,'--schema-only','--no-owner','--no-privileges']));
 run(bin+'psql',[target.href,'-X','-q','-v','ON_ERROR_STOP=1','-f',join(scratch,'schema.sql')]);
 const assets=(await readFile(resolve('supabase/migrations/025_payment_assets.sql'),'utf8')).match(/INSERT INTO payment_assets VALUES[\s\S]*?;/)?.[0];assert.ok(assets);
 const drafts=(await readdir(join(root,'drafts'))).filter(n=>n.endsWith('.sql')).sort();
 for(const path of [...drafts.map(n=>join(root,'drafts',n)),...(await readdir(candidate)).map(n=>join(candidate,n)),join(root,'drafts/commerce077/node-cutover.NOT-ACTIVATED.patch'),resolve('tools/runtime/platform-commerce-candidate-concurrency.ts')])evidence.sourceSha256[path.replace(resolve('.')+'/','')]=createHash('sha256').update(await readFile(path)).digest('hex');
 const chain=drafts.map(n=>join(root,'drafts',n));
 assert.ok(drafts.includes('071_financial_closure.sql')&&drafts.includes('072_commerce_closure.sql'),'reviewed ordered proposed chain required');
 await writeFile(join(scratch,'drafts.sql'),'BEGIN;SET search_path=bitpos,public;\n'+assets+'\n'+chain.map(n=>'\\ir '+n).join('\n')+'\nCOMMIT;\n');
 run(bin+'psql',[target.href,'-X','-q','-v','ON_ERROR_STOP=1','-f',join(scratch,'drafts.sql')]);
 const output=run('/tmp/bitpos-openapi-validator-20261017/bin/python',[join(candidate,'concurrency.py')],{...process.env,DATABASE_URL:target.href,COMMERCE077_RUNTIME_ROOT:runtimeRoot});
 evidence.counterpart=JSON.parse(output.trim().split('\n').at(-1)!);
 const result=evidence.counterpart as Record<string,unknown>;
 for(const key of ['account_guest_last_global_slot','cancel_verify_root_order','restart_exact_original_identity','completed_refunded_callback_reconnect','completed_timely_sale_callback_reconnect','expired_unattached_original_eventual_close','reservation_expiry_vs_actual_unpaid_complete_set','uppercase_original_submission_binding'])assert.equal(result[key],'observed',key);
 evidence.status='PASS';
}catch(error){evidence.status='FAIL';evidence.failure=String(error);process.exitCode=1;}
finally{
 if(created){await admin.query('DROP DATABASE '+name);assert.equal((await admin.query('SELECT count(*)::integer n FROM pg_database WHERE datname=$1',[name])).rows[0].n,0);}
 await admin.end();await rm(scratch,{recursive:true});evidence.cleanup=true;
 await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}
