// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Ordering by chat in Messenger against a disposable PostgreSQL with migrations 001–307 applied. The model
// (Muse Spark) and Stripe are stubbed: no Meta API credit is used. Queries run as `bitpos_app` under RLS.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import pg from 'pg';
import type {MetaDb,OfferDeps,IdentityDeps} from '../apps/api/src/meta/identity';
import {handleMessengerEvents} from '../apps/api/src/meta/identity';
import {messengerImageUrl,parseMessengerWebhook,sendMessenger} from '../apps/api/src/meta/messenger';
import type {EffectiveMenu} from '../apps/api/src/offers';
import {decideStep,handleAgentRequest,matchItem,planPhotoOrder,splitTableOrder,suggestItems,type ChatAgentDeps} from '../apps/api/src/meta/agent';
import {agentReceipt,listMenu,reconcileAgentCheckout} from '../apps/api/src/meta/agent-orders';
import {cartChatReceipt} from '../apps/api/src/meta/cart';
import {wavValid} from '../apps/api/src/meta/voice';
import {kitchenStages,setKitchenStage} from '../apps/api/src/meta/kitchen';
import {chatCart,saveChatCart,talkCart} from '../apps/api/src/meta/cart-agent';
import {postsByDraft,publishPost} from '../apps/api/src/meta/social';
import {handleRpc} from '../apps/api/src/meta/mcp';
import {applyStripeWebhook} from '../apps/api/src/meta/tap-checkout';
import {serveMeta,type MetaRouteDeps} from '../apps/api/src/meta/routes';
import {MetaRouterError} from '../packages/meta-ai/src/types';
import type {MetaRouter} from '../packages/meta-ai/src/router';

const url=process.env.META_TEST_DATABASE_URL;
const skip=!url&&'META_TEST_DATABASE_URL not set';
const A='00000000-0000-4000-8000-000000000001',PAGE_A='100000000001';
const PSID=String(700_000_000+Math.floor(Math.random()*1e8)),STRANGER=String(800_000_000+Math.floor(Math.random()*1e8)),OTHER=String(900_000_000+Math.floor(Math.random()*1e8));
const T0=Date.now();
let admin:pg.Pool,app:pg.Pool,db:MetaDb,identity:IdentityDeps,deps:ChatAgentDeps;
let latte:string,linkId:string,otherLink:string;
const usd=(v:string)=>({currency:'USD' as const,decimals:4 as const,amountMinor:v});
let routerCalls=0,modelReply:any=null,modelThrows=false;
const router={invoke:async()=>{routerCalls++;if(modelThrows)throw new MetaRouterError('ALL_PROVIDERS_FAILED');return {value:modelReply,invocation:{id:'inv-1'},attempts:[]};}} as unknown as MetaRouter;
const sessions=new Map<string,any>();let creates=0,paidPi:string|null=null;
const stripeFetch=async(u:string,init:RequestInit)=>{
 if(init.method==='POST'){creates++;const f=new URLSearchParams(String(init.body));const id=`cs_test_${f.get('client_reference_id')!.replace(/-/g,'')}`;
  const s={object:'checkout.session',id,livemode:false,url:`https://checkout.stripe.com/c/pay/${id}`,amount_total:Number(f.get('line_items[0][price_data][unit_amount]')),currency:f.get('line_items[0][price_data][currency]'),status:'open',payment_status:'unpaid',payment_intent:null,
   metadata:{bitpos_order:f.get('metadata[bitpos_order]'),bitpos_merchant:f.get('metadata[bitpos_merchant]'),bitpos_quote:f.get('metadata[bitpos_quote]')}};
  sessions.set(id,s);return new Response(JSON.stringify(s),{status:200});}
 const s=sessions.get(u.split('/').pop()!);
 return new Response(JSON.stringify(paidPi?{...s,status:'complete',payment_status:'paid',payment_intent:paidPi}:s),{status:200});
};
const msg=(psid:string,m:Record<string,unknown>,ts:number)=>parseMessengerWebhook({object:'page',entry:[{id:PAGE_A,messaging:[{sender:{id:psid},recipient:{id:PAGE_A},timestamp:T0+ts,...m}]}]});
const sign=(raw:string)=>{const ts=Math.floor(Date.now()/1000);return `t=${ts},v1=${createHmac('sha256','whsec_agent').update(`${ts}.${raw}`).digest('hex')}`;};
const stockOf=async()=>Number((await admin.query('SELECT stock FROM products WHERE id=$1',[latte])).rows[0].stock);

