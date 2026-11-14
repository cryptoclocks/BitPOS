// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Unit tests for the pure parts: money, the split recipe, and the verifier — the latter against real transaction
// results captured from NEAR testnet (tests/fixtures/near-tx-*.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {toUnits,unitsToDisplay,displayToUnits} from '../apps/api/src/near/money';
import {computePayouts} from '../apps/api/src/near/recipe';
import {payMessage,txView,witnessMessage,isAccountId,type ChainBill} from '../apps/api/src/near/chain';
import {payTxFacts,refuseDelegate,verifyChainBill,type ExpectedBill} from '../apps/api/src/near/verify';
import {nearConfig,NearConfigError} from '../apps/api/src/near/config';

test('money: catalog minor units convert to 6-decimal token units exactly, or not at all',()=>{
 assert.equal(toUnits('540',2),5_400_000n);assert.equal(toUnits('38250',4),3_825_000n);assert.equal(toUnits(1n,6),1n);
 assert.equal(toUnits('1',7),null,'more decimals than the token has');assert.equal(toUnits('0',2),null);assert.equal(toUnits('-5',2),null);assert.equal(toUnits('abc',2),null);
 assert.equal(toUnits('100000000000',2),null,'above the bill cap');
 assert.equal(unitsToDisplay(5_400_000n),'5.40');assert.equal(unitsToDisplay('3825000'),'3.825');assert.equal(unitsToDisplay(1n),'0.000001');assert.equal(unitsToDisplay(5_000_000n),'5.00');
 assert.equal(displayToUnits('120'),120_000_000n);assert.equal(displayToUnits('0.5'),500_000n);
 for(const bad of ['','1.','01','1e3','-1','1.0000001',' 1',5])assert.equal(displayToUnits(bad),null);
});

const owner={account:'orbit.testnet',label:'Orbit'};
test('recipe: the parts always add up to the total and rounding dust never disappears',()=>{
 const plan=computePayouts({total:5_000_000n,owner,taxBps:700,tax:{id:'t',account:'tax.orbit.testnet',label:'Tax'},tipsBps:1000,
  staff:[{id:'s1',account:'mai.testnet',label:'Mai',weight:1}],invoices:[{id:'i1',recipientId:'r1',account:'milk.testnet',label:'Milk',remaining:100_000_000n,rateBps:1200}]});
 assert.deepEqual(plan.map(p=>[p.role,p.amount]),[['owner',3_550_000n],['tax',350_000n],['tips',500_000n],['supplier',600_000n]]);
 for(const total of [1n,3n,7n,999_999n,5_400_001n,33_333_333n]){
  const parts=computePayouts({total,owner,taxBps:733,tax:{id:'t',account:'tax.testnet',label:'Tax'},tipsBps:1111,
   staff:[{id:'a',account:'a.testnet',label:'A',weight:1},{id:'b',account:'b.testnet',label:'B',weight:2},{id:'c',account:'c.testnet',label:'C',weight:3}],
   invoices:[{id:'i',recipientId:'r',account:'s.testnet',label:'S',remaining:5n,rateBps:900}]});
  assert.equal(parts.reduce((sum,p)=>sum+p.amount,0n),total,`total ${total}`);assert.ok(parts.every(p=>p.amount>0n));assert.equal(parts[0].role,'owner');assert.ok(parts.length<=10);
 }
});
test('recipe: nobody on shift keeps tips with the owner; invoices stop at what is left; limits are enforced',()=>{
 const noStaff=computePayouts({total:1_000_000n,owner,taxBps:0,tax:null,tipsBps:1000,staff:[],invoices:[]});
 assert.deepEqual(noStaff.map(p=>[p.role,p.amount]),[['owner',1_000_000n]]);
 const last=computePayouts({total:5_400_000n,owner,taxBps:0,tax:null,tipsBps:0,staff:[],invoices:[{id:'i',recipientId:'r',account:'s.testnet',label:'S',remaining:460_000n,rateBps:1000},{id:'done',recipientId:'r',account:'s.testnet',label:'S',remaining:0n,rateBps:3000}]});
 assert.deepEqual(last.map(p=>[p.role,p.amount]),[['owner',4_940_000n],['supplier',460_000n]]);
 const many=computePayouts({total:10_000_000n,owner,taxBps:0,tax:null,tipsBps:1000,staff:Array.from({length:9},(_,i)=>({id:'s'+i,account:`s${i}.testnet`,label:'S'+i,weight:1})),invoices:[]});
 assert.equal(many.filter(p=>p.role==='tips').length,5,'at most five staff per bill');
 assert.throws(()=>computePayouts({total:100n,owner,taxBps:3000,tax:{id:'t',account:'t.testnet',label:'T'},tipsBps:3000,staff:[{id:'s',account:'s.testnet',label:'S',weight:1}],invoices:[{id:'i',recipientId:'r',account:'x.testnet',label:'X',remaining:9n,rateBps:3001}]}),/SHARES_TOO_LARGE/);
 assert.throws(()=>computePayouts({total:0n,owner,taxBps:0,tax:null,tipsBps:0,staff:[],invoices:[]}),/TOTAL_INVALID/);
});

