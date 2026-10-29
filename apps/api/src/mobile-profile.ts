import {createHash} from 'node:crypto';
import type pg from 'pg';
import {z} from 'zod';
import {pool} from './db';
import {mobilePrincipal} from './mobile-auth';
import {fail} from './authority';
import {MobileAccountEraseSchema,MobileRewardsSchema,MobileAccountExportSchema,MobileProfileUpdateSchema,MobileAddressCreateSchema,MobileAddressUpdateSchema,MobileAddressArchiveSchema,type MobileAddress,type MobileAddressFields} from '../../../packages/contracts/src/mobile-v1.generated';

interface AddressRow {id:string;version:string;label:string;recipient_name:string;phone:string;address_text:string;instructions:string;latitude_e7:number|null;longitude_e7:number|null;archived:boolean;updated_at:Date;}
const addressView=(row:AddressRow):MobileAddress=>({id:row.id,version:String(row.version),address:{label:row.label,recipientName:row.recipient_name,phone:row.phone,addressText:row.address_text,instructions:row.instructions,latitudeE7:row.latitude_e7,longitudeE7:row.longitude_e7},archived:row.archived,updatedAt:row.updated_at.toISOString()});
function validateAddress(value:MobileAddressFields){
 if(!value.label.trim()||!value.recipientName.trim()||!value.addressText.trim()||(value.latitudeE7===null)!==(value.longitudeE7===null))fail('INVALID_REQUEST',422);
}
async function owned<T>(accountId:string,run:(db:pg.PoolClient)=>Promise<T>){
 const db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SELECT set_config('bitpos.mobile_account',$1,true)",[accountId]);
  // One account lock orders profile/address mutations and their replay records.
  await db.query('SELECT id FROM mobile_accounts WHERE id=$1 FOR UPDATE',[accountId]);
  const result=await run(db);await db.query('COMMIT');return result;
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
async function command(db:pg.PoolClient,account:string,session:string,key:string,operation:string,input:unknown,run:()=>Promise<unknown>){
 const hash=createHash('sha256').update(JSON.stringify({operation,input})).digest('hex');
 const previous=(await db.query('SELECT operation,request_hash,response FROM mobile_account_commands WHERE account_id=$1 AND idempotency_key=$2',[account,key])).rows[0];
 if(previous){if(previous.operation!==operation||previous.request_hash!==hash)fail('IDEMPOTENCY_CONFLICT',409);return previous.response;}
 const response=await run();
 await db.query('INSERT INTO mobile_account_commands(account_id,idempotency_key,operation,request_hash,response) VALUES($1,$2,$3,$4,$5)',[account,key,operation,hash,JSON.stringify(response)]);
 await db.query('INSERT INTO mobile_identity_audit(account_id,session_id,action) VALUES($1,$2,$3)',[account,session,operation]);
 return response;
}
export async function mobileProfileRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const path=url.pathname;
 const address=path.match(/^\/api\/mobile\/v1\/account\/addresses\/([^/]+)(\/archive)?$/);
 if(path!=='/api/mobile/v1/account/profile'&&path!=='/api/mobile/v1/account/addresses'&&path!=='/api/mobile/v1/account/export'&&path!=='/api/mobile/v1/account/rewards'&&path!=='/api/mobile/v1/account/erase'&&!address)return undefined;
 const actor=await mobilePrincipal(bearer);
 if(path==='/api/mobile/v1/account/erase'){
  // Default policy: anonymise what the account owns and sign it out; financial records stay. Refused while anything is open.
  if(method!=='POST')fail('INVALID_REQUEST',422);
  const data=MobileAccountEraseSchema.parse(input);
  return owned(actor.accountId,db=>command(db,actor.accountId,actor.sessionId,data.idempotencyKey,'account.erase',data,async()=>{
   const blockers=(await db.query<{n:number|null}>('SELECT bitpos.mobile_erase_blockers($1,$2) AS n',[actor.accountId,actor.sessionId])).rows[0].n;
   if(blockers===null)fail('AUTH_REQUIRED',401);
   if(blockers>0)fail('ACCOUNT_HAS_OPEN_ORDERS',409);
   const blanked=(await db.query("UPDATE mobile_addresses SET label='Erased',recipient_name='Erased',phone='+10000000',address_text='Erased',instructions='',latitude_e7=NULL,longitude_e7=NULL,archived=true,version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 RETURNING id",[actor.accountId])).rowCount??0;
   const favourites=(await db.query('DELETE FROM mobile_favourite_branches WHERE account_id=$1 RETURNING branch_id',[actor.accountId])).rowCount??0;
   await db.query("UPDATE mobile_accounts SET display_name='',disabled_at=clock_timestamp() WHERE id=$1",[actor.accountId]);
   await db.query('UPDATE mobile_sessions SET revoked_at=clock_timestamp() WHERE account_id=$1 AND revoked_at IS NULL',[actor.accountId]);
   return {erasedAt:new Date().toISOString(),addressesBlanked:blanked,favouritesDeleted:favourites};
  }));
 }
 if(path==='/api/mobile/v1/account/rewards'){
  // Derived, read-only points (see migration 141). No award, redemption or stored balance exists.
  if(method!=='GET'||url.search)fail('INVALID_REQUEST',422);
  const rows=(await pool.query<{currency:string;decimals:number;orders:number;points:string}>('SELECT * FROM bitpos.mobile_reward_totals($1,$2)',[actor.accountId,actor.sessionId])).rows;
  return MobileRewardsSchema.parse({generatedAt:new Date().toISOString(),totals:rows.map(r=>({currency:r.currency,decimals:r.decimals,orders:r.orders,points:Number(r.points)}))});
 }
 if(path==='/api/mobile/v1/account/export'){
  // Read-only copy of the caller's own data. Lists are bounded and `truncated` says so; it is a copy, not a deletion or fulfilment of a privacy request.
  if(method!=='GET'||url.search)fail('INVALID_REQUEST',422);
  const own=await owned(actor.accountId,async db=>{
   const profile=(await db.query('SELECT id,display_name,locale,profile_version::text FROM mobile_accounts WHERE id=$1',[actor.accountId])).rows[0];
   const addresses=(await db.query<AddressRow>('SELECT * FROM mobile_addresses WHERE account_id=$1 ORDER BY id LIMIT 201',[actor.accountId])).rows;
   const favourites=(await db.query<{merchant_id:string;branch_id:string;created_at:Date}>('SELECT merchant_id,branch_id,created_at FROM mobile_favourite_branches WHERE account_id=$1 ORDER BY branch_id LIMIT 501',[actor.accountId])).rows;
   const cases=(await db.query<{id:string;subject:string;state:string;created_at:Date;order_id:string|null}>('SELECT id,subject,state,created_at,order_id FROM mobile_support_cases WHERE account_id=$1 ORDER BY created_at DESC,id LIMIT 101',[actor.accountId])).rows;
   return {profile,addresses,favourites,cases};
  });
  const {mobileFoodRequest}=await import('./mobile-food');
  const orders=await mobileFoodRequest(new URL('/api/mobile/v1/food/orders',url),'GET',undefined,bearer) as {orders:unknown[];nextCursor:string|null};
  return MobileAccountExportSchema.parse({
   generatedAt:new Date().toISOString(),
   profile:{id:own.profile.id,displayName:own.profile.display_name,locale:own.profile.locale,version:own.profile.profile_version},
   addresses:own.addresses.slice(0,200).map(addressView),
   favourites:own.favourites.slice(0,500).map(f=>({merchantId:f.merchant_id,branchId:f.branch_id,createdAt:f.created_at.toISOString()})),
   orders:orders.orders,
   supportCases:own.cases.slice(0,100).map(c=>({id:c.id,subject:c.subject,state:c.state,createdAt:c.created_at.toISOString(),orderId:c.order_id})),
   truncated:own.addresses.length>200||own.favourites.length>500||own.cases.length>100||orders.nextCursor!==null
  });
 }
 if(path==='/api/mobile/v1/account/profile'){
  if(method==='GET')return owned(actor.accountId,async db=>{const row=(await db.query('SELECT id,display_name,locale,profile_version::text FROM mobile_accounts WHERE id=$1',[actor.accountId])).rows[0];return {id:row.id,displayName:row.display_name,locale:row.locale,version:row.profile_version};});
  if(method==='PUT'){
   const data=MobileProfileUpdateSchema.parse(input);
   return owned(actor.accountId,db=>command(db,actor.accountId,actor.sessionId,data.idempotencyKey,'profile.update',data,async()=>{
    const row=(await db.query('UPDATE mobile_accounts SET display_name=$2,locale=$3,profile_version=profile_version+1 WHERE id=$1 AND profile_version::text=$4 RETURNING id,display_name,locale,profile_version::text',[actor.accountId,data.displayName,data.locale,data.expectedVersion])).rows[0];
    if(!row)fail('VERSION_CONFLICT',409);
    return {id:row.id,displayName:row.display_name,locale:row.locale,version:row.profile_version};
   }));
  }
 }else if(path==='/api/mobile/v1/account/addresses'){
  if(method==='GET'){
   const cursor=url.searchParams.has('cursor')?z.string().uuid().parse(url.searchParams.get('cursor')):null;
   if([...url.searchParams.keys()].some(key=>key!=='cursor'))fail('INVALID_REQUEST',422);
   return owned(actor.accountId,async db=>{
    const rows=(await db.query<AddressRow>('SELECT * FROM mobile_addresses WHERE account_id=$1 AND NOT archived AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 21',[actor.accountId,cursor])).rows;
    return {addresses:rows.slice(0,20).map(addressView),nextCursor:rows.length>20?rows[19].id:null};
   });
  }
  if(method==='POST'){
   const data=MobileAddressCreateSchema.parse(input);validateAddress(data.address);
   return owned(actor.accountId,db=>command(db,actor.accountId,actor.sessionId,data.idempotencyKey,'address.create',data,async()=>{
    const count=(await db.query('SELECT count(*)::int AS n FROM mobile_addresses WHERE account_id=$1 AND NOT archived',[actor.accountId])).rows[0].n;
    if(count>=50)fail('ADDRESS_LIMIT',409);
    const a=data.address;
    const row=(await db.query<AddressRow>('INSERT INTO mobile_addresses(account_id,label,recipient_name,phone,address_text,instructions,latitude_e7,longitude_e7) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[actor.accountId,a.label,a.recipientName,a.phone,a.addressText,a.instructions,a.latitudeE7,a.longitudeE7])).rows[0];
    return addressView(row);
   }));
  }
 }else if(address){
  const id=z.string().uuid().parse(address[1]);
  if(method==='PUT'&&!address[2]){
   const data=MobileAddressUpdateSchema.parse(input);validateAddress(data.address);
   return owned(actor.accountId,db=>command(db,actor.accountId,actor.sessionId,data.idempotencyKey,'address.update:'+id,data,async()=>{
    const current=(await db.query<AddressRow>('SELECT * FROM mobile_addresses WHERE account_id=$1 AND id=$2 AND NOT archived',[actor.accountId,id])).rows[0];
    if(!current)fail('RESOURCE_NOT_FOUND',404);if(String(current.version)!==data.expectedVersion)fail('VERSION_CONFLICT',409);
    const a=data.address;
    return addressView((await db.query<AddressRow>('UPDATE mobile_addresses SET label=$3,recipient_name=$4,phone=$5,address_text=$6,instructions=$7,latitude_e7=$8,longitude_e7=$9,version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 AND id=$2 RETURNING *',[actor.accountId,id,a.label,a.recipientName,a.phone,a.addressText,a.instructions,a.latitudeE7,a.longitudeE7])).rows[0]);
   }));
  }
  if(method==='POST'&&address[2]){
   const data=MobileAddressArchiveSchema.parse(input);
   return owned(actor.accountId,db=>command(db,actor.accountId,actor.sessionId,data.idempotencyKey,'address.archive:'+id,data,async()=>{
    const current=(await db.query<AddressRow>('SELECT * FROM mobile_addresses WHERE account_id=$1 AND id=$2 AND NOT archived',[actor.accountId,id])).rows[0];
    if(!current)fail('RESOURCE_NOT_FOUND',404);if(String(current.version)!==data.expectedVersion)fail('VERSION_CONFLICT',409);
    return addressView((await db.query<AddressRow>('UPDATE mobile_addresses SET archived=true,version=version+1,updated_at=clock_timestamp() WHERE account_id=$1 AND id=$2 RETURNING *',[actor.accountId,id])).rows[0]);
   }));
  }
 }
 fail('RESOURCE_NOT_FOUND',404);
}