before(async()=>{
 if(skip)return;
 admin=new pg.Pool({connectionString:url,max:2,options:'-c search_path=bitpos,public'});
 app=new pg.Pool({connectionString:url,max:4,options:'-c search_path=bitpos,public'});
 app.on('connect',c=>{c.query('SET ROLE bitpos_app');});
 db={query:(sql,params)=>app.query(sql,params as any[]),tenant:async(merchant,fn)=>{const c=await app.connect();try{await c.query('SET ROLE bitpos_app');await c.query('BEGIN');await c.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};
 identity={db,masterKey:Buffer.alloc(16),publicOrigin:'https://pay.example.test'};
 await admin.query(`INSERT INTO meta_messenger_pages(page_id,merchant_id,page_username) VALUES($1,$2,'bitposdemoa') ON CONFLICT DO NOTHING`,[PAGE_A,A]);
 latte=(await admin.query<{id:string}>(`INSERT INTO products(merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,'ลาเต้','Latte','🥛',50000,5) RETURNING id`,[A])).rows[0].id;
 linkId=(await admin.query<{id:string}>("INSERT INTO meta_customer_links(merchant_id,page_id,psid,consent_version) VALUES($1,$2,$3,'bitpos-meta-offers-v1') RETURNING id",[A,PAGE_A,PSID])).rows[0].id;
 otherLink=(await admin.query<{id:string}>("INSERT INTO meta_customer_links(merchant_id,page_id,psid,consent_version) VALUES($1,$2,$3,'bitpos-meta-offers-v1') RETURNING id",[A,PAGE_A,OTHER])).rows[0].id;
 const menu:OfferDeps['menu']=async()=>({merchant:{id:A,name:'demo'},asOf:new Date().toISOString(),priceValidUntil:new Date(Date.now()+3600e3).toISOString(),menuVersion:'v',priceVersion:null,pricingRevision:'1',currency:null,decimals:null,
  products:[{id:latte,catalogKey:null,name:'ลาเต้',nameEn:'Latte',emoji:'🥛',available:5,imageUrl:null,category:'coffee',description:null,basePrice:usd('50000'),unitPrice:usd('40000'),
   promotion:{revision:'1',expiresAt:new Date(Date.now()+3600e3).toISOString(),discount:{kind:'percent',percent:20},priceVersion:A}}]} as unknown as EffectiveMenu);
 deps={db,offers:{menu,router},stripe:{config:{secretKey:'sk_test_x',webhookSecret:'whsec_agent'},fetch:stripeFetch},router,publicOrigin:'https://pay.example.test',modelCallsPerHour:2};
});
after(async()=>{if(!skip){await admin.end();await app.end();}});

test('parser: chat text and Pay presses become events; echoes and empty text do not',()=>{
 const t=msg('555000111222',{message:{mid:'m1',text:'  ขอลาเต้ 1 แก้ว  '}},1)[0].event as any;
 assert.deepEqual([t.kind,t.text],['text','ขอลาเต้ 1 แก้ว']);
 const pay=msg('555000111222',{postback:{payload:'BITPOS_AGENT_PAY:11111111-2222-4333-8444-555555555555'}},2)[0].event as any;
 assert.deepEqual([pay.kind,pay.quoteId],['agent_pay','11111111-2222-4333-8444-555555555555']);
 assert.equal(msg('555000111222',{message:{mid:'m2',text:'hi',is_echo:true}},3).length,0);
 assert.equal(msg('555000111222',{message:{mid:'m3',text:'   '}},4).length,0);
 assert.equal(msg('555000111222',{message:{mid:'m4',text:'stop'}},5)[0].event.kind,'revoke','stop words still disconnect');
});

test('only consented customers reach the agent; a stranger gets the connect hint and no model call',{skip},async()=>{
 const s=await handleMessengerEvents(identity,msg(STRANGER,{message:{mid:`s-${T0}`,text:'latte please'}},10));
 assert.equal(s.agent.length,0);assert.match((s.outbox[0] as any).text,/tap your phone/);
 const k=await handleMessengerEvents(identity,msg(PSID,{message:{mid:`k-${T0}`,text:'latte please'}},11));
 assert.deepEqual([k.outbox.length,k.agent.length,(k.agent[0] as any).linkId],[0,1,linkId]);
 assert.equal((await handleMessengerEvents(identity,msg(PSID,{message:{mid:`k-${T0}`,text:'latte please'}},11))).agent.length,0,'same delivery twice');
});

test('step choice: model picks from the enum; unsafe replies replaced; failures fall back at no cost',{skip},async()=>{
 const items=(await listMenu(deps,A)).filter(i=>i.payable);
 assert.equal(matchItem('ขอลาเต้ 2 แก้วค่ะ',items).action,'quote');
 assert.equal((matchItem('ขอลาเต้ 2 แก้วค่ะ',items) as any).quantity,2);
 assert.equal(matchItem('hello',items).action,'menu');
 modelReply={action:'quote',productId:latte,quantity:2,replyTh:'ได้เลยค่ะ',replyEn:'Coming right up'};
 const s=await decideStep(router,A,'two lattes',items) as any;
 assert.deepEqual([s.action,s.productId,s.quantity,s.chosenBy],['quote',latte,2,'model']);
 modelReply={action:'quote',productId:latte,quantity:1,replyTh:'ราคา 4 ดอลลาร์',replyEn:'Only $4'};
 const unsafe=await decideStep(router,A,'latte',items) as any;
 assert.doesNotMatch(unsafe.replyTh+unsafe.replyEn,/[0-9$]/,'the model never states prices');
 modelThrows=true;
 assert.equal((await decideStep(router,A,'latte',items)).chosenBy,'fallback');
 modelThrows=false;
});

test('chat order: server-priced quote → Pay → one Checkout → signed webhook → receipt once; stock once',{skip},async()=>{
 routerCalls=0;
 modelReply={action:'quote',productId:latte,quantity:1,replyTh:'ได้เลยค่ะ',replyEn:'Sure'};
 const [replyMsg,quoteMsg]=await handleAgentRequest(deps,{merchantId:A,linkId,psid:PSID,kind:'text',text:'one latte'}) as any[];
 assert.match(replyMsg.text,/Muse Spark/);
 assert.equal(quoteMsg.kind,'cards');assert.match(quoteMsg.cards[0].title,/\$4\.00/);
 const quoteId=quoteMsg.cards[0].buttons[0].payload.split(':')[1];
 const q=(await admin.query('SELECT channel,link_id,amount_minor::text FROM meta_quotes WHERE id=$1',[quoteId])).rows[0];
 assert.deepEqual([q.channel,q.link_id,q.amount_minor],['messenger',linkId,'400']);
 // A chat quote cannot be paid through the connector's SPT path.
 const viaMcp:any=await handleRpc(deps,A,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'complete_checkout',arguments:{quote_id:quoteId,shared_payment_token:'spt_test_x'}}});
 assert.equal(viaMcp.result.structuredContent.error,'NOT_FOUND');
 // Another customer cannot pay (or see) this quote.
 const [stranger]=await handleAgentRequest(deps,{merchantId:A,linkId:otherLink,psid:OTHER,kind:'agent_pay',quoteId}) as any[];
 assert.match(stranger.text,/not found/i);
 creates=0;
 const [payMsg]=await handleAgentRequest(deps,{merchantId:A,linkId,psid:PSID,kind:'agent_pay',quoteId}) as any[];
 assert.equal(payMsg.buttons[0].type,'web_url');assert.match(payMsg.buttons[0].url,/^https:\/\/checkout\.stripe\.com\//);
 const [again]=await handleAgentRequest(deps,{merchantId:A,linkId,psid:PSID,kind:'agent_pay',quoteId}) as any[];
 assert.deepEqual([again.buttons[0].url,creates],[payMsg.buttons[0].url,1],'one Checkout per quote');
 const session=[...sessions.values()].at(-1);
 assert.deepEqual([session.amount_total,session.metadata.bitpos_quote],[400,quoteId]);
 const order=(await admin.query<{id:string}>('SELECT id FROM meta_agent_orders WHERE quote_id=$1',[quoteId])).rows[0].id;

 const s0=await stockOf();const receipts:string[]=[];
 const event={id:`evt_chat${T0}`,type:'payment_intent.succeeded',livemode:false,created:1,data:{object:{object:'payment_intent',id:`pi_chat${T0}`,status:'succeeded',amount_received:400,currency:'usd',
  metadata:{bitpos_merchant:A,bitpos_order:order,bitpos_quote:quoteId,bitpos_checkout:order}}}};
 const raw=JSON.stringify(event);
 const onConfirmed=async(m:string,o:string)=>{const r=await agentReceipt(db,m,o);if(r)receipts.push(`${r.psid}:${r.text}`);};
 assert.equal(await applyStripeWebhook(identity,deps.stripe!,raw,sign(raw),undefined,onConfirmed),'PAID');
 assert.equal(await applyStripeWebhook(identity,deps.stripe!,raw,sign(raw),undefined,onConfirmed),'DUPLICATE_EVENT');
 assert.equal(receipts.length,1);assert.match(receipts[0],new RegExp(`^${PSID}:จ่ายแล้ว`));assert.match(receipts[0],/#[0-9A-F]{4}/);
 assert.equal(await stockOf(),s0-1);
 const [paid]=await handleAgentRequest(deps,{merchantId:A,linkId,psid:PSID,kind:'agent_pay',quoteId}) as any[];
 assert.match(paid.text,/Already paid/);

 // Credit guard: at most modelCallsPerHour model calls per customer; the rest use the free matcher.
 for(let i=0;i<3;i++)await handleAgentRequest(deps,{merchantId:A,linkId,psid:PSID,kind:'text',text:'latte'});
 assert.equal(routerCalls,2);
});

test('return page: Stripe lookup confirms once; a redirect alone proves nothing',{skip},async()=>{
 modelReply={action:'quote',productId:latte,quantity:1,replyTh:'ได้เลยค่ะ',replyEn:'Sure'};
 const [,quoteMsg]=await handleAgentRequest({...deps,router:null},{merchantId:A,linkId:otherLink,psid:OTHER,kind:'text',text:'Latte'}) as any[];
 const quoteId=quoteMsg.cards[0].buttons[0].payload.split(':')[1];
 await handleAgentRequest(deps,{merchantId:A,linkId:otherLink,psid:OTHER,kind:'agent_pay',quoteId});
 const order=(await admin.query<{id:string}>('SELECT id FROM meta_agent_orders WHERE quote_id=$1',[quoteId])).rows[0].id;
 paidPi=null;
 assert.equal((await reconcileAgentCheckout(deps,order))?.status,'PENDING','unpaid session stays pending');
 paidPi=`pi_lookup${randomBytes(4).toString('hex')}`;
 const first=await reconcileAgentCheckout(deps,order);
 assert.deepEqual([first?.status,first?.confirmedNow],['CONFIRMED',true]);
 assert.equal((await reconcileAgentCheckout(deps,order))?.confirmedNow,false,'receipt is sent once');
 assert.equal(await reconcileAgentCheckout(deps,'not-a-uuid'),null);
 paidPi=null;
});

test('web order page: signed-in customers only, nonce CSP for browser speech, same quote and Checkout as chat',{skip},async()=>{
 const token=randomBytes(32).toString('base64url');
 await admin.query("INSERT INTO meta_customer_sessions(merchant_id,link_id,token_sha256,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 day')",[A,linkId,createHash('sha256').update(token).digest()]);
 const asrCalls:{url:string;request:any;audio:number}[]=[];
 const asrFetch=async(u:string,init:RequestInit)=>{const f=init.body as FormData;asrCalls.push({url:u,request:JSON.parse(await (f.get('request') as Blob).text()),audio:(f.get('audio') as Blob).size});
  return new Response(JSON.stringify({sessionId:'s',transcript:'ขอ Latte 1 แก้ว',audioDurationMs:1200,turns:[]}),{status:200});};
 const routeDeps:MetaRouteDeps={identity,messenger:null,offers:{menu:deps.offers.menu,router:null},stripe:deps.stripe,asr:{baseUrl:'https://api.meta.example/v1',apiKey:'k',model:'muse-voice-transcribe-1.0'},asrFetch};
 const server=http.createServer(async(req,res)=>{if(!(await serveMeta(req,res,routeDeps))){res.writeHead(404);res.end();}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const cookie=`bitpos_meta=${token}`,origin='https://pay.example.test';
 const post=(path:string,body:Record<string,string>,headers:Record<string,string>={})=>fetch(base+path,{method:'POST',redirect:'manual',body:new URLSearchParams(body).toString(),headers:{'content-type':'application/x-www-form-urlencoded',cookie,origin,...headers}});
 try{
  assert.equal((await fetch(`${base}/meta/order`)).status,401);
  const page=await fetch(`${base}/meta/order`,{headers:{cookie}});
  assert.equal(page.status,200);
  const csp=page.headers.get('content-security-policy')??'',html=await page.text();
  const nonce=csp.match(/script-src 'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
  assert.ok(nonce);assert.ok(html.includes(`<script nonce="${nonce}">`));
  const js=html.split(`<script nonce="${nonce}">`)[1].split('</script>')[0];assert.doesNotThrow(()=>new Function(js),'page script parses');assert.match(js,/\/meta\/order\/live/);assert.match(csp,/connect-src 'self' wss:\/\//);assert.match(html,/th-TH/);
  assert.equal((await post('/meta/order',{q:'Latte'},{origin:'https://evil.example'})).status,403);
  // Muse Voice Transcribe: WAV in, transcript out; the menu names bias recognition; junk audio never reaches Muse.
  const voice=(body:Buffer,type='audio/wav',o=origin)=>fetch(base+'/meta/order/voice',{method:'POST',body:new Uint8Array(body),headers:{'content-type':type,cookie,origin:o}});
  const v=await voice(testWav());assert.equal(v.status,200);assert.deepEqual(await v.json(),{transcript:'ขอ Latte 1 แก้ว'});
  assert.match(asrCalls[0].url,/^https:\/\/api\.meta\.example\/v1\/asr\/transcribe\?sessionId=/);assert.deepEqual([asrCalls[0].request.audioEncoding,asrCalls[0].request.mode],['WAV','PUSH_TO_TALK']);
  assert.ok(asrCalls[0].request.keywords.includes('Latte'),'menu names as keywords');
  assert.equal((await voice(Buffer.from('not a wav at all, just some bytes......................'))).status,400);
  assert.equal((await voice(testWav(),'text/plain')).status,415);assert.equal((await voice(testWav(),'audio/wav','https://evil.example')).status,403);
  assert.equal((await fetch(base+'/meta/order/voice',{method:'POST',body:new Uint8Array(testWav()),headers:{'content-type':'audio/wav',origin}})).status,401,'signed-in customers only');
  assert.equal(asrCalls.length,1,'only the valid clip was sent to Muse');
  const quote=await post('/meta/order',{q:'ขอ Latte 1 แก้ว'});
  assert.equal(quote.status,200);const qh=await quote.text();
  assert.match(qh,/\$4\.00/);
  const quoteId=qh.match(/name="quote" value="([0-9a-f-]{36})"/)![1];
  const pay=await post('/meta/order/pay',{quote:quoteId});
  assert.equal(pay.status,303);assert.match(pay.headers.get('location')??'',/^https:\/\/checkout\.stripe\.com\//);
  const other=await post('/meta/order/pay',{quote:'11111111-2222-4333-8444-555555555555'});
  assert.equal(other.status,409,'an unknown or foreign quote cannot be paid');
 }finally{server.close();}
});

test('menu cards, one-tap order and My orders: no model call; receipt template with a text fallback',{skip},async()=>{
 const calls0=routerCalls;
 const ev=msg(PSID,{postback:{payload:'BITPOS_MENU'}},50)[0].event;assert.equal(ev.kind,'menu');
 assert.equal(msg(PSID,{postback:{payload:`BITPOS_AGENT_ADD:${latte}`}},51)[0].event.kind,'agent_add');
 assert.equal(msg(PSID,{postback:{payload:'BITPOS_MY_ORDERS'}},52)[0].event.kind,'my_orders');
 const [intro,cards]=await handleAgentRequest(deps,{merchantId:A,linkId,psid:PSID,kind:'menu'}) as any[];
 assert.equal(intro.kind,'text');assert.equal(cards.kind,'cards');
 const card=cards.cards.find((c:any)=>c.buttons[0].payload===`BITPOS_CART_ADD:${latte}:1`);
 assert.match(card.title,/\$4\.00/);assert.match(card.subtitle,/−20%/);
 const [quote]=await handleAgentRequest(deps,{merchantId:A,linkId,psid:PSID,kind:'agent_add',productId:latte}) as any[];
 assert.equal(quote.kind,'cards');assert.match(quote.cards[0].buttons[0].payload,/^BITPOS_AGENT_PAY:/);
 const [mine,mineCards]=await handleAgentRequest(deps,{merchantId:A,linkId,psid:PSID,kind:'my_orders'}) as any[];
 assert.equal(mineCards.kind,'cards');assert.match(mineCards.cards[0].title,/#[0-9A-F]{4}/);assert.deepEqual(mineCards.quick.map((q:any)=>q.payload),['BITPOS_SUGGEST','BITPOS_MENU','BITPOS_MY_ORDERS','BITPOS_BOOK'],'chips under the last reply');
 assert.match(mine.text,/รายการล่าสุด/);
 assert.equal(routerCalls,calls0,'menu, one-tap order and My orders never call the model');
 // Receipt: Messenger receipt template; if Messenger refuses it, the same facts go out as text.
 const order=(await admin.query<{id:string}>("SELECT id FROM meta_agent_orders WHERE link_id=$1 AND status='CONFIRMED' ORDER BY created_at DESC LIMIT 1",[linkId])).rows[0].id;
 const r=(await agentReceipt(db,A,order,'https://pay.example.test'))!;
 assert.deepEqual([r.receipt.currency,r.receipt.total,r.receipt.elements[0].quantity],['USD',4,1]);
 const sent:any[]=[];let refuse=true;
 const cfg={appSecret:'s',verifyToken:'v',pageToken:'p',graphVersion:'v24.0'};
 await sendMessenger(cfg,{kind:'receipt',psid:PSID,receipt:r.receipt,fallbackText:r.text},async(_u,init)=>{const b=JSON.parse(String(init.body));sent.push(b);const ok=!(refuse&&b.message.attachment);return new Response('{}',{status:ok?200:400});});
 assert.equal(sent[0].message.attachment.payload.template_type,'receipt');
 assert.equal(sent[0].message.attachment.payload.summary.total_cost,4);
 assert.match(sent[1].message.text,/จ่ายแล้ว/,'fallback text after a refused template');
});

test('chat cart: the cart rides in the payload, the server re-prices it, one Checkout, receipt back to the chat',{skip},async()=>{
 const calls0=routerCalls;
 const ev=msg(PSID,{postback:{payload:`BITPOS_CART_ADD:${latte}:2`}},60)[0].event as any;assert.deepEqual([ev.kind,ev.cart],['cart_add',`${latte}:2`]);
 assert.equal(msg(PSID,{postback:{payload:`BITPOS_CART_PAY:${latte}:2,not-a-cart`}},61).length,0,'malformed cart payload ignored');
 const [note,card]=await handleAgentRequest(deps,{merchantId:A,linkId,psid:PSID,kind:'cart_add',cart:`${latte}:2`}) as any[];
 assert.match(note.text,/×2 = \$8\.00/);assert.match(note.text,/−\$2\.00/,'approved discount shown');assert.match(card.cards[0].title,/2 ชิ้น · \$8\.00/);
 assert.equal(card.cards[0].buttons[0].payload,`BITPOS_CART_PAY:${latte}:2`);assert.ok(card.quick,'chips');
 const [, more]=await handleAgentRequest(deps,{merchantId:A,linkId,psid:PSID,kind:'cart_menu',cart:`${latte}:2`}) as any[];
 assert.equal(more.cards[0].buttons[0].payload,`BITPOS_CART_ADD:${latte}:3`,'adding keeps the cart');
 const [pay]=await handleAgentRequest(deps,{merchantId:A,linkId,psid:PSID,kind:'cart_pay',cart:`${latte}:2`}) as any[];
 assert.equal(pay.buttons[0].type,'web_url');assert.match(pay.buttons[0].url,/^https:\/\/checkout\.stripe\.com\//);
 const o=(await admin.query<{id:string;amount_minor:string;channel:string}>("SELECT id,amount_minor::text,channel FROM meta_cart_orders WHERE link_id=$1 ORDER BY created_at DESC LIMIT 1",[linkId])).rows[0];
 assert.deepEqual([o.channel,o.amount_minor],['chat','800'],'server price, chat channel');
 assert.equal(await cartChatReceipt(db,A,o.id,'https://pay.example.test'),null,'no receipt before paid');
 await admin.query("UPDATE meta_cart_orders SET status='PAID',paid_at=now(),paid_source='webhook',stripe_payment_intent_id='pi_testchat1' WHERE id=$1",[o.id]);
 const r=(await cartChatReceipt(db,A,o.id,'https://pay.example.test'))!;
 assert.deepEqual([r.psid,r.receipt.total,r.receipt.subtotal,r.receipt.discount,r.receipt.elements[0].quantity],[PSID,8,10,2,2]);assert.match(r.text,/ส่วนลด −\$2\.00/);
 // Kitchen stages (migration 316): Ready tells the customer once; nothing moves after hand-over.
 const staffUser=(await admin.query<{user_id:string}>('SELECT user_id FROM members WHERE merchant_id=$1 LIMIT 1',[A])).rows[0]?.user_id??randomUUID();
 assert.equal((await setKitchenStage(db,A,staffUser,o.id,'PREPARING')).notify,null);
 assert.deepEqual((await setKitchenStage(db,A,staffUser,o.id,'READY')).notify,{psid:PSID,code:o.id.replace(/-/g,'').slice(0,4).toUpperCase()});
 assert.equal((await setKitchenStage(db,A,staffUser,o.id,'READY')).notify,null,'ready notice once');
 assert.equal((await kitchenStages(db,A)).get(o.id),'READY');
 const [,mine]=await handleAgentRequest(deps,{merchantId:A,linkId,psid:PSID,kind:'my_orders'}) as any[];
 assert.ok(mine.cards.some((c:any)=>c.title.includes('×2')&&/จ่ายแล้ว/.test(c.subtitle)),'cart order in My orders');
 const bad=await handleAgentRequest(deps,{merchantId:A,linkId,psid:PSID,kind:'cart_add',cart:`${latte}:20`}) as any[];assert.match(bad[0].text,/ของไม่พอ/);
 assert.equal(routerCalls,calls0,'the cart never calls the model');
});

test('Get Started: a connected customer gets the picture menu; a stranger gets how to connect; no model call',{skip},async()=>{
 const calls0=routerCalls;
 assert.equal(msg(PSID,{postback:{payload:'BITPOS_GET_STARTED'}},70)[0].event.kind,'welcome');
 assert.equal(msg(PSID,{postback:{payload:'BITPOS_HELP'}},71)[0].event.kind,'welcome');
 const [hi,cards]=await handleAgentRequest(deps,{merchantId:A,linkId,psid:PSID,kind:'welcome'}) as any[];
 assert.match(hi.text,/ยินดีต้อนรับ/);assert.equal(cards.cards.length,3);
 assert.deepEqual(cards.cards.map((c:any)=>c.buttons[0].payload),['BITPOS_MENU','BITPOS_BOOK','BITPOS_MY_ORDERS']);assert.ok(cards.quick,'chips');
 const s=await handleMessengerEvents(identity,msg(STRANGER,{postback:{payload:'BITPOS_GET_STARTED'}},72));
 assert.equal(s.agent.length,0,'a stranger never reaches the agent');
 const g=s.outbox[0] as any;assert.equal(g.kind,'cards');assert.match(g.cards[0].buttons[0].url,/\/help#tap$/);
 assert.equal(routerCalls,calls0);
});

/** A short 16 kHz mono 16-bit PCM WAV of silence. */
function testWav(rate=16000,channels=1,ms=500):Buffer{
 const n=Math.floor(rate*ms/1000)*channels*2,b=Buffer.alloc(44+n);
 b.write('RIFF',0);b.writeUInt32LE(36+n,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(channels,22);
 b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*channels*2,28);b.writeUInt16LE(channels*2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n,40);return b;
}
test('WAV check: RIFF/WAVE integer PCM mono 16 or 24 kHz only',()=>{
 assert.ok(wavValid(testWav()));assert.ok(wavValid(testWav(24000)));
 assert.ok(!wavValid(testWav(44100)),'44.1 kHz');assert.ok(!wavValid(testWav(16000,2)),'stereo');assert.ok(!wavValid(Buffer.alloc(100)));
});

test('free matcher: several items in one sentence become a cart, with Thai or digit quantities; longer names win',()=>{
 const item=(id:string,name:string,nameEn:string)=>({productId:id,name,nameEn,emoji:'',category:null,available:9,imageUrl:null,price:{amountMinor:'400',currency:'USD',display:'$4.00'},basePrice:{amountMinor:'400',display:'$4.00'},offer:null,payable:true}) as any;
 const L='11111111-1111-4111-8111-000000000001',I='11111111-1111-4111-8111-000000000002',C='11111111-1111-4111-8111-000000000003';
 const items=[item(L,'ลาเต้','Latte'),item(I,'ลาเต้เย็น','Iced Latte'),item(C,'ครัวซองต์','Croissant')];
 const a=matchItem('ขอลาเต้สองแก้วกับครัวซองต์หนึ่งชิ้นค่ะ',items) as any;
 assert.equal(a.action,'cart');assert.deepEqual(a.lines,[{productId:L,quantity:2},{productId:C,quantity:1}]);
 const b=matchItem('2 iced latte and a croissant',items) as any;
 assert.deepEqual(b.lines,[{productId:I,quantity:2},{productId:C,quantity:1}],'Iced Latte (not Latte), number before the name');
 const c=matchItem('ขอลาเต้ 3 แก้ว',items) as any;assert.deepEqual([c.action,c.productId,c.quantity],['quote',L,3]);
 assert.equal(matchItem('สวัสดี',items).action,'menu');
});

test('photo order: Messenger CDN images only; Muse Spark picks a listed item; the server prices it',{skip},async()=>{
 assert.ok(messengerImageUrl('https://scontent.xx.fbcdn.net/v/t1/abc.jpg?x=1'));assert.ok(messengerImageUrl('https://cdn.fbsbx.com/v/a.jpg'));
 for(const bad of ['http://scontent.fbcdn.net/a.jpg','https://evil.example/fbcdn.net.jpg','https://fbcdn.net.evil.example/a.jpg','https://u:p@x.fbcdn.net/a',''])assert.ok(!messengerImageUrl(bad),bad);
 const ev=msg(PSID,{message:{mid:'p1',attachments:[{type:'image',payload:{url:'https://scontent.xx.fbcdn.net/v/a.jpg'}}]}},80)[0].event as any;
 assert.deepEqual([ev.kind,ev.url],['photo','https://scontent.xx.fbcdn.net/v/a.jpg']);
 assert.equal(msg(PSID,{message:{mid:'p2',attachments:[{type:'image',payload:{url:'https://evil.example/a.jpg'}}]}},81).length,0,'other hosts ignored');
 let seen:any=null;
 const router={invoke:async(r:any)=>{seen=r;return {value:{productId:latte,alternatives:[latte,'none'],confidence:'medium',replyTh:'เหมือนลาเต้เลยค่ะ',replyEn:'Looks like a latte'},invocation:{id:randomUUID()},attempts:[]};}} as any;
 const pd:ChatAgentDeps={...deps,router,modelCallsPerHour:50};
 const p=await planPhotoOrder(pd,A,linkId,'data:image/jpeg;base64,/9j/AAAA') as any;
 assert.equal(p.kind,'photo');assert.equal(p.match.productId,latte);assert.equal(p.alternatives.length,0,'no repeat of the match');
 assert.equal(seen.messages[1].content[1].type,'image_url');
 const out=await handleAgentRequest(pd,{merchantId:A,linkId,psid:PSID,kind:'photo',url:'https://scontent.xx.fbcdn.net/v/a.jpg'}) as any[];
 assert.match(out[0].text,/ไม่แน่ใจ/,'medium confidence is said');assert.equal(out[1].cards[0].buttons[0].payload,`BITPOS_CART_ADD:${latte}:1`);
 const none=await planPhotoOrder({...deps,router:null},A,linkId,'data:image/jpeg;base64,/9j/AAAA');assert.equal(none.kind,'error','no model, no guess');
});

test('what to eat: listed items only, digit-free reasons, fallback without a model; Messenger chip',{skip},async()=>{
 assert.equal(msg(PSID,{postback:{payload:'BITPOS_SUGGEST'}},90)[0].event.kind,'suggest');
 const router={invoke:async()=>({value:{picks:[{productId:latte,reasonTh:'อุ่นๆ ช่วงบ่าย',reasonEn:'Warm for the afternoon'},{productId:latte,reasonTh:'ซ้ำ',reasonEn:'dup'}]},invocation:{id:randomUUID()},attempts:[]})} as any;
 const r=await suggestItems({...deps,router,modelCallsPerHour:50},A,linkId);
 assert.equal(r.by,'Muse Spark');assert.equal(r.picks.length,1,'duplicates dropped');assert.equal(r.picks[0].item.productId,latte);
 const bad={invoke:async()=>({value:{picks:[{productId:latte,reasonTh:'ลด 20%',reasonEn:'20% off'}]},invocation:{id:randomUUID()},attempts:[]})} as any;
 assert.equal((await suggestItems({...deps,router:bad,modelCallsPerHour:50},A,linkId)).picks[0].reasonEn,'Recommended by the shop','no numbers from the model');
 const none=await suggestItems({...deps,router:null},A,linkId);assert.equal(none.by,'');assert.ok(none.picks.length>=1);
 const [t,cards]=await handleAgentRequest({...deps,router,modelCallsPerHour:50},{merchantId:A,linkId,psid:PSID,kind:'suggest'}) as any[];
 assert.match(t.text,/Muse Spark/);assert.match(cards.cards[0].subtitle,/afternoon/);
});

test('table order: one cart per speaker; model output limited to listed items and speakers; matcher fallback',{skip},async()=>{
 const turns=[{speaker:'A',transcript:'ผมเอา Latte สองแก้ว'},{speaker:'B',transcript:'ฉันเอา Latte หนึ่ง'},{speaker:'A',transcript:'แค่นั้นครับ'}];
 const router={invoke:async(r:any)=>{const u=JSON.parse(r.messages[1].content);assert.equal(u.speakers.length,2,'turns grouped per speaker');
  return {value:{people:[{speaker:'A',labelTh:'คนที่ 1',labelEn:'Person 1',lines:[{productId:latte,quantity:2}]},{speaker:'B',labelTh:'คนที่ 2',labelEn:'Person 2',lines:[{productId:latte,quantity:1}]},{speaker:'A',labelTh:'x',labelEn:'x',lines:[]}]},invocation:{id:randomUUID()},attempts:[]};}} as any;
 const r=await splitTableOrder({...deps,router,modelCallsPerHour:50},A,linkId,turns);
 assert.equal(r.by,'Muse Spark');assert.deepEqual(r.people.map(p=>[p.speaker,p.lines[0].quantity]),[['A',2],['B',1]],'duplicate speaker dropped');
 const f=await splitTableOrder({...deps,router:null},A,linkId,turns);
 assert.deepEqual(f.people.map(p=>[p.labelEn,p.lines[0].quantity]),[['Person 1',2],['Person 2',1]]);
});

test('cart conversation: tools edit the stored cart step by step; no prices from the model; pay; booking handed back',{skip},async()=>{
 const runTools=(script:(call:(name:string,args:unknown)=>Promise<unknown>)=>Promise<string>)=>({invoke:async()=>{throw Error('unused');},invokeTools:async(req:any)=>{const calls:any[]=[];
  const call=async(name:string,args:unknown)=>{const t=req.tools.find((x:any)=>x.name===name);const a=t.args.parse(args);calls.push({name,args:a,ok:true});return t.run(a);};
  const text=await script(call);return {text,calls,invocations:[],model:'muse-spark-1.3'};}}) as any;
 await saveChatCart(db,A,linkId,[]);
 const one=await talkCart({...deps,router:runTools(async call=>{await call('add_item',{productId:latte,quantity:2});return 'ใส่ลาเต้ให้แล้วค่ะ ราคา $8';})},A,linkId,'ขอลาเต้สองแก้ว');
 assert.deepEqual(one.cart,[{productId:latte,quantity:2}]);assert.doesNotMatch(one.reply,/\$|8/,'model prices removed');
 assert.deepEqual(await chatCart(db,A,linkId),[{productId:latte,quantity:2}],'cart stored');
 const two=await talkCart({...deps,router:runTools(async call=>{const v:any=await call('view_cart',{});assert.equal(v.lines[0].quantity,2);await call('set_quantity',{productId:latte,quantity:1});return 'เหลือแก้วเดียวค่ะ';})},A,linkId,'เอาแก้วเดียวพอ');
 assert.equal(two.cart[0].quantity,1);
 await assert.rejects(talkCart({...deps,router:runTools(async call=>{await call('add_item',{productId:randomUUID(),quantity:1});return '';})},A,linkId,'x'),'unknown products refused');
 const pay=await talkCart({...deps,router:runTools(async call=>{await call('checkout',{});return 'ไปจ่ายกันค่ะ';})},A,linkId,'จ่ายเลย');assert.ok(pay.checkout);
 const book=await talkCart({...deps,router:runTools(async call=>{await call('booking',{});return '';})},A,linkId,'จองโต๊ะ');assert.ok(book.booking);
 await saveChatCart(db,A,linkId,[]);
});

test('Facebook post drafts: published only on request, Graph errors kept, never twice',{skip},async()=>{
 const img=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47]),Buffer.alloc(200)]);
 const ins=async()=>(await admin.query<{id:string}>("INSERT INTO meta_social_posts(merchant_id,draft_id,caption,mime,image,created_by) VALUES($1,$2,'ลองเลย #MuseCafe','image/png',$3,$4) RETURNING id",[A,randomUUID(),img,randomUUID()])).rows[0].id;
 const cfg={appSecret:'s',verifyToken:'v',pageToken:'pt',graphVersion:'v24.0',graphBase:'https://graph.example'};
 const seen:any[]=[];
 const ok=async(u:string,i:RequestInit)=>{seen.push({u,caption:(i.body as FormData).get('caption'),auth:(i.headers as any).Authorization});return new Response(JSON.stringify({id:'1',post_id:'123_456'}),{status:200});};
 const id=await ins();
 const r=await publishPost(db,cfg,A,randomUUID(),id,'แก้ข้อความแล้ว',ok);
 assert.deepEqual(r,{ok:true,detail:'123_456'});assert.match(seen[0].u,/^https:\/\/graph\.example\/v24\.0\/\d+\/photos$/);assert.equal(seen[0].caption,'แก้ข้อความแล้ว');assert.equal(seen[0].auth,'Bearer pt');
 await assert.rejects(publishPost(db,cfg,A,randomUUID(),id,null,ok),'never twice');
 const id2=await ins();
 const denied=await publishPost(db,cfg,A,randomUUID(),id2,null,async()=>new Response(JSON.stringify({error:{code:200,error_subcode:1}}),{status:403}));
 assert.deepEqual(denied,{ok:false,detail:'403/200/1'});
 const p=(await postsByDraft(db,A));assert.ok([...p.values()].flat().some(x=>x.id===id2&&x.state==='FAILED'&&x.failure==='403/200/1'),'failure kept for the owner');
});
