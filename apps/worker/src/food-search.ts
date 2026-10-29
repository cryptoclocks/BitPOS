import pg from 'pg';
import {z} from 'zod';
import {fetchFoodRoute,type FoodNavigationConfig,type FoodRouteOptions} from '../../api/src/food-navigation-provider';

export interface FoodSearchWorker {tick:(signal?:AbortSignal)=>Promise<void>;close:()=>Promise<void>;}
const uuid=z.string().uuid(),point={latitudeE7:z.number().int().min(-900000000).max(900000000),longitudeE7:z.number().int().min(-1800000000).max(1800000000)};
const ClaimSchema=z.object({runId:uuid,shipmentId:uuid,epoch:z.string().regex(/^[1-9][0-9]{0,18}$/),deadline:z.string().datetime({offset:true}),origin:z.object(point).strict(),vehicleType:z.enum(['MOTORCYCLE','CAR']),maxPickupSeconds:z.number().int().min(60).max(3600),fixture:z.boolean(),candidates:z.array(z.object({driverId:uuid,sourceDigest:z.string().regex(/^[0-9a-f]{64}$/),...point}).strict()).max(6)}).strict();
const FinishSchema=z.object({status:z.enum(['OFFERED','STALE','UNAVAILABLE','NO_CANDIDATE']),offerId:uuid.nullable()}).strict().refine(value=>(value.status==='OFFERED')===(value.offerId!==null));

/** Search authority is separate from mobile and from raw-point retention authority. */
export function createFoodSearchWorker(connectionString:string|undefined,config:FoodNavigationConfig,options:FoodRouteOptions={}):FoodSearchWorker|null{
 if(connectionString===undefined)return null;
 try{const url=new URL(connectionString);if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||url.pathname.length<2)throw Error();}catch{throw Error('Invalid BITPOS_FOOD_SEARCH_DATABASE_URL');}
 const pool=new pg.Pool({connectionString,max:1,connectionTimeoutMillis:1500,idleTimeoutMillis:10000,application_name:'bitpos_food_search'});
 pool.on('connect',client=>client.on('error',()=>console.error('Food search connection lost; transaction remains unsuccessful')));
 pool.on('error',()=>console.error('Food search idle connection removed; next tick reconnects'));
 let running:Promise<void>|undefined,closed=false;
 async function transaction<T>(operation:(db:pg.PoolClient)=>Promise<T>,signal?:AbortSignal):Promise<T>{
  signal?.throwIfAborted();const db=await pool.connect();
  try{
   await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='2000ms'; SET LOCAL lock_timeout='200ms'");
   const authority=(await db.query<{allowed:boolean}>(`SELECT current_user=session_user AND pg_has_role(session_user,'bitpos_food_search_worker','USAGE')
    AND NOT pg_has_role(session_user,'bitpos_app','MEMBER') AND NOT(r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls OR r.rolreplication) allowed FROM pg_roles r WHERE r.rolname=session_user`)).rows[0];
   if(!authority?.allowed)throw Error('FOOD_SEARCH_WORKER_ROLE_REQUIRED');signal?.throwIfAborted();const value=await operation(db);signal?.throwIfAborted();await db.query('COMMIT');return value;
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
 }
 async function perform(signal?:AbortSignal){
  const jobs=await transaction(async db=>{
   await db.query('SELECT bitpos.food_dispatch_expire_offers()');
   return z.array(uuid).max(16).parse((await db.query('SELECT bitpos.food_dispatch_search_jobs() value')).rows[0].value);
  },signal);
  if(jobs.length===0)return;
  const raw=await transaction(async db=>(await db.query('SELECT bitpos.food_dispatch_rank_claim($1) value',[jobs[0]])).rows[0].value,signal);if(raw===null)return;
  const claim=ClaimSchema.parse(raw);if(claim.shipmentId!==jobs[0]||new Set(claim.candidates.map(value=>value.driverId)).size!==claim.candidates.length)throw Error('INVALID_FOOD_RANKING_CLAIM');
  const remaining=Date.parse(claim.deadline)-Date.now();if(remaining<=0)return;
  const routeSignal=AbortSignal.any([AbortSignal.timeout(Math.min(45000,remaining)),...(signal?[signal]:[]),...(options.signal?[options.signal]:[])]);
  const results:{driverId:string;sourceDigest:string;status:'ROUTE'|'UNAVAILABLE';durationSeconds:number|null;distanceMetres:number|null}[]=[];
  for(const candidate of claim.candidates){
   routeSignal.throwIfAborted();if(config.kind==='unavailable')break;
   const route=await fetchFoodRoute(config,{origin:{latitudeE7:candidate.latitudeE7,longitudeE7:candidate.longitudeE7},destination:claim.origin,mode:claim.vehicleType==='MOTORCYCLE'?'motorcycle':'auto'},{...options,signal:routeSignal});
   routeSignal.throwIfAborted();results.push({driverId:candidate.driverId,sourceDigest:candidate.sourceDigest,status:route.kind==='route'?'ROUTE':'UNAVAILABLE',durationSeconds:route.kind==='route'?route.durationSeconds:null,distanceMetres:route.kind==='route'?route.distanceMetres:null});
  }
  // Unconfigured providers are explicit; no fabricated metrics or fallback offer.
  const payload=config.kind==='unavailable'?{status:'PROVIDER_UNAVAILABLE',results:claim.candidates.map(candidate=>({driverId:candidate.driverId,sourceDigest:candidate.sourceDigest,status:'UNAVAILABLE',durationSeconds:null,distanceMetres:null}))}:{status:'ROUTES',results};
  routeSignal.throwIfAborted();await transaction(async db=>FinishSchema.parse((await db.query('SELECT bitpos.food_dispatch_rank_finish($1,$2::jsonb) value',[claim.runId,JSON.stringify(payload)])).rows[0].value),routeSignal);
 }
 return {
  tick(signal){if(closed)return Promise.reject(Error('FOOD_SEARCH_WORKER_CLOSED'));if(running)return running;const current=perform(signal);running=current;void current.finally(()=>{if(running===current)running=undefined;}).catch(()=>{});return current;},
  async close(){closed=true;try{await running;}finally{await pool.end();}},
 };
}
