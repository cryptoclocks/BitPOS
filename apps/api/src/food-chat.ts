import {z} from 'zod';
import {pool} from './db';
import {mobilePrincipal} from './mobile-auth';
import {hash} from '../../../packages/domain/src/index';
import {fail} from './authority';
import {FoodChatPageSchema,FoodChatMessageSchema,FoodChatSendCommandSchema,FoodChatReadCommandSchema,FoodChatReadReceiptSchema} from '../../../packages/contracts/src/mobile-v1.generated';
const sequence=z.string().regex(/^(0|[1-9][0-9]*)$/).max(19).refine(value=>BigInt(value)<=9223372036854775807n);
export async function foodChatRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const route=/^\/api\/mobile\/v1\/food\/assignments\/([^/]+)\/chat(\/read)?$/.exec(url.pathname);
 if(!route)return undefined;
 const read=!!route[2];
 if(read?method!=='PUT':!['GET','POST'].includes(method))fail('RESOURCE_NOT_FOUND',404);
 const assignment=z.string().uuid().parse(route[1]);
 if((read||method==='POST')&&url.search||method==='GET'&&([...url.searchParams.keys()].some(k=>!['afterSequence','beforeSequence'].includes(k))||url.searchParams.getAll('afterSequence').length>1||url.searchParams.getAll('beforeSequence').length>1||url.searchParams.has('beforeSequence')&&url.searchParams.has('afterSequence')))fail('INVALID_REQUEST',422);
 const before=url.searchParams.has('beforeSequence')?sequence.parse(url.searchParams.get('beforeSequence')):null;
 const after=method==='GET'?sequence.parse(url.searchParams.get('afterSequence')??'0'):'0';
 const readCommand=read?FoodChatReadCommandSchema.parse(input):null;
 if(readCommand)sequence.parse(readCommand.lastReadSequence);
 const legacy=input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===2&&'commandId' in input&&'body' in input;
 const command=method==='POST'?FoodChatSendCommandSchema.parse(legacy?{...input,attachmentIds:[]}:input):null;
 if(command&&((command.body.trim().length===0&&command.attachmentIds.length===0)||Buffer.byteLength(command.body,'utf8')>16000||new Set(command.attachmentIds).size!==command.attachmentIds.length))fail('INVALID_REQUEST',422);
 const db=await pool.connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  await db.query("SET LOCAL statement_timeout='3s';SET LOCAL lock_timeout='200ms'");
  const actor=await mobilePrincipal(bearer,db);
  await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true)",[actor.accountId,actor.sessionId,hash(bearer!.slice(7))]);
  const result=readCommand?FoodChatReadReceiptSchema.parse((await db.query('SELECT bitpos.food_chat103_mark_read($1,$2::bigint) doc',[assignment,readCommand.lastReadSequence])).rows[0].doc):command?FoodChatMessageSchema.parse((await db.query('SELECT bitpos.food_chat105_send($1,$2,$3,$4::uuid[]) doc',[assignment,command.commandId,command.body,command.attachmentIds])).rows[0].doc):FoodChatPageSchema.parse((await db.query(before===null?'SELECT bitpos.food_chat102_page($1,$2::bigint) doc':'SELECT bitpos.food_chat102_recent($1,$2::bigint) doc',[assignment,before??after])).rows[0].doc);
  await db.query('COMMIT');return result;
 }catch(error){
  await db.query('ROLLBACK');const e=error as {message?:string;code?:string};
  if(e.message==='AUTH_REQUIRED')fail('AUTH_REQUIRED',401);
  if(e.message==='RESOURCE_NOT_FOUND')fail('RESOURCE_NOT_FOUND',404);
  if(e.message==='INVALID_REQUEST')fail('INVALID_REQUEST',422);
  if(e.message==='CHAT_IMAGE_EXPIRED')fail('CHAT_IMAGE_EXPIRED',410);
  if(e.message==='CHAT_IMAGE_IN_USE')fail('CHAT_IMAGE_IN_USE',409);
  if(e.message==='CHAT_RATE_LIMITED'||e.message==='CHAT_LIMIT_REACHED')fail('CHAT_RATE_LIMITED',429);
  if(e.message==='CHAT_UNAVAILABLE'||e.message==='IDEMPOTENCY_CONFLICT')fail(e.message,409);
  if(['CHAT_RETRY','DISPATCH_AUTH_RETRY'].includes(e.message??'')||['55P03','57014','40001','40P01'].includes(e.code??''))fail('CHAT_RETRY',409);
  if(e.code==='42883'||e.code==='42P01')fail('CONFIGURATION_REQUIRED',503);
  throw error;
 }finally{db.release();}
}
