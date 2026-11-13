// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Preview of the split recipe in the merchant hub. Same integer rule as apps/api/src/near/recipe.ts, re-implemented
// here because the web build may not import server files. The server's answer is what a real bill uses.
export interface RecipePreviewInput {
  /** Token units (6 decimals). */
  total: bigint; taxBps: number; hasTaxAccount: boolean; tipsBps: number; staffOnShift: number;
  invoices: { remaining: bigint; rateBps: number }[];
}
export interface RecipePreview { owner: bigint; tax: bigint; tips: bigint; supplier: bigint; valid: boolean }
const part = (total: bigint, bps: number) => total * BigInt(bps) / 10000n;
export const MAX_SHARE_BPS = 9000;
export function previewSplit(input: RecipePreviewInput): RecipePreview {
  const invoices = input.invoices.filter(i => i.remaining > 0n).slice(0, 3);
  const shares = input.taxBps + input.tipsBps + invoices.reduce((sum, i) => sum + i.rateBps, 0);
  const tax = input.hasTaxAccount ? part(input.total, input.taxBps) : 0n;
  const tips = input.staffOnShift > 0 ? part(input.total, input.tipsBps) : 0n;
  let supplier = 0n;
  for (const invoice of invoices) { const share = part(input.total, invoice.rateBps); supplier += share < invoice.remaining ? share : invoice.remaining; }
  const owner = input.total - tax - tips - supplier;
  return { owner, tax, tips, supplier, valid: shares <= MAX_SHARE_BPS && owner > 0n };
}
export function unitsToDisplay(units: bigint): string {
  const unit = 1_000_000n; let frac = (units % unit).toString().padStart(6, '0'); while (frac.length > 2 && frac.endsWith('0')) frac = frac.slice(0, -1);
  return `${units / unit}.${frac}`;
}
/** A typed amount such as "120" or "120.50" → token units; null for anything else, including zero. */
export function displayToUnits(value: string): bigint | null {
  if (!/^(0|[1-9]\d{0,5})(\.\d{1,6})?$/.test(value)) return null;
  const [whole, frac = ''] = value.split('.'); const units = BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0'));
  return units > 0n ? units : null;
}
