import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

test('durable daily sponsor ceiling admits funded verification budget and rejects overflow', {skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'}, async()=>{
 const {config}=await import('../apps/api/src/config');
 const db=new pg.Client({connectionString:config.ADMIN_DATABASE_URL});await db.connect();
 try{
  await db.query('BEGIN');
  // Own distant fixture date; rollback leaves every actual sponsor day unchanged.
  const date=(await db.query("SELECT slots.candidate::date AS day FROM generate_series(date '2400-01-01',date '2400-12-31',interval '1 day') AS slots(candidate) WHERE NOT EXISTS(SELECT 1 FROM bitpos.sponsor_days d WHERE d.day=slots.candidate::date) LIMIT 1")).rows[0].day;
  await db.query('INSERT INTO bitpos.sponsor_days(day,reserved_lamports) VALUES($1,260000000)',[date]);
  await assert.rejects(db.query('UPDATE bitpos.sponsor_days SET reserved_lamports=reserved_lamports+1 WHERE day=$1',[date]),(error:{code?:string})=>error.code==='23514');
 }finally{await db.query('ROLLBACK');await db.end();}
});
