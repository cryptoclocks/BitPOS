'use strict';
// Treasury-funded canonical devnet recipient setup; never checkout sponsor funds.
const c=require('./common.cjs');
(async()=>{
 await c.assertDevnet();
 const mint=new c.web3.PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
 const treasury=c.key('merchant-a-treasury'),payer=c.key('customer-no-sol');
 const account=c.spl.getAssociatedTokenAddressSync(mint,treasury.publicKey);
 const observed=await c.spl.getMint(c.connection,mint,'finalized');
 if(observed.decimals!==6||!observed.isInitialized||observed.tlvData.length)throw Error('Canonical mint policy mismatch');
 const mintAccount=await c.connection.getAccountInfo(mint,'finalized');
 if(!mintAccount.owner.equals(c.spl.TOKEN_PROGRAM_ID))throw Error('Canonical mint program mismatch');
 if(await c.connection.getBalance(payer.publicKey,'finalized')!==0)throw Error('Zero-SOL customer prerequisite changed');
 const existing=await c.connection.getAccountInfo(account,'finalized');
 if(existing){
  const token=await c.spl.getAccount(c.connection,account,'finalized');
  if(!token.owner.equals(treasury.publicKey)||!token.mint.equals(mint))throw Error('Recipient account mismatch');
  console.log(JSON.stringify({origin:'canonical_usdc_devnet_recipient_setup',status:'FINALIZED',account:account.toBase58(),replayed:true,checkoutSponsorTouched:false}));return;
 }
 const journalFile='usdc-recipient-setup.json';
 if(c.fs.existsSync(c.path.join(c.privateDir,journalFile)))throw Error('Prior signed setup requires reconciliation; no new signing');
 const tx=new c.web3.Transaction().add(c.spl.createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey,account,treasury.publicKey,mint));
 const block=await c.connection.getLatestBlockhash('confirmed');tx.feePayer=treasury.publicKey;tx.recentBlockhash=block.blockhash;
 const rent=await c.connection.getMinimumBalanceForRentExemption(c.spl.ACCOUNT_SIZE),fee=(await c.connection.getFeeForMessage(tx.compileMessage(),'confirmed')).value;
 if(fee===null||rent+fee>2100000||await c.connection.getBalance(treasury.publicKey,'confirmed')<rent+fee+1000000)throw Error('Setup exceeds bounded treasury allocation');
 const receipt={origin:'canonical_usdc_devnet_recipient_setup',account:account.toBase58(),mint:mint.toBase58(),boundedCostLamports:rent+fee,maximumLamports:2100000,checkoutSponsorTouched:false,customerSolLamports:0};
 if(process.argv[2]!=='--execute'){console.log(JSON.stringify({...receipt,status:'PLAN'}));return;}
 tx.sign(treasury);const simulation=await c.connection.simulateTransaction(tx);if(simulation.value.err)throw Error('Recipient setup simulation failed');
 const signature=c.bs58.encode(tx.signature);c.writePrivate(journalFile,{...receipt,signature,base64:tx.serialize().toString('base64'),lastValidBlockHeight:block.lastValidBlockHeight});
 c.journal({type:'signed',purpose:'canonical-usdc-recipient-setup',signature,boundedCostLamports:rent+fee});
 await c.assertDevnet();const returned=await c.connection.sendRawTransaction(tx.serialize(),{skipPreflight:false,maxRetries:0});if(returned!==signature)throw Error('Setup signature mismatch');
 await c.confirm(signature);console.log(JSON.stringify({...receipt,status:'CONFIRMED',signature}));
})().catch(()=>{console.error('USDC recipient setup failed; inspect private journal before retry. Diagnostic withheld.');process.exitCode=1;});
