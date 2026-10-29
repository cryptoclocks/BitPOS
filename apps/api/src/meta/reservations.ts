// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Table booking by chat. The customer's words become date / time / party size (Muse Spark, or the free matcher
// below); what is missing is asked back. With a time the booking is made at once (today, or tomorrow when that
// time has passed). A booking holds one table that has a BitPOS device with an NTAG sticker; the customer
// checks in by tapping it from 15 minutes before to 15 minutes after the booked time, otherwise the booking
// lapses and the table is free. While held, other customers' taps at that table are refused.
// All clock reads and Bangkok-time arithmetic happen in the database, in one statement per decision.
import type pg from 'pg';
import type {MetaDb} from './identity';

export const CHECKIN_MINUTES=15,SEATED_MINUTES=90,MAX_DAYS=14,TZ='Asia/Bangkok';
export interface BookingFields {date:string|null;time:string|null;partySize:number|null}
export interface ReservationView {id:string;code:string;tableLabel:string;partySize:number;startsAt:string;checkInFrom:string;checkInUntil:string;status:'HELD'|'CHECKED_IN'|'NO_SHOW'|'CANCELLED'}
export type BookingResult=
 {kind:'ask';missing:('date'|'time')[];fields:BookingFields;today:string}|
 {kind:'booked';reservation:ReservationView}|
 {kind:'full';fields:BookingFields;alternatives:string[]}|
 {kind:'invalid';reason:'PAST'|'TOO_FAR'|'NO_TABLES'};

const DATE=/^\d{4}-\d{2}-\d{2}$/,TIME=/^([01]\d|2[0-3]):[0-5]\d$/;
const code=(id:string)=>id.replace(/-/g,'').slice(0,4).toUpperCase();
const pad=(n:number)=>String(n).padStart(2,'0');

/** Normalises model or matcher output; anything malformed becomes unknown (asked back), never guessed. */
export function cleanFields(f:Partial<BookingFields>):BookingFields{
 const date=typeof f.date==='string'&&DATE.test(f.date)&&!Number.isNaN(Date.parse(f.date+'T00:00:00Z'))?f.date:null;
 const time=typeof f.time==='string'&&TIME.test(f.time)?f.time:null;
 const partySize=Number.isInteger(f.partySize)&&f.partySize!>=1&&f.partySize!<=12?f.partySize!:null;
 return {date,time,partySize};
}

/** Free matcher for Thai/English booking phrases: "จองโต๊ะ 2 คน พรุ่งนี้ 1 ทุ่ม", "book 4 people 19:30". */
export function parseBooking(text:string,today:string):{intent:boolean;fields:BookingFields}{
 const t=text.toLowerCase();
 const intent=/จอง|book|reserv/.test(t);
 const base=new Date(today+'T00:00:00Z');
 const addDays=(n:number)=>new Date(base.getTime()+n*86_400_000).toISOString().slice(0,10);
 let date:string|null=null;
 if(/มะรืน|day after tomorrow/.test(t))date=addDays(2);else if(/พรุ่งนี้|tomorrow/.test(t))date=addDays(1);else if(/วันนี้|today|tonight|คืนนี้/.test(t))date=addDays(0);
 const dm=t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
 if(dm){const y=Number(today.slice(0,4)),cand=`${y}-${pad(Number(dm[2]))}-${pad(Number(dm[1]))}`;date=cand<today?`${y+1}${cand.slice(4)}`:cand;}
 let time:string|null=null;
 const hm=t.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
 const thum=t.match(/(\d{1,2})\s*ทุ่ม/),bai=t.match(/บ่าย\s*(\d{1,2})/),mong=t.match(/(\d{1,2})\s*โมง(เช้า|เย็น)?/),ampm=t.match(/\b(\d{1,2})\s*(am|pm)\b/);
 if(hm)time=`${pad(Number(hm[1]))}:${hm[2]}`;
 else if(thum&&Number(thum[1])>=1&&Number(thum[1])<=5)time=`${18+Number(thum[1])}:00`;
 else if(bai&&Number(bai[1])>=1&&Number(bai[1])<=5)time=`${12+Number(bai[1])}:00`;
 else if(ampm){let h=Number(ampm[1])%12;if(ampm[2]==='pm')h+=12;time=`${pad(h)}:00`;}
 else if(mong){let h=Number(mong[1]);if(mong[2]==='เย็น'&&h<12)h+=12;if(h>=1&&h<=23)time=`${pad(h)}:00`;}
 if(/เที่ยงคืน|midnight/.test(t))time=null;else if(/เที่ยง|noon/.test(t)&&!time)time='12:00';
 const party=t.match(/(\d{1,2})\s*(คน|ท่าน|ที่|people|persons?|pax|guests?)/);
 return {intent,fields:cleanFields({date,time,partySize:party?Number(party[1]):null})};
}

