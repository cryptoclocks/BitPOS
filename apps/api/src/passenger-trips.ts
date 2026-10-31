import {createHash} from 'node:crypto';
import type pg from 'pg';
import {z} from 'zod';
import {pool} from './db';
import {fail} from './authority';
import {MobileRideQuoteRequestSchema,MobileRideRequestSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {canTransition,checkPin,issuePin,issueShareToken,quoteFare,type FareRates,type TripState} from '../../../packages/domain/src/passenger-trip';

// Passenger trip lifecycle. No payment, settlement or earning is attached; distance and
// duration are caller-supplied estimates until a route provider is admitted, and shared
// trips only change the fare (no pooling/matching of several riders into one vehicle yet).
const quoteInput=MobileRideQuoteRequestSchema;
const requestInput=MobileRideRequestSchema;
const uuid=z.string().uuid();
export interface TripView{id:string;state:TripState;seats:number;shared:boolean;fare:{currency:string;decimals:number;amountMinor:string};distanceMetres:number;durationSeconds:number;pickup:{latitudeE7:number;longitudeE7:number};dropoff:{latitudeE7:number;longitudeE7:number};version:string;riderAccountId:string;driverAccountId:string|null}
interface Row{id:string;state:TripState;seats:number;shared:boolean;currency:string;decimals:number;fare_minor:string;distance_metres:number;duration_seconds:number;pickup_lat_e7:number;pickup_lng_e7:number;dropoff_lat_e7:number;dropoff_lng_e7:number;version:string;rider_account_id:string;driver_account_id:string|null;pin_salt:string;pin_hash:string;pin_attempts:number}
const view=(r:Row):TripView=>({id:r.id,state:r.state,seats:r.seats,shared:r.shared,fare:{currency:r.currency,decimals:r.decimals,amountMinor:String(r.fare_minor)},distanceMetres:r.distance_metres,durationSeconds:r.duration_seconds,pickup:{latitudeE7:r.pickup_lat_e7,longitudeE7:r.pickup_lng_e7},dropoff:{latitudeE7:r.dropoff_lat_e7,longitudeE7:r.dropoff_lng_e7},version:String(r.version),riderAccountId:r.rider_account_id,driverAccountId:r.driver_account_id});
async function as<T>(account:string,driver:boolean,run:(db:pg.PoolClient)=>Promise<T>):Promise<T>{
 const db=await pool.connect();
 try{await db.query('BEGIN');await db.query("SELECT set_config('bitpos.mobile_account',$1,true)",[account]);if(driver)await db.query("SELECT set_config('bitpos.ride_driver','on',true)");const out=await run(db);await db.query('COMMIT');return out;}
 catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
async function activeRate(db:pg.PoolClient):Promise<{id:string;rates:FareRates}>{
 const r=(await db.query('SELECT * FROM ride_fare_rates WHERE active')).rows[0];if(!r)fail('FARES_UNPUBLISHED',409);
 return {id:r.id,rates:{currency:r.currency,decimals:r.decimals,baseMinor:BigInt(r.base_minor),perKmMinor:BigInt(r.per_km_minor),perMinuteMinor:BigInt(r.per_minute_minor),minimumMinor:BigInt(r.minimum_minor),sharedDiscountBps:r.shared_discount_bps}};
}
function priced(rates:FareRates,input:z.infer<typeof quoteInput>){try{return quoteFare(rates,input);}catch{fail('INVALID_REQUEST',422);}}
export async function quoteTrip(account:string,input:unknown){
 const d=quoteInput.safeParse(input);if(!d.success)fail('INVALID_REQUEST',422);
 return as(account,false,async db=>{const {id,rates}=await activeRate(db);const q=priced(rates,d.data);return {rateId:id,fare:{currency:q.currency,decimals:q.decimals,amountMinor:q.totalMinor.toString()},seats:q.seats,shared:q.shared};});
}
async function event(db:pg.PoolClient,trip:string,state:string,actor:string){await db.query('INSERT INTO passenger_trip_events(trip_id,seq,state,actor_account_id) VALUES($1,(SELECT coalesce(max(seq),0)+1 FROM passenger_trip_events WHERE trip_id=$1),$2,$3)',[trip,state,actor]);}
/** Creates the trip with a server-computed fare and returns the arrival PIN once. A replay of the same key returns the trip with pin=null. */
export async function requestTrip(account:string,input:unknown):Promise<{trip:TripView;pin:string|null}>{
 const d=requestInput.safeParse(input);if(!d.success)fail('INVALID_REQUEST',422);
 return as(account,false,async db=>{
  // Serialize all requests for this rider, including distinct idempotency keys.
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['ride-rider:'+account]);
  const prior=(await db.query<Row>('SELECT * FROM passenger_trips WHERE rider_account_id=$1 AND idempotency_key=$2',[account,d.data.idempotencyKey])).rows[0];
  if(prior){if(prior.seats!==d.data.seats||prior.shared!==d.data.shared||prior.distance_metres!==d.data.distanceMetres||prior.duration_seconds!==d.data.durationSeconds||prior.pickup_lat_e7!==d.data.pickup.latitudeE7||prior.pickup_lng_e7!==d.data.pickup.longitudeE7||prior.dropoff_lat_e7!==d.data.dropoff.latitudeE7||prior.dropoff_lng_e7!==d.data.dropoff.longitudeE7)fail('IDEMPOTENCY_CONFLICT',409);return {trip:view(prior),pin:null};}
  const open=(await db.query("SELECT 1 FROM passenger_trips WHERE rider_account_id=$1 AND state IN('REQUESTED','MATCHED','ARRIVED','IN_TRIP')",[account])).rowCount;if(open)fail('TRIP_STATE_CONFLICT',409);
  const {id:rateId,rates}=await activeRate(db);const q=priced(rates,d.data);const {pin,record}=issuePin();
  const row=(await db.query<Row>('INSERT INTO passenger_trips(rider_account_id,idempotency_key,seats,shared,rate_id,currency,decimals,fare_minor,distance_metres,duration_seconds,pickup_lat_e7,pickup_lng_e7,dropoff_lat_e7,dropoff_lng_e7,pin_salt,pin_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *',[account,d.data.idempotencyKey,d.data.seats,d.data.shared,rateId,q.currency,q.decimals,q.totalMinor.toString(),d.data.distanceMetres,d.data.durationSeconds,d.data.pickup.latitudeE7,d.data.pickup.longitudeE7,d.data.dropoff.latitudeE7,d.data.dropoff.longitudeE7,record.salt,record.hash])).rows[0];
  await event(db,row.id,'REQUESTED',account);return {trip:view(row),pin};
 });
}
export async function getTrip(account:string,tripId:string):Promise<TripView>{
 const id=uuid.safeParse(tripId);if(!id.success)fail('INVALID_REQUEST',422);
 return as(account,false,async db=>{const r=(await db.query<Row>('SELECT * FROM passenger_trips WHERE id=$1',[id.data])).rows[0];if(!r)fail('RESOURCE_NOT_FOUND',404);return view(r);});
}
async function approvedDriver(db:pg.PoolClient,_account:string){
 if(!(await db.query('SELECT ride_driver_approved() AS ok')).rows[0].ok)fail('DRIVER_NOT_APPROVED',403);
}
/** Approved drivers see open requests (pickup coordinates only, never the PIN). */
export async function openTrips(account:string):Promise<TripView[]>{
 return as(account,true,async db=>{await approvedDriver(db,account);return (await db.query<Row>("SELECT * FROM passenger_trips WHERE state='REQUESTED' ORDER BY created_at LIMIT 50")).rows.map(view);});
}
async function lock(db:pg.PoolClient,tripId:string){
 const id=uuid.safeParse(tripId);if(!id.success)fail('INVALID_REQUEST',422);
 const r=(await db.query<Row>('SELECT * FROM passenger_trips WHERE id=$1 FOR UPDATE',[id.data])).rows[0];if(!r)fail('RESOURCE_NOT_FOUND',404);return r;
}
async function move(db:pg.PoolClient,r:Row,to:TripState,actor:string,driver?:string,pinAttempts?:number){
 if(!canTransition(r.state,to))fail('TRIP_STATE_CONFLICT',409);
 const out=(await db.query<Row>('UPDATE passenger_trips SET state=$2,driver_account_id=coalesce($3,driver_account_id),pin_attempts=coalesce($4,pin_attempts),version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',[r.id,to,driver??null,pinAttempts??null])).rows[0];
 await event(db,r.id,to,actor);return view(out);
}
export async function acceptTrip(account:string,tripId:string):Promise<TripView>{
 try{return await as(account,true,async db=>{
  await approvedDriver(db,account);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['ride-driver:'+account]);
  const busy=(await db.query("SELECT 1 FROM passenger_trips WHERE driver_account_id=$1 AND state IN('MATCHED','ARRIVED','IN_TRIP')",[account])).rowCount;if(busy)fail('DRIVER_BUSY',409);
  const r=await lock(db,tripId);if(r.rider_account_id===account)fail('ROLE_REQUIRED',403);
  return move(db,r,'MATCHED',account,account);
 });}catch(error){
  // The database's shared food/ride occupancy fence can reject after a lock wait.
  if(error instanceof Error&&error.message==='DRIVER_BUSY')fail('DRIVER_BUSY',409);
  if(error instanceof Error&&error.message==='DRIVER_UNAVAILABLE')fail('DRIVER_UNAVAILABLE',409);
  throw error;
 }
}
function mine(r:Row,account:string){if(r.driver_account_id!==account)fail('RESOURCE_NOT_FOUND',404);}
export async function arriveTrip(account:string,tripId:string):Promise<TripView>{return as(account,false,async db=>{const r=await lock(db,tripId);mine(r,account);return move(db,r,'ARRIVED',account);});}
/** The rider's PIN starts the trip. Wrong PINs are counted; after 3 the PIN is locked and the trip must be cancelled. */
export async function startTrip(account:string,tripId:string,pin:unknown):Promise<TripView>{
 const p=z.string().safeParse(pin);if(!p.success)fail('INVALID_REQUEST',422);
 const db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SELECT set_config('bitpos.mobile_account',$1,true)",[account]);
  const r=await lock(db,tripId);mine(r,account);if(r.state!=='ARRIVED')fail('TRIP_STATE_CONFLICT',409);
  const res=checkPin({hash:r.pin_hash,salt:r.pin_salt,attempts:r.pin_attempts},p.data);
  if(!res.ok){
   if(res.record.attempts!==r.pin_attempts)await db.query('UPDATE passenger_trips SET pin_attempts=$2,updated_at=clock_timestamp() WHERE id=$1',[r.id,res.record.attempts]);
   await db.query('COMMIT');fail(res.locked?'PIN_LOCKED':'PIN_INVALID',res.locked?423:409);
  }
  const out=await move(db,r,'IN_TRIP',account);await db.query('COMMIT');return out;
 }catch(error){await db.query('ROLLBACK').catch(()=>undefined);throw error;}finally{db.release();}
}
export async function completeTrip(account:string,tripId:string):Promise<TripView>{return as(account,false,async db=>{const r=await lock(db,tripId);mine(r,account);return move(db,r,'COMPLETED',account);});}
/** Rider may cancel before the trip starts; the matched driver may cancel before it starts. Neither can cancel an in-progress trip. */
export async function cancelTrip(account:string,tripId:string):Promise<TripView>{
 return as(account,false,async db=>{const r=await lock(db,tripId);if(r.rider_account_id!==account&&r.driver_account_id!==account)fail('RESOURCE_NOT_FOUND',404);return move(db,r,'CANCELLED',account);});
}

