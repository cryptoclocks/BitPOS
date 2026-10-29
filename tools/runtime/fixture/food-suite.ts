// W02 local API/SQL scenarios. Does not claim UI/provider acceptance.
import{spawn}from'node:child_process';import{readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';import assert from'node:assert/strict';import pg from'pg';
const env={...process.env,DOTENV_CONFIG_PATH:'/dev/null',BITPOS_DELIVERY_FIXTURE_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55446/bitpos_w01_fixture',BITPOS_FIXTURE_AUTH_URL:'http://127.0.0.1:55447',BITPOS_DISPATCH_FIXTURE_BASE:'http://127.0.0.1:3046'};
const scenarios=[['pickup','--pickup-current'],['delivery'],['replacement-delivery','--replacement-current'],['delivery-issue-report','--delivery-issue-http'],['pickup-wins-withdrawal','--assignment-recovery-pickup-race','--pickup-first'],['withdrawal-wins-pickup','--assignment-recovery-pickup-race'],['cancel-review-before-pickup','--cancellation-review-http'],['cancel-review-after-pickup','--cancellation-review-http','--postpickup'],['incident-after-pickup','--incident-authority-http','--postpickup'],['withdrawal-recovery','--assignment-recovery-http'],['search-no-driver','--search-boundary'],['search-provider-unavailable','--search-boundary','--provider-unavailable']];
const selected=process.argv.find(a=>a.startsWith('--only='))?.slice(7).split(',');
if(selected)assert.ok(selected.length>0&&selected.every(name=>scenarios.some(s=>s[0]===name)),'Unknown scenario selection');
const checks:any[]=[];
for(const [name,...flags]of scenarios){
 if(selected&&!selected.includes(name))continue;
 let output='';const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn('pnpm',['exec','tsx','tools/runtime/dispatch-http-smoke.ts','--fixture-customer-seeded','--current-e2e',...flags],{env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});child.once('error',reject);child.once('exit',resolve);});
 const json=output.split('\n').flatMap(line=>{try{const value=JSON.parse(line);return value.status?[value]:[];}catch{return[];}});
 if(code!==0){console.error('FAIL W02 scenario '+name+'\n'+output.slice(-5000));throw Error('W02 '+name+' failed');}
 assert.ok(json.length,'Scenario must emit a structured receipt: '+name);assert.ok(json.every(r=>r.status.startsWith('PASS')),'Scenario non-PASS: '+name);
 checks.push({name,receipts:json});console.log('PASS_W02_SCENARIO '+name);
}
const files=['tools/runtime/dispatch-http-smoke.ts','tools/runtime/food-pickup-current-smoke.ts','apps/api/src/mobile-food.ts','apps/api/src/food-delivery.ts','apps/api/src/orders.ts'];
const db=new pg.Client({connectionString:env.BITPOS_DELIVERY_FIXTURE_DATABASE_URL});await db.connect();
try{
 const cleanup=(await db.query("SELECT (SELECT count(*)::int FROM bitpos.platform_staff_role_grants WHERE revoked_at IS NULL) live_grants,(SELECT count(*)::int FROM bitpos.driver_availability WHERE requested_online) online_drivers,(SELECT count(*)::int FROM bitpos.mobile_sessions WHERE revoked_at IS NULL AND access_expires_at>clock_timestamp()) live_mobile_sessions")).rows[0];assert.deepEqual(cleanup,{live_grants:0,online_drivers:0,live_mobile_sessions:0});
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/w02-food-api-sql-suite'+(selected?'-selected':'')+'-20261021.json',JSON.stringify({status:'PASS_W02_LOCAL_API_SQL_SCENARIOS',checkedAtUtc:new Date().toISOString(),checks,cleanup,sourceSha256:Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')]))),limits:['SQL-only synthetic finalized payment, not chain/provider verification','No current complete native/browser journey proof','No physical GPS/delivery or payout transfer','Full W02 timeout/no-driver/reassign/failure/worker-restart and all-surface joined coverage still requires current evidence']},null,2)+'\n');
}finally{await db.end();}