export async function bangkokToday(db:MetaDb,merchantId:string):Promise<string>{
 return db.tenant(merchantId,async c=>(await c.query<{d:string}>(`SELECT to_char((clock_timestamp() AT TIME ZONE '${TZ}')::date,'YYYY-MM-DD') AS d`)).rows[0].d);
}

type ResRow={id:string;table_label:string;party_size:number;starts_at:Date;status:ReservationView['status']};
const view=(r:ResRow):ReservationView=>({id:r.id,code:code(r.id),tableLabel:r.table_label,partySize:r.party_size,startsAt:r.starts_at.toISOString(),
 checkInFrom:new Date(r.starts_at.getTime()-CHECKIN_MINUTES*60_000).toISOString(),checkInUntil:new Date(r.starts_at.getTime()+CHECKIN_MINUTES*60_000).toISOString(),status:r.status});
const RES_SQL=`SELECT r.id,coalesce(t.label,'') AS table_label,r.party_size,r.starts_at,r.status FROM meta_table_reservations r LEFT JOIN merchant_tables t ON t.merchant_id=r.merchant_id AND t.id=r.table_id`;

/** Merges what the customer just said into their open request (30 minutes), returning the combined fields. */
async function mergeRequest(c:pg.PoolClient,merchantId:string,linkId:string,f:BookingFields):Promise<BookingFields>{
 await c.query("UPDATE meta_booking_requests SET closed_at=clock_timestamp() WHERE link_id=$1 AND closed_at IS NULL AND expires_at<=clock_timestamp()",[linkId]);
 const r=(await c.query<{booking_date:string|null;booking_time:string|null;party_size:number|null}>(
  `INSERT INTO meta_booking_requests(merchant_id,link_id,booking_date,booking_time,party_size,created_at,expires_at) SELECT $1,$2,$3::date,$4::time,$5,t,t+interval '30 minutes' FROM (SELECT clock_timestamp() AS t) n
   ON CONFLICT (merchant_id,link_id) WHERE closed_at IS NULL DO UPDATE SET booking_date=coalesce(EXCLUDED.booking_date,meta_booking_requests.booking_date),booking_time=coalesce(EXCLUDED.booking_time,meta_booking_requests.booking_time),
    party_size=coalesce(EXCLUDED.party_size,meta_booking_requests.party_size),expires_at=clock_timestamp()+interval '30 minutes'
   RETURNING to_char(booking_date,'YYYY-MM-DD') AS booking_date,to_char(booking_time,'HH24:MI') AS booking_time,party_size`,[merchantId,linkId,f.date,f.time,f.partySize])).rows[0];
 return {date:r.booking_date,time:r.booking_time,partySize:r.party_size};
}

export async function openBookingRequest(db:MetaDb,merchantId:string,linkId:string):Promise<BookingFields|null>{
 return db.tenant(merchantId,async c=>{
  const r=(await c.query<{d:string|null;t:string|null;p:number|null}>("SELECT to_char(booking_date,'YYYY-MM-DD') AS d,to_char(booking_time,'HH24:MI') AS t,party_size AS p FROM meta_booking_requests WHERE link_id=$1 AND closed_at IS NULL AND expires_at>clock_timestamp()",[linkId])).rows[0];
  return r?{date:r.d,time:r.t,partySize:r.p}:null;
 });
}

/** Tables a customer can check in at: not retired, with a BitPOS device carrying an active NTAG sticker. */
const BOOKABLE=`SELECT t.id,t.label FROM merchant_tables t WHERE t.retired_at IS NULL AND EXISTS(SELECT 1 FROM devices d JOIN meta_ntag_tags g ON g.merchant_id=d.merchant_id AND g.device_id=d.id AND g.retired_at IS NULL
 WHERE d.merchant_id=t.merchant_id AND d.table_id=t.id AND d.revoked_at IS NULL) ORDER BY t.label,t.id`;
