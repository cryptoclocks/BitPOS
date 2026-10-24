import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';import {writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import type pg from 'pg';
type Call=(path:string,method?:string,body?:unknown,token?:string,status?:number)=>Promise<any>;
export async function verifyFoodCustomerWorkRefresh(c:{db:pg.Client;base:string;shipment:string;orderId:string;accountId:string;access:string;call:Call;onRotated:(access:string)=>void}){
 const {db,base,shipment,orderId,call}=c,root='/api/mobile/v1',path=root+'/food/orders/'+orderId+'/delivery',expectedDefect=process.argv.includes('--expect-root-inversion');
 assert.equal(new URL(base).hostname,'127.0.0.1');assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 const hash=(value:string)=>createHash('sha256').update(value).digest('hex'),refresh=randomBytes(32).toString('base64url');
 const session=(await db.query('SELECT id,device_id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[c.accountId,hash(c.access)])).rows[0];assert.ok(session);
 await db.query('UPDATE bitpos.mobile_sessions SET refresh_hash=$2 WHERE id=$1',[session.id,hash(refresh)]);await db.query('INSERT INTO bitpos.mobile_refresh_history(token_hash,session_id) VALUES($1,$2)',[hash(refresh),session.id]);
 const before=(await db.query('SELECT to_jsonb(s) value FROM bitpos.food_shipments s WHERE id=$1',[shipment])).rows[0].value;
 let pending:Promise<{status:number;value:any}>|undefined;
 try{
  await db.query('BEGIN');await db.query('SELECT id FROM bitpos.food_shipments WHERE id=$1 FOR UPDATE',[shipment]);
  pending=fetch(base+path,{headers:{Authorization:'Bearer '+c.access}}).then(async r=>({status:r.status,value:await r.json()}));
  let rootWaitPid:number|null=null;const deadline=Date.now()+140;
  while(Date.now()<deadline){await db.query('SELECT pg_stat_clear_snapshot()');rootWaitPid=(await db.query("SELECT pid FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND datname=current_database() AND wait_event_type='Lock' AND query LIKE '%dispatch_customer_work%' ")).rows[0]?.pid??null;if(rootWaitPid)break;}
  assert.ok(rootWaitPid,'Actual customer work GET must reach canonical shipment lock wait');
  const refreshPending=call(root+'/auth/refresh','POST',{refreshToken:refresh,deviceId:session.device_id});let refreshBlockedByGet=false,rotated:any;
  if(expectedDefect){
   const until=Date.now()+150;while(Date.now()<until){await db.query('SELECT pg_stat_clear_snapshot()');refreshBlockedByGet=(await db.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%mobile_sessions%' AND $1=ANY(pg_blocking_pids(pid))",[rootWaitPid])).rows[0].n>0;if(refreshBlockedByGet)break;}
   assert.ok(refreshBlockedByGet,'Actual refresh must be blocked by observed root-waiting GET session lock');await db.query('COMMIT');rotated=await refreshPending;
  }else{rotated=await refreshPending;await db.query('COMMIT');}
  c.onRotated(rotated.accessToken);const stale=await pending;
  assert.equal(stale.status,expectedDefect?200:401,JSON.stringify(stale));if(!expectedDefect)assert.equal(stale.value.error.code,'AUTH_REQUIRED');
  const current=await call(path,'GET',undefined,rotated.accessToken);assert.equal(current.shipmentId,shipment);
  assert.deepEqual((await db.query('SELECT to_jsonb(s) value FROM bitpos.food_shipments s WHERE id=$1',[shipment])).rows[0].value,before);
  const receipt={status:expectedDefect?'REPRODUCED_ORIGINAL079_CUSTOMER_GET_REFRESH_ROOT_INVERSION':'PASS_CUSTOMER_GET_REFRESH_ROOT_FENCE',queuedGetStatus:stale.status,queuedGetCode:stale.value.error?.code??null,observedRootWait:true,refreshBlockedByGet,rotatedGet:'200 correct owned shipment',shipmentUnchanged:true,explanation:expectedDefect?'Actual pg_blocking_pids edge proves refresh blocked by pre-root retained GET session lock while GET waits on shipment. Root must release before either completes; original generic GET has no lock timeout. Prior30s probe timeout retained separately, not claimed500 or historical native cause.':'Root-first presented-bearer authority rejects old GET401 after actual refresh; rotated GET succeeds without changing shipment',physicalTesting:'deferred_by_user_2026-10-16'};
  await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch086-customer-work-refresh-'+(expectedDefect?'before':'after')+'-20261019.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 }finally{await db.query('ROLLBACK');if(pending)await pending;}
}
