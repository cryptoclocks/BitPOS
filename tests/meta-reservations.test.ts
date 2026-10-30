// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Table booking by chat, tap check-in, lapse and blocking, against a disposable PostgreSQL with migrations
// 001–309. The model is stubbed or absent (free matcher): no Meta API credit. Queries run as `bitpos_app`.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {aesCmac,deriveTagKeys} from '../packages/meta-ai/src/ntag424';
import {handleMessengerEvents,handleTap,type IdentityDeps,type MetaDb} from '../apps/api/src/meta/identity';
import {parseMessengerWebhook} from '../apps/api/src/meta/messenger';
import {cancelReservation,parseBooking,requestBooking,screenTags,staffReservations,sweepLapsed,sweepReminders,tableScreen,linkPreorder,preorderNote,saveBookingSettings,resetBookingRequest,BookingSettingsError} from '../apps/api/src/meta/reservations';
import {inKitchen,listTapOrders,preordered} from '../apps/api/src/meta/staff';
import {screenKey} from '../apps/api/src/meta/screen';
import {serveMeta} from '../apps/api/src/meta/routes';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {handleAgentRequest,type ChatAgentDeps} from '../apps/api/src/meta/agent';
import type {EffectiveMenu} from '../apps/api/src/offers';

const url=process.env.META_TEST_DATABASE_URL;
const skip=!url&&'META_TEST_DATABASE_URL not set';
const B='00000000-0000-4000-8000-000000000002';
const M=randomUUID(),T1=randomUUID(),T2=randomUUID(),D1=randomUUID(),D2=randomUUID();
const PAGE=String(400_000_000_000+Math.floor(Math.random()*1e9)),PSID1=String(600_000_000+Math.floor(Math.random()*1e8)),PSID2=String(610_000_000+Math.floor(Math.random()*1e8));
const run=randomBytes(3).toString('hex'),TAG1=`res-a-${run}`,TAG2=`res-b-${run}`;
const UID1=('04'+randomBytes(6).toString('hex')).toUpperCase(),UID2=('04'+randomBytes(6).toString('hex')).toUpperCase();
const master=Buffer.from('0f1e2d3c4b5a69788796a5b4c3d2e1f0','hex');
const fallback={chosenBy:'fallback' as const,invocationId:null};
let admin:pg.Pool,app:pg.Pool,db:MetaDb,deps:IdentityDeps,L1:string,L2:string,cookie1:string,cookie2:string;
let counter=1;
const T0=Date.now();

function sun(tagId:string,uid:string){
 const c=counter++,keys=deriveTagKeys(master,tagId),u=Buffer.from(uid,'hex'),ctr=Buffer.from([c&0xff,(c>>8)&0xff,(c>>16)&0xff]);
 const ci=createCipheriv('aes-128-cbc',keys.metaReadKey,Buffer.alloc(16));ci.setAutoPadding(false);
 const e=Buffer.concat([ci.update(Buffer.concat([Buffer.from([0xc7]),u,ctr,Buffer.alloc(5,0x11)])),ci.final()]).toString('hex').toUpperCase();
 const full=aesCmac(aesCmac(keys.fileReadKey,Buffer.concat([Buffer.from('3cc300010080','hex'),u,ctr])),Buffer.alloc(0));
 return {e,m:Buffer.from([1,3,5,7,9,11,13,15].map(i=>full[i])).toString('hex').toUpperCase()};
}
const tap=(tag:string,uid:string,cookie:string|null)=>{const s=sun(tag,uid);return handleTap(deps,tag,s.e,s.m,cookie);};
const ALL_DAY=Object.fromEntries(['0','1','2','3','4','5','6'].map(d=>[d,[{opens:'00:00',closes:'23:59'}]]));
const bkkClock=async(offsetMin:number)=>(await admin.query<{d:string;t:string}>(`SELECT to_char(x,'YYYY-MM-DD') AS d,to_char(x,'HH24:MI') AS t FROM (SELECT (clock_timestamp()+make_interval(mins=>$1)) AT TIME ZONE 'Asia/Bangkok' AS x) s`,[offsetMin])).rows[0];
const session=async(link:string)=>{const token=randomBytes(32).toString('base64url');await admin.query("INSERT INTO meta_customer_sessions(merchant_id,link_id,token_sha256,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 day')",[M,link,createHash('sha256').update(token).digest()]);return token;};
const status=async(id:string)=>(await admin.query<{status:string}>('SELECT status FROM meta_table_reservations WHERE id=$1',[id])).rows[0].status;

