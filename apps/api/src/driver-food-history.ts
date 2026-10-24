import {z} from 'zod';
import {pool} from './db';import {mobilePrincipal} from './mobile-auth';import {hash} from '../../../packages/domain/src/index';import {fail} from './authority';
import {FoodDriverHistorySchema,DriverDailyEarningsSchema,DriverReviewSummarySchema} from '../../../packages/contracts/src/mobile-v1.generated';
export async function driverFoodHistoryRequest(url:URL,method:string,bearer:string|undefined){
 const ratings=url.pathname==='/api/mobile/v1/driver/reviews/summary';
 const daily=url.pathname==='/api/mobile/v1/driver/earnings/daily';
 if(!ratings&&!daily&&url.pathname!=='/api/mobile/v1/driver/food/history')return undefined;
 if((daily||ratings)&&url.search)fail('INVALID_REQUEST',422);
 if(method!=='GET')fail('RESOURCE_NOT_FOUND',404);
 if([...url.searchParams.keys()].some(key=>key!=='cursor')||url.searchParams.getAll('cursor').length>1)fail('INVALID_REQUEST',422);
 const cursor=url.searchParams.has('cursor')?z.string().uuid().parse(url.searchParams.get('cursor')):null;
 const db=await pool.connect();try{
  await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');await db.query("SET LOCAL statement_timeout='3s';SET LOCAL lock_timeout='200ms'");
  const actor=await mobilePrincipal(bearer,db);
  await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true),set_config('bitpos.mobile_device',$4,true)",[actor.accountId,actor.sessionId,hash(bearer!.slice(7)),actor.deviceId]);
  const doc=ratings?(await db.query('SELECT bitpos.driver106_review_summary() doc')).rows[0].doc:daily?(await db.query('SELECT bitpos.driver101_daily_earnings() doc')).rows[0].doc:(await db.query('SELECT driver100_food_history($1::uuid) doc',[cursor])).rows[0].doc;
  const result=ratings?DriverReviewSummarySchema.parse(doc):daily?DriverDailyEarningsSchema.parse(doc):FoodDriverHistorySchema.parse(doc);await db.query('COMMIT');return result;
 }catch(error){await db.query('ROLLBACK');const e=error as {code?:string;message?:string};
  if(e.message==='AMOUNT_OVERFLOW')fail('CONFIGURATION_REQUIRED',503);
  if(e.code==='42883')fail('CONFIGURATION_REQUIRED',503);
  if(e.message==='AUTH_REQUIRED')fail('AUTH_REQUIRED',401);if(e.message==='ROLE_REQUIRED')fail('ROLE_REQUIRED',403);if(e.message==='INVALID_REQUEST')fail('INVALID_REQUEST',422);
  if(['55P03','57014','40P01'].includes(e.code??'')||e.message==='DISPATCH_AUTH_RETRY')fail('DISPATCH_AUTH_RETRY',409);throw error;
 }finally{db.release();}
}
