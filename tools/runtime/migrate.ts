import 'dotenv/config';
import pg from 'pg';
import fs from 'node:fs';
import {config,MERCHANT_A,MERCHANT_B} from '../../apps/api/src/config';
const db=new pg.Client({connectionString:config.ADMIN_DATABASE_URL});await db.connect();
await db.query('CREATE TABLE IF NOT EXISTS public.bitpos_migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
for(const name of fs.readdirSync('supabase/migrations').sort()){if((await db.query('SELECT 1 FROM public.bitpos_migrations WHERE name=$1',[name])).rowCount)continue;await db.query('BEGIN');try{await db.query(fs.readFileSync('supabase/migrations/'+name,'utf8'));await db.query('INSERT INTO public.bitpos_migrations(name) VALUES($1)',[name]);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}console.log('Applied',name);}
const manifest=JSON.parse(fs.readFileSync(config.DEVNET_PRIVATE_DIR+'/wallets.public.json','utf8'));
for(const [id,name,role] of [[MERCHANT_A,'BitPOS Purple Cafe','merchant-a-treasury'],[MERCHANT_B,'BitPOS Second Store','merchant-b-treasury']])await db.query('INSERT INTO bitpos.merchants(id,name,treasury) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[id,name,manifest.wallets.find((w:any)=>w.id===role).address]);
const menu=[['อเมริกาโน่','Americano','☕',7000],['ลาเต้','Latte','🥛',8500],['ชาเขียว','Matcha','🍵',9000],['ครัวซองต์','Croissant','🥐',9500],['แซนด์วิช','Sandwich','🥪',12000]];
for(const merchant of [MERCHANT_A,MERCHANT_B])if(!(await db.query('SELECT 1 FROM bitpos.products WHERE merchant_id=$1',[merchant])).rowCount){for(const [name,en,emoji,price] of menu)await db.query('INSERT INTO bitpos.products(merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,$3,$4,$5,100)',[merchant,name,en,emoji,price]);}
const users=[['owner@bitpos.test',MERCHANT_A,'owner'],['manager@bitpos.test',MERCHANT_A,'manager'],['staff@bitpos.test',MERCHANT_A,'staff'],['other@bitpos.test',MERCHANT_B,'owner']];
const credentials=[];
for(const [email,merchant,role] of users){
 const res=await fetch(process.env.AUTH_URL+'/admin/users',{method:'POST',headers:{Authorization:'Bearer '+process.env.AUTH_SERVICE_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password:process.env.DEMO_PASSWORD,email_confirm:true})});
 let user=await res.json() as any;
 if(!res.ok){const listing=await fetch(process.env.AUTH_URL+'/admin/users',{headers:{Authorization:'Bearer '+process.env.AUTH_SERVICE_KEY}});const existing=await listing.json() as any;user=existing.users?.find((u:any)=>u.email===email);if(!user)throw Error('Unable to provision BitPOS demo user; check Auth health');}
 await db.query('INSERT INTO bitpos.members(user_id,merchant_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[user.id,merchant,role]);credentials.push({email,password:process.env.DEMO_PASSWORD,role});
}
fs.writeFileSync('local/private/demo-login.json',JSON.stringify(credentials,null,2),{mode:0o600});await db.end();console.log('Seeded 2 stores, menus and demo memberships; credentials in local/private/demo-login.json');