before(async()=>{
 if(skip)return;
 admin=new pg.Pool({connectionString:url,max:2,options:'-c search_path=bitpos,public'});
 app=new pg.Pool({connectionString:url,max:4,options:'-c search_path=bitpos,public'});
 app.on('connect',c=>{c.query('SET ROLE bitpos_app');});
 db={query:(sql,params)=>app.query(sql,params as any[]),tenant:async(merchant,fn)=>{const c=await app.connect();try{await c.query('SET ROLE bitpos_app');await c.query('BEGIN');await c.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};
 deps={db,masterKey:master,publicOrigin:'https://pay.example.test'};
 await admin.query("INSERT INTO merchants(id,name,treasury) SELECT $1,'booking test shop',treasury FROM merchants WHERE id=$2",[M,B]);
 // Open all day so the timing tests do not depend on when they run; the hours test below sets its own week.
 await admin.query(`INSERT INTO merchant_opening_hours(merchant_id,time_zone,week) VALUES($1,'Asia/Bangkok',$2::jsonb)`,[M,JSON.stringify(ALL_DAY)]);
 await admin.query('INSERT INTO meta_booking_settings(merchant_id,slot_minutes,last_booking_before_close_minutes) VALUES($1,30,0)',[M]);
 await admin.query("INSERT INTO merchant_tables(merchant_id,id,label) VALUES($1,$2,'A1'),($1,$3,'A2')",[M,T1,T2]);
 await admin.query("INSERT INTO devices(merchant_id,id,label,table_id) VALUES($1,$2,'table A1',$3),($1,$4,'table A2',$5)",[M,D1,T1,D2,T2]);
 await admin.query('INSERT INTO meta_ntag_tags(tag_id,merchant_id,device_id,uid) VALUES($1,$2,$3,$4),($5,$2,$6,$7)',[TAG1,M,D1,UID1,TAG2,D2,UID2]);
 await admin.query("INSERT INTO meta_messenger_pages(page_id,merchant_id,page_username) VALUES($1,$2,'bookingshop')",[PAGE,M]);
 L1=(await admin.query<{id:string}>("INSERT INTO meta_customer_links(merchant_id,page_id,psid,consent_version) VALUES($1,$2,$3,'bitpos-meta-offers-v1') RETURNING id",[M,PAGE,PSID1])).rows[0].id;
 L2=(await admin.query<{id:string}>("INSERT INTO meta_customer_links(merchant_id,page_id,psid,consent_version) VALUES($1,$2,$3,'bitpos-meta-offers-v1') RETURNING id",[M,PAGE,PSID2])).rows[0].id;
 cookie1=await session(L1);cookie2=await session(L2);
});
after(async()=>{if(!skip){await admin.end();await app.end();}});

test('free matcher reads Thai and English booking phrases; nothing is guessed',()=>{
 const today='2026-10-30';
 assert.deepEqual(parseBooking('จองโต๊ะ 2 คน พรุ่งนี้ 1 ทุ่ม',today),{intent:true,fields:{date:'2026-10-31',time:'19:00',partySize:2}});
 assert.deepEqual(parseBooking('book a table for 4 people today 19:30',today).fields,{date:'2026-10-30',time:'19:30',partySize:4});
 assert.deepEqual(parseBooking('จอง บ่าย 2 3 ท่าน',today).fields,{date:null,time:'14:00',partySize:3});
 assert.deepEqual(parseBooking('อยากจองโต๊ะค่ะ',today),{intent:true,fields:{date:null,time:null,partySize:null}});
 assert.equal(parseBooking('ขอลาเต้ 1 แก้ว',today).intent,false);
});

test('ask back for the missing date/time; with a time the booking is made at once; clashes offer other times',{skip},async()=>{
 const a=await requestBooking(db,M,L1,{date:null,time:null,partySize:null},fallback);
 assert.equal(a.kind,'ask');assert.deepEqual((a as any).missing,['date','time']);
 const tomorrow=(await bkkClock(24*60)).d;
 const b=await requestBooking(db,M,L1,{date:tomorrow,time:null,partySize:3},fallback);
 assert.deepEqual([b.kind,(b as any).missing],['ask',['time']],'date and party remembered, time asked');
 const c=await requestBooking(db,M,L1,{date:null,time:'19:00',partySize:null},fallback);
 assert.equal(c.kind,'booked');
 assert.deepEqual([(c as any).reservation.partySize,(c as any).reservation.tableLabel],[3,'A1'],'merged with what was said before');
 const d=await requestBooking(db,M,L2,{date:tomorrow,time:'19:30',partySize:2},fallback);
 assert.deepEqual([d.kind,(d as any).reservation.tableLabel],['booked','A2'],'A1 clashes within 95 minutes, so A2');
 const e=await requestBooking(db,M,L2,{date:tomorrow,time:'19:15',partySize:2},fallback);
 assert.equal(e.kind,'full');assert.ok((e as any).alternatives.length>=1);
 const past=await bkkClock(-60);
 assert.deepEqual(await requestBooking(db,M,L2,{date:past.d,time:past.t,partySize:2},fallback),{kind:'invalid',reason:'PAST'});
 const far=await bkkClock(20*24*60);
 assert.deepEqual(await requestBooking(db,M,L2,{date:far.d,time:'12:00',partySize:2},fallback),{kind:'invalid',reason:'TOO_FAR'});
 // Cancel: only the booker (or staff), only while HELD.
 const id=(c as any).reservation.id;
 assert.equal(await cancelReservation(db,M,id,{linkId:L2}),null);
 assert.equal((await cancelReservation(db,M,id,{linkId:L1}))?.status,'CANCELLED');
 assert.equal(await cancelReservation(db,M,(d as any).reservation.id,{staff:true}).then(r=>r?.status),'CANCELLED');
});

test('tap: booker checks in inside the window; others (cookie or not) are refused while held; Messenger follows the same rule',{skip},async()=>{
 // Booked 30 minutes ahead: the table is not locked yet (the hold starts 5 minutes before), so anyone may use it.
 const later=await bkkClock(30);
 const early=await requestBooking(db,M,L1,{date:later.d,time:later.t,partySize:2},fallback);
 assert.equal(early.kind,'booked');const et=(early as any).reservation.tableLabel;
 const before=await tap(et==='A1'?TAG1:TAG2,et==='A1'?UID1:UID2,cookie2);
 assert.notEqual(before.kind,'reserved','not locked earlier than 5 minutes before the booked time');
 assert.equal(Date.parse((early as any).reservation.startsAt)-Date.parse((early as any).reservation.checkInFrom),5*60_000);
 await admin.query("UPDATE meta_table_reservations SET status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by='staff' WHERE id=$1",[(early as any).reservation.id]);
 const soon=await bkkClock(3);
 const r=await requestBooking(db,M,L1,{date:soon.d,time:soon.t,partySize:2},fallback);
 assert.equal(r.kind,'booked');const id=(r as any).reservation.id,table=(r as any).reservation.tableLabel;
 const tag=table==='A1'?TAG1:TAG2,uid=table==='A1'?UID1:UID2;
 const dev=table==='A1'?D1:D2;
 const shown=await tableScreen(db,M,dev);
 assert.deepEqual([shown?.state,shown?.partySize,shown?.tableLabel],['check_in',2,table],'the table screen counts down to the check-in deadline');
 assert.equal(Date.parse(shown!.checkInUntil!)-Date.parse(shown!.startsAt!),15*60_000);
 const other=await tap(tag,uid,cookie2);
 assert.deepEqual([other.kind,(other as any).status,(other as any).url],['reserved','HELD',null]);
 const anon=await tap(tag,uid,null);
 assert.equal(anon.kind,'reserved');assert.match((anon as any).url,/^https:\/\/m\.me\/bookingshop\?ref=/,'the booker can still prove who they are in Messenger');
 // In Messenger, another customer following that ref is told the table is held and is not bound to it.
 const ref=new URL((anon as any).url).searchParams.get('ref')!;
 const viaOther=await handleMessengerEvents(deps,parseMessengerWebhook({object:'page',entry:[{id:PAGE,messaging:[{sender:{id:PSID2},recipient:{id:PAGE},timestamp:T0+1,referral:{ref}}]}]}));
 assert.match((viaOther.outbox[0] as any).text,/reserved/);assert.equal(viaOther.offers.length,0);
 assert.equal(await status(id),'HELD');
 const mine=await tap(tag,uid,cookie1);
 assert.equal(mine.kind,'known');assert.deepEqual([(mine as any).checkedIn.tableLabel,(mine as any).checkedIn.justNow],[table,true]);
 assert.equal(await status(id),'CHECKED_IN');
 assert.equal((await tableScreen(db,M,dev))?.state,'seated');
 const seated=await tap(tag,uid,cookie2);
 assert.deepEqual([seated.kind,(seated as any).status],['reserved','CHECKED_IN'],'while the booker is seated, others are still refused');
 const list=await staffReservations(db,M);
 assert.equal(list.find(x=>x.id===id)?.status,'CHECKED_IN');
 await admin.query("UPDATE meta_table_reservations SET status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by='staff',checked_in_at=NULL,tap_session_id=NULL WHERE id=$1",[id]);

 assert.equal((await tableScreen(db,M,dev))?.state,'free');
});

test('lapse: no check-in within 15 minutes → NO_SHOW once, customer told, table free again',{skip},async()=>{
 const id=(await admin.query<{id:string}>("INSERT INTO meta_table_reservations(merchant_id,link_id,table_id,party_size,starts_at,chosen_by,created_at) VALUES($1,$2,$3,2,clock_timestamp()-interval '20 minutes','fallback',clock_timestamp()-interval '2 hours') RETURNING id",[M,L1,T1])).rows[0].id;
 const notices=await sweepLapsed(db);
 const mine=notices.filter(n=>n.merchantId===M);
 assert.equal(mine.length,1);assert.equal(mine[0].psid,PSID1);assert.match(mine[0].text,/lapsed/);
 assert.equal(await status(id),'NO_SHOW');
 assert.equal((await sweepLapsed(db)).filter(n=>n.merchantId===M).length,0,'told once');
 const t=await tap(TAG1,UID1,cookie2);
 assert.equal(t.kind,'known','the lapsed table is free for anyone');
});

test('reminder: 5 minutes before the booked time the customer is reminded once; not earlier',{skip},async()=>{
 const ins=(mins:number)=>admin.query<{id:string}>(`INSERT INTO meta_table_reservations(merchant_id,link_id,table_id,party_size,starts_at,chosen_by) VALUES($1,$2,$3,2,clock_timestamp()+interval '${mins} minutes','fallback') RETURNING id`,[M,L1,T1]).then(r=>r.rows[0].id);
 const later=await ins(30);
 assert.equal((await sweepReminders(db)).filter(n=>n.merchantId===M).length,0,'30 minutes ahead: no reminder yet');
 await admin.query("UPDATE meta_table_reservations SET status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by='staff' WHERE id=$1",[later]);
 const soon=await ins(4);
 const mine=(await sweepReminders(db)).filter(n=>n.merchantId===M);
 assert.equal(mine.length,1);assert.equal(mine[0].psid,PSID1);assert.match(mine[0].text,/อีก 5 นาที/);assert.match(mine[0].text,/check in/);
 assert.equal((await sweepReminders(db)).filter(n=>n.merchantId===M).length,0,'reminded once');
 await admin.query("UPDATE meta_table_reservations SET status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by='staff' WHERE id=$1",[soon]);
});

test('ask time: only free future times are offered, as quick replies',{skip},async()=>{
 await admin.query("UPDATE meta_table_reservations SET status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by='staff' WHERE merchant_id=$1 AND status='HELD'",[M]);
 await resetBookingRequest(db,M,L2);
 const today=(await bkkClock(0)).d,later=(await bkkClock(2*24*60)).d;
 const r=await requestBooking(db,M,L2,{date:later,time:null,partySize:2},fallback);
 assert.equal(r.kind,'ask');const times=(r as any).times as string[];
 assert.deepEqual(times.slice(0,3),['00:00','00:30','01:00']);assert.ok(times.length<=12);
 const t=await requestBooking(db,M,L2,{date:today,time:null,partySize:2},fallback);
 const now=(await bkkClock(10)).t;
 assert.ok(((t as any).times as string[]).every(x=>x>now),'today: nothing in the past');
 await resetBookingRequest(db,M,L2);
});

test('shop hours: slots follow the week and settings; closed days and times outside hours are refused with the hours',{skip},async()=>{
 const tomorrow=(await bkkClock(24*60)).d,dow=String(new Date(tomorrow+'T00:00:00Z').getUTCDay());
 const week={...ALL_DAY,[dow]:[{opens:'11:00',closes:'14:00'},{opens:'17:00',closes:'22:00'}]};
 await saveBookingSettings(db,M,randomUUID(),{week,slotMinutes:60,lastBeforeCloseMinutes:90});
 await resetBookingRequest(db,M,L2);
 const a=await requestBooking(db,M,L2,{date:tomorrow,time:null,partySize:2},fallback);
 assert.deepEqual((a as any).times,['11:00','12:00','17:00','18:00','19:00','20:00'],'60-minute slots, last start 90 minutes before each close');
 const late=await requestBooking(db,M,L2,{date:tomorrow,time:'21:00',partySize:2},fallback);
 assert.deepEqual([late.kind,(late as any).reason,(late as any).hours],['invalid','OUTSIDE_HOURS','11:00-12:30, 17:00-20:30']);
 await saveBookingSettings(db,M,randomUUID(),{week:{...ALL_DAY,[dow]:[]},slotMinutes:30,lastBeforeCloseMinutes:0});
 const closed=await requestBooking(db,M,L2,{date:tomorrow,time:'19:00',partySize:2},fallback);
 assert.deepEqual([closed.kind,(closed as any).reason],['invalid','CLOSED_DAY']);
 assert.equal(((await requestBooking(db,M,L2,{date:tomorrow,time:null,partySize:2},fallback)) as any).closed,true);
 await assert.rejects(saveBookingSettings(db,M,randomUUID(),{week:ALL_DAY,slotMinutes:20,lastBeforeCloseMinutes:0}),BookingSettingsError);
 await saveBookingSettings(db,M,randomUUID(),{week:ALL_DAY,slotMinutes:30,lastBeforeCloseMinutes:0});
 await resetBookingRequest(db,M,L2);
});

test('pre-order: paid while holding a booking in the next 12 hours → kept out of the kitchen until check-in; no refund on lapse; cancelling frees the time',{skip},async()=>{
 const soon=await bkkClock(60);
 await resetBookingRequest(db,M,L1);
 const r=await requestBooking(db,M,L1,{date:soon.d,time:soon.t,partySize:2},fallback);
 if(r.kind!=='booked'){assert.fail(`not booked: ${r.kind}`);}
 const res=r.reservation;
 const order=async()=>(await admin.query<{id:string}>(`INSERT INTO meta_cart_orders(merchant_id,channel,link_id,access_sha256,status,currency,amount_minor,stripe_payment_intent_id,paid_at,paid_source,expires_at)
  VALUES($1,'web',$2,sha256('x'::bytea),'PAID','thb',12000,'pi_test1',clock_timestamp(),'webhook',clock_timestamp()+interval '30 minutes') RETURNING id`,[M,L1])).rows[0].id;
 const id=await order();
 const linked=await db.tenant(M,c=>linkPreorder(c,id));
 assert.equal(linked?.tableLabel,res.tableLabel);
 const note=await db.tenant(M,c=>preorderNote(c,'meta_cart_orders',id));
 assert.match(note!.text,/ไม่คืนเงิน/);assert.match(note!.subtitle,/Pre-order/);
 const me={merchantId:M,userId:randomUUID(),role:'owner' as const,sessionId:'s'};
 const staffDeps={db,config:{} as any};
 let o=(await listTapOrders(staffDeps,me)).find(x=>x.id===id)!;
 assert.deepEqual([inKitchen(o),preordered(o),o.booking?.status,o.booking?.tableLabel],[false,true,'HELD',res.tableLabel],'pre-order waits outside the kitchen queue');
 // Check-in (a real tap, covered by the tap test) turns the booking CHECKED_IN, which moves it into the kitchen queue.
 const seated={...o,booking:{...o.booking!,status:'CHECKED_IN' as const}};
 assert.deepEqual([inKitchen(seated),preordered(seated)],[true,false],'check-in moves it into the kitchen queue');
 await admin.query("UPDATE meta_table_reservations SET status='NO_SHOW' WHERE id=$1",[res.id]);
 o=(await listTapOrders(staffDeps,me)).find(x=>x.id===id)!;
 assert.deepEqual([o.status,inKitchen(o),o.booking?.status],['PAID',false,'NO_SHOW'],'lapsed: still paid (no refund), not cooked');
 // An order with no held booking soon is a normal kitchen order.
 const plain=await order();assert.equal(await db.tenant(M,c=>linkPreorder(c,plain)),null);
 // Cancelling a booking frees its time for someone else.
 await admin.query("UPDATE meta_cart_orders SET status='CANCELLED',cancelled_at=clock_timestamp() WHERE id=ANY($1)",[[id,plain]]);
 const later=await bkkClock(180);await resetBookingRequest(db,M,L1);await resetBookingRequest(db,M,L2);
 const tables=Number((await admin.query("SELECT count(*) FROM merchant_tables WHERE merchant_id=$1 AND retired_at IS NULL",[M])).rows[0].count);
 const mine:string[]=[];
 for(let i=0;i<tables;i++){const b=await requestBooking(db,M,L1,{date:later.d,time:later.t,partySize:2},fallback);if(b.kind==='booked')mine.push(b.reservation.id);}
 assert.equal((await requestBooking(db,M,L2,{date:later.d,time:later.t,partySize:2},fallback)).kind,'full');
 assert.ok(await cancelReservation(db,M,mine[0],{linkId:L1}));
 assert.equal((await requestBooking(db,M,L2,{date:later.d,time:later.t,partySize:2},fallback)).kind,'booked','the cancelled time is bookable again');
 await admin.query("UPDATE meta_table_reservations SET status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by='staff' WHERE merchant_id=$1 AND status='HELD'",[M]);
});

test('chat: "จองโต๊ะ…" books through the agent without a model; Book menu asks back; model step fields are used',{skip},async()=>{
 const menu=async()=>({merchant:{id:M,name:'x'},asOf:new Date().toISOString(),priceValidUntil:new Date(Date.now()+3600e3).toISOString(),menuVersion:'v',priceVersion:null,pricingRevision:'1',currency:null,decimals:null,
  products:[{id:randomUUID(),catalogKey:null,name:'ลาเต้',nameEn:'Latte',emoji:'🥛',available:5,imageUrl:null,category:null,description:null,basePrice:{currency:'USD',decimals:2,amountMinor:'500'},unitPrice:{currency:'USD',decimals:2,amountMinor:'500'},promotion:null}]}) as unknown as EffectiveMenu;
 const chat:ChatAgentDeps={db,offers:{menu,router:null},stripe:null,router:null,publicOrigin:'https://pay.example.test'};
 const ask=await handleAgentRequest(chat,{merchantId:M,linkId:L2,psid:PSID2,kind:'book_start'}) as any[];
 assert.equal(ask[0].kind,'buttons');assert.match(ask[0].buttons[0].payload,/^BITPOS_BOOK_SET:date:/);
 const day=(await bkkClock(2*24*60)).d,[dd,mm]=[day.slice(8),day.slice(5,7)];
 const booked=await handleAgentRequest(chat,{merchantId:M,linkId:L2,psid:PSID2,kind:'text',text:`จองโต๊ะ 4 คน ${Number(dd)}/${Number(mm)} 12:30`}) as any[];
 assert.match(booked[0].text,/Booked/);assert.equal(booked[1].kind,'cards');assert.match(booked[1].cards[0].title,/4 คน/);
 assert.match(booked[1].cards[0].buttons[0].payload,/^BITPOS_BOOK_CANCEL:/);
 const mine=await handleAgentRequest(chat,{merchantId:M,linkId:L2,psid:PSID2,kind:'my_orders'}) as any[];
 assert.ok(mine[1].cards.every((c:any)=>/^🗓️ #/.test(c.title)));assert.ok(mine[1].cards.some((c:any)=>c.buttons[0]?.payload===booked[1].cards[0].buttons[0].payload),'held booking can be cancelled from My orders');
 const rid=booked[1].cards[0].buttons[0].payload.split(':')[1];
 // A paid pre-order on the booking: the first cancel only warns (no refund) and asks to confirm.
 await admin.query(`INSERT INTO meta_cart_orders(merchant_id,channel,link_id,access_sha256,status,currency,amount_minor,stripe_payment_intent_id,paid_at,paid_source,expires_at,reservation_id)
  VALUES($1,'web',$2,sha256('y'::bytea),'PAID','thb',9000,'pi_test2',clock_timestamp(),'webhook',clock_timestamp()+interval '30 minutes',$3)`,[M,L2,rid]);
 const warn=await handleAgentRequest(chat,{merchantId:M,linkId:L2,psid:PSID2,kind:'book_cancel',reservationId:rid,confirmed:false}) as any[];
 assert.match(warn[0].text,/ไม่คืนเงิน/);assert.equal(warn[0].buttons[0].payload,`BITPOS_BOOK_CANCEL_OK:${rid}`);
 assert.equal(await status(rid),'HELD','not cancelled before the customer confirms');
 const cancel=await handleAgentRequest(chat,{merchantId:M,linkId:L2,psid:PSID2,kind:'book_cancel',reservationId:rid,confirmed:true}) as any[];
 assert.match(cancel[0].text,/cancelled/);assert.match(cancel[0].text,/not refunded/);
 // With a model: its extracted fields go to the same booking path (stubbed; no credit used).
 const router={invoke:async()=>({value:{action:'book',productId:'none',quantity:1,bookingDate:day,bookingTime:'15:00',partySize:2,replyTh:'ได้เลยค่ะ',replyEn:'Sure'},invocation:{id:randomUUID()},attempts:[]})} as any;
 await admin.query("INSERT INTO meta_ai_invocations(merchant_id,id,task,provider,model,weights,location,outcome,latency_ms,input_sha256,started_at) VALUES($1,$2,'agent_order','meta_api','m','closed','cloud','PROVIDER_TIMEOUT',1,$3,clock_timestamp())",[M,randomUUID(),'0'.repeat(64)]);
 const viaModel=await handleAgentRequest({...chat,router:{invoke:async(req:any)=>{const r=await router.invoke(req);await admin.query("INSERT INTO meta_ai_invocations(merchant_id,id,task,provider,model,weights,location,outcome,latency_ms,input_sha256,output_sha256,started_at) VALUES($1,$2,'agent_order','meta_api','m','closed','cloud','OK',1,$3,$3,clock_timestamp())",[M,r.invocation.id,'1'.repeat(64)]);return r;}} as any},{merchantId:M,linkId:L1,psid:PSID1,kind:'text',text:'อยากจองบ่ายสามมะรืนนี้สองคน'}) as any[];
 assert.match(viaModel[0].text,/Booked/);assert.match(viaModel[0].text,/Muse Spark/);
 const row=(await admin.query("SELECT chosen_by,invocation_id IS NOT NULL AS inv FROM meta_table_reservations WHERE link_id=$1 ORDER BY created_at DESC LIMIT 1",[L1])).rows[0];
 assert.deepEqual([row.chosen_by,row.inv],['model',true]);
});

test('table screen page: needs the derived key; shows no personal data; counts down with a nonce script',{skip},async()=>{
 const later=await bkkClock(60);
 const r=await requestBooking(db,M,L2,{date:later.d,time:later.t,partySize:4},fallback);
 assert.equal(r.kind,'booked');const id=(r as any).reservation.id,table=(r as any).reservation.tableLabel,tag=table==='A1'?TAG1:TAG2;
 const server=http.createServer(async(req,res)=>{if(!(await serveMeta(req,res,{identity:deps,messenger:null,offers:null}))){res.writeHead(404);res.end();}});
 await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/meta/screen/${tag}`;
 try{
  const ok=await fetch(`${base}?k=${screenKey(master,tag)}`);
  assert.equal(ok.status,200);
  const nonce=/script-src 'nonce-([^']+)'/.exec(ok.headers.get('content-security-policy')??'')?.[1];assert.ok(nonce);
  const html=await ok.text();
  assert.match(html,new RegExp(`<script nonce="${nonce.replace(/[+/=]/g,c=>'\\'+c)}">`));
  assert.match(html,/จองไว้/);assert.match(html,/Reserved for 4/);assert.match(html,/data-target=/);
  assert.doesNotMatch(html,new RegExp(PSID2));
  assert.equal((await fetch(`${base}?k=${'A'.repeat(22)}`)).status,404,'wrong key');
  assert.equal((await fetch(base)).status,404,'no key');
  assert.deepEqual((await screenTags(db,M)).map(t=>t.tagId).sort(),[TAG1,TAG2].sort(),'staff page lists each sticker table');
  assert.equal((await fetch(`${base.replace(tag,'no-such-tag')}?k=${screenKey(master,'no-such-tag')}`)).status,404,'unknown tag');
 }finally{server.close();await admin.query("UPDATE meta_table_reservations SET status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by='staff' WHERE id=$1",[id]);}
});
