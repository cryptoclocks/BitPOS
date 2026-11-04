import type pg from 'pg';
import {z} from 'zod';
import {settlement} from '../../../packages/domain/src/table-pricing';
import {fail,positive,requireRole,routingLock,uuid} from './authority';
import {audit} from './db';
import {priceChannels,type PriceChannel} from './catalog';

// M03b: per-channel prices for the active catalog price version. An override replaces the base price on that channel only, with no
// stacking of catalog promotions (see migration 192). Insert-only history; reads give the newest row per (product, channel).
const channel=z.enum(['counter','table','online']);
const body=z.object({
 priceVersion:uuid,expectedRevision:z.string().regex(/^(0|[1-9][0-9]{0,17})$/),
 set:z.array(z.object({productId:uuid,channel,unitMinor:positive.nullable()}).strict()).min(1).max(600),
}).strict();
export interface ChannelPriceView{priceVersion:string|null;currency:'USD'|'USDG'|null;decimals:number|null;revision:string;channels:readonly PriceChannel[];prices:{productId:string;channel:PriceChannel;unitMinor:string}[]}

async function active(db:pg.PoolClient,merchant:string){
 return (await db.query<{id:string;currency:'USD'|'USDG';decimals:number}>('SELECT v.id,v.currency,v.decimals FROM merchant_pricing m JOIN catalog_price_versions v ON v.merchant_id=m.merchant_id AND v.id=m.active_price_version_id WHERE m.merchant_id=$1',[merchant])).rows[0];
}
async function effective(db:pg.PoolClient,merchant:string,version:string){
 return (await db.query<{product_id:string;channel:PriceChannel;unit_minor:string}>(
  `SELECT product_id,channel,unit_minor::text FROM(SELECT DISTINCT ON(product_id,channel) product_id,channel,unit_minor FROM catalog_channel_prices WHERE merchant_id=$1 AND price_version_id=$2 ORDER BY product_id,channel,revision DESC) x WHERE unit_minor IS NOT NULL ORDER BY product_id,channel`,[merchant,version])).rows;
}
const currentRevision=async(db:pg.PoolClient,merchant:string,version:string)=>(await db.query<{r:string}>('SELECT coalesce(max(revision),0)::text AS r FROM catalog_channel_prices WHERE merchant_id=$1 AND price_version_id=$2',[merchant,version])).rows[0].r;

/** Owner/manager read. */
export async function channelPrices(db:pg.PoolClient,merchant:string,role:string):Promise<ChannelPriceView>{
 requireRole(role);
 const v=await active(db,merchant);
 if(!v)return {priceVersion:null,currency:null,decimals:null,revision:'0',channels:priceChannels,prices:[]};
 return {priceVersion:v.id,currency:v.currency,decimals:v.decimals,revision:await currentRevision(db,merchant,v.id),channels:priceChannels,
  prices:(await effective(db,merchant,v.id)).map(r=>({productId:r.product_id,channel:r.channel,unitMinor:r.unit_minor}))};
}
/** Owner only. Only the listed (product, channel) cells change; null removes an override. A stale screen is refused (PRICE_VERSION_CHANGED). */
export async function saveChannelPrices(db:pg.PoolClient,merchant:string,actor:string,role:string,input:unknown):Promise<ChannelPriceView>{
 requireRole(role,true);
 const data=body.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
 const d=data.data;
 if(new Set(d.set.map(s=>s.productId+'|'+s.channel)).size!==d.set.length)fail('INVALID_REQUEST',422);
 await routingLock(db,merchant);
 const v=await active(db,merchant);
 if(!v||v.id!==d.priceVersion)fail('PRICE_VERSION_CHANGED');
 const revision=await currentRevision(db,merchant,v.id);
 if(revision!==d.expectedRevision)fail('PRICE_VERSION_CHANGED');
 const known=new Set((await db.query<{product_id:string}>('SELECT product_id FROM catalog_prices WHERE merchant_id=$1 AND price_version_id=$2',[merchant,v.id])).rows.map(r=>r.product_id));
 for(const s of d.set){
  if(!known.has(s.productId))fail('RESOURCE_NOT_FOUND',404);
  if(s.unitMinor!==null){try{settlement(v.currency,BigInt(s.unitMinor)*100n,'configured',v.decimals);}catch{fail('INVALID_PRICE',422);}}
 }
 const now=new Map((await effective(db,merchant,v.id)).map(r=>[r.product_id+'|'+r.channel,r.unit_minor]));
 const changes=d.set.filter(s=>(now.get(s.productId+'|'+s.channel)??null)!==s.unitMinor);
 if(changes.length){
  const next=String(BigInt(revision)+1n);
  for(const s of changes)await db.query('INSERT INTO catalog_channel_prices(merchant_id,price_version_id,product_id,channel,revision,unit_minor,set_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[merchant,v.id,s.productId,s.channel,next,s.unitMinor,actor]);
  await audit(db,merchant,actor,'pricing.channel.update',v.id+' r'+next+' '+changes.length+' cells');
 }
 return channelPrices(db,merchant,role);
}
