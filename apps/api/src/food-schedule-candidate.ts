import type pg from 'pg';
import {z} from 'zod';
import {RequestError} from './authority';
const uuid=z.string().uuid();
export const FoodScheduleHoldCandidateSchema=z.object({
 id:uuid,slotId:uuid,quoteId:uuid,state:z.enum(['HELD','RELEASED','EXPIRED']),
 expiresAt:z.string().datetime({offset:true}),replayed:z.boolean(),checkoutReady:z.literal(false),
}).strict();
function boundary(error:unknown):never {
 if(error instanceof Error){
  const code=(error as {code?:string}).code;
  if(error.message==='AUTH_REQUIRED')throw new RequestError(401,'AUTH_REQUIRED');
  if(error.message==='RESOURCE_NOT_FOUND')throw new RequestError(404,'RESOURCE_NOT_FOUND');
  if(error.message==='IDEMPOTENCY_CONFLICT')throw new RequestError(409,'IDEMPOTENCY_CONFLICT');
  if(['55P03','57014','40001','40P01','23505'].includes(code??''))throw new RequestError(409,'DISPATCH_AUTH_RETRY');
  if(['SCHEDULE_READ_COMMITTED_REQUIRED','SCHEDULE_CHECKOUT_NOT_ADMITTED'].includes(error.message)||['42501','42883'].includes(code??''))throw new RequestError(503,'CONFIGURATION_REQUIRED');
  if(error.message.startsWith('SCHEDULE_'))throw new RequestError(409,'QUOTE_CHANGED',error.message,{reasonCode:error.message});
 }
 throw error;
}
/** Internal candidate only. Caller owns authenticated transaction context.
 * There is intentionally no public route/grant until order lifecycle admission.
 */
export async function prepareFoodScheduleCandidate(db:pg.PoolClient|pg.Client,slotId:string,quoteId:string,commandId:string){
 uuid.parse(slotId);uuid.parse(quoteId);uuid.parse(commandId);
 try{
  const result=FoodScheduleHoldCandidateSchema.parse((await db.query('SELECT bitpos.schedule107_hold($1,$2,$3) value',[slotId,quoteId,commandId])).rows[0].value);
  if(result.slotId!==slotId||result.quoteId!==quoteId)throw Error('Schedule receipt mismatch');
  return result;
 }catch(error){boundary(error);}
}
export async function releaseFoodScheduleCandidate(db:pg.PoolClient|pg.Client,holdId:string,commandId:string){
 uuid.parse(holdId);uuid.parse(commandId);
 try{
  const result=FoodScheduleHoldCandidateSchema.parse((await db.query('SELECT bitpos.schedule107_release($1,$2) value',[holdId,commandId])).rows[0].value);
  if(result.id!==holdId)throw Error('Schedule receipt mismatch');
  return result;
 }catch(error){boundary(error);}
}
