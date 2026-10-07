'use strict';
const c=require('./common.cjs');
(async()=>{
  const wallets=c.roles.map(role=>{const kp=c.getOrCreateKey(role.id);return {...role,address:kp.publicKey.toBase58(),keypairFile:`keys/${role.id}.json`,walletImportFile:`import/${role.id}.base58.txt`}});
  if(new Set(wallets.map(wallet=>wallet.address)).size!==wallets.length)throw new Error('Wallet addresses must be unique');
  const manifest={cluster:'devnet',rpc:c.RPC,createdAt:new Date().toISOString(),scope:'Locally controlled test wallets; not production identities',wallets};
  c.writePrivate('wallets.public.json',manifest);
  c.writePrivate('wallet-index.csv',['role,address,keypairFile,walletImportFile,targetSol',...wallets.map(w=>[w.id,w.address,w.keypairFile,w.walletImportFile,w.targetSol].join(','))].join('\n')+'\n');
  const genesisHash=await c.assertDevnet();
  const balances=await c.refreshBalances();
  console.log(JSON.stringify({privateDirectory:c.privateDir,walletCount:wallets.length,genesisHash,totalTargetSol:wallets.reduce((sum,w)=>sum+w.targetSol,0),currentTotalSol:balances.totalSol},null,2));
})().catch(error=>{console.error(error.message);process.exit(1)});
