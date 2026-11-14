// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// AI spending pass on the pay page. The customer gives the café's AI agent a pass for a fixed time with a cap; the
// agent pays exact bills from it through the bills contract. The pass lives in the contract, not on this page: the
// page only remembers which pass it made (per browser, a convenience) and always reads its state from the server.
import React, {useCallback, useEffect, useState} from 'react';
import {api} from '../../lib/api';
import {nearCode, nearMessage, shortAccount, type BillView, type Lang} from '../../lib/near-shared';

export interface AgentVerdict {decision: 'pay' | 'decline'; reason: string; proof: {mode: 'near_ai' | 'sample'; model: string | null; signature_verified: boolean; signer_in_attestation_report: boolean; note: string}}
export interface PassView {owner: string; passId: string; agent: string; cap: string; balance: string; maxBill: string; merchant: string | null; expiresAtMs: number; createdAtMs: number; billsPaid: number; state: 'ACTIVE' | 'EXPIRED' | 'CLOSED'}
const TTLS: {id: '30m' | '1h' | '1d' | '1w' | '1mo'; th: string; en: string}[] = [{id: '30m', th: '30 นาที', en: '30 min'}, {id: '1h', th: '1 ชม.', en: '1 hour'}, {id: '1d', th: '1 วัน', en: '1 day'}, {id: '1w', th: '1 สัปดาห์', en: '1 week'}, {id: '1mo', th: '1 เดือน', en: '1 month'}];
const KEY = 'bitpos.near.aipass';
const left = (ms: number, lang: Lang) => { if (ms <= 0) return lang === 'th' ? 'หมดเวลา' : 'ended'; const m = Math.floor(ms / 60000); const d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mm = m % 60; return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${mm}m ${Math.floor(ms / 1000) % 60}s`; };

export default function NearAiPass({base, demoWallets, language, symbol, canPay, now, onBill}: {base: string; demoWallets: string[]; language: Lang; symbol: string; canPay: boolean; now: number; onBill: (bill: BillView, agent?: AgentVerdict) => void}) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [pass, setPass] = useState<PassView | null>(null); const [ttl, setTtl] = useState<typeof TTLS[number]['id']>('1h');
  const [cap, setCap] = useState('20'); const [maxBill, setMaxBill] = useState('10'); const [owner, setOwner] = useState(demoWallets[0] ?? '');
  const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  const [rule, setRuleState] = useState(''); const [verdict, setVerdict] = useState<AgentVerdict | null>(null);
  const setRule = (v: string) => { setRuleState(v); try { localStorage.setItem(KEY + '.rule', v); } catch { /* this visit only */ } };
  useEffect(() => { try { setRuleState(localStorage.getItem(KEY + '.rule') ?? ''); } catch { /* none saved */ } }, []);
  const remember = (p: PassView | null) => { setPass(p); try { if (p) localStorage.setItem(KEY, JSON.stringify({owner: p.owner, passId: p.passId})); else localStorage.removeItem(KEY); } catch { /* this visit only */ } };
  const reload = useCallback(async (ref?: {owner: string; passId: string}) => { if (!ref) return; try { setPass(await api<PassView>(`${base}/near/pass-status`, ref)); } catch { /* forgotten pass */ } }, [base]);
  useEffect(() => { try { const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (saved?.owner && saved?.passId) void reload(saved); } catch { /* none saved */ } }, [reload]);
  async function run(label: string, fn: () => Promise<void>) { if (busy) return; setBusy(label); setError(''); try { await fn(); } catch (e) { setError(nearCode(e) === 'UNKNOWN' && e instanceof Error && e.message ? e.message : nearMessage(e, language)); } finally { setBusy(''); } }
  const create = () => run('create', async () => remember(await api<PassView>(`${base}/near/pass`, {wallet: owner, ttl, cap, maxBill})));
  const pay = () => pass && run('pay', async () => { setVerdict(null); const r = await api<(BillView & {pass: PassView; agent: AgentVerdict}) | {declined: true; pass: PassView; agent: AgentVerdict}>(`${base}/near/pass-pay`, {owner: pass.owner, passId: pass.passId, ...(rule.trim() ? {rule: rule.trim()} : {})}); setPass(r.pass); setVerdict(r.agent); if (!('declined' in r)) onBill(r, r.agent); });
  const close = () => pass && run('close', async () => setPass(await api<PassView>(`${base}/near/pass-close`, {owner: pass.owner, passId: pass.passId})));
  const active = pass?.state === 'ACTIVE' && pass.expiresAtMs > now;

  if (demoWallets.length === 0) return null;
  return <details className="near-cross-panel near-aipass" open={!!pass}>
    <summary>{text('ให้ AI จ่ายแทน (สิทธิ์จำกัดเวลา)', 'Let an AI agent pay (time-limited pass)')}</summary>
    {!pass || pass.state === 'CLOSED' ? <div className="near-aipass-form">
      <p className="near-hint">{text('ฝากเงินไว้ในสัญญา ให้ AI ของร้านจ่ายบิลที่ตรงยอดแทนคุณตามเวลาที่เลือก เมื่อหมดเวลาสิทธิ์จบเอง เงินที่เหลือคืนคุณ', 'Put money in the contract and let the café\'s AI agent pay exact bills for you for the time you choose. When time runs out the pass ends by itself and the rest comes back to you.')}</p>
      <div className="near-row near-aipass-ttls" role="group" aria-label={text('ระยะเวลา', 'Length')}>{TTLS.map(t => <button key={t.id} type="button" className={ttl === t.id ? 'near-button' : 'near-button near-button-outline'} aria-pressed={ttl === t.id} onClick={() => setTtl(t.id)}>{text(t.th, t.en)}</button>)}</div>
      <div className="near-row">
        <label className="near-field">{text('วงเงินรวม', 'Spending cap')} ({symbol})<input inputMode="decimal" value={cap} onChange={e => setCap(e.target.value.trim())} /></label>
        <label className="near-field">{text('สูงสุดต่อบิล', 'Max per bill')} ({symbol})<input inputMode="decimal" value={maxBill} onChange={e => setMaxBill(e.target.value.trim())} /></label>
      </div>
      <label className="near-field">{text('กฎของคุณสำหรับ AI (ไม่บังคับ)', 'Your rule for the agent (optional)')}<input value={rule} maxLength={200} placeholder={text('เช่น กาแฟกับขนมเท่านั้น ไม่เอาแอลกอฮอล์', 'e.g. Coffee and pastries only, no alcohol')} onChange={e => setRule(e.target.value)} /></label>
      {demoWallets.length > 1 && <label className="near-field">{text('กระเป๋าเดโมที่ฝากเงิน', 'Demo wallet that funds it')}<select value={owner} onChange={e => setOwner(e.target.value)}>{demoWallets.map(w => <option key={w} value={w}>{w.split('.')[0]}</option>)}</select></label>}
      <button type="button" className="near-button" disabled={!!busy} onClick={() => void create()}>{busy === 'create' ? text('กำลังสร้างสิทธิ์บน NEAR…', 'Creating the pass on NEAR…') : text('ให้สิทธิ์ AI (กระเป๋าเดโม testnet)', 'Give the AI a pass (demo wallet, testnet)')}</button>
      <ul className="near-aipass-rules">
        <li>{text('AI จ่ายได้เฉพาะบิลที่ตรงยอดของร้านนี้ ภายในวงเงิน', 'The AI can pay only exact bills of this café, within the limits')}</li>
        <li>{text('กุญแจของ AI เรียกได้แค่ pass_pay ย้ายเงินไปที่อื่นไม่ได้', 'The AI\'s key can call pass_pay only; it cannot move money anywhere else')}</li>
        <li>{text('จอที่โต๊ะไม่ยืนยันว่าเสิร์ฟทันเวลา หรือร้านยกเลิก เงินคืนคุณ ไม่ใช่ AI', 'Not served in time, or cancelled by the café: the money comes back to you, never to the AI')}</li>
        <li>{text('ปิดสิทธิ์ได้ทุกเมื่อ เงินที่เหลือคืนทันที', 'End the pass any time; the rest comes back at once')}</li>
      </ul>
    </div> : <div className="near-aipass-live">
      <div className="near-total"><span>{text('เหลือในสิทธิ์', 'Left on the pass')}</span><strong>{pass.balance} <small>{symbol}</small></strong></div>
      <p className="near-hint">{text('วงเงิน', 'Cap')} {pass.cap} · {text('ต่อบิล', 'per bill')} {pass.maxBill} · {text('จ่ายแล้ว', 'bills paid')} {pass.billsPaid}</p>
      <p className={active ? 'near-chip near-chip-mint' : 'near-chip near-chip-amber'}>{active ? `${text('หมดเวลาใน', 'Ends in')} ${left(pass.expiresAtMs - now, language)}` : text('หมดเวลาแล้ว ปิดเพื่อรับเงินที่เหลือคืน', 'Ended: close it to get the rest back')}</p>
      <p className="near-hint">{text('AI', 'AI agent')}: {shortAccount(pass.agent)} · {text('เจ้าของ', 'owner')}: {shortAccount(pass.owner)}</p>
      <label className="near-field">{text('กฎของคุณสำหรับ AI', 'Your rule for the agent')}<input value={rule} maxLength={200} placeholder={text('เช่น กาแฟกับขนมเท่านั้น', 'e.g. Coffee and pastries only')} onChange={e => setRule(e.target.value)} /></label>
      {verdict && <div className={verdict.decision === 'pay' ? 'near-agent near-agent-pay' : 'near-agent near-agent-decline'} role="status">
        <strong>{verdict.decision === 'pay' ? text('AI ตัดสินใจ: จ่าย', 'Agent decided: pay') : text('AI ตัดสินใจ: ไม่จ่าย', 'Agent decided: decline')}</strong>
        <span>{verdict.reason}</span>
        <small>{verdict.proof.mode === 'near_ai' ? `NEAR AI Cloud · ${verdict.proof.model ?? ''} · ${verdict.proof.signature_verified && verdict.proof.signer_in_attestation_report ? text('ตรวจลายเซ็นคำตอบผ่าน', 'response signature verified') : text('ยังตรวจลายเซ็นไม่ได้', 'signature not verified')}` : text('ตัวอย่าง: กฎตายตัว ไม่ได้เรียกโมเดล', 'Sample: fixed rule, no model called')}</small>
      </div>}
      {canPay && active && <button type="button" className="near-button" disabled={!!busy} onClick={() => void pay()}>{busy === 'pay' ? text('AI กำลังจ่าย…', 'The AI agent is paying…') : text('ให้ AI จ่ายบิลนี้', 'Let the AI agent pay this bill')}</button>}
      <button type="button" className="near-button near-button-outline" disabled={!!busy} onClick={() => void close()}>{busy === 'close' ? text('กำลังปิดสิทธิ์…', 'Ending the pass…') : text('ปิดสิทธิ์และรับเงินที่เหลือคืน', 'End the pass and get the rest back')}</button>
      <button type="button" className="near-link" disabled={!!busy} onClick={() => remember(null)}>{text('สร้างสิทธิ์ใหม่', 'Make a new pass')}</button>
    </div>}
    {error && <div className="near-alert" role="alert">{error}</div>}
  </details>;
}