const expected:ExpectedBill={contract:'bills.bitpos-near.testnet',merchantAccount:'orbit.bitpos-near.testnet',chainBillId:'e2e-69e51dfb-a',token:'tusd.bitpos-near.testnet',units:5_000_000n,witnessPk:null,
 payouts:[{account:'orbit.bitpos-near.testnet',amount:3_550_000n,role:'owner'},{account:'mai.orbit.bitpos-near.testnet',amount:500_000n,role:'tips'},{account:'tax.orbit.bitpos-near.testnet',amount:350_000n,role:'tax'},{account:'milkfarm.bitpos-near.testnet',amount:600_000n,role:'supplier'}]};
const load=(name:string)=>txView(JSON.parse(fs.readFileSync(`tests/fixtures/${name}.json`,'utf8')));

test('verifier reads real testnet transactions: paid and split, paid into escrow, bounced',()=>{
 const settled=load('near-tx-paid-settled');
 assert.equal(settled.final,true);assert.equal(settled.ok,true);
 assert.deepEqual(settled.events.filter(e=>e.standard==='bitpos-near').map(e=>e.event),['bill_paid','bill_settled']);
 assert.equal(settled.events.filter(e=>e.standard==='nep141'&&e.event==='ft_transfer').length,5,'one transfer in, four out');
 assert.deepEqual(payTxFacts(expected,settled),{kind:'PAID',payer:'alice.bitpos-near.testnet',escrow:false});
 assert.deepEqual(payTxFacts({...expected,chainBillId:'e2e-69e51dfb-c'},load('near-tx-paid-escrow')),{kind:'PAID',payer:'alice.bitpos-near.testnet',escrow:true});
 assert.deepEqual(payTxFacts({...expected,chainBillId:'e2e-69e51dfb-b'},load('near-tx-bounced')),{kind:'BOUNCED',reason:'WRONG_AMOUNT'});
});
test('verifier: a paid event for another bill, amount, token or contract proves nothing; nor does a non-final result',()=>{
 const settled=load('near-tx-paid-settled');
 for(const other of [{chainBillId:'e2e-69e51dfb-x'},{units:4_999_999n},{token:'other.testnet'},{merchantAccount:'evil.testnet'},{contract:'fake-bills.testnet'}])
  assert.equal(payTxFacts({...expected,...other},settled).kind,'NONE',JSON.stringify(other,(k,v)=>typeof v==='bigint'?String(v):v));
 assert.equal(payTxFacts(expected,{...settled,final:false}).kind,'NONE');
});

const delegate=(over:Record<string,unknown>={},call:Record<string,unknown>={})=>({sender:'alice.testnet',receiver:expected.token,otherActions:0,
 calls:[{method:'ft_transfer_call',args:{receiver_id:expected.contract,amount:'5000000',msg:payMessage(expected.merchantAccount,expected.chainBillId)},gas:250_000_000_000_000n,deposit:1n,...call}],...over});
