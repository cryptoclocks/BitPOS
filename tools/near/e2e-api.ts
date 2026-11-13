// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// End to end through the server code against NEAR testnet and the local fixture database: a real counter bill is
// opened in the contract, paid gaslessly by a demo wallet and marked PAID only from the contract's final state.
//   pnpm exec tsx tools/near/seed-demo.ts order 0 1        (prints {"token": …})
//   pnpm exec tsx tools/near/e2e-api.ts <token> [instant|witness]
import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ed25519} from '@noble/curves/ed25519';

const [token,mode='instant']=process.argv.slice(2);if(!token)throw Error('usage: e2e-api.ts <order access token> [instant|witness]');
const db=new URL(process.env.DATABASE_URL??'');if(db.hostname!=='127.0.0.1'||db.port!=='55477')throw Error('local NEAR fixture database only');
const {pool,tenant}=await import('../../apps/api/src/db');
const bills=await import('../../apps/api/src/near/bills');
const device=await import('../../apps/api/src/near/device');
const merchantApi=await import('../../apps/api/src/near/merchant');
const {witnessMessage}=await import('../../apps/api/src/near/chain');
const SHOP='4e454152-4e45-4152-8e45-415200000001',OWNER='4e454152-4e45-4152-8e45-0000000000a1';
const d=bills.nearDeps();assert(d,'NEAR is not configured in .env');
const api=(path:string,method='GET',input?:unknown)=>merchantApi.nearMerchantRequest(SHOP,OWNER,'owner',new URL('http://x/api/near/'+path),method,input);
const link=(tx:string|null)=>tx?d.config.explorerTx+tx:null;
try{
 const status=await bills.nearStatus(token);
 assert.equal(status.enabled,true);const wallet=status.demoWallets[0];assert(wallet,'no demo wallet key in NEAR_PRIVATE_DIR');
 const accounts=[wallet,d.config.billsContract];
 let witness:{id:string;key:string;secret:Uint8Array;pk:string}|null=null;
 if(mode==='witness'){
  const secret=ed25519.utils.randomPrivateKey(),pk=Buffer.from(ed25519.getPublicKey(secret)).toString('hex');
  const made=await api('devices','POST',{label:'E2E witness (script)',kind:'mini'}) as {id:string;key:string};
  await device.deviceRegister(made.id,made.key,pk);
  await api('recipe','POST',{taxBps:700,tipsBps:1000,witnessDeviceId:made.id,witnessTimeoutS:120});
  witness={...made,secret,pk};
 }
 const opened=await bills.createNearBill(token);
 assert.equal(opened.status,'awaiting_payment',JSON.stringify(opened));
 for(const p of opened.payouts)accounts.push(p.account);
 const balances=async()=>Object.fromEntries(await Promise.all([...new Set(accounts)].map(async a=>[a,await d.chain.ftBalance(status.token!.contract,a)]))) as Record<string,bigint>;
 const before=await balances();
 let paid=await bills.demoPay(token,wallet);
 if(witness){
  assert.equal(paid.status,'escrow',JSON.stringify(paid));
  const shown=await device.deviceState(witness.id,witness.key,'en');assert.equal(shown.screen,'checking');
  const sig=Buffer.from(ed25519.sign(Buffer.from(witnessMessage(opened.contract!,opened.merchantAccount!,opened.billId!)),witness.secret)).toString('hex');
  assert.deepEqual(await device.deviceAck(witness.id,witness.key,{bill:opened.billId!,sig,pk:witness.pk}),{ok:true,state:'SETTLED'});
  paid=(await bills.nearStatus(token)).bill;
 }
 assert.equal(paid.status,'paid',JSON.stringify(paid));
 const after=await balances();
 assert.equal(before[wallet]-after[wallet],BigInt(opened.amount!.units),'the payer paid exactly the bill');
 assert.equal(after[d.config.billsContract],before[d.config.billsContract],'the contract kept nothing');
 const units=(display:string)=>BigInt(Math.round(Number(display)*1e6));
 const expectedDelta=new Map<string,bigint>();for(const p of opened.payouts)expectedDelta.set(p.account,(expectedDelta.get(p.account)??0n)+units(p.amount));
 for(const [account,delta] of expectedDelta)assert.equal(after[account]-before[account],delta,account);
 const order=await tenant(SHOP,async db=>(await db.query('SELECT o.id,o.status FROM orders o WHERE o.access_token=$1',[token])).rows[0]);
 assert.equal(order.status,'PAID');
 const evidence=await api(`orders/${order.id}/evidence`) as {bills:{events:{kind:string;url:string|null}[]}[]};
 const out={network:'testnet',mode,ran_at:new Date().toISOString(),result:'all assertions passed',order:order.id,bill:opened.billId,contract:opened.contract,total:`${opened.amount!.display} ${status.token!.symbol}`,payer:paid.payer,
  payouts:paid.payouts,tx:{open:link(paid.tx.open),pay:link(paid.tx.pay),witness:link(paid.tx.witness)},timeline:evidence.bills[0].events.map(e=>({kind:e.kind,url:e.url}))};
 if(witness){await api('recipe','POST',{taxBps:700,tipsBps:1000,witnessDeviceId:null,witnessTimeoutS:120});await api(`devices/${witness.id}/deactivate`,'POST',{});}
 const file=`near-hackathon/evidence/e2e-api-${mode}-${new Date().toISOString().slice(0,19).replaceAll(':','')}.json`;
 fs.writeFileSync(file,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,1));console.log('ALL PASSED · wrote',file);
}finally{await pool.end();}
