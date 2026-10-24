'use strict';
// --prepare writes only a durable private key/manifest and reads devnet. No transactions.
// --execute is an explicit coordinator operation, treasury-funded (not checkout sponsor).
const c=require('./common.cjs');
const args=process.argv.slice(2),mode=args[0];
if(!['--prepare','--plan','--execute'].includes(mode)||args.slice(1).some(a=>!/^--max-lamports=\d+$/.test(a)))throw Error('Usage: node tools/devnet/test-mint.cjs --prepare|--plan|--execute [--max-lamports=10000000]');
const max=Number((args.find(a=>a.startsWith('--max-lamports='))||'--max-lamports=10000000').split('=')[1]);
if(!Number.isSafeInteger(max)||max<=0||max>10000000)throw Error('Setup cost ceiling must be at most 10000000 lamports');
const mintFile='keys/bitpos-usdt-test-mint.json',stateFile='usdt-test-setup.json';
function persist(state){c.writePrivate(stateFile,state);}
(async()=>{
 await c.assertDevnet();
 if(mode==='--prepare')c.getOrCreateKey('bitpos-usdt-test-mint');
 if(!c.fs.existsSync(c.path.join(c.privateDir,mintFile)))throw Error('Prepare private mint identity first');
 const mint=c.key('bitpos-usdt-test-mint'),treasury=c.key('merchant-a-treasury'),customer=c.key('customer-no-sol');
 const descriptor={assetId:'usdt-test-devnet',symbol:'USDT',displayLabel:'USDT test (BitPOS-issued)',cluster:'devnet',genesisHash:c.DEVNET_GENESIS,mint:mint.publicKey.toBase58(),tokenProgram:c.spl.TOKEN_PROGRAM_ID.toBase58(),decimals:6,instructionPolicy:'spl_checked',issuerTestAsset:false};
 c.writePrivate('usdt-test-asset.public.json',descriptor);
 let state=c.fs.existsSync(c.path.join(c.privateDir,stateFile))?c.readPrivate(stateFile):{mint:descriptor.mint,genesisHash:c.DEVNET_GENESIS};
 if(state.mint!==descriptor.mint||state.genesisHash!==c.DEVNET_GENESIS)throw Error('Private setup identity changed');
 const existing=await c.connection.getAccountInfo(mint.publicKey,'finalized');
 if(existing){
  const observed=await c.spl.getMint(c.connection,mint.publicKey,'finalized',c.spl.TOKEN_PROGRAM_ID);
  if(!existing.owner.equals(c.spl.TOKEN_PROGRAM_ID)||observed.decimals!==6||!observed.isInitialized||observed.tlvData.length||observed.mintAuthority!==null||observed.freezeAuthority!==null||observed.supply!==100000000n)throw Error('Existing test mint differs from immutable setup policy');
  const destination=c.spl.getAssociatedTokenAddressSync(mint.publicKey,treasury.publicKey),source=c.spl.getAssociatedTokenAddressSync(mint.publicKey,customer.publicKey);
  const [to,from]=await Promise.all([c.spl.getAccount(c.connection,destination,'finalized'),c.spl.getAccount(c.connection,source,'finalized')]);
  if(!to.mint.equals(mint.publicKey)||!from.mint.equals(mint.publicKey)||!to.owner.equals(treasury.publicKey)||!from.owner.equals(customer.publicKey))throw Error('Test mint accounts differ');
  state={...state,status:'FINALIZED',descriptor,verifiedAt:new Date().toISOString()};persist(state);console.log(JSON.stringify({descriptor,status:state.status,setupReplayed:true}));return;
 }
 if(state.signature){
  const status=(await c.connection.getSignatureStatuses([state.signature],{searchTransactionHistory:true})).value[0];
  if(status){if(status.err)throw Error('Persisted setup failed on chain; inspect private journal before any new signing');throw Error('Persisted setup pending finalization; rerun identical command later');}
  if(await c.connection.getBlockHeight('finalized')>state.lastValidHeight)throw Error('Persisted setup expired with no chain result; coordinator must inspect and archive private state before explicitly preparing new message');
  if(mode==='--execute'){await c.assertDevnet();const returned=await c.connection.sendRawTransaction(Buffer.from(state.base64,'base64'),{skipPreflight:false,maxRetries:0});if(returned!==state.signature)throw Error('Setup signature mismatch');}
  console.log(JSON.stringify({descriptor,status:'UNRECONCILED',signature:state.signature,rebroadcast:mode==='--execute'}));return;
 }
 const rentMint=await c.connection.getMinimumBalanceForRentExemption(c.spl.MINT_SIZE),rentAccount=await c.connection.getMinimumBalanceForRentExemption(c.spl.ACCOUNT_SIZE);
 const source=c.spl.getAssociatedTokenAddressSync(mint.publicKey,customer.publicKey),destination=c.spl.getAssociatedTokenAddressSync(mint.publicKey,treasury.publicKey);
 const tx=new c.web3.Transaction().add(
  c.web3.SystemProgram.createAccount({fromPubkey:treasury.publicKey,newAccountPubkey:mint.publicKey,space:c.spl.MINT_SIZE,lamports:rentMint,programId:c.spl.TOKEN_PROGRAM_ID}),
  c.spl.createInitializeMint2Instruction(mint.publicKey,6,treasury.publicKey,null),
  c.spl.createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey,source,customer.publicKey,mint.publicKey),
  c.spl.createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey,destination,treasury.publicKey,mint.publicKey),
  c.spl.createMintToCheckedInstruction(mint.publicKey,source,treasury.publicKey,100000000n,6),
  c.spl.createSetAuthorityInstruction(mint.publicKey,treasury.publicKey,c.spl.AuthorityType.MintTokens,null));
 const block=await c.connection.getLatestBlockhash('confirmed');tx.feePayer=treasury.publicKey;tx.recentBlockhash=block.blockhash;
 const fee=(await c.connection.getFeeForMessage(tx.compileMessage(),'confirmed')).value;
 if(fee===null)throw Error('Unavailable fee estimate');const boundedCost=rentMint+2*rentAccount+fee;
 const treasuryBalance=await c.connection.getBalance(treasury.publicKey,'confirmed');
 const customerSol=await c.connection.getBalance(customer.publicKey,'confirmed');
 if(customerSol!==0)throw Error('Zero-SOL customer prerequisite violated');
 if(boundedCost>max||treasuryBalance-boundedCost<1000000)throw Error('Setup exceeds explicit cost ceiling or treasury safety buffer');
 const summary={descriptor,mode,boundedCostLamports:boundedCost,maximumLamports:max,treasuryBalanceLamports:treasuryBalance,payerRole:'merchant-a-treasury',checkoutSponsorTouched:false,checkoutPerOrderCapLamports:1000000,customerSolLamports:customerSol};
 if(mode!=='--execute'){console.log(JSON.stringify(summary));return;}
 tx.sign(treasury,mint);
 const simulation=await c.connection.simulateTransaction(tx);if(simulation.value.err)throw Error('Setup simulation failed');
 const signature=c.bs58.encode(tx.signature);
 state={...state,status:'SIGNED',signature,base64:tx.serialize().toString('base64'),lastValidHeight:block.lastValidBlockHeight,boundedCostLamports:boundedCost,descriptor};
 persist(state);c.journal({type:'signed',purpose:'bitpos-usdt-test-setup',signature,mint:descriptor.mint,boundedCostLamports:boundedCost,lastValidBlockHeight:block.lastValidBlockHeight});
 await c.assertDevnet();
 try{const returned=await c.connection.sendRawTransaction(tx.serialize(),{skipPreflight:false,maxRetries:0});if(returned!==signature)throw Error('Setup signature mismatch');}
 catch{throw Error('Setup submission ambiguous; durable private signature retained, rerun identical command for reconciliation');}
 console.log(JSON.stringify({...summary,status:'SUBMITTED',signature}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
