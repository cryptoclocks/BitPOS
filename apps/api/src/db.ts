import pg from 'pg';
import {config} from './config';
export const pool=new pg.Pool({connectionString:config.DATABASE_URL,max:10,options:'-c search_path=bitpos,public'});
export async function tenant<T>(merchant:string,fn:(db:pg.PoolClient)=>Promise<T>):Promise<T>{const db=await pool.connect();try{await db.query('BEGIN');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);const result=await fn(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
export async function audit(db:pg.PoolClient,merchant:string,actor:string,action:string,subject:string){await db.query('INSERT INTO audit_logs(merchant_id,actor,action,subject) VALUES($1,$2,$3,$4)',[merchant,actor,action,subject]);}
