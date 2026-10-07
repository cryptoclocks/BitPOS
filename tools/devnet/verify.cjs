'use strict';
const c=require('./common.cjs');
(async()=>{
  await c.assertDevnet();
  const manifest=c.publicManifest();
  if(manifest.wallets.length!==c.roles.length)throw new Error('Role count mismatch');
  if(new Set(manifest.wallets.map(w=>w.address)).size!==manifest.wallets.length)throw new Error('Wallet addresses are not unique');
  for(const dir of [c.privateDir,c.path.join(c.privateDir,'keys'),c.path.join(c.privateDir,'import')]){
    if(c.fs.lstatSync(dir).isSymbolicLink()||(c.fs.statSync(dir).mode&0o777)!==0o700)throw new Error('Private directory permissions must be 700 and must not be a symlink');
  }
  for(const role of c.roles){
    const wallet=manifest.wallets.find(w=>w.id===role.id);
    if(!wallet||c.key(role.id).publicKey.toBase58()!==wallet.address)throw new Error(`Key/address mismatch: ${role.id}`);
    for(const name of [wallet.keypairFile,wallet.walletImportFile]){const file=c.path.join(c.privateDir,name);if(c.fs.lstatSync(file).isSymbolicLink()||(c.fs.statSync(file).mode&0o777)!==0o600)throw new Error(`Private file permissions must be 600: ${role.id}`)}
    const imported=c.web3.Keypair.fromSecretKey(c.bs58.decode(c.fs.readFileSync(c.path.join(c.privateDir,wallet.walletImportFile),'utf8').trim()));
    if(imported.publicKey.toBase58()!==wallet.address)throw new Error(`Import mismatch: ${role.id}`);
  }
  const sol=await c.refreshBalances();
  const usdg=c.readPrivate('usdg-balances.json');
  if(usdg.cluster!=='devnet'||usdg.mint!=='4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7'||usdg.program!==c.spl.TOKEN_2022_PROGRAM_ID.toBase58()||usdg.decimals!==6)throw new Error('USDG snapshot configuration mismatch');
  if(Date.now()-Date.parse(usdg.checkedAt)>60000)throw new Error('Run paxos.cjs balances first to refresh the USDG snapshot');
  const starter=process.argv.includes('--starter');
  const missingSol=sol.wallets.filter(w=>w.sol<(starter?c.roles.find(r=>r.id===w.id).starterSol:w.targetSol)).map(w=>w.id);
  const missingUsdg=c.roles.filter(r=>{const wallet=usdg.wallets.find(w=>w.id===r.id);return !wallet||wallet.address!==manifest.wallets.find(w=>w.id===r.id).address||BigInt(wallet.rawAmount)<BigInt(r.targetTestUsdg)*1000000n}).map(r=>r.id);
  const noSol=sol.wallets.find(w=>w.id==='customer-no-sol');
  if(noSol.sol!==0)throw new Error('The zero-SOL negative test wallet was unexpectedly funded');
  const result={cluster:'devnet',fundingProfile:starter?'starter':'full',checkedAt:new Date().toISOString(),wallets:manifest.wallets.length,uniqueAddresses:true,keysAndImportsMatch:true,privatePermissionsVerified:true,totalSol:sol.totalSol,totalTestUsdg:usdg.totalUsdg,missingSol,missingUsdg,noSolWalletIntentionallyEmpty:true,ready:missingSol.length===0&&missingUsdg.length===0};
  c.writePrivate('verification.public.json',result);console.log(JSON.stringify(result,null,2));
  if(process.argv.includes('--require-funded')&&!result.ready)process.exit(2);
})().catch(error=>{console.error(error.message);process.exit(1)});
