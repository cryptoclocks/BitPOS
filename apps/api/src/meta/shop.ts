// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// meta-pay customer shop at the host root, following design/figcraft-meta C18–C27: home, menu, item, cart,
// Stripe Checkout, receipt and help for the Meta demo shop (META_DEMO_MERCHANT). Ordering here needs no account:
// the cart cookie holds only product ids and quantities; prices come from the server when the order is made.
import type http from 'node:http';
import {cartOrderMerchant,cartReceipt,CartError,formatCart,parseCart,quoteCart,startCart} from './cart';
import {listMenu,type AgentDeps,type MenuItem} from './agent-orders';
import {customerHtml,esc,photo,pill,row,status} from './ui';
import type {MetaRouteDeps} from './routes';
import {isTourist,menuNames,TOURIST,TOURIST_UI,type TouristLang} from './translate';
import {liveBanners} from './banners';

const CART='bitpos_meta_cart',TABLE='bitpos_meta_table',LANG='bitpos_meta_lang',MAX_FORM=4096;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CATS:[string,string][]=[['','ทั้งหมด'],['Coffee','กาแฟ'],['Tea & Chocolate','ชาและโกโก้'],['Bakery','เบเกอรี่'],['Desserts','ของหวาน']];
const ERR:Record<CartError['code'],string>={EMPTY:'ตะกร้ายังว่าง / Your cart is empty.',INVALID_INPUT:'คำขอไม่ถูกต้อง / Invalid request.',NOT_FOUND:'บางเมนูไม่มีแล้ว / An item is no longer on the menu.',
 OUT_OF_STOCK:'บางเมนูหมด / An item is sold out.',MIXED_CURRENCY:'สกุลเงินไม่ตรงกัน / Mixed currencies.',BELOW_MINIMUM:'ยอดต่ำกว่าขั้นต่ำของ Stripe / Below Stripe’s minimum.',
 PAYMENTS_UNAVAILABLE:'ยังรับชำระไม่ได้ / Payments are not available.',NOT_CANCELLABLE:'ยกเลิกไม่ได้แล้ว / Can no longer be cancelled.',ENDED:'รายการนี้ปิดแล้ว / This order is closed.'};

function cookie(req:http.IncomingMessage,name:string):string|null{
 for(const part of (req.headers.cookie??'').split(';')){const [k,...v]=part.trim().split('=');if(k===name)return decodeURIComponent(v.join('='));}
 return null;
}
const setCookie=(deps:MetaRouteDeps,name:string,value:string,maxAge:number)=>`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${deps.identity.publicOrigin.startsWith('https:')?'; Secure':''}`;
function send(res:http.ServerResponse,status:number,html:string,headers:Record<string,string|string[]>={}){
 res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https:; form-action 'self' https://checkout.stripe.com",
  'Referrer-Policy':'same-origin','X-Content-Type-Options':'nosniff',...headers});res.end(html);
}
const redirect=(res:http.ServerResponse,to:string,headers:Record<string,string|string[]>={})=>{res.writeHead(303,{Location:to,'Cache-Control':'no-store',...headers});res.end();};
async function form(req:http.IncomingMessage):Promise<URLSearchParams|null>{
 const parts:Buffer[]=[];let n=0;for await(const c of req){n+=c.length;if(n>MAX_FORM)return null;parts.push(c);}
 return new URLSearchParams(Buffer.concat(parts).toString('utf8'));
}
export function agentDepsOf(deps:MetaRouteDeps):AgentDeps|null{
 return deps.offers?{db:deps.identity.db,offers:deps.offers,stripe:deps.stripe?{config:deps.stripe.config,fetch:deps.stripe.fetch}:null}:null;
}
const price=(m:MenuItem)=>m.offer?`${esc(m.price.display)} <small><s>${esc(m.basePrice.display)}</s></small>`:esc(m.price.display);

