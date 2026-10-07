'use strict';
// Read-only inspection of the PoW faucet linked by the official Solana cookbook.
// Protocol reference: https://github.com/jarry-xiao/proof-of-work-faucet
const c=require('./common.cjs');
const crypto=require('node:crypto');
(async()=>{
  await c.assertDevnet();
  const program=new c.web3.PublicKey('PoWSNH2hEZogtCg1Zgm51FnkmJperzYDgPK4fvs8taL');
  if(!(await c.connection.getAccountInfo(program))?.executable)throw new Error('PoW program is not executable');
  const discriminator=crypto.createHash('sha256').update('account:Difficulty').digest().subarray(0,8);
  const specs=await c.connection.getProgramAccounts(program,{filters:[{dataSize:17}]});
  const rows=specs.filter(x=>x.account.data.subarray(0,8).equals(discriminator)).map(x=>{
    const difficulty=x.account.data[8],amount=x.account.data.readBigUInt64LE(9);
    const canonical=c.web3.PublicKey.findProgramAddressSync([Buffer.from('spec'),Buffer.from([difficulty]),x.account.data.subarray(9,17)],program)[0];
    if(!canonical.equals(x.pubkey))throw new Error('PoW spec PDA mismatch');
    return {spec:x.pubkey.toBase58(),difficulty,amount,source:c.web3.PublicKey.findProgramAddressSync([Buffer.from('source'),x.pubkey.toBuffer()],program)[0]};
  });
  const accounts=await c.connection.getMultipleAccountsInfo(rows.map(x=>x.source));
  const receiptRent=BigInt(await c.connection.getMinimumBalanceForRentExemption(0));
  const result={cluster:'devnet',checkedAt:new Date().toISOString(),program:program.toBase58(),receiptRentLamports:receiptRent.toString(),pools:rows.map((x,i)=>{const balance=BigInt(accounts[i]?.lamports||0);return {spec:x.spec,source:x.source.toBase58(),difficulty:x.difficulty,rewardLamports:x.amount.toString(),poolLamports:balance.toString(),funded:balance>=x.amount,netPositive:x.amount>receiptRent+10000n,practicalDifficulty:x.difficulty<=4}})};
  result.usablePools=result.pools.filter(x=>x.funded&&x.netPositive&&x.practicalDifficulty).length;
  c.writePrivate('pow-status.public.json',result);
  console.log(JSON.stringify({cluster:result.cluster,checkedAt:result.checkedAt,pools:result.pools.length,usablePools:result.usablePools,message:result.usablePools?'Funded PoW pool available; review reward/difficulty before mining':'No funded profitable PoW pool at practical difficulty; no CPU mining started'},null,2));
})().catch(error=>{console.error(error.message);process.exit(1)});