test('relayer pays gas only for exactly this bill',()=>{
 assert.equal(refuseDelegate(expected,delegate()),null);
 assert.equal(refuseDelegate(expected,delegate({receiver:'other-token.testnet'})),'WRONG_TOKEN_CONTRACT');
 assert.equal(refuseDelegate(expected,delegate({otherActions:1})),'UNEXPECTED_ACTIONS');
 assert.equal(refuseDelegate(expected,delegate({calls:[]})),'UNEXPECTED_ACTIONS');
 assert.equal(refuseDelegate(expected,delegate({},{method:'ft_transfer'})),'WRONG_METHOD');
 assert.equal(refuseDelegate(expected,delegate({},{args:null})),'ARGS_INVALID');
 const args=(over:Record<string,unknown>)=>delegate({},{args:{receiver_id:expected.contract,amount:'5000000',msg:payMessage(expected.merchantAccount,expected.chainBillId),...over}});
 assert.equal(refuseDelegate(expected,args({receiver_id:'thief.testnet'})),'WRONG_RECEIVER');
 assert.equal(refuseDelegate(expected,args({amount:'4999999'})),'WRONG_AMOUNT');
 assert.equal(refuseDelegate(expected,args({amount:5000000})),'WRONG_AMOUNT','a number is not the exact string');
 assert.equal(refuseDelegate(expected,args({msg:payMessage(expected.merchantAccount,'another-bill')})),'WRONG_BILL');
 assert.equal(refuseDelegate(expected,args({extra:1})),'ARGS_INVALID');
 assert.equal(refuseDelegate(expected,delegate({},{deposit:2n})),'WRONG_DEPOSIT');
 assert.equal(refuseDelegate(expected,delegate({},{gas:1n})),'GAS_OUT_OF_RANGE');
 assert.equal(refuseDelegate(expected,delegate({},{gas:301_000_000_000_000n})),'GAS_OUT_OF_RANGE');
});

const chainBill=(over:Partial<ChainBill>={}):ChainBill=>({merchant:expected.merchantAccount,bill_id:expected.chainBillId,token:expected.token,total:'5000000',payouts:expected.payouts.map(p=>({account:p.account,amount:p.amount.toString(),role:p.role})),
 expires_at_ms:'1',witness_pk:null,witness_timeout_ms:'120000',state:'Settled',payer:'alice.testnet',paid_at_ms:'1800000000000',closed_at_ms:'1',...over});
test('a bill on chain must equal the frozen server row field by field',()=>{
 assert.deepEqual(verifyChainBill(expected,chainBill()),{state:'Settled',payer:'alice.testnet',paidAtMs:1800000000000});
 assert.deepEqual(verifyChainBill(expected,null),{state:'MISSING'});
 const reasons=(over:Partial<ChainBill>)=>{const v=verifyChainBill(expected,chainBill(over));return v.state==='MISMATCH'?v.reasons:[];};
 assert.deepEqual(reasons({total:'5000001'}),['TOTAL']);assert.deepEqual(reasons({token:'x.testnet'}),['TOKEN']);assert.deepEqual(reasons({merchant:'x.testnet'}),['MERCHANT']);
 assert.deepEqual(reasons({witness_pk:'ab'.repeat(32)}),['WITNESS']);
 assert.deepEqual(reasons({payouts:chainBill().payouts.slice(0,3)}),['PAYOUTS']);
 assert.deepEqual(reasons({payouts:chainBill().payouts.map((p,i)=>i===0?{...p,account:'thief.testnet'}:p)}),['PAYOUTS']);
});

test('messages, account ids and configuration',()=>{
 assert.equal(witnessMessage('bills.bitpos-near.testnet','orbit.bitpos-near.testnet','b_host_test_0001'),'bitpos-near-ack:v1:bills.bitpos-near.testnet:orbit.bitpos-near.testnet:b_host_test_0001');
 assert.equal(payMessage('orbit.testnet','b1'),'{"m":"orbit.testnet","b":"b1"}');
 assert.ok(isAccountId('mai.orbit.bitpos-near.testnet'));for(const bad of ['A.testnet','a..b','-a.testnet','a',' a.testnet',''])assert.equal(isAccountId(bad),false,bad);
 const env={NEAR_NETWORK:'testnet',NEAR_BILLS_CONTRACT:'bills.x.testnet',NEAR_RELAYER_ACCOUNT:'relayer.x.testnet',NEAR_PRIVATE_DIR:'/p'};
 assert.equal(nearConfig(env).network,'testnet');assert.deepEqual(nearConfig(env).demoWallets,[]);
 assert.throws(()=>nearConfig({...env,NEAR_NETWORK:'mainnet'}),(e:NearConfigError)=>e.code==='MAINNET_REFUSED');
 assert.throws(()=>nearConfig({...env,NEAR_BILLS_CONTRACT:'bills.near'}),(e:NearConfigError)=>e.code==='CONFIGURATION_REQUIRED');
 assert.throws(()=>nearConfig({...env,NEAR_RPC_URLS:'http://insecure.example'}),(e:NearConfigError)=>e.code==='CONFIGURATION_REQUIRED');
 assert.throws(()=>nearConfig({}),(e:NearConfigError)=>e.code==='CONFIGURATION_REQUIRED');
});

