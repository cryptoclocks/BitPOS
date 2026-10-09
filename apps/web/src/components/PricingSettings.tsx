import MerchantIcon from './MerchantIcon';
import React, { useEffect, useRef, useState } from 'react';
import type { PriceConfiguration } from '../../../../packages/contracts/src/index';
import { api, errorMessage } from '../lib/api';
import { decimalAmount, parsePrice } from '../lib/money';
import type { Product } from '../lib/menu';
import type { PricingView, Session } from '../lib/table';

export default function PricingSettings({ session, products, saved }: { session: Session; products: Product[]; saved(): void }) {
  const [view, setView] = useState<PricingView>(); const [currency, setCurrency] = useState<'USD' | 'USDG'>('USD'); const [prices, setPrices] = useState<Record<string, string>>({});
  const [demo, setDemo] = useState(false); const [label, setLabel] = useState(''); const [accepted, setAccepted] = useState(false); const [busy, setBusy] = useState(false); const working = useRef(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  async function load() {
    const next = await api<PricingView>('/settings/pricing', undefined, session.token);
    setView(next); setCurrency(next.catalogCurrency ?? 'USD'); setAccepted(false);
    setDemo(next.provenance?.kind === 'demo_configured'); setLabel(next.provenance?.kind === 'demo_configured' ? next.provenance.label : '');
    setPrices(Object.fromEntries(next.prices.map(price => [price.productId, decimalAmount(next.catalogCurrency === 'USDG' ? { currency: 'USDG', decimals: 6, amountMinor: price.unitMinor } : { currency: 'USD', decimals: 2, amountMinor: price.unitMinor })])));
  }
  useEffect(() => { let active = true; setBusy(true); void load().catch(error => { if (active) setError(error instanceof Error ? error.message : 'Pricing setup unavailable'); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, [session.token]);
  const policy = currency === 'USD' ? 'USD_CENTS_TO_USDG_1_TO_1' : 'USDG_RAW_IDENTITY';
  return <section className="panel pricing-settings" aria-label="Owner pricing setup"><h2>Menu prices</h2><p>Set the currency and price for each menu item. Changes apply to new orders.</p>{view && <><p className="badge">{view.configured ? `Prices in ${view.catalogCurrency}` : 'Setup required: new checkout disabled'}</p><form onSubmit={event => { event.preventDefault(); if (working.current || !accepted) return; working.current = true; setBusy(true); setError(''); setMessage(''); void (async () => {
      const body: PriceConfiguration = { expectedRevision: view.revision, catalogCurrency: currency, provenance: demo ? { kind: 'demo_configured', label: label.trim() } : { kind: 'owner_configured' }, prices: products.map(product => ({ productId: product.id, unitMinor: parsePrice(prices[product.id] ?? '', currency) })), settlement: { asset: 'USDG', network: view.settlement.network, mint: view.settlement.mint, tokenProgram: view.settlement.tokenProgram, decimals: 6, quotePolicy: policy } };
      if (demo && !label.trim()) throw new Error('Label this explicitly configured demo catalog.');
      await api('/settings/pricing', body, session.token, 'PUT'); setMessage('Prices saved. Review any open carts again.'); await load(); saved();
    })().catch(error => setError(error instanceof Error ? error.message : 'Pricing publish failed')).finally(() => { working.current = false; setBusy(false); }); }}>
      <label>Catalog currency<select aria-label="Catalog currency" value={currency} disabled={busy} onChange={event => { setCurrency(event.target.value as 'USD' | 'USDG'); setPrices({}); setAccepted(false); }}><option value="USD">USD · 2 decimal places</option><option value="USDG">USDG · 6 decimal places</option></select></label>
      <div className="pricing-grid">{products.map(product => <label key={product.id}>{product.nameEn}<small lang="th">{product.name}</small><input aria-label={`Price for ${product.nameEn}`} inputMode="decimal" value={prices[product.id] ?? ''} required disabled={busy} onChange={event => setPrices(current => ({ ...current, [product.id]: event.target.value }))} /></label>)}</div>
      <label className="check-label"><input type="checkbox" checked={demo} onChange={event => setDemo(event.target.checked)} />Test catalog</label>{demo && <label>Test catalog name<input required value={label} onChange={event => setLabel(event.target.value)} /></label>}
      <section className="notice"><strong>Payment in test USDG</strong><p>{currency === 'USD' ? '1 USD catalog unit is denominated as 1 test USDG token; each USD cent becomes exactly 10,000 USDG raw units. This is your merchant denomination policy, not a market FX rate or redemption guarantee.' : 'USDG catalog amounts settle as exactly the same raw USDG units; no conversion.'}</p><p>{view.settlement.network} · test USDG · Merchant-funded network fees</p><details className="bill-details"><summary>Technical details</summary><p className="mono">Mint: {view.settlement.mint}<br />Program: {view.settlement.tokenProgram}<br />Genesis: {view.settlement.genesisHash}</p></details><label className="check-label"><input type="checkbox" checked={accepted} required disabled={busy} onChange={event => setAccepted(event.target.checked)} />I explicitly accept this denomination policy and devnet asset.</label></section>
      <button disabled={busy || !accepted || !products.length}><MerchantIcon name="save" />Save menu prices</button></form></>}<button className="secondary" disabled={busy} onClick={() => { setBusy(true); setError(''); void load().catch(error => setError(error instanceof Error ? error.message : 'Pricing load failed')).finally(() => setBusy(false)); }}><MerchantIcon name="arrow" />Reload saved prices</button>{error && <p className="error" role="alert">{error} · Draft prices retained. Resolve conflicts explicitly; publishing never silently retries.</p>}{message && <p role="status">{message}</p>}</section>;
}
