import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from './authority';
import {audit} from './db';

const uuid=z.string().uuid();
const text=(max:number)=>z.string().trim().max(max);
const create=z.object({name:text(120).min(1),supplies:text(200).default(''),contact:text(120).default(''),phone:text(40).default(''),idempotencyKey:z.string().min(1).max(128)}).strict();
const patch=z.object({expectedVersion:z.number().int().min(1),name:text(120).min(1).optional(),supplies:text(200).optional(),contact:text(120).optional(),phone:text(40).optional(),active:z.boolean().optional()}).strict()
 .refine(v=>['name','supplies','contact','phone','active'].some(k=>k in v));
export interface Supplier{id:string;name:string;supplies:string;contact:string;phone:string;active:boolean;version:number;createdAt:string;updatedAt:string}
const maxSuppliers=500;
type Row={id:string;name:string;supplies:string;contact:string;phone:string;active:boolean;version:number;created_at:Date;updated_at:Date};
const view=(r:Row):Supplier=>({id:r.id,name:r.name,supplies:r.supplies,contact:r.contact,phone:r.phone,active:r.active,version:r.version,createdAt:r.created_at.toISOString(),updatedAt:r.updated_at.toISOString()});
/** Owner/manager only. A directory of the shop's suppliers: create is idempotent, edits are optimistic (expectedVersion), rows are deactivated and never deleted. */
export async function suppliersRequest(db:pg.PoolClient,merchant:string,actor:string,role:string,url:URL,method:string,input:unknown){
 requireRole(role);
 const path=url.pathname;
 if(path==='/api/suppliers'&&method==='GET'){
  if(url.search)fail('INVALID_REQUEST',422);
  const rows=(await db.query<Row>('SELECT id,name,supplies,contact,phone,active,version,created_at,updated_at FROM suppliers WHERE merchant_id=$1 ORDER BY active DESC,lower(name),id LIMIT $2',[merchant,maxSuppliers])).rows;
  return {suppliers:rows.map(view)};
 }
 if(path==='/api/suppliers'&&method==='POST'){
  const data=create.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
  const d=data.data;
  const prior=(await db.query<Row&{name:string}>('SELECT * FROM suppliers WHERE merchant_id=$1 AND idempotency_key=$2',[merchant,d.idempotencyKey])).rows[0];
  if(prior){if(prior.name!==d.name)fail('IDEMPOTENCY_CONFLICT');return {supplier:view(prior),replayed:true};}
  if(Number((await db.query('SELECT count(*)::int n FROM suppliers WHERE merchant_id=$1',[merchant])).rows[0].n)>=maxSuppliers)fail('INVALID_REQUEST',422);
  const row=(await db.query<Row>('INSERT INTO suppliers(merchant_id,name,supplies,contact,phone,idempotency_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[merchant,d.name,d.supplies,d.contact,d.phone,d.idempotencyKey])).rows[0];
  await audit(db,merchant,actor,'supplier.create',row.id);
  return {supplier:view(row),replayed:false};
 }
 const match=/^\/api\/suppliers\/([0-9a-f-]{36})$/.exec(path);
 if(match&&method==='PATCH'){
  const id=uuid.safeParse(match[1]),data=patch.safeParse(input);if(!id.success||!data.success)fail('INVALID_REQUEST',422);
  const d=data.data;
  const row=(await db.query<Row>('SELECT * FROM suppliers WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,id.data])).rows[0];
  if(!row)fail('RESOURCE_NOT_FOUND',404);
  if(row.version!==d.expectedVersion)fail('VERSION_CONFLICT');
  const next=(await db.query<Row>('UPDATE suppliers SET name=$3,supplies=$4,contact=$5,phone=$6,active=$7,version=version+1,updated_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2 RETURNING *',
   [merchant,id.data,d.name??row.name,d.supplies??row.supplies,d.contact??row.contact,d.phone??row.phone,d.active??row.active])).rows[0];
  await audit(db,merchant,actor,d.active===undefined?'supplier.update':d.active?'supplier.activate':'supplier.deactivate',id.data);
  return {supplier:view(next)};
 }
 fail('RESOURCE_NOT_FOUND',404);
}
