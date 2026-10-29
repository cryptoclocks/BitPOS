import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {writeFile} from 'node:fs/promises';import pg from 'pg';
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'});await db.connect();try{
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 const acl=(await db.query("SELECT has_table_privilege('bitpos_app','bitpos.ledger_entries','SELECT') app_read,has_table_privilege('bitpos_app','bitpos.ledger_entries','INSERT') app_write,has_table_privilege('bitpos_settlement_worker','bitpos.ledger_entries','SELECT') worker_read,has_table_privilege('bitpos_settlement_worker','bitpos.ledger_entries','INSERT') worker_write,has_function_privilege('bitpos_app','bitpos.draft_assert_ledger_balanced()','EXECUTE') app_call,has_function_privilege('bitpos_settlement_worker','bitpos.draft_assert_ledger_balanced()','EXECUTE') worker_call,(SELECT prosecdef FROM pg_proc WHERE oid='bitpos.draft_assert_ledger_balanced()'::regprocedure) definer")).rows[0];assert.deepEqual(acl,{app_read:false,app_write:false,worker_read:false,worker_write:false,app_call:false,worker_call:false,definer:true});
 const checks:string[]=[];
 for(const role of ['bitpos_app','bitpos_settlement_worker']){
  await db.query('BEGIN');try{
   await db.query("INSERT INTO bitpos.ledger_transactions(id,source_kind,source_id,reason,currency,decimals) VALUES($1,'SYNTHETIC_UNBALANCED_NEGATIVE',$2,'Disposable negative invariant fixture','USD',2)",[randomUUID(),randomUUID()]);
   await db.query('SET LOCAL ROLE '+role);
   await assert.rejects(db.query('COMMIT'),(error:Error&{code?:string})=>error.message==='UNBALANCED_LEDGER'&&error.code==='23514');checks.push(role+' actual COMMIT rejects zero-line transaction with invariant23514 rather than ACL42501');
  }finally{await db.query('ROLLBACK');}
 }
 const receipt={status:'PASS_RESTRICTED_COMMIT_DEFERRED_INVARIANT_AND_NO_DIRECT_LEDGER_AUTHORITY',acl,checks,fixture:'Actual restricted-role COMMIT on disposable55436, invalid transactions rolled back; no payout/provider/funds',physicalTesting:'deferred_by_user_2026-10-16'};await writeFile('.omp/work/flutter-delivery-20261016/evidence/settlement089-invariant-20261019.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await db.end();}
