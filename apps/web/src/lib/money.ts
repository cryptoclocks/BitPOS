import type { EffectiveLine, Money } from '../../../../packages/contracts/src/index';

export function formatMoney(value: Money): string {
  const digits = BigInt(value.amountMinor).toString().padStart(value.decimals + 1, '0');
  return `${value.currency} ${digits.slice(0, -value.decimals)}.${digits.slice(-value.decimals)}`;
}
export function lineTotal(line: EffectiveLine): Money {
  return { ...line.unitPrice, amountMinor: (BigInt(line.unitPrice.amountMinor) * BigInt(line.qty)).toString() };
}
// Decimal input is never routed through Number, parseFloat or an exchange-rate guess.
export function parsePrice(value: string, currency: 'USD' | 'USDG'): string {
  const decimals = currency === 'USD' ? 2 : 6;
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(value)) throw new Error(`Enter a ${currency} amount with at most ${decimals} decimal places.`);
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
  if (amount <= 0n || amount > 9223372036854775807n) throw new Error('Price must be positive and fit signed integer storage.');
  // Even one unit must fit the supported settlement/display bound.
  if ((currency === 'USD' ? amount * 10000n : amount) > 999999999999999999n) throw new Error('Price exceeds the supported settlement amount.');
  return amount.toString();
}
export function decimalAmount(value: Money): string { return formatMoney(value).slice(value.currency.length + 1); }
