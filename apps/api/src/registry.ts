import type pg from 'pg';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {hash} from '../../../packages/domain/src/index';
import {audit} from './db';
import {fail,requireRole,routingLock,uuid,label,integer} from './authority';
export async function ensureDevice(db:pg.PoolClient,merchant:string,id:string){for(const table of ['device_presence','device_screen_state','device_event_counters'])await db.query(`INSERT INTO ${table}(merchant_id,device_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[merchant,id]);}
export async function expireCart(db:pg.PoolClient,merchant:string,id:string){await db.query("UPDATE device_sessions SET ended_at=clock_timestamp() WHERE merchant_id=$1 AND id IN (SELECT session_id FROM device_screen_state WHERE device_id=$2 AND kind='cart' AND lease_until<=clock_timestamp())",[merchant,id]);await db.query("UPDATE device_screen_state SET kind='idle',screen_generation=screen_generation+1,session_id=NULL,lease_until=NULL WHERE merchant_id=$1 AND device_id=$2 AND kind='cart' AND lease_until<=clock_timestamp()",[merchant,id]);}
export async function registry(db:pg.PoolClient,merchant:string,actor:string,role:string,path:string,method:string,input:unknown){
 const match=path.match(/^\/api\/(tables|devices|registers)(?:\/([^/]+)(?:\/(pairing|credential|submissions)\/?([^/]*)?)?)?$/);if(!match)return undefined;
 const [,kind,raw,action]=match;const id=raw?uuid.parse(raw):undefined;
 if(action==='submissions')return undefined;
 if(method==='GET'&&!id){
 if(kind==='tables')return {tables:(await db.query('SELECT id,label,retired_at AS "retiredAt" FROM merchant_tables ORDER BY label,id')).rows};
 if(kind==='registers')return {registers:(await db.query('SELECT r.id,r.label,r.paired_device_id AS "deviceId",r.pairing_generation::text AS "pairingGeneration",r.retired_at AS "retiredAt",coalesce(p.connected_until>clock_timestamp(),false) AS "targetOnline" FROM registers r LEFT JOIN device_presence p ON p.merchant_id=r.merchant_id AND p.device_id=r.paired_device_id ORDER BY r.label,r.id')).rows};
 const rows=(await db.query('SELECT d.id,d.label,d.table_id AS "tableId",t.label AS "tableLabel",d.assignment_generation::text AS "assignmentGeneration",d.auth_generation::text AS "authGeneration",d.revoked_at AS "revokedAt",coalesce(p.connected_until>clock_timestamp(),false) AND d.revoked_at IS NULL AS online,p.last_seen_at AS "lastSeenAt",coalesce(p.connection_generation,0)::text AS "connectionGeneration",jsonb_build_object(\'kind\',coalesce(s.kind,\'idle\'),\'screenGeneration\',coalesce(s.screen_generation,1)::text,\'orderId\',s.order_id,\'sessionId\',s.session_id) AS screen FROM devices d LEFT JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id LEFT JOIN device_presence p ON p.merchant_id=d.merchant_id AND p.device_id=d.id LEFT JOIN device_screen_state s ON s.merchant_id=d.merchant_id AND s.device_id=d.id ORDER BY d.label,d.id')).rows;return {devices:rows};
 }
 requireRole(role,action==='credential');await routingLock(db,merchant);
 const table=kind==='tables'?'merchant_tables':kind;
 if(id&&!(await db.query(`SELECT id FROM ${table} WHERE merchant_id=$1 AND id=$2`,[merchant,id])).rowCount)fail('RESOURCE_NOT_FOUND',404);
 if(action==='credential'){
 z.object({}).strict().parse(input??{});if(!['POST','DELETE'].includes(method))fail('RESOURCE_NOT_FOUND',404);
 await db.query('UPDATE device_credentials SET revoked_at=clock_timestamp() WHERE merchant_id=$1 AND device_id=$2 AND revoked_at IS NULL',[merchant,id]);
 const d=(await db.query('UPDATE devices SET auth_generation=auth_generation+1 WHERE merchant_id=$1 AND id=$2 RETURNING auth_generation::text',[merchant,id])).rows[0];await db.query('UPDATE device_presence SET connected_until=NULL WHERE merchant_id=$1 AND device_id=$2',[merchant,id]);
 await audit(db,merchant,actor,method==='POST'?'device.credential.rotate':'device.credential.revoke',id!);
 if(method==='DELETE')return {deviceId:id,authGeneration:d.auth_generation};
 const token=randomBytes(32).toString('base64url');await db.query('INSERT INTO device_credentials(token_hash,merchant_id,device_id,auth_generation) VALUES($1,$2,$3,$4)',[hash(token),merchant,id,d.auth_generation]);return {deviceId:id,deviceToken:token,authGeneration:d.auth_generation};
 }
 if(action==='pairing'&&kind==='registers'&&method==='PUT'){
 const data=z.object({deviceId:uuid.nullable(),expectedPairingGeneration:integer}).strict().parse(input);
 const r=(await db.query('SELECT * FROM registers WHERE merchant_id=$1 AND id=$2 AND retired_at IS NULL FOR UPDATE',[merchant,id])).rows[0];if(!r)fail('RESOURCE_NOT_FOUND',404);if(String(r.pairing_generation)!==data.expectedPairingGeneration)fail('PAIRING_CHANGED');
 if(data.deviceId){const d=(await db.query('SELECT id FROM devices WHERE merchant_id=$1 AND id=$2 AND revoked_at IS NULL',[merchant,data.deviceId])).rows[0];if(!d)fail('RESOURCE_NOT_FOUND',404);if((await db.query('SELECT id FROM registers WHERE merchant_id=$1 AND paired_device_id=$2 AND id<>$3',[merchant,data.deviceId,id])).rowCount)fail('PAIRING_CONFLICT');}
 if(r.paired_device_id!==data.deviceId){await db.query('UPDATE registers SET paired_device_id=$3,pairing_generation=pairing_generation+1 WHERE merchant_id=$1 AND id=$2',[merchant,id,data.deviceId]);await audit(db,merchant,actor,'register.pair',id!);}
 return (await db.query('SELECT r.id AS "registerId",r.paired_device_id AS "deviceId",r.pairing_generation::text AS "pairingGeneration",coalesce(p.connected_until>clock_timestamp(),false) AS "targetOnline" FROM registers r LEFT JOIN device_presence p ON p.merchant_id=r.merchant_id AND p.device_id=r.paired_device_id WHERE r.id=$1',[id])).rows[0];
 }
 if(method==='POST'&&!id){
  const d=z.object({label,tableId:uuid.nullable().optional()}).strict().parse(input);
  if(kind!=='devices'&&d.tableId!==undefined)fail('INVALID_REQUEST',400);
  if(kind==='devices'&&d.tableId)await activeTable(db,merchant,d.tableId);
  const row=(await db.query(kind==='devices'?'INSERT INTO devices(merchant_id,label,table_id) VALUES($1,$2,$3) RETURNING id':'INSERT INTO '+table+'(merchant_id,label) VALUES($1,$2) RETURNING id',kind==='devices'?[merchant,d.label,d.tableId??null]:[merchant,d.label])).rows[0];
  if(kind==='devices')await ensureDevice(db,merchant,row.id);
  await audit(db,merchant,actor,kind+'.create',row.id);return {id:row.id,label:d.label};
 }
 if(method==='PATCH'&&id&&kind==='tables'){
 const d=z.object({label:label.optional(),retired:z.boolean().optional()}).strict().parse(input);if(d.retired&&(await db.query('SELECT id FROM devices WHERE merchant_id=$1 AND table_id=$2 AND revoked_at IS NULL',[merchant,id])).rowCount)fail('DEVICE_BUSY');await db.query('UPDATE merchant_tables SET label=coalesce($3,label),retired_at=CASE WHEN $4::boolean IS NULL THEN retired_at WHEN $4 THEN clock_timestamp() ELSE NULL END WHERE merchant_id=$1 AND id=$2',[merchant,id,d.label,d.retired]);await audit(db,merchant,actor,'table.update',id);return {id};
 }
 if(method==='PATCH'&&id&&kind==='devices'){
 const d=z.object({label:label.optional(),tableId:uuid.nullable().optional(),expectedAssignmentGeneration:integer.optional(),revoked:z.boolean().optional()}).strict().parse(input);if(d.revoked!==undefined)requireRole(role,true);await ensureDevice(db,merchant,id);await expireCart(db,merchant,id);
 const old=(await db.query('SELECT * FROM devices WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,id])).rows[0];
 if(d.tableId!==undefined){if(d.expectedAssignmentGeneration!==String(old.assignment_generation))fail('ASSIGNMENT_CHANGED');if(d.tableId!==old.table_id&&(await db.query("SELECT 1 FROM device_screen_state WHERE device_id=$1 AND kind<>'idle'",[id])).rowCount)fail('DEVICE_BUSY');if(d.tableId)await activeTable(db,merchant,d.tableId);}
 if(d.revoked&&(await db.query("SELECT 1 FROM device_screen_state WHERE device_id=$1 AND kind<>'idle'",[id])).rowCount)fail('DEVICE_BUSY');
 await db.query('UPDATE devices SET label=coalesce($3,label),table_id=$4,assignment_generation=assignment_generation+CASE WHEN table_id IS DISTINCT FROM $4::uuid THEN 1 ELSE 0 END,revoked_at=CASE WHEN $5::boolean IS NULL THEN revoked_at WHEN $5 THEN clock_timestamp() ELSE NULL END WHERE merchant_id=$1 AND id=$2',[merchant,id,d.label,d.tableId===undefined?old.table_id:d.tableId,d.revoked]);await audit(db,merchant,actor,'device.update',id);return {id};
 }
 if(method==='PATCH'&&id&&kind==='registers'){
 const d=z.object({label:label.optional(),retired:z.boolean().optional(),expectedPairingGeneration:integer.optional()}).strict().parse(input);const r=(await db.query('SELECT * FROM registers WHERE id=$1 FOR UPDATE',[id])).rows[0];
 if(d.retired!==undefined&&d.expectedPairingGeneration!==String(r.pairing_generation))fail('PAIRING_CHANGED');
 await db.query('UPDATE registers SET label=coalesce($2,label),retired_at=CASE WHEN $3::boolean IS NULL THEN retired_at WHEN $3 THEN clock_timestamp() ELSE NULL END,paired_device_id=CASE WHEN $3 THEN NULL ELSE paired_device_id END,pairing_generation=pairing_generation+CASE WHEN $3 AND paired_device_id IS NOT NULL THEN 1 ELSE 0 END WHERE id=$1',[id,d.label,d.retired]);await audit(db,merchant,actor,'register.update',id);return {id};
 }
 fail('RESOURCE_NOT_FOUND',404);
}
export async function activeTable(db:pg.PoolClient,merchant:string,id:string){const t=(await db.query('SELECT * FROM merchant_tables WHERE merchant_id=$1 AND id=$2 AND retired_at IS NULL',[merchant,id])).rows[0];if(!t)fail('RESOURCE_NOT_FOUND',404);return t;}
