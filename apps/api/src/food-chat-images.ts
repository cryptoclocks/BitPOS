import type {IncomingMessage,ServerResponse} from 'node:http';import {createHash} from 'node:crypto';import {z} from 'zod';import {pool} from './db';import {mobilePrincipal} from './mobile-auth';import {fail,RequestError} from './authority';import {FoodChatUploadSchema} from '../../../packages/contracts/src/mobile-v1.generated';import {normalizeChatImage,CHAT_IMAGE_LIMITS,ChatImageError} from './chat-image-normalizer';
const uuid=z.string().uuid();let active=0;
async function bytes(req:IncomingMessage,res:ServerResponse,length:number):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
  const chunks:Buffer[]=[];let size=0,done=false;
  const cleanup=()=>{clearTimeout(deadline);req.off('data',data);req.off('end',end);req.off('aborted',abort);req.off('error',error);};
  const error=(reason:unknown)=>{if(done)return;done=true;cleanup();chunks.length=0;res.shouldKeepAlive=false;req.pause();reject(reason);};
  const abort=()=>error(new RequestError(400,'INVALID_REQUEST'));
  const data=(chunk:Buffer)=>{size+=chunk.length;if(size>length||size>CHAT_IMAGE_LIMITS.sourceBytes){error(new RequestError(413,'REQUEST_TOO_LARGE'));return;}chunks.push(chunk);};
  const end=()=>{if(done)return;if(size!==length){error(new RequestError(422,'INVALID_REQUEST'));return;}done=true;cleanup();resolve(Buffer.concat(chunks,size));};
  const deadline=setTimeout(()=>error(new RequestError(408,'INVALID_REQUEST')),15000);
  req.on('data',data);req.once('end',end);req.once('aborted',abort);req.once('error',error);
 });
}
/** Binary media never enters JSON/body parsers, static public roots or a bearer URL. */
export async function foodChatImages(req:IncomingMessage,res:ServerResponse):Promise<boolean>{
 const url=new URL(req.url??'/','http://bitpos.invalid'),route=/^\/api\/mobile\/v1\/food\/assignments\/([^/]+)\/chat\/images(?:\/(commands)\/([^/]+)|\/([^/]+))?$/.exec(url.pathname);
 if(!route)return false;
 if(process.env.BITPOS_MOBILE_ENABLED!=='1')fail('RESOURCE_NOT_FOUND',404);
 if(url.search)fail('INVALID_REQUEST',422);
 const assignment=uuid.parse(route[1]),recover=!!route[2],id=route[3]??route[4],upload=!id;
 if(upload?req.method!=='POST':req.method!=='GET')fail('RESOURCE_NOT_FOUND',404);
 if(id)uuid.parse(id);
 const command=upload?uuid.parse(req.headers['idempotency-key']):null;
 const mime=String(req.headers['content-type']??'').toLowerCase().split(';')[0].trim();
 const length=upload?Number(req.headers['content-length']):0;
 if(upload&&(!Number.isSafeInteger(length)||length<1))fail('INVALID_REQUEST',411);
 if(upload&&length>CHAT_IMAGE_LIMITS.sourceBytes)fail('REQUEST_TOO_LARGE',413);
 if(upload&&!['image/jpeg','image/png'].includes(mime))fail('CHAT_IMAGE_INVALID',415);
 if(active>=4){res.setHeader('Retry-After','1');fail('CHAT_IMAGE_BUSY',429);}
 active++;let released=false;const deadline=setTimeout(()=>{res.destroy();release();},20000);
 function release(){if(released)return;released=true;active--;clearTimeout(deadline);res.off('finish',release);res.off('close',release);}
 res.once('finish',release);res.once('close',release);
 async function transaction<T>(action:(db:import('pg').PoolClient)=>Promise<T>):Promise<T>{
  const db=await pool.connect();try{
   await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');await db.query("SET LOCAL statement_timeout='3s';SET LOCAL lock_timeout='200ms'");
   const actor=await mobilePrincipal(req.headers.authorization,db);
   await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true)",[actor.accountId,actor.sessionId,createHash('sha256').update(req.headers.authorization!.slice(7)).digest('hex')]);
   const result=await action(db);await db.query('COMMIT');return result;
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
 }
 try{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Vary','Authorization');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  if(upload){
   // Authorize before reading/decoding, then re-authorize inside the final store transaction.
   await transaction(async db=>{await db.query('SELECT bitpos.food_chat102_signal($1)',[assignment]);});
   if(res.destroyed)return true;
   const source=await bytes(req,res,length);if(res.destroyed)return true;
   const image=await normalizeChatImage(source,mime);if(res.destroyed)return true;
   const result=await transaction(async db=>FoodChatUploadSchema.parse((await db.query('SELECT bitpos.food_chat104_store($1,$2,$3,$4,$5,$6,$7,$8,$9) doc',[assignment,command,image.sourceSha256,source.length,mime,image.sha256,image.width,image.height,image.bytes])).rows[0].doc));
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
  }else if(recover){
   const result=await transaction(async db=>FoodChatUploadSchema.parse((await db.query('SELECT bitpos.food_chat104_recover($1,$2) doc',[assignment,id])).rows[0].doc));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
  }else{
   await transaction(async db=>{
    const image=(await db.query('SELECT * FROM bitpos.food_chat104_bytes($1,$2)',[assignment,id])).rows[0];
    if(!image)fail('RESOURCE_NOT_FOUND',404);
    if(image.mime!=='image/jpeg'||!Buffer.isBuffer(image.body)||image.body.length>CHAT_IMAGE_LIMITS.storedBytes)fail('CONFIGURATION_REQUIRED',503);
    // Enqueue while source authorization locks are held; do not await a slow recipient.
    res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':image.body.length,'Content-Disposition':'inline; filename="chat-photo.jpg"','Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-SHA256':image.sha256});res.end(image.body);
   });
  }
  return true;
 }catch(error){
  if(res.headersSent||res.destroyed){res.destroy();return true;}
  if(error instanceof RequestError)throw error;
  if(error instanceof ChatImageError)fail(error.code,error.code==='CHAT_IMAGE_BUSY'?429:error.code==='CHAT_IMAGE_TOO_LARGE'?413:422);
  const e=error as {message?:string;code?:string};
  if(e.message==='AUTH_REQUIRED')fail('AUTH_REQUIRED',401);if(e.message==='RESOURCE_NOT_FOUND')fail('RESOURCE_NOT_FOUND',404);
  if(e.message==='CHAT_IMAGE_EXPIRED')fail('CHAT_IMAGE_EXPIRED',410);if(e.message==='CHAT_IMAGE_QUOTA')fail('CHAT_IMAGE_QUOTA',429);
  if(e.message==='CHAT_UNAVAILABLE'||e.message==='IDEMPOTENCY_CONFLICT')fail(e.message,409);if(e.message==='INVALID_REQUEST')fail('INVALID_REQUEST',422);
  if(['CHAT_RETRY','DISPATCH_AUTH_RETRY'].includes(e.message??'')||['55P03','57014','40001','40P01'].includes(e.code??''))fail('CHAT_RETRY',409);
  if(['42883','42P01'].includes(e.code??''))fail('CONFIGURATION_REQUIRED',503);throw error;
 }finally{if(res.destroyed||res.writableFinished)release();}
}
