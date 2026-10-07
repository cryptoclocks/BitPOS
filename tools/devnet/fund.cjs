'use strict';
const c=require('./common.cjs');
(async()=>{
  await c.assertDevnet();
  const command=process.argv[2]||'balances';
  if(command==='airdrop'){
    const amount=Number(process.argv[3]||'2');if(!Number.isFinite(amount)||amount<=0||amount>2)throw new Error('Request amount must be >0 and <=2 devnet SOL');
    const address=c.key('reserve').publicKey;
    const signature=await c.connection.requestAirdrop(address,Math.round(amount*c.web3.LAMPORTS_PER_SOL));
    c.journal({type:'airdrop-requested',signature,address:address.toBase58(),sol:amount});await c.confirm(signature);
    console.log(JSON.stringify({airdropConfirmed:signature,sol:amount}));
  }else if(command==='distribute'){
    const reserve=c.key('reserve');
    const snapshot=await c.refreshBalances();
    const deficits=snapshot.wallets.filter(w=>w.id!=='reserve'&&w.targetSol>0).map(w=>({wallet:w,lamports:Math.max(0,Math.round(w.targetSol*c.web3.LAMPORTS_PER_SOL)-w.lamports)})).filter(x=>x.lamports>0);
    const required=deficits.reduce((sum,x)=>sum+x.lamports,0);
    const available=await c.connection.getBalance(reserve.publicKey);
    const keep=Math.round(c.roles.find(r=>r.id==='reserve').targetSol*1e9)+100000000; // Keep the full reserve plus asset-creation fees.
    if(available<required+keep)throw new Error(`Reserve has ${available/1e9} SOL; distribution needs ${(required+keep)/1e9} SOL. No partial transfers performed.`);
    for(let start=0;start<deficits.length;start+=6){
      const batch=deficits.slice(start,start+6);const tx=new c.web3.Transaction();
      for(const {wallet,lamports} of batch)tx.add(c.web3.SystemProgram.transfer({fromPubkey:reserve.publicKey,toPubkey:new c.web3.PublicKey(wallet.address),lamports}));
      const signature=await c.send(tx,[reserve],{operation:'role-sol-funding',recipients:batch.map(x=>({role:x.wallet.id,lamports:x.lamports}))});
      console.log(JSON.stringify({fundedRoles:batch.map(x=>x.wallet.id),signature}));
    }
  }else if(command!=='balances')throw new Error('Use airdrop, distribute or balances');
  const result=await c.refreshBalances();console.log(JSON.stringify({totalSol:result.totalSol,wallets:result.wallets.map(({id,sol,targetSol})=>({id,sol,targetSol}))},null,2));
})().catch(error=>{console.error(error.message);process.exit(1)});
