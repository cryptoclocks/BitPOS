// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Pure checks. Nothing here trusts the browser, the wallet or the relayer's word: a bill is what the contract says
// at final finality, compared field by field with what the server froze when it opened the bill.
import {payMessage,type ChainBill,type DelegateSummary,type TxView} from './chain';

export interface ExpectedBill {
 contract:string;merchantAccount:string;chainBillId:string;token:string;units:bigint;witnessPk:string|null;
 payouts:{account:string;amount:bigint;role:string}[];
}
export type ChainVerdict=
 |{state:'MISSING'}
 |{state:'MISMATCH';reasons:string[]}
 |{state:ChainBill['state'];payer:string|null;paidAtMs:number};

/** Compares the contract's bill with the frozen server row. Any difference means: never settle, keep for review. */
export function verifyChainBill(expected:ExpectedBill,bill:ChainBill|null):ChainVerdict{
 if(!bill)return {state:'MISSING'};
 const reasons:string[]=[];
 if(bill.merchant!==expected.merchantAccount)reasons.push('MERCHANT');
 if(bill.bill_id!==expected.chainBillId)reasons.push('BILL_ID');
 if(bill.token!==expected.token)reasons.push('TOKEN');
 if(bill.total!==expected.units.toString())reasons.push('TOTAL');
 if((bill.witness_pk??null)!==expected.witnessPk)reasons.push('WITNESS');
 if(bill.payouts.length!==expected.payouts.length||bill.payouts.some((p,i)=>p.account!==expected.payouts[i].account||p.amount!==expected.payouts[i].amount.toString()||p.role!==expected.payouts[i].role))reasons.push('PAYOUTS');
 if(reasons.length)return {state:'MISMATCH',reasons};
 return {state:bill.state,payer:bill.payer,paidAtMs:Number(bill.paid_at_ms)};
}

const GAS_MIN=100_000_000_000_000n,GAS_MAX=300_000_000_000_000n;
/**
 * The relayer pays gas only for one thing: a single `ft_transfer_call` of exactly this bill's amount, on this bill's
 * token, into the bills contract, carrying this bill's message. Returns the reason for refusing, or null.
 */
export function refuseDelegate(expected:ExpectedBill,delegate:DelegateSummary):string|null{
 if(delegate.receiver!==expected.token)return 'WRONG_TOKEN_CONTRACT';
 if(delegate.otherActions!==0||delegate.calls.length!==1)return 'UNEXPECTED_ACTIONS';
 const call=delegate.calls[0],args=call.args as Record<string,unknown>|null;
 if(call.method!=='ft_transfer_call')return 'WRONG_METHOD';
 if(!args||typeof args!=='object'||Array.isArray(args))return 'ARGS_INVALID';
 if(Object.keys(args).some(key=>!['receiver_id','amount','msg','memo'].includes(key)))return 'ARGS_INVALID';
 if(args.receiver_id!==expected.contract)return 'WRONG_RECEIVER';
 if(args.amount!==expected.units.toString())return 'WRONG_AMOUNT';
 if(args.msg!==payMessage(expected.merchantAccount,expected.chainBillId))return 'WRONG_BILL';
 if(args.memo!==undefined&&args.memo!==null&&(typeof args.memo!=='string'||args.memo.length>64))return 'ARGS_INVALID';
 if(call.deposit!==1n)return 'WRONG_DEPOSIT';
 if(call.gas<GAS_MIN||call.gas>GAS_MAX)return 'GAS_OUT_OF_RANGE';
 return null;
}

export type PayTxFacts={kind:'PAID';payer:string;escrow:boolean}|{kind:'BOUNCED';reason:string}|{kind:'NONE'};
/** What a finalized payment transaction says about this bill, read from the contract's own events. */
export function payTxFacts(expected:ExpectedBill,tx:TxView):PayTxFacts{
 if(!tx.final)return {kind:'NONE'};
 for(const event of tx.events){
  if(event.executor!==expected.contract||event.standard!=='bitpos-near')continue;
  if(event.event==='bill_paid'&&event.data.merchant===expected.merchantAccount&&event.data.bill_id===expected.chainBillId
   &&event.data.token===expected.token&&event.data.amount===expected.units.toString()&&typeof event.data.payer==='string')
   return {kind:'PAID',payer:event.data.payer,escrow:event.data.escrow===true};
 }
 const bounced=tx.events.find(event=>event.executor===expected.contract&&event.standard==='bitpos-near'&&event.event==='payment_bounced');
 return bounced?{kind:'BOUNCED',reason:String(bounced.data.reason??'UNKNOWN').slice(0,40)}:{kind:'NONE'};
}
