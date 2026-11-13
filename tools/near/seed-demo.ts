// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. Adapted from the PayPal edition's seed tool.
// Demo shop "Orbit Café" on NEAR testnet for local testing, built with the same application functions the backend
// fixtures use. Sample menu, prices, staff and supplier are fixtures, not a real café.
//   pnpm exec tsx tools/near/seed-demo.ts shop             create the shop once (idempotent)
//   pnpm exec tsx tools/near/seed-demo.ts order [qty...]   new counter bill → prints the /pay link
// Refuses any database other than the local disposable fixture (127.0.0.1:55477), except the hosted demo shop:
//   BITPOS_NEAR_SEED_TARGET=oci node --import tsx tools/near/seed-demo.ts shop
// run inside the bitpos-near api container (`shop` only; its own merchant id, no other shop is touched).
import 'dotenv/config';
import {randomBytes,randomUUID} from 'node:crypto';
import fs from 'node:fs';

const oci=process.env.BITPOS_NEAR_SEED_TARGET==='oci';
const db=new URL(process.env.DATABASE_URL??'');const admin=new URL(process.env.ADMIN_DATABASE_URL??'');
if(oci){if(process.argv[2]!=='shop'||!fs.existsSync('/.dockerenv'))throw Error('OCI target: only `shop`, only inside the bitpos-near api container');}
else for(const u of [db,admin])if(u.hostname!=='127.0.0.1'||u.port!=='55477')throw Error('seed-demo only runs against the local NEAR fixture database (127.0.0.1:55477)');
const {pool,tenant}=await import('../../apps/api/src/db');
const {registry}=await import('../../apps/api/src/registry');
const {publishPrices}=await import('../../apps/api/src/catalog');
const {counterQuote,createRoutedOrder}=await import('../../apps/api/src/orders');
const {expireUnpaidOrders}=await import('../../apps/api/src/order-closure');
const {MINT,TOKEN_PROGRAM}=await import('../../packages/domain/src/index');
const pg=(await import('pg')).default;

export const SHOP='4e454152-4e45-4152-8e45-415200000001';
const USERS={owner:'4e454152-4e45-4152-8e45-0000000000a1',manager:'4e454152-4e45-4152-8e45-0000000000a2',staff:'4e454152-4e45-4152-8e45-0000000000a3'} as const;
const OWNER=USERS.owner;
const deployment=JSON.parse(fs.readFileSync('near-hackathon/near-deployment.json','utf8'));
// Fixed ids keep links stable across re-seeds. Prices are USD cents.
const MENU=[
 ['4e454152-4e45-4152-8e45-000000000001','ครัวซองต์','Croissant','🥐',450,40,'/images/menu/croissant.jpg','Bakery','A golden butter croissant with crisp, flaky layers.'],
 ['4e454152-4e45-4152-8e45-000000000002','ลาเต้','Latte','🥛',500,60,'/images/menu/latte.jpg','Coffee','Espresso with steamed milk and silky microfoam.'],
 ['4e454152-4e45-4152-8e45-000000000003','อเมริกาโน่','Americano','☕',350,60,'/images/menu/americano.jpg','Coffee','Espresso and hot water for a clean, bold coffee.'],
 ['4e454152-4e45-4152-8e45-000000000004','ชาเขียว','Matcha','🍵',550,60,'/images/menu/matcha.jpg','Tea & Chocolate','Smooth green tea with warm milk and a creamy finish.'],
 ['4e454152-4e45-4152-8e45-000000000005','มัฟฟินบลูเบอร์รี','Blueberry Muffin','🧁',400,40,'/images/menu/blueberry-muffin.jpg','Bakery','A soft muffin baked with juicy blueberries.'],
 ['4e454152-4e45-4152-8e45-000000000006','ลาเต้เย็น','Iced Latte','🧊',450,60,'/images/menu/iced-latte.jpg','Coffee','Espresso and chilled milk served over ice.']
] as const;
const reg=(path:string,method:string,input?:unknown)=>tenant(SHOP,d=>registry(d,SHOP,OWNER,'owner',path,method,input));