// Two bookings on one table clash when their [start-15m, start+90m] spans overlap.
const CLASH=`EXISTS(SELECT 1 FROM meta_table_reservations r WHERE r.table_id=$1 AND r.status IN ('HELD','CHECKED_IN') AND abs(extract(epoch FROM r.starts_at-$2::timestamptz))<${(CHECKIN_MINUTES+SEATED_MINUTES)*60})`;

/** Adds what was said to the open request; books as soon as there is a time; otherwise says what to ask. */
export async function requestBooking(db:MetaDb,merchantId:string,linkId:string,said:BookingFields,by:{chosenBy:'model'|'fallback';invocationId:string|null}):Promise<BookingResult>{
 return db.tenant(merchantId,async c=>{
  // One booking decision per shop at a time, so two customers can never take the same table.
  await c.query("SELECT pg_advisory_xact_lock(hashtext('meta-booking:'||$1))",[merchantId]);
  const f=await mergeRequest(c,merchantId,linkId,cleanFields(said));
  const today=(await c.query<{d:string}>(`SELECT to_char((clock_timestamp() AT TIME ZONE '${TZ}')::date,'YYYY-MM-DD') AS d`)).rows[0].d;
  if(!f.time)return {kind:'ask',missing:f.date?['time']:['date','time'],fields:f,today};
  // A time alone means today, or tomorrow when that time has already passed.
  const when=(await c.query<{starts_at:Date;past:boolean;too_far:boolean;date:string}>(
   `WITH s AS (SELECT CASE WHEN $1::date IS NOT NULL THEN ($1::date+$2::time) AT TIME ZONE '${TZ}'
     WHEN (((clock_timestamp() AT TIME ZONE '${TZ}')::date+$2::time) AT TIME ZONE '${TZ}')>clock_timestamp() THEN ((clock_timestamp() AT TIME ZONE '${TZ}')::date+$2::time) AT TIME ZONE '${TZ}'
     ELSE ((clock_timestamp() AT TIME ZONE '${TZ}')::date+1+$2::time) AT TIME ZONE '${TZ}' END AS at)
    SELECT at AS starts_at,at<=clock_timestamp() AS past,at>clock_timestamp()+interval '${MAX_DAYS} days' AS too_far,to_char((at AT TIME ZONE '${TZ}')::date,'YYYY-MM-DD') AS date FROM s`,[f.date,f.time])).rows[0];
  // An unusable answer is forgotten so the next one can replace it.
  if(when.past){await c.query('UPDATE meta_booking_requests SET booking_time=NULL WHERE link_id=$1 AND closed_at IS NULL',[linkId]);return {kind:'invalid',reason:'PAST'};}
  if(when.too_far){await c.query('UPDATE meta_booking_requests SET booking_date=NULL WHERE link_id=$1 AND closed_at IS NULL',[linkId]);return {kind:'invalid',reason:'TOO_FAR'};}
  const tables=(await c.query<{id:string;label:string}>(BOOKABLE)).rows;
  if(!tables.length)return {kind:'invalid',reason:'NO_TABLES'};
  const party=f.partySize??2;
  for(const t of tables){
   if((await c.query<{x:boolean}>(`SELECT ${CLASH} AS x`,[t.id,when.starts_at])).rows[0].x)continue;
   const id=(await c.query<{id:string}>('INSERT INTO meta_table_reservations(merchant_id,link_id,table_id,party_size,starts_at,chosen_by,invocation_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [merchantId,linkId,t.id,party,when.starts_at,by.chosenBy,by.invocationId])).rows[0].id;
   await c.query('UPDATE meta_booking_requests SET closed_at=clock_timestamp() WHERE link_id=$1 AND closed_at IS NULL',[linkId]);
   return {kind:'booked',reservation:view((await c.query<ResRow>(`${RES_SQL} WHERE r.id=$1`,[id])).rows[0])};
  }
  // Full: offer up to three nearby free times on the same day (30-minute steps, still in the future).
  const alternatives:string[]=[];
  for(const step of [30,-30,60,-60,90,-90,120]){
   const alt=new Date(when.starts_at.getTime()+step*60_000);
   if(alt.getTime()<=Date.now()+5*60_000)continue;
   for(const t of tables)if(!(await c.query<{x:boolean}>(`SELECT ${CLASH} AS x`,[t.id,alt])).rows[0].x){
    alternatives.push(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:TZ}).format(alt));break;}
   if(alternatives.length>=3)break;
  }
  return {kind:'full',fields:{...f,date:when.date},alternatives:[...new Set(alternatives)].sort()};
 });
}

