import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import '../styles/loyalty-settings.css';

interface Tier { slot: number; nameTh: string; nameEn: string; minPoints: number; currency: string; decimals: number; enabled: boolean; mintAddress: string | null }
interface Stats { payingCustomers: number; repeatCustomers: number; repeatRatePercent: number; activeLast30Days: number; members: number; badgesHeld: number }
interface Settings { tiers: Tier[]; stats: Stats }
interface Verified { wallet: string; source: string; highest: { slot: number; nameTh: string; nameEn: string } | null; held: unknown[] }
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Counts up to the server's number (instantly when the user prefers reduced motion). */
function CountUp({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [shown, setShown] = useState(reduced() ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced()) { setShown(value); return; }
    const start = performance.now(), begin = from.current, span = 900;
    let frame = 0;
    const tick = (now: number) => { const p = Math.min(1, (now - start) / span), eased = 1 - Math.pow(1 - p, 3); setShown(Math.round(begin + (value - begin) * eased)); if (p < 1) frame = requestAnimationFrame(tick); else from.current = value; };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{shown}{suffix}</>;
}

// Owner/manager screen for "Regulars" tiers, the repeat-customer card, and the on-chain badge lookup (reads the chain, not our tables).
export default function LoyaltySettings({ token, language }: { token: string; language: 'th' | 'en' }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [data, setData] = useState<Settings | null>(null); const [error, setError] = useState('');
  const load = () => api<Settings>('/settings/loyalty', undefined, token).then(v => { setData(v); setError(''); }).catch(e => setError(errorMessage(e)));
  useEffect(() => { void load(); }, [token]);
  const slots = [1, 2, 3];
  return <section className="panel loyalty-settings" aria-label="Regulars">
    <h2>Regulars · {text('ลูกค้าประจำ', 'loyal customers')}</h2>
    <p className="notice" role="status">{text('ระดับสมาชิกคิดจากแต้มสะสมตลอดชีพ (ออเดอร์ที่จ่ายแล้วและไม่มีคืนเงิน) ตราบน Solana devnet โอนต่อไม่ได้ ไม่มีมูลค่าเงิน และลูกค้าต้องยินยอมก่อนจึงจะได้รับ', 'Levels come from lifetime points (paid, refund-free orders). Badges live on Solana devnet, cannot be transferred, have no monetary value, and customers must opt in first.')}</p>
    {error && <p className="notice" role="alert">{error}</p>}
    {!data && !error && <p role="status">{text('กำลังโหลด…', 'Loading…')}</p>}
    {data && <>
      <div className="ls-stats" aria-label={text('สถิติลูกค้ากลับมาซื้อซ้ำ', 'Repeat customer statistics')}>
        <div className="ls-stat" style={{ '--i': 0 } as React.CSSProperties}><b><CountUp value={data.stats.payingCustomers} /></b><span>{text('ลูกค้าที่จ่ายแล้ว', 'Paying customers')}</span></div>
        <div className="ls-stat" style={{ '--i': 1 } as React.CSSProperties}><b><CountUp value={data.stats.repeatCustomers} /></b><span>{text('กลับมาซื้อซ้ำ', 'Came back')}</span></div>
        <div className="ls-stat ls-rate" style={{ '--i': 2 } as React.CSSProperties}><b><CountUp value={data.stats.repeatRatePercent} suffix="%" /></b><span>{text('อัตราซื้อซ้ำ', 'Repeat rate')}</span><div className="ls-bar" role="img" aria-label={`${data.stats.repeatRatePercent}%`}><i style={{ width: `${data.stats.repeatRatePercent}%` }} /></div></div>
        <div className="ls-stat" style={{ '--i': 3 } as React.CSSProperties}><b><CountUp value={data.stats.members} /></b><span>{text('สมาชิกที่ยินยอม', 'Opted-in members')}</span></div>
        <div className="ls-stat" style={{ '--i': 4 } as React.CSSProperties}><b><CountUp value={data.stats.badgesHeld} /></b><span>{text('ตราที่ถืออยู่', 'Badges held')}</span></div>
      </div>
      <div className="ls-tiers">{slots.map(slot => <TierRow key={slot} slot={slot} tier={data.tiers.find(t => t.slot === slot)} token={token} language={language} saved={load} />)}</div>
    </>}
    <Lookup token={token} language={language} />
  </section>;
}

function TierRow({ slot, tier, token, language, saved }: { slot: number; tier?: Tier; token: string; language: 'th' | 'en'; saved: () => Promise<unknown> }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [nameTh, setNameTh] = useState(tier?.nameTh ?? ''); const [nameEn, setNameEn] = useState(tier?.nameEn ?? '');
  const [min, setMin] = useState(tier ? String(tier.minPoints) : ''); const [enabled, setEnabled] = useState(tier?.enabled ?? true);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [ok, setOk] = useState(false);
  useEffect(() => { setNameTh(tier?.nameTh ?? ''); setNameEn(tier?.nameEn ?? ''); setMin(tier ? String(tier.minPoints) : ''); setEnabled(tier?.enabled ?? true); }, [tier?.nameTh, tier?.nameEn, tier?.minPoints, tier?.enabled]);
  const points = Number(min), valid = nameTh.trim() && nameEn.trim() && Number.isInteger(points) && points >= 1;
  async function save() {
    setBusy(true); setMessage(''); setOk(false);
    try { await api('/settings/loyalty', { slot, nameTh: nameTh.trim(), nameEn: nameEn.trim(), minPoints: points, enabled }, token, 'PUT'); setOk(true); setMessage(text('บันทึกแล้ว', 'Saved')); await saved(); }
    catch (e) {
      const code = e instanceof ApiError && typeof e.details === 'object' && e.details && 'loyaltyCode' in e.details ? String((e.details as { loyaltyCode: unknown }).loyaltyCode) : '';
      setMessage(code === 'LOYALTY_THRESHOLD_ORDER' ? text('แต้มต้องเพิ่มขึ้นตามลำดับระดับ', 'Points must rise with each level') : code === 'LOYALTY_TIER_LOCKED' ? text('ระดับนี้ออกตราไปแล้ว จึงแก้เกณฑ์แต้มไม่ได้', 'This level already issued badges, so its threshold is locked') : code === 'LOYALTY_PRICING_REQUIRED' ? text('ตั้งราคาเมนูก่อน', 'Set menu prices first') : errorMessage(e));
    }
    setBusy(false);
  }
  return <form className="ls-tier" style={{ '--i': slot } as React.CSSProperties} onSubmit={e => { e.preventDefault(); void save(); }} aria-label={text(`ระดับ ${slot}`, `Level ${slot}`)}>
    <div className="ls-tier-head"><b>{text('ระดับ', 'Level')} {slot}</b>{tier?.mintAddress && <span className="ls-chip" title={tier.mintAddress}>{text('มีตราบนเชนแล้ว', 'Badge mint ready')}</span>}</div>
    <div className="ls-fields">
      <label>{text('ชื่อ (ไทย)', 'Name (Thai)')}<input value={nameTh} maxLength={40} onChange={e => setNameTh(e.target.value)} /></label>
      <label>{text('ชื่อ (อังกฤษ)', 'Name (English)')}<input value={nameEn} maxLength={40} onChange={e => setNameEn(e.target.value)} /></label>
      <label>{text('แต้มสะสมที่ต้องมี', 'Lifetime points needed')}<input inputMode="numeric" value={min} onChange={e => setMin(e.target.value.replace(/\D/g, ''))} /></label>
      <label className="ls-switch"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /><span className="ls-track" aria-hidden="true"><i /></span>{text('เปิดใช้', 'Enabled')}</label>
    </div>
    <div className="toolbar"><button disabled={!valid || busy}>{busy ? text('กำลังบันทึก…', 'Saving…') : text('บันทึก', 'Save')}</button>{message && <span className={ok ? 'ls-ok' : 'ls-bad'} role="status">{message}</span>}</div>
  </form>;
}

function Lookup({ token, language }: { token: string; language: 'th' | 'en' }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [wallet, setWallet] = useState(''); const [busy, setBusy] = useState(false); const [result, setResult] = useState<Verified | null>(null); const [error, setError] = useState('');
  const valid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet.trim());
  async function check() {
    setBusy(true); setError(''); setResult(null);
    try { setResult(await api<Verified>(`/loyalty/verify?wallet=${encodeURIComponent(wallet.trim())}`, undefined, token)); } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  }
  return <form className="ls-lookup" onSubmit={e => { e.preventDefault(); void check(); }} aria-label={text('ตรวจตราจากกระเป๋า', 'Check a wallet badge')}>
    <h3>{text('ตรวจตราสมาชิกจากเชน', 'Check a member badge on-chain')}</h3>
    <p className="catalog-sub">{text('วางที่อยู่กระเป๋าของลูกค้า ระบบอ่านจาก Solana devnet โดยตรง ไม่ใช่จากฐานข้อมูลของเรา', 'Paste a customer wallet address. This reads Solana devnet directly, not our database.')}</p>
    <div className="ls-row"><input value={wallet} onChange={e => setWallet(e.target.value)} placeholder="9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" aria-label="wallet" spellCheck={false} /><button disabled={!valid || busy}>{busy ? text('กำลังตรวจ…', 'Checking…') : text('ตรวจ', 'Check')}</button></div>
    {error && <p className="notice" role="alert">{error}</p>}
    {result && <div className={`ls-result ${result.highest ? 'held' : 'none'}`} role="status" key={result.wallet + (result.highest?.slot ?? 0)}>
      <span className="ls-medal" aria-hidden="true">{result.highest ? '★' : '–'}</span>
      <div><b>{result.highest ? (language === 'th' ? result.highest.nameTh : result.highest.nameEn) : text('ไม่พบตราของร้านนี้', 'No badge from this shop')}</b><small>{text('อ่านจาก', 'Read from')} {result.source}</small></div>
    </div>}
  </form>;
}
