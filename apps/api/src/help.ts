import type pg from 'pg';
import {requireRole} from './authority';

// M13: in-system help. A shop-readiness check computed from the shop's own data (never from what someone says is set up): what blocks selling, and what is
// merely recommended. Read-only; owner/manager. It checks that things exist, not that they are right (a wallet address is only checked for being present).
export interface ReadinessItem{id:'wallet'|'products'|'prices'|'register'|'register_paired'|'hours'|'receipt'|'team_pins';level:'required'|'recommended';done:boolean;detail:{count:number;of?:number}|null}
export interface Readiness{items:ReadinessItem[];/** every required item is done */ready:boolean;lowStock:number}
export async function shopReadiness(db:pg.PoolClient,merchant:string,role:string):Promise<Readiness>{
 requireRole(role);
 const n=async(sql:string)=>(await db.query<{n:number}>(sql,[merchant])).rows[0]!.n;
 const wallet=(await db.query<{ok:boolean}>("SELECT length(btrim(treasury))>0 AS ok FROM merchants WHERE id=$1",[merchant])).rows[0]?.ok===true;
 const products=await n('SELECT count(*)::int n FROM products WHERE merchant_id=$1 AND archived_at IS NULL');
 const prices=await n('SELECT count(*)::int n FROM catalog_price_versions WHERE merchant_id=$1');
 const registers=await n('SELECT count(*)::int n FROM registers WHERE merchant_id=$1 AND retired_at IS NULL');
 const paired=await n('SELECT count(*)::int n FROM registers r JOIN devices d ON d.merchant_id=r.merchant_id AND d.id=r.paired_device_id WHERE r.merchant_id=$1 AND r.retired_at IS NULL AND d.revoked_at IS NULL');
 const hours=await n('SELECT count(*)::int n FROM merchant_opening_hours WHERE merchant_id=$1');
 const receipt=await n('SELECT count(*)::int n FROM receipt_settings WHERE merchant_id=$1');
 const staff=(await db.query<{staff:number;pins:number}>("SELECT count(*)::int staff,count(sp.pin_hash)::int pins FROM members m LEFT JOIN staff_profiles sp ON sp.merchant_id=m.merchant_id AND sp.user_id=m.user_id WHERE m.merchant_id=$1 AND m.role='staff'",[merchant])).rows[0]!;
 const lowStock=await n('SELECT count(*)::int n FROM products WHERE merchant_id=$1 AND archived_at IS NULL AND reorder_level IS NOT NULL AND stock<=reorder_level');
 const items:ReadinessItem[]=[
  {id:'wallet',level:'required',done:wallet,detail:null},
  {id:'products',level:'required',done:products>0,detail:{count:products}},
  {id:'prices',level:'required',done:prices>0,detail:{count:prices}},
  {id:'register',level:'required',done:registers>0,detail:{count:registers}},
  {id:'register_paired',level:'required',done:paired>0,detail:{count:paired,of:registers}},
  {id:'hours',level:'recommended',done:hours>0,detail:null},
  {id:'receipt',level:'recommended',done:receipt>0,detail:null},
  // a shop with no staff accounts has nothing to set; otherwise every staff account should have a PIN for switching user
  {id:'team_pins',level:'recommended',done:staff.staff===0||staff.pins===staff.staff,detail:{count:staff.pins,of:staff.staff}},
 ];
 return {items,ready:items.filter(i=>i.level==='required').every(i=>i.done),lowStock};
}
