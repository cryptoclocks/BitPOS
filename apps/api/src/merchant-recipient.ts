import type pg from 'pg';
import {seatPromotionCustomer} from '../../../packages/contracts/src/personal-promotions';
import {audit} from './db';
import {fail,requireRole,routingLock} from './authority';

/** An explicit merchant assertion of presence; never a wallet login, payment or cart claim. */
export async function seatCustomer(db:pg.PoolClient,merchant:string,actor:string,role:string,input:unknown){
 requireRole(role);const d=seatPromotionCustomer.parse(input);await routingLock(db,merchant);
 const table=(await db.query('SELECT occupancy_generation::text AS generation FROM merchant_tables WHERE merchant_id=$1 AND id=$2 AND retired_at IS NULL FOR UPDATE',[merchant,d.tableId])).rows[0];
 if(!table||table.generation!==d.expectedGeneration)fail('TABLE_OCCUPANCY_CHANGED');
 if(!(await db.query('SELECT 1 FROM customers WHERE merchant_id=$1 AND id=$2',[merchant,d.customerId])).rowCount)fail('RESOURCE_NOT_FOUND',404);
 const entry=(await db.query(`SELECT e.id FROM table_entries e JOIN devices device ON device.merchant_id=e.merchant_id AND device.id=e.device_id
 WHERE e.merchant_id=$1 AND e.table_id=$2 AND e.device_id=$3 AND device.table_id=e.table_id AND device.revoked_at IS NULL
 AND e.assignment_generation=device.assignment_generation AND e.auth_generation=device.auth_generation
 AND e.assignment_generation=$4 AND e.auth_generation=$5`,[merchant,d.tableId,d.deviceId,d.assignmentGeneration,d.authGeneration])).rows[0];
 if(!entry)fail('ASSIGNMENT_CHANGED');
 const old=(await db.query(`SELECT v.id,p.customer_id,epoch.generation::text,r.occupancy_id,o.closed_at FROM table_visits v
 JOIN table_visit_epochs epoch ON epoch.merchant_id=v.merchant_id AND epoch.visit_id=v.id
 LEFT JOIN table_visit_recipients r ON r.merchant_id=v.merchant_id AND r.visit_id=v.id
 LEFT JOIN table_recipient_profiles p ON p.merchant_id=r.merchant_id AND p.recipient_id=r.recipient_id
 LEFT JOIN table_occupancies o ON o.merchant_id=r.merchant_id AND o.id=r.occupancy_id
 WHERE v.merchant_id=$1 AND v.entry_id=$2 AND v.request_id=$3`,[merchant,entry.id,d.requestId])).rows[0];
 if(old){if(old.customer_id!==d.customerId)fail('IDEMPOTENCY_CONFLICT');if(old.generation!==d.expectedGeneration||old.closed_at||!old.occupancy_id)fail('TABLE_OCCUPANCY_CHANGED');return {visitId:old.id,tableId:d.tableId,generation:d.expectedGeneration,replayed:true};}
 // Reusing a current relationship never changes an existing recipient or joins a different guest.
 const existing=(await db.query(`SELECT r.visit_id FROM table_recipient_profiles p JOIN table_visit_recipients r ON r.merchant_id=p.merchant_id AND r.recipient_id=p.recipient_id
 JOIN table_occupancies o ON o.merchant_id=r.merchant_id AND o.id=r.occupancy_id JOIN table_visits v ON v.merchant_id=r.merchant_id AND v.id=r.visit_id
 WHERE p.merchant_id=$1 AND p.customer_id=$2 AND o.table_id=$3 AND o.generation=$4 AND o.closed_at IS NULL AND v.entry_id=$5 ORDER BY v.created_at DESC LIMIT 1`,[merchant,d.customerId,d.tableId,d.expectedGeneration,entry.id])).rows[0];
 if(existing)return {visitId:existing.visit_id,tableId:d.tableId,generation:d.expectedGeneration,replayed:true};
 let occupancy=(await db.query('SELECT id FROM table_occupancies WHERE merchant_id=$1 AND table_id=$2 AND generation=$3 AND closed_at IS NULL',[merchant,d.tableId,d.expectedGeneration])).rows[0];
 if(!occupancy)occupancy=(await db.query('INSERT INTO table_occupancies(merchant_id,table_id,generation) VALUES($1,$2,$3) RETURNING id',[merchant,d.tableId,d.expectedGeneration])).rows[0];
 const visit=(await db.query('INSERT INTO table_visits(merchant_id,entry_id,request_id) VALUES($1,$2,$3) RETURNING id',[merchant,entry.id,d.requestId])).rows[0];
 await db.query('INSERT INTO table_occupancy_visits(merchant_id,occupancy_id,visit_id) VALUES($1,$2,$3)',[merchant,occupancy.id,visit.id]);
 const recipient=(await db.query('INSERT INTO table_occupancy_recipients(merchant_id,occupancy_id) VALUES($1,$2) RETURNING id',[merchant,occupancy.id])).rows[0];
 await db.query('INSERT INTO table_visit_recipients(merchant_id,visit_id,recipient_id,occupancy_id) VALUES($1,$2,$3,$4)',[merchant,visit.id,recipient.id,occupancy.id]);
 await db.query("INSERT INTO table_recipient_profiles(merchant_id,recipient_id,customer_id,basis) VALUES($1,$2,$3,'staff_recognition')",[merchant,recipient.id,d.customerId]);
 await db.query('UPDATE table_occupancies SET last_activity_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2',[merchant,occupancy.id]);
 await audit(db,merchant,actor,'promotion.customer.seated',recipient.id);
 return {visitId:visit.id,tableId:d.tableId,generation:d.expectedGeneration,replayed:false};
}
