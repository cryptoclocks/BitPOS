// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Local PayPal preview worker: only the lanes the PayPal edition needs (promotion copy generation, promotion delivery,
// unpaid-bill expiry for the demo shop, PayPal reconcile + webhook inbox). Fixture database only; no Solana RPC lanes.
//   pnpm exec tsx tools/paypal/dev-worker.ts
import 'dotenv/config';
import {readFileSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const db=new URL(process.env.DATABASE_URL??'');
if(db.hostname!=='127.0.0.1'||db.port!=='55466')throw Error('dev-worker only runs against the local PayPal fixture database (127.0.0.1:55466)');
for(const [file,prefix] of [['paypal-sandbox.env','PAYPAL_'],['gemini.env','BITPOS_AI_']] as const){
 const p=join(homedir(),'.bitpos-paypal',file);if(!existsSync(p))continue;
 for(const line of readFileSync(p,'utf8').split('\n')){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m&&m[1].startsWith(prefix)&&m[2].trim())process.env[m[1]]=m[2].trim();}
}
const SHOP='33333333-3333-4333-8333-333333333333';
const {tenant}=await import('../../apps/api/src/db');
const {expireUnpaidOrders}=await import('../../apps/api/src/order-closure');
const {tickPromotions,tickPromotionJobs}=await import('../../apps/worker/src/promotions');
const {paypalDeps}=await import('../../apps/api/src/paypal/checkout');
const {tickPayPal}=await import('../../apps/api/src/paypal/reconcile');
const {runWorkerLanes}=await import('../../apps/worker/src/lanes');
const controller=new AbortController();process.on('SIGINT',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
console.log(`PayPal preview worker: AI ${process.env.BITPOS_AI_MODEL??'not configured'} · PayPal ${paypalDeps()?'sandbox configured':'not configured'}`);
let last=0;
await runWorkerLanes([
 {tick:()=>tickPromotionJobs(controller.signal),unavailable:'Promotion generation unavailable'},
 {tick:tickPromotions,unavailable:'Promotion delivery unavailable'},
 {tick:async()=>{if(Date.now()-last<5000)return;last=Date.now();await tenant(SHOP,d=>expireUnpaidOrders(d,SHOP));const d=paypalDeps();if(d)await tickPayPal(d);},unavailable:'PayPal reconcile unavailable'}
],controller.signal);