// --- Safety (DS48): share links and incident reports ---
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const incidentInput=z.object({idempotencyKey:z.string().uuid(),kind:z.enum(['SAFETY','CONDUCT','FARE','OTHER']),body:z.string().trim().min(1).max(500)}).strict();
/** The rider shares a live trip. The token is returned once and stored as a hash; it expires and can be revoked. */
export async function shareTrip(account:string,tripId:string):Promise<{token:string;expiresAt:string}>{
 return as(account,false,async db=>{
  const r=await lock(db,tripId);if(r.rider_account_id!==account)fail('RESOURCE_NOT_FOUND',404);
  if(r.state==='COMPLETED'||r.state==='CANCELLED')fail('TRIP_STATE_CONFLICT',409);
  const s=issueShareToken(Date.now());
  await db.query('INSERT INTO passenger_trip_shares(trip_id,created_by,token_hash,expires_at) VALUES($1,$2,$3,$4)',[r.id,account,s.hash,new Date(s.expiresAt).toISOString()]);
  return {token:s.token,expiresAt:new Date(s.expiresAt).toISOString()};
 });
}
export async function revokeShares(account:string,tripId:string):Promise<{revoked:number}>{
 return as(account,false,async db=>{const r=await lock(db,tripId);if(r.rider_account_id!==account)fail('RESOURCE_NOT_FOUND',404);
  return {revoked:(await db.query('UPDATE passenger_trip_shares SET revoked_at=clock_timestamp() WHERE trip_id=$1 AND revoked_at IS NULL',[r.id])).rowCount??0};});
}
/** Public read for a share-link holder: state and last update only, no people, places or fare. */
export async function sharedTripView(token:string):Promise<{state:TripState;updatedAt:string;expiresAt:string}>{
 if(!/^[A-Za-z0-9_-]{20,64}$/.test(token))fail('RESOURCE_NOT_FOUND',404);
 const db=await pool.connect();
 try{const r=(await db.query('SELECT * FROM ride_share_view($1)',[sha(token)])).rows[0];if(!r)fail('RESOURCE_NOT_FOUND',404);
  return {state:r.state,updatedAt:new Date(r.updated_at).toISOString(),expiresAt:new Date(r.expires_at).toISOString()};}
 finally{db.release();}
}
/** Either party reports an incident on their own trip, any state. Idempotent by key; append-only. */
export async function reportIncident(account:string,tripId:string,input:unknown):Promise<{id:string;kind:string;createdAt:string}>{
 const d=incidentInput.safeParse(input);if(!d.success)fail('INVALID_REQUEST',422);
 return as(account,false,async db=>{
  const id=uuid.safeParse(tripId);if(!id.success)fail('INVALID_REQUEST',422);
  const t=(await db.query<Row>('SELECT * FROM passenger_trips WHERE id=$1',[id.data])).rows[0];
  if(!t||(t.rider_account_id!==account&&t.driver_account_id!==account))fail('RESOURCE_NOT_FOUND',404);
  const prior=(await db.query('SELECT id,kind,body,trip_id,created_at FROM passenger_trip_incidents WHERE reporter_account_id=$1 AND idempotency_key=$2',[account,d.data.idempotencyKey])).rows[0];
  if(prior){if(prior.trip_id!==id.data||prior.kind!==d.data.kind||prior.body!==d.data.body)fail('IDEMPOTENCY_CONFLICT',409);return {id:prior.id,kind:prior.kind,createdAt:new Date(prior.created_at).toISOString()};}
  const row=(await db.query('INSERT INTO passenger_trip_incidents(trip_id,reporter_account_id,idempotency_key,kind,body) VALUES($1,$2,$3,$4,$5) RETURNING id,kind,created_at',[id.data,account,d.data.idempotencyKey,d.data.kind,d.data.body])).rows[0];
  return {id:row.id,kind:row.kind,createdAt:new Date(row.created_at).toISOString()};
 });
}

