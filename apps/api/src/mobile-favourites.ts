import {z} from 'zod';
import {pool} from './db';
import {mobilePrincipal} from './mobile-auth';
import {fail} from './authority';
import {MobileFavouriteUpdateSchema,MobileFavouriteReceiptSchema,MobileFavouritesSchema} from '../../../packages/contracts/src/mobile-v1.generated';
export async function mobileFavouritesRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const collection=url.pathname==='/api/mobile/v1/account/favourites';
 const target=/^\/api\/mobile\/v1\/account\/favourites\/([^/]+)$/.exec(url.pathname);
 if(!collection&&!target)return undefined;
 if(collection&&method!=='GET'||target&&method!=='PUT')fail('RESOURCE_NOT_FOUND',404);
 const actor=await mobilePrincipal(bearer),db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SELECT set_config('bitpos.mobile_account',$1,true)",[actor.accountId]);
  if(!(await db.query("SELECT to_regclass('bitpos.mobile_favourite_branches') ready")).rows[0].ready)fail('CONFIGURATION_REQUIRED',503);
  if(collection){
   if([...url.searchParams.keys()].some(key=>key!=='cursor')||url.searchParams.getAll('cursor').length>1)fail('INVALID_REQUEST',422);
   const cursor=url.searchParams.get('cursor');if(cursor!==null&&!z.string().uuid().safeParse(cursor).success)fail('INVALID_REQUEST',422);
   const rows=(await db.query(`SELECT f.merchant_id,f.branch_id,f.created_at,p.profile FROM mobile_favourite_branches f LEFT JOIN LATERAL bitpos.mobile_public_branches(f.branch_id,NULL,1,'','all') p ON true WHERE f.account_id=$1 AND ($2::uuid IS NULL OR f.branch_id>$2) ORDER BY f.branch_id LIMIT 51`,[actor.accountId,cursor])).rows;
   const result=MobileFavouritesSchema.parse({items:rows.slice(0,50).map(row=>({merchantId:row.merchant_id,branchId:row.branch_id,createdAt:row.created_at.toISOString(),branch:row.profile??null})),nextCursor:rows.length>50?rows[49].branch_id:null});
   await db.query('COMMIT');return result;
  }
  if(url.search)fail('INVALID_REQUEST',422);
  const branch=z.string().uuid().safeParse(target![1]);if(!branch.success)fail('INVALID_REQUEST',422);
  const command=MobileFavouriteUpdateSchema.parse(input);
  await db.query('SELECT id FROM mobile_accounts WHERE id=$1 FOR UPDATE',[actor.accountId]);
  // Absolute PUT is idempotent, including retry after a lost response.
  const current=await mobilePrincipal(bearer,db);if(current.accountId!==actor.accountId||current.sessionId!==actor.sessionId)fail('AUTH_REQUIRED',401);
  if(command.favourite){
   const row=(await db.query("SELECT merchant_id FROM bitpos.mobile_public_branches($1,NULL,1,'','all')",[branch.data])).rows[0];if(!row)fail('RESOURCE_NOT_FOUND',404);
   const prior=(await db.query('SELECT 1 FROM mobile_favourite_branches WHERE account_id=$1 AND branch_id=$2',[actor.accountId,branch.data])).rowCount;
   if(!prior&&Number((await db.query('SELECT count(*)::int n FROM mobile_favourite_branches WHERE account_id=$1',[actor.accountId])).rows[0].n)>=500)fail('INVALID_REQUEST',422);
   await db.query('INSERT INTO mobile_favourite_branches(account_id,merchant_id,branch_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[actor.accountId,row.merchant_id,branch.data]);
  }else await db.query('DELETE FROM mobile_favourite_branches WHERE account_id=$1 AND branch_id=$2',[actor.accountId,branch.data]);
  const result=MobileFavouriteReceiptSchema.parse({branchId:branch.data,favourite:command.favourite});await db.query('COMMIT');return result;
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
