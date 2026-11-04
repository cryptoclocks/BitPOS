// Pure pricing for a cash sale. Every amount is an integer count of minor units (BigInt); there is no floating point anywhere.
export type Discount={kind:'percent';bps:number}|{kind:'amount';minor:string}|null;
export interface Vat{mode:'none'|'inclusive';bps:number}
export interface PricedLine{productId:string;qty:number;unitMinor:bigint;vatExempt?:boolean}
export class CashPriceError extends Error{constructor(readonly code:'EMPTY_CART'|'DISCOUNT_TOO_LARGE'|'TENDER_TOO_LOW'|'BAD_AMOUNT'){super(code);}}
export interface CashTotals{subtotal:bigint;discount:bigint;total:bigint;net:bigint;vat:bigint;tender:bigint|null;change:bigint|null;/** the part of the total that belongs to VAT-exempt lines (it is inside `net`, carries no VAT) */exempt:bigint}

const MAX=9_000_000_000_000_000n;
const amount=(v:bigint)=>{if(v<0n||v>MAX)throw new CashPriceError('BAD_AMOUNT');return v;};

/** Discount in minor units: a percentage rounds DOWN (in the shop's favour); a fixed amount is used as given. It must stay below the subtotal so the bill is never free. */
export function discountMinor(subtotal:bigint,discount:Discount):bigint{
 if(!discount)return 0n;
 const d=discount.kind==='percent'?subtotal*BigInt(discount.bps)/10000n:amount(BigInt(discount.minor));
 if(d>=subtotal)throw new CashPriceError('DISCOUNT_TOO_LARGE');
 return d;
}
/** Tax-inclusive split: net = round-half-up(total/(1+rate)), vat = total-net, so net+vat is exactly the total and no cent is lost. */
export function splitVat(total:bigint,vat:Vat):{net:bigint;vat:bigint}{
 if(vat.mode==='none'||vat.bps===0)return {net:total,vat:0n};
 const d=10000n+BigInt(vat.bps),net=(total*10000n*2n+d)/(2n*d);
 return {net,vat:total-net};
}
/** M03b: lines flagged VAT-exempt stay in the total but carry no VAT. The bill discount is shared between exempt and taxable lines in proportion to their
 * subtotals (exempt share rounds DOWN, the remainder goes to the taxable part), then the tax-inclusive split is applied to the taxable part only.
 * With no exempt line this is exactly the previous behaviour. */
export function priceCashSale(lines:readonly PricedLine[],discount:Discount,vat:Vat,tender?:bigint|null):CashTotals{
 if(!lines.length)throw new CashPriceError('EMPTY_CART');
 const subtotal=lines.reduce((s,l)=>s+amount(l.unitMinor)*BigInt(l.qty),0n);amount(subtotal);
 const exemptSub=lines.reduce((s,l)=>l.vatExempt?s+l.unitMinor*BigInt(l.qty):s,0n);
 const disc=discountMinor(subtotal,discount),total=subtotal-disc;
 const exemptDisc=exemptSub===0n?0n:disc*exemptSub/subtotal,exempt=exemptSub-exemptDisc,taxable=total-exempt;
 const {net:taxNet,vat:tax}=splitVat(taxable,vat),net=exempt+taxNet;
 if(tender===undefined||tender===null)return {subtotal,discount:disc,total,net,vat:tax,tender:null,change:null,exempt};
 amount(tender);if(tender<total)throw new CashPriceError('TENDER_TOO_LOW');
 return {subtotal,discount:disc,total,net,vat:tax,tender,change:tender-total,exempt};
}
