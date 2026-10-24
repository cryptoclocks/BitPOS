import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
const source=await readFile('supabase/migrations/061_food_dispatch_runtime.sql','utf8'),functions=source.slice(source.indexOf('CREATE FUNCTION dispatch_live_actor')).replaceAll('CREATE FUNCTION ','CREATE OR REPLACE FUNCTION ');
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'});await db.connect();const passed:string[]=[];
try{for(const isolation of ['READ COMMITTED','REPEATABLE READ','SERIALIZABLE']){
 await db.query('BEGIN ISOLATION LEVEL '+isolation);try{
  await db.query('SET LOCAL search_path=bitpos,public');await db.query(functions);await db.query('SET LOCAL ROLE bitpos_app');
  let message='',code='';try{await db.query('SELECT dispatch_food_tracking($1)',[randomUUID()]);}catch(error){message=(error as Error).message;code=(error as {code:string}).code;}
  assert.equal(message,isolation==='READ COMMITTED'?'RESOURCE_NOT_FOUND':'DISPATCH_READ_COMMITTED_REQUIRED');assert.equal(code,isolation==='READ COMMITTED'?'P0001':'25001');passed.push(isolation+': '+message);
 }finally{await db.query('ROLLBACK');}
}
 const receipt={status:'PASS',passed,rollback:true,limits:['Boundary isolation refusal only; concurrent suspension/claim race not executed by this smoke'],physicalTesting:'deferred_by_user_2026-10-16'};await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch061-isolation-smoke-20261018.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await db.end();}
