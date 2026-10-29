// Customer pay + table flows on real data. usage: node capture-pay.mjs  -> shots/pay/*.png, pay-result.json
import {launch,overflow,watch,shotDir,here,ORIGIN} from './lib.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import pg from '/Users/cryptoclock/.codex/worktrees/bitpos-h2-parallel/BitPOS/node_modules/pg/lib/index.js';
const out=shotDir('pay');const orders=JSON.parse(readFileSync(here+'.orders.json','utf8'));
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
const token=async id=>(await db.query('SELECT access_token t FROM bitpos.orders WHERE id=$1',[id])).rows[0].t;
const entry=(await db.query("SELECT e.entry_token t FROM bitpos.table_entries e JOIN bitpos.devices d ON d.id=e.device_id AND d.table_id=e.table_id AND d.assignment_generation=e.assignment_generation AND d.auth_generation=e.auth_generation WHERE d.revoked_at IS NULL LIMIT 1")).rows[0].t;
const result={};const rec=(k,v)=>{result[k]=v;console.log(k,JSON.stringify(v));};
import {execFileSync} from 'node:child_process';
const refresh=()=>{execFileSync('npx',['tsx',here+'seed.ts','fresh'],{stdio:'inherit',env:process.env});Object.assign(orders,JSON.parse(readFileSync(here+'.orders.json','utf8')));}; // an unexpired awaiting-wallet bill
const b=await launch();
// Pay/table pages expose language as buttons named 'English' / 'ไทย' (Thai is the default); click the one that is not current.
const setLang=async(p,lang)=>{const named=p.getByRole('button',{name:lang==='en'?'English':'ไทย',exact:true}).filter({visible:true}).first();
 if(await named.count()){await named.click({timeout:1500}).catch(()=>{});}else if(await p.locator('.table-language').count()){const cur=await p.locator('.table-language').getAttribute('aria-label');if(lang==='en'?/English|อังกฤษ/i.test(cur||''):/Thai|ไทย/i.test(cur||''))await p.locator('.table-language').click({timeout:1500}).catch(()=>{});}
 await p.waitForTimeout(250);};
async function shots(p,name,w){for(const lang of ['th','en']){ // pages default to Thai; flip once per page
  await setLang(p,lang);
  await p.screenshot({path:`${out}${name}-${w}-${lang}.png`});}
 const ov=await overflow(p);await setLang(p,'th');return ov;}
for(const [w,h] of [[390,844],[1440,900]]){
 const ctx=await b.newContext({viewport:{width:w,height:h}});const p=await ctx.newPage();const log=[];watch(p,log);
 refresh();
 // Seeded bills: awaiting wallet, expired, paid.
 for(const [name,id] of [['bill-awaiting',orders.awaitingFresh],['bill-expired',orders.expired],['bill-paid',orders.paid]]){
  await p.goto(`${ORIGIN}/pay/${await token(id)}`);await p.waitForTimeout(1800);rec(`${name}-${w}`,{overflow:await shots(p,name,w),text:(await p.locator('main').innerText()).slice(0,90).replace(/\n/g,' | ')});
 }
 await p.goto(`${ORIGIN}/pay/${await token(orders.awaiting)}/menu`);await p.waitForTimeout(1500);rec('pay-menu-'+w,{overflow:await shots(p,'pay-menu',w)});
 // Table guest flow: menu -> add -> cart -> review -> confirm -> bill -> paid -> order again.
 execFileSync('npx',['tsx',here+'seed.ts','cleartable'],{stdio:'inherit',env:process.env});
 await p.goto(`${ORIGIN}/table/${entry}`);await p.waitForTimeout(1500);rec('table-menu-'+w,{overflow:await shots(p,'table-menu',w)});
 await p.goto(`${ORIGIN}/table/${entry}`);await p.waitForTimeout(1500);
 await p.locator('.table-product-bottom button').first().click();await p.waitForTimeout(500);
 if(await p.locator('.table-cart-trigger').isVisible())await p.locator('.table-cart-trigger').click();await p.waitForTimeout(900);await shots(p,"table-cart",w);
 await p.screenshot({path:out+'debug-cart.png'});console.log('CART TEXT',(await p.locator('body').innerText()).replace(/\n+/g,' | ').slice(0,500));
 await p.getByRole('button',{name:/ตรวจสอบออเดอร์|Review order|Check my order/}).click();await p.waitForTimeout(2000);await shots(p,'table-review',w);
 await p.getByRole('button',{name:/ยืนยันออเดอร์และชำระ|Confirm order/}).click();
 await p.waitForTimeout(2500);
 rec('table-order-confirmed-'+w,{overflow:await shots(p,'table-order-confirmed',w)});
 const payHref=await p.locator('a[href*="/pay/"]').first().getAttribute('href').catch(()=>null);
 const payUrl=payHref?new URL(payHref,ORIGIN).href:'';
 if(payHref){await p.goto(payUrl);await p.waitForTimeout(1800);}
 rec('table-order-bill-'+w,{payLink:!!payHref,overflow:await shots(p,'table-bill-awaiting',w)});
 const tok=payUrl.split('/pay/')[1]?.split(/[/?#]/)[0];
 if(tok){
  await db.query("UPDATE bitpos.orders SET status='PAID',paid_at=clock_timestamp(),payer='RenderPayer11111111111111111111111111111111',version=version+1 WHERE access_token=$1",[tok]);
  await p.reload();await p.waitForTimeout(2500);
  const body=await p.locator('main').innerText();
  const again=p.getByRole('link',{name:/สั่งอาหารใหม่|Order again/});await again.first().waitFor({timeout:7000}).catch(()=>{});
  rec('table-order-paid-'+w,{paidShown:/ชำระ|paid|Paid|received/i.test(body),orderAgainLink:await again.count()>0,overflow:await shots(p,'table-bill-paid',w)});
  if(await again.count()){await again.first().click();await p.waitForTimeout(2000);rec('order-again-'+w,{landedOn:p.url().replace(ORIGIN,'').replace(/[A-Za-z0-9_-]{43}/g,'<token>'),overflow:await shots(p,'order-again-menu',w)});}
 }
 execFileSync('npx',['tsx',here+'seed.ts','cleartable'],{stdio:'inherit',env:process.env});
 { const c2=await b.newContext({viewport:{width:w,height:h}});const q=await c2.newPage();await q.goto(`${ORIGIN}/table/${entry}`);await q.waitForTimeout(1500);await q.locator('.table-product-details').first().click();await q.waitForTimeout(700);await shots(q,'table-product',w);await c2.close(); }
 if(log.length)rec('api-errors-'+w,[...new Set(log)]);
 await ctx.close();
}
await b.close();await db.end();writeFileSync(here+'pay-result.json',JSON.stringify(result,null,1));
