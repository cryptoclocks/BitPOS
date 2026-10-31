// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Hosted PayPal worker (infra/paypal/compose.yaml): only the PayPal lane — verified webhook inbox, checkout reconcile
// (same PayPal-Request-Id on every retry) and ending Copilot offers. It deliberately runs no Solana, order-expiry or
// promotion lanes: the existing bitpos-runtime worker already runs those for every shop in the shared database.
import {paypalDeps} from '../../apps/api/src/paypal/checkout';
import {tickPayPal} from '../../apps/api/src/paypal/reconcile';
import {runWorkerLanes} from '../../apps/worker/src/lanes';

const deps=paypalDeps();
if(!deps)throw Error('PayPal Sandbox is not configured (PAYPAL_* in the private PayPal env)');
const controller=new AbortController();process.on('SIGINT',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
console.log(`PayPal worker · webhook ${deps.config.webhookId?'configured':'not configured'}`);
let last=0;
await runWorkerLanes([{tick:async()=>{if(Date.now()-last<5000)return;last=Date.now();await tickPayPal(deps);},unavailable:'PayPal reconcile unavailable; durable state retained'}],controller.signal);
