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
import {cancelReservation,parseBooking,requestBooking,screenTags,staffReservations,sweepLapsed,tableScreen} from '../apps/api/src/meta/reservations';
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
 const cancel=await handleAgentRequest(chat,{merchantId:M,linkId:L2,psid:PSID2,kind:'book_cancel',reservationId:booked[1].cards[0].buttons[0].payload.split(':')[1]}) as any[];
 assert.match(cancel[0].text,/cancelled/);
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
