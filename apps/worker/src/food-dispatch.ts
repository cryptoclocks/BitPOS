import pg from 'pg';
export interface FoodDispatchWorker {tick:()=>Promise<void>;close:()=>Promise<void>;}
/** Separate least-privilege connection; never borrow merchant/mobile authority. */
export function createFoodDispatchWorker(connectionString:string|undefined):FoodDispatchWorker|null{
 if(connectionString===undefined)return null;
 try{const url=new URL(connectionString);if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||url.pathname.length<2)throw Error();}catch{throw Error('Invalid BITPOS_FOOD_DISPATCH_DATABASE_URL');}
 const pool=new pg.Pool({connectionString,max:1,connectionTimeoutMillis:1500,idleTimeoutMillis:10000,application_name:'bitpos_food_dispatch'});
 pool.on('connect',client=>client.on('error',()=>console.error('Private food maintenance connection lost; transaction remains unsuccessful')));
 pool.on('error',()=>console.error('Private food maintenance idle connection removed; next tick reconnects'));
 return {
  async tick(){
   const db=await pool.connect();
   try{
    await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='2000ms'; SET LOCAL lock_timeout='200ms'");
    const authority=(await db.query<{allowed:boolean}>(`SELECT current_user=session_user
     AND pg_has_role(session_user,'bitpos_food_dispatch_worker','USAGE')
     AND NOT pg_has_role(session_user,'bitpos_app','MEMBER')
     AND NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls OR r.rolreplication) AS allowed
     FROM pg_roles r WHERE r.rolname=session_user`)).rows[0];
    if(!authority?.allowed)throw Error('FOOD_DISPATCH_WORKER_ROLE_REQUIRED');
    await db.query('SELECT bitpos.food_discovery_prune()');await db.query('COMMIT');
   }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  },
  close:()=>pool.end(),
 };
}
