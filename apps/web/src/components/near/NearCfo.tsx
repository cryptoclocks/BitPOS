// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Café CFO (frames NM-09 / NM-10): a model suggests one split recipe out of a short list the SERVER built from the
// shop's own numbers. It can only propose. Approving — by an owner or manager — is the only thing that changes the
// recipe. The page says plainly what kind of answer it is: verified private inference, an unverified suggestion,
// or a sample where no model was called.
import React, {useCallback, useEffect, useState} from 'react';
import {api} from '../../lib/api';
import type {Session} from '../../lib/table';
import {nearMessage, type Lang} from '../../lib/near-shared';

interface Proof { mode: string; model: string | null; signature_kind: string | null; request_sha256: string | null; response_sha256: string | null; signer: string | null; signature_verified: boolean; signer_in_attestation_report: boolean; nonce_echoed: boolean; quote_verified: false; note: string }
interface Run { id: string; status: 'PROPOSED' | 'APPROVED' | 'DISMISSED'; mode: string; model: string | null; option: string; taxBps: number; tipsBps: number; reason: string; proof: Proof; createdAt: string; decidedAt: string | null }
interface Facts { paidBills7d: number | string; sales7d: number | string; tips7d: number | string; staffOnShift: number | string; openInvoices: number | string; invoicesRemaining: number | string; invoiceRateBps: number; taxBps: number; tipsBps: number }
interface Proposal { id: string; option: string; taxBps: number; tipsBps: number; reason: string; proof: Proof; options: {id: string; taxBps: number; tipsBps: number}[]; facts: Facts }
interface Cfo { mode: 'near_ai' | 'sample'; model: string | null; runs: Run[] }

const OPTIONS: Record<string, [string, string]> = {
  keep: ['คงสูตรเดิม', 'Keep the current split'], tips_up: ['เพิ่มให้ทีมอีกเล็กน้อย', 'A little more for the team'], tips_down: ['ลดส่วนของทีมลงเล็กน้อย', 'A little less for the team'],
  tax_up: ['กันภาษีมากขึ้น', 'A larger tax reserve'], tax_down: ['กันภาษีน้อยลง', 'A smaller tax reserve'], balanced: ['สูตรสมดุล', 'A balanced split'],
};
const percent = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;
/** The server already removes numbers from the model's words; this page removes any that remain, so no figure on screen ever comes from the model. */
const wordsOnly = (reason: string) => reason.replace(/[0-9๐-๙]+([.,][0-9๐-๙]+)*\s?%?/g, '').replace(/\s{2,}/g, ' ').trim();

