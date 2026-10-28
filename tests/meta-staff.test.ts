// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Staff view of tap orders against a disposable PostgreSQL with migrations 001–305 applied. Supabase Auth is
// stubbed; membership roles, sessions and hand-over run as `bitpos_app` under row-level security.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import pg from 'pg';
import type {MetaDb} from '../apps/api/src/meta/identity';
import {formatTapAmount,handOver,listTapOrders,pickupCode,staffFromSession,staffSignIn,staffSignOut,type StaffDeps} from '../apps/api/src/meta/staff';
import {serveMeta,type MetaRouteDeps} from '../apps/api/src/meta/routes';

const url=process.env.META_TEST_DATABASE_URL;
const skip=!url&&'META_TEST_DATABASE_URL not set';
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002',PAGE_A='100000000001';
const STAFF=randomUUID(),OTHER=randomUUID(),CUSTOMER=randomUUID(),NOBODY=randomUUID();
const users:Record<string,{id:string;password:string}>={'staff@shop.test':{id:STAFF,password:'pw-staff'},'other@shop.test':{id:OTHER,password:'pw-other'},
 'customer@shop.test':{id:CUSTOMER,password:'pw-customer'},'nobody@shop.test':{id:NOBODY,password:'pw-nobody'}};
let admin:pg.Pool,app:pg.Pool,deps:StaffDeps;
let authCalls=0;
const authFetch=async(_url:string,init:RequestInit)=>{
 authCalls++;const {email,password}=JSON.parse(String(init.body));const u=users[email];
 return u&&u.password===password?new Response(JSON.stringify({access_token:'x',user:{id:u.id}}),{status:200}):new Response('{"error":"invalid_grant"}',{status:400});
};
let paidOrder:string,openOrder:string,otherShopOrder:string;

async function order(merchant:string,status:'PAID'|'CREATED'):Promise<string>{
 const product=(await admin.query<{id:string}>(`INSERT INTO products(merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,'ลาเต้','Latte','🥛',50000,5) RETURNING id`,[merchant])).rows[0].id;
 const dev=randomUUID(),tag=`staff-${randomBytes(4).toString('hex')}`;
 await admin.query(`INSERT INTO devices(merchant_id,id,label) VALUES($1,$2,'staff test')`,[merchant,dev]);
 await admin.query('INSERT INTO meta_ntag_tags(tag_id,merchant_id,device_id,uid) VALUES($1,$2,$3,$4)',[tag,merchant,dev,('04'+randomBytes(6).toString('hex')).toUpperCase()]);
 const tap=(await admin.query<{id:string}>("INSERT INTO meta_tap_sessions(merchant_id,tag_id,device_id,counter,token_sha256,expires_at) VALUES($1,$2,$3,1,$4,clock_timestamp()+interval '100 seconds') RETURNING id",[merchant,tag,dev,randomBytes(32)])).rows[0].id;
 const page=merchant===A?PAGE_A:'200000000002';
 const link=(await admin.query<{id:string}>("INSERT INTO meta_customer_links(merchant_id,page_id,psid,consent_version) VALUES($1,$2,$3,'bitpos-meta-offers-v1') RETURNING id",[merchant,page,String(10_000_000+Math.floor(Math.random()*1e9))])).rows[0].id;
 const paid=status==='PAID';
 return (await admin.query<{id:string}>(`INSERT INTO meta_tap_orders(merchant_id,link_id,tap_session_id,offer_id,product_id,currency,amount_minor,status,paid_at,paid_source,stripe_payment_intent_id,expires_at)
  VALUES($1,$2,$3,$4,$5,'usd',400,$6,$7,$8,$9,clock_timestamp()+interval '40 minutes') RETURNING id`,
  [merchant,link,tap,`product:${product}:1`,product,status,paid?new Date():null,paid?'webhook':null,paid?`pi_test${randomBytes(6).toString('hex')}`:null])).rows[0].id;
}

