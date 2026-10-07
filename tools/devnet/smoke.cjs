'use strict';
// Live devnet transfers between this task's own test wallets. This is not a POS order test.
const c=require('./common.cjs');
const MINT=new c.web3.PublicKey('4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7');
const MEMO=new c.web3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const TOKEN=c.spl.TOKEN_2022_PROGRAM_ID;
const steps=[
  {id:'customer-payment',from:'customer-alice',to:'merchant-a-treasury',payer:'customer-alice'},
  {id:'merchant-refund',from:'merchant-a-treasury',to:'customer-alice',payer:'merchant-a-treasury'},
  {id:'sponsored-payment',from:'customer-no-sol',to:'merchant-b-treasury',payer:'fee-sponsor'},
  {id:'sponsored-refund',from:'merchant-b-treasury',to:'customer-no-sol',payer:'fee-sponsor'}
];
const ata=role=>c.spl.getAssociatedTokenAddressSync(MINT,c.key(role).publicKey,false,TOKEN);
async function tokenBalance(role){const a=await c.spl.getAccount(c.connection,ata(role),'confirmed',TOKEN);if(!a.owner.equals(c.key(role).publicKey)||!a.mint.equals(MINT)||a.isFrozen)throw new Error(`Invalid/frozen USDG account for ${role}`);return a.amount}
(async()=>{
  await c.assertDevnet();
  const mint=await c.spl.getMint(c.connection,MINT,'confirmed',TOKEN);
  if(mint.decimals!==6)throw new Error('Wrong decimals');
  const fee=c.spl.getTransferFeeConfig(mint);
  if(!fee||fee.olderTransferFee.transferFeeBasisPoints!==0||fee.newerTransferFee.transferFeeBasisPoints!==0)throw new Error('USDG fee changed; review the transfer quote');
  const hook=c.spl.getTransferHook(mint);
  if(hook&&!hook.programId.equals(c.web3.SystemProgram.programId))throw new Error('USDG hook changed; update transfer account resolution before testing');
  if(await c.connection.getBalance(c.key('customer-no-sol').publicKey)!==0)throw new Error('customer-no-sol must remain at zero SOL');
  const stateFile=c.path.join(c.privateDir,'smoke-state.json');
  let state=c.fs.existsSync(stateFile)?c.readPrivate('smoke-state.json'):null;
  if(state?.completed){console.log(JSON.stringify({status:'already-completed',result:state.result}));return}
  const participants=[...new Set(steps.flatMap(s=>[s.from,s.to]))];
  if(!state){
    for(const role of [...new Set(steps.map(s=>s.payer))])if(await c.connection.getBalance(c.key(role).publicKey)<100000)throw new Error(`Fund SOL in ${role} before the live smoke test`);
    const before={};for(const role of participants){before[role]=(await tokenBalance(role)).toString();if(BigInt(before[role])<1000000n)throw new Error(`Fund at least 1 USDG test in ${role}`)}
    state={startedAt:new Date().toISOString(),before,nextStep:0,results:[]};c.writePrivate('smoke-state.json',state);
  }
  for(let i=state.nextStep;i<steps.length;i++){
    const step=steps[i];
    // Refuse blind resubmission if a previous broadcast for this step was ambiguous.
    const eventsFile=c.path.join(c.privateDir,'activity.jsonl');
    const events=c.fs.existsSync(eventsFile)?c.fs.readFileSync(eventsFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
    const pending=events.filter(x=>x.operation==='usdg-smoke'&&x.step===step.id&&Date.parse(x.at)>=Date.parse(state.startedAt)).at(-1);
    let signature=pending?.signature;
    if(signature)await c.confirm(signature);
    else{
      const sender=c.key(step.from),payer=c.key(step.payer);
      const tx=new c.web3.Transaction().add(
        c.spl.createTransferCheckedWithFeeInstruction(ata(step.from),MINT,ata(step.to),sender.publicKey,1000000n,6,0n,[],TOKEN),
        new c.web3.TransactionInstruction({programId:MEMO,keys:[],data:Buffer.from(`bitpos-devnet-smoke:${step.id}:${state.startedAt}`)})
      );
      signature=await c.send(tx,payer.publicKey.equals(sender.publicKey)?[payer]:[payer,sender],{operation:'usdg-smoke',step:step.id,from:step.from,to:step.to,payer:step.payer,amountRaw:'1000000',mint:MINT.toBase58()});
    }
    state.nextStep=i+1;state.results.push({step:step.id,signature});c.writePrivate('smoke-state.json',state);console.log(JSON.stringify({confirmed:step.id,signature}));
  }
  const after={};for(const role of participants){after[role]=(await tokenBalance(role)).toString();if(after[role]!==state.before[role])throw new Error(`USDG round trip mismatch for ${role}`)}
  const noSol=await c.connection.getBalance(c.key('customer-no-sol').publicKey);
  if(noSol!==0)throw new Error('Sponsored customer SOL balance changed');
  state.completed=true;state.result={cluster:'devnet',checkedAt:new Date().toISOString(),mint:MINT.toBase58(),roundTripsRestored:true,noSolCustomerLamports:noSol,transactions:state.results};c.writePrivate('smoke-state.json',state);c.writePrivate('smoke-result.public.json',state.result);
  console.log(JSON.stringify(state.result,null,2));
})().catch(error=>{console.error(error.message);process.exit(1)});
