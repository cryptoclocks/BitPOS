import type http from 'node:http';
import type pg from 'pg';
import {createHash} from 'node:crypto';
import {fail,requireRole} from './authority';
import {audit,pool} from './db';

export const maxProductImageBytes=1024*1024;
const maxImagesPerMerchant=300;
export type ProductImageMime='image/jpeg'|'image/png'|'image/webp';
/** The type comes from the file's own first bytes, never from the client's Content-Type or file name. SVG and everything else is refused. */
export function sniffImage(b:Buffer):ProductImageMime|null{
 if(b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return 'image/jpeg';
 if(b.length>=8&&b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'image/png';
 if(b.length>=12&&b.subarray(0,4).toString('latin1')==='RIFF'&&b.subarray(8,12).toString('latin1')==='WEBP')return 'image/webp';
 return null;
}
export async function readRaw(req:http.IncomingMessage,limit:number):Promise<Buffer>{
 const declared=Number(req.headers['content-length']??0);if(declared>limit)fail('REQUEST_TOO_LARGE',413);
 let n=0;const parts:Buffer[]=[];for await(const chunk of req){n+=chunk.length;if(n>limit)fail('REQUEST_TOO_LARGE',413);parts.push(chunk);}
 return Buffer.concat(parts);
}
/** Owner/manager only. Idempotent by content: the same bytes for one merchant return the same image id. */
export async function uploadProductImage(db:pg.PoolClient,merchant:string,actor:string,role:string,bytes:Buffer){
 requireRole(role);
 if(bytes.length===0)fail('INVALID_REQUEST',422);
 if(bytes.length>maxProductImageBytes)fail('REQUEST_TOO_LARGE',413);
 const mime=sniffImage(bytes);if(!mime)fail('INVALID_REQUEST',415);
 const sha=createHash('sha256').update(bytes).digest('hex');
 await db.query('SELECT id FROM merchants WHERE id=$1 FOR NO KEY UPDATE',[merchant]);
 const found=(await db.query<{id:string}>('SELECT id FROM product_images WHERE merchant_id=$1 AND content_sha256=$2',[merchant,sha])).rows[0];
 if(found)return {id:found.id,path:'/images/products/'+found.id,mime,size:bytes.length,sha256:sha,deduped:true};
 if((await db.query<{n:number}>('SELECT count(*)::int AS n FROM product_images WHERE merchant_id=$1',[merchant])).rows[0].n>=maxImagesPerMerchant)fail('INVALID_REQUEST',422);
 const row=(await db.query<{id:string}>('INSERT INTO product_images(merchant_id,content_sha256,mime,bytes,size) VALUES($1,$2,$3,$4,$5) RETURNING id',[merchant,sha,mime,bytes,bytes.length])).rows[0];
 await audit(db,merchant,actor,'catalog.product.image.upload',row.id);
 return {id:row.id,path:'/images/products/'+row.id,mime,size:bytes.length,sha256:sha,deduped:false};
}
/** Public read by unguessable id (menus are public). Content-addressed per id, so the response is immutable. */
export async function serveProductImage(req:http.IncomingMessage,res:http.ServerResponse):Promise<boolean>{
 const m=(req.url??'').match(/^\/api\/product-images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);if(!m||(req.method!=='GET'&&req.method!=='HEAD'))return false;
 const row=(await pool.query<{mime:string;bytes:Buffer;content_sha256:string}>('SELECT * FROM bitpos.product_image_public($1)',[m[1]])).rows[0];if(!row)fail('RESOURCE_NOT_FOUND',404);
 res.writeHead(200,{'Content-Type':row.mime,'Content-Length':row.bytes.length,'Cache-Control':'public,max-age=31536000,immutable','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'ETag':'"'+row.content_sha256+'"'});
 res.end(req.method==='HEAD'?undefined:row.bytes);return true;
}
