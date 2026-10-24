import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import pg from 'pg';
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',statement_timeout:5000});await db.connect();
try{
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');await db.query('BEGIN');
 assert.equal((await db.query("SELECT to_regclass('bitpos.mobile_favourite_branches') n")).rows[0].n,null,'Candidate proof must not overwrite an installed table');
 await db.query(await readFile('supabase/migrations/092_customer_favourites.sql','utf8'));
 const accounts=(await db.query('SELECT id FROM bitpos.mobile_accounts ORDER BY id LIMIT 2')).rows;assert.equal(accounts.length,2);
 const branch=(await db.query('SELECT merchant_id,id FROM bitpos.marketplace_branches ORDER BY id LIMIT 1')).rows[0];assert.ok(branch);
 await db.query("SELECT set_config('bitpos.mobile_account',$1,true)",[accounts[0].id]);await db.query('SET LOCAL ROLE bitpos_app');
 const insert='INSERT INTO bitpos.mobile_favourite_branches(account_id,merchant_id,branch_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING';
 await db.query(insert,[accounts[0].id,branch.merchant_id,branch.id]);await db.query(insert,[accounts[0].id,branch.merchant_id,branch.id]);
 assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.mobile_favourite_branches')).rows[0].n,1);
 await db.query("SELECT set_config('bitpos.mobile_account',$1,true)",[accounts[1].id]);
 assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.mobile_favourite_branches')).rows[0].n,0);
 assert.equal((await db.query('DELETE FROM bitpos.mobile_favourite_branches WHERE account_id=$1',[accounts[0].id])).rowCount,0);
 await db.query('SAVEPOINT foreign_write');await assert.rejects(db.query(insert,[accounts[0].id,branch.merchant_id,branch.id]),(error:any)=>error.code==='42501');await db.query('ROLLBACK TO SAVEPOINT foreign_write');
 await db.query("SELECT set_config('bitpos.mobile_account','',true)");assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.mobile_favourite_branches')).rows[0].n,0);
 await db.query("SELECT set_config('bitpos.mobile_account',$1,true)",[accounts[0].id]);assert.equal((await db.query('DELETE FROM bitpos.mobile_favourite_branches WHERE branch_id=$1',[branch.id])).rowCount,1);
 await db.query('ROLLBACK');assert.equal((await db.query("SELECT to_regclass('bitpos.mobile_favourite_branches') n")).rows[0].n,null);
 const receipt={status:'PASS_ROLLBACK_FAVOURITES_ACCOUNT_RLS',checks:['Exact insertion replay remains one row','Foreign account reads zero','Foreign delete changes zero','Foreign insert denied42501','Missing account context reads zero','Owner removes own favourite','DDL and all fixture changes rolled back'],limits:['Direct SQL/RLS only; not HTTP or native acceptance'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/favourites092-sql-direct-20261019.json',JSON.stringify(receipt,null,2)+'\n');console.log(receipt.status);
}catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
