// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Demo shop "BitPOS PayPal Café" (US PayPal Sandbox merchant) for local testing, built with the same application
// functions the backend fixtures use. Sample menu and prices are fixtures, not a real café.
//   pnpm exec tsx tools/paypal/seed-demo.ts shop             create the shop once (idempotent)
//   pnpm exec tsx tools/paypal/seed-demo.ts order [qty...]   new counter bill → prints the /pay link
// Refuses any database other than the local disposable fixture (127.0.0.1:55466).
import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const db=new URL(process.env.DATABASE_URL??'');const admin=new URL(process.env.ADMIN_DATABASE_URL??'');
for(const u of [db,admin])if(u.hostname!=='127.0.0.1'||u.port!=='55466')throw Error('seed-demo only runs against the local PayPal fixture database (127.0.0.1:55466)');
const {pool,tenant}=await import('../../apps/api/src/db');
const {registry}=await import('../../apps/api/src/registry');
const {publishPrices}=await import('../../apps/api/src/catalog');
const {counterQuote,createRoutedOrder}=await import('../../apps/api/src/orders');
const {expireUnpaidOrders}=await import('../../apps/api/src/order-closure');
const {MINT,TOKEN_PROGRAM}=await import('../../packages/domain/src/index');
const pg=(await import('pg')).default;