export default function NearCfo({session, language, canChange, current, symbol, onChanged}: {session: Session; language: Lang; canChange: boolean; current: {taxBps: number; tipsBps: number}; symbol: string; onChanged: () => void}) {
  const t = (th: string, en: string) => language === 'th' ? th : en;
  const [cfo, setCfo] = useState<Cfo>(); const [proposal, setProposal] = useState<Proposal>(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const load = useCallback(() => api<Cfo>('/near/cfo', undefined, session.token).then(setCfo), [session.token]);
  useEffect(() => { let active = true; void load().catch(e => { if (active) setError(nearMessage(e, language)); }); return () => { active = false; }; }, [load, language]);
  async function act(run: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); setNotice(''); try { await run(); } catch (e) { setError(nearMessage(e, language)); } finally { setBusy(false); void load().catch(() => { /* keep what is shown */ }); } }
  const ask = () => act(async () => { setProposal(await api<Proposal>('/near/cfo/runs', {}, session.token)); });
  const decide = (id: string, what: 'approve' | 'dismiss') => act(async () => {
    const r = await api<{ok: boolean; status: string; recipe: {taxBps: number; tipsBps: number} | null}>(`/near/cfo/runs/${id}/${what}`, {}, session.token);
    setNotice(what === 'approve' && r.recipe ? t(`อนุมัติแล้ว สูตรใหม่: ภาษี ${percent(r.recipe.taxBps)} ทิป ${percent(r.recipe.tipsBps)} ใช้กับบิลถัดไป`, `Approved. New recipe: tax ${percent(r.recipe.taxBps)}, tips ${percent(r.recipe.tipsBps)}, from the next bill.`) : what === 'approve' ? t('อนุมัติแล้ว', 'Approved.') : t('ปัดข้อเสนอนี้แล้ว สูตรไม่เปลี่ยน', 'Dismissed. The recipe did not change.'));
    setProposal(undefined); onChanged();
  });
  const optionLabel = (id: string) => OPTIONS[id] ? t(OPTIONS[id][0], OPTIONS[id][1]) : id;
  const proofBlock = (proof: Proof) => {
    const verified = proof.signature_verified === true && proof.signer_in_attestation_report === true;
    return <div className="near-proof-block">
      {verified ? <p className="near-chip near-chip-violet">{t('ประมวลผลแบบส่วนตัว · ตรวจลายเซ็นคำตอบแล้ว', 'Private inference · response signature verified')}</p>
        : proof.mode === 'sample' ? <p className="near-chip near-chip-grey">{t('ตัวอย่าง · ไม่ได้เรียกโมเดล', 'Sample · no model called')}</p>
        : <p className="near-chip near-chip-amber">{t('ข้อเสนอที่ยังไม่ได้ตรวจยืนยัน', 'Unverified suggestion')}</p>}
      <p className="near-hint">{proof.note}</p>
      <details className="near-proof-details"><summary>{t('รายละเอียดหลักฐาน', 'Proof details')}</summary><dl>
        <dt>{t('โมเดล', 'Model')}</dt><dd>{proof.model ?? '—'}</dd>
        <dt>{t('แฮชคำขอ (sha256)', 'Request hash (sha256)')}</dt><dd>{proof.request_sha256 ?? '—'}</dd>
        <dt>{t('แฮชคำตอบ (sha256)', 'Response hash (sha256)')}</dt><dd>{proof.response_sha256 ?? '—'}</dd>
        <dt>{t('ผู้เซ็น', 'Signer')}</dt><dd>{proof.signer ?? '—'}{proof.signature_kind ? ` · ${proof.signature_kind}` : ''}</dd>
        <dt>{t('ตรวจลายเซ็น', 'Signature checked')}</dt><dd>{proof.signature_verified ? t('ผ่าน', 'yes') : t('ไม่', 'no')} · {t('ผู้เซ็นอยู่ในรายงาน attestation', 'signer in the attestation report')}: {proof.signer_in_attestation_report ? t('ใช่', 'yes') : t('ไม่', 'no')} · {t('nonce ตรง', 'nonce echoed')}: {proof.nonce_echoed ? t('ใช่', 'yes') : t('ไม่', 'no')} · {t('ตรวจ quote ของฮาร์ดแวร์', 'hardware quote verified')}: {t('ไม่', 'no')}</dd>
      </dl></details>
    </div>;
  };
  const pending = proposal ? null : cfo?.runs.find(r => r.status === 'PROPOSED');
  const shown = proposal ?? pending;
  const facts = proposal?.facts;
  const factRows: [string, string][] = facts ? [
    [t('บิลที่จ่ายแล้ว 7 วัน', 'Paid bills, last 7 days'), String(facts.paidBills7d)], [t('ยอดขาย 7 วัน', 'Sales, last 7 days'), `${facts.sales7d} ${symbol}`], [t('ทิปที่จ่ายทีม 7 วัน', 'Tips paid to the team, last 7 days'), `${facts.tips7d} ${symbol}`],
    [t('พนักงานที่อยู่กะ', 'Staff on shift'), String(facts.staffOnShift)], [t('ใบแจ้งหนี้ที่เปิดอยู่', 'Open invoices'), String(facts.openInvoices)], [t('ยอดใบแจ้งหนี้ที่ยังต้องเก็บ', 'Still to collect for invoices'), `${facts.invoicesRemaining} ${symbol}`],
    [t('ใบแจ้งหนี้เก็บจากทุกบิล', 'Invoices collect from every bill'), percent(facts.invoiceRateBps)], [t('ภาษีตอนนี้', 'Tax now'), percent(facts.taxBps)], [t('ทิปตอนนี้', 'Tips now'), percent(facts.tipsBps)],
  ] : [];

  return <div className="near-grid near-cfo">
    <section className="near-card near-wide near-cfo-card">
      <div className="near-card-head"><div><h2>✦ Café CFO</h2><p className="near-sub">{t('โมเดลเลือกหนึ่งข้อจากรายการที่เซิร์ฟเวอร์สร้างจากตัวเลขของร้าน มันเสนอได้อย่างเดียว คุณเป็นคนอนุมัติ', 'The model picks one option from a list the server built from the shop\'s own numbers. It can only propose. You approve.')}</p></div>
        {canChange && <button type="button" className="near-button near-button-violet" disabled={busy || !cfo} onClick={() => void ask()}>{busy ? t('กำลังถาม…', 'Asking…') : t('ถาม CFO', 'Ask the CFO')}</button>}</div>
      {cfo && <p className={`near-chip ${cfo.mode === 'sample' ? 'near-chip-grey' : 'near-chip-violet'}`}>{cfo.mode === 'sample' ? t('โหมดตัวอย่าง · ไม่ได้เรียกโมเดล', 'Sample mode · no model called') : `NEAR AI Cloud${cfo.model ? ` · ${cfo.model}` : ''}`}</p>}
      {!canChange && <p className="near-hint" role="note">{t('ดูได้อย่างเดียว · การถามและอนุมัติทำได้เฉพาะเจ้าของร้านหรือผู้จัดการ', 'Read only · asking and approving are for the owner or a manager.')}</p>}
      {error && <div className="near-alert" role="alert">{error}</div>}
      {notice && <p className="near-note" role="status">{notice}</p>}
      {!cfo && !error && <p className="near-loading" role="status">{t('กำลังโหลด…', 'Loading…')}</p>}
      {shown ? <article className="near-proposal">
        <h3>{t('ข้อเสนอ', 'Proposal')}: {optionLabel(shown.option)}</h3>
        <p className="near-reason">{wordsOnly(shown.reason)}</p>
        <div className="near-change"><div><small>{t('สูตรตอนนี้', 'Current recipe')}</small><strong>{t('ภาษี', 'Tax')} {percent(current.taxBps)} · {t('ทิป', 'Tips')} {percent(current.tipsBps)}</strong></div><span aria-hidden="true">→</span><div><small>{t('สูตรที่เสนอ', 'Proposed recipe')}</small><strong>{t('ภาษี', 'Tax')} {percent(shown.taxBps)} · {t('ทิป', 'Tips')} {percent(shown.tipsBps)}</strong></div></div>
        {proofBlock(shown.proof)}
        {canChange && <div className="near-row"><button type="button" className="near-button" disabled={busy} onClick={() => void decide(shown.id, 'approve')}>{t('อนุมัติและใช้สูตรนี้', 'Approve and use this recipe')}</button><button type="button" className="near-button near-button-outline" disabled={busy} onClick={() => void decide(shown.id, 'dismiss')}>{t('ปัดทิ้ง', 'Dismiss')}</button></div>}
        <p className="near-hint">{t('ตัวเลขทุกตัวบนหน้านี้มาจากเซิร์ฟเวอร์ ไม่ใช่จากโมเดล', 'Every figure on this page comes from the server, not from the model.')}</p>
      </article> : cfo && <p className="near-empty">{canChange ? t('ยังไม่มีข้อเสนอที่รออยู่ กด "ถาม CFO" เพื่อขอข้อเสนอใหม่', 'No proposal is waiting. Press "Ask the CFO" for a new one.') : t('ยังไม่มีข้อเสนอที่รออยู่', 'No proposal is waiting.')}</p>}
    </section>
    {proposal && <section className="near-card">
      <h2>{t('ตัวเลขที่โมเดลเห็น', 'The facts the model saw')}</h2>
      <dl className="near-facts">{factRows.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl>
    </section>}
    {proposal && <section className="near-card">
      <h2>{t('ตัวเลือกที่เซิร์ฟเวอร์ให้เลือก', 'The options the server offered')}</h2>
      <ul className="near-options">{proposal.options.map(o => <li key={o.id} data-chosen={o.id === proposal.option ? 'true' : undefined}><strong>{optionLabel(o.id)}</strong><span>{t('ภาษี', 'Tax')} {percent(o.taxBps)} · {t('ทิป', 'Tips')} {percent(o.tipsBps)}</span>{o.id === proposal.option && <b>{t('โมเดลเลือกข้อนี้', 'the model chose this')}</b>}</li>)}</ul>
    </section>}
    <section className="near-card near-wide">
      <h2>{t('ข้อเสนอที่ผ่านมา', 'Earlier proposals')}</h2>
      {!cfo || cfo.runs.length === 0 ? <p className="near-empty">{t('ยังไม่มี', 'None yet.')}</p> : <table className="near-table"><thead><tr><th>{t('เวลา', 'Time')}</th><th>{t('ข้อเสนอ', 'Proposal')}</th><th>{t('สูตร', 'Recipe')}</th><th>{t('ผล', 'Outcome')}</th><th>{t('ชนิดคำตอบ', 'Kind of answer')}</th></tr></thead><tbody>{cfo.runs.map(r => <tr key={r.id}>
        <td>{new Date(r.createdAt).toLocaleString(language === 'th' ? 'th-TH' : 'en-GB', {hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short'})}</td>
        <td><strong>{optionLabel(r.option)}</strong><small>{wordsOnly(r.reason)}</small></td>
        <td>{t('ภาษี', 'Tax')} {percent(r.taxBps)} · {t('ทิป', 'Tips')} {percent(r.tipsBps)}</td>
        <td><span className={`near-status near-status-${r.status === 'APPROVED' ? 'mint' : r.status === 'PROPOSED' ? 'amber' : 'grey'}`}>{r.status === 'APPROVED' ? t('อนุมัติแล้ว', 'Approved') : r.status === 'PROPOSED' ? t('รออนุมัติ', 'Waiting') : t('ปัดทิ้ง', 'Dismissed')}</span></td>
        <td>{r.proof.signature_verified && r.proof.signer_in_attestation_report ? t('ส่วนตัว · ตรวจลายเซ็นแล้ว', 'Private · signature verified') : r.proof.mode === 'sample' ? t('ตัวอย่าง · ไม่ได้เรียกโมเดล', 'Sample · no model called') : t('ยังไม่ได้ตรวจยืนยัน', 'Unverified suggestion')}</td>
      </tr>)}</tbody></table>}
    </section>
  </div>;
}