/** "Book a table" from the menu starts over: what was said earlier is dropped. */
export async function resetBookingRequest(db:MetaDb,merchantId:string,linkId:string):Promise<void>{
 await db.tenant(merchantId,c=>c.query('UPDATE meta_booking_requests SET closed_at=clock_timestamp() WHERE link_id=$1 AND closed_at IS NULL',[linkId]));
}

export async function cancelReservation(db:MetaDb,merchantId:string,id:string,by:{linkId:string}|{staff:true}):Promise<ReservationView|null>{
 if(!/^[0-9a-f-]{36}$/.test(id))return null;
 return db.tenant(merchantId,async c=>{
  const r=(await c.query<{id:string}>(`UPDATE meta_table_reservations SET status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by=$3 WHERE id=$1 AND status='HELD' AND ($2::uuid IS NULL OR link_id=$2) RETURNING id`,
   [id,'linkId' in by?by.linkId:null,'linkId' in by?'customer':'staff'])).rows[0];
  if(!r)return null;
  return view((await c.query<ResRow>(`${RES_SQL} WHERE r.id=$1`,[id])).rows[0]);
 });
}

export async function customerReservations(db:MetaDb,merchantId:string,linkId:string):Promise<ReservationView[]>{
 return db.tenant(merchantId,async c=>(await c.query<ResRow>(`${RES_SQL} WHERE r.link_id=$1 AND r.starts_at>clock_timestamp()-interval '1 day' ORDER BY r.starts_at LIMIT 5`,[linkId])).rows.map(view));
}

export type TableHold={reservationId:string;linkId:string;tableLabel:string;status:'HELD'|'CHECKED_IN';startsAt:Date;checkInUntil:Date};
/** The booking that holds a device's table right now: HELD inside its check-in window, or CHECKED_IN and seated. */
export async function holdForDevice(c:pg.PoolClient,deviceId:string):Promise<TableHold|null>{
 const r=(await c.query<{id:string;link_id:string;label:string;status:'HELD'|'CHECKED_IN';starts_at:Date}>(
  `SELECT r.id,r.link_id,coalesce(t.label,'') AS label,r.status,r.starts_at FROM devices d JOIN meta_table_reservations r ON r.merchant_id=d.merchant_id AND r.table_id=d.table_id
   LEFT JOIN merchant_tables t ON t.merchant_id=r.merchant_id AND t.id=r.table_id
   WHERE d.id=$1 AND ((r.status='HELD' AND clock_timestamp() BETWEEN r.starts_at-interval '${CHECKIN_MINUTES} minutes' AND r.starts_at+interval '${CHECKIN_MINUTES} minutes')
    OR (r.status='CHECKED_IN' AND clock_timestamp()<r.starts_at+interval '${SEATED_MINUTES} minutes')) ORDER BY r.starts_at LIMIT 1`,[deviceId])).rows[0];
 return r?{reservationId:r.id,linkId:r.link_id,tableLabel:r.label,status:r.status,startsAt:r.starts_at,checkInUntil:new Date(r.starts_at.getTime()+CHECKIN_MINUTES*60_000)}:null;
}

/** What the screen at a table shows: no personal data, only the table's booking state and its deadlines. */
export interface TableScreen {tableLabel:string;state:'free'|'upcoming'|'check_in'|'seated';partySize:number|null;startsAt:string|null;
 checkInFrom:string|null;checkInUntil:string|null;seatedUntil:string|null;now:string}
