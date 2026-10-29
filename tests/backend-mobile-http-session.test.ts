import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import pg from 'pg';
// Regression for docs/E2E_ORDER_RUN_20261030_TH.md P0-1/P0-2: coupon apply, schedule slots and
// schedule hold called through the real HTTP route handler with a REAL, committed mobile session
// (access token -> sha256 -> mobile_sessions.access_hash). The older rolled-back fixtures preset
// bitpos.mobile_access_hash themselves, which hid that the routes never set it (401 AUTH_REQUIRED /
// 500). Needs the committed seed database: BITPOS_FIX_FIXTURE=1 and the bitpos_fix_fixture URLs
//   BITPOS_TRY_DB=bitpos_fix_fixture tsx tools/runtime/try-apps-seed.ts setup   (see docs/TRY_APPS_LOCAL_TH.md)
const integration={skip:process.env.BITPOS_FIX_FIXTURE!=='1'};
const M='/api/mobile/v1';
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
test('coupon, schedule slots and schedule hold authenticate with a real session and refuse business errors as non-401',integration,async()=>{
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 try{
  assert.equal((await admin.query('SELECT current_database() n')).rows[0].n,'bitpos_fix_fixture');
  const merchant=(await admin.query('SELECT merchant_id,id FROM bitpos.marketplace_branches ORDER BY id LIMIT 1')).rows[0];
  assert.ok(merchant,'run the seed setup against bitpos_fix_fixture first');
  const product=(await admin.query("SELECT id FROM bitpos.products WHERE merchant_id=$1 AND name='ครัวซองต์เนยสด'",[merchant.merchant_id])).rows[0].id;
  const account=randomUUID(),session=randomUUID(),access=randomBytes(32).toString('base64url'),refresh=randomBytes(32).toString('base64url');
  await admin.query('INSERT INTO bitpos.mobile_accounts(id,auth_subject) VALUES($1,$2)',[account,randomUUID()]);
  await admin.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[session,account,randomUUID(),sha(access),sha(refresh)]);
  await admin.query('INSERT INTO bitpos.mobile_refresh_history(token_hash,session_id) VALUES($1,$2)',[sha(refresh),session]);
  const food=await import('../apps/api/src/mobile-food');
  const bearer='Bearer '+access,call=(method:string,path:string,body?:unknown,token=bearer)=>food.mobileFoodRequest(new URL('http://x'+M+path),method,body,token) as Promise<any>;
  const quote=async()=>call('POST','/food/quotes',{branchId:merchant.id,serving:'pickup',items:[{lineId:randomUUID(),productId:product,qty:2,optionVersion:null,selections:[],allergyNote:null}]});
  const refused=async(p:Promise<unknown>,status:number)=>assert.rejects(p,(e:any)=>{assert.equal(e.status,status,String(e.code)+' '+e.message);assert.notEqual(e.status,401);return true;});

  // P0-1 valid code on a valid session: discounted replacement quote, idempotent replay.
  const base=await quote(),key=randomUUID();
  const applied=await call('POST',`/food/quotes/${base.id}/coupon`,{code:'try50',idempotencyKey:key});
  assert.equal(applied.couponCode,'TRY50');assert.equal(applied.sourceQuoteId,base.id);
  assert.equal(BigInt(applied.quote.discount.amountMinor),50n);
  assert.equal(BigInt(applied.quote.total.amountMinor),BigInt(base.total.amountMinor)-50n);
  const replay=await call('POST',`/food/quotes/${base.id}/coupon`,{code:'TRY50',idempotencyKey:key});
  assert.equal(replay.quote.id,applied.quote.id);
  // invalid code: a business refusal (409 QUOTE_CHANGED/COUPON_NOT_FOUND), never 401 that signs the customer out.
  await refused(call('POST',`/food/quotes/${(await quote()).id}/coupon`,{code:'NOPE-CODE',idempotencyKey:randomUUID()}),409);
  // a genuinely bad token is still 401.
  await assert.rejects(call('POST',`/food/quotes/${base.id}/coupon`,{code:'TRY50',idempotencyKey:randomUUID()},'Bearer '+randomBytes(32).toString('base64url')),(e:any)=>e.status===401);

  // P0-2 published slots: 200 with real windows for both servings, not 500.
  const pickup=await call('GET',`/branches/${merchant.id}/schedule-slots?serving=pickup`);
  assert.ok(pickup.slots.length>0);assert.equal(pickup.serving,'pickup');
  const delivery=await call('GET',`/branches/${merchant.id}/schedule-slots?serving=delivery`);
  assert.ok(delivery.slots.length>0);
  // schedule hold: held, replayed with the same key, second command for a held quote refused (not 401).
  const held=await quote(),hkey=randomUUID(),slotId=pickup.slots[0].id;
  const hold=await call('POST',`/food/quotes/${held.id}/schedule-hold`,{slotId,idempotencyKey:hkey});
  assert.equal(hold.state,'HELD');assert.equal(hold.slotId,slotId);assert.equal(hold.replayed,false);
  const again=await call('POST',`/food/quotes/${held.id}/schedule-hold`,{slotId,idempotencyKey:hkey});
  assert.equal(again.id,hold.id);assert.equal(again.replayed,true);
  await refused(call('POST',`/food/quotes/${held.id}/schedule-hold`,{slotId,idempotencyKey:randomUUID()}),409);
 }finally{await admin.end();(await import('../apps/api/src/db')).pool.end().catch(()=>undefined);}
});
