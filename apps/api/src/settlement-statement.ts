import {SettlementDriverPageSchema,type SettlementDriverPage,type SettlementEarningItem} from '../../../packages/contracts/src/mobile-v1.generated';
import {RequestError} from './authority';
/** DS40 statement export. Pure projection of an already authorised, schema-validated
 * driver earnings page (SQL `settlement088_driver_snapshot`, own account only).
 * Integer minor units as decimal strings, BigInt totals, no FX, no float. A CONFIRMED
 * batch receipt is the only row fact that means money moved; `availability` is never liquidity.
 */
export interface StatementPeriod{from:string;to:string}
export interface StatementTotal{currency:string;decimals:number;count:number;accruedMinor:string;settledConfirmedMinor:string;reversedMinor:string}
export interface DriverStatement{driverId:string;period:StatementPeriod;rows:number;totals:StatementTotal[];csv:string;complete:boolean;basis:'earning accruals created within the period; settled amount counts only a confirmed receipt'}
const header=['accrualId','orderId','createdAt','state','currency','decimals','amountMinor','batchId','batchState','receiptId','confirmedAt','payoutCurrency','payoutAmountMinor'] as const;
/** RFC 4180 quoting plus spreadsheet formula neutralisation for any text cell. */
export function csvCell(value:string|number|null):string{
 const text=value===null?'':String(value);const safe=/^[=+\-@\t\r]/.test(text)?"'"+text:text;
 return /[",\r\n]/.test(safe)?'"'+safe.replaceAll('"','""')+'"':safe;
}
function inPeriod(item:SettlementEarningItem,from:number,to:number){const at=Date.parse(item.createdAt);return at>=from&&at<to;}
export function parseStatementPeriod(fromText:string|null,toText:string|null):StatementPeriod{
 if(!fromText||!toText)throw new RequestError(422,'INVALID_REQUEST');
 const from=Date.parse(fromText),to=Date.parse(toText);
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>366*86400000)throw new RequestError(422,'INVALID_REQUEST');
 return {from:new Date(from).toISOString(),to:new Date(to).toISOString()};
}
export function driverStatement(pages:readonly SettlementDriverPage[],period:StatementPeriod):DriverStatement{
 if(pages.length===0)throw new RequestError(422,'INVALID_REQUEST');
 const parsed=pages.map(page=>SettlementDriverPageSchema.parse(page));const driverId=parsed[0].driverId;
 if(parsed.some(page=>page.driverId!==driverId))throw new RequestError(404,'RESOURCE_NOT_FOUND');
 const from=Date.parse(period.from),to=Date.parse(period.to);const seen=new Set<string>();const items:SettlementEarningItem[]=[];
 for(const page of parsed)for(const item of page.items){
  if(item.driverId!==driverId)throw new RequestError(404,'RESOURCE_NOT_FOUND');
  if(seen.has(item.accrualId))continue;seen.add(item.accrualId);if(inPeriod(item,from,to))items.push(item);
 }
 items.sort((a,b)=>a.createdAt<b.createdAt?-1:a.createdAt>b.createdAt?1:a.accrualId<b.accrualId?-1:1);
 const totals=new Map<string,{currency:string;decimals:number;count:number;accrued:bigint;settled:bigint;reversed:bigint}>();
 const lines=[header.join(',')];
 for(const item of items){
  const key=item.money.currency+':'+item.money.decimals;
  const total=totals.get(key)??{currency:item.money.currency,decimals:item.money.decimals,count:0,accrued:0n,settled:0n,reversed:0n};
  const amount=BigInt(item.money.amountMinor);total.count++;
  if(item.state==='REVERSED')total.reversed+=amount;else total.accrued+=amount;
  const receipt=item.settlement?.receiptId&&item.settlement.state==='CONFIRMED'&&item.settlement.confirmedAt?item.settlement:null;
  if(receipt&&item.state==='SETTLED')total.settled+=amount;
  totals.set(key,total);
  lines.push([item.accrualId,item.orderId,item.createdAt,item.state,item.money.currency,item.money.decimals,item.money.amountMinor,
   item.settlement?.batchId??null,item.settlement?.state??null,receipt?.receiptId??null,receipt?.confirmedAt??null,
   receipt?.payoutMoney.currency??null,receipt?.payoutMoney.amountMinor??null].map(csvCell).join(','));
 }
 return {driverId,period,rows:items.length,csv:lines.join('\r\n')+'\r\n',
  totals:[...totals.values()].sort((a,b)=>(a.currency+a.decimals).localeCompare(b.currency+b.decimals)).map(t=>({currency:t.currency,decimals:t.decimals,count:t.count,accruedMinor:t.accrued.toString(),settledConfirmedMinor:t.settled.toString(),reversedMinor:t.reversed.toString()})),
  complete:parsed[parsed.length-1].nextAfterId===null,basis:'earning accruals created within the period; settled amount counts only a confirmed receipt'};
}