test('the witness signature made by the firmware C code verifies (fixed-seed vector from tools/firmware/near-host-test)',async()=>{
 const {ed25519}=await import('@noble/curves/ed25519');
 const v={pk:'03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8',sig:'eb8e03ed0378b16870892469166d6f66f2768bc5f65c4028cb4d9286c754a5ace00789a657b5181714f18c623c46d3795a9859d82a5dafed3a3664d125564a04'};
 const message=Buffer.from(witnessMessage('bills.bitpos-near.testnet','orbit.bitpos-near.testnet','b_host_test_0001'));
 assert.equal(ed25519.verify(Buffer.from(v.sig,'hex'),message,Buffer.from(v.pk,'hex')),true);
});

test('cross-chain preview: dry quotes only, no identity leaves the server, failures are shown not thrown',async()=>{
 const {intentsPreview,setIntentsFetch,ONE_CLICK,ORIGINS}=await import('../apps/api/src/near/intents');
 const sent:Record<string,unknown>[]=[];
 setIntentsFetch(async(url,init)=>{assert.equal(url,ONE_CLICK);const body=JSON.parse(init.body);sent.push(body);
  if(body.originAsset.includes('eth-'))return {ok:false,status:400,json:async()=>({message:'Temporary swap limits: minimum swap amount is $100'})};
  if(body.originAsset.includes('arb-'))throw new Error('network');
  return {ok:true,status:200,json:async()=>({quote:{amountInFormatted:'5.05553',amountOutFormatted:'5.0',timeEstimate:35,depositAddress:'must-not-be-used'}})};});
 try{
  const preview=await intentsPreview('pay-in',5_000_000n);
  assert.equal(preview.label,'Mainnet preview · not executed');assert.equal(preview.amount,'5.00');assert.equal(preview.quotes.length,ORIGINS.length);
  assert.deepEqual(preview.quotes[0],{id:'base-usdc',chain:'Base',symbol:'USDC',amountIn:'5.05553',amountOut:'5.0',seconds:35,issue:null});
  assert.equal(preview.quotes.find(q=>q.id==='eth-usdc')!.issue,'Temporary swap limits: minimum swap amount is $100');assert.equal(preview.quotes.find(q=>q.id==='arb-usdc')!.issue,'QUOTE_UNAVAILABLE');
  assert.ok(sent.every(b=>b.dry===true&&b.swapType==='EXACT_OUTPUT'&&b.amount==='5000000'),'every request is a dry quote for the exact bill amount');
  assert.ok(!JSON.stringify(sent).includes('bitpos')&&!JSON.stringify(sent).includes('testnet'),'no shop or account identity in the request');
  assert.ok(!JSON.stringify(preview).includes('must-not-be-used'),'a deposit address is never passed on');
  const before=sent.length;await intentsPreview('pay-in',5_000_000n);assert.equal(sent.length,before,'cached for a minute');
  const home=await intentsPreview('send-home',12_500_000n);assert.equal(home.direction,'send-home');assert.ok(sent.slice(before).every(b=>b.swapType==='EXACT_INPUT'&&b.dry===true));
 }finally{setIntentsFetch(null);}
});

test('the Mini screen text keeps Thai, Latin-1 and listed punctuation, and folds the rest',async()=>{
 const {screenText}=await import('../apps/api/src/near/device');
 assert.equal(screenText('Orbit Café · Table 2 — paid…'),'Orbit Café · Table 2 — paid…');
 assert.equal(screenText('จ่ายแล้ว ✓'),'จ่ายแล้ว OK');
 assert.equal(screenText('Łódź ☕'),'Lódz ','Latin-1 letters stay, others lose their accent, emoji are dropped');
});
