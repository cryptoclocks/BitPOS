'use strict';
const c=require('./common.cjs');
const MINT='4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7';
const ENDPOINT='https://api.sandbox.paxos.com/v2/treasury/faucet/transfers';
async function balances(){
  await c.assertDevnet();
  const mint=new c.web3.PublicKey(MINT);
  const info=await c.connection.getAccountInfo(mint);
  if(!info?.owner.equals(c.spl.TOKEN_2022_PROGRAM_ID))throw new Error('Unexpected Paxos devnet USDG mint owner');
  const decoded=await c.spl.getMint(c.connection,mint,'confirmed',c.spl.TOKEN_2022_PROGRAM_ID);
  if(decoded.decimals!==6)throw new Error('Unexpected USDG decimals');
  const manifest=c.publicManifest();
  const addresses=manifest.wallets.map(w=>c.spl.getAssociatedTokenAddressSync(mint,new c.web3.PublicKey(w.address),false,c.spl.TOKEN_2022_PROGRAM_ID));
  const accounts=await c.connection.getMultipleAccountsInfo(addresses);
  const result={cluster:'devnet',issuer:'Paxos sandbox faucet',asset:'USDG TEST — no monetary value',mint:MINT,program:c.spl.TOKEN_2022_PROGRAM_ID.toBase58(),decimals:6,checkedAt:new Date().toISOString(),wallets:manifest.wallets.map((w,i)=>{const account=accounts[i]?c.spl.unpackAccount(addresses[i],accounts[i],c.spl.TOKEN_2022_PROGRAM_ID):null;if(account&&(!account.mint.equals(mint)||!account.owner.equals(new c.web3.PublicKey(w.address))))throw new Error('USDG token account mismatch');return {id:w.id,address:w.address,tokenAccount:addresses[i].toBase58(),rawAmount:account?.amount.toString()||'0',usdg:Number(account?.amount||0n)/1e6,exists:!!account}})};
  result.totalUsdg=result.wallets.reduce((sum,w)=>sum+w.usdg,0);
  c.writePrivate('usdg-balances.json',result);
  return result;
}
async function request(role){
  if(!c.roles.some(w=>w.id===role))throw new Error('Unknown role');
  await c.assertDevnet();
  const historyFile=c.path.join(c.privateDir,'activity.jsonl');
  const history=c.fs.existsSync(historyFile)?c.fs.readFileSync(historyFile,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
  const recent=history.filter(x=>x.operation==='paxos-test-usdg-request'&&x.status===200);
  if(recent.some(x=>x.role===role&&Date.now()-Date.parse(x.at)<86400000)){console.log(JSON.stringify({role,status:'already-requested-within-24h'}));return}
  const last=recent.at(-1);
  const wait=last?Math.max(0,61000-(Date.now()-Date.parse(last.at))):0;
  if(wait){console.log(JSON.stringify({role,waitSeconds:Math.ceil(wait/1000)}));await new Promise(r=>setTimeout(r,wait))}
  const response=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'USDG',network:'SOLANA',address:c.key(role).publicKey.toBase58()}),signal:AbortSignal.timeout(30000)});
  const body=await response.text();
  c.journal({operation:'paxos-test-usdg-request',role,status:response.status,response:body});
  if(!response.ok)throw new Error(`Paxos ${response.status}: ${body}. Stop and respect faucet limits.`);
  console.log(JSON.stringify({role,status:'accepted',response:body}));
}
(async()=>{
  const command=process.argv[2]||'balances';
  if(command==='request-all')for(const role of c.roles)await request(role.id);
  else if(command==='request')await request(process.argv[3]);
  else if(command!=='balances')throw new Error('Use balances, request <role> or request-all');
  const result=await balances();console.log(JSON.stringify({mint:result.mint,totalUsdg:result.totalUsdg,wallets:result.wallets.map(({id,usdg})=>({id,usdg}))},null,2));
})().catch(error=>{console.error(error.message);process.exit(1)});