// --- Fare publication (platform administrators) ---
const digits=z.string().regex(/^(0|[1-9][0-9]{0,15})$/);
const fareInput=z.object({expectedRateId:z.string().uuid().nullable(),currency:z.enum(['THB','USD','USDG','USDC','USDT']),decimals:z.union([z.literal(2),z.literal(4),z.literal(6)]),baseMinor:digits,perKmMinor:digits,perMinuteMinor:digits,minimumMinor:digits,sharedDiscountBps:z.number().int().min(0).max(9000)}).strict();
export interface FareView{rateId:string;currency:string;decimals:number;baseMinor:string;perKmMinor:string;perMinuteMinor:string;minimumMinor:string;sharedDiscountBps:number;publishedAt:string}
const fareView=(r:Record<string,unknown>):FareView=>({rateId:String(r.id),currency:String(r.currency),decimals:Number(r.decimals),baseMinor:String(r.base_minor),perKmMinor:String(r.per_km_minor),perMinuteMinor:String(r.per_minute_minor),minimumMinor:String(r.minimum_minor),sharedDiscountBps:Number(r.shared_discount_bps),publishedAt:new Date(r.published_at as string).toISOString()});
async function admin(db:pg.PoolClient){if(!(await db.query('SELECT ride_fare_admin() AS ok')).rows[0].ok)fail('ROLE_REQUIRED',403);}
export async function activeFare(account:string):Promise<{fare:FareView|null}>{
 return as(account,false,async db=>{await admin(db);const r=(await db.query('SELECT * FROM ride_fare_rates WHERE active')).rows[0];return {fare:r?fareView(r):null};});
}
export async function publishFare(account:string,input:unknown):Promise<FareView>{
 const d=fareInput.safeParse(input);if(!d.success)fail('INVALID_REQUEST',422);
 const v=d.data;
 return as(account,false,async db=>{
  await admin(db);
  try{
   const id=(await db.query('SELECT ride_publish_fare($1,$2,$3,$4,$5,$6,$7,$8) AS id',[v.expectedRateId,v.currency,v.decimals,v.baseMinor,v.perKmMinor,v.perMinuteMinor,v.minimumMinor,v.sharedDiscountBps])).rows[0].id;
   return fareView((await db.query('SELECT * FROM ride_fare_rates WHERE id=$1',[id])).rows[0]);
  }catch(error){if(error instanceof Error&&/FARE_CHANGED/.test(error.message))fail('FARE_CHANGED',409);if(error instanceof Error&&/INVALID_REQUEST/.test(error.message))fail('INVALID_REQUEST',422);throw error;}
 });
}

