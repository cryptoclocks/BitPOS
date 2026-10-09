// Read-only own-database diagnostic. No payment or latency acceptance claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
const path=process.env.BITPOS_TRACE_PATH;
assert.match(path||'',/^\.omp\/work\/evidence\/device-wire-trace-[a-zA-Z0-9_-]+\.jsonl$/);
const offset=fs.existsSync(path)?fs.statSync(path).size:0;
await import('./trace-device-sql.mjs');
const client=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});
await client.connect();
try {
 for(let i=0;i<3;i++)assert.equal((await client.query('SELECT 1 AS value')).rows[0].value,1);
 await new Promise((resolve,reject)=>client.query('SELECT 2 AS value',(error,result)=>{if(error)return reject(error);try{assert.equal(result.rows[0].value,2);resolve();}catch(failure){reject(failure);}}));
 assert.equal((await client.query({text:'SELECT 3 AS value'})).rows[0].value,3);
 await assert.rejects(client.query('SELECT 1/0'),error=>error.code==='22012');
}finally{await client.end();}
const pool=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL});
try{assert.equal((await pool.query('SELECT 4 AS value')).rows[0].value,4);}finally{await pool.end();}
const rows=fs.readFileSync(path).subarray(offset).toString().trim().split('\n').map(JSON.parse);
const starts=rows.filter(row=>row.boundary==='SQL_invocation');
const finishes=rows.filter(row=>row.boundary==='SQL_callback');
assert.equal(starts.length,7);assert.equal(finishes.length,7);
assert.equal(new Set(starts.map(row=>row.queryId)).size,7);
assert.equal(new Set(finishes.map(row=>row.queryId)).size,7);
for(const start of starts){const finish=finishes.find(row=>row.queryId===start.queryId);assert.ok(finish);assert.equal(finish.sqlHash,start.sqlHash);assert.equal(finish.at,start.at);assert.equal(finish.pid,start.pid);}
assert.equal(finishes.filter(row=>row.error).length,1);
console.log(JSON.stringify({origin:'read_only_own_database_observer_lifecycle_fixture',expected_public_queries:7,recorded_invocations:starts.length,recorded_callbacks:finishes.length,unique_query_ids:7,error_callbacks:1,network_transactions:0,acceptance_latency_claim:false}));