/** The table of a device: the booking holding it now, else the next booking within 3 hours. Times come from the database clock. */
export async function tableScreen(db:MetaDb,merchantId:string,deviceId:string):Promise<TableScreen|null>{
 return db.tenant(merchantId,async c=>{
  const t=(await c.query<{label:string;now:Date}>(`SELECT coalesce(t.label,'') AS label,clock_timestamp() AS now FROM devices d LEFT JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id WHERE d.id=$1 AND d.table_id IS NOT NULL`,[deviceId])).rows[0];
  if(!t)return null;
  const r=(await c.query<{status:'HELD'|'CHECKED_IN';starts_at:Date;party_size:number}>(
   `SELECT r.status,r.starts_at,r.party_size FROM devices d JOIN meta_table_reservations r ON r.merchant_id=d.merchant_id AND r.table_id=d.table_id
    WHERE d.id=$1 AND ((r.status='HELD' AND clock_timestamp()<=r.starts_at+interval '${CHECKIN_MINUTES} minutes' AND r.starts_at<=clock_timestamp()+interval '3 hours')
     OR (r.status='CHECKED_IN' AND clock_timestamp()<r.starts_at+interval '${SEATED_MINUTES} minutes'))
    ORDER BY (r.status='CHECKED_IN') DESC,r.starts_at LIMIT 1`,[deviceId])).rows[0];
  const iso=(ms:number)=>new Date(ms).toISOString(),now=t.now.getTime();
  if(!r)return {tableLabel:t.label,state:'free',partySize:null,startsAt:null,checkInFrom:null,checkInUntil:null,seatedUntil:null,now:iso(now)};
  const start=r.starts_at.getTime(),from=start-CHECKIN_MINUTES*60_000,until=start+CHECKIN_MINUTES*60_000;
  const state=r.status==='CHECKED_IN'?'seated':now>=from?'check_in':'upcoming';
  return {tableLabel:t.label,state,partySize:r.party_size,startsAt:iso(start),checkInFrom:iso(from),checkInUntil:iso(until),
   seatedUntil:r.status==='CHECKED_IN'?iso(start+SEATED_MINUTES*60_000):null,now:iso(now)};
 });
}

/** Tables with an active NTAG sticker, for the staff page's table-screen links. */
export async function screenTags(db:MetaDb,merchantId:string):Promise<{tagId:string;tableLabel:string}[]>{
 return db.tenant(merchantId,async c=>(await c.query<{tag_id:string;label:string}>(
  `SELECT g.tag_id,t.label FROM meta_ntag_tags g JOIN devices d ON d.merchant_id=g.merchant_id AND d.id=g.device_id JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id
   WHERE g.retired_at IS NULL AND t.retired_at IS NULL ORDER BY t.label LIMIT 20`)).rows.map(r=>({tagId:r.tag_id,tableLabel:r.label})));
}

/** Inside the tap's transaction: the booked customer checks in; returns true when this tap did it. */
export async function checkIn(c:pg.PoolClient,hold:TableHold,tapSessionId:string):Promise<boolean>{
 return (await c.query("UPDATE meta_table_reservations SET status='CHECKED_IN',checked_in_at=clock_timestamp(),tap_session_id=$2 WHERE id=$1 AND status='HELD'",[hold.reservationId,tapSessionId])).rowCount===1;
}

/** Marks bookings past their check-in window as NO_SHOW (once) and returns who to tell. */
export async function sweepLapsed(db:MetaDb):Promise<{merchantId:string;psid:string;text:string}[]>{
 const merchants=(await db.query<{m:string}>('SELECT bitpos.meta_lapsed_reservation_merchants() AS m',[])).rows.map(r=>r.m);
 const out:{merchantId:string;psid:string;text:string}[]=[];
 for(const merchantId of merchants){
  const rows=await db.tenant(merchantId,async c=>(await c.query<{psid:string|null;label:string;starts_at:Date}>(
   `WITH lapsed AS (UPDATE meta_table_reservations SET status='NO_SHOW',lapse_notified_at=clock_timestamp() WHERE status='HELD' AND starts_at+interval '${CHECKIN_MINUTES} minutes'<clock_timestamp() RETURNING link_id,table_id,starts_at)
    SELECT l.psid,coalesce(t.label,'') AS label,x.starts_at FROM lapsed x LEFT JOIN meta_customer_links l ON l.merchant_id=$1 AND l.id=x.link_id AND l.revoked_at IS NULL
    LEFT JOIN merchant_tables t ON t.merchant_id=$1 AND t.id=x.table_id`,[merchantId])).rows);
  for(const r of rows)if(r.psid){
   const at=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:TZ}).format(r.starts_at);
   out.push({merchantId,psid:r.psid,text:`การจองโต๊ะ ${r.label} เวลา ${at} หลุดแล้ว เพราะไม่ได้แตะเช็กอินภายใน ${CHECKIN_MINUTES} นาที จองใหม่ได้เลยค่ะ\nYour ${at} booking at table ${r.label} lapsed (no check-in within ${CHECKIN_MINUTES} minutes). Book again any time.`});
  }
 }
 return out;
}

