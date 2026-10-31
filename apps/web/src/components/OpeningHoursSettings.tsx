import React, { useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { emptyWeek, maxWindowsPerDay, normaliseWeek, validTimeZone, type HoursWeek } from '../../../../packages/domain/src/opening-hours';
import type { Session } from '../lib/table';

interface HoursView { configured: boolean; timeZone: string; revision: number; week: HoursWeek }
const days: (keyof HoursWeek)[] = ['1', '2', '3', '4', '5', '6', '0'];
const zones = ['Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo', 'UTC'];

// Merchant weekly opening hours (P36). The server owns the record: saving sends the
// revision that was read, a changed revision is refused, and nothing is assumed saved
// until the server answers.
export default function OpeningHoursSettings({ session, language }: { session: Session; language: 'th' | 'en' }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const dayName = (day: keyof HoursWeek) => ({ '1': text('จันทร์', 'Monday'), '2': text('อังคาร', 'Tuesday'), '3': text('พุธ', 'Wednesday'), '4': text('พฤหัสบดี', 'Thursday'), '5': text('ศุกร์', 'Friday'), '6': text('เสาร์', 'Saturday'), '0': text('อาทิตย์', 'Sunday') })[day];
  const [view, setView] = useState<HoursView>(); const [draft, setDraft] = useState<HoursWeek>(emptyWeek()); const [zone, setZone] = useState('Asia/Bangkok');
  const [state, setState] = useState<'loading' | 'ready' | 'saving'>('loading'); const [message, setMessage] = useState(''); const [conflict, setConflict] = useState(false);
  const load = async () => {
    setState('loading'); setMessage(''); setConflict(false);
    try { const next = await api<HoursView>('/settings/hours', undefined, session.token); setView(next); setDraft(next.week); setZone(next.timeZone); setState('ready'); }
    catch (error) { setMessage(errorMessage(error)); setState('ready'); }
  };
  useEffect(() => { void load(); }, [session.token]);
  const dirty = !!view && (JSON.stringify(draft) !== JSON.stringify(view.week) || zone !== view.timeZone);
  let invalid = '';
  try { normaliseWeek(draft); if (!validTimeZone(zone)) invalid = text('เขตเวลาไม่ถูกต้อง', 'Time zone is not valid'); } catch (error) { invalid = String((error as Error).message).replace('INVALID_HOURS: ', ''); }
  const edit = (day: keyof HoursWeek, index: number, key: 'opens' | 'closes', value: string) => setDraft({ ...draft, [day]: draft[day].map((w, i) => i === index ? { ...w, [key]: value } : w) });
  async function save() {
    if (!view || invalid) return;
    setState('saving'); setMessage('');
    try {
      const next = await api<HoursView>('/settings/hours', { expectedRevision: view.revision, timeZone: zone, week: normaliseWeek(draft) }, session.token, 'PUT');
      setView(next); setDraft(next.week); setZone(next.timeZone); setMessage(text('บันทึกแล้ว', 'Saved'));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'OPENING_HOURS_CHANGED') { setConflict(true); setMessage(text('เวลาทำการถูกเปลี่ยนจากที่อื่น โหลดล่าสุดก่อนบันทึก (ร่างของคุณยังอยู่)', 'The hours changed elsewhere. Reload the latest before saving (your draft is kept).')); }
      else setMessage(errorMessage(error));
    }
    setState('ready');
  }
  return <section className="panel" aria-label={text('สาขาและเวลาทำการ', 'Branch & opening hours')}>
    <h2>{text('สาขาและเวลาทำการ', 'Branch & opening hours')}</h2>
    <p>{text('เวลาเปิด-ปิดรายสัปดาห์ตามเขตเวลาของร้าน ช่วงเวลาข้ามเที่ยงคืนให้แยกเป็นสองวัน', 'Weekly opening windows in the shop’s time zone. Overnight service is entered as two windows on adjacent days.')}</p>
    <p className="notice" role="note" data-blocked="multi-branch">{text('ตอนนี้ตั้งเวลาทำการได้หนึ่งชุดต่อร้าน เวลาทำการแยกรายสาขายังไม่พร้อมใช้งาน (BLOCKED)', 'One schedule per shop for now. Per-branch hours are BLOCKED (no multi-branch model yet).')}</p>
    {state === 'loading' && <p className="notice" role="status">{text('กำลังโหลด…', 'Loading…')}</p>}
    {view && !view.configured && <p className="notice" role="status">{text('ยังไม่เคยตั้งเวลาทำการ', 'Opening hours have not been set yet.')}</p>}
    {view && <>
      <label>{text('เขตเวลา', 'Time zone')}<input list="opening-hours-zones" value={zone} onChange={event => setZone(event.target.value)} /><datalist id="opening-hours-zones">{zones.map(z => <option key={z} value={z} />)}</datalist></label>
      {days.map(day => <fieldset key={day} className="opening-day"><legend>{dayName(day)}</legend>
        {draft[day].length === 0 && <p className="notice">{text('ปิดทั้งวัน', 'Closed all day')}</p>}
        {draft[day].map((w, index) => <div className="toolbar" key={index}>
          <label>{text('เปิด', 'Opens')}<input type="time" value={w.opens} onChange={event => edit(day, index, 'opens', event.target.value)} /></label>
          <label>{text('ปิด', 'Closes')}<input type="time" value={w.closes} onChange={event => edit(day, index, 'closes', event.target.value)} /></label>
          <button type="button" className="secondary" aria-label={`${text('ลบช่วงเวลา', 'Remove window')} ${dayName(day)} ${index + 1}`} onClick={() => setDraft({ ...draft, [day]: draft[day].filter((_, i) => i !== index) })}>{text('ลบ', 'Remove')}</button>
        </div>)}
        <button type="button" className="secondary" disabled={draft[day].length >= maxWindowsPerDay} onClick={() => setDraft({ ...draft, [day]: [...draft[day], { opens: '08:00', closes: '18:00' }] })}>{text('เพิ่มช่วงเวลา', 'Add window')}</button>
      </fieldset>)}
      {invalid && <p className="error" role="alert">{invalid}</p>}
      {message && <p className={conflict ? 'error' : 'notice'} role="status">{message}</p>}
      <div className="toolbar">
        <button type="button" disabled={!dirty || !!invalid || state !== 'ready'} onClick={() => void save()}>{state === 'saving' ? text('กำลังบันทึก…', 'Saving…') : text('บันทึกเวลาทำการ', 'Save opening hours')}</button>
        <button type="button" className="secondary" disabled={state !== 'ready'} onClick={() => void load()}>{text('โหลดล่าสุด', 'Reload latest')}</button>
      </div>
    </>}
    {!view && state === 'ready' && message && <><p className="error" role="alert">{message}</p><button type="button" className="secondary" onClick={() => void load()}>{text('ลองอีกครั้ง', 'Try again')}</button></>}
  </section>;
}
