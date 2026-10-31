import type pg from 'pg';
import {z} from 'zod';
import {emptyWeek,normaliseWeek,validTimeZone,type HoursWeek} from '../../../packages/domain/src/opening-hours';
import {fail,requireRole} from './authority';
import {audit} from './db';

export const defaultTimeZone='Asia/Bangkok';
export interface HoursView{configured:boolean;timeZone:string;revision:number;week:HoursWeek}
export async function hoursView(db:pg.PoolClient,merchant:string):Promise<HoursView>{
 const row=(await db.query<{time_zone:string;revision:number;week:unknown}>('SELECT time_zone,revision,week FROM merchant_opening_hours WHERE merchant_id=$1',[merchant])).rows[0];
 if(!row)return {configured:false,timeZone:defaultTimeZone,revision:0,week:emptyWeek()};
 return {configured:true,timeZone:row.time_zone,revision:row.revision,week:normaliseWeek(row.week)};
}
const body=z.object({expectedRevision:z.number().int().min(0),timeZone:z.string().min(1).max(64),week:z.unknown()}).strict();
/** Owner/manager only. Optimistic concurrency by revision; every change is audited. */
export async function openingHoursSettings(db:pg.PoolClient,merchant:string,actor:string,role:string,method:string,input:unknown):Promise<HoursView>{
 requireRole(role);
 if(method==='GET')return hoursView(db,merchant);
 if(method!=='PUT')fail('RESOURCE_NOT_FOUND',404);
 const data=body.parse(input);
 if(!validTimeZone(data.timeZone))fail('INVALID_REQUEST',422);
 let week:HoursWeek;try{week=normaliseWeek(data.week);}catch{fail('INVALID_REQUEST',422);}
 await db.query('SELECT id FROM merchants WHERE id=$1 FOR NO KEY UPDATE',[merchant]);
 const old=await hoursView(db,merchant);
 if(old.revision!==data.expectedRevision)fail('OPENING_HOURS_CHANGED');
 if(old.configured)await db.query('UPDATE merchant_opening_hours SET time_zone=$2,week=$3::jsonb,revision=revision+1,updated_at=clock_timestamp() WHERE merchant_id=$1',[merchant,data.timeZone,JSON.stringify(week)]);
 else await db.query('INSERT INTO merchant_opening_hours(merchant_id,time_zone,week) VALUES($1,$2,$3::jsonb)',[merchant,data.timeZone,JSON.stringify(week)]);
 await audit(db,merchant,actor,'opening_hours.configure',merchant);
 return hoursView(db,merchant);
}
