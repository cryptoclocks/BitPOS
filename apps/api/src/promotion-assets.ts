import {execFile} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {readFile,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type pg from 'pg';
import type http from 'node:http';
import {z} from 'zod';
import QRCode from 'qrcode';
import type {Money,PromotionImage} from '../../../packages/contracts/src/index';
import {customerOrigin} from './config';
import {pool,tenant} from './db';
import {fail} from './authority';
const rendered=z.object({image:z.string().max(149336),preview:z.string().max(699052),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export function promotionMediaUrl(token:string,preview=false){return new URL('/api/promotions/media/'+token+(preview?'/preview.png':'/image.rgb565'),customerOrigin).href;}
export async function renderPromotionAsset(db:pg.PoolClient,merchant:string,imageUrl:string|null,headline:string,copy:string,discountPercent:number,price:Money,menuUrl?:string,bundle?:import('../../../packages/contracts/src/bundle-promotions').BundleSnapshot){
 if(new URL(customerOrigin).protocol!=='https:')return {token:null,blocker:'HTTPS_MEDIA_ORIGIN_REQUIRED'};
 if(!imageUrl||!/^\/images\/menu\/[a-z0-9-]{1,40}\.jpg$/.test(imageUrl))return {token:null,blocker:'LICENSED_PRODUCT_PHOTO_REQUIRED'};
 const n=BigInt(price.amountMinor),scale=10n**BigInt(price.decimals);const fraction=(n%scale).toString().padStart(price.decimals,'0');const formatted=(n/scale).toString()+'.'+(price.currency==='USD'&&price.decimals===4?fraction.replace(/0+$/,'').padEnd(2,'0'):fraction);
 const qr=menuUrl?(await QRCode.toBuffer(menuUrl,{type:'png',width:148,margin:4,errorCorrectionLevel:'M'})).toString('base64'):null;
 const input=JSON.stringify({imageUrl,headline,copy,discountPercent,price:formatted,currency:price.currency,qr,...(bundle?{secondImageUrl:bundle.members[1].imageUrl,discountLabel:bundle.discountLabel}:{})});if(Buffer.byteLength(input)>8192)return {token:null,blocker:'PROMOTION_PREVIEW_INPUT_TOO_LARGE'};
 try{
  const output=await new Promise<string>((resolve,reject)=>{const child=execFile('python3',[new URL('./promotion-render.py',import.meta.url).pathname],{timeout:10000,maxBuffer:900000,encoding:'utf8',env:{PATH:process.env.PATH??'/usr/bin:/bin',LANG:'C.UTF-8'}},(error,stdout)=>error?reject(Error('PROMOTION_RENDERER_UNAVAILABLE')):resolve(stdout));child.stdin!.end(input);});
  const result=rendered.parse(JSON.parse(output)),image=Buffer.from(result.image,'base64'),preview=Buffer.from(result.preview,'base64');
  if(image.length!==112000||preview.length>524288||preview.length<24||!preview.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||preview.readUInt32BE(16)!==480||preview.readUInt32BE(20)!==320||createHash('sha256').update(image).digest('hex')!==result.sha256)throw Error('PROMOTION_RENDERER_INVALID');
  const token=randomBytes(32).toString('base64url');await db.query('INSERT INTO promotion_assets(merchant_id,token,image,preview,sha256,source_sha256) VALUES($1,$2,$3,$4,$5,$6)',[merchant,token,image,preview,result.sha256,result.sourceSha256]);return {token,blocker:null};
 }catch{return {token:null,blocker:'PROMOTION_RENDERER_OR_LICENSED_PHOTO_UNAVAILABLE'};}
}
export async function promotionImage(db:pg.PoolClient,merchant:string,token:string|null):Promise<PromotionImage|null>{
 if(!token)return null;
 const row=(await db.query('SELECT sha256 FROM promotion_assets WHERE merchant_id=$1 AND token=$2',[merchant,token])).rows[0];if(!row)return null;
 return {url:promotionMediaUrl(token),sha256:row.sha256,bytes:112000,width:280,height:200,format:'rgb565le'};
}
export async function validatePromotionAssetFresh(db:pg.PoolClient,merchant:string,token:string|null,imageUrl:string|null,bundle?:import('../../../packages/contracts/src/bundle-promotions').BundleSnapshot){
 if(!token)return; // Published image:null remains an explicit truthful fallback.
 try{
  if(!imageUrl||!/^\/images\/menu\/[a-z0-9-]{1,40}\.jpg$/.test(imageUrl))throw Error('photo path changed');
  const publicRoot=await realpath(fileURLToPath(new URL('../../web/public/',import.meta.url))),source=path.join(publicRoot,imageUrl),resolved=await realpath(source),stat=await lstat(source);
  if(!resolved.startsWith(publicRoot+path.sep)||!stat.isFile()||stat.isSymbolicLink()||stat.size>8000000)throw Error('photo boundary changed');
  let sourceBytes=await readFile(source);if(bundle){const second=bundle.members[1].imageUrl;if(!second||!/^\/images\/menu\/[a-z0-9-]{1,40}\.jpg$/.test(second))throw Error('second photo path changed');const path2=path.join(publicRoot,second),real2=await realpath(path2),stat2=await lstat(path2);if(!real2.startsWith(publicRoot+path.sep)||!stat2.isFile()||stat2.isSymbolicLink()||stat2.size>8000000)throw Error('second photo boundary');sourceBytes=Buffer.concat([sourceBytes,await readFile(path2)]);}
  const sha=createHash('sha256').update(sourceBytes).digest('hex'),old=(await db.query('SELECT source_sha256 FROM promotion_assets WHERE merchant_id=$1 AND token=$2',[merchant,token])).rows[0];
  if(!old||old.source_sha256!==sha)throw Error('photo changed');
 }catch{fail('PROMOTION_REVIEW_REQUIRED');}
}
export async function servePromotionMedia(req:http.IncomingMessage,res:http.ServerResponse):Promise<boolean>{
 const match=(req.url??'').match(/^\/api\/promotions\/media\/([A-Za-z0-9_-]{43})\/(image\.rgb565|preview\.png)$/);if(!match||req.method!=='GET')return false;
 const merchant=(await pool.query('SELECT bitpos.resolve_promotion_media($1) AS merchant',[match[1]])).rows[0]?.merchant;if(!merchant)fail('RESOURCE_NOT_FOUND',404);
 const row=await tenant(merchant,async db=>(await db.query('SELECT image,preview,sha256 FROM promotion_assets WHERE merchant_id=$1 AND token=$2',[merchant,match[1]])).rows[0]);if(!row)fail('RESOURCE_NOT_FOUND',404);
 const bytes:Buffer=match[2]==='image.rgb565'?row.image:row.preview;
 res.writeHead(200,{'Content-Type':match[2]==='image.rgb565'?'application/octet-stream':'image/png','Content-Length':bytes.length,'Cache-Control':'private,max-age=60','X-Content-Type-Options':'nosniff','X-Content-SHA256':match[2]==='image.rgb565'?row.sha256:createHash('sha256').update(bytes).digest('hex')});res.end(bytes);return true;
}
