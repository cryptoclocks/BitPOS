import fs from 'node:fs';
import pg from 'pg';
import assert from 'node:assert/strict';
const evidence={origin:'actual_single_oci_bitpos_stack',at:new Date().toISOString(),checks:{}};
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
await db.connect();
const role=await db.query('SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user');
assert.equal(role.rows[0].current_user,'bitpos_app');
assert.equal(role.rows[0].rolsuper,false);assert.equal(role.rows[0].rolbypassrls,false);
const outside=await db.query('SELECT count(*)::int AS n FROM bitpos.products');assert.equal(outside.rows[0].n,0);
await db.query('BEGIN');await db.query("SELECT set_config('bitpos.merchant',$1,true)",['11111111-1111-4111-8111-111111111111']);
const inside=await db.query('SELECT count(*)::int AS n FROM bitpos.products');await db.query('ROLLBACK');await db.end();
evidence.checks.database={least_privilege:true,outside_tenant_rows:0,own_menu_rows:inside.rows[0].n};
for(const [name,url] of [['auth',process.env.AUTH_URL+'/health'],['rest','http://127.0.0.1:18782/'],['storage','http://127.0.0.1:18783/status']]){const response=await fetch(url);assert.equal(response.status,200,name);evidence.checks[name]={http_status:response.status};}
const credentials=JSON.parse(fs.readFileSync('local/private/demo-login.json','utf8'))[0];
const login=await fetch(process.env.AUTH_URL+'/token?grant_type=password',{method:'POST',headers:{apikey:process.env.AUTH_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify(credentials)});
assert.equal(login.status,200);const body=await login.json();assert.ok(body.access_token&&body.user?.id);evidence.checks.login={http_status:200,authenticated:true};
fs.mkdirSync('.omp/work/evidence',{recursive:true});fs.writeFileSync('.omp/work/evidence/infra-readiness.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
