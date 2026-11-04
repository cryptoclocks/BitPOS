import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {hash} from '../../../packages/domain/src/index';
import {fail,requireRole,uuid} from './authority';
import {audit,pool,tenant} from './db';

// M01: hand an owner/manager from one of their shops (branches) to another without signing in again. A branch on the merchant side is a shop the SAME
// account holds an owner/manager membership in (see branches.ts). The identity proof is the current live session; what is issued is a brand-new session for the
// target shop with the role of THAT membership, and the old session is ended, so one browser tab is never signed in to two shops and a late response from the
// old shop cannot be read with the new token (nor the reverse). Staff memberships, disabled and out-of-hours accounts are refused exactly like at sign-in, and a shop
// the account is not a member of looks the same as one that does not exist. Nothing about a shop's data moves: the client discards every in-memory cache on success.
const body=z.object({merchantId:uuid}).strict();
export interface BranchChoice{merchantId:string;name:string;role:'owner'|'manager';current:boolean}
async function memberships(userId:string,currentMerchant:string){
 return (await pool.query<{merchant_id:string;role:string;name:string;denied:string|null}>(
  `SELECT m.merchant_id,m.role,mr.name,bitpos.staff_access_denied(m.merchant_id,m.user_id,clock_timestamp()) AS denied
   FROM bitpos.members m JOIN bitpos.merchants mr ON mr.id=m.merchant_id WHERE m.user_id=$1 ORDER BY (m.merchant_id=$2) DESC,mr.name,m.merchant_id`,[userId,currentMerchant])).rows
  .filter(r=>(r.role==='owner'||r.role==='manager')&&!r.denied);
}
export async function myBranches(userId:string,currentMerchant:string,currentRole:string):Promise<{branches:BranchChoice[]}>{
 requireRole(currentRole);
 return {branches:(await memberships(userId,currentMerchant)).slice(0,50).map(r=>({merchantId:r.merchant_id,name:r.name,role:r.role as 'owner'|'manager',current:r.merchant_id===currentMerchant}))};
}
export async function switchBranch(userId:string,currentMerchant:string,currentRole:string,currentToken:string,input:unknown):Promise<{token:string;userId:string;merchantId:string;role:'owner'|'manager'}>{
 requireRole(currentRole);
 const data=body.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
 if(data.data.merchantId===currentMerchant)fail('INVALID_REQUEST',422);
 const target=(await memberships(userId,currentMerchant)).find(r=>r.merchant_id===data.data.merchantId);
 if(!target)fail('ROLE_REQUIRED',403);
 const token=randomBytes(32).toString('base64url');
 await tenant(target.merchant_id,async db=>{
  await db.query("INSERT INTO sessions(token_hash,user_id,merchant_id,role,expires_at) VALUES($1,$2,$3,$4,now()+interval '8 hours')",[hash(token),userId,target.merchant_id,target.role]);
  await audit(db,target.merchant_id,userId,'session.branch_in',currentMerchant);
 });
 await tenant(currentMerchant,async db=>{
  await db.query('DELETE FROM sessions WHERE token_hash=$1',[hash(currentToken)]);
  await audit(db,currentMerchant,userId,'session.branch_out',target.merchant_id);
 });
 return {token,userId,merchantId:target.merchant_id,role:target.role as 'owner'|'manager'};
}
