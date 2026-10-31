// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Read-only live check of the production PayPal modules (apps/api/src/paypal) against the sandbox: GET an order that a spike
// run created and captured, then run verifyOrder with the facts saved by that run. Moves no money.
//   pnpm exec tsx tools/paypal/client-check.ts <paypalOrderId>
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {paypalConfig} from '../../apps/api/src/paypal/config';
import {paypalClient} from '../../apps/api/src/paypal/client';
import {verifyOrder} from '../../apps/api/src/paypal/verify';

const envFile=process.env.PAYPAL_ENV_FILE??join(homedir(),'.bitpos-paypal/paypal-sandbox.env');
const env=Object.fromEntries(readFileSync(envFile,'utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]));
const id=process.argv[2];if(!id)throw Error('usage: client-check.ts <paypalOrderId>');
// Spike runs used custom_id `bitpos:v1:spike:<referenceId>:<checkoutId>`, i.e. merchant "spike".
const s=JSON.parse(readFileSync(join(homedir(),'.bitpos-paypal/smoke',id+'.json'),'utf8'));
const cfg=paypalConfig(env);const order=await paypalClient(cfg).getOrder(id);
const v=verifyOrder({paypalOrderId:id,merchantId:'spike',orderId:s.referenceId,checkoutId:s.checkoutId,amountCents:BigInt(Math.round(Number(s.value)*100)),payeeMerchantId:cfg.merchantId},order);
console.log(JSON.stringify({order:order.id,status:order.status,debugId:order.debugId,verdict:v.state,...(v.state==='MISMATCH'?{reasons:v.reasons}:{}),
 ...('capture' in v&&v.capture?{capture:v.capture.id,captureStatus:v.capture.status,gross:String(v.capture.grossCents),fee:String(v.capture.feeCents),net:String(v.capture.netCents)}:{})}));
