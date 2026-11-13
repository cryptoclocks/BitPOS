// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Merchant hub for the NEAR Living Bill: overview, split recipe, team and shifts, suppliers and invoices, ledger,
// evidence and witness devices. Reads are open to every role; anything that changes who gets paid or moves money
// back is offered only to owner/manager here and is enforced again by the server (ROLE_REQUIRED).
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {api} from '../../lib/api';
import type {Session} from '../../lib/table';
import {LIVE_STATUSES, ROLE_COLOR, nearMessage, roleLabel, shareOf, shortAccount, shortHash, txUrl, type BillStatus, type BillView, type CrossChainPreview, type Lang} from '../../lib/near-shared';
import {MAX_SHARE_BPS, displayToUnits, previewSplit, unitsToDisplay} from '../../lib/near-recipe';
import NearCrossChain from './NearCrossChain';
import NearCfo from './NearCfo';
import '../../styles/near.css';

interface Account {
  enabled: boolean; configured: boolean; network: string; shopName: string; contract: string | null; relayer: string | null; explorerTx: string; explorerAccount: string;
  account: string; token: {contract: string; symbol: string; decimals: number};
  recipe: {taxBps: number; tipsBps: number; witnessDeviceId: string | null; witnessTimeoutS: number};
  balances: Record<string, string | null>;
  recipients: {id: string; kind: 'staff' | 'supplier' | 'tax'; label: string; account: string; onShift: boolean}[];
  devices: DeviceRow[];
  today: {byRole: Record<string, string>; total: string; bills: Record<string, number>};
}
interface DeviceRow {id: string; label: string; kind: 'mini' | 'browser'; registered: boolean; publicKey: string | null; lastSeenAt: string | null}
interface Person {id: string; label: string; account: string; weight: number; onShift: boolean; onShiftSince: string | null; earnedToday: string; earnedTotal: string}
interface Invoice {id: string; recipientId: string; reference: string; total: string; funded: string; rateBps: number; status: 'OPEN' | 'FUNDED' | 'CANCELLED'; dueOn: string | null; createdAt: string}
interface People {items: Person[]; invoices: Invoice[]}
type LedgerBill = BillView & {id: string; orderId: string; serving: string | null; createdAt: string; updatedAt: string};
interface Ledger {token: string; explorerTx: string; bills: LedgerBill[]}
interface Evidence {orderId: string; orderStatus: string; explorerTx: string; bills: (BillView & {id: string; createdAt: string; events: {kind: string; at: string; tx: string | null; url: string | null; detail: Record<string, unknown>}[]})[]}
interface NewDevice {id: string; key: string; terminalUrl: string | null; provision: string | null}
type Tab = 'overview' | 'recipe' | 'team' | 'suppliers' | 'ledger' | 'evidence' | 'devices' | 'cfo';

const STATUS: Record<BillStatus, [string, string, string]> = {
  none: ['—', '—', 'grey'], opening: ['กำลังเปิดบิล', 'Opening', 'grey'], awaiting_payment: ['รอจ่าย', 'Awaiting payment', 'grey'], escrow: ['รอพยาน', 'In escrow', 'amber'],
  settling: ['กำลังแบ่งจ่าย', 'Splitting', 'amber'], paid: ['แบ่งจ่ายแล้ว', 'Settled', 'mint'], recovery: ['ต้องตรวจ', 'Needs review', 'red'], payout_failed: ['แบ่งจ่ายล้มเหลว', 'Split failed', 'red'],
  refunded: ['คืนเงินแล้ว', 'Refunded', 'red'], void: ['ยกเลิก', 'Void', 'grey'], failed: ['เปิดไม่สำเร็จ', 'Open failed', 'red'], mismatch: ['ไม่ตรงกับเชน', 'Mismatch', 'red'],
};
const EVENT: Record<string, [string, string]> = {
  BILL_OPENED: ['เปิดบิลในสัญญา', 'Bill opened in the contract'], OPEN_FAILED: ['เปิดบิลไม่สำเร็จ', 'Opening the bill failed'], PAYMENT_RELAYED: ['ร้านส่งคำสั่งจ่ายของลูกค้า', 'Customer payment relayed by the café'],
  PAYMENT_REFUSED: ['ปฏิเสธคำสั่งจ่าย (ไม่ตรงกับบิล)', 'Payment refused (not exactly this bill)'], PAYMENT_BOUNCED: ['สัญญาเด้งเงินกลับ', 'The contract bounced the payment back'], PAID_ESCROW: ['จ่ายแล้ว เงินรอพยานในสัญญา', 'Paid; money held for the witness'],
  WITNESS_ACK: ['จอของร้านเซ็นเป็นพยาน', 'The screen signed as witness'], WITNESS_REFUSED: ['ลายเซ็นพยานถูกปฏิเสธ', 'Witness signature refused'], SETTLED: ['แบ่งจ่ายครบทุกคน', 'Split paid to everyone'],
  PAYOUT_FAILED: ['แบ่งจ่ายล้มเหลว เงินยังอยู่ในสัญญา', 'Split failed; money still in the contract'], REFUND_SENT: ['ส่งคำสั่งคืนเงิน', 'Refund sent'], REFUNDED: ['คืนเงินให้ผู้จ่ายแล้ว', 'Refunded to the payer'],
  VOIDED: ['ยกเลิกบิลบนเชน', 'Bill voided on chain'], MISMATCH: ['เชนไม่ตรงกับบิลของร้าน', 'Chain does not match the café\'s bill'], CHAIN_CHECK: ['ตรวจเชน', 'Chain check'],
};
const percent = (bps: number) => (bps / 100).toFixed(bps % 100 ? 1 : 0);
const toBps = (value: string) => { const n = Number(value); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
const when = (iso: string | null, lang: Lang) => iso ? new Date(iso).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: 'short'}) : '—';

/** Everything the sections share. The sections are module-level components so their form state survives the polling re-renders. */
interface Ctx {
  account: Account | undefined; team: People | undefined; suppliers: People | undefined; ledger: Ledger | undefined; evidence: Evidence | undefined; evidenceOrder: string;
  setEvidence: (value: Evidence | undefined) => void; setEvidenceOrder: (value: string) => void; setTab: (tab: Tab) => void;
  t: (th: string, en: string) => string; language: Lang; canChange: boolean; busy: boolean;
  change: (run: () => Promise<unknown>, done?: string) => Promise<boolean>; call: <T,>(path: string, body?: unknown) => Promise<T>;
  symbol: string; accountLink: (id: string) => React.ReactNode; txLink: (hash: string | null, label: string) => React.ReactNode; chip: (status: BillStatus) => React.ReactNode; ownerOnly: React.ReactNode;
}

