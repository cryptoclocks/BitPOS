// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// The split recipe: who one bill pays. Pure integer arithmetic; the parts always add up to the total exactly.
export interface RecipeInput {
 total:bigint;
 owner:{account:string;label:string};
 taxBps:number;
 tax:{id:string;account:string;label:string}|null;
 tipsBps:number;
 /** Staff on shift right now, in a stable order. */
 staff:{id:string;account:string;label:string;weight:number}[];
 /** Open supplier invoices with what is still to collect, oldest first. */
 invoices:{id:string;recipientId:string;account:string;label:string;remaining:bigint;rateBps:number}[];
}
export interface PlannedPayout {role:'owner'|'tax'|'tips'|'supplier';label:string;account:string;amount:bigint;recipientId:string|null;invoiceId:string|null}
/** The contract accepts at most 10 payouts: owner + tax + up to 5 staff + up to 3 invoices. */
export const MAX_STAFF=5,MAX_INVOICES=3,MAX_SHARE_BPS=9000;
const part=(total:bigint,bps:number)=>total*BigInt(bps)/10000n;

export function computePayouts(input:RecipeInput):PlannedPayout[]{
 const {total}=input;
 if(total<=0n)throw new RangeError('TOTAL_INVALID');
 for(const bps of [input.taxBps,input.tipsBps,...input.invoices.map(i=>i.rateBps)])if(!Number.isInteger(bps)||bps<0||bps>10000)throw new RangeError('BPS_INVALID');
 const invoices=input.invoices.filter(i=>i.remaining>0n).slice(0,MAX_INVOICES);
 if(input.taxBps+input.tipsBps+invoices.reduce((sum,i)=>sum+i.rateBps,0)>MAX_SHARE_BPS)throw new RangeError('SHARES_TOO_LARGE');
 const out:PlannedPayout[]=[];
 const tax=input.tax?part(total,input.taxBps):0n;
 if(tax>0n)out.push({role:'tax',label:input.tax!.label,account:input.tax!.account,amount:tax,recipientId:input.tax!.id,invoiceId:null});
 // Tips are shared by weight among staff on shift; rounding dust goes to the first of them. Nobody on shift: the owner keeps it.
 const staff=input.staff.slice(0,MAX_STAFF),tips=staff.length?part(total,input.tipsBps):0n;
 if(tips>0n){
  const weight=staff.reduce((sum,s)=>sum+BigInt(s.weight),0n);
  const shares=staff.map(s=>tips*BigInt(s.weight)/weight);
  shares[0]+=tips-shares.reduce((sum,v)=>sum+v,0n);
  staff.forEach((s,i)=>{if(shares[i]>0n)out.push({role:'tips',label:s.label,account:s.account,amount:shares[i],recipientId:s.id,invoiceId:null});});
 }
 for(const invoice of invoices){
  const share=part(total,invoice.rateBps),amount=share<invoice.remaining?share:invoice.remaining;
  if(amount>0n)out.push({role:'supplier',label:invoice.label,account:invoice.account,amount,recipientId:invoice.recipientId,invoiceId:invoice.id});
 }
 const owner=total-out.reduce((sum,p)=>sum+p.amount,0n);
 if(owner<=0n)throw new RangeError('OWNER_SHARE_EMPTY');
 return [{role:'owner',label:input.owner.label,account:input.owner.account,amount:owner,recipientId:null,invoiceId:null},...out];
}
