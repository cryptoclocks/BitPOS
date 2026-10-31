// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// meta-pos staff pages following design/figcraft-meta MP02–MP23: overview, counter sale (Stripe QR), kitchen,
// bookings, menu and stock, customers, Muse Connector, reports, settings and order detail. Every request re-reads
// the member's role; owner/manager-only actions are checked here. Orders, prices and payment state come from the
// server; nothing here marks an order paid.
import type http from 'node:http';
import {randomUUID} from 'node:crypto';
import QRCode from 'qrcode';
import type {MetaRouteDeps} from './routes';
import {formatTapAmount,inKitchen,listTapOrders,pickupCode,preordered,type StaffDeps,type StaffOrder,type StaffView} from './staff';
import {samCount} from './vision';
import {askOwnerAssistant} from './owner-assistant';
import {DEFAULT_COVER,LookError,PRESETS,saveLook,shopLook} from './look';
import {BookingSettingsError,bookingSettings,floorPlan,saveBookingSettings,screenTags,staffReservations,type FloorTable} from './reservations';
import {screenKey} from './screen';
import {listMenu} from './agent-orders';
import {cartForStaff,CartError,refundCart,startCart,type CartLine} from './cart';
import {agentDepsOf} from './shop';
import {CHANNEL,esc,photo,pill,row,staffHtml} from './ui';
import {L,nm,staffLang} from './staff-i18n';
import {listPayouts} from './stripe';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STATUS:Record<string,[string,string]>={PAID:['จ่ายแล้ว','gr'],CREATED:['รอจ่าย','am'],EXPIRED:['หมดเวลา','mu'],FAILED:['ไม่สำเร็จ','rd'],CANCELLED:['ยกเลิก/คืนเงิน','rd']};
const t=(iso:string|null)=>iso?new Date(iso).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'}):'';
const money=(minor:bigint|string|number,currency='usd')=>formatTapAmount(String(minor),currency);
const chan=(c:string)=>{const [l,tone]=CHANNEL[c]??[c,'mu'];return pill(l,tone);};
const st=(s:string,handed:string|null)=>handed?pill('ส่งมอบแล้ว','mu'):pill(...(STATUS[s]??[s,'mu']) as [string,string]);

async function body(req:http.IncomingMessage):Promise<URLSearchParams|null>{
 const parts:Buffer[]=[];let n=0;for await(const c of req){n+=c.length;if(n>8192)return null;parts.push(c);}
 return new URLSearchParams(Buffer.concat(parts).toString('utf8'));
}
/** The shop-look form carries resized images as data URLs, so it may be up to ~6 MB. */
async function bigBody(req:http.IncomingMessage):Promise<URLSearchParams|null>{
 const parts:Buffer[]=[];let n=0;for await(const c of req){n+=c.length;if(n>6_000_000)return null;parts.push(c);}
 return new URLSearchParams(Buffer.concat(parts).toString('utf8'));
}
const go=(res:http.ServerResponse,to:string)=>{res.writeHead(303,{Location:to,'Cache-Control':'no-store'});res.end();};
function orderTable(orders:StaffOrder[],empty='ยังไม่มีออเดอร์ใน 24 ชั่วโมง'):string{
 if(!orders.length)return `<div class="card mu">${empty}</div>`;
 return `<table><tr><th>รหัส</th><th>รายการ</th><th>ช่องทาง</th><th>ยอด</th><th>สถานะ</th><th>เวลา</th></tr>${orders.map(o=>`<tr class="click"><td><a href="/meta/staff/order/${o.id}"><b>#${esc(o.code)}</b></a></td>
<td>${esc(o.emoji)} ${esc(nm(o.name,o.nameEn))}${o.stockShort?' '+pill('สต็อกไม่พอ','rd'):''}</td><td>${chan(o.channel)}</td><td>${esc(money(o.amountMinor,o.currency))}</td><td>${st(o.status,o.handedOverAt)}</td><td>${t(o.paidAt??o.createdAt)}</td></tr>`).join('')}</table>`;
}
const handover=(o:StaffOrder)=>o.status==='PAID'&&!o.handedOverAt?`<form method="post" action="/meta/staff/orders/${o.id}/handover"><button class="inline">ส่งมอบแล้ว #${esc(o.code)}</button></form>`:'';