export interface StaffReservation {id:string;code:string;tableLabel:string;partySize:number;startsAt:string;status:string;minutesToDeadline:number|null}
export async function staffReservations(db:MetaDb,merchantId:string):Promise<StaffReservation[]>{
 return db.tenant(merchantId,async c=>(await c.query<{id:string;label:string;party_size:number;starts_at:Date;status:string;mins:number|null}>(
  `SELECT r.id,coalesce(t.label,'') AS label,r.party_size,r.starts_at,r.status,
    CASE WHEN r.status='HELD' THEN ceil(extract(epoch FROM r.starts_at+interval '${CHECKIN_MINUTES} minutes'-clock_timestamp())/60)::int END AS mins
   FROM meta_table_reservations r LEFT JOIN merchant_tables t ON t.merchant_id=r.merchant_id AND t.id=r.table_id
   WHERE r.starts_at BETWEEN clock_timestamp()-interval '3 hours' AND clock_timestamp()+interval '2 days' ORDER BY r.starts_at LIMIT 30`)).rows
  .map(r=>({id:r.id,code:code(r.id),tableLabel:r.label,partySize:r.party_size,startsAt:r.starts_at.toISOString(),status:r.status,minutesToDeadline:r.mins})));
}

export interface FloorTable {id:string;label:string;state:'free'|'upcoming'|'check_in'|'seated';code:string|null;partySize:number|null;startsAt:string|null;
 checkInUntil:string|null;seatedUntil:string|null;laterToday:number;openOrders:number;devices:string[]}
/** The staff floor plan: every active table with what holds it now (same rules as the table screen), how many more
 * bookings it has today, open table orders and its BitPOS Minis. Times come from the database clock. */
export async function floorPlan(db:MetaDb,merchantId:string):Promise<FloorTable[]>{
 return db.tenant(merchantId,async c=>{
  const rows=(await c.query<{id:string;label:string;now:Date;rid:string|null;status:'HELD'|'CHECKED_IN'|null;starts_at:Date|null;party_size:number|null;later:number;orders:number;devices:string[]|null}>(
   `SELECT t.id,t.label,clock_timestamp() AS now,r.id AS rid,r.status,r.starts_at,r.party_size,
     (SELECT count(*)::int FROM meta_table_reservations x WHERE x.table_id=t.id AND x.status='HELD' AND x.starts_at>coalesce(r.starts_at,clock_timestamp())
       AND (x.starts_at AT TIME ZONE '${TZ}')::date=(clock_timestamp() AT TIME ZONE '${TZ}')::date) AS later,
     (SELECT count(*)::int FROM meta_cart_orders o WHERE o.table_id=t.id AND ((o.status='PAID' AND o.handed_over_at IS NULL) OR (o.status='PENDING' AND o.expires_at>clock_timestamp()))) AS orders,
     (SELECT array_agg(d.label ORDER BY d.label) FROM devices d WHERE d.table_id=t.id AND d.revoked_at IS NULL) AS devices
    FROM merchant_tables t LEFT JOIN LATERAL (SELECT r.id,r.status,r.starts_at,r.party_size FROM meta_table_reservations r WHERE r.table_id=t.id
      AND ((r.status='HELD' AND clock_timestamp()<=r.starts_at+interval '${CHECKIN_MINUTES} minutes' AND r.starts_at<=clock_timestamp()+interval '3 hours')
       OR (r.status='CHECKED_IN' AND clock_timestamp()<r.starts_at+interval '${SEATED_MINUTES} minutes'))
      ORDER BY (r.status='CHECKED_IN') DESC,r.starts_at LIMIT 1) r ON true
    WHERE t.retired_at IS NULL ORDER BY t.label LIMIT 40`)).rows;
  return rows.map(t=>{
   const iso=(ms:number)=>new Date(ms).toISOString(),now=t.now.getTime(),start=t.starts_at?.getTime()??0;
   const state=!t.rid?'free':t.status==='CHECKED_IN'?'seated':now>=start-CHECKIN_MINUTES*60_000?'check_in':'upcoming';
   return {id:t.id,label:t.label,state,code:t.rid?code(t.rid):null,partySize:t.party_size,startsAt:t.starts_at?iso(start):null,
    checkInUntil:t.rid?iso(start+CHECKIN_MINUTES*60_000):null,seatedUntil:t.status==='CHECKED_IN'?iso(start+SEATED_MINUTES*60_000):null,laterToday:t.later,openOrders:t.orders,devices:t.devices??[]};
  });
 });
}