export default function NearWorkspace({session, language}: {session: Session; language: Lang}) {
  const t = (th: string, en: string) => language === 'th' ? th : en;
  const canChange = session.role === 'owner' || session.role === 'manager';
  const [tab, setTab] = useState<Tab>('overview');
  const [account, setAccount] = useState<Account>(); const [team, setTeam] = useState<People>(); const [suppliers, setSuppliers] = useState<People>();
  const [ledger, setLedger] = useState<Ledger>(); const [evidence, setEvidence] = useState<Evidence>(); const [evidenceOrder, setEvidenceOrder] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [cfo, setCfo] = useState(false);
  const call = useCallback(<T,>(path: string, body?: unknown) => api<T>(`/near/${path}`, body, session.token), [session.token]);
  const load = useCallback(async (what: Tab) => {
    const next = await call<Account>('account'); setAccount(next);
    if (what === 'team') setTeam(await call<People>('team'));
    if (what === 'suppliers' || what === 'recipe') setSuppliers(await call<People>('suppliers'));
    if (what === 'ledger' || what === 'evidence' || what === 'overview') setLedger(await call<Ledger>('ledger'));
  }, [call]);
  const liveBills = !!ledger?.bills.some(b => LIVE_STATUSES.includes(b.status));
  useEffect(() => {
    let active = true;
    void load(tab).catch(e => { if (active) setError(nearMessage(e, language)); });
    const timer = setInterval(() => { void load(tab).catch(() => { /* next tick */ }); }, liveBills ? 2500 : 6000);
    return () => { active = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, tab, liveBills]);
  // Café CFO is a separate, optional part: its tab appears only when the server offers it.
  useEffect(() => { let active = true; void call<unknown>('cfo').then(() => { if (active) setCfo(true); }).catch(() => { /* not offered */ }); return () => { active = false; }; }, [call]);
  useEffect(() => { if (tab !== 'evidence' || !evidenceOrder) return; let active = true; const read = () => call<Evidence>(`orders/${evidenceOrder}/evidence`).then(e => { if (active) setEvidence(e); }).catch(e => { if (active) setError(nearMessage(e, language)); }); void read(); const timer = setInterval(read, 4000); return () => { active = false; clearInterval(timer); }; }, [tab, evidenceOrder, call, language]);

  /** One change at a time; the server's refusal is shown in plain words and the data is re-read either way. */
  async function change(run: () => Promise<unknown>, done?: string) {
    if (busy) return false; setBusy(true); setError(''); setNotice('');
    try { await run(); if (done) setNotice(done); return true; }
    catch (e) { setError(nearMessage(e, language)); return false; }
    finally { setBusy(false); void load(tab).catch(() => { /* next tick */ }); }
  }
  const symbol = account?.token.symbol ?? '';
  const accountLink = (id: string) => account ? <a className="near-account" href={account.explorerAccount + id} target="_blank" rel="noreferrer">{shortAccount(id)}</a> : <span className="near-account">{shortAccount(id)}</span>;
  const txLink = (hash: string | null, label: string) => { const url = txUrl(account?.explorerTx, hash); return url ? <a className="near-tx" href={url} target="_blank" rel="noreferrer">{label} · {shortHash(hash!)} ↗</a> : null; };
  const chip = (status: BillStatus) => <span className={`near-status near-status-${STATUS[status][2]}`}>{t(STATUS[status][0], STATUS[status][1])}</span>;
  const ownerOnly = !canChange && <p className="near-hint" role="note">{t('ดูได้อย่างเดียว · การเปลี่ยนแปลงทำได้เฉพาะเจ้าของร้านหรือผู้จัดการ', 'Read only · changes are for the owner or a manager.')}</p>;
  const tabs: [Tab, string][] = [['overview', t('ภาพรวม', 'Overview')], ['recipe', t('สูตรแบ่งเงิน', 'Split recipe')], ['team', t('ทีมและกะ', 'Team & shifts')], ['suppliers', t('ซัพพลายเออร์', 'Suppliers')], ['ledger', t('สมุดบัญชี', 'Ledger')], ['evidence', t('หลักฐาน', 'Evidence')], ['devices', t('เครื่องและพยาน', 'Devices & witness')], ...(cfo ? [['cfo', 'Café CFO'] as [Tab, string]] : [])];

  const c: Ctx = {account, team, suppliers, ledger, evidence, evidenceOrder, setEvidence, setEvidenceOrder, setTab, t, language, canChange, busy, change, call, symbol, accountLink, txLink, chip, ownerOnly};
  if (!account) return <main className="near-workspace" lang={language}><div className="near-page">{error ? <div className="near-alert" role="alert">{error}</div> : <p className="near-loading" role="status">{t('กำลังโหลด…', 'Loading…')}</p>}</div></main>;
  return <main className="near-workspace" lang={language} aria-label="NEAR · Living Bill">
    <div className="near-page">
      <header className="near-head">
        <div><p className="near-caption">NEAR · LIVING BILL</p><h1>{tabs.find(([id]) => id === tab)?.[1]}</h1><p className="near-sub">{t('จ่ายกาแฟแก้วเดียว ทุกคนได้เงินในวินาทีเดียวกัน', 'One coffee payment. Everyone is paid in the same second.')}</p></div>
        <div className="near-head-chips"><span className="near-pill">{account.account}</span><span className="near-net">NEAR testnet</span></div>
      </header>
      <nav className="near-tabs" aria-label={t('หมวดของ NEAR', 'NEAR sections')}>{tabs.map(([id, label]) => <button key={id} type="button" className={id === 'cfo' ? 'near-tab-cfo' : undefined} aria-current={tab === id ? 'page' : undefined} onClick={() => { setError(''); setNotice(''); setTab(id); }}>{label}</button>)}</nav>
      {error && <div className="near-alert" role="alert">{error}</div>}
      {notice && <p className="near-note" role="status">{notice}</p>}
      {tab === 'overview' && <Overview c={c} />}
      {tab === 'recipe' && <Recipe c={c} key={`${account.recipe.taxBps}:${account.recipe.tipsBps}:${account.recipe.witnessDeviceId}:${account.recipe.witnessTimeoutS}`} />}
      {tab === 'team' && <Team c={c} />}
      {tab === 'suppliers' && <Suppliers c={c} />}
      {tab === 'ledger' && <LedgerTab c={c} />}
      {tab === 'evidence' && <EvidenceTab c={c} />}
      {tab === 'devices' && <Devices c={c} />}
      {tab === 'cfo' && <NearCfo session={session} language={language} canChange={canChange} current={account.recipe} symbol={symbol} onChanged={() => { void load('recipe').catch(() => { /* next tick */ }); }} />}
      <footer className="near-foot">{t('เงินทดสอบบน NEAR testnet · ร้านและเมนูเป็นข้อมูลตัวอย่าง', 'Test money on NEAR testnet · the shop and menu are sample data')}</footer>
    </div>
  </main>;

}

function Overview({c}: {c: Ctx}) {
  const {account, team, suppliers, ledger, evidence, evidenceOrder, setEvidence, setEvidenceOrder, setTab, t, language, canChange, busy, change, call, symbol, accountLink, txLink, chip, ownerOnly} = c; void [account, team, suppliers, ledger, evidence, evidenceOrder, setEvidence, setEvidenceOrder, setTab, canChange, busy, change, call, symbol, accountLink, txLink, chip, ownerOnly, language];
  const a = account!; const roles = ['owner', 'tips', 'tax', 'supplier']; const total = a.today.total;
  const staff = a.recipients.filter(r => r.kind === 'staff'); const onShift = staff.filter(r => r.onShift);
  const witness = a.devices.find(d => d.id === a.recipe.witnessDeviceId); const counts = a.today.bills; const last = ledger?.bills[0];
  const billsToday = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const stat = (label: string, role: string | null, value: string, hint: string) => <article className="near-stat">{role && <span className="near-dot" style={{background: ROLE_COLOR[role]}} aria-hidden="true" />}<p>{label}</p><strong>{value} <small>{symbol}</small></strong><span>{hint}</span></article>;
  return <>
    <section className="near-stats">
      {stat(t('ยอดขายวันนี้', 'Sales today'), null, total, t(`${billsToday} บิล · แบ่งจ่ายแล้ว ${counts.SETTLED ?? 0}`, `${billsToday} bills · ${counts.SETTLED ?? 0} settled`))}
      {stat(t('จ่ายให้ทีมแล้ว', 'Paid to the team'), 'tips', a.today.byRole.tips ?? '0.00', onShift.length ? t(`อยู่กะตอนนี้: ${onShift.map(s => s.label).join(', ')}`, `On shift now: ${onShift.map(s => s.label).join(', ')}`) : t('ตอนนี้ไม่มีใครอยู่กะ', 'Nobody is on shift now'))}
      {stat(t('กองภาษี', 'Tax reserve'), 'tax', a.today.byRole.tax ?? '0.00', t('กันไว้ทีละบิล', 'Set aside bill by bill'))}
      {stat(t('ใบแจ้งหนี้ซัพพลายเออร์', 'Supplier invoices'), 'supplier', a.today.byRole.supplier ?? '0.00', t('เก็บจากทุกบิลจนครบ', 'Collected from every bill until funded'))}
    </section>
    <div className="near-grid">
      <section className="near-card near-wide">
        <h2>{t('เงินของวันนี้ไปไหน', 'Where today\'s money went')}</h2>
        <p className="near-sub">{t('แต่ละบิลแบ่งจ่ายเองใน receipt เดียวบน NEAR ไม่มีรอบจ่ายเงินให้รอ', 'Each bill splits itself in one receipt on NEAR. Nothing waits for a payout run.')}</p>
        {Number(total) > 0 ? <><div className="near-bar near-bar-tall" aria-hidden="true">{roles.map(role => <span key={role} style={{width: `${shareOf(a.today.byRole[role] ?? '0', total)}%`, background: ROLE_COLOR[role]}}>{shareOf(a.today.byRole[role] ?? '0', total) >= 8 ? `${Math.round(shareOf(a.today.byRole[role] ?? '0', total))}%` : ''}</span>)}</div>
          <ul className="near-payouts">{roles.map(role => <li key={role}><span className="near-dot" style={{background: ROLE_COLOR[role]}} aria-hidden="true" /><span className="near-payout-who"><strong>{roleLabel(role, language)}</strong></span><span className="near-payout-amount">{a.today.byRole[role] ?? '0.00'}</span></li>)}</ul></>
          : <p className="near-empty">{t('ยังไม่มีบิลที่แบ่งจ่ายแล้ววันนี้', 'No settled bills yet today.')}</p>}
        {last && <div className="near-last"><span>{t('บิลล่าสุด', 'Last bill')}</span><strong>{last.amount?.display} {symbol}{last.serving ? ` · ${last.serving}` : ''}</strong>{chip(last.status)}<button type="button" className="near-link" onClick={() => { setEvidenceOrder(last.orderId); setTab('evidence'); }}>{t('เปิดหลักฐาน →', 'Open evidence →')}</button></div>}
      </section>
      <section className="near-card">
        <h2>{t('บัญชีบน NEAR', 'Accounts on NEAR')}</h2>
        <dl className="near-accounts">
          <dt>{t('สัญญาบิล', 'Bills contract')}</dt><dd>{a.contract ? accountLink(a.contract) : '—'}<small>{t('ถือเงินของบิลจนกว่าจะแบ่งจ่าย', 'Holds each bill until it settles')}</small></dd>
          <dt>{t('ร้าน', 'Shop')}</dt><dd>{accountLink(a.account)}<small>{t('รับส่วนของเจ้าของ', 'Receives the owner share')}{a.balances[a.account] != null ? ` · ${a.balances[a.account]} ${symbol}` : ''}</small></dd>
          <dt>{t('เหรียญ', 'Token')}</dt><dd>{accountLink(a.token.contract)}<small>{symbol} · {a.token.decimals} {t('ตำแหน่ง · เงินทดสอบ', 'decimals · test money')}</small></dd>
          <dt>{t('ผู้ออกค่าธรรมเนียม', 'Fee relayer')}</dt><dd>{a.relayer ? accountLink(a.relayer) : '—'}<small>{t('จ่ายค่าธรรมเนียมเครือข่ายแทนลูกค้า', 'Pays the network fee for customers')}</small></dd>
        </dl>
        <p className="near-hint">{t('กุญแจที่เซิร์ฟเวอร์ถือ เปิดหรือยกเลิกบิลได้เท่านั้น ย้ายเงินของร้านไม่ได้', 'Keys the server holds can open or void a bill — never move the shop\'s money.')}</p>
      </section>
      <section className="near-card">
        <h2>{t('จอที่โต๊ะเป็นพยาน', 'The table screen is the witness')}</h2>
        {witness ? <><p className="near-big">{witness.label}</p><p className="near-sub">{witness.kind === 'browser' ? t('จอจำลองในเบราว์เซอร์', 'Simulated screen in a browser') : 'BitPOS Mini'} · {t('เห็นล่าสุด', 'last seen')} {when(witness.lastSeenAt, language)}</p><p className="near-hint">{t(`เงินจะปล่อยเมื่อจอเซ็นว่าแสดง "จ่ายแล้ว" ไม่เซ็นภายใน ${a.recipe.witnessTimeoutS} วินาที เงินคืนลูกค้า`, `Money is released only after the screen signs that it showed PAID. No signature in ${a.recipe.witnessTimeoutS} s, refund.`)}</p></>
          : <><p className="near-big">{t('ปิดอยู่', 'Off')}</p><p className="near-hint">{t('ตอนนี้บิลแบ่งจ่ายทันทีที่ลูกค้าจ่าย เลือกเครื่องพยานได้ในหน้าเครื่องและพยาน', 'Bills split the moment the customer pays. Choose a witness screen under Devices & witness.')}</p></>}
        <button type="button" className="near-link" onClick={() => setTab('devices')}>{t('เครื่องและพยาน →', 'Devices & witness →')}</button>
      </section>
      <section className="near-card">
        <h2>{t('บิลวันนี้', 'Bills today')}</h2>
        {billsToday ? <ul className="near-counts">{Object.entries(counts).map(([status, n]) => <li key={status}><span>{status.replaceAll('_', ' ').toLowerCase()}</span><strong>{n}</strong></li>)}</ul> : <p className="near-empty">{t('ยังไม่มีบิล', 'No bills yet.')}</p>}
        <button type="button" className="near-link" onClick={() => setTab('ledger')}>{t('สมุดบัญชี →', 'Ledger →')}</button>
      </section>
    </div>
  </>;
}

function Recipe({c}: {c: Ctx}) {
  const {account, team, suppliers, ledger, evidence, evidenceOrder, setEvidence, setEvidenceOrder, setTab, t, language, canChange, busy, change, call, symbol, accountLink, txLink, chip, ownerOnly} = c; void [account, team, suppliers, ledger, evidence, evidenceOrder, setEvidence, setEvidenceOrder, setTab, canChange, busy, change, call, symbol, accountLink, txLink, chip, ownerOnly, language];
  const a = account!;
  const [tax, setTax] = useState(percent(a.recipe.taxBps)); const [tips, setTips] = useState(percent(a.recipe.tipsBps));
  const [witness, setWitness] = useState(a.recipe.witnessDeviceId ?? ''); const [timeout, setTimeoutS] = useState(String(a.recipe.witnessTimeoutS));
  const taxBps = toBps(tax), tipsBps = toBps(tips), timeoutS = Number(timeout);
  const open = (suppliers?.invoices ?? []).filter(i => i.status === 'OPEN');
  const preview = useMemo(() => previewSplit({total: 5_000_000n, taxBps: Number.isFinite(taxBps) ? Math.max(0, taxBps) : 0, hasTaxAccount: a.recipients.some(r => r.kind === 'tax'), tipsBps: Number.isFinite(tipsBps) ? Math.max(0, tipsBps) : 0,
    staffOnShift: a.recipients.filter(r => r.kind === 'staff' && r.onShift).length, invoices: open.map(i => ({remaining: (displayToUnits(i.total) ?? 0n) - (displayToUnits(i.funded) ?? 0n), rateBps: i.rateBps}))}), [taxBps, tipsBps, a.recipients, open]);
  const invoiceBps = open.reduce((sum, i) => sum + i.rateBps, 0);
  const valid = Number.isInteger(taxBps) && taxBps >= 0 && taxBps <= 3000 && Number.isInteger(tipsBps) && tipsBps >= 0 && tipsBps <= 3000 && taxBps + tipsBps + invoiceBps <= MAX_SHARE_BPS && Number.isInteger(timeoutS) && timeoutS >= 30 && timeoutS <= 3600;
  const parts: [string, bigint][] = [['owner', preview.owner], ['tax', preview.tax], ['tips', preview.tips], ['supplier', preview.supplier]];
  return <div className="near-grid">
    <section className="near-card">
      <h2>{t('แต่ละบิลแบ่งอย่างไร', 'How each bill is split')}</h2>{ownerOnly}
      <form className="near-form" onSubmit={event => { event.preventDefault(); void change(() => call('recipe', {taxBps, tipsBps, witnessDeviceId: witness || null, witnessTimeoutS: timeoutS}), t('บันทึกสูตรแล้ว ใช้กับบิลถัดไป', 'Recipe saved. It applies from the next bill.')); }}>
        <label>{t('กันภาษี (%)', 'Tax reserve (%)')}<input inputMode="decimal" value={tax} disabled={!canChange || busy} onChange={e => setTax(e.target.value)} /></label>
        <label>{t('ทิปให้พนักงานที่อยู่กะ (%)', 'Tips for staff on shift (%)')}<input inputMode="decimal" value={tips} disabled={!canChange || busy} onChange={e => setTips(e.target.value)} /></label>
        <label>{t('เครื่องพยาน', 'Witness screen')}<select value={witness} disabled={!canChange || busy} onChange={e => setWitness(e.target.value)}><option value="">{t('ไม่ใช้ · แบ่งจ่ายทันที', 'None · split at once')}</option>{a.devices.map(d => <option key={d.id} value={d.id} disabled={!d.registered}>{d.label}{d.registered ? '' : t(' (ยังไม่ลงทะเบียนกุญแจ)', ' (key not registered yet)')}</option>)}</select></label>
        <label>{t('เวลารอพยานก่อนคืนเงิน (วินาที)', 'Witness time before refund (seconds)')}<input inputMode="numeric" value={timeout} disabled={!canChange || busy} onChange={e => setTimeoutS(e.target.value)} /></label>
        {!valid && <p className="near-alert" role="alert">{t('ภาษีและทิปต้องอยู่ระหว่าง 0–30% รวมกับใบแจ้งหนี้ที่เปิดอยู่ไม่เกิน 90% และเวลารอ 30–3600 วินาที', 'Tax and tips must be 0–30%, together with open invoices at most 90%, and the wait 30–3600 seconds.')}</p>}
        {canChange && <button type="submit" className="near-button" disabled={busy || !valid}>{t('บันทึกสูตร', 'Save recipe')}</button>}
      </form>
    </section>
    <section className="near-card">
      <h2>{t(`ตัวอย่าง: บิล 5.00 ${symbol}`, `Preview: a 5.00 ${symbol} bill`)}</h2>
      <div className="near-bar near-bar-tall" aria-hidden="true">{parts.map(([role, units]) => units > 0n && <span key={role} style={{width: `${Number(units) / 50000}%`, background: ROLE_COLOR[role]}} />)}</div>
      <ul className="near-payouts">{parts.map(([role, units]) => <li key={role}><span className="near-dot" style={{background: ROLE_COLOR[role]}} aria-hidden="true" /><span className="near-payout-who"><strong>{roleLabel(role, language)}</strong></span><span className="near-payout-amount">{units > 0n ? unitsToDisplay(units) : '—'}</span></li>)}</ul>
      <p className="near-hint">{t('คำนวณด้วยจำนวนเต็มแบบเดียวกับเซิร์ฟเวอร์ เศษที่เหลือเป็นของเจ้าของร้าน', 'Whole-number maths, the same rule the server uses. Rounding dust stays with the owner.')}</p>
      {!a.recipients.some(r => r.kind === 'staff' && r.onShift) && <p className="near-hint">{t('ตอนนี้ไม่มีใครอยู่กะ ทิปจึงอยู่กับเจ้าของร้าน', 'Nobody is on shift now, so tips stay with the owner.')}</p>}
      {!a.recipients.some(r => r.kind === 'tax') && <p className="near-hint">{t('ร้านนี้ยังไม่มีบัญชีกองภาษี จึงไม่มีบรรทัดภาษี', 'This shop has no tax account, so there is no tax line.')}</p>}
      {open.length > 0 && <p className="near-hint">{t(`ใบแจ้งหนี้ที่เปิดอยู่เก็บ ${percent(invoiceBps)}% ของแต่ละบิล`, `Open invoices collect ${percent(invoiceBps)}% of each bill.`)}</p>}
    </section>
  </div>;
}

function Team({c}: {c: Ctx}) {
  const {account, team, suppliers, ledger, evidence, evidenceOrder, setEvidence, setEvidenceOrder, setTab, t, language, canChange, busy, change, call, symbol, accountLink, txLink, chip, ownerOnly} = c; void [account, team, suppliers, ledger, evidence, evidenceOrder, setEvidence, setEvidenceOrder, setTab, canChange, busy, change, call, symbol, accountLink, txLink, chip, ownerOnly, language];
  const [label, setLabel] = useState(''); const [near, setNear] = useState(''); const [weight, setWeight] = useState('1');
  const [home, setHome] = useState<Person>(); const [amount, setAmount] = useState(''); const [preview, setPreview] = useState<CrossChainPreview | null>(); const [checking, setChecking] = useState(false);
  const check = async (value: string) => { if (displayToUnits(value) === null) { setPreview(undefined); return; } setChecking(true); try { setPreview(await call<CrossChainPreview>(`remittance?amount=${encodeURIComponent(value)}`)); } catch { setPreview(null); } finally { setChecking(false); } };
  return <div className="near-grid">
    <section className="near-card near-wide">
      <h2>{t('ค่าแรงตามแก้ว', 'Payroll by the cup')}</h2>
      <p className="near-sub">{t('พนักงานที่อยู่กะได้ส่วนแบ่งทิปของทุกบิล เข้าบัญชี NEAR ของตัวเองทันทีที่บิลแบ่งจ่าย', 'Staff on shift get their share of every bill\'s tips in their own NEAR account the moment the bill settles.')}</p>
      {!team ? <p className="near-loading" role="status">{t('กำลังโหลด…', 'Loading…')}</p> : team.items.length === 0 ? <p className="near-empty">{t('ยังไม่มีพนักงาน', 'No staff yet.')}</p> : <table className="near-table"><thead><tr><th>{t('พนักงาน', 'Staff')}</th><th>{t('กะ', 'Shift')}</th><th>{t('วันนี้', 'Today')}</th><th>{t('ทั้งหมด', 'Total')}</th><th /></tr></thead><tbody>{team.items.map(p => <tr key={p.id}>
        <td><strong>{p.label}</strong><small>{accountLink(p.account)}{p.weight > 1 ? ` · ${t('น้ำหนัก', 'weight')} ${p.weight}` : ''}</small></td>
        <td>{p.onShift ? <span className="near-status near-status-mint">{t('อยู่กะ', 'On shift')}</span> : <span className="near-status near-status-grey">{t('ไม่อยู่กะ', 'Off')}</span>}</td>
        <td>{p.earnedToday} {symbol}</td><td>{p.earnedTotal} {symbol}</td>
        <td className="near-actions"><button type="button" className="near-button near-button-outline near-small" disabled={busy} onClick={() => void change(() => call(`team/${p.id}/shift`, {on: !p.onShift}))}>{p.onShift ? t('ออกกะ', 'Clock out') : t('เข้ากะ', 'Clock in')}</button><button type="button" className="near-link" onClick={() => { setHome(p); setAmount(p.earnedTotal); void check(p.earnedTotal); }}>{t('ส่งกลับบ้าน (ดูตัวอย่าง)', 'Send home (preview)')}</button></td>
      </tr>)}</tbody></table>}
    </section>
    <section className="near-card">
      <h2>{t('เพิ่มพนักงาน', 'Add a staff member')}</h2>{ownerOnly}
      {canChange && <form className="near-form" onSubmit={event => { event.preventDefault(); void change(() => call('team', {label: label.trim(), nearAccount: near.trim(), weight: Number(weight) || 1}), t('เพิ่มแล้ว', 'Added.')).then(ok => { if (ok) { setLabel(''); setNear(''); setWeight('1'); } }); }}>
        <label>{t('ชื่อที่แสดง', 'Display name')}<input value={label} maxLength={60} required disabled={busy} onChange={e => setLabel(e.target.value)} /></label>
        <label>{t('บัญชี NEAR (testnet)', 'NEAR account (testnet)')}<input value={near} placeholder="name.testnet" required disabled={busy} onChange={e => setNear(e.target.value)} /></label>
        <label>{t('น้ำหนักส่วนแบ่งทิป (1–10)', 'Tip share weight (1–10)')}<input inputMode="numeric" value={weight} disabled={busy} onChange={e => setWeight(e.target.value)} /></label>
        <button type="submit" className="near-button" disabled={busy}>{t('เพิ่มพนักงาน', 'Add staff')}</button>
        <p className="near-hint">{t('บัญชีต้องมีอยู่จริงบน testnet ร้านจะลงทะเบียนให้บัญชีรับเหรียญได้', 'The account must exist on testnet. The café registers it so it can hold the token.')}</p>
      </form>}
    </section>
    {home && <section className="near-card">
      <h2>{t('ส่งรายได้กลับบ้าน (ดูตัวอย่าง)', 'Send earnings home (preview)')}</h2>
      <p className="near-sub">{home.label} · {shortAccount(home.account)}</p>
      <form className="near-form" onSubmit={event => { event.preventDefault(); void check(amount); }}>
        <label>{t(`จำนวน (${symbol})`, `Amount (${symbol})`)}<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <button type="submit" className="near-button near-button-outline" disabled={checking || displayToUnits(amount) === null}>{checking ? t('กำลังเช็กราคา…', 'Checking prices…') : t('เช็กราคา', 'Check prices')}</button>
      </form>
      {preview === null ? <p className="near-hint">{t('ตัวอย่างนี้ปิดอยู่หรือยังเช็กราคาไม่ได้', 'This preview is switched off or prices could not be checked.')}</p> : preview ? <NearCrossChain preview={preview} language={language} symbol={symbol} /> : displayToUnits(amount) === null ? <p className="near-hint">{t('กรอกจำนวนมากกว่า 0', 'Enter an amount above 0.')}</p> : null}
    </section>}
  </div>;
}

function Suppliers({c}: {c: Ctx}) {
  const {account, team, suppliers, ledger, evidence, evidenceOrder, setEvidence, setEvidenceOrder, setTab, t, language, canChange, busy, change, call, symbol, accountLink, txLink, chip, ownerOnly} = c; void [account, team, suppliers, ledger, evidence, evidenceOrder, setEvidence, setEvidenceOrder, setTab, canChange, busy, change, call, symbol, accountLink, txLink, chip, ownerOnly, language];
  const [label, setLabel] = useState(''); const [near, setNear] = useState('');
  const [recipientId, setRecipientId] = useState(''); const [reference, setReference] = useState(''); const [total, setTotal] = useState(''); const [rate, setRate] = useState('10'); const [due, setDue] = useState(''); const [opened, setOpened] = useState('');
  const s = suppliers; const rateBps = toBps(rate);
  return <div className="near-grid">
    <section className="near-card near-wide">
      <h2>{t('ใบแจ้งหนี้ที่เก็บเงินเอง', 'Invoices that collect themselves')}</h2>
      <p className="near-sub">{t('ทุกบิลกันเงินตามอัตราไปจ่ายซัพพลายเออร์โดยตรงบนเชน จนใบแจ้งหนี้ครบ', 'Every bill sends its rate straight to the supplier on chain until the invoice is funded.')}</p>
      {!s ? <p className="near-loading" role="status">{t('กำลังโหลด…', 'Loading…')}</p> : s.invoices.length === 0 ? <p className="near-empty">{t('ยังไม่มีใบแจ้งหนี้', 'No invoices yet.')}</p> : <ul className="near-invoices">{s.invoices.map(i => { const supplier = s.items.find(p => p.id === i.recipientId); const share = shareOf(i.funded, i.total); const left = (displayToUnits(i.total) ?? 0n) - (displayToUnits(i.funded) ?? 0n);
        return <li key={i.id}>
          <button type="button" className="near-invoice-head" aria-expanded={opened === i.id} onClick={() => setOpened(opened === i.id ? '' : i.id)}><strong>{supplier?.label ?? '—'} · {i.reference}</strong><span className={`near-status near-status-${i.status === 'FUNDED' ? 'mint' : i.status === 'OPEN' ? 'amber' : 'grey'}`}>{i.status === 'FUNDED' ? t('ครบแล้ว', 'Funded') : i.status === 'OPEN' ? t('กำลังเก็บ', 'Collecting') : t('ยกเลิก', 'Cancelled')}</span></button>
          <div className="near-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share)}><span style={{width: `${share}%`}} /></div>
          <p className="near-invoice-line"><strong>{i.funded}</strong> {t('จาก', 'of')} {i.total} {symbol} · {percent(i.rateBps)}% {t('ของทุกบิล', 'of every bill')}{i.dueOn ? ` · ${t('ครบกำหนด', 'due')} ${i.dueOn}` : ''}</p>
          {opened === i.id && <div className="near-invoice-detail"><p>{t('เหลือเก็บอีก', 'Still to collect')}: <strong>{unitsToDisplay(left > 0n ? left : 0n)} {symbol}</strong></p><p>{t('จ่ายเข้าบัญชี', 'Paid into')}: {supplier ? accountLink(supplier.account) : '—'}</p><p>{t('สร้างเมื่อ', 'Created')}: {when(i.createdAt, language)}</p>
            <div className="near-row"><button type="button" className="near-link" onClick={() => setTab('ledger')}>{t('ดูบิลที่จ่ายเข้าใบนี้ในสมุดบัญชี →', 'See the bills that paid into it in the ledger →')}</button>{canChange && i.status === 'OPEN' && <button type="button" className="near-link near-link-red" disabled={busy} onClick={() => void change(() => call(`invoices/${i.id}/cancel`, {}), t('ยกเลิกใบแจ้งหนี้แล้ว บิลถัดไปจะไม่กันเงินให้ใบนี้', 'Invoice cancelled. Later bills no longer collect for it.'))}>{t('ยกเลิกใบแจ้งหนี้', 'Cancel invoice')}</button>}</div></div>}
        </li>; })}</ul>}
    </section>
    <section className="near-card">
      <h2>{t('ซัพพลายเออร์', 'Suppliers')}</h2>
      {s && s.items.length > 0 ? <ul className="near-people">{s.items.map(p => <li key={p.id}><strong>{p.label}</strong><small>{accountLink(p.account)} · {t('ได้รับแล้ว', 'received')} {p.earnedTotal} {symbol}</small></li>)}</ul> : <p className="near-empty">{t('ยังไม่มีซัพพลายเออร์', 'No suppliers yet.')}</p>}
      {ownerOnly}
      {canChange && <form className="near-form" onSubmit={event => { event.preventDefault(); void change(() => call('suppliers', {label: label.trim(), nearAccount: near.trim()}), t('เพิ่มแล้ว', 'Added.')).then(ok => { if (ok) { setLabel(''); setNear(''); } }); }}>
        <label>{t('ชื่อซัพพลายเออร์', 'Supplier name')}<input value={label} maxLength={60} required disabled={busy} onChange={e => setLabel(e.target.value)} /></label>
        <label>{t('บัญชี NEAR (testnet)', 'NEAR account (testnet)')}<input value={near} placeholder="name.testnet" required disabled={busy} onChange={e => setNear(e.target.value)} /></label>
        <button type="submit" className="near-button near-button-outline" disabled={busy}>{t('เพิ่มซัพพลายเออร์', 'Add supplier')}</button>
      </form>}
    </section>
    {canChange && <section className="near-card">
      <h2>{t('สร้างใบแจ้งหนี้', 'New invoice')}</h2>
      <form className="near-form" onSubmit={event => { event.preventDefault(); void change(() => call('invoices', {recipientId, reference: reference.trim(), total: total.trim(), rateBps, ...(due ? {dueOn: due} : {})}), t('สร้างแล้ว บิลถัดไปจะเริ่มกันเงินให้', 'Created. The next bill starts collecting for it.')).then(ok => { if (ok) { setReference(''); setTotal(''); setDue(''); } }); }}>
        <label>{t('ซัพพลายเออร์', 'Supplier')}<select value={recipientId} required disabled={busy} onChange={e => setRecipientId(e.target.value)}><option value="">{t('เลือก', 'Choose')}</option>{s?.items.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label>{t('เลขที่ใบแจ้งหนี้', 'Invoice reference')}<input value={reference} maxLength={60} required disabled={busy} onChange={e => setReference(e.target.value)} /></label>
        <label>{t(`ยอดรวม (${symbol})`, `Total (${symbol})`)}<input inputMode="decimal" value={total} placeholder="120.00" required disabled={busy} onChange={e => setTotal(e.target.value)} /></label>
        <label>{t('เก็บจากทุกบิล (%)', 'Collect from every bill (%)')}<input inputMode="decimal" value={rate} required disabled={busy} onChange={e => setRate(e.target.value)} /></label>
        <label>{t('ครบกำหนด (ไม่บังคับ)', 'Due date (optional)')}<input type="date" value={due} disabled={busy} onChange={e => setDue(e.target.value)} /></label>
        <button type="submit" className="near-button" disabled={busy || !recipientId || displayToUnits(total.trim()) === null || !Number.isInteger(rateBps) || rateBps < 1 || rateBps > 3000}>{t('สร้างใบแจ้งหนี้', 'Create invoice')}</button>
      </form>
    </section>}
  </div>;
}

function LedgerTab({c}: {c: Ctx}) {
  const {account, team, suppliers, ledger, evidence, evidenceOrder, setEvidence, setEvidenceOrder, setTab, t, language, canChange, busy, change, call, symbol, accountLink, txLink, chip, ownerOnly} = c; void [account, team, suppliers, ledger, evidence, evidenceOrder, setEvidence, setEvidenceOrder, setTab, canChange, busy, change, call, symbol, accountLink, txLink, chip, ownerOnly, language];
  const download = () => change(async () => {
    const file = await call<{filename: string; csv: string}>('ledger/export');
    const url = URL.createObjectURL(new Blob([file.csv], {type: 'text/csv;charset=utf-8'})); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = file.filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const action = (bill: LedgerBill, what: 'refund' | 'retry' | 'check', done: string) => change(() => call(`bills/${bill.id}/${what}`, {}), done);
  return <section className="near-card">
    <div className="near-card-head"><div><h2>{t('บิลทั้งหมด', 'Every bill')}</h2><p className="near-sub">{t('หนึ่งบรรทัดต่อบิล พร้อมผู้รับเงินและลิงก์ธุรกรรม', 'One line per bill, with who was paid and the transaction links.')}</p></div><button type="button" className="near-button near-button-outline" disabled={busy} onClick={() => void download()}>{t('ส่งออก CSV', 'Export CSV')}</button></div>
    {!ledger ? <p className="near-loading" role="status">{t('กำลังโหลด…', 'Loading…')}</p> : ledger.bills.length === 0 ? <p className="near-empty">{t('ยังไม่มีบิลบน NEAR', 'No NEAR bills yet.')}</p> : <div className="near-scroll"><table className="near-table"><thead><tr><th>{t('เวลา', 'Time')}</th><th>{t('โต๊ะ/จุดขาย', 'Serving')}</th><th>{t('สถานะ', 'Status')}</th><th>{t('ยอด', 'Total')}</th><th>{t('แบ่งให้', 'Split to')}</th><th>{t('ธุรกรรม', 'Transactions')}</th><th /></tr></thead><tbody>{ledger.bills.map(b => <tr key={b.id}>
      <td>{when(b.createdAt, language)}</td><td>{b.serving ?? '—'}</td>
      <td>{chip(b.status)}{b.witness && <small>{t('มีพยาน', 'witnessed')}</small>}{b.issue && <small className="near-issue">{b.issue.replaceAll('_', ' ').toLowerCase()}</small>}</td>
      <td><strong>{b.amount?.display}</strong> {symbol}{b.payer && <small>{t('จาก', 'from')} {shortAccount(b.payer)}</small>}</td>
      <td><ul className="near-mini-payouts">{b.payouts.map((p, i) => <li key={i}><span className="near-dot" style={{background: ROLE_COLOR[p.role] ?? '#5E6B7A'}} aria-hidden="true" />{p.role === 'owner' || p.role === 'tax' ? roleLabel(p.role, language) : p.label} <b>{p.amount}</b>{p.paid ? ' ✓' : ''}</li>)}</ul></td>
      <td className="near-links">{txLink(b.tx.pay, t('จ่าย', 'Pay'))}{txLink(b.tx.witness, t('พยาน', 'Witness'))}{txLink(b.tx.refund, t('คืนเงิน', 'Refund'))}{txLink(b.tx.open, t('เปิดบิล', 'Open'))}</td>
      <td className="near-actions">
        <button type="button" className="near-link" onClick={() => { setEvidenceOrder(b.orderId); setTab('evidence'); }}>{t('หลักฐาน', 'Evidence')}</button>
        {LIVE_STATUSES.includes(b.status) && <button type="button" className="near-link" disabled={busy} onClick={() => void action(b, 'check', t('ตรวจกับเชนแล้ว', 'Checked against the chain.'))}>{t('ตรวจตอนนี้', 'Check now')}</button>}
        {canChange && (b.status === 'escrow' || b.status === 'payout_failed') && <button type="button" className="near-link near-link-red" disabled={busy} onClick={() => { if (window.confirm(t('คืนเงินทั้งหมดของบิลนี้ให้ผู้จ่าย?', 'Send this bill\'s full amount back to the payer?'))) void action(b, 'refund', t('ส่งคำสั่งคืนเงินแล้ว', 'Refund sent.')); }}>{t('คืนเงิน', 'Refund')}</button>}
        {canChange && b.status === 'payout_failed' && <button type="button" className="near-link" disabled={busy} onClick={() => void action(b, 'retry', t('ลองแบ่งจ่ายใหม่แล้ว', 'Split retried.'))}>{t('ลองแบ่งจ่ายใหม่', 'Retry split')}</button>}
      </td>
    </tr>)}</tbody></table></div>}
  </section>;
}

function EvidenceTab({c}: {c: Ctx}) {
  const {account, team, suppliers, ledger, evidence, evidenceOrder, setEvidence, setEvidenceOrder, setTab, t, language, canChange, busy, change, call, symbol, accountLink, txLink, chip, ownerOnly} = c; void [account, team, suppliers, ledger, evidence, evidenceOrder, setEvidence, setEvidenceOrder, setTab, canChange, busy, change, call, symbol, accountLink, txLink, chip, ownerOnly, language];
  const orders = ledger?.bills.filter((b, i, all) => all.findIndex(x => x.orderId === b.orderId) === i) ?? [];
  return <section className="near-card">
    <div className="near-card-head"><div><h2>{t('เส้นเวลาของบิล', 'Timeline of a bill')}</h2><p className="near-sub">{t('ทุกขั้นพร้อมธุรกรรมบน NEAR ข้อเท็จจริงเท่านั้น ไม่มีการเขียนทับ', 'Every step with its NEAR transaction. Facts only; never rewritten.')}</p></div>
      <label className="near-inline">{t('ออเดอร์', 'Order')}<select value={evidenceOrder} onChange={e => { setEvidence(undefined); setEvidenceOrder(e.target.value); }}><option value="">{t('เลือกบิล', 'Choose a bill')}</option>{orders.map(b => <option key={b.orderId} value={b.orderId}>{when(b.createdAt, language)} · {b.amount?.display} {symbol}{b.serving ? ` · ${b.serving}` : ''}</option>)}</select></label></div>
    {!evidenceOrder ? <p className="near-empty">{t('เลือกบิลเพื่อดูหลักฐาน', 'Choose a bill to see its evidence.')}</p> : !evidence || evidence.orderId !== evidenceOrder ? <p className="near-loading" role="status">{t('กำลังโหลด…', 'Loading…')}</p> : evidence.bills.length === 0 ? <p className="near-empty">{t('ออเดอร์นี้ยังไม่มีบิลบน NEAR', 'This order has no NEAR bill yet.')}</p> : evidence.bills.map(b => <article key={b.id} className="near-evidence">
      <header><strong>{b.amount?.display} {symbol}</strong>{chip(b.status)}<small>{t('บิลบนเชน', 'On-chain bill')} {b.billId}</small><small>{t('ออเดอร์', 'Order')}: {evidence.orderStatus}</small></header>
      <ol className="near-timeline">{b.events.map((e, i) => <li key={i}><time>{when(e.at, language)}</time><div><strong>{EVENT[e.kind] ? t(EVENT[e.kind][0], EVENT[e.kind][1]) : e.kind}</strong>{e.url && e.tx ? <a className="near-tx" href={e.url} target="_blank" rel="noreferrer">{shortHash(e.tx)} ↗</a> : null}{Object.keys(e.detail).length > 0 && <small>{Object.entries(e.detail).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')}</small>}</div></li>)}</ol>
      <ul className="near-mini-payouts">{b.payouts.map((p, i) => <li key={i}><span className="near-dot" style={{background: ROLE_COLOR[p.role] ?? '#5E6B7A'}} aria-hidden="true" />{p.role === 'owner' || p.role === 'tax' ? roleLabel(p.role, language) : p.label} · {shortAccount(p.account)} <b>{p.amount}</b>{p.paid ? ' ✓' : ''}</li>)}</ul>
    </article>)}
  </section>;
}

function Devices({c}: {c: Ctx}) {
  const {account, team, suppliers, ledger, evidence, evidenceOrder, setEvidence, setEvidenceOrder, setTab, t, language, canChange, busy, change, call, symbol, accountLink, txLink, chip, ownerOnly} = c; void [account, team, suppliers, ledger, evidence, evidenceOrder, setEvidence, setEvidenceOrder, setTab, canChange, busy, change, call, symbol, accountLink, txLink, chip, ownerOnly, language];
  const a = account!; const [label, setLabel] = useState(''); const [kind, setKind] = useState<'browser' | 'mini'>('browser'); const [made, setMade] = useState<NewDevice>();
  const setWitness = (id: string | null) => change(() => call('recipe', {taxBps: a.recipe.taxBps, tipsBps: a.recipe.tipsBps, witnessDeviceId: id, witnessTimeoutS: a.recipe.witnessTimeoutS}), id ? t('ตั้งเป็นพยานแล้ว ใช้กับบิลถัดไป', 'Set as the witness from the next bill.') : t('ปิดพยานแล้ว บิลถัดไปแบ่งจ่ายทันที', 'Witness off. The next bill splits at once.'));
  return <div className="near-grid">
    <section className="near-card near-wide">
      <h2>{t('จอที่เป็นพยาน', 'Witness screens')}</h2>
      <p className="near-sub">{t('กุญแจของจอเกิดในตัวจอและไม่เคยออกจากจอ ที่นี่เก็บเฉพาะกุญแจสาธารณะ และสัญญาเป็นผู้ตรวจลายเซ็น', 'A screen\'s key is made on the screen and never leaves it. Only the public half is stored here, and the contract checks the signature.')}</p>
      {a.devices.length === 0 ? <p className="near-empty">{t('ยังไม่มีจอ', 'No screens yet.')}</p> : <table className="near-table"><thead><tr><th>{t('จอ', 'Screen')}</th><th>{t('กุญแจ', 'Key')}</th><th>{t('เห็นล่าสุด', 'Last seen')}</th><th /></tr></thead><tbody>{a.devices.map(d => { const isWitness = a.recipe.witnessDeviceId === d.id; return <tr key={d.id}>
        <td><strong>{d.label}</strong><small>{d.kind === 'browser' ? t('จอจำลองในเบราว์เซอร์', 'Simulated screen in a browser') : 'BitPOS Mini'}{isWitness ? ` · ${t('เป็นพยานอยู่', 'current witness')}` : ''}</small></td>
        <td>{d.registered ? <><span className="near-status near-status-mint">{t('ลงทะเบียนแล้ว', 'Registered')}</span><small title={d.publicKey ?? ''}>{d.publicKey ? shortHash(d.publicKey) : ''}</small></> : <span className="near-status near-status-amber">{t('รอจอส่งกุญแจ', 'Waiting for its key')}</span>}</td>
        <td>{when(d.lastSeenAt, language)}</td>
        <td className="near-actions">{canChange && d.registered && !isWitness && <button type="button" className="near-button near-button-outline near-small" disabled={busy} onClick={() => void setWitness(d.id)}>{t('ตั้งเป็นพยาน', 'Make witness')}</button>}{canChange && isWitness && <button type="button" className="near-button near-button-outline near-small" disabled={busy} onClick={() => void setWitness(null)}>{t('ปิดพยาน', 'Turn witness off')}</button>}{canChange && <button type="button" className="near-link near-link-red" disabled={busy} onClick={() => { if (window.confirm(t('ปิดใช้งานจอนี้?', 'Deactivate this screen?'))) void change(() => call(`devices/${d.id}/deactivate`, {}), t('ปิดใช้งานแล้ว', 'Deactivated.')); }}>{t('ปิดใช้งาน', 'Deactivate')}</button>}</td>
      </tr>; })}</tbody></table>}
      {ownerOnly}
    </section>
    {canChange && <section className="near-card">
      <h2>{t('เพิ่มจอ', 'Add a screen')}</h2>
      <form className="near-form" onSubmit={event => { event.preventDefault(); void change(async () => { setMade(await call<NewDevice>('devices', {label: label.trim(), kind})); setLabel(''); }); }}>
        <label>{t('ชื่อจอ', 'Screen name')}<input value={label} maxLength={60} placeholder={t('เช่น โต๊ะ 4', 'e.g. Table 4')} required disabled={busy} onChange={e => setLabel(e.target.value)} /></label>
        <label>{t('ชนิด', 'Kind')}<select value={kind} disabled={busy} onChange={e => setKind(e.target.value === 'mini' ? 'mini' : 'browser')}><option value="browser">{t('จอจำลองในเบราว์เซอร์', 'Simulated screen in a browser')}</option><option value="mini">BitPOS Mini (firmware NEAR)</option></select></label>
        <button type="submit" className="near-button" disabled={busy}>{t('สร้างจอ', 'Create screen')}</button>
      </form>
    </section>}
    {made && <section className="near-card near-secret" role="status">
      <h2>{t('กุญแจเชื่อมต่อของจอ · แสดงครั้งเดียว', 'This screen\'s connection key · shown once')}</h2>
      <p className="near-hint">{t('กุญแจนี้ใช้ให้จอคุยกับร้านเท่านั้น ย้ายเงินไม่ได้ เก็บไว้ตอนนี้ เพราะจะไม่แสดงอีก', 'This key only lets the screen talk to the café. It cannot move money. Keep it now; it is not shown again.')}</p>
      {made.terminalUrl ? <a className="near-button" href={made.terminalUrl} target="_blank" rel="noreferrer">{t('เปิดจอจำลอง', 'Open simulated screen')}</a> : <><p className="near-sub">{t('ส่งคำสั่งนี้เข้าเครื่องทาง USB', 'Send this command to the device over USB')}</p><code className="near-code">{made.provision}</code></>}
      <details><summary>{t('ดูกุญแจ', 'Show the key')}</summary><code className="near-code">{made.key}</code></details>
      <button type="button" className="near-link" onClick={() => setMade(undefined)}>{t('เก็บแล้ว ปิดกล่องนี้', 'Saved it — close this')}</button>
    </section>}
  </div>;
}
