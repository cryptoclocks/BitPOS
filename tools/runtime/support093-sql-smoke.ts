import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import pg from 'pg';
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',statement_timeout:5000});await db.connect();
try{
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');await db.query('BEGIN');
 assert.equal((await db.query("SELECT to_regclass('bitpos.mobile_support_cases') n")).rows[0].n,null,'Candidate proof must not overwrite an installed table');
 await db.query(await readFile('supabase/migrations/093_customer_support.sql','utf8'));
 const accounts=(await db.query('SELECT id FROM bitpos.mobile_accounts ORDER BY id LIMIT 2')).rows;assert.equal(accounts.length,2);
 await db.query("SELECT set_config('bitpos.mobile_account',$1,true)",[accounts[0].id]);await db.query('SET LOCAL ROLE bitpos_app');
 await db.query('RESET ROLE');const linked=(await db.query('SELECT merchant_id,order_id,account_id FROM bitpos.online_food_orders LIMIT 1')).rows[0];await db.query('SET LOCAL ROLE bitpos_app');
 assert.ok(linked,'An existing local order is required for linked-order isolation proof');if(linked){const foreign=accounts.find(a=>a.id!==linked.account_id)!;await db.query("SELECT set_config('bitpos.mobile_account',$1,true)",[foreign.id]);await db.query('SAVEPOINT foreign_order');await assert.rejects(db.query("INSERT INTO bitpos.mobile_support_cases(account_id,command_id,request_hash,subject,merchant_id,order_id) VALUES($1,gen_random_uuid(),'fixture','Foreign order',$2,$3)",[foreign.id,linked.merchant_id,linked.order_id]),(e:any)=>e.message==='RESOURCE_NOT_FOUND');await db.query('ROLLBACK TO SAVEPOINT foreign_order');await db.query("SELECT set_config('bitpos.mobile_account',$1,true)",[accounts[0].id]);}
 const ticket=(await db.query("INSERT INTO bitpos.mobile_support_cases(account_id,command_id,request_hash,subject) VALUES($1,gen_random_uuid(),'fixture','Help') RETURNING id",[accounts[0].id])).rows[0].id;
 await db.query("INSERT INTO bitpos.mobile_support_messages(account_id,case_id,command_id,body) VALUES($1,$2,gen_random_uuid(),'Owned question')",[accounts[0].id,ticket]);
 assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.mobile_support_messages')).rows[0].n,1);
 await db.query("SELECT set_config('bitpos.mobile_account',$1,true)",[accounts[1].id]);
 for(const table of ['mobile_support_cases','mobile_support_messages'])assert.equal((await db.query(`SELECT count(*)::int n FROM bitpos.${table}`)).rows[0].n,0);
 await db.query('SAVEPOINT forged');await assert.rejects(db.query("INSERT INTO bitpos.mobile_support_messages(account_id,case_id,command_id,body) VALUES($1,$2,gen_random_uuid(),'Forged')",[accounts[0].id,ticket]),(e:any)=>e.code==='42501');await db.query('ROLLBACK TO SAVEPOINT forged');
 await db.query('SAVEPOINT edit');await assert.rejects(db.query("UPDATE bitpos.mobile_support_messages SET body='Edited'"),(e:any)=>e.code==='42501');await db.query('ROLLBACK TO SAVEPOINT edit');
 await db.query("SELECT set_config('bitpos.mobile_account','',true)");assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.mobile_support_cases')).rows[0].n,0);
 await db.query('ROLLBACK');assert.equal((await db.query("SELECT to_regclass('bitpos.mobile_support_cases') n")).rows[0].n,null);
 const receipt={status:'PASS_ROLLBACK_SUPPORT_ACCOUNT_RLS',checks:['Owner writes and reads message','Foreign account sees zero cases/messages','Forged owner denied42501','Message update denied42501','Missing account context sees zero','Foreign linked order rejected by database guard','DDL rolled back'],limits:['Direct SQL/RLS only; not HTTP or native acceptance'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/support093-sql-direct-20261019.json',JSON.stringify(receipt,null,2)+'\n');console.log(receipt.status);
}catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
