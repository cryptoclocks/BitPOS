import type { EffectiveLine, Money } from '../../../../packages/contracts/src/index';
import type {MobileMoney} from '../../../../packages/contracts/src/mobile-v1.generated';

export function formatMoney(value: Money|MobileMoney): string {
  const amount=BigInt(value.amountMinor);
  const sign=amount<0n?'-':'';
  const digits=(amount<0n?-amount:amount).toString().padStart(value.decimals+1,'0');
  if(value.decimals===0)return `${value.currency} ${sign}${digits}`;
  const fraction=digits.slice(-value.decimals);
  const shown=value.currency==='USD'&&value.decimals===4?fraction.replace(/0+$/, '').padEnd(2,'0'):fraction;
  return `${value.currency} ${sign}${digits.slice(0,-value.decimals)}.${shown}`;
}
export function lineTotal(line: EffectiveLine): Money {
  return { ...line.unitPrice, amountMinor: (BigInt(line.unitPrice.amountMinor) * BigInt(line.qty)).toString() };
}
// Decimal input is never routed through Number, parseFloat or an exchange-rate guess.
export function parsePrice(value: string, currency: 'USD' | 'USDG', decimals:2|4|6=currency==='USD'?2:6): string {
  if(currency==='USD'&&decimals!==2&&decimals!==4||currency==='USDG'&&decimals!==6)throw Error('Invalid price precision');
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(value)) throw new Error(`Enter a ${currency} amount with at most ${decimals} decimal places.`);
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
  if (amount <= 0n || amount > 9223372036854775807n) throw new Error('Price must be positive and fit signed integer storage.');
  // Even one unit must fit the supported settlement/display bound.
  if ((currency === 'USD' ? amount * 10n**BigInt(6-decimals) : amount) > 999999999999999999n) throw new Error('Price exceeds the supported settlement amount.');
  return amount.toString();
}
export function decimalAmount(value: Money): string { return formatMoney(value).slice(value.currency.length + 1); }
