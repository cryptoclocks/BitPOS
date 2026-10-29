import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import pg from 'pg';
const base='postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture';
const bin='/opt/homebrew/opt/postgresql@17/bin/';
const root=resolve('docs/plans/database-20261017');
const name='bitpos_asset_throwaway_'+randomUUID().replaceAll('-','');
const url=new URL(base);url.pathname='/'+name;
const admin=new pg.Client({connectionString:base});await admin.connect();
const scratch=await mkdtemp(join(tmpdir(),'bitpos-asset-'));
let created=false;
const evidence={status:'RUNNING',fixture:true,physicalTesting:'deferred_by_user_2026-10-16',copiedBusinessRows:0,output:'',failure:null as string|null,cleanup:false};
function run(binary:string,args:string[]){const r=spawnSync(bin+binary,args,{encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout;}
try{
 await admin.query('CREATE DATABASE '+name);created=true;
 await writeFile(join(scratch,'schema.sql'),run('pg_dump',[base,'--schema-only','--no-owner','--no-privileges']));
 run('psql',[url.href,'-X','-q','-v','ON_ERROR_STOP=1','-f',join(scratch,'schema.sql')]);
 const assets=(await readFile(resolve('supabase/migrations/025_payment_assets.sql'),'utf8')).match(/INSERT INTO payment_assets VALUES[\s\S]*?;/)?.[0];assert.ok(assets);
 const drafts=(await readdir(join(root,'drafts'))).filter(n=>n.endsWith('.sql')).sort();
 await writeFile(join(scratch,'proof.sql'),'BEGIN;SET search_path=bitpos,public;\n'+assets+'\n'+drafts.map(n=>'\\ir '+join(root,'drafts',n)).join('\n')+'\n\\ir '+join(root,'drafts/financial071/071-fixture-base.sql')+'\n\\ir '+join(root,'drafts/financial071/fixture071-actors-food-payout.sql')+'\n\\ir '+join(root,'fixtures/079-original-asset-refunds.sql')+'\n');
 evidence.output=run('psql',[url.href,'-X','-q','-v','ON_ERROR_STOP=1','-f',join(scratch,'proof.sql')]);evidence.status='PASS';
}catch(error){evidence.status='FAIL';evidence.failure=String(error);process.exitCode=1;}
finally{
 if(created)await admin.query('DROP DATABASE '+name+' WITH (FORCE)');
 await admin.end();await rm(scratch,{recursive:true,force:true});evidence.cleanup=true;
 await writeFile(resolve('.omp/work/flutter-delivery-20261016/evidence/original-asset079-finance-20261017.json'),JSON.stringify(evidence,null,2)+'\n');
 await writeFile(resolve('.omp/work/flutter-delivery-20261016/evidence/original-asset079-finance-'+Date.now()+'.json'),JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify(evidence));
}
