// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Owner runs this in their own terminal to store the PayPal SANDBOX app credentials privately.
// The secret is read with hidden input, written only to ~/.bitpos-paypal/paypal-sandbox.env (chmod 600),
// never echoed or logged. Then it asks PayPal Sandbox for an OAuth token to prove the pair works.
//   pnpm exec tsx tools/paypal/set-credentials.ts
import {readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';

const SANDBOX='https://api-m.sandbox.paypal.com';
const file=process.env.PAYPAL_ENV_FILE??join(homedir(),'.bitpos-paypal/paypal-sandbox.env');

function ask(question:string,hidden=false):Promise<string>{
 return new Promise(resolve=>{
  const rl=createInterface({input:process.stdin,output:process.stdout,terminal:true});
  if(hidden)(rl as any)._writeToOutput=(s:string)=>{if(s.startsWith(question))process.stdout.write(question);else if(!/[\r\n]/.test(s))process.stdout.write('*');else process.stdout.write('\n');};
  rl.question(question,answer=>{rl.close();resolve(answer.trim());});
 });
}

const current=Object.fromEntries(readFileSync(file,'utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
// --secret-stdin: non-interactive; only the secret comes from stdin (e.g. `pbpaste | …`), never printed.
const fromStdin=process.argv.includes('--secret-stdin');
if(!fromStdin){
 console.log('BitPOS · PayPal SANDBOX credentials (developer.paypal.com → Apps & Credentials → Sandbox → "BitPOS AI Hackathon 2026")');
 console.log('Live credentials are refused. Press Enter on a question to keep the current value.\n');
}
const clientId=fromStdin?current.PAYPAL_CLIENT_ID:await ask('Client ID: ')||current.PAYPAL_CLIENT_ID;
const secret=fromStdin?(await new Promise<string>(r=>{let s='';process.stdin.setEncoding('utf8').on('data',c=>s+=c).on('end',()=>r(s.trim()));})):await ask('Secret key 1 (hidden): ',true)||current.PAYPAL_CLIENT_SECRET;
const merchantId=(fromStdin?current.PAYPAL_MERCHANT_ID:await ask('Sandbox business Account ID (Merchant ID): ')||current.PAYPAL_MERCHANT_ID).toUpperCase();
if(!/^[A-Za-z0-9_-]{20,200}$/.test(clientId??''))throw Error('Client ID looks wrong (expected a long letters/digits string).');
if(!/^[A-Za-z0-9_-]{20,200}$/.test(secret??''))throw Error('Secret looks wrong (expected a long letters/digits string).');
if(!/^[A-Z0-9]{8,20}$/.test(merchantId??''))throw Error('Merchant ID looks wrong (expected ~13 letters/digits).');

const r=await fetch(SANDBOX+'/v1/oauth2/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
 headers:{Authorization:'Basic '+Buffer.from(clientId+':'+secret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
const body:any=await r.json().catch(()=>({}));
if(!r.ok||typeof body.access_token!=='string'){
 console.log(`\nPayPal Sandbox refused these credentials (HTTP ${r.status} ${body.error??''}). Nothing was saved.`);
 console.log('Check you copied the SANDBOX (not Live) Client ID and Secret of the same app.');process.exit(1);
}
const lines=readFileSync(file,'utf8').split('\n').map(l=>l.startsWith('PAYPAL_CLIENT_ID=')?'PAYPAL_CLIENT_ID='+clientId:l.startsWith('PAYPAL_CLIENT_SECRET=')?'PAYPAL_CLIENT_SECRET='+secret:l.startsWith('PAYPAL_MERCHANT_ID=')?'PAYPAL_MERCHANT_ID='+merchantId:l);
writeFileSync(file,lines.join('\n'),{mode:0o600});chmodSync(file,0o600);
console.log(`\nSaved to ${file} (chmod 600). PayPal Sandbox accepted the credentials: app ${body.app_id??'?'}, token valid ${body.expires_in}s.`);
console.log('You can close this tab and tell Claude it is done.');