/** Returns true when the request was a shop page and has been answered. */
export async function serveShop(req:http.IncomingMessage,res:http.ServerResponse,deps:MetaRouteDeps|null):Promise<boolean>{
 const url=new URL(req.url??'/','http://local'),path=url.pathname,method=req.method??'GET';
 if(path.startsWith('/meta/'))return false;
 const host=(req.headers.host??'').toLowerCase(),staffOrigin=deps?.staff?.config.origin;
 // meta-pos host: its root is the staff sign-in; nothing else lives outside /meta/staff there.
 if(deps&&staffOrigin&&host===new URL(staffOrigin).host){if(path==='/'){redirect(res,'/meta/staff');return true;}return false;}
 const shop=['/','/menu','/cart','/help','/checkout','/cart/add','/cart/set'].includes(path)||/^\/(item|receipt|pay)\/[0-9a-f-]{36}$/.test(path);
 if(!shop)return false;
 const merchant=deps?.demoMerchant,agent=deps&&agentDepsOf(deps);
 if(!deps||!merchant||!agent){send(res,503,customerHtml({title:'ยังไม่พร้อม'},status('🛠️','am','ร้านยังไม่พร้อม',['Shop not configured on this server.'])));return true;}
 if(method==='POST'&&req.headers.origin!==deps.identity.publicOrigin){send(res,403,customerHtml({title:'ไม่อนุญาต',nav:[['เปิดหน้าร้านใหม่','/'],['ช่วยเหลือ','/help']]},status('🛡️','rd','คำขอไม่ถูกต้อง',['ฟอร์มต้องส่งจากหน้าของร้านเอง เปิดหน้าใหม่แล้วลองอีกครั้ง','Same-origin request required.'])));return true;}
 const cart=parseCart(cookie(req,CART));const count=cart.reduce((n,l)=>n+l.quantity,0);
 // Tourist mode: ?l=ja|zh|ko|fr|de|es picks a language (remembered), ?l=th goes back to Thai/English.
 const ql=url.searchParams.get('l'),saved=cookie(req,LANG);
 const lang:TouristLang|null=isTourist(ql)?ql:ql==='th'?null:isTourist(saved)?saved:null;
 const langCookie=ql===null?null:setCookie(deps,LANG,lang??'',lang?30*86400:0);
 const ui=lang?TOURIST_UI[lang]:null;
 const names=async(items:MenuItem[])=>lang?menuNames(deps.identity.db,deps.offers?.router??null,merchant,lang,items):new Map<string,string>();
 const langChips=(here:string)=>`<div class="chips">${[['th','ไทย · EN'],...Object.entries(TOURIST).map(([k,v])=>[k,v[0]])].map(([k,l])=>`<a class="pill${(lang??'th')===k?'':' mu'}" href="${here}${here.includes('?')?'&':'?'}l=${k}">${k==='th'?'🌐 ':''}${esc(l)}</a>`).join('')}</div>`;
 const cartBar=(total?:string)=>count?`<a class="bar" href="/cart"><span>${ui?esc(ui.cart):'ตะกร้า'} · ${count}${ui?'':' รายการ'}</span><span>${total?esc(total)+' ':''}→</span></a>`:'';
 try{
  if(path==='/'&&method==='GET'){
   let tableCookie:string|null=null,tableLabel:string|null=null;const want=url.searchParams.get('table');
   if(want){const t=(await deps.identity.db.tenant(merchant,c=>c.query<{id:string;label:string}>('SELECT id,label FROM merchant_tables WHERE retired_at IS NULL AND (label=$1 OR id::text=$1)',[want]))).rows[0];
    if(t){tableCookie=t.id;tableLabel=t.label;}}
   else{const id=cookie(req,TABLE);if(id&&UUID.test(id))tableLabel=(await deps.identity.db.tenant(merchant,c=>c.query<{label:string}>('SELECT label FROM merchant_tables WHERE id=$1',[id]))).rows[0]?.label??null;}
   const body=`<img class="hero" src="/meta/images/menu/iced-latte.jpg" alt=""><div class="card"><h1>Muse Café${tableLabel?` · ${esc(tableLabel)}`:''}</h1><p class="mu">สั่งจากมือถือ จ่ายด้วย Stripe · Order from your phone, pay with Stripe</p>${pill('เปิดอยู่ · 08:00–20:00','gr')}${pill('ไม่ต้องสมัคร','mu')}</div>
${row({icon:'📶',title:'แตะมือถือที่เครื่องเพื่อรับโปร',sub:'ไม่บังคับ · ยินยอมใน Messenger ก่อน · Optional',href:'/help#tap'})}${cartBar()}`;
   send(res,200,customerHtml({title:'Muse Café',nav:[['ดูเมนู / Menu','/menu'],['ช่วยเหลือ / Help','/help']]},body),tableCookie?{'Set-Cookie':setCookie(deps,TABLE,tableCookie,6*3600)}:{});return true;
  }
  if(path==='/menu'&&method==='GET'){
   const cat=url.searchParams.get('c')??'',menu=await listMenu(agent,merchant),tr=await names(menu),bn=await liveBanners(deps.identity.db,merchant);
   const chips=`<div class="chips">${CATS.map(([k,t])=>`<a class="pill${k===cat?'':' mu'}" href="/menu${k?`?c=${encodeURIComponent(k)}`:''}">${esc(ui?k||'All':t)}</a>`).join('')}</div>`;
   const items=menu.filter(m=>!cat||m.category===cat).map(m=>row({href:`/item/${m.productId}`,img:bn.has(m.productId)?`/meta/banner/${bn.get(m.productId)}`:photo(m.imageUrl),title:lang?`${tr.get(m.productId)??m.nameEn} · ${m.nameEn}`:`${m.name} · ${m.nameEn}`,
    sub:`${m.offer?`<span class="pill rd">โปร −${m.offer.discountPercent}%</span>`:''}${m.available>0?'':'<span class="pill mu">หมด</span>'}`,right:price(m)})).join('');
   const added=url.searchParams.get('added')?'<div class="note" style="background:var(--grb);color:var(--gr)">ใส่ตะกร้าแล้ว ✓ / Added to cart</div>':'';
   send(res,200,customerHtml({title:'เมนู',back:'/',nav:ui?[['Voice order (Messenger customers)','/meta/order'],['Shop','/']]:[['สั่งด้วยเสียง/พิมพ์ (ต้องเชื่อมต่อ)','/meta/order'],['หน้าร้าน / Shop','/']]},`<h1>${ui?esc(ui.menu):'เมนู / Menu'}</h1>${langChips('/menu')}${added}${chips}${ui?`<p class="mu">${esc(ui.note)}</p>`:''}${items?`<div class="lst">${items}</div>`:'<p class="mu">ยังไม่มีเมนูในหมวดนี้</p>'}${cartBar()}`),langCookie?{'Set-Cookie':langCookie}:{});return true;
  }
  const item=path.match(/^\/item\/([0-9a-f-]{36})$/);
  if(item&&method==='GET'){
   const all=await listMenu(agent,merchant),m=all.find(x=>x.productId===item[1]),tr=await names(m?[m]:[]),bn=await liveBanners(deps.identity.db,merchant);
   if(!m){send(res,404,customerHtml({title:'ไม่พบเมนู',back:'/menu',nav:[['กลับไปเมนู','/menu']]},status('🔎','am','ไม่พบเมนูนี้',['เมนูอาจถูกนำออกแล้ว'])));return true;}
   const live=bn.get(m.productId),img=live?`/meta/banner/${live}`:photo(m.imageUrl);
   const body=`${img?`<img class="hero" src="${esc(img)}" alt="">${live?'<small class="mu">🎨 ภาพแก้ด้วย AI (Muse Image) · AI-edited photo</small>':''}`:''}<div class="card"><h1>${lang?esc(tr.get(m.productId)??m.nameEn):esc(m.name)} · ${esc(m.nameEn)}</h1><p style="font-size:22px;font-weight:800;color:var(--p)">${price(m)}</p>
${m.offer?`${pill(`โปร −${m.offer.discountPercent}% ที่ร้านอนุมัติ`,'rd')}`:''}<p class="mu">ราคาจากร้าน ส่วนลดคิดโดยเซิร์ฟเวอร์ · Prices from the server</p></div>
${m.payable?`<form method="post" action="/cart/add"><input type="hidden" name="id" value="${m.productId}"><label>จำนวน / Quantity</label><select name="q">${[1,2,3,4,5].map(n=>`<option>${n}</option>`).join('')}</select><button>${ui?esc(ui.add):'ใส่ตะกร้า / Add to cart'}</button></form>`:'<div class="note">เมนูนี้หมดหรือสั่งไม่ได้ตอนนี้ / Not available now.</div>'}`;
   send(res,200,customerHtml({title:m.nameEn,back:'/menu',nav:[['กลับไปเมนู / Menu','/menu'],['ตะกร้า / Cart','/cart']]},body));return true;
  }
  if(path==='/cart/add'&&method==='POST'){
   const f=await form(req);const id=f?.get('id')??'',q=Math.min(5,Math.max(1,Number(f?.get('q')??1)|0));
   const next=UUID.test(id)?parseCart(formatCart([...cart,{productId:id,quantity:q}])):cart;
   redirect(res,'/menu?added=1',{'Set-Cookie':setCookie(deps,CART,formatCart(next),2*86400)});return true;
  }
  if(path==='/cart/set'&&method==='POST'){
   const f=await form(req);const id=f?.get('id')??'',q=Number(f?.get('q')??0)|0;
   const next=cart.map(l=>l.productId===id?{...l,quantity:q}:l).filter(l=>l.quantity>0&&l.quantity<=20);
   redirect(res,'/cart',{'Set-Cookie':setCookie(deps,CART,formatCart(next),2*86400)});return true;
  }
  if(path==='/cart'&&method==='GET'){
   if(!cart.length){send(res,200,customerHtml({title:'ตะกร้า',back:'/menu',nav:[['ดูเมนู / Menu','/menu'],['หน้าร้าน / Shop','/']]},status('🛒','ti','ตะกร้ายังว่าง',['เลือกเมนูที่ชอบได้เลย / Your cart is empty.'])));return true;}
   let q;try{q=await quoteCart(agent,merchant,cart);}catch(e){if(e instanceof CartError){send(res,409,customerHtml({title:'ตะกร้า',back:'/menu',nav:[['กลับไปเมนู','/menu']]},status('⚠️','am','ตรวจรายการอีกครั้ง',[esc(ERR[e.code])]))+'',{'Set-Cookie':e.code==='NOT_FOUND'?setCookie(deps,CART,'',0):''});return true;}throw e;}
   const tr=lang?await names(await listMenu(agent,merchant)):new Map<string,string>();
   const lines=q.lines.map(l=>`${row({img:photo(l.imageUrl),title:`${lang?tr.get(l.productId)??l.nameEn:l.name} × ${l.quantity}`,sub:`${esc(l.unit)} / ชิ้น${l.offer?' · <span class="pill rd">โปร</span>':''}`,right:esc(l.amount)})}
<div class="qty" style="justify-content:flex-end;margin:-2px 4px 8px">${[l.quantity-1,l.quantity+1].map((n,i)=>`<form method="post" action="/cart/set"><input type="hidden" name="id" value="${l.productId}"><input type="hidden" name="q" value="${n}"><button aria-label="${i?'เพิ่ม':'ลด'}">${i?'+':'−'}</button></form>`).join('')}</div>`).join('');
   const body=`<h1>ตรวจรายการ / Review</h1><div class="cols"><div>${lines}</div><div><div class="card">${q.discount!=='$0.00'?`<div class="tot"><span class="mu">ส่วนลดที่ร้านอนุมัติ</span><span style="color:var(--gr)">−${esc(q.discount)}</span></div>`:''}<div class="tot b"><span>รวม / Total</span><span style="color:var(--p)">${esc(q.total)}</span></div>
<small>ราคาล็อกเมื่อกดจ่าย (30 นาที) · ถ้าราคาเปลี่ยน ระบบคิดใหม่ก่อนเสมอ</small></div><div class="note">Stripe sandbox · บัตรทดสอบ 4242 4242 4242 4242 · ไม่มีเงินจริง</div>
<form method="post" action="/checkout"><button>${ui?`${esc(ui.pay)} · ${esc(q.total)}`:`จ่าย ${esc(q.total)} ด้วย Stripe`}</button></form></div></div>`;
   send(res,200,customerHtml({title:'ตะกร้า',back:'/menu',navPrimary:false,nav:[['เพิ่มเมนู / Add more','/menu']]},body));return true;
  }
  if(path==='/checkout'&&method==='POST'){
   const table=cookie(req,TABLE);
   const tableId=table&&UUID.test(table)&&(await deps.identity.db.tenant(merchant,c=>c.query('SELECT 1 FROM merchant_tables WHERE id=$1 AND retired_at IS NULL',[table]))).rowCount?table:null;
   try{const r=await startCart(agent,merchant,cart,{channel:tableId?'table':'web',tableId,publicOrigin:deps.identity.publicOrigin});
    deps.log?.(`Cart order started (${tableId?'table':'web'})`);redirect(res,r.checkoutUrl);return true;}
   catch(e){if(e instanceof CartError){send(res,409,customerHtml({title:'จ่ายไม่ได้ตอนนี้',back:'/cart',nav:[['กลับไปตะกร้า','/cart'],['ช่วยเหลือ','/help']]},status('⚠️','am','จ่ายไม่ได้ตอนนี้',[esc(ERR[e.code])])));return true;}
    deps.log?.('Cart checkout failed');send(res,502,customerHtml({title:'ระบบชำระเงินขัดข้อง',back:'/cart',nav:[['ลองอีกครั้ง','/cart'],['ช่วยเหลือ','/help']]},status('⚠️','rd','ระบบชำระเงินขัดข้อง',['ยังไม่มีการตัดเงิน ลองอีกครั้ง / Nothing was charged.'])));return true;}
  }
  // Short link printed as the QR on meta-pos and the BitPOS Mini: forwards to the order's Stripe Checkout while it is open.
  const pay=path.match(/^\/pay\/([0-9a-f-]{36})$/);
  if(pay&&method==='GET'){
   const m=await cartOrderMerchant(deps.identity.db,pay[1]);
   const open=m?(await deps.identity.db.tenant(m,c=>c.query<{checkout_url:string|null}>("SELECT checkout_url FROM meta_cart_orders WHERE id=$1 AND status='PENDING' AND expires_at>clock_timestamp()",[pay[1]]))).rows[0]?.checkout_url:null;
   if(open){redirect(res,open);return true;}
   send(res,410,customerHtml({title:'บิลนี้ปิดแล้ว',nav:[['หน้าร้าน / Shop','/'],['ช่วยเหลือ','/help']]},status('🧾','am','บิลนี้ปิดแล้ว',['จ่ายแล้ว หมดเวลา หรือยกเลิก ขอบิลใหม่จากพนักงานได้','This bill is closed.'])));return true;
  }
  const rec=path.match(/^\/receipt\/([0-9a-f-]{36})$/);
  if(rec&&method==='GET'){
   const v=await cartReceipt(agent,rec[1],url.searchParams.get('a'),url.searchParams.get('s'));
   if(!v){send(res,404,customerHtml({title:'ไม่พบรายการ',nav:[['หน้าร้าน','/'],['ช่วยเหลือ','/help']]},status('🔎','am','ไม่พบรายการนี้',['ลิงก์ใบเสร็จไม่ถูกต้องหรือหมดอายุ'])));return true;}
   const self=`/receipt/${v.orderId}?a=${encodeURIComponent(url.searchParams.get('a')!)}`;
   const lines=v.lines.map(l=>`<div class="tot"><span>${esc(l.name)} × ${l.quantity}</span><span>${esc(l.amount)}</span></div>`).join('');
   const bill=`<div class="card">${lines}<hr style="border:0;border-top:1px solid var(--ln)"><div class="tot"><span class="mu">ส่วนลด</span><span>−${esc(v.discount)}</span></div><div class="tot b"><span>รวม</span><span>${esc(v.total)}</span></div><small>Stripe sandbox${v.tableLabel?` · ${esc(v.tableLabel)}`:''}</small></div>`;
   if(v.status==='PAID'){send(res,200,customerHtml({title:'จ่ายแล้ว',nav:[['สั่งเพิ่ม / Order more','/menu'],['หน้าร้าน / Shop','/']]},`${status('✓','gr','จ่ายแล้ว',['Stripe ยืนยันแล้ว · Paid'])}<div class="card center"><small>รหัสรับสินค้า / Pickup code</small><div class="big">#${esc(v.code)}</div><small>${v.handedOverAt?'ส่งมอบแล้ว':'แสดงที่เคาน์เตอร์'}</small></div>${v.stockShort?'<div class="note">บางรายการสต็อกไม่พอ พนักงานจะแจ้งหรือคืนเงินให้</div>':''}${bill}`),{'Set-Cookie':setCookie(deps,CART,'',0)});return true;}
   if(v.status==='PENDING'){send(res,202,customerHtml({title:'กำลังตรวจสอบ',refresh:5,nav:[['ตรวจอีกครั้ง / Check again',self],...(v.checkoutUrl?[['กลับไปหน้าชำระ / Back to payment',v.checkoutUrl] as [string,string]]:[]),['ช่วยเหลือ','/help']]},`${status('⏳','am','รอ Stripe ยืนยัน',['ยังไม่นับว่าจ่ายจนกว่า Stripe จะยืนยัน','Waiting for Stripe to confirm.'])}${bill}`));return true;}
   if(v.status==='EXPIRED'){send(res,200,customerHtml({title:'หมดเวลา',nav:[['สั่งใหม่ / Order again','/cart'],['เมนู','/menu']]},`${status('⌛','am','รายการนี้หมดเวลาแล้ว',['ไม่มีการตัดเงิน สั่งใหม่ได้เลย / Nothing was charged.'])}${bill}`));return true;}
   send(res,200,customerHtml({title:'คืนเงินแล้ว',nav:[['หน้าร้าน','/'],['ช่วยเหลือ','/help']]},`${status('↩️','rd','ยกเลิกและคืนเงินแล้ว',['คืนเต็มจำนวนผ่าน Stripe · Refunded'])}${bill}`));return true;
  }
  if(path==='/help'&&method==='GET'){
   const body=`<h1>ช่วยเหลือ / Help</h1>${row({icon:'🧾',title:'จ่ายแล้วแต่ยังไม่ขึ้น',sub:'เปิดลิงก์ใบเสร็จจากหน้า Stripe อีกครั้ง ระบบจะตรวจกับ Stripe ให้',href:'/menu'})}
<div id="tap">${row({icon:'📶',title:'แตะมือถือที่เครื่อง BitPOS Mini',sub:'ร้านจะถามความยินยอมใน Messenger ก่อน แล้วส่งโปรเฉพาะคุณ · เลิกเชื่อมต่อได้ทุกเมื่อ'})}</div>
${row({icon:'↩️',title:'ขอคืนเงิน',sub:'แจ้งพนักงานก่อนรับสินค้า คืนเต็มจำนวนผ่าน Stripe'})}${row({icon:'🔒',title:'ความเป็นส่วนตัว',sub:'ร้านไม่เห็นเลขบัตร · ไม่เก็บข้อความแชท · ไม่ใช้ใบหน้า'})}`;
   send(res,200,customerHtml({title:'ช่วยเหลือ',back:'/',nav:[['ดูเมนู / Menu','/menu'],['หน้าร้าน / Shop','/']]},body));return true;
  }
 }catch(e){
  deps.log?.('Shop page failed');send(res,500,customerHtml({title:'ระบบขัดข้อง',nav:[['ลองอีกครั้ง','/'],['ช่วยเหลือ','/help']]},status('⚠️','rd','ระบบขัดข้อง',['Something went wrong. Nothing was charged.'])));return true;
 }
 send(res,405,customerHtml({title:'ไม่รองรับ'},status('⚠️','am','ไม่รองรับคำขอนี้',['Method not allowed.'])));return true;
}
