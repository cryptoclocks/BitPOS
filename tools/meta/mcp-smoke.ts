// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Plays the agent against a live BitPOS Muse Connector: initialize → list_menu → get_quote → mint a sandbox
// Shared Payment Token with Stripe's test helper (pm_card_visa, capped at the quoted total) → complete_checkout
// → order_status, and with --cancel also cancel_order (full refund, stock back).
// Usage: npx tsx tools/meta/mcp-smoke.ts <env-file> <mcp-url> <product-id> [--cancel]
// The env file (outside the repo) provides STRIPE_TEST_SECRET_KEY; live keys are refused. Prints ids, never keys.
import {readFileSync} from 'node:fs';

const [envFile,mcpUrl,productId,flag]=process.argv.slice(2);
if(!envFile||!mcpUrl||!productId)throw Error('usage: mcp-smoke.ts <env-file> <mcp-url> <product-id> [--cancel]');
const env:Record<string,string>={};
for(const line of readFileSync(envFile,'utf8').split('\n')){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2];}
const key=env.STRIPE_TEST_SECRET_KEY;
if(!key||!/^(sk|rk)_test_/.test(key))throw Error('a Stripe test key is required');

let id=0;
async function rpc(method:string,params?:unknown):Promise<any>{
 const r=await fetch(mcpUrl,{method:'POST',headers:{'content-type':'application/json','mcp-protocol-version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
 const body:any=await r.json();
 if(body.error)throw Error(`${method}: ${body.error.message}`);
 return body.result;
}
const tool=async(name:string,args:Record<string,unknown>)=>{const r=await rpc('tools/call',{name,arguments:args});if(r.isError)throw Error(`${name}: ${JSON.stringify(r.structuredContent)}`);return r.structuredContent;};

const init=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'bitpos-mcp-smoke',version:'1'}});
console.log('server',init.serverInfo.name,init.protocolVersion);
const item=(await tool('list_menu',{})).items.find((i:any)=>i.productId===productId);
if(!item)throw Error('product not on the menu');
console.log('menu',item.nameEn,item.price.display,item.offer?`offer -${item.offer.discountPercent}%`:'no offer');
const quote=await tool('get_quote',{product_id:productId,quantity:1});
console.log('quote',quote.quoteId,quote.total,'expires',quote.expiresAt);

const form=new URLSearchParams({payment_method:'pm_card_visa','usage_limits[currency]':quote.currency,'usage_limits[max_amount]':quote.amountMinor,'usage_limits[expires_at]':String(Math.floor(Date.now()/1000)+3600)});
const sptRes=await fetch('https://api.stripe.com/v1/test_helpers/shared_payment/granted_tokens',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/x-www-form-urlencoded'},body:form});
const spt:any=await sptRes.json();
if(!sptRes.ok||typeof spt.id!=='string')throw Error(`SPT test helper failed: ${spt?.error?.code??sptRes.status}`);
console.log('spt minted (sandbox test helper)');

const paid=await tool('complete_checkout',{quote_id:quote.quoteId,shared_payment_token:spt.id});
console.log('checkout',paid.orderId,paid.status,paid.total,'pickup',paid.pickupCode,paid.paymentIntentId);
const again=await tool('complete_checkout',{quote_id:quote.quoteId,shared_payment_token:spt.id});
console.log('retry',again.orderId===paid.orderId?'same order':'DIFFERENT ORDER',again.status);
console.log('status',(await tool('order_status',{order_id:paid.orderId})).status);
if(flag==='--cancel'){const c=await tool('cancel_order',{order_id:paid.orderId});console.log('cancel',c.status,c.cancelledAt);}
