import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import pg from 'pg';
// DS40 statements export backend. The statement is built from the real
// settlement088 driver snapshot (SQL, own account) read in a rolled-back transaction
// on the fixture database; the CSV/total logic itself is also checked on edge input.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
async function driverSnapshots(){
 const {config}=await import('../apps/api/src/config');
 const db=new pg.Client({connectionString:config.ADMIN_DATABASE_URL});await db.connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');await db.query('SET LOCAL search_path=bitpos,public');
  const accounts=(await db.query('SELECT p.account_id,p.id driver_id,count(*)::int n FROM earning_accruals e JOIN driver_profiles p ON p.id=e.driver_id JOIN mobile_accounts m ON m.id=p.account_id AND m.disabled_at IS NULL WHERE e.food_assignment_id IS NOT NULL GROUP BY 1,2 ORDER BY n DESC,1')).rows;
  assert.ok(accounts.length>=2,'fixture needs two drivers with food earnings');
  const snapshots=new Map<string,any>();
  for(const a of accounts.slice(0,2)){
   const sid=randomUUID(),device=randomUUID(),hash=createHash('sha256').update(randomBytes(32)).digest('hex');
   await db.query("INSERT INTO mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at)VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '10 minutes',clock_timestamp()+interval '10 minutes')",[sid,a.account_id,device,hash,createHash('sha256').update(randomBytes(32)).digest('hex')]);
   await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_device',$3,true),set_config('bitpos.mobile_access_hash',$4,true)",[a.account_id,sid,device,hash]);
   snapshots.set(a.driver_id,(await db.query('SELECT settlement088_driver_snapshot(NULL) value')).rows[0].value);
  }
  return snapshots;
 }finally{await db.query('ROLLBACK').catch(()=>undefined);await db.end();}
}

test('statement from the real own-account snapshot has exact totals, scoped rows, deterministic CSV and replays identically',integration,async()=>{
 const {driverStatement,parseStatementPeriod}=await import('../apps/api/src/settlement-statement');
 const snapshots=await driverSnapshots();const [[driverA,pageA],[driverB,pageB]]=[...snapshots.entries()];
 const period=parseStatementPeriod(new Date(Date.now()-300*86400000).toISOString(),new Date(Date.now()+60*86400000).toISOString());
 const a=driverStatement([pageA],period),again=driverStatement([pageA],period);
 assert.deepEqual(again,a,'same facts, same bytes');
 assert.equal(a.driverId,driverA);assert.equal(a.rows,pageA.items.length);assert.ok(a.rows>0);
 const csvRows=a.csv.trimEnd().split('\r\n');assert.equal(csvRows.length,a.rows+1);
 // Totals equal an independent BigInt sum of the page items (no float anywhere).
 const sum=pageA.items.filter((i:any)=>i.state!=='REVERSED').reduce((s:bigint,i:any)=>s+BigInt(i.money.amountMinor),0n);
 assert.equal(a.totals.reduce((s,t)=>s+BigInt(t.accruedMinor),0n),sum);
 for(const t of a.totals)assert.match(t.accruedMinor,/^(0|[1-9][0-9]*)$/);
 // Only confirmed receipts count as settled; an unconfirmed batch never does.
 for(const item of pageA.items){const confirmed=item.settlement?.state==='CONFIRMED'&&item.settlement.receiptId&&item.state==='SETTLED';const line=csvRows.find((r:string)=>r.startsWith(item.accrualId))!;assert.equal(line.split(',')[9]!=='',Boolean(confirmed)&&Boolean(item.settlement.confirmedAt));}
 // The other driver's statement contains none of the first driver's accruals and mixing pages is refused.
 const b=driverStatement([pageB],period);assert.equal(b.driverId,driverB);
 for(const item of pageA.items)assert.ok(!b.csv.includes(item.accrualId));
 assert.throws(()=>driverStatement([pageA,pageB],period),(e:any)=>e.status===404||/RESOURCE_NOT_FOUND/.test(String(e.message)));
 // A period that excludes everything yields a header-only statement, not an error.
 const empty=driverStatement([pageA],parseStatementPeriod('1990-01-01T00:00:00Z','1990-02-01T00:00:00Z'));assert.equal(empty.rows,0);assert.equal(empty.csv,'accrualId,orderId,createdAt,state,currency,decimals,amountMinor,batchId,batchState,receiptId,confirmedAt,payoutCurrency,payoutAmountMinor\r\n');
 // The period is half-open [from,to): the boundary instant belongs to the later statement.
 const first=pageA.items.map((i:any)=>i.createdAt).sort()[0];
 assert.equal(driverStatement([pageA],{from:first,to:new Date(Date.parse(first)+1).toISOString()}).rows>=1,true);
 assert.equal(driverStatement([pageA],{from:new Date(Date.parse(first)-1000).toISOString(),to:first}).rows,0);
});

test('period validation and CSV neutralisation refuse malformed input',integration,async()=>{
 const {csvCell,parseStatementPeriod}=await import('../apps/api/src/settlement-statement');
 for(const bad of [[null,'2026-01-02T00:00:00Z'],['not-a-date','2026-01-02T00:00:00Z'],['2026-01-02T00:00:00Z','2026-01-01T00:00:00Z'],['2025-01-01T00:00:00Z','2026-06-01T00:00:00Z']] as const)
  assert.throws(()=>parseStatementPeriod(bad[0],bad[1]),(e:any)=>e.status===422||e.statusCode===422||/INVALID_REQUEST/.test(String(e.message)));
 assert.equal(csvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');assert.equal(csvCell('+1'),"'+1");assert.equal(csvCell('a,b'),'"a,b"');assert.equal(csvCell(null),'');assert.equal(csvCell(12),'12');
});