export const SHOP='33333333-3333-4333-8333-333333333333';
const OWNER='33333333-3333-4333-8333-0000000000a1';
// Fixed ids keep links stable across re-seeds. Prices are USD cents.
const MENU=[
 ['33333333-3333-4333-8333-000000000001','ครัวซองต์','Croissant','🥐',450,8],
 ['33333333-3333-4333-8333-000000000002','ลาเต้','Latte','🥛',500,30],
 ['33333333-3333-4333-8333-000000000003','อเมริกาโน่','Americano','☕',350,30],
 ['33333333-3333-4333-8333-000000000004','มัทฉะ','Matcha','🍵',550,30],
 ['33333333-3333-4333-8333-000000000005','บานาน่าเบรด','Banana bread','🍌',400,30],
 ['33333333-3333-4333-8333-000000000006','โคลด์บรูว์','Cold brew','🧊',450,30]
] as const;
const env=Object.fromEntries(readFileSync(process.env.PAYPAL_ENV_FILE??join(homedir(),'.bitpos-paypal/paypal-sandbox.env'),'utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]));
const payee=env.PAYPAL_MERCHANT_ID;if(!/^[A-Z0-9]{13}$/.test(payee??''))throw Error('PAYPAL_MERCHANT_ID (US sandbox business) missing in the private env file');
const reg=(path:string,method:string,input?:unknown)=>tenant(SHOP,d=>registry(d,SHOP,OWNER,'owner',path,method,input));

async function shop(){
 // Each step checks what already exists, so a partial run can simply be repeated.
 await pool.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'BitPOS PayPal Café','11111111111111111111111111111111') ON CONFLICT(id) DO NOTHING",[SHOP]);
 await tenant(SHOP,async d=>{for(const [id,name,nameEn,emoji,price,stock] of MENU)await d.query('INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[id,SHOP,name,nameEn,emoji,price,stock]);});
 const one=async(sql:string,args:unknown[])=>(await tenant(SHOP,d=>d.query(sql,args))).rows[0] as {id:string}|undefined;
 for(const label of ['Table 1','Table 2'])if(!await one('SELECT id FROM merchant_tables WHERE merchant_id=$1 AND label=$2',[SHOP,label]))await reg('/api/tables','POST',{label});
 const t2=(await one("SELECT id FROM merchant_tables WHERE merchant_id=$1 AND label='Table 2'",[SHOP]))!;
 const terminal=await one("SELECT id FROM devices WHERE merchant_id=$1 AND label='Terminal Table 2'",[SHOP])??await reg('/api/devices','POST',{label:'Terminal Table 2',tableId:t2.id});
 const counter=await one("SELECT id FROM devices WHERE merchant_id=$1 AND label='Counter screen'",[SHOP])??await reg('/api/devices','POST',{label:'Counter screen'});
 let register=await one("SELECT id FROM registers WHERE merchant_id=$1 AND label='Counter'",[SHOP]);
 if(!register){register=await reg('/api/registers','POST',{label:'Counter'});await reg('/api/registers/'+register!.id+'/pairing','PUT',{deviceId:counter.id,expectedPairingGeneration:'1'});}
 // The core schema needs an enabled payment asset as every quote's anchor; customers of this shop only see PayPal.
 if(!await one('SELECT id FROM catalog_price_versions WHERE merchant_id=$1 LIMIT 1',[SHOP]))
  await tenant(SHOP,d=>publishPrices(d,SHOP,OWNER,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'BitPOS PayPal Cafe sample menu (fixture)'},
   prices:MENU.map(([id,,,,price])=>({productId:id,unitMinor:String(price)})),settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}}));
 const a=new pg.Client({connectionString:admin.href});await a.connect();
 await a.query("INSERT INTO bitpos.paypal_merchant_settings(merchant_id,enabled,payee_merchant_id,updated_by) VALUES($1,true,$2,'seed-demo') ON CONFLICT(merchant_id) DO UPDATE SET enabled=true,payee_merchant_id=$2,updated_by='seed-demo',updated_at=clock_timestamp()",[SHOP,payee]);
 await a.end();
 console.log(JSON.stringify({shop:SHOP,register:register!.id,counterDevice:counter.id,terminalDevice:terminal.id,payee}));
}

async function order(qtys:number[]){
 const register=(await tenant(SHOP,d=>d.query("SELECT id FROM registers WHERE merchant_id=$1 AND label='Counter'",[SHOP]))).rows[0]?.id;if(!register)throw Error('run "shop" first');
 const device=(await tenant(SHOP,d=>d.query("SELECT device_id FROM register_pairings WHERE merchant_id=$1 AND register_id=$2",[SHOP,register]).catch(()=>({rows:[]as {device_id:string}[]})))).rows[0]?.device_id;
 // Local preview only: mark the counter screen connected so the bill can be routed to it (no physical device here).
 await tenant(SHOP,d=>d.query("UPDATE device_presence SET connection_generation=greatest(connection_generation,1),connection_id=coalesce(connection_id,gen_random_uuid()),connected_until=clock_timestamp()+interval '1 hour' WHERE merchant_id=$1"+(device?' AND device_id=$2':''),device?[SHOP,device]:[SHOP]));
 // No worker runs in the local preview: close expired unpaid bills (frees the screen) with the app's own routine.
 await tenant(SHOP,d=>expireUnpaidOrders(d,SHOP));
 const items=MENU.map(([id],i)=>({productId:id,qty:qtys[i]??0})).filter(x=>x.qty>0);if(!items.length)items.push({productId:MENU[2][0],qty:1},{productId:MENU[3][0],qty:1});
 const q=await tenant(SHOP,d=>counterQuote(d,SHOP,register,{items,serving:{kind:'counter'}}));
 const created=await tenant(SHOP,d=>createRoutedOrder(d,SHOP,'register',register,{items:q.lines.map(l=>({productId:l.productId,qty:l.qty})),serving:{kind:'counter'},quoteId:q.id,priceVersion:q.priceVersion,idempotencyKey:randomUUID()}));
 const token=(await tenant(SHOP,d=>d.query('SELECT access_token FROM orders WHERE id=$1',[created.order.id]))).rows[0].access_token;
 console.log(JSON.stringify({order:created.order.id,total:q.total,pay:`${process.env.BITPOS_PAYPAL_PREVIEW_URL??"http://127.0.0.1:4361"}/pay/${token}`}));
}

const [cmd,...rest]=process.argv.slice(2);
try{if(cmd==='shop')await shop();else if(cmd==='order')await order(rest.map(Number));else console.log('usage: shop | order [qty per menu item…]');}
finally{await pool.end();}
