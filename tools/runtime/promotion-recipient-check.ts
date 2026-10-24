/** Own-stack rollback only: no model, payment, published campaign or physical device. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../../apps/api/src/db';
import {registry} from '../../apps/api/src/registry';
import {seatCustomer} from '../../apps/api/src/merchant-recipient';
import {personalRecipientsView,personalPromotionContext,savePersonalJobBinding,guardPersonalJob} from '../../apps/api/src/personal-promotions';
import {clearTableOccupancy} from '../../apps/api/src/table-occupancy';
if(process.env.BITPOS_RECIPIENT_ROLLBACK_CHECK!=='1')throw Error('Explicit rollback check required');
const db=await pool.connect();let step='begin';
try{
 await db.query('BEGIN');assert.equal((await db.query('SELECT current_user AS role')).rows[0].role,'bitpos_app');
 const merchant=randomUUID(),actor=randomUUID(),customer=randomUUID();
 await db.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);
 await db.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Recipient rollback fixture','11111111111111111111111111111111')",[merchant]);
 await db.query("INSERT INTO customers(merchant_id,id,name) VALUES($1,$2,'Recognized guest')",[merchant,customer]);
 await db.query("INSERT INTO customers(merchant_id) SELECT $1 FROM generate_series(1,10)",[merchant]);
 const reg=(path:string,method:string,input:unknown)=>registry(db,merchant,actor,'owner',path,method,input);
 const table=await reg('/api/tables','POST',{label:'Rollback table'});
 const device=await reg('/api/devices','POST',{label:'Rollback Mini',tableId:table.id});
 step='empty table discovery';const empty=await personalRecipientsView(db,merchant);assert.equal(empty.tables[0].active,false);assert.ok(empty.tables[0].device);assert.equal(empty.customers.length,1);
 const current=empty.tables[0],target=current.device!;
 const body={tableId:table.id,customerId:customer,expectedGeneration:current.generation,deviceId:target.id,assignmentGeneration:target.assignmentGeneration,authGeneration:target.authGeneration,requestId:randomUUID(),confirmPresent:true as const};
 const rejected=async(fn:()=>Promise<unknown>,code:RegExp)=>{await db.query('SAVEPOINT negative');await assert.rejects(fn,code);await db.query('ROLLBACK TO SAVEPOINT negative');await db.query('RELEASE SAVEPOINT negative');};
 await rejected(()=>seatCustomer(db,merchant,actor,'staff',body),/ROLE_REQUIRED/);
 await rejected(()=>seatCustomer(db,merchant,actor,'owner',{...body,confirmPresent:false}),/Invalid literal|Invalid input/);
 await rejected(()=>seatCustomer(db,merchant,actor,'owner',{...body,customerId:randomUUID()}),/RESOURCE_NOT_FOUND/);
 await rejected(()=>seatCustomer(db,merchant,actor,'owner',{...body,expectedGeneration:'99'}),/TABLE_OCCUPANCY_CHANGED/);
 await rejected(()=>seatCustomer(db,merchant,actor,'owner',{...body,assignmentGeneration:'99'}),/ASSIGNMENT_CHANGED/);
 step='explicit merchant seating';const seated=await seatCustomer(db,merchant,actor,'owner',body);assert.equal(seated.replayed,false);
 const replay=await seatCustomer(db,merchant,actor,'owner',body);assert.equal(replay.visitId,seated.visitId);assert.equal(replay.replayed,true);
 const sameCustomer=await seatCustomer(db,merchant,actor,'manager',{...body,requestId:randomUUID()});assert.equal(sameCustomer.visitId,seated.visitId);
 const view=await personalRecipientsView(db,merchant);assert.equal(view.tables[0].active,true);assert.equal(view.tables[0].guests.length,1);assert.equal(view.tables[0].guests[0].recognition,'staff_confirmed_profile');
 assert.equal(view.tables[0].guests[0].customerId,customer);
 step='personal targeting';const context=await personalPromotionContext(db,merchant,'customer',{tableId:table.id,occupancyGeneration:body.expectedGeneration,recipientVisitId:seated.visitId,customerId:customer,confirmRecipient:true});
 assert.equal(context.binding.originBasis,'staff_recognition');assert.equal(context.binding.customerAuthSessionId,null);assert.equal(context.binding.targetDeviceId,device.id);
 const counts=(await db.query('SELECT (SELECT count(*)::int FROM orders WHERE merchant_id=$1) AS orders,(SELECT count(*)::int FROM order_quotes WHERE merchant_id=$1) AS quotes,(SELECT count(*)::int FROM customer_auth_sessions WHERE merchant_id=$1) AS auth,(SELECT count(*)::int FROM device_sessions WHERE merchant_id=$1) AS carts',[merchant])).rows[0];assert.deepEqual(counts,{orders:0,quotes:0,auth:0,carts:0});
 const job=randomUUID();await db.query("INSERT INTO ai_generation_jobs(merchant_id,id,actor_id,input,products,state) VALUES($1,$2,$3,'{}','[]','QUEUED')",[merchant,job,actor]);await savePersonalJobBinding(db,merchant,job,context.binding);await guardPersonalJob(db,merchant,job);
 step='clear fences old recipient';await clearTableOccupancy(db,merchant,actor,'owner',table.id,{expectedGeneration:body.expectedGeneration,idempotencyKey:randomUUID(),confirmClear:true});
 await rejected(()=>seatCustomer(db,merchant,actor,'owner',body),/TABLE_OCCUPANCY_CHANGED/);
 await rejected(()=>guardPersonalJob(db,merchant,job),/PROMOTION_TARGET_CHANGED/);
 const cleared=await personalRecipientsView(db,merchant);assert.equal(cleared.tables[0].active,false);assert.equal(cleared.tables[0].guests.length,0);
 await db.query('SET CONSTRAINTS ALL IMMEDIATE');await db.query('ROLLBACK');
 console.log(JSON.stringify({result:'PASS',databaseRole:'bitpos_app',explicitPresenceRequired:true,anonymousProfilesHiddenWithoutDeletion:10,emptyTableVisible:true,seatingWithoutOrder:true,noWalletAuthenticationForged:true,idempotent:true,crossCustomerAndStaleFencesRejected:true,clearInvalidatesTarget:true,modelCalls:0,payments:0,rowsCommitted:0}));
}catch(error){await db.query('ROLLBACK');const e=error as {code?:string;message?:string};console.error(JSON.stringify({result:'FAIL_ROLLED_BACK',step,code:e.code,message:e.message}));process.exitCode=1;}
finally{db.release();await pool.end();}
