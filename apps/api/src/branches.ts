import {fail,requireRole} from './authority';
import {pool,tenant} from './db';
import {parseBreakdownWindow,salesBreakdown} from './report-breakdown';
import type {PipelineRow,Tally,ChannelRow} from './report-breakdown';

// M10: a read-only comparison of the shops (branches) the SAME signed-in account owns or manages. A "branch" on the merchant side is a shop the account
// holds an owner/manager membership in; there is no cross-shop session and nothing here switches the working shop, so the register, its open order and
// its device target never move. Every shop is read inside its own tenant transaction with the account's role IN THAT SHOP (from `members`, not from the
// current session), a disabled or out-of-hours account is skipped like at sign-in, and each shop is cut on its own time zone. Money stays per
// currency and decimals; the aggregate only adds the same currency across shops, and each order belongs to exactly one shop so nothing is counted twice.
const maxShops=25;
export interface BranchRow{merchantId:string;name:string;role:'owner'|'manager';current:boolean;timeZone:string|null;error:boolean;totals:Tally[];channels:ChannelRow[];pipeline:PipelineRow[]}
export interface BranchAggregate{currency:string;decimals:number;shops:number;orders:number;totalMinor:string}
export interface BranchComparison{from:string;to:string;shops:BranchRow[];aggregate:BranchAggregate[];/** memberships where the account is only staff, or is disabled/out of hours: not read */excludedShops:number;truncated:boolean;/** false when a shop failed to load, so the aggregate is partial */complete:boolean}

export async function branchComparison(userId:string,currentMerchant:string,currentRole:string,url:URL):Promise<BranchComparison>{
 requireRole(currentRole);
 const {from,to}=parseBreakdownWindow(url);
 const rows=(await pool.query<{merchant_id:string;role:string;name:string;denied:string|null}>(
  `SELECT m.merchant_id,m.role,mr.name,bitpos.staff_access_denied(m.merchant_id,m.user_id,clock_timestamp()) AS denied
   FROM bitpos.members m JOIN bitpos.merchants mr ON mr.id=m.merchant_id WHERE m.user_id=$1 ORDER BY (m.merchant_id=$2) DESC,mr.name,m.merchant_id`,[userId,currentMerchant])).rows;
 const eligible=rows.filter(r=>(r.role==='owner'||r.role==='manager')&&!r.denied);
 if(!eligible.some(r=>r.merchant_id===currentMerchant))fail('ROLE_REQUIRED',403);
 const chosen=eligible.slice(0,maxShops);
 const shops:BranchRow[]=[];
 for(const r of chosen){
  const base={merchantId:r.merchant_id,name:r.name,role:r.role as 'owner'|'manager',current:r.merchant_id===currentMerchant};
  try{
   const b=await tenant(r.merchant_id,db=>salesBreakdown(db,r.merchant_id,r.role,new URL(`http://local/?from=${from}&to=${to}`)));
   shops.push({...base,timeZone:b.timeZone,error:false,totals:b.totals,channels:b.channels,pipeline:b.pipeline});
  }catch{shops.push({...base,timeZone:null,error:true,totals:[],channels:[],pipeline:[]});}
 }
 const agg=new Map<string,BranchAggregate&{sum:bigint}>();
 for(const s of shops)for(const t of s.totals){
  const k=t.currency+'\u0000'+t.decimals;const e=agg.get(k)??{currency:t.currency,decimals:t.decimals,shops:0,orders:0,totalMinor:'0',sum:0n};
  e.shops+=1;e.orders+=t.orders;e.sum+=BigInt(t.totalMinor);agg.set(k,e);
 }
 return {from,to,shops,aggregate:[...agg.values()].map(({sum,...e})=>({...e,totalMinor:sum.toString()})).sort((a,b)=>a.currency.localeCompare(b.currency)||a.decimals-b.decimals),
  excludedShops:rows.length-eligible.length,truncated:eligible.length>chosen.length,complete:shops.every(s=>!s.error)};
}
