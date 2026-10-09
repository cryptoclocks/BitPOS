import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

test('lost checked-out and idle database connections preserve rollback and permit recovery',{skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1',timeout:30000},async()=>{
 const {pool,tenant}=await import('../apps/api/src/db');
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 const merchant=randomUUID(),product=randomUUID();
 try{
  await pool.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Disconnect fixture','11111111111111111111111111111111')",[merchant]);
  await tenant(merchant,db=>db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'Disconnect fixture','Disconnect fixture','',3500,5)",[product,merchant]));
  await assert.rejects(tenant(merchant,async db=>{
   await db.query('UPDATE products SET stock=4 WHERE id=$1',[product]);
   const pid=(await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   // Listen only for end: an error listener in the test would hide the crash defect.
   const ended=new Promise<void>(resolve=>db.once('end',resolve));
   assert.equal((await admin.query('SELECT pg_terminate_backend($1) AS terminated',[pid])).rows[0].terminated,true);
   await ended;
  }));
  assert.equal((await tenant(merchant,db=>db.query('SELECT stock FROM products WHERE id=$1',[product]))).rows[0].stock,5,'disconnected transaction must not commit');
  const idle=await pool.connect();const pid=(await idle.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const ended=new Promise<void>(resolve=>idle.once('end',resolve));idle.release();
  assert.equal((await admin.query('SELECT pg_terminate_backend($1) AS terminated',[pid])).rows[0].terminated,true);await ended;
  await tenant(merchant,db=>db.query('UPDATE products SET stock=3 WHERE id=$1',[product]));
  assert.equal((await tenant(merchant,db=>db.query('SELECT stock FROM products WHERE id=$1',[product]))).rows[0].stock,3,'replacement connection must commit normally');
 }finally{
  await tenant(merchant,db=>db.query('DELETE FROM products WHERE merchant_id=$1',[merchant]));
  await pool.query('DELETE FROM merchants WHERE id=$1',[merchant]);await admin.end();await pool.end();
 }
});
