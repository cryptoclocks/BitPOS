import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import test from 'node:test';
import pg from 'pg';
// Needs a throwaway Postgres with migrations through 186 (CHANNEL_TEST_DB). Test data is created and removed by this file.
const url=process.env.CHANNEL_TEST_DB,integration={skip:!url};
Object.assign(process.env,{DATABASE_URL:url??'postgres://x',ADMIN_DATABASE_URL:url??'postgres://x',AUTH_URL:'http://localhost:9',AUTH_ANON_KEY:'k',APP_SECRET:'a'.repeat(40),PUBLIC_URL:'http://localhost:3001',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp',BITPOS_DEMO_QUICK_SIGNIN:'0'});
const {hash}=await import('../packages/domain/src/index');

test('product_unavailable_reason: pause bounds, local-time windows, midnight crossing, DST-free Bangkok and a DST zone',integration,async()=>{
 const db=new pg.Client({connectionString:url});await db.connect();await db.query('SET search_path=bitpos,public');
 const r=async(pa:string|null,pu:string|null,f:string|null,t:string|null,at:string,tz='Asia/Bangkok')=>(await db.query('SELECT product_unavailable_reason($1::timestamptz,$2::timestamptz,$3::time,$4::time,$5::timestamptz,$6) AS r',[pa,pu,f,t,at,tz])).rows[0].r;
 try{
  assert.equal(await r(null,null,null,null,'2026-11-04T00:00:00Z'),null);
  // pause: from paused_at until paused_until (exclusive); open-ended until resumed; not yet started
  assert.equal(await r('2026-11-04T01:00:00Z','2026-11-04T03:00:00Z',null,null,'2026-11-04T02:00:00Z'),'PAUSED');
  assert.equal(await r('2026-11-04T01:00:00Z','2026-11-04T03:00:00Z',null,null,'2026-11-04T03:00:00Z'),null);
  assert.equal(await r('2026-11-04T01:00:00Z',null,null,null,'2026-12-31T00:00:00Z'),'PAUSED');
  assert.equal(await r('2026-11-04T05:00:00Z',null,null,null,'2026-11-04T01:00:00Z'),null);
  // window 07:00-11:00 Bangkok (UTC+7): 00:30Z=07:30 inside, 04:00Z=11:00 outside (end exclusive), 23:59Z=06:59 outside
  assert.equal(await r(null,null,'07:00','11:00','2026-11-04T00:30:00Z'),null);
  assert.equal(await r(null,null,'07:00','11:00','2026-11-04T04:00:00Z'),'OUTSIDE_HOURS');
  assert.equal(await r(null,null,'07:00','11:00','2026-11-03T23:59:00Z'),'OUTSIDE_HOURS');
  assert.equal(await r(null,null,'07:00','11:00','2026-11-03T17:00:00Z'),'OUTSIDE_HOURS'); // 00:00 local
  // crossing midnight 22:00-02:00: 23:00 and 01:00 local inside, 12:00 outside, 02:00 outside
  assert.equal(await r(null,null,'22:00','02:00','2026-11-04T16:00:00Z'),null); // 23:00 Bangkok
  assert.equal(await r(null,null,'22:00','02:00','2026-11-04T18:00:00Z'),null); // 01:00
  assert.equal(await r(null,null,'22:00','02:00','2026-11-04T05:00:00Z'),'OUTSIDE_HOURS'); // 12:00
  assert.equal(await r(null,null,'22:00','02:00','2026-11-04T19:00:00Z'),'OUTSIDE_HOURS'); // 02:00 end exclusive
  // pause wins over the window; a DST zone follows local clock, not a fixed offset (New York: UTC-4 in summer, UTC-5 in winter)
  assert.equal(await r('2026-07-01T00:00:00Z',null,'07:00','11:00','2026-07-01T05:00:00Z'),'PAUSED');
  assert.equal(await r(null,null,'07:00','11:00','2026-07-01T12:00:00Z','America/New_York'),null);   // 08:00 EDT
  assert.equal(await r(null,null,'07:00','11:00','2026-01-15T12:00:00Z','America/New_York'),null);   // 07:00 EST
  assert.equal(await r(null,null,'07:00','11:00','2026-01-15T11:59:00Z','America/New_York'),'OUTSIDE_HOURS'); // 06:59 EST
  assert.equal(await r(null,null,'07:00','11:00','2026-07-01T11:00:00Z','America/New_York'),null);              // 07:00 EDT, start inclusive
  assert.equal(await r(null,null,'07:00','11:00','2026-07-01T10:59:00Z','America/New_York'),'OUTSIDE_HOURS');  // 06:59 EDT
 }catch(e){throw e;}finally{await db.end();}
});