// --- Staff incident review (support/administrator) ---
const reviewInput=z.object({outcome:z.enum(['NO_ACTION','FOLLOW_UP','ESCALATED']),note:z.string().trim().min(1).max(500)}).strict();
export interface IncidentQueueItem{id:string;tripId:string;kind:string;body:string;reporterRole:'RIDER'|'DRIVER';createdAt:string}
function staffError(error:unknown):never{
 if(error instanceof Error){if(/ROLE_REQUIRED/.test(error.message))fail('ROLE_REQUIRED',403);if(/RESOURCE_NOT_FOUND/.test(error.message))fail('RESOURCE_NOT_FOUND',404);if(/ALREADY_REVIEWED/.test(error.message))fail('ALREADY_REVIEWED',409);}
 throw error;
}
export async function incidentQueue(account:string):Promise<{incidents:IncidentQueueItem[]}>{
 return as(account,false,async db=>{try{
  const rows=(await db.query('SELECT * FROM ride_incident_queue(50)')).rows;
  return {incidents:rows.map(r=>({id:r.id,tripId:r.trip_id,kind:r.kind,body:r.body,reporterRole:r.reporter_role,createdAt:new Date(r.created_at).toISOString()}))};
 }catch(error){return staffError(error);}});
}
export async function reviewIncident(account:string,incidentId:string,input:unknown):Promise<{incidentId:string;outcome:string;reviewedAt:string}>{
 const id=uuid.safeParse(incidentId),d=reviewInput.safeParse(input);if(!id.success||!d.success)fail('INVALID_REQUEST',422);
 return as(account,false,async db=>{try{
  const at=(await db.query('SELECT ride_incident_review($1,$2,$3) AS at',[id.data,d.data.outcome,d.data.note])).rows[0].at;
  return {incidentId:id.data,outcome:d.data.outcome,reviewedAt:new Date(at).toISOString()};
 }catch(error){return staffError(error);}});
}