/** Returns true when it answered the request. */
export async function servePos(req:http.IncomingMessage,res:http.ServerResponse,deps:MetaRouteDeps,staff:StaffDeps,whoami:()=>Promise<StaffView|null>,url:URL,log:(m:string)=>void):Promise<boolean>{
 const path=url.pathname,method=req.method??'GET';
 const known=path==='/meta/staff'||/^\/meta\/staff\/(overview|counter|kitchen|bookings|menu|customers|connector|reports|payouts|users|settings|order|stockcount|assistant)(\/|$)/.test(path);
 if(!known)return false;
 const me=await whoami();
 if(!me){go(res,'/meta/staff');return true;}
 try{return await pages(req,res,deps,staff,me,url,log);}
 catch{
  log('Staff page failed');
  if(!res.headersSent){res.writeHead(500,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(staffHtml({title:'ระบบขัดข้อง',active:'/meta/staff',role:me.role,shop:''},'<div class="card">ลองอีกครั้ง หรือกลับไปที่ศูนย์ออเดอร์</div><a class="btn g inline" href="/meta/staff">← ศูนย์ออเดอร์</a>'));}
  return true;
 }
}

async function pages(req:http.IncomingMessage,res:http.ServerResponse,deps:MetaRouteDeps,staff:StaffDeps,me:StaffView,url:URL,log:(m:string)=>void):Promise<boolean>{
 const path=url.pathname,method=req.method??'GET';
 const db=deps.identity.db,agent=agentDepsOf(deps),boss=me.role!=='staff';
 const shop=(await db.tenant(me.merchantId,c=>c.query<{name:string}>('SELECT name FROM merchants WHERE id=$1',[me.merchantId]))).rows[0]?.name??'';
 const send=(status:number,active:string,title:string,html:string,o:{sub?:string;actions?:string;refresh?:number;script?:string}={})=>{
  const nonce=o.script?randomUUID().replace(/-/g,''):'';
  res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':`default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data: blob:; form-action 'self'${nonce?`; script-src 'nonce-${nonce}'`:''}`,
   'Referrer-Policy':'same-origin','X-Content-Type-Options':'nosniff',...(o.refresh?{Refresh:String(o.refresh)}:{})});
  res.end(staffHtml({title,active,role:me.role,shop,sub:o.sub,actions:o.actions,nonce:nonce||undefined,script:o.script},html));return true;
 };
 const ownerOnly=()=>send(403,'/meta/staff/overview','ต้องเป็นเจ้าของหรือผู้จัดการ',`<div class="card">ทำได้เฉพาะเจ้าของหรือผู้จัดการ / Owner or manager only.</div><a class="btn g inline" href="/meta/staff">← ออเดอร์</a>`);

 if(path==='/meta/staff'&&method==='GET'){
  const all=await listTapOrders(staff,me),ch=url.searchParams.get('ch')??'',done=url.searchParams.get('done');
  const groups:[string,string][]=[['','ทั้งหมด'],['tap','แตะ NFC'],['chat','แชท'],['agent','AI agent'],['table','สั่งที่โต๊ะ'],['counter','หน้าร้าน'],['web','เว็บ']];
  const chips=`<div class="chips">${groups.map(([k,l])=>`<a class="pill${k===ch?'':' mu'}" href="/meta/staff${k?`?ch=${k}`:''}">${esc(l)} ${all.filter(o=>!k||o.channel===k).length}</a>`).join('')}</div>`;
  const shown=all.filter(o=>!ch||o.channel===ch),waiting=shown.filter(inKitchen);
  return send(200,'/meta/staff','ศูนย์ออเดอร์',`${done&&/^[0-9A-F]{4}$/.test(done)?`<div class="note" style="background:var(--grb);color:var(--gr)">ส่งมอบ #${esc(done)} แล้ว ✓</div>`:''}${chips}
${waiting.length?`<div class="card"><h2>รอส่งมอบ ${waiting.length}</h2>${waiting.map(handover).join('')}</div>`:''}${orderTable(shown)}`,
   {sub:L('ทุกช่องทาง 24 ชม. · รีเฟรชทุก 10 วินาที · จ่ายแล้วจาก Stripe เท่านั้น · ไม่แสดงรหัส Messenger','All channels, last 24 h · refreshes every 10 s · paid only when Stripe confirms · no Messenger IDs shown'),refresh:10,actions:'<a class="btn" href="/meta/staff/counter">ขายหน้าร้าน</a>'});
 }
 if(path==='/meta/staff/overview'){
  const today=`date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok'`;
  const r=await db.tenant(me.merchantId,async c=>({
   ch:(await c.query<{channel:string;n:string;paid:string;sum:string|null}>(`SELECT channel,count(*)::text AS n,count(*) FILTER (WHERE status IN ('PAID','CONFIRMED'))::text AS paid,sum(amount_minor) FILTER (WHERE status IN ('PAID','CONFIRMED'))::text AS sum
     FROM bitpos.meta_order_feed(${today}) WHERE platform='meta' GROUP BY channel`)).rows,
   bookings:(await c.query<{status:string;n:string}>(`SELECT status,count(*)::text AS n FROM meta_table_reservations WHERE starts_at>=${today} AND starts_at<${today}+interval '1 day' GROUP BY status`)).rows,
   drafts:Number((await c.query<{n:string}>("SELECT count(*)::text AS n FROM meta_offer_drafts WHERE state='DRAFT' AND expires_at>clock_timestamp()")).rows[0].n),
   ai:Number((await c.query<{n:string}>(`SELECT count(*)::text AS n FROM meta_ai_invocations WHERE started_at>=${today}`)).rows[0].n)}));
  const orders=await listTapOrders(staff,me);
  const sum=r.ch.reduce((a,x)=>a+BigInt(x.sum??'0'),0n),paid=r.ch.reduce((a,x)=>a+Number(x.paid),0),max=Math.max(1,...r.ch.map(x=>Number(x.paid)));
  const b=Object.fromEntries(r.bookings.map(x=>[x.status,Number(x.n)])),waiting=orders.filter(inKitchen),ahead=orders.filter(preordered);
  const html=`<div class="grid g4">${[['ยอดขายวันนี้ (Stripe)',money(sum),`${paid} ออเดอร์ที่จ่ายแล้ว`,'p'],['แตะ NFC',r.ch.find(x=>x.channel==='tap')?.n??'0','ออเดอร์จากการแตะ',''],
   [L('แชท และ AI','Chat & AI'),String(Number(r.ch.find(x=>x.channel==='chat')?.n??0)+Number(r.ch.find(x=>x.channel==='mcp')?.n??0)),L(`Muse Spark วันนี้ ${r.ai} ครั้ง`,`Muse Spark calls today: ${r.ai}`),''],['การจองวันนี้',String(Object.values(b).reduce((a,n)=>a+n,0)),`เช็กอิน ${b.CHECKED_IN??0} · หลุดคิว ${b.NO_SHOW??0}`,'']]
   .map(([a,v,s,c])=>`<div class="met ${c}"><small>${a}</small><b>${esc(v)}</b><small>${esc(s)}</small></div>`).join('')}</div>
<div class="grid g2" style="margin-top:14px"><div class="card"><h2>ยอดที่จ่ายแล้วตามช่องทาง</h2>${['tap','chat','mcp','table','counter','web'].map(k=>{const n=Number(r.ch.find(x=>x.channel===k)?.paid??0);return `<div style="display:flex;gap:10px;align-items:center;margin:10px 0"><span style="width:130px">${chan(k)}</span><span class="barh" style="flex:1"><i style="width:${Math.round(n/max*100)}%"></i></span><b>${n}</b></div>`;}).join('')}
<a href="/meta/staff/reports">ดูรายงานเต็ม →</a></div><div class="card"><h2>ต้องจัดการตอนนี้</h2>
${row({href:'/meta/staff/kitchen',icon:'🧾',title:`${waiting.length} ออเดอร์รอส่งมอบ`,sub:`จ่ายแล้ว · ทุกช่องทาง${ahead.length?` · ${L('สั่งล่วงหน้ารอเช็กอิน','pre-orders waiting')} ${ahead.length}`:''}`})}${row({href:'/meta/staff/bookings',icon:'🗓️',title:`${b.HELD??0} การจองรอเช็กอิน`,sub:'แตะเพื่อเช็กอิน -5/+15 นาที'})}
${row({href:'/meta/staff/offers',icon:'✨',title:`${r.drafts} ร่างโปรรออนุมัติ`,sub:'Muse Spark ร่าง · เจ้าของอนุมัติ'})}</div></div>
<h2 style="margin-top:20px">ออเดอร์ล่าสุด</h2>${orderTable(orders.slice(0,6))}<p><a href="/meta/staff">ทั้งหมด →</a></p>`;
  return send(200,path,'ภาพรวมวันนี้',html,{sub:'ข้อมูลจริงของร้านจาก meta_order_feed() · รีเฟรชทุก 30 วินาที',refresh:30,actions:'<a class="btn" href="/meta/staff/counter">ขายหน้าร้าน</a>'});
 }

 if(path==='/meta/staff/counter'&&method==='GET'){
  if(!agent)return send(503,path,'ขายหน้าร้าน','<div class="card">ระบบเมนูยังไม่พร้อม</div>');
  const menu=await listMenu(agent,me.merchantId);
  const devices=(await db.tenant(me.merchantId,c=>c.query<{id:string;label:string}>('SELECT id,label FROM devices WHERE revoked_at IS NULL ORDER BY label'))).rows;
  const tiles=menu.map(m=>`<label class="tile">${photo(m.imageUrl)?`<img src="${esc(photo(m.imageUrl)!)}" alt="">`:''}<div><b>${esc(nm(m.name,m.nameEn))}</b><br><small>${esc(m.price.display)}${m.offer?` · −${m.offer.discountPercent}%`:''}</small>
<select name="q_${m.productId}"${m.payable?'':' disabled'}>${[0,1,2,3,4,5].map(n=>`<option value="${n}">${n?`× ${n}`:'—'}</option>`).join('')}</select></div></label>`).join('');
  return send(200,path,'ขายหน้าร้าน',`<form method="post" action="/meta/staff/counter"><div class="grid g4">${tiles}</div><div class="card"><label>แสดง QR บนเครื่อง BitPOS Mini</label><select name="device"><option value="">ไม่แสดง (ใช้จอนี้)</option>${devices.map((d,i)=>`<option value="${d.id}"${i===0?' selected':''}>${esc(d.label)}</option>`).join('')}</select>
<div class="note">ลูกค้าสแกน QR เพื่อจ่ายบน Stripe Checkout (sandbox) · ราคาจากเซิร์ฟเวอร์ · จ่ายแล้วจาก webhook เท่านั้น</div><button>${L('สร้างบิลและแสดง QR ของ Stripe','Create the bill and show the Stripe QR')}</button></div></form>`,
   {sub:'เลือกจำนวน → สร้างบิล → ลูกค้าสแกน QR บนจอ (หรือบน BitPOS Mini)'});
 }
 if(path==='/meta/staff/counter'&&method==='POST'){
  if(!agent)return send(503,path,'ขายหน้าร้าน','<div class="card">ระบบเมนูยังไม่พร้อม</div>');
  const f=await body(req);const lines:CartLine[]=[];
  for(const [k,v] of f??[]){const m=k.match(/^q_([0-9a-f-]{36})$/);const n=Number(v)|0;if(m&&UUID.test(m[1])&&n>0&&n<=20)lines.push({productId:m[1],quantity:n});}
  const device=f?.get('device')??'';
  const deviceId=UUID.test(device)&&(await db.tenant(me.merchantId,c=>c.query('SELECT 1 FROM devices WHERE id=$1 AND revoked_at IS NULL',[device]))).rowCount?device:null;
  try{const r=await startCart(agent,me.merchantId,lines,{channel:'counter',staffUserId:me.userId,deviceId,publicOrigin:deps.identity.publicOrigin});log('Counter bill started');go(res,`/meta/staff/counter/${r.orderId}`);return true;}
  catch(e){if(e instanceof CartError)return send(409,'/meta/staff/counter','สร้างบิลไม่ได้',`<div class="card">${e.code==='EMPTY'?'ยังไม่ได้เลือกเมนู':e.code==='BELOW_MINIMUM'?'ยอดต่ำกว่าขั้นต่ำของ Stripe ($0.50)':e.code==='OUT_OF_STOCK'?'บางเมนูหมด':e.code}</div><a class="btn g inline" href="/meta/staff/counter">← เลือกใหม่</a>`);throw e;}
 }
 const bill=path.match(/^\/meta\/staff\/counter\/([0-9a-f-]{36})$/);
 if(bill){
  const v=await cartForStaff(db,me.merchantId,bill[1]);
  if(!v)return send(404,'/meta/staff/counter','ไม่พบบิล','<div class="card">ไม่พบบิลนี้</div><a class="btn g inline" href="/meta/staff/counter">← ขายหน้าร้าน</a>');
  const lines=v.lines.map(l=>`<div class="tot"><span>${esc(l.emoji)} ${esc(nm(l.name,l.nameEn))} × ${l.quantity}</span><span>${esc(l.amount)}</span></div>`).join('');
  const qr=v.status==='PENDING'&&v.checkoutUrl?await QRCode.toString(`${deps.identity.publicOrigin}/pay/${v.orderId}`,{type:'svg',margin:1,errorCorrectionLevel:'M'}):'';
  const left=v.status==='PAID'?`<div class="qrbox"><div class="icon" style="background:var(--grb);margin:30px auto">✓</div><h1>จ่ายแล้ว</h1><div class="big">#${esc(v.code)}</div><small>Stripe webhook ยืนยันแล้ว</small></div>`
   :v.status==='PENDING'?`<div class="qrbox">${qr}<p><b>ลูกค้าสแกนเพื่อจ่ายบน Stripe Checkout</b></p><small>ลิงก์ใช้ได้ 30 นาที · ราคาล็อกตามบิล · หน้านี้รีเฟรชเอง</small></div>`
   :`<div class="qrbox"><h1>${v.status==='EXPIRED'?'บิลหมดเวลา':'ยกเลิกแล้ว'}</h1><small>ไม่มีการตัดเงิน</small></div>`;
  return send(200,'/meta/staff/counter',`บิล #${v.code} · ${v.total}`,`<div class="grid g2"><div>${left}</div><div class="card"><h2>รายการ ${st(v.status==='PENDING'?'CREATED':v.status,v.handedOverAt)}</h2>${lines}<hr style="border:0;border-top:1px solid var(--ln)"><div class="tot b"><span>รวม</span><span>${esc(v.total)}</span></div>
<p><a class="btn ${v.status==='PAID'?'':'g'} inline" href="/meta/staff/order/${v.orderId}">รายละเอียดออเดอร์</a><a class="btn g inline" href="/meta/staff/counter">บิลใหม่</a></p></div></div>`,{refresh:v.status==='PENDING'?3:undefined,sub:'หน้าร้าน · Stripe sandbox'});
 }

 if(path==='/meta/staff/kitchen'){
  const orders=await listTapOrders(staff,me),todo=orders.filter(inKitchen),ahead=orders.filter(preordered),done=orders.filter(o=>o.handedOverAt).slice(0,8);
  // Paid ahead for a booked table: not cooked until the customer taps in at the table (then it moves to the queue).
  const AHEAD:Record<string,[string,string]>={HELD:[L('รอเช็กอิน','Waiting for check-in'),'am'],NO_SHOW:[L('การจองหลุด · ไม่คืนเงิน','Booking lapsed · no refund'),'rd'],CANCELLED:[L('ยกเลิกการจอง · ไม่คืนเงิน','Booking cancelled · no refund'),'rd']};
  const pre=(o:StaffOrder)=>`<div class="row"><span class="ic">${esc(o.emoji||'☕')}</span><span class="t"><b>#${esc(o.code)} · ${esc(nm(o.name,o.nameEn))}</b><small>${L('สั่งล่วงหน้า · โต๊ะ','Pre-order · table')} ${esc(o.booking!.tableLabel)} · ${t(o.booking!.startsAt)} · ${pill(...(AHEAD[o.booking!.status]??[o.booking!.status,'mu']))}</small></span>${o.booking!.status==='HELD'?'':handover(o)}</div>`;
  const card=(o:StaffOrder)=>`<div class="row"><span class="ic">${esc(o.emoji||'☕')}</span><span class="t"><b>#${esc(o.code)} · ${esc(nm(o.name,o.nameEn))}</b><small>${chan(o.channel)} จ่าย ${t(o.paidAt)}${o.stockShort?' · '+pill('สต็อกไม่พอ','rd'):''}</small></span>${handover(o)}</div>`;
  return send(200,path,'คิวครัว',`<div class="grid g2"><div class="card"><h2>${pill('ต้องทำ / รอส่งมอบ','am')} ${todo.length}</h2>${todo.map(card).join('')||'<p class="mu">ไม่มีออเดอร์ค้าง</p>'}${ahead.length?`<h2 style="margin-top:18px">${pill(L('สั่งล่วงหน้า','Pre-orders'),'vi')} ${ahead.length}</h2><p class="mu">${L('เข้าคิวครัวเมื่อลูกค้าแตะเช็กอินที่โต๊ะ','Join the kitchen queue when the customer checks in at the table')}</p>${ahead.map(pre).join('')}`:''}</div>
<div class="card"><h2>${pill('ส่งมอบแล้ว','gr')}</h2>${done.map(o=>row({href:`/meta/staff/order/${o.id}`,icon:'✓',title:`#${o.code} · ${nm(o.name,o.nameEn)}`,sub:`${CHANNEL[o.channel]?.[0]??o.channel} · ${t(o.handedOverAt)}`})).join('')||'<p class="mu">ยังไม่มี</p>'}</div></div>`,{sub:'เรียงตามเวลาที่จ่าย · ทุกช่องทาง · รีเฟรชทุก 10 วินาที',refresh:10});
 }

 if(path==='/meta/staff/bookings'){
  const rows=await staffReservations(db,me.merchantId),tags=await screenTags(db,me.merchantId),floor=await floorPlan(db,me.merchantId);
  // Floor plan (like the POS shop floor): a room with window, coffee bar and entrance; each table shows what holds it now.
  const FS:Record<FloorTable['state'],[string,string]>={free:['ว่าง','free'],upcoming:['จองไว้','up'],check_in:['รอเช็กอิน','ci'],seated:['นั่งอยู่','seat']};
  const tile=(f:FloorTable)=>{const [lbl,cls]=FS[f.state];
   const line=f.state==='free'?(f.laterToday?`จองต่อวันนี้ ${f.laterToday}`:'พร้อมรับลูกค้า')
    :f.state==='seated'?`${f.partySize} คน · ถึง ${t(f.seatedUntil)}`:f.state==='check_in'?`${f.partySize} คน · เช็กอินภายใน ${t(f.checkInUntil)}`:`${t(f.startsAt)} · ${f.partySize} คน`;
   const seats=Math.min(6,Math.max(2,f.partySize??2));
   return `<a class="ftab ${cls}" href="#t-${f.id}" title="${esc(f.label)}"><span class="seats">${'<i></i>'.repeat(seats)}</span><span class="ftop"><b>${esc(f.label)}</b><span class="fst">${lbl}</span></span>
<span class="fl">${f.code?`#${esc(f.code)} · `:''}${esc(line)}</span><span class="fmeta">${f.devices.length?`<span>📟 ${esc(f.devices.join(', '))}</span>`:''}${f.openOrders?`<span class="fo">🧾 ${f.openOrders} ออเดอร์</span>`:''}${f.state!=='free'&&f.laterToday?`<span>+${f.laterToday} วันนี้</span>`:''}</span></a>`;};
  const count=(st:string)=>floor.filter(f=>f.state===st).length;
  const plan=`<div class="floorwrap"><div class="flegend">${(['free','upcoming','check_in','seated'] as const).map(k=>`<span class="lg ${FS[k][1]}"><i></i>${FS[k][0]} ${count(k)}</span>`).join('')}<span class="sp"></span><small class="mu">อัปเดตทุก 20 วินาที</small></div>
<div class="room"><div class="fwin">W I N D O W</div><div class="fbar"><span>☕ COFFEE BAR</span><i></i><i></i><i></i></div><div class="fplant a">🪴</div><div class="fplant b">🪴</div>
<div class="fgrid">${floor.map(tile).join('')||'<div class="card mu">ยังไม่มีโต๊ะ</div>'}</div><div class="fdoor">ENTRANCE</div></div></div>`;
  const label:Record<string,[string,string]>={HELD:['รอเช็กอิน','am'],CHECKED_IN:['เช็กอินแล้ว','gr'],NO_SHOW:['หลุดคิว','rd'],CANCELLED:['ยกเลิก','mu']};
  const dt=(iso:string)=>new Date(iso).toLocaleString('en-GB',{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'});
  const table=rows.length?`<table><tr><th>รหัส</th><th>โต๊ะ</th><th>เวลา</th><th>คน</th><th>สถานะ</th><th></th></tr>${rows.map(r=>`<tr id="t-${esc(floor.find(f=>f.label===r.tableLabel)?.id??'')}"><td><b>#${esc(r.code)}</b></td><td>${esc(r.tableLabel)}</td><td>${dt(r.startsAt)}</td><td>${r.partySize}</td>
<td>${pill(...(label[r.status]??[r.status,'mu']))}${r.status==='HELD'&&r.minutesToDeadline!==null?` <small>${r.minutesToDeadline} นาที</small>`:''}</td><td>${r.status==='HELD'?`<form method="post" action="/meta/staff/reservations/${r.id}/cancel"><button class="d inline">ยกเลิก</button></form>`:''}</td></tr>`).join('')}</table>`:`<div class="card mu">${L('ยังไม่มีการจองใน 2 วันนี้ · ลูกค้าจองผ่านแชทได้ด้วยคำว่า “จองโต๊ะ”','No bookings in the next 2 days · customers book in Messenger by saying “book a table”')}</div>`;
  const screens=tags.map(g=>`<a class="btn s inline" target="_blank" rel="noopener" href="${esc(`${deps.identity.publicOrigin}/meta/screen/${g.tagId}?k=${screenKey(deps.identity.masterKey,g.tagId)}`)}">🖥️ ${esc(g.tableLabel)}</a>`).join('');
  return send(200,path,'การจองโต๊ะ',`${plan}<h2 style="margin-top:20px">รายการจอง 2 วัน</h2>${table}<div class="card" style="margin-top:16px"><h2>จอโต๊ะ (นับถอยหลัง)</h2><small>เปิดบนแท็บเล็ตหรือมือถือที่ตั้งบนโต๊ะ · ลิงก์มีกุญแจของแต่ละโต๊ะ · ไม่มีข้อมูลส่วนตัว</small><p>${screens||'<span class="mu">ยังไม่มีโต๊ะที่มีสติกเกอร์</span>'}</p></div>`,
   {sub:'จองผ่านแชท · เช็กอินด้วยการแตะ -5/+15 นาที · หลุดคิวอัตโนมัติ',actions:'<a class="btn g inline" href="/meta/staff/bookings/hours">🕘 '+L('เวลารับจอง','Booking hours')+'</a>',refresh:20});
 }

 // Booking hours: the shop's opening hours per weekday (up to two windows; empty = closed) and the booking rules.
 if(path==='/meta/staff/bookings/hours'){
  const DAYS=[L('อาทิตย์','Sunday'),L('จันทร์','Monday'),L('อังคาร','Tuesday'),L('พุธ','Wednesday'),L('พฤหัสบดี','Thursday'),L('ศุกร์','Friday'),L('เสาร์','Saturday')];
  let error='';
  if(method==='POST'){
   if(!boss)return ownerOnly();
   const f=await body(req);
   const week=Object.fromEntries(DAYS.map((_,d)=>[String(d),[1,2].map(k=>({opens:f?.get(`o${d}_${k}`)??'',closes:f?.get(`c${d}_${k}`)??''})).filter(w=>w.opens||w.closes)]));
   try{await saveBookingSettings(db,me.merchantId,me.userId,{week,slotMinutes:Number(f?.get('slot')),lastBeforeCloseMinutes:Number(f?.get('last'))});log('Booking hours saved');go(res,'/meta/staff/bookings/hours?saved=1');return true;}
   catch(e){if(!(e instanceof BookingSettingsError))throw e;error=e.message;}
  }
  const v=await bookingSettings(db,me.merchantId);
  const tm=(n:string,val:string)=>`<input type="time" name="${n}" value="${esc(val)}"${boss?'':' disabled'} style="width:110px">`;
  const rows=DAYS.map((name,d)=>{const w=v.week[String(d) as '0']??[];
   return `<tr><td><b>${name}</b></td><td>${tm(`o${d}_1`,w[0]?.opens??'')} – ${tm(`c${d}_1`,w[0]?.closes??'')}</td><td>${tm(`o${d}_2`,w[1]?.opens??'')} – ${tm(`c${d}_2`,w[1]?.closes??'')}</td><td>${w.length?'':pill(L('ปิด','Closed'),'mu')}</td></tr>`;}).join('');
  const saved=(url.searchParams.get('saved')==='1'&&!error)?`<div class="card">${pill(L('บันทึกแล้ว','Saved'),'gr')} ${L('ปุ่มเวลาในแชทใช้ค่าใหม่ทันที','Chat time buttons use the new settings now')}</div>`:'';
  return send(error?400:200,'/meta/staff/bookings',L('เวลารับจองโต๊ะ','Booking hours'),`${saved}${error?`<div class="card">${pill(L('บันทึกไม่ได้','Not saved'),'rd')} ${esc(error)}</div>`:''}
<form method="post" action="/meta/staff/bookings/hours"><div class="card"><h2>${L('เวลาเปิด–ปิดร้าน','Opening hours')}</h2><small>${v.configured?L('ใช้ตารางเวลาเปิดปิดเดียวกับ POS','Shared with the POS opening hours'):L('ยังไม่ได้ตั้ง · ตอนนี้ใช้ 10:00–22:00 ทุกวัน','Not set · 10:00–22:00 every day for now')} · ${L('เว้นว่างทั้งแถว = ร้านปิดวันนั้น · ช่วงที่ 2 สำหรับร้านที่ปิดพักกลางวัน','an empty row = closed that day · the second window is for a midday break')}</small>
<table><tr><th>${L('วัน','Day')}</th><th>${L('ช่วงที่ 1','Window 1')}</th><th>${L('ช่วงที่ 2','Window 2')}</th><th></th></tr>${rows}</table></div>
<div class="grid g2"><div class="card"><label>${L('ระยะห่างระหว่างช่องเวลา','Time slot length')}</label><select name="slot"${boss?'':' disabled'}>${[15,30,60].map(n=>`<option value="${n}"${n===v.slotMinutes?' selected':''}>${n} ${L('นาที','min')}</option>`).join('')}</select></div>
<div class="card"><label>${L('รับจองถึงก่อนปิดกี่นาที','Last booking, minutes before closing')}</label><input type="number" name="last" min="0" max="240" step="5" value="${v.lastBeforeCloseMinutes}"${boss?'':' disabled'}><small>${L('เช่น 90 · ร้านปิด 22:00 จองได้ถึง 20:30','e.g. 90 · closes 22:00, last booking 20:30')}</small></div></div>
${boss?`<button class="inline">${L('บันทึก','Save')}</button>`:`<p class="mu">${L('เฉพาะเจ้าของหรือผู้จัดการแก้ได้','Owner or manager only')}</p>`}</form><p><a class="btn g inline" href="/meta/staff/bookings">← ${L('การจองโต๊ะ','Bookings')}</a></p>`,{sub:L('ลูกค้าเห็นเฉพาะเวลาที่ร้านเปิดและโต๊ะว่าง','Customers see only open hours with a free table')});
 }

 const stock=path.match(/^\/meta\/staff\/menu\/([0-9a-f-]{36})\/stock$/);
 if(stock&&method==='POST'){
  if(!boss)return ownerOnly();
  const f=await body(req);const n=Number(f?.get('stock'));
  if(!Number.isInteger(n)||n<0||n>100000)return send(400,'/meta/staff/menu','จำนวนไม่ถูกต้อง','<div class="card">ใส่จำนวน 0–100000</div><a class="btn g inline" href="/meta/staff/menu">← เมนู</a>');
  await db.tenant(me.merchantId,async c=>{
   const cur=(await c.query<{stock:number;reserved:number}>('SELECT stock,reserved FROM products WHERE id=$1 FOR UPDATE',[stock[1]])).rows[0];
   if(!cur||n<cur.reserved||n===cur.stock)return;
   await c.query('UPDATE products SET stock=$2 WHERE id=$1',[stock[1],n]);
   await c.query("INSERT INTO meta_stock_movements(merchant_id,product_id,delta,reason,order_kind,order_id) VALUES(current_setting('bitpos.merchant')::uuid,$1,$2,'staff_adjust','staff',$3)",[stock[1],n-cur.stock,randomUUID()]);
  });
  log('Stock counted');go(res,'/meta/staff/menu?saved=1');return true;
 }
 if(path==='/meta/staff/assistant'){
  // Owner's assistant: Muse Wonder with read-only tools over the shop's own numbers; the data behind every answer is shown.
  if(!boss)return ownerOnly();
  const ask=[L('วันนี้ขายดีกว่าเมื่อวานไหม','Did we sell more today than yesterday?'),L('เมนูไหนควรทำโปรสัปดาห์นี้','Which item should get an offer this week?'),L('ช่วงไหนคนเยอะ ควรเพิ่มคนกี่โมง','When are we busiest, and when do we need more staff?'),L('ช่องทางไหนขายดีที่สุด 7 วันนี้','Which channel sold best in the last 7 days?'),L('ของอะไรใกล้หมด','What is running low?')];
  const form=(qv='')=>`<form method="post" action="/meta/staff/assistant"><textarea name="q" rows="2" maxlength="500" placeholder="${esc(L('ถามเรื่องยอดขาย เมนู โปร คิว หรือสต็อก','Ask about sales, items, offers, busy hours or stock'))}" required>${esc(qv)}</textarea><button>✨ ${L('ถามผู้ช่วย','Ask the assistant')}</button></form>
<div class="chips" style="flex-wrap:wrap">${ask.map(a=>`<form method="post" action="/meta/staff/assistant"><input type="hidden" name="q" value="${esc(a)}"><button class="g inline">${esc(a)}</button></form>`).join('')}</div>`;
  const sub=L('Muse Wonder + tool calling · อ่านข้อมูลอย่างเดียว · ตัวเลขทุกตัวมาจากข้อมูลร้าน (แสดงด้านล่าง)','Muse Wonder + tool calling · read only · every number comes from the shop data shown below');
  if(method==='GET')return send(200,path,L('ผู้ช่วยเจ้าของร้าน','Owner assistant'),`<div class="card">${form()}</div>`,{sub});
  const f=await body(req);const qv=(f?.get('q')??'').trim().slice(0,500);
  if(!qv)return send(400,path,L('ผู้ช่วยเจ้าของร้าน','Owner assistant'),`<div class="card">${form()}</div>`,{sub});
  const router=deps.offers?.router;
  if(!router)return send(503,path,L('ผู้ช่วยเจ้าของร้าน','Owner assistant'),`<div class="card">${L('ยังไม่ได้ตั้งค่าโมเดล','No model configured')}</div>`,{sub});
  const table=(v:unknown):string=>Array.isArray(v)?(v.length?`<table><tr>${Object.keys(v[0]??{}).map(k=>`<th>${esc(k)}</th>`).join('')}</tr>${v.map(r=>`<tr>${Object.values(r??{}).map(x=>`<td>${esc(typeof x==='object'?JSON.stringify(x):String(x))}</td>`).join('')}</tr>`).join('')}</table>`:`<p class="mu">${L('ไม่มีข้อมูล','No data')}</p>`)
   :v&&typeof v==='object'?Object.entries(v).map(([k,x])=>`<h3 style="margin:10px 0 4px">${esc(k)}</h3>${table(x)}`).join(''):`<p>${esc(String(v))}</p>`;
  try{
   const a=await askOwnerAssistant(db,router,me.merchantId,qv);log(`Owner assistant answered (${a.model}, ${a.data.length} tools)`);
   const text=esc(a.text||L('ยังตอบไม่ได้','No answer')).replace(/\n/g,'<br>').replace(/\*\*(.+?)\*\*/g,'<b>$1</b>');
   return send(200,path,L('ผู้ช่วยเจ้าของร้าน','Owner assistant'),`<div class="card"><p class="mu">${esc(qv)}</p><div style="font-size:1.05rem;line-height:1.7">${text}</div><p>${pill(a.model,'vi')} ${pill(`${a.data.length} ${L('เครื่องมือ','tools')}`,'mu')}</p></div>
<div class="card"><h2>${L('ข้อมูลที่ผู้ช่วยใช้ (จากระบบ)','Data the assistant used (from the system)')}</h2>${a.data.map(d=>`<details open><summary><b>${esc(d.tool)}</b> <small>${esc(JSON.stringify(d.args))}</small></summary>${table(d.result)}</details>`).join('')||`<p class="mu">${L('ไม่ได้เรียกเครื่องมือ','No tools called')}</p>`}</div>
<div class="card">${form()}</div>`,{sub});
  }catch{log('Owner assistant failed');return send(502,path,L('ผู้ช่วยเจ้าของร้าน','Owner assistant'),`<div class="card">${L('ผู้ช่วยตอบไม่ได้ตอนนี้ ลองอีกครั้ง','The assistant could not answer; try again')}</div><div class="card">${form(qv)}</div>`,{sub});}
 }
 if(path==='/meta/staff/stockcount'){
  // Count stock from a photo of the display case with SAM 3.1; staff see the boxes and an owner/manager confirms.
  if(!agent)return send(503,path,'นับสต็อกจากรูป','<div class="card">ระบบเมนูยังไม่พร้อม</div>');
  const menu=await listMenu(agent,me.merchantId);
  const pick=`<form method="post" action="/meta/staff/stockcount" id="sf"><label>${L('เมนูที่จะนับ','Item to count')}</label><select name="id">${menu.map(m=>`<option value="${m.productId}">${esc(nm(m.name,m.nameEn))} · ${L('สต็อกตอนนี้','now')} ${m.available}</option>`).join('')}</select>
<input type="hidden" name="img" id="img"><input type="file" id="cam" accept="image/*" capture="environment" hidden><button type="button" id="shot">📷 ${L('ถ่ายรูปตู้แล้วนับ','Photograph the case and count')}</button><p class="mu" id="st">${L('SAM 3.1 นับชิ้นที่เห็นในรูป · ตรวจกรอบก่อนกดยืนยัน · ไม่เก็บรูป','SAM 3.1 counts what it sees · check the boxes before confirming · the photo is not kept')}</p></form>`;
  const script=`(()=>{const cam=document.getElementById('cam'),st=document.getElementById('st');document.getElementById('shot').onclick=()=>cam.click();cam.onchange=()=>{const f=cam.files&&cam.files[0];if(!f)return;st.textContent='…';const im=new Image(),u=URL.createObjectURL(f);im.onload=()=>{const k=Math.min(1,1024/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);document.getElementById('img').value=c.toDataURL('image/jpeg',0.85);st.textContent='SAM 3.1 …';document.getElementById('sf').submit();};im.src=u;};})();`;
  if(method==='GET')return send(200,path,L('นับสต็อกจากรูป','Count stock from a photo'),`<div class="card">${pick}</div>`,{sub:L('SAM 3.1 · เจ้าของหรือผู้จัดการยืนยันก่อนเปลี่ยนสต็อก','SAM 3.1 · an owner or manager confirms before stock changes'),script});
  const parts:Buffer[]=[];let n=0;for await(const c of req){n+=c.length;if(n>1_500_000)return send(413,path,'รูปใหญ่เกินไป','<div class="card">ลองรูปที่เล็กลง</div>');parts.push(c);}
  const f=new URLSearchParams(Buffer.concat(parts).toString('utf8')),item=menu.find(m=>m.productId===f.get('id')),img=f.get('img')??'';
  if(!item||!/^data:image\/jpeg;base64,/.test(img))return send(400,path,L('นับสต็อกจากรูป','Count stock from a photo'),`<div class="card">${L('เลือกเมนูและถ่ายรูปใหม่','Pick an item and take the photo again')}</div>${pick}`,{script});
  if(!deps.asr)return send(503,path,L('นับสต็อกจากรูป','Count stock from a photo'),'<div class="card">SAM 3.1 ยังไม่ได้ตั้งค่า</div>');
  let r;try{r=await samCount(deps.asr,img,item.nameEn);log(`Stock counted with SAM (${r.count})`);}catch{log('SAM count failed');return send(502,path,L('นับสต็อกจากรูป','Count stock from a photo'),`<div class="card">${L('SAM 3.1 นับไม่สำเร็จ ลองอีกครั้ง','SAM 3.1 could not count; try again')}</div>${pick}`,{script});}
  const w=r.w||1024,h=r.h||768;
  const overlay=`<div style="position:relative;max-width:640px"><img src="${esc(img)}" alt="" style="width:100%;display:block;border-radius:16px"><svg viewBox="0 0 ${w} ${h}" style="position:absolute;inset:0;width:100%;height:100%">${r.boxes.map((b,i)=>`<rect x="${b.x1}" y="${b.y1}" width="${b.x2-b.x1}" height="${b.y2-b.y1}" fill="rgba(26,113,255,.12)" stroke="#1a71ff" stroke-width="${Math.max(2,w/300)}" rx="8"/><text x="${b.x1+8}" y="${b.y1+Math.max(18,w/40)}" font-size="${Math.max(16,w/40)}" fill="#fff" stroke="#1a71ff" stroke-width="3" paint-order="stroke">${i+1}</text>`).join('')}</svg></div>`;
  const confirm=boss?`<form method="post" action="/meta/staff/menu/${item.productId}/stock" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label>${L('ตั้งสต็อกเป็น','Set stock to')}</label><input name="stock" value="${r.count}" inputmode="numeric" style="width:100px;margin:0"><button class="inline">${L('ยืนยัน','Confirm')}</button></form>`:`<p class="mu">${L('ให้เจ้าของหรือผู้จัดการยืนยัน','Ask an owner or manager to confirm')}</p>`;
  return send(200,path,L('นับสต็อกจากรูป','Count stock from a photo'),`<div class="grid g2"><div>${overlay}</div><div class="card"><h2>${esc(nm(item.name,item.nameEn))}: ${r.count} ${L('ชิ้น','pcs')}</h2><p class="mu">${L('สต็อกในระบบตอนนี้','Stock in the system now')} ${item.available} · ${L('SAM 3.1 นับจากกรอบที่เห็น ตรวจก่อนยืนยัน','counted by SAM 3.1 from the boxes shown; check before confirming')}</p>${confirm}</div></div><div class="card">${pick}</div>`,{script});
 }
 if(path==='/meta/staff/menu'){
  if(!agent)return send(503,path,'เมนูและสต็อก','<div class="card">ระบบเมนูยังไม่พร้อม</div>');
  const menu=await listMenu(agent,me.merchantId);
  const moves=await db.tenant(me.merchantId,c=>c.query<{created_at:Date;name:string;name_en:string;delta:number;reason:string;order_kind:string;order_id:string}>(
   'SELECT m.created_at,p.name,p.name_en,m.delta,m.reason,m.order_kind,m.order_id FROM meta_stock_movements m JOIN products p ON p.merchant_id=m.merchant_id AND p.id=m.product_id ORDER BY m.created_at DESC LIMIT 12'));
  const html=`${url.searchParams.get('saved')?'<div class="note" style="background:var(--grb);color:var(--gr)">บันทึกสต็อกแล้ว ✓</div>':''}<table><tr><th>เมนู</th><th>ราคา</th><th>โปร</th><th>สต็อก</th></tr>${menu.map(m=>`<tr><td><div style="display:flex;gap:10px;align-items:center">${photo(m.imageUrl)?`<img src="${esc(photo(m.imageUrl)!)}" alt="" style="width:44px;height:44px;border-radius:10px;object-fit:cover">`:''}<span><b>${esc(nm(m.name,m.nameEn))}</b><br><small>${esc(m.category??'')}</small></span></div></td>
<td>${esc(m.price.display)}${m.offer?` <small><s>${esc(m.basePrice.display)}</s></small>`:''}</td><td>${m.offer?pill(`−${m.offer.discountPercent}%`,'rd'):pill('ปกติ','mu')}</td>
<td>${boss?`<form method="post" action="/meta/staff/menu/${m.productId}/stock" style="display:flex;gap:6px;align-items:center"><input name="stock" value="${m.available}" inputmode="numeric" style="width:90px;margin:0"><button class="s inline" style="margin:0">บันทึก</button></form>`:m.available}</td></tr>`).join('')}</table>
<h2 style="margin-top:20px">ความเคลื่อนไหวสต็อก (Meta)</h2>${moves.rows.length?`<table><tr><th>เวลา</th><th>เมนู</th><th>จำนวน</th><th>เหตุผล</th><th>อ้างอิง</th></tr>${moves.rows.map(m=>`<tr><td>${t(m.created_at.toISOString())}</td><td>${esc(nm(m.name,m.name_en))}</td><td>${m.delta>0?'+':''}${m.delta}</td><td>${pill(m.reason,m.delta>0?'gr':'')}</td><td>${m.order_kind==='staff'?'นับสต็อก':`<a href="/meta/staff/order/${m.order_id}">#${pickupCode(m.order_id)}</a>`}</td></tr>`).join('')}</table>`:'<div class="card mu">ยังไม่มี</div>'}`;
  return send(200,path,'เมนูและสต็อก',html,{sub:'ราคาเป็น USD หน่วยย่อยจากเวอร์ชันราคาที่ใช้งาน (เปลี่ยนราคาจะทำให้โปรเดิมหมด จึงไม่เปิดให้แก้ที่นี่) · ทุกการเปลี่ยนสต็อกมีบันทึก'});
 }

 const forget=path.match(/^\/meta\/staff\/customers\/([0-9a-f-]{36})\/forget$/);
 if(forget&&method==='POST'){
  if(!boss)return ownerOnly();
  await db.tenant(me.merchantId,async c=>{
   await c.query('UPDATE meta_customer_links SET revoked_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL',[forget[1]]);
   await c.query('UPDATE meta_customer_sessions SET revoked_at=clock_timestamp() WHERE link_id=$1 AND revoked_at IS NULL',[forget[1]]);
  });
  log('Customer link revoked by staff');go(res,'/meta/staff/customers');return true;
 }
 const cust=path.match(/^\/meta\/staff\/customers\/([0-9a-f-]{36})$/);
 if(path==='/meta/staff/customers'||cust){
  const list=await db.tenant(me.merchantId,c=>c.query<{id:string;consented_at:Date;revoked_at:Date|null;orders:string;last:Date|null;bookings:string}>(
   `SELECT l.id,l.consented_at,l.revoked_at,
     ((SELECT count(*) FROM meta_tap_orders o JOIN meta_tap_sessions s ON s.merchant_id=o.merchant_id AND s.id=o.tap_session_id WHERE s.link_id=l.id AND o.status='PAID')+(SELECT count(*) FROM meta_agent_orders a WHERE a.link_id=l.id AND a.status='CONFIRMED')+(SELECT count(*) FROM meta_cart_orders k WHERE k.link_id=l.id AND k.status='PAID'))::text AS orders,
     greatest((SELECT max(created_at) FROM meta_tap_sessions s WHERE s.link_id=l.id),(SELECT max(created_at) FROM meta_agent_orders a WHERE a.link_id=l.id)) AS last,
     (SELECT count(*) FROM meta_table_reservations r WHERE r.link_id=l.id)::text AS bookings
    FROM meta_customer_links l ${cust?'WHERE l.id=$1':''} ORDER BY l.consented_at DESC LIMIT 50`,cust?[cust[1]]:[]));
  const label=(id:string)=>`ลูกค้า #L-${id.replace(/-/g,'').slice(0,4).toUpperCase()}`,d=(x:Date|null)=>x?x.toLocaleDateString('en-GB',{day:'2-digit',month:'short',timeZone:'Asia/Bangkok'}):'—';
  if(cust){
   const c=list.rows[0];if(!c)return send(404,'/meta/staff/customers','ไม่พบลูกค้า','<div class="card">ไม่พบ</div><a class="btn g inline" href="/meta/staff/customers">← ลูกค้า</a>');
   return send(200,'/meta/staff/customers',label(c.id),`<div class="grid g2"><div class="card"><h2>ประวัติ (เฉพาะที่ยินยอม)</h2>${row({icon:'🧾',title:`${c.orders} ออเดอร์ที่จ่ายแล้ว`,sub:`มาล่าสุด ${d(c.last)}`})}${row({icon:'🗓️',title:`${c.bookings} การจองโต๊ะ`})}</div>
<div class="card"><h2>ความเป็นส่วนตัว</h2><p class="mu">ไม่แสดงรหัส Messenger · ไม่เก็บข้อความแชท · ไม่ใช้ใบหน้า · ลูกค้าพิมพ์ STOP หรือกดเลิกเชื่อมต่อเองได้</p>${c.revoked_at?pill('เลิกเชื่อมต่อแล้ว','mu'):boss?`<form method="post" action="/meta/staff/customers/${c.id}/forget"><button class="d">ลบการเชื่อมต่อของลูกค้าคนนี้</button></form>`:''}</div></div><a class="btn g inline" href="/meta/staff/customers">← ลูกค้า</a>`,
    {sub:`ยินยอม ${d(c.consented_at)} · เวอร์ชันความยินยอม bitpos-meta-offers-v1`});
  }
  return send(200,path,'ลูกค้าที่ยินยอม',list.rows.length?`<table><tr><th>ลูกค้า</th><th>ยินยอม</th><th>มาล่าสุด</th><th>ออเดอร์</th><th>สถานะ</th></tr>${list.rows.map(c=>`<tr class="click"><td><a href="/meta/staff/customers/${c.id}"><b>${label(c.id)}</b></a></td><td>${d(c.consented_at)}</td><td>${d(c.last)}</td><td>${c.orders}</td><td>${c.revoked_at?pill('เลิกเชื่อมต่อ','mu'):pill('ยินยอม','gr')}</td></tr>`).join('')}</table>`:'<div class="card mu">ยังไม่มีลูกค้าที่ยินยอม · ลูกค้าเริ่มด้วยการแตะมือถือที่ BitPOS Mini</div>',
   {sub:'เชื่อมต่อผ่าน Messenger หลังลูกค้ากดยินยอมเท่านั้น'});
 }

 if(path==='/meta/staff/connector'){
  const recent=await db.tenant(me.merchantId,c=>c.query<{id:string;status:string;amount_minor:string;currency:string;created_at:Date;name:string;name_en:string}>(
   `SELECT a.id,a.status,a.amount_minor::text,a.currency,a.created_at,coalesce(p.name,'') AS name,coalesce(p.name_en,'') AS name_en FROM meta_agent_orders a LEFT JOIN products p ON p.merchant_id=a.merchant_id AND p.id=a.product_id WHERE a.link_id IS NULL ORDER BY a.created_at DESC LIMIT 6`));
  const endpoint=`${deps.identity.publicOrigin}/meta/mcp/${me.merchantId}`;
  const tools=[['list_menu','เมนูและราคาจากเซิร์ฟเวอร์'],['get_quote','quote หน่วยย่อย อายุ 10 นาที'],['complete_checkout','Stripe Shared Payment Token'],['order_status','สถานะและรหัสรับ'],['cancel_order','คืนเงินก่อนส่งมอบ']];
  return send(200,path,'Muse Connector (MCP)',`<div class="card"><small>ปลายทาง (JSON-RPC, POST)</small><input readonly value="${esc(endpoint)}"></div><div class="grid g3">${tools.map(([a,b])=>row({icon:'🤖',title:a,sub:b})).join('')}</div>
<h2 style="margin-top:20px">${L('ออเดอร์จาก AI agent ล่าสุด','Latest AI agent orders')}</h2>${recent.rows.length?recent.rows.map(o=>row({href:`/meta/staff/order/${o.id}`,icon:'🤖',title:`#${pickupCode(o.id)} ${nm(o.name,o.name_en)} · ${money(o.amount_minor,o.currency)}`,sub:t(o.created_at.toISOString()),right:pill(o.status==='CONFIRMED'?'จ่ายแล้ว':o.status==='CANCELLED'?'คืนเงิน':o.status,o.status==='CONFIRMED'?'gr':o.status==='CANCELLED'?'rd':'am')})).join(''):'<div class="card mu">ยังไม่มี</div>'}`,
   {sub:L('ให้ AI agent สั่งจากร้านได้ · agent ส่งแค่ id ไม่เห็นเลขบัตร และตั้งราคาเองไม่ได้','AI agents can order from the shop · an agent sends only ids, never sees card numbers and cannot set prices')});
 }

 if(path==='/meta/staff/reports'){
  const r=await db.tenant(me.merchantId,async c=>({
   days:(await c.query<{day:string;channel:string;sum:string}>(`SELECT to_char(coalesce(paid_at,created_at) AT TIME ZONE 'Asia/Bangkok','DD Mon') AS day,channel,sum(amount_minor)::text AS sum FROM bitpos.meta_order_feed(clock_timestamp()-interval '7 days')
     WHERE platform='meta' AND status IN ('PAID','CONFIRMED') GROUP BY 1,2 ORDER BY min(coalesce(paid_at,created_at))`)).rows,
   refunds:(await c.query<{n:string;sum:string|null}>(`SELECT count(*)::text AS n,sum(amount_minor)::text AS sum FROM bitpos.meta_order_feed(clock_timestamp()-interval '7 days') WHERE platform='meta' AND status='CANCELLED'`)).rows[0],
   top:(await c.query<{name:string;n:string}>(`SELECT name,sum(q)::text AS n FROM (SELECT ${staffLang()==='th'?'i.name':'i.name_en'} AS name,i.quantity AS q FROM meta_cart_items i JOIN meta_cart_orders o ON o.merchant_id=i.merchant_id AND o.id=i.order_id WHERE o.status='PAID'
     UNION ALL SELECT ${staffLang()==='th'?'p.name':'p.name_en'},a.quantity FROM meta_agent_orders a JOIN products p ON p.merchant_id=a.merchant_id AND p.id=a.product_id WHERE a.status='CONFIRMED'
     UNION ALL SELECT ${staffLang()==='th'?'p.name':'p.name_en'},t.quantity FROM meta_tap_orders t JOIN products p ON p.merchant_id=t.merchant_id AND p.id=t.product_id WHERE t.status='PAID') x GROUP BY name ORDER BY 2 DESC LIMIT 5`)).rows}));
  const total=r.days.reduce((a,x)=>a+BigInt(x.sum),0n),days=[...new Set(r.days.map(x=>x.day))],peak=Math.max(1,...days.map(d=>r.days.filter(x=>x.day===d).reduce((a,x)=>a+Number(x.sum),0)));
  const bars=days.map(d=>{const items=r.days.filter(x=>x.day===d);const sum=items.reduce((a,x)=>a+Number(x.sum),0);return `<div style="display:flex;gap:10px;align-items:center;margin:8px 0"><span style="width:70px">${esc(d)}</span><span class="barh" style="flex:1"><i style="width:${Math.round(sum/peak*100)}%"></i></span><b style="width:90px;text-align:right">${money(sum)}</b></div>`;}).join('');
  return send(200,path,L('รายงาน 7 วัน','Reports · last 7 days'),`<div class="grid g3"><div class="met p"><small>ยอดที่จ่ายแล้ว (Stripe)</small><b>${money(total)}</b><small>ทุกช่องทางของ Meta</small></div><div class="met"><small>คืนเงิน</small><b>${money(r.refunds.sum??'0')}</b><small>${L(`${r.refunds.n} รายการ`,`${r.refunds.n} orders`)}</small></div>
<div class="met"><small>ยอดโอนจาก Stripe</small><b>sandbox</b><small><a href="/meta/staff/payouts">ดูยอดคงเหลือและรอบโอน →</a></small></div></div>
<div class="grid g2" style="margin-top:14px"><div class="card"><h2>ยอดรายวัน</h2>${bars||'<p class="mu">ยังไม่มีข้อมูล</p>'}</div><div class="card"><h2>เมนูขายดี</h2>${r.top.map((x,i)=>row({icon:String(i+1),title:x.name,right:`${x.n} ชิ้น`})).join('')||'<p class="mu">ยังไม่มีข้อมูล</p>'}</div></div>`,
   {sub:L('จาก meta_order_feed() · เฉพาะช่องทาง Meta · ไม่รวมคริปโต','From meta_order_feed() · Meta channels only · no crypto'),actions:`<a class="btn g" href="/meta/staff/ledger">${L('หลักฐาน AI →','AI evidence →')}</a>`});
 }

 if(path==='/meta/staff/payouts'){
  if(!boss)return ownerOnly();
  if(!deps.stripe)return send(503,'/meta/staff/reports','ยอดโอนจาก Stripe','<div class="card">ยังไม่ได้ตั้งค่า Stripe</div><a class="btn g inline" href="/meta/staff/reports">← รายงาน</a>');
  let p;try{p=await listPayouts(deps.stripe.config,deps.stripe.fetch);}catch{log('Stripe payouts lookup failed');return send(502,'/meta/staff/reports','ยอดโอนจาก Stripe','<div class="card">อ่านข้อมูลจาก Stripe ไม่ได้ ลองอีกครั้ง</div><a class="btn g inline" href="/meta/staff/reports">← รายงาน</a>');}
  const sum=(xs:{amountMinor:bigint;currency:string}[])=>xs.map(x=>money(x.amountMinor,x.currency)).join(' · ')||money(0);
  const PS:Record<string,[string,string]>={paid:['โอนแล้ว','gr'],pending:['รอโอน','am'],in_transit:['กำลังโอน','am'],canceled:['ยกเลิก','mu'],failed:['ไม่สำเร็จ','rd']};
  const day=(s:number)=>s?new Date(s*1000).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Bangkok'}):'—';
  return send(200,'/meta/staff/reports','ยอดโอนจาก Stripe',`<div class="grid g2"><div class="met p"><small>พร้อมโอน</small><b>${esc(sum(p.available))}</b><small>Stripe balance (test)</small></div><div class="met"><small>รอเคลียร์</small><b>${esc(sum(p.pending))}</b><small>ยอดที่ยังไม่พร้อมโอน</small></div></div>
<h2 style="margin-top:18px">รอบโอนล่าสุด</h2>${p.payouts.length?`<table><tr><th>รอบโอน</th><th>ยอด</th><th>สถานะ</th><th>ถึงบัญชี</th><th>ประเภท</th></tr>${p.payouts.map(x=>`<tr><td><small>${esc(x.id.slice(0,14))}…</small></td><td>${esc(money(x.amountMinor,x.currency))}</td><td>${pill(...(PS[x.status]??[x.status,'mu']) as [string,string])}</td><td>${day(x.arrivalDate)}</td><td>${x.automatic?'อัตโนมัติ':'สั่งเอง'}</td></tr>`).join('')}</table>`:'<div class="card mu">ยังไม่มีรอบโอน · บัญชีทดสอบมักไม่มีรอบโอนจนกว่าจะสร้างใน Stripe</div>'}
<a class="btn g inline" href="/meta/staff/reports">← รายงาน</a>`,{sub:'อ่านอย่างเดียวจาก Stripe API (test mode) · บัญชี sandbox ใช้ร่วมทุกร้านทดสอบ · ไม่ใช่เงินจริง'});
 }

 if(path==='/meta/staff/users'){
  if(!boss)return ownerOnly();
  const rows=(await db.tenant(me.merchantId,c=>c.query<{user_id:string;role:string}>("SELECT user_id::text,role FROM members WHERE merchant_id=$1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,user_id",[me.merchantId]))).rows;
  const RT:Record<string,[string,string]>={owner:['เจ้าของ','dk'],manager:['ผู้จัดการ','vi'],staff:['พนักงาน','']};
  const CAN:[string,boolean,boolean,boolean][]=[['ดูและส่งมอบออเดอร์',true,true,true],['ขายหน้าร้าน (Stripe QR)',true,true,true],['คิวครัว · การจอง',true,true,true],['แก้สต็อก',true,true,false],['คืนเงินผ่าน Stripe',true,true,false],['อนุมัติโปร Muse Spark',true,true,false],['เปิด Allow All ให้ Muse Spark',true,false,false],['รายงาน · ยอดโอน · ผู้ใช้',true,true,false]];
  const yes=(b:boolean)=>b?'<b style="color:var(--gr)">✓</b>':'<span class="mu">—</span>';
  return send(200,'/meta/staff/settings','ผู้ใช้และสิทธิ์',`<div class="grid g2"><div class="card"><h2>สมาชิกร้าน ${rows.length}</h2>${rows.map(r=>row({icon:r.role==='owner'?'👑':r.role==='manager'?'🧑‍💼':'🧑‍🍳',title:`บัญชี ${r.user_id.slice(0,8)}${r.user_id===me.userId?' · คุณ':''}`,sub:'Supabase Auth ของ BitPOS · ไม่แสดงอีเมล',right:pill(...(RT[r.role]??[r.role,'mu']) as [string,string])})).join('')}
<p class="mu">เพิ่มหรือเปลี่ยนบทบาทโดยผู้ดูแลระบบ (tools/meta/create-demo-staff.sh) · ไม่มีปุ่มแก้สิทธิ์ในหน้าเว็บ</p></div>
<div class="card"><h2>สิทธิ์ตามบทบาท</h2><table><tr><th>งาน</th><th>เจ้าของ</th><th>ผู้จัดการ</th><th>พนักงาน</th></tr>${CAN.map(([a,...b])=>`<tr><td>${esc(a)}</td>${b.map(x=>`<td>${yes(x)}</td>`).join('')}</tr>`).join('')}</table><p class="mu">เซิร์ฟเวอร์อ่านบทบาทจากตาราง members ใหม่ทุกคำขอ</p></div></div>
<a class="btn g inline" href="/meta/staff/settings">← ตั้งค่า</a>`,{sub:shop});
 }

 // Shop look: cover photo, logo, tagline and theme colour for the customer pages (meta-pay).
 if(path==='/meta/staff/settings/look'){
  let error='';
  if(method==='POST'){
   if(!boss)return ownerOnly();
   const f=await bigBody(req);
   if(!f)error=L('รูปใหญ่เกินไป','The images are too large');
   else{
    const pic=(k:string)=>{if(f.get(`${k}_remove`)==='1')return null;const v=f.get(k)??'';if(!v)return undefined;const m=v.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);return m?Buffer.from(m[1],'base64'):Buffer.alloc(0);};
    const accent=f.get('custom')==='1'?f.get('accent_custom')??'':f.get('accent')??'';
    try{await saveLook(db,me.merchantId,me.userId,{tagline:f.get('tagline')??'',accent,cover:pic('cover'),logo:pic('logo')});log('Shop look saved');go(res,'/meta/staff/settings/look?saved=1');return true;}
    catch(e){if(!(e instanceof LookError))throw e;
     error={BAD_COLOUR:L('สีไม่ถูกต้อง','Invalid colour'),LOW_CONTRAST:L('สีนี้อ่อนเกินไป ตัวหนังสือสีขาวบนปุ่มจะอ่านยาก ลองสีเข้มขึ้น','This colour is too light for white button text. Try a darker one.'),
      BAD_IMAGE:L('รับเฉพาะรูป JPEG, PNG หรือ WebP','Only JPEG, PNG or WebP images'),TOO_LARGE:L('รูปใหญ่เกินไป (ปก 3 MB, โลโก้ 1 MB)','Image too large (cover 3 MB, logo 1 MB)'),BAD_TAGLINE:L('คำโปรยยาวเกิน 120 ตัวอักษร','The tagline is over 120 characters')}[e.code];}
   }
  }
  const v=await shopLook(db,me.merchantId);
  const custom=!PRESETS.some(([c])=>c===v.accent);
  const dis=boss?'':' disabled';
  const swatch=PRESETS.map(([c,th,en])=>`<label class="sw"><input type="radio" name="accent" value="${c}"${c===v.accent?' checked':''}${dis}><i style="background:${c}"></i>${L(th,en)}</label>`).join('');
  const saved=url.searchParams.get('saved')==='1'&&!error?`<div class="card">${pill(L('บันทึกแล้ว','Saved'),'gr')} ${L('หน้าร้านของลูกค้าใช้ค่าใหม่ภายใน 20 วินาที','Customer pages use it within 20 seconds')}</div>`:'';
  const preview=`<div class="lookpv" style="--a:${v.accent}"><div class="lpcover" style="background-image:url('${esc(v.coverUrl??DEFAULT_COVER)}')"><span>${esc(v.tagline)}</span></div>
<div class="lpbar">${v.logoUrl?`<img src="${esc(v.logoUrl)}" alt="">`:''}<b>${esc(v.name)}</b></div><div class="lpbtn">${L('ดูเมนู','Menu')}</div></div>`;
  const script=`(()=>{const fit=(file,max,type,q)=>new Promise((ok,no)=>{const im=new Image();im.onload=()=>{const k=Math.min(1,max/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);ok(c.toDataURL(type,q));URL.revokeObjectURL(im.src);};im.onerror=no;im.src=URL.createObjectURL(file);});
for(const [k,max,type] of [['cover',1600,'image/jpeg'],['logo',256,'image/png']]){const inp=document.getElementById(k+'_file'),out=document.getElementById(k);if(!inp)continue;inp.onchange=async()=>{const f=inp.files[0];if(!f)return;out.value=await fit(f,max,type,0.85);const pv=document.getElementById(k+'_pv');if(pv)pv.src=out.value;if(k==='cover')document.querySelector('.lpcover').style.backgroundImage='url('+out.value+')';};}
const tg=document.querySelector('input[name=tagline]');if(tg)tg.oninput=()=>{document.querySelector('.lpcover span').textContent=tg.value;};
const cu=document.getElementById('accent_custom'),cb=document.getElementById('custom');if(cu)cu.oninput=()=>{cb.checked=true;document.querySelector('.lookpv').style.setProperty('--a',cu.value);};
for(const r of document.querySelectorAll('input[name=accent]'))r.onchange=()=>{cb.checked=false;document.querySelector('.lookpv').style.setProperty('--a',r.value);};})();`;
  const css=`<style>.sw{display:inline-flex;align-items:center;gap:6px;margin:0 14px 10px 0;font-size:14px}.sw i{width:26px;height:26px;border-radius:13px;display:inline-block}.sw input{width:auto;margin:0}
.lookpv{max-width:360px;border:1px solid var(--ln);border-radius:18px;overflow:hidden;background:#fff}.lpcover{height:150px;background:#ddd center/cover;display:flex;align-items:flex-end}.lpcover span{color:#fff;padding:10px 14px;font-weight:600;text-shadow:0 1px 4px rgba(0,0,0,.6)}
.lpbar{display:flex;align-items:center;gap:8px;padding:12px 14px}.lpbar img{width:32px;height:32px;border-radius:9px;object-fit:cover}.lpbtn{margin:0 14px 14px;padding:12px;border-radius:12px;text-align:center;color:#fff;font-weight:600;background:var(--a)}
.thumb{max-width:220px;max-height:120px;border-radius:10px;display:block;margin:6px 0}</style>`;
  return send(error?400:200,'/meta/staff/settings',L('หน้าตาร้าน','Shop look'),`${css}${saved}${error?`<div class="card">${pill(L('บันทึกไม่ได้','Not saved'),'rd')} ${esc(error)}</div>`:''}
<div class="grid g2"><form method="post" action="/meta/staff/settings/look" class="card">
<label>${L('ภาพปกร้าน','Cover photo')}</label>${v.coverUrl?`<img class="thumb" id="cover_pv" src="${esc(v.coverUrl)}" alt="">`:'<img class="thumb" id="cover_pv" alt="">'}<input type="file" id="cover_file" accept="image/jpeg,image/png,image/webp"${dis}><input type="hidden" name="cover" id="cover">
${v.coverUrl&&boss?`<label class="sw"><input type="checkbox" name="cover_remove" value="1">${L('ลบภาพปก','Remove cover')}</label>`:''}
<label>${L('โลโก้','Logo')}</label>${v.logoUrl?`<img class="thumb" id="logo_pv" src="${esc(v.logoUrl)}" alt="" style="max-width:64px">`:'<img class="thumb" id="logo_pv" alt="" style="max-width:64px">'}<input type="file" id="logo_file" accept="image/jpeg,image/png,image/webp"${dis}><input type="hidden" name="logo" id="logo">
${v.logoUrl&&boss?`<label class="sw"><input type="checkbox" name="logo_remove" value="1">${L('ลบโลโก้','Remove logo')}</label>`:''}
<label>${L('คำโปรยบนภาพปก','Tagline on the cover')}</label><input name="tagline" maxlength="120" value="${esc(v.tagline)}"${dis}>
<label>${L('สีธีม','Theme colour')}</label><div>${swatch}</div>
<label class="sw"><input type="checkbox" id="custom" name="custom" value="1"${custom?' checked':''}${dis}>${L('สีเอง','Custom')} <input type="color" id="accent_custom" name="accent_custom" value="${esc(v.accent.toLowerCase())}"${dis} style="width:48px;height:32px;padding:0"></label>
<small class="mu">${L('ระบบตรวจว่าตัวหนังสือสีขาวบนสีนี้อ่านได้ (contrast ≥ 4.5)','The server checks white text stays readable on it (contrast ≥ 4.5)')}</small>
${boss?`<button class="inline">${L('บันทึก','Save')}</button>`:`<p class="mu">${L('เฉพาะเจ้าของหรือผู้จัดการแก้ได้','Owner or manager only')}</p>`}</form>
<div class="card"><h2>${L('ตัวอย่างหน้าร้าน','Preview')}</h2>${preview}<p class="mu">${L('ใช้กับหน้าร้านลูกค้า (meta-pay): หัวเว็บ ปุ่ม ภาพปก และชื่อร้าน','Used on the customer pages (meta-pay): header, buttons, cover and shop name')}</p><p><a target="_blank" rel="noopener" href="${esc(deps.identity.publicOrigin)}/">${L('เปิดหน้าร้านจริง','Open the shop')} →</a></p></div></div>
<a class="btn g inline" href="/meta/staff/settings">← ${L('ตั้งค่า','Settings')}</a>`,{sub:L('ปก โลโก้ คำโปรย และสีของหน้าร้านลูกค้า','Cover, logo, tagline and colour of the customer shop'),script});
 }

 if(path==='/meta/staff/settings'){
  const r=await db.tenant(me.merchantId,async c=>({
   devices:(await c.query<{label:string;table:string|null;tag:string|null;counter:number|null}>(`SELECT d.label,t.label AS table,g.tag_id AS tag,g.last_counter AS counter FROM devices d LEFT JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id
     LEFT JOIN meta_ntag_tags g ON g.merchant_id=d.merchant_id AND g.device_id=d.id AND g.retired_at IS NULL WHERE d.revoked_at IS NULL ORDER BY d.label`)).rows,
   roles:(await c.query<{role:string;n:string}>('SELECT role,count(*)::text AS n FROM members WHERE merchant_id=$1 GROUP BY role',[me.merchantId])).rows,
   page:(await c.query<{page_username:string}>('SELECT page_username FROM meta_messenger_pages WHERE retired_at IS NULL')).rows[0]?.page_username??null}));
  const screen=(tag:string)=>`${deps.identity.publicOrigin}/meta/screen/${tag}?k=${screenKey(deps.identity.masterKey,tag)}`;
  return send(200,path,'ตั้งค่า',`<h2>โต๊ะ อุปกรณ์ และสติกเกอร์</h2><table><tr><th>อุปกรณ์</th><th>โต๊ะ</th><th>${L('สติกเกอร์ NTAG 424','NTAG 424 sticker')}</th><th>จอโต๊ะ</th></tr>${r.devices.map(d=>`<tr><td>${esc(d.label)}</td><td>${esc(d.table??'—')}</td><td>${d.tag?`${esc(d.tag)} <small>· ตัวนับ ${d.counter}</small>`:'<span class="mu">ยังไม่มี</span>'}</td><td>${d.tag?`<a target="_blank" rel="noopener" href="${esc(screen(d.tag))}">เปิด →</a>`:''}</td></tr>`).join('')}</table>
<div class="grid g2" style="margin-top:16px">${[['👥','ผู้ใช้และสิทธิ์',r.roles.map(x=>`${({owner:'เจ้าของ',manager:'ผู้จัดการ',staff:'พนักงาน'} as Record<string,string>)[x.role]??x.role} ${x.n}`).join(' · ')+' · ตรวจสิทธิ์ทุกคำขอ'],
 ['🎨',L('หน้าตาร้าน','Shop look'),L('ปก โลโก้ คำโปรย สีธีม','Cover, logo, tagline, theme colour')],['💬','Messenger',r.page?`เพจ ${r.page} · เชื่อมต่อแล้ว · ข้อความยินยอม v1`:'ยังไม่ได้เชื่อมเพจ'],['💳','Stripe',deps.stripe?'Sandbox · webhook ตรวจลายเซ็น · ห้ามคีย์จริง':'ยังไม่ได้ตั้งค่า'],
 ['✨','Muse Spark',deps.offers?.router?L('muse-spark-1.3 · จำกัด 10 ครั้ง/ชม./ลูกค้า · มีตัวสำรอง','muse-spark-1.3 · up to 10 calls per customer per hour · with fallback'):'ใช้ตัวสำรอง (ไม่มีโมเดล)'],['🤖','Muse Connector (MCP)','ดูปลายทางและเครื่องมือ'],['🖥️',L('เฟิร์มแวร์ BitPOS Mini','BitPOS Mini firmware'),L('รุ่น Meta แยกจาก sol- · ดูรายละเอียดใน README ของเฟิร์มแวร์','Meta edition, separate from sol- · see the firmware README')]]
 .map(([i,a,b],n)=>row({icon:i,title:a,sub:esc(b),href:n===0?'/meta/staff/users':n===1?'/meta/staff/settings/look':n===5?'/meta/staff/connector':n===4?'/meta/staff/ledger':undefined})).join('')}</div>`,{sub:shop});
 }

 const refund=path.match(/^\/meta\/staff\/order\/([0-9a-f-]{36})\/refund$/);
 if(refund&&method==='POST'){
  if(!boss)return ownerOnly();
  if(!agent)return send(503,'/meta/staff','คืนเงินไม่ได้','<div class="card">ระบบยังไม่พร้อม</div>');
  try{await refundCart(agent,me.merchantId,refund[1]);log('Cart order refunded by staff');go(res,`/meta/staff/order/${refund[1]}`);return true;}
  catch(e){if(e instanceof CartError)return send(409,'/meta/staff','คืนเงินไม่ได้',`<div class="card">${e.code==='NOT_CANCELLABLE'?'คืนเงินได้เฉพาะออเดอร์ที่จ่ายแล้วและยังไม่ส่งมอบ':e.code}</div><a class="btn g inline" href="/meta/staff/order/${refund[1]}">← ออเดอร์</a>`);
   log('Refund failed');return send(502,'/meta/staff','Stripe ขัดข้อง','<div class="card">ยังไม่ได้คืนเงิน ลองอีกครั้ง</div>');}
 }
 const detail=path.match(/^\/meta\/staff\/order\/([0-9a-f-]{36})$/);
 if(detail){
  const cart=await cartForStaff(db,me.merchantId,detail[1]);
  const o=(await listTapOrders(staff,me)).find(x=>x.id===detail[1]);
  if(!cart&&!o)return send(404,'/meta/staff','ไม่พบออเดอร์','<div class="card">ไม่พบออเดอร์นี้ใน 24 ชั่วโมงล่าสุด</div><a class="btn g inline" href="/meta/staff">← ออเดอร์</a>');
  const code=cart?.code??o!.code,status=cart?(cart.status==='PENDING'?'CREATED':cart.status):o!.status,handed=cart?.handedOverAt??o?.handedOverAt??null,channel=cart?.channel??o!.channel;
  const lines=cart?cart.lines.map(l=>`<div class="tot"><span>${esc(l.emoji)} ${esc(nm(l.name,l.nameEn))} × ${l.quantity}${l.offer?' '+pill('โปร','rd'):''}</span><span>${esc(l.amount)}</span></div>`).join('')+`<hr style="border:0;border-top:1px solid var(--ln)"><div class="tot"><span class="mu">ส่วนลด</span><span>−${esc(cart.discount)}</span></div><div class="tot b"><span>รวม</span><span>${esc(cart.total)}</span></div>`
   :`<div class="tot b"><span>${esc(o!.emoji)} ${esc(nm(o!.name,o!.nameEn))}</span><span>${esc(money(o!.amountMinor,o!.currency))}</span></div>`;
  const actions=status==='PAID'&&!handed?`<form method="post" action="/meta/staff/orders/${detail[1]}/handover"><button>ส่งมอบแล้ว</button></form>${cart&&boss?`<form method="post" action="/meta/staff/order/${detail[1]}/refund"><button class="d">คืนเงินเต็มจำนวนผ่าน Stripe</button></form>`:''}`
   :status==='CREATED'&&cart?`<a class="btn s" href="/meta/staff/counter/${detail[1]}">แสดง QR ให้ลูกค้าสแกน</a>`:'';
  return send(200,'/meta/staff',`ออเดอร์ #${code}`,`<div class="grid g2"><div class="card"><h2>รายการ ${chan(channel)} ${st(status,handed)}</h2>${lines}${o?.stockShort||cart?.stockShort?'<div class="note">สต็อกไม่พอตอนจ่าย · คืนเงินหรือแจ้งลูกค้า</div>':''}
<p class="mu">จ่ายแล้วยืนยันจาก Stripe (webhook ที่ตรวจลายเซ็น หรือการตรวจจากเซิร์ฟเวอร์) · สต็อกตัดครั้งเดียว บันทึกใน meta_stock_movements</p><a href="/meta/staff/ledger">ดูหลักฐาน →</a></div>
<div class="card center"><small>รหัสรับสินค้า</small><div class="big">#${esc(code)}</div>${actions}<a class="btn g" href="/meta/staff">← ศูนย์ออเดอร์</a></div></div>`,{sub:`${CHANNEL[channel]?.[0]??channel} · ${t(cart?.paidAt??o?.paidAt??o?.createdAt??null)}`});
 }
 return false;
}