before(async()=>{
 if(skip)return;
 admin=new pg.Pool({connectionString:url,max:2,options:'-c search_path=bitpos,public'});
 app=new pg.Pool({connectionString:url,max:4,options:'-c search_path=bitpos,public'});
 app.on('connect',c=>{c.query('SET ROLE bitpos_app');});
 const db:MetaDb={query:(sql,params)=>app.query(sql,params as any[]),tenant:async(merchant,fn)=>{const c=await app.connect();try{await c.query('SET ROLE bitpos_app');await c.query('BEGIN');await c.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};
 deps={db,config:{origin:'https://pos.example.test',authUrl:'http://auth.test',anonKey:'anon',fetch:authFetch}};
 await admin.query(`INSERT INTO meta_messenger_pages(page_id,merchant_id,page_username) VALUES($1,$2,'bitposdemoa'),('200000000002',$3,'bitposdemob') ON CONFLICT DO NOTHING`,[PAGE_A,A,B]);
 await admin.query("INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,'staff'),($3,$4,'owner')",[STAFF,A,OTHER,B]);
 paidOrder=await order(A,'PAID');openOrder=await order(A,'CREATED');otherShopOrder=await order(B,'PAID');
});
after(async()=>{if(!skip){await admin.query('DELETE FROM members WHERE user_id = ANY($1)',[[STAFF,OTHER]]);await admin.end();await app.end();}});

test('sign-in: POS password + one staff-capable membership; wrong password or no membership is refused',{skip},async()=>{
 assert.deepEqual(await staffSignIn(deps,'staff@shop.test','wrong'),{kind:'error',reason:'AUTH'});
 assert.deepEqual(await staffSignIn(deps,'nobody@shop.test','pw-nobody'),{kind:'error',reason:'ROLE'});
 const calls=authCalls;assert.deepEqual(await staffSignIn(deps,'not-an-email','x'),{kind:'error',reason:'AUTH'});assert.equal(authCalls,calls,'invalid input never reaches Auth');
 const ok=await staffSignIn(deps,'staff@shop.test','pw-staff');
 assert.equal(ok.kind,'ok');
 const me=await staffFromSession(deps,(ok as any).token);
 assert.deepEqual([me?.merchantId,me?.role,me?.userId],[A,'staff',STAFF]);
 assert.equal(await staffFromSession(deps,'x'.repeat(43)),null);
});

test('list and hand over: own shop only, paid only, once; role is re-read every request',{skip},async()=>{
 const ok=await staffSignIn(deps,'staff@shop.test','pw-staff') as {token:string};
 const me=(await staffFromSession(deps,ok.token))!;
 const list=await listTapOrders(deps,me);
 const ids=list.map(o=>o.id);
 assert.ok(ids.includes(paidOrder)&&ids.includes(openOrder));
 assert.ok(!ids.includes(otherShopOrder),'another shop’s orders are invisible under RLS');
 assert.equal(list.find(o=>o.id===paidOrder)?.code,pickupCode(paidOrder));
 assert.equal(formatTapAmount('400','usd'),'$4.00');assert.equal(formatTapAmount('5200','thb'),'฿52.00');
 assert.equal(await handOver(deps,me,openOrder),'NOT_PAID');
 assert.equal(await handOver(deps,me,otherShopOrder),'NOT_FOUND');
 assert.equal(await handOver(deps,me,paidOrder),'HANDED_OVER');
 assert.equal(await handOver(deps,me,paidOrder),'ALREADY');
 const row=(await admin.query('SELECT handed_over_by FROM meta_tap_orders WHERE id=$1',[paidOrder])).rows[0];
 assert.equal(row.handed_over_by,STAFF);
 // Removing the membership ends access immediately, even with a live session cookie.
 await admin.query('DELETE FROM members WHERE user_id=$1',[STAFF]);
 assert.equal(await staffFromSession(deps,ok.token),null);
 await admin.query("INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,'staff')",[STAFF,A]);
 await staffSignOut(deps,ok.token);
 assert.equal(await staffFromSession(deps,ok.token),null,'signed out');
});

test('HTTP: same-origin POSTs, HttpOnly strict cookie scoped to /meta/staff, no session → sign-in form',{skip},async()=>{
 const routeDeps:MetaRouteDeps={identity:{db:deps.db,masterKey:Buffer.alloc(16),publicOrigin:'https://pay.example.test'},messenger:null,offers:null,staff:deps};
 const server=http.createServer(async(req,res)=>{if(!(await serveMeta(req,res,routeDeps))){res.writeHead(404);res.end();}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const form=(o:Record<string,string>)=>new URLSearchParams(o).toString();
 const post=(path:string,body:string,headers:Record<string,string>={})=>fetch(base+path,{method:'POST',body,redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded',origin:'https://pos.example.test',...headers}});
 try{
  const anon=await fetch(`${base}/meta/staff`);
  assert.equal(anon.status,200);assert.match(await anon.text(),/name="password"/);
  assert.equal((await post('/meta/staff/login',form({email:'staff@shop.test',password:'pw-staff'}),{origin:'https://evil.example'})).status,403);
  assert.equal((await post('/meta/staff/login',form({email:'staff@shop.test',password:'wrong'}))).status,401);
  const ok=await post('/meta/staff/login',form({email:'staff@shop.test',password:'pw-staff'}));
  assert.equal(ok.status,303);
  const set=ok.headers.get('set-cookie')??'';
  assert.match(set,/^bitpos_meta_staff=[A-Za-z0-9_-]{43}; Path=\/meta\/staff; HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/);
  const cookie=set.split(';')[0];
  const listing=await fetch(`${base}/meta/staff`,{headers:{cookie}});
  assert.equal(listing.headers.get('refresh'),'10');
  const html=await listing.text();
  assert.match(html,new RegExp(`#${pickupCode(openOrder)}`));
  assert.doesNotMatch(html,/psid|5550/i,'no Messenger identity is shown to staff');
  assert.equal((await post(`/meta/staff/orders/${openOrder}/handover`,'',{cookie})).status,409);
  assert.equal((await post(`/meta/staff/orders/${openOrder}/handover`,'',{cookie,origin:'null'})).status,403);
  const out=await post('/meta/staff/logout','',{cookie});
  assert.equal(out.status,303);assert.match(out.headers.get('set-cookie')??'',/Max-Age=0/);
  assert.match(await (await fetch(`${base}/meta/staff`,{headers:{cookie}})).text(),/name="password"/,'session revoked');
 }finally{server.close();}
});