/** The caller's most recent unfinished trip as rider or matched driver, or null. */
export async function currentTrip(account:string):Promise<{trip:TripView|null}>{
 return as(account,false,async db=>{
  const r=(await db.query<Row>("SELECT * FROM passenger_trips WHERE (rider_account_id=$1 OR driver_account_id=$1) AND state IN('REQUESTED','MATCHED','ARRIVED','IN_TRIP') ORDER BY created_at DESC LIMIT 1",[account])).rows[0];
  return {trip:r?view(r):null};
 });
}

// Location is separate from immutable trip/financial facts and never included in share links.
const locationPoint=z.object({latitudeE7:z.number().int().min(-900000000).max(900000000),longitudeE7:z.number().int().min(-1800000000).max(1800000000)}).strict();
async function locationError<T>(run:()=>Promise<T>):Promise<T>{try{return await run();}catch(error){
 if(error instanceof Error){for(const [code,status] of [['RESOURCE_NOT_FOUND',404],['TRIP_STATE_CONFLICT',409],['DRIVER_NOT_APPROVED',403],['LOCATION_OPT_IN_REQUIRED',409]] as const)if(error.message.includes(code))fail(code,status);}
 throw error;
}}
export async function rideLocation(account:string,tripId:string){
 const id=uuid.parse(tripId);
 return locationError(()=>as(account,false,async db=>{
  const row=(await db.query('SELECT * FROM ride_location_view($1)',[id])).rows[0];
  return {enabled:row?.enabled??false,point:row?.received_at?{latitudeE7:row.latitude_e7,longitudeE7:row.longitude_e7}:null,receivedAt:row?.received_at?new Date(row.received_at).toISOString():null,expiresAt:row?.expires_at?new Date(row.expires_at).toISOString():null};
 }));
}
export async function setRideLocationConsent(account:string,tripId:string,input:unknown){
 const id=uuid.parse(tripId),d=z.object({enabled:z.boolean()}).strict().parse(input);
 return locationError(()=>as(account,false,async db=>({enabled:(await db.query('SELECT ride_location_command($1,$2) AS enabled',[id,d.enabled])).rows[0].enabled as boolean})));
}
export async function sendRideLocation(account:string,tripId:string,input:unknown){
 const id=uuid.parse(tripId),d=locationPoint.parse(input);
 return locationError(()=>as(account,false,async db=>({enabled:(await db.query('SELECT ride_location_command($1,true,$2,$3) AS enabled',[id,d.latitudeE7,d.longitudeE7])).rows[0].enabled as boolean})));
}
