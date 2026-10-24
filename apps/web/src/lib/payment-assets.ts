import { z } from 'zod';
import type { PaymentAssetSelection, PaymentAssetsView, Settlement } from '../../../../packages/contracts/src/index';

const digits = z.string().regex(/^(0|[1-9]\d*)$/);
const positive = digits.refine(value => BigInt(value) > 0n);
export const denominationSchema = z.object({ id: z.string().min(1), numerator: positive, denominator: positive });
export const settlementSchema = z.object({
  currency: z.enum(['USDG', 'USDC', 'USDT']), decimals: z.literal(6), amountMinor: digits,
  network: z.literal('solana:devnet'), genesisHash: z.string().min(1), mint: z.string().min(1), tokenProgram: z.string().min(1),
  testToken: z.literal(true), recipient: z.string().min(1), sponsor: z.literal('merchant_funded'),
  assetId: z.string().min(1).optional(), displayLabel: z.string().min(1).optional(), denominationPolicy: denominationSchema.optional(),
}).superRefine((value, context) => {
  if (value.currency !== 'USDG' && (!value.assetId || !value.displayLabel || !value.denominationPolicy)) context.addIssue({ code: 'custom', message: 'Asset-aware settlement metadata required' });
});
const assetSchema = z.object({
  assetId: z.string().min(1), symbol: z.enum(['USDG', 'USDC', 'USDT']), displayLabel: z.string().min(1),
  cluster: z.literal('devnet'), genesisHash: z.string().min(1), mint: z.string().min(1), tokenProgram: z.string().min(1), decimals: z.literal(6),
  instructionPolicy: z.enum(['token2022_zero_fee', 'spl_checked']), issuerTestAsset: z.boolean(),
});
const assetsSchema = z.object({ selectedAssetId: z.string().min(1), canChange: z.boolean(), assets: z.array(z.object({ asset: assetSchema, settlement: settlementSchema })) }).superRefine((view, context) => {
  if (new Set(view.assets.map(option => option.asset.assetId)).size !== view.assets.length) context.addIssue({ code: 'custom', message: 'Duplicate authorized asset' });
  for (const { asset, settlement } of view.assets) {
    const historicalUSDG = asset.assetId === 'usdg-devnet' && asset.symbol === 'USDG' &&
      asset.mint === '4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7' &&
      asset.tokenProgram === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' &&
      asset.genesisHash === 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' &&
      settlement.assetId === undefined && settlement.displayLabel === undefined && settlement.denominationPolicy === undefined;
    if ((!historicalUSDG && (asset.assetId !== settlement.assetId || asset.displayLabel !== settlement.displayLabel || !settlement.denominationPolicy)) ||
      asset.symbol !== settlement.currency || asset.mint !== settlement.mint || asset.tokenProgram !== settlement.tokenProgram || asset.genesisHash !== settlement.genesisHash || asset.decimals !== settlement.decimals)
      context.addIssue({ code: 'custom', message: 'Asset descriptor does not match server settlement' });
  }
});
export function decodePaymentAssets(value: unknown): PaymentAssetsView { return assetsSchema.parse(value); }
export function settlementLabel(value: Settlement): string { return value.displayLabel ?? `Test ${value.currency}`; }
export function denominationLabel(value: Settlement): string {
  const policy = value.denominationPolicy;
  return policy ? `${policy.id} · raw units = bill minor units × ${policy.numerator}/${policy.denominator} (exact integer denomination, not market FX)` : 'Historical frozen denomination';
}
export function selectedAssetMatches(view: PaymentAssetsView, settlement: Settlement): boolean {
  const selected = view.assets.find(option => option.asset.assetId === view.selectedAssetId);
  return !!selected && (selected.asset.assetId === settlement.assetId || (!settlement.assetId && settlement.currency === 'USDG')) && selected.settlement.currency === settlement.currency && selected.settlement.amountMinor === settlement.amountMinor && selected.settlement.mint === settlement.mint && selected.settlement.tokenProgram === settlement.tokenProgram && selected.settlement.genesisHash === settlement.genesisHash && selected.settlement.decimals === settlement.decimals && selected.settlement.recipient === settlement.recipient;
}
const selectionSchema = z.object({ assetId: z.string().min(1), expectedVersion: z.number().int().nonnegative().safe(), idempotencyKey: z.string().min(1) }).strict();
const selectionKey = (token: string) => 'bitpos-asset-selection:' + token;
export function pendingAssetSelection(token: string): PaymentAssetSelection | null {
  const raw = window.localStorage.getItem(selectionKey(token));
  return raw ? selectionSchema.parse(JSON.parse(raw)) : null;
}
export function saveAssetSelection(token: string, request: PaymentAssetSelection): void {
  const existing = pendingAssetSelection(token);
  if (existing && JSON.stringify(existing) !== JSON.stringify(request)) throw new Error('Resolve the saved asset selection before choosing another asset.');
  window.localStorage.setItem(selectionKey(token), JSON.stringify(selectionSchema.parse(request)));
}
export function forgetAssetSelection(token: string): void { window.localStorage.removeItem(selectionKey(token)); }