async function shop(){
 // Each step checks what already exists, so a partial run can simply be repeated.
 await pool.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Orbit Café','11111111111111111111111111111111') ON CONFLICT(id) DO NOTHING",[SHOP]);
 await tenant(SHOP,async d=>{for(const [id,name,nameEn,emoji,price,stock,image,category,description] of MENU){
  await d.query('INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[id,SHOP,name,nameEn,emoji,price,stock]);
  await d.query('UPDATE products SET image_url=$3,category=$4,description=$5 WHERE merchant_id=$1 AND id=$2 AND (image_url,category,description) IS DISTINCT FROM ($3,$4,$5)',[SHOP,id,image,category,description]);}});
 const one=async(sql:string,args:unknown[])=>(await tenant(SHOP,d=>d.query(sql,args))).rows[0] as {id:string}|undefined;
 for(const label of ['Table 1','Table 2'])if(!await one('SELECT id FROM merchant_tables WHERE merchant_id=$1 AND label=$2',[SHOP,label]))await reg('/api/tables','POST',{label});
 const t2=(await one("SELECT id FROM merchant_tables WHERE merchant_id=$1 AND label='Table 2'",[SHOP]))!;
 const terminal=await one("SELECT id FROM devices WHERE merchant_id=$1 AND label='Terminal Table 2'",[SHOP])??await reg('/api/devices','POST',{label:'Terminal Table 2',tableId:t2.id});
 const counter=await one("SELECT id FROM devices WHERE merchant_id=$1 AND label='Counter screen'",[SHOP])??await reg('/api/devices','POST',{label:'Counter screen'});
 let register=await one("SELECT id FROM registers WHERE merchant_id=$1 AND label='Counter'",[SHOP]);
 if(!register){register=await reg('/api/registers','POST',{label:'Counter'});await reg('/api/registers/'+register!.id+'/pairing','PUT',{deviceId:counter.id,expectedPairingGeneration:'1'});}
 // The core schema needs an enabled payment asset as every quote's anchor; customers of this shop only see NEAR.
 if(!await one('SELECT id FROM catalog_price_versions WHERE merchant_id=$1 LIMIT 1',[SHOP]))
  await tenant(SHOP,d=>publishPrices(d,SHOP,OWNER,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'Orbit Cafe sample menu (fixture)'},
   prices:MENU.map(([id,,,,price])=>({productId:id,unitMinor:String(price)})),settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}}));
 const a=new pg.Client({connectionString:admin.href});await a.connect();
 for(const [role,id] of Object.entries(USERS))await a.query('INSERT INTO bitpos.members(user_id,merchant_id,role) VALUES($1,$2,$3) ON CONFLICT(user_id,merchant_id) DO UPDATE SET role=EXCLUDED.role',[id,SHOP,role]);
 const s=deployment.demo_shop;
 await a.query(`INSERT INTO bitpos.near_merchant_settings(merchant_id,enabled,near_account,token_contract,token_symbol,tax_bps,tips_bps,updated_by) VALUES($1,true,$2,$3,'tUSD',700,1000,'seed-demo')
  ON CONFLICT(merchant_id) DO UPDATE SET enabled=true,near_account=$2,token_contract=$3,updated_by='seed-demo',updated_at=clock_timestamp()`,[SHOP,s.account,deployment.tokens.tUSD.contract]);
 const recipient=async(kind:string,label:string,account:string,onShift=false)=>(await a.query(`INSERT INTO bitpos.near_recipients(merchant_id,kind,label,near_account,on_shift_since) VALUES($1,$2,$3,$4,CASE WHEN $5 THEN clock_timestamp() END)
  ON CONFLICT(merchant_id,kind,near_account) DO UPDATE SET label=EXCLUDED.label RETURNING id`,[SHOP,kind,label,account,onShift])).rows[0].id as string;
 await recipient('tax','Tax reserve',s.tax);await recipient('staff','Mai (barista)',s.staff[0],true);await recipient('staff','Ton (barista)',s.staff[1]);
 const milk=await recipient('supplier','Milk Farm Co.',s.supplier);
 await a.query("INSERT INTO bitpos.near_supplier_invoices(merchant_id,recipient_id,reference,total_units,rate_bps,created_by) VALUES($1,$2,'INV-2026-1101',120000000,1200,'seed-demo') ON CONFLICT(merchant_id,reference) DO NOTHING",[SHOP,milk]);
 await a.end();
 // Quick sign-in file for the local preview (never in the repository: local/ is ignored). Passwords are random per machine.
 if(!oci&&!fs.existsSync('local/private/demo-login.json')){
  fs.mkdirSync('local/private',{recursive:true,mode:0o700});
  fs.writeFileSync('local/private/demo-login.json',JSON.stringify(Object.keys(USERS).map(role=>({email:`${role}@orbit-cafe.test`,password:randomBytes(18).toString('base64url'),role}))),{mode:0o600});
 }
 console.log(JSON.stringify({shop:SHOP,register:register!.id,counterDevice:counter.id,terminalDevice:terminal.id,nearAccount:s.account}));
}

async function order(qtys:number[]){
 const register=(await tenant(SHOP,d=>d.query("SELECT id FROM registers WHERE merchant_id=$1 AND label='Counter'",[SHOP]))).rows[0]?.id;if(!register)throw Error('run "shop" first');
 // Local preview only: mark the shop's screens connected and idle so the bill can be routed (no physical device here),
 // and close expired unpaid bills with the app's own routine (no worker runs in the local preview).
 await tenant(SHOP,d=>d.query("UPDATE device_presence SET connection_generation=greatest(connection_generation,1),connection_id=coalesce(connection_id,gen_random_uuid()),connected_until=clock_timestamp()+interval '1 hour' WHERE merchant_id=$1",[SHOP]));
 await tenant(SHOP,d=>expireUnpaidOrders(d,SHOP));
 await tenant(SHOP,d=>d.query("UPDATE device_screen_state s SET kind='idle',order_id=NULL,screen_generation=s.screen_generation+1 FROM orders o WHERE s.order_id=o.id AND o.merchant_id=$1 AND o.status IN ('PAID','EXPIRED','RECOVERY')",[SHOP]));
 const items=MENU.map(([id],i)=>({productId:id,qty:qtys[i]??0})).filter(x=>x.qty>0);if(!items.length)items.push({productId:MENU[1][0],qty:1});
 const q=await tenant(SHOP,d=>counterQuote(d,SHOP,register,{items,serving:{kind:'counter'}}));
 const created=await tenant(SHOP,d=>createRoutedOrder(d,SHOP,'register',register,{items:q.lines.map(l=>({productId:l.productId,qty:l.qty})),serving:{kind:'counter'},quoteId:q.id,priceVersion:q.priceVersion,idempotencyKey:randomUUID()}));
 const token=(await tenant(SHOP,d=>d.query('SELECT access_token FROM orders WHERE id=$1',[created.order.id]))).rows[0].access_token;
 console.log(JSON.stringify({order:created.order.id,total:q.total,token,pay:`${process.env.BITPOS_NEAR_PREVIEW_URL??'http://127.0.0.1:4321'}/pay/${token}`}));
}

const [cmd,...rest]=process.argv.slice(2);
try{if(cmd==='shop')await shop();else if(cmd==='order')await order(rest.map(Number));else console.log('usage: shop | order [qty per menu item…]');}
finally{await pool.end();}
