import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import pg from 'pg';
import {foodSmokeMigration} from './food-smoke-schema';
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'});await db.connect();const passed:string[]=[];
try{
 await db.query('BEGIN');await foodSmokeMigration(db,'062_food_earning_obligations.sql',"to_regclass('bitpos.ledger_accounts')");
 const owner=randomUUID(),debit=randomUUID(),credit=randomUUID(),posting=randomUUID();
 await db.query("INSERT INTO ledger_accounts(id,owner_kind,owner_id,purpose,currency,decimals) VALUES($1,'PLATFORM',$3,'RECEIVABLE','USD',2),($2,'DRIVER',$3,'PAYABLE','USD',2)",[debit,credit,owner]);
 await db.query("INSERT INTO ledger_transactions(id,source_kind,source_id,reason,currency,decimals) VALUES($1,'EARNING_ACCRUAL',$2,'Synthetic obligation, not a transfer','USD',2)",[posting,randomUUID()]);
 await db.query("INSERT INTO ledger_entries(transaction_id,line,account_id,currency,decimals,debit_minor,credit_minor) VALUES($1,1,$2,'USD',2,100,0),($1,2,$3,'USD',2,0,100)",[posting,debit,credit]);
 await db.query('SET CONSTRAINTS ALL IMMEDIATE');
 assert.deepEqual((await db.query('SELECT sum(debit_minor)::text AS debit,sum(credit_minor)::text AS credit FROM ledger_entries WHERE transaction_id=$1',[posting])).rows[0],{debit:'100',credit:'100'});passed.push('Exact 100-minor balanced receivable/payable obligation persists in transaction');
 async function denied(name:string,sql:string|(()=>Promise<unknown>),args:unknown[]=[]){await db.query('SAVEPOINT negative');let code='';try{if(typeof sql==='string')await db.query(sql,args);else await sql();await db.query('SET CONSTRAINTS ALL IMMEDIATE');}catch(error){code=(error as {code:string}).code;}finally{await db.query('ROLLBACK TO SAVEPOINT negative');await db.query('RELEASE SAVEPOINT negative');}assert.equal(code,'23514',name);passed.push(name);}
 await denied('Unbalanced posting cannot be admitted',"INSERT INTO ledger_transactions(source_kind,source_id,reason,currency,decimals) VALUES('EARNING_ACCRUAL',$1,'Unbalanced fixture','USD',2)",[randomUUID()]);
 await denied('Posted ledger entry cannot be rewritten','UPDATE ledger_entries SET credit_minor=101 WHERE transaction_id=$1 AND line=2',[posting]);
 await denied('Negative debit cannot bypass balancing',"INSERT INTO ledger_entries(transaction_id,line,account_id,currency,decimals,debit_minor,credit_minor) VALUES($1,3,$2,'USD',2,-1,100)",[posting,debit]);
 const reversal=randomUUID();
 await db.query('SET CONSTRAINTS ALL DEFERRED');
 await db.query("INSERT INTO ledger_transactions(id,source_kind,source_id,reason,currency,decimals,reverses_id) VALUES($1,'REVERSAL',$2,'Exact reversal fixture','USD',2,$3)",[reversal,randomUUID(),posting]);
 await db.query("INSERT INTO ledger_entries(transaction_id,line,account_id,currency,decimals,debit_minor,credit_minor) VALUES($1,1,$2,'USD',2,0,100),($1,2,$3,'USD',2,100,0)",[reversal,debit,credit]);
 await db.query('SET CONSTRAINTS ALL IMMEDIATE');passed.push('Exact account-preserving reversal succeeds with deferred construction and immediate validation');
 await denied('Balanced append after reversal validation cannot neutralize reversal',"INSERT INTO ledger_entries(transaction_id,line,account_id,currency,decimals,debit_minor,credit_minor) VALUES($1,3,$2,'USD',2,100,0),($1,4,$3,'USD',2,0,100)",[reversal,debit,credit]);
 await denied('Original cannot change beneath an already validated reversal',"INSERT INTO ledger_entries(transaction_id,line,account_id,currency,decimals,debit_minor,credit_minor) VALUES($1,3,$2,'USD',2,100,0),($1,4,$3,'USD',2,0,100)",[posting,debit,credit]);
 for(const decimals of [2,4])await denied('USDG scale '+decimals+' refused',"INSERT INTO ledger_accounts(owner_kind,owner_id,purpose,currency,decimals) VALUES('DRIVER',$1,'PAYABLE','USDG',$2)",[randomUUID(),decimals]);
 for(const [currency,decimals] of [['USD',2],['USD',4],['USD',6],['USDG',6]] as const)await db.query("INSERT INTO ledger_accounts(owner_kind,owner_id,purpose,currency,decimals) VALUES('DRIVER',$1,'PAYABLE',$2,$3)",[randomUUID(),currency,decimals]);
 passed.push('Canonical USD2/4/6 and USDG6 account tuples admitted');
 const original2=randomUUID();await db.query('SET CONSTRAINTS ALL DEFERRED');
 await db.query("INSERT INTO ledger_transactions(id,source_kind,source_id,reason,currency,decimals) VALUES($1,'EARNING_ACCRUAL',$2,'Second original for invalid reversal fixtures','USD',2)",[original2,randomUUID()]);
 await db.query("INSERT INTO ledger_entries(transaction_id,line,account_id,currency,decimals,debit_minor,credit_minor) VALUES($1,1,$2,'USD',2,100,0),($1,2,$3,'USD',2,0,100)",[original2,debit,credit]);await db.query('SET CONSTRAINTS ALL IMMEDIATE');
 for(const variant of ['wrong-account','wrong-denomination']){
  await denied(variant+' reversal refused despite balanced entries',async()=>{
   await db.query('SET CONSTRAINTS ALL DEFERRED');const r=randomUUID(),scale=variant==='wrong-denomination'?4:2,otherDebit=randomUUID(),otherCredit=randomUUID();
   await db.query("INSERT INTO ledger_accounts(id,owner_kind,owner_id,purpose,currency,decimals) VALUES($1,'PLATFORM',$3,'RECEIVABLE','USD',$4),($2,'DRIVER',$3,'PAYABLE','USD',$4)",[otherDebit,otherCredit,randomUUID(),scale]);
   await db.query("INSERT INTO ledger_transactions(id,source_kind,source_id,reason,currency,decimals,reverses_id) VALUES($1,'REVERSAL',$2,'Invalid reversal fixture','USD',$3,$4)",[r,randomUUID(),scale,original2]);
   await db.query("INSERT INTO ledger_entries(transaction_id,line,account_id,currency,decimals,debit_minor,credit_minor) VALUES($1,1,$2,'USD',$4,0,100),($1,2,$3,'USD',$4,100,0)",[r,otherDebit,otherCredit,scale]);
  });
 }
 const receipt={status:'PASS',passed,rollback:true,limits:['Ledger mechanics only; delivered assignment accrual, complete allocation set and external payouts not yet exercised'],physicalTesting:'deferred_by_user_2026-10-16'};await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch062-ledger-smoke-20261018.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await db.query('ROLLBACK');await db.end();}
