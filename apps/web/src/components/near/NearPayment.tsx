// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Customer pay page for shops paid through the NEAR Living Bill. Shops without NEAR get the existing <Payment/>
// unchanged. Every state on this page comes from the server's view of the contract (GET/POST …/near), never from
// what a wallet window says.
import React, {useCallback, useEffect, useRef, useState} from 'react';
import type {OrderView} from '../../../../../packages/contracts/src/index';
import {api} from '../../lib/api';
import {formatMoney} from '../../lib/money';
import {LIVE_STATUSES, ROLE_COLOR, nearCode, nearMessage, roleLabel, shareOf, shortAccount, shortHash, txUrl, type BillView, type CrossChainPreview, type Lang, type NearStatus} from '../../lib/near-shared';
import NearCrossChain from './NearCrossChain';
import NearAiPass, {type AgentVerdict} from './NearAiPass';
import type {NearWalletSession} from '../../lib/near-wallet';
import Payment from '../Payment';
import '../../styles/near.css';

type Stage = '' | 'opening' | 'connecting' | 'signing' | 'relaying' | 'sending' | 'demo' | 'faucet' | 'reclaim';
function initialLanguage(): Lang {
  try { const saved = localStorage.getItem('bitpos.pay.language'); if (saved === 'th' || saved === 'en') return saved; } catch { /* storage unavailable: use the browser language */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('th') ? 'th' : 'en';
}
const clock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export default function NearPayment({accessToken}: {accessToken: string}) {
  const [status, setStatus] = useState<NearStatus>(); const [order, setOrder] = useState<OrderView>();
  const [language, setLanguageState] = useState<Lang>('en'); const [error, setError] = useState(''); const [note, setNote] = useState('');
  const [paidBy, setPaidBy] = useState<AgentVerdict | null>(null);
  const [stage, setStage] = useState<Stage>(''); const [wallet, setWallet] = useState<NearWalletSession | null>(null); const [now, setNow] = useState(() => Date.now());
  const base = `/pay/${encodeURIComponent(accessToken)}`; const busy = stage !== ''; const acting = useRef(false);
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const setLanguage = (next: Lang) => { setLanguageState(next); try { localStorage.setItem('bitpos.pay.language', next); } catch { /* this visit only */ } };
  useEffect(() => { setLanguageState(initialLanguage()); }, []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);

  const refresh = useCallback(async () => {
    const next = await api<NearStatus>(`${base}/near`);
    if (!acting.current) setStatus(next);
    // The order view only supplies the item lines; the bill itself still shows if this read fails.
    if (next.nearShop) void api<OrderView>(base).then(setOrder).catch(() => { /* lines stay as they were */ });
    return next;
  }, [base]);
  const live = !!status && (LIVE_STATUSES.includes(status.bill.status) || status.bill.status === 'none');
  const otherShop = status?.nearShop === false;
  useEffect(() => {
    // Not a NEAR shop: the existing checkout takes over and this page stops asking.
    if (otherShop) return;
    let active = true;
    // A failed read never switches a NEAR shop to another payment method: show the error and keep trying.
    void refresh().catch(e => { if (active) setError(nearMessage(e, language)); });
    const timer = setInterval(() => { void refresh().then(() => { if (active) setError(current => current && !acting.current ? '' : current); }).catch(() => { /* next tick */ }); }, live ? 2500 : 8000);
    return () => { active = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, live, otherShop]);
  // Cross-chain preview (NEAR Intents, mainnet price check only). The entry is hidden when the server has it switched off.
  const [cross, setCross] = useState<CrossChainPreview | null>(); const awaiting = status?.bill.status === 'awaiting_payment';
  const loadCross = useCallback(() => api<CrossChainPreview>(`${base}/near/crosschain`).then(setCross).catch(() => setCross(null)), [base]);
  useEffect(() => { if (awaiting && cross === undefined) void loadCross(); }, [awaiting, cross, loadCross]);
  useEffect(() => { if (!status?.nearShop) return; let active = true; void import('../../lib/near-wallet').then(m => m.restoreNearWallet()).then(found => { if (active && found) setWallet(found); }).catch(() => { /* connect later */ }); return () => { active = false; }; }, [status?.nearShop]);

  /** Runs one action, shows the server's bill view it returns, and reports refusals in plain words. */
  async function act(next: Stage, run: () => Promise<BillView | void>) {
    if (acting.current) return; acting.current = true; setStage(next); setError(''); setNote('');
    try { const view = await run(); if (view) setStatus(current => current ? {...current, bill: view} : current); }
    catch (e) { setError(nearCode(e) === 'UNKNOWN' && e instanceof Error && e.message ? e.message : nearMessage(e, language)); }
    finally { acting.current = false; setStage(''); void refresh().catch(() => { /* next tick */ }); }
  }

  if (!status) return <main className="near-pay" lang={language}><div className="near-pay-shell">{error ? <div className="near-alert" role="alert">{error} <button type="button" className="near-link" onClick={() => { setError(''); void refresh().catch(e => setError(nearMessage(e, language))); }}>{text('ลองอีกครั้ง', 'Try again')}</button></div> : <p className="near-loading" role="status">{text('กำลังโหลดบิล…', 'Loading your bill…')}</p>}</div></main>;
  // Not a NEAR shop: the existing checkout, unchanged. A NEAR shop never falls back to another method.
  if (!status.nearShop) return <Payment accessToken={accessToken} />;

  const bill = status.bill; const symbol = status.token?.symbol ?? ''; const explorer = status.explorerTx;
  const amount = bill.amount?.display ?? status.amount?.display ?? null;
  const serving = order?.authority.serving.label ?? '';
  const payable = ['AWAITING_WALLET', 'AWAITING_PAYMENT'].includes(status.orderStatus) && new Date(status.quoteExpiresAt).getTime() > now;
  const request = bill.payMessage && bill.token && bill.contract && bill.amount ? {token: bill.token, contract: bill.contract, amountUnits: bill.amount.units, msg: bill.payMessage} : null;
  const deadline = bill.witnessDeadline ? new Date(bill.witnessDeadline).getTime() : null;
  const windowOver = deadline !== null && now > deadline;
  const link = (hash: string | null, label: string) => { const url = txUrl(explorer, hash); return url ? <a className="near-tx" href={url} target="_blank" rel="noreferrer">{label} · {shortHash(hash!)} ↗</a> : null; };

  const openBill = () => act('opening', () => api<BillView>(`${base}/near/bill`, {}));
  const connect = () => act('connecting', async () => { const m = await import('../../lib/near-wallet'); setWallet(await m.connectNearWallet()); });
  const payGasless = () => wallet && request && act('signing', async () => { const signedDelegate = await wallet.signGasless(request); setStage('relaying'); return api<BillView>(`${base}/near/relay`, {signedDelegate}); });
  const payDirect = () => wallet && request && act('sending', async () => { const sent = await wallet.payDirect(request); return api<BillView>(`${base}/near/submitted`, sent); });
  const demoPay = (account: string) => act('demo', () => api<BillView>(`${base}/near/demo-pay`, {wallet: account}));
  const faucet = () => wallet && act('faucet', async () => { const r = await api<{sent: boolean}>(`${base}/near/faucet`, {account: wallet.accountId}); setNote(r.sent ? text(`ส่ง 20 ${symbol} ทดสอบเข้ากระเป๋าแล้ว`, `20 test ${symbol} sent to your wallet.`) : text('กระเป๋านี้มีเหรียญทดสอบพออยู่แล้ว', 'This wallet already has enough test tokens.')); });
  const reclaim = () => act('reclaim', () => api<BillView>(`${base}/near/reclaim`, {}));
  const stageText: Record<Stage, string> = {
    '': '', opening: text('กำลังเขียนบิลลงบน NEAR…', 'Writing your bill to NEAR…'), connecting: text('กำลังเปิดกระเป๋า…', 'Opening your wallet…'),
    signing: text('อนุมัติการจ่ายในกระเป๋าของคุณ…', 'Approve the payment in your wallet…'), relaying: text('ร้านกำลังส่งธุรกรรมและจ่ายค่าธรรมเนียมเครือข่ายให้…', 'The café is sending it and paying the network fee…'),
    sending: text('อนุมัติและส่งจากกระเป๋าของคุณ…', 'Approve and send from your wallet…'), demo: text('กระเป๋าเดโมกำลังจ่าย…', 'The demo wallet is paying…'),
    faucet: text('กำลังส่งเหรียญทดสอบ…', 'Sending test tokens…'), reclaim: text('กำลังขอเงินคืนจากสัญญา…', 'Asking the contract to send your money back…'),
  };

  const payouts = bill.payouts.length > 0 && amount ? <section className="near-card near-split" aria-label={text('เงินของคุณไปไหน', 'Where your money goes')}>
    <h2>{text('เงินของคุณไปไหน', 'Where your money goes')}</h2>
    <p className="near-sub">{text('บิลนี้แบ่งจ่ายเองในธุรกรรมเดียว ทุกคนได้ครบหรือไม่มีใครได้เลย', 'This bill splits itself in one transaction: everyone is paid, or nobody is.')}</p>
    <div className="near-bar" aria-hidden="true">{bill.payouts.map((p, i) => <span key={i} style={{width: `${shareOf(p.amount, amount)}%`, background: ROLE_COLOR[p.role] ?? '#5E6B7A'}} />)}</div>
    <ul className="near-payouts">{bill.payouts.map((p, i) => <li key={i}>
      <span className="near-dot" style={{background: ROLE_COLOR[p.role] ?? '#5E6B7A'}} aria-hidden="true" />
      <span className="near-payout-who"><strong>{p.role === 'owner' || p.role === 'tax' ? roleLabel(p.role, language) : p.label}</strong><small>{p.role === 'owner' ? p.label + ' · ' : p.role === 'tips' ? roleLabel('tips', language) + ' · ' : p.role === 'supplier' ? roleLabel('supplier', language) + ' · ' : ''}{shortAccount(p.account)}</small></span>
      <span className="near-payout-amount">{p.amount}{p.paid && <b className="near-tick" aria-label={text('จ่ายแล้ว', 'paid')}>✓</b>}</span>
    </li>)}</ul>
  </section> : null;
  const lines = order ? <section className="near-card" aria-label={text('รายการในบิล', 'Items on this bill')}>
    <ul className="near-lines">{order.pricing.lines.map((line, i) => <li key={i}><span>{line.qty} × {language === 'th' ? line.name : line.nameEn}</span><span>{formatMoney({...line.unitPrice, amountMinor: (BigInt(line.unitPrice.amountMinor) * BigInt(line.qty)).toString()})}</span></li>)}</ul>
    <div className="near-total"><span>{text('ยอดรวม', 'Total')}</span><strong>{amount ?? formatMoney(order.pricing.total)} <small>{amount ? symbol : ''}</small></strong></div>
  </section> : amount ? <section className="near-card"><div className="near-total"><span>{text('ยอดรวม', 'Total')}</span><strong>{amount} <small>{symbol}</small></strong></div></section> : null;

  let body: React.ReactNode;
  if (!status.enabled && bill.status === 'none') body = <><h1>{text('ยังจ่ายบิลนี้ผ่าน NEAR ไม่ได้', 'This bill cannot be paid on NEAR right now')}</h1><p className="near-lead">{text('กรุณาแจ้งทีมร้าน ยังไม่มีเงินเคลื่อนไหว', 'Please tell the café team. No money has moved.')}</p>{lines}</>;
  else if (bill.status === 'none' || bill.status === 'void' || bill.status === 'failed' || bill.status === 'refunded') {
    const closed = bill.status !== 'none';
    body = <>
      {bill.status === 'refunded' ? <><div className="near-badge near-badge-red" aria-hidden="true">↩</div><h1>{text('เงินกลับมาที่กระเป๋าคุณแล้ว', 'Your money came back')}</h1><p className="near-lead">{bill.issue === 'REFUNDED_TO_PAYER' || !bill.issue ? text('จอของร้านไม่ได้ยืนยันทันเวลา สัญญาจึงคืนเงินทั้งหมดให้ผู้จ่าย', 'The café\'s screen did not confirm in time, so the contract sent the full amount back to the payer.') : text('สัญญาคืนเงินทั้งหมดให้ผู้จ่ายแล้ว', 'The contract sent the full amount back to the payer.')}</p>{link(bill.tx.refund, text('ธุรกรรมคืนเงิน', 'Refund transaction'))}</>
        : bill.status === 'void' ? <><h1>{text('บิลบน NEAR ใบนี้ถูกปิดแล้ว', 'This on-chain bill was closed')}</h1><p className="near-lead">{text('ถ้ามีการจ่ายเข้าบิลนี้ เงินจะเด้งกลับเองทั้งหมด', 'Any payment sent to it bounces back in full by itself.')}</p></>
        : bill.status === 'failed' ? <><h1>{text('เปิดบิลบน NEAR ไม่สำเร็จ', 'The bill could not be opened on NEAR')}</h1><p className="near-lead">{text('ยังไม่มีเงินเคลื่อนไหว ลองเปิดใหม่ได้', 'No money has moved. You can try again.')}</p></>
        : <><p className="near-caption">{text('บิลของคุณ', 'Your bill')}</p><h1>{amount ? <>{amount} <small>{symbol}</small></> : text('บิลของคุณ', 'Your bill')}</h1><p className="near-lead">{text('ขั้นแรก บิลนี้จะถูกเขียนลงสัญญาบน NEAR พร้อมรายชื่อผู้รับเงิน จากนั้นคุณจะเห็นว่าเงินไปที่ใครบ้างก่อนจ่าย', 'First the bill is written into a contract on NEAR with everyone it pays. You then see where your money goes before you pay.')}</p></>}
      {lines}
      {payable ? <button type="button" className="near-button" disabled={busy} onClick={openBill}>{closed ? text('เปิดบิลใหม่บน NEAR', 'Open a new bill on NEAR') : text('เปิดบิลบน NEAR', 'Open my bill on NEAR')}</button> : <p className="near-hint" role="status">{status.orderStatus === 'PAID' ? text('ออเดอร์นี้ชำระแล้ว', 'This order is already paid.') : text('บิลนี้หมดอายุหรือปิดไปแล้ว กรุณาขอบิลใหม่จากร้าน', 'This bill has expired or was closed. Ask the café for a new one.')}</p>}
    </>;
  } else if (bill.status === 'opening') body = <><div className="near-spinner" aria-hidden="true" /><h1>{text('กำลังเขียนบิลลงบน NEAR', 'Writing your bill to NEAR')}</h1><p className="near-lead" role="status">{text('ใช้เวลาไม่กี่วินาที หน้านี้จะไปต่อเอง', 'This takes a few seconds. The page continues by itself.')}</p>{lines}</>;
  else if (bill.status === 'awaiting_payment') body = <>
    <p className="near-caption">{text('ยอดที่ต้องจ่ายพอดี', 'Pay exactly')}</p><h1>{amount} <small>{symbol}</small></h1>
    <p className="near-lead">{text('จ่ายขาด เกิน หรือบิลหมดอายุ เงินจะเด้งกลับเอง', 'Too little, too much or too late, and the money bounces back by itself.')} {link(bill.tx.open, text('บิลบนเชน', 'Bill on chain'))}</p>
    {payouts}{lines}
    <section className="near-card near-methods" aria-label={text('วิธีจ่าย', 'How to pay')}>
      <h2>{text('เลือกวิธีจ่าย', 'Choose how to pay')}</h2>
      <p className="near-chip near-chip-mint">{text('ไม่ต้องมี NEAR · ร้านออกค่าธรรมเนียมเครือข่าย', 'No NEAR needed · the café pays the network fee')}</p>
      {!wallet ? <button type="button" className="near-button" disabled={busy} onClick={connect}>{text('เชื่อมกระเป๋า NEAR (testnet)', 'Connect NEAR wallet (testnet)')}</button> : <div className="near-wallet">
        <p className="near-wallet-id"><strong>{shortAccount(wallet.accountId)}</strong><small>{wallet.walletName} · testnet</small></p>
        {wallet.canDelegate && <button type="button" className="near-button" disabled={busy || !request} onClick={() => void payGasless()}>{text(`จ่าย ${amount} ${symbol} แบบไม่มีค่าธรรมเนียม`, `Pay ${amount} ${symbol} with no network fee`)}</button>}
        <button type="button" className={wallet.canDelegate ? 'near-button near-button-outline' : 'near-button'} disabled={busy || !request} onClick={() => void payDirect()}>{text(`จ่าย ${amount} ${symbol} จากกระเป๋า (คุณจ่ายค่าธรรมเนียม)`, `Pay ${amount} ${symbol} from the wallet (you pay the fee)`)}</button>
        {!wallet.canDelegate && <p className="near-hint">{text('กระเป๋านี้ยังเซ็นแบบไม่มีค่าธรรมเนียมไม่ได้ จึงส่งธุรกรรมเอง', 'This wallet cannot sign a fee-free payment yet, so it sends the transaction itself.')}</p>}
        <div className="near-row"><button type="button" className="near-link" disabled={busy} onClick={() => void faucet()}>{text(`รับ ${symbol} ทดสอบ`, `Get test ${symbol}`)}</button><button type="button" className="near-link" disabled={busy} onClick={() => { void wallet.disconnect().catch(() => { /* already gone */ }); setWallet(null); }}>{text('เปลี่ยนกระเป๋า', 'Switch wallet')}</button></div>
      </div>}
      {status.demoWallets.length > 0 && <div className="near-demo">
        <p className="near-demo-title">{text('ไม่มีกระเป๋า? ใช้กระเป๋าเดโม', 'No wallet? Use a demo wallet')}</p>
        {status.demoWallets.map(account => <button key={account} type="button" className="near-button near-button-outline" disabled={busy} onClick={() => void demoPay(account)}>{text('กระเป๋าเดโม (testnet)', 'Demo wallet (testnet)')} · {account.split('.')[0]}</button>)}
        <p className="near-hint">{text('กุญแจของกระเป๋าเดโมอยู่ที่เซิร์ฟเวอร์ของร้านเพื่อการทดสอบเท่านั้น มันเซ็นคำสั่งจ่ายแบบเดียวกับกระเป๋าจริง และสัญญาเป็นผู้ตัดสินเหมือนกัน', 'The demo wallet\'s key is held by the café\'s server for testing only. It signs the same payment a real wallet would, and the contract decides in the same way.')}</p>
      </div>}
      <NearAiPass base={base} demoWallets={status.demoWallets} language={language} symbol={symbol} canPay={!busy && !!request} now={now} onBill={(view, agent) => { if (agent) setPaidBy(agent); setStatus(current => current ? {...current, bill: view} : current); }} />
      {cross && <details className="near-cross-panel"><summary>{text('จ่ายจากเชนอื่น (ดูตัวอย่าง)', 'Pay from another chain (preview)')}</summary><NearCrossChain preview={cross} language={language} symbol={symbol} /><button type="button" className="near-link" onClick={() => void loadCross()}>{text('เช็กราคาอีกครั้ง', 'Check prices again')}</button></details>}
    </section>
  </>;
  else if (bill.status === 'escrow') body = <>
    <div className={`near-ring ${windowOver ? 'near-ring-over' : ''}`} role="timer" aria-live="off" style={deadline !== null && bill.witness ? {['--near-progress' as string]: `${Math.max(0, Math.min(1, (deadline - now) / 120000)) * 360}deg`} : undefined}><span>{deadline !== null ? clock(deadline - now) : '…'}</span></div>
    <h1>{text('จ่ายเข้าบิลแล้ว', 'Paid into the bill')}</h1>
    <p className="near-lead">{windowOver ? text('จอของร้านไม่ได้ยืนยันทันเวลา', 'The café\'s screen did not confirm in time') : text('กำลังรอจอของร้านยืนยัน', 'Waiting for the café\'s screen to confirm')}</p>
    <p className="near-chip near-chip-amber">{windowOver ? text('ขอเงินคืนได้แล้ว', 'You can take your money back now') : text('ถ้าจอไม่ยืนยัน เงินจะคืนเองเมื่อครบเวลา', 'Refunds itself when the timer ends if it doesn\'t')}</p>
    <section className="near-card"><ol className="near-steps">
      <li className="done"><span aria-hidden="true">✓</span><div><strong>{text('การจ่ายถึงที่สุดบน NEAR แล้ว', 'Payment is final on NEAR')}</strong>{link(bill.tx.pay, text('ธุรกรรม', 'Transaction')) ?? <small>{text('เงินอยู่ในสัญญา ยังไม่ถึงร้าน', 'The money is held by the contract, not the café yet')}</small>}</div></li>
      <li className={windowOver ? '' : 'doing'}><span aria-hidden="true">{windowOver ? '·' : ''}</span><div><strong>{text('จอที่โต๊ะกำลังตรวจเชน', 'The table screen is checking the chain')}</strong><small>{text('จอถาม NEAR เอง ไม่ได้เชื่อเซิร์ฟเวอร์ของร้าน', 'It asks NEAR itself, not the café\'s server')}</small></div></li>
      <li><span aria-hidden="true">·</span><div><strong>{text('แบ่งจ่ายให้ทุกคนในบิล', 'Split to everyone on the bill')}</strong><small>{text('เกิดขึ้นทันทีที่จอเซ็นยืนยัน', 'Happens the moment the screen signs')}</small></div></li>
    </ol></section>
    {windowOver && <button type="button" className="near-button near-button-red" disabled={busy} onClick={reclaim}>{text('ขอเงินของฉันคืน', 'Send my money back')}</button>}
    {payouts}
  </>;
  else if (bill.status === 'settling') body = <><div className="near-spinner" aria-hidden="true" /><h1>{text('กำลังแบ่งจ่าย', 'Splitting the payment')}</h1><p className="near-lead" role="status">{text('สัญญากำลังจ่ายทุกคนในบิลพร้อมกัน', 'The contract is paying everyone on the bill at once.')}</p>{payouts}</>;
  else if (bill.status === 'paid') body = <>
    <div className="near-badge near-badge-mint" aria-hidden="true">✓</div><h1>{text('จ่ายแล้ว', 'Paid')}</h1>
    <p className="near-lead">{text(`${amount} ${symbol} แบ่งจ่ายครบทุกคนแล้ว`, `${amount} ${symbol} split to everyone on the bill.`)}</p>
    {paidBy && <div className="near-agent near-agent-pay" role="status"><strong>{text('จ่ายโดย AI agent ด้วยสิทธิ์ของคุณ', 'Paid by the AI agent with your pass')}</strong><span>{paidBy.reason}</span>
      <small>{paidBy.proof.mode === 'near_ai' ? `NEAR AI Cloud · ${paidBy.proof.model ?? ''} · ${paidBy.proof.signature_verified && paidBy.proof.signer_in_attestation_report ? text('ตรวจลายเซ็นคำตอบผ่าน', 'response signature verified') : text('ยังตรวจลายเซ็นไม่ได้', 'signature not verified')}` : text('ตัวอย่าง: กฎตายตัว ไม่ได้เรียกโมเดล', 'Sample: fixed rule, no model called')}</small></div>}
    {payouts}
    <section className="near-card near-proof"><h2>{text('หลักฐานบน NEAR', 'Proof on NEAR')}</h2>
      {link(bill.tx.pay, text('การจ่าย', 'Payment'))}{link(bill.tx.witness, text('พยานจากจอของร้าน', 'Witness from the café\'s screen'))}{link(bill.tx.open, text('การเปิดบิล', 'Bill opened'))}
      {bill.payer && <p className="near-hint">{text('ผู้จ่าย', 'Payer')}: {shortAccount(bill.payer)}</p>}
    </section>{lines}
  </>;
  else if (bill.status === 'recovery') body = <><div className="near-badge near-badge-amber" aria-hidden="true">!</div><h1>{text('จ่ายแล้ว แต่ร้านต้องตรวจออเดอร์', 'Paid, but the café must check this order')}</h1><p className="near-lead">{text('เงินถูกแบ่งจ่ายบนเชนแล้ว แต่ออเดอร์ปิดหรือเปลี่ยนไปก่อนหน้า กรุณาแจ้งทีมร้านพร้อมหลักฐานด้านล่าง', 'The money was split on chain, but the order had already closed or changed. Show the café team the proof below.')}</p><section className="near-card near-proof">{link(bill.tx.pay, text('การจ่าย', 'Payment'))}{link(bill.tx.witness, text('พยาน', 'Witness'))}</section>{payouts}</>;
  else if (bill.status === 'payout_failed') body = <><div className="near-badge near-badge-amber" aria-hidden="true">!</div><h1>{text('จ่ายเข้าบิลแล้ว แต่การแบ่งจ่ายยังไม่สำเร็จ', 'Paid into the bill, but the split did not go through')}</h1><p className="near-lead">{text('เงินของคุณยังอยู่ในสัญญา ไม่ได้หายไปไหน ร้านลองแบ่งจ่ายใหม่ได้ หรือคุณขอคืนได้เมื่อครบเวลา', 'Your money is still held by the contract. The café can retry the split, or you can take it back when the timer ends.')}</p>{deadline !== null && !windowOver && <p className="near-chip near-chip-amber">{text('ขอคืนได้ใน', 'Refundable in')} {clock(deadline - now)}</p>}{windowOver && <button type="button" className="near-button near-button-red" disabled={busy} onClick={reclaim}>{text('ขอเงินของฉันคืน', 'Send my money back')}</button>}{deadline === null && <p className="near-hint">{text('กรุณาแจ้งทีมร้าน', 'Please tell the café team.')}</p>}{link(bill.tx.pay, text('การจ่าย', 'Payment'))}</>;
  else body = <><div className="near-badge near-badge-red" aria-hidden="true">!</div><h1>{text('บิลนี้ถูกหยุดไว้ให้ร้านตรวจ', 'This bill is on hold for the café to review')}</h1><p className="near-lead">{text('สิ่งที่อยู่บนเชนไม่ตรงกับบิลที่ร้านออก ระบบจึงไม่ขึ้นว่าจ่ายแล้ว กรุณาแจ้งทีมร้าน', 'What is on chain does not match the bill the café issued, so it is not marked paid. Please tell the café team.')}</p>{link(bill.tx.pay, text('การจ่าย', 'Payment'))}</>;

  return <main className="near-pay" lang={language}><div className="near-pay-shell">
    <header className="near-pay-header">
      <span className="near-logo" aria-hidden="true">B</span>
      <div className="near-pay-shop"><strong>{status.shopName}{serving ? ` · ${serving}` : ''}</strong><small>BitPOS Living Bill</small></div>
      <span className="near-net">NEAR testnet</span>
    </header>
    <div className="near-lang" role="group" aria-label={text('ภาษา', 'Language')}><button type="button" lang="th" aria-pressed={language === 'th'} onClick={() => setLanguage('th')}>ไทย</button><button type="button" lang="en" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English</button></div>
    <div className="near-pay-body">{body}</div>
    {busy && <p className="near-working" role="status">{stageText[stage]}</p>}
    {note && <p className="near-note" role="status">{note}</p>}
    {error && <div className="near-alert" role="alert">{error}</div>}
    <footer className="near-pay-footer">{text('เงินทดสอบบน NEAR testnet · ร้านและเมนูเป็นข้อมูลตัวอย่าง', 'Test money on NEAR testnet · the shop and menu are sample data')}</footer>
  </div></main>;
}
