import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import '../styles/channel-orders.css';

type Source = 'grabfood' | 'lineman';
type Environment = 'sandbox' | 'production';
interface Connection { source: Source; environment: Environment; state: string; lastCheckAt: string | null; lastCheckResult: string; externalStoreId: string; clientId: string; hasClientSecret: boolean; hasWebhookSecret: boolean; updatedAt: string }
const SOURCES: Source[] = ['grabfood', 'lineman'];
const ENVIRONMENTS: Environment[] = ['sandbox', 'production'];

// Owner-only slots for delivery-platform credentials. Secrets are write-only here: the server returns only "stored / not stored".
// Saving does not connect anything: no provider has granted BitPOS API access yet, so the state stays "saved, not verified".
export default function ChannelSettings({ token, language }: { token: string; language: 'th' | 'en' }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [items, setItems] = useState<Connection[] | null>(null); const [active, setActive] = useState<Record<string, Environment>>({}); const [error, setError] = useState('');
  const load = () => api<{ connections: Connection[]; activeEnvironment: Record<string, Environment> }>('/channels/credentials', undefined, token).then(v => { setItems(v.connections); setActive(v.activeEnvironment); setError(''); }).catch(e => setError(errorMessage(e)));
  useEffect(() => { void load(); }, [token]);
  return <section className="panel" aria-label={text('ช่องทางเดลิเวอรี', 'Delivery channels')}>
    <h2>{text('ช่องทางเดลิเวอรี', 'Delivery channels')}</h2>
    <p className="notice" role="status">{text('ยังเชื่อมต่อจริงไม่ได้: GrabFood และ LINE MAN ยังไม่ได้อนุมัติสิทธิ์ API ให้ BitPOS ใส่คีย์ที่ผู้ให้บริการออกให้ไว้ล่วงหน้าได้ ระบบเก็บแบบเข้ารหัสและไม่แสดงกลับ แต่จะยังไม่รับออเดอร์จนกว่าจะตรวจกับผู้ให้บริการสำเร็จ', 'Not connected yet: GrabFood and LINE MAN have not granted BitPOS API access. You can store the keys they issue to you. They are encrypted and never shown again, and no orders are received until the provider verifies them.')}</p>
    {error && <p className="notice" role="alert">{error}</p>}
    {!items && !error && <p role="status">{text('กำลังโหลด…', 'Loading…')}</p>}
    {items && SOURCES.map(source => <div key={source}>
      <EnvironmentSwitch source={source} active={active[source] ?? 'sandbox'} hasProduction={!!items.find(i => i.source === source && i.environment === 'production' && i.hasClientSecret)} token={token} language={language} changed={load} />
      {ENVIRONMENTS.map(environment => <ChannelForm key={`${source}-${environment}`} source={source} environment={environment} current={items.find(i => i.source === source && i.environment === environment)} token={token} language={language} changed={load} />)}
    </div>)}
  </section>;
}

function ChannelForm({ source, environment, current, token, language, changed }: { source: Source; environment: Environment; current?: Connection; token: string; language: 'th' | 'en'; changed: () => Promise<unknown> }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [storeId, setStoreId] = useState(current?.externalStoreId ?? ''); const [clientId, setClientId] = useState(current?.clientId ?? '');
  const [clientSecret, setClientSecret] = useState(''); const [webhookSecret, setWebhookSecret] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => { setStoreId(current?.externalStoreId ?? ''); setClientId(current?.clientId ?? ''); }, [current?.updatedAt]);
  const name = source === 'grabfood' ? 'GrabFood' : 'LINE MAN';
  const envName = environment === 'sandbox' ? text('ทดสอบ (sandbox)', 'Sandbox') : text('ใช้งานจริง', 'Production');
  async function save() {
    setBusy(true); setMessage('');
    try {
      await api('/channels/credentials', { source, environment, externalStoreId: storeId, clientId, ...(clientSecret ? { clientSecret } : {}), ...(webhookSecret ? { webhookSecret } : {}) }, token, 'PUT');
      setClientSecret(''); setWebhookSecret(''); setMessage(text('บันทึกแล้ว (ยังไม่ได้ตรวจกับผู้ให้บริการ)', 'Saved (not yet verified with the provider)')); await changed();
    } catch (e) { setMessage(errorMessage(e)); }
    setBusy(false);
  }
  async function check() {
    setBusy(true); setMessage('');
    try {
      const r = await api<{ ok: boolean; result: string }>('/channels/test', { source, environment }, token);
      setMessage(r.ok ? text('เชื่อมต่อสำเร็จ: คีย์และรหัสร้านใช้ได้', 'Connected: keys and store ID accepted') : text(`เชื่อมต่อไม่สำเร็จ (${r.result})`, `Could not connect (${r.result})`)); await changed();
    } catch (e) { setMessage(errorMessage(e)); }
    setBusy(false);
  }
  async function remove() {
    if (!window.confirm(text(`ลบคีย์ ${name} (${envName}) ?`, `Delete the ${name} (${envName}) keys?`))) return;
    setBusy(true); setMessage('');
    try { await api('/channels/credentials/delete', { source, environment }, token); setClientSecret(''); setWebhookSecret(''); await changed(); setMessage(text('ลบแล้ว', 'Deleted')); } catch (e) { setMessage(errorMessage(e)); }
    setBusy(false);
  }
  const stored = (flag: boolean | undefined) => flag ? text('เก็บไว้แล้ว — เว้นว่างเพื่อใช้ค่าเดิม', 'Stored — leave empty to keep') : text('ยังไม่ได้ใส่', 'Not set');
  return <form className="panel" onSubmit={e => { e.preventDefault(); void save(); }} aria-label={`${name} ${envName}`} autoComplete="off">
    <h3>{name} · {envName}</h3>
    <p className="catalog-sub">{!current ? text('สถานะ: รอสิทธิ์จากผู้ให้บริการ', 'Status: awaiting provider access') : current.state === 'linked' ? text('สถานะ: เชื่อมต่อแล้ว (ตรวจกับผู้ให้บริการสำเร็จ)', 'Status: connected (verified with the provider)') : current.lastCheckResult ? text(`สถานะ: ตรวจล่าสุดไม่ผ่าน (${current.lastCheckResult})`, `Status: last check failed (${current.lastCheckResult})`) : text('สถานะ: บันทึกคีย์แล้ว ยังไม่ได้ตรวจกับผู้ให้บริการ', 'Status: keys saved, not verified')}</p>
    {source === 'lineman' && <p className="notice">{text('LINE MAN ยังไม่มีเอกสาร API สาธารณะ จึงทดสอบการเชื่อมต่อไม่ได้ เก็บคีย์ไว้ล่วงหน้าเท่านั้น', 'LINE MAN has no public API documentation, so the connection cannot be tested. Keys are stored for later only.')}</p>}
    <label>{text('รหัสร้าน/Store ID ที่ผู้ให้บริการออกให้', 'Store ID issued by the provider')}<input value={storeId} maxLength={120} onChange={e => setStoreId(e.target.value)} /></label>
    <label>Client ID<input value={clientId} maxLength={200} onChange={e => setClientId(e.target.value)} autoComplete="off" /></label>
    <label>Client secret<input type="password" value={clientSecret} maxLength={512} placeholder={stored(current?.hasClientSecret)} onChange={e => setClientSecret(e.target.value)} autoComplete="new-password" /></label>
    <label>Webhook secret {text('(ยังไม่ใช้ — รอเอกสาร webhook)', '(not used yet — pending webhook docs)')}<input type="password" value={webhookSecret} maxLength={512} placeholder={stored(current?.hasWebhookSecret)} onChange={e => setWebhookSecret(e.target.value)} autoComplete="new-password" /></label>
    {message && <p className="notice" role="status">{message}</p>}
    <div className="toolbar"><button disabled={busy}>{busy ? text('กำลังบันทึก…', 'Saving…') : text('บันทึกคีย์', 'Save keys')}</button>{current && source === 'grabfood' && <button type="button" disabled={busy} onClick={() => void check()}>{text('ทดสอบการเชื่อมต่อ', 'Test connection')}</button>}{current && <button type="button" disabled={busy} onClick={() => void remove()}>{text('ลบคีย์', 'Delete keys')}</button>}</div>
  </form>;
}

const providerName = (source: Source) => source === 'grabfood' ? 'GrabFood' : 'LINE MAN';

// Which environment BitPOS talks to. Sandbox is the default; production is an explicit, confirmed owner choice.
function EnvironmentSwitch({ source, active, hasProduction, token, language, changed }: { source: Source; active: Environment; hasProduction: boolean; token: string; language: 'th' | 'en'; changed: () => Promise<unknown> }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  async function choose(environment: Environment) {
    if (environment === active) return;
    if (environment === 'production' && !window.confirm(text(`ใช้ ${providerName(source)} ของจริง? ออเดอร์และคำสั่งจะไปที่ร้านจริงบนแพลตฟอร์ม`, `Use the real ${providerName(source)}? Orders and commands will go to your live store.`))) return;
    setBusy(true); setMessage('');
    try { await api('/channels/environment', { source, environment, ...(environment === 'production' ? { confirmProduction: true } : {}) }, token, 'PUT'); await changed(); } catch (e) { setMessage(errorMessage(e)); }
    setBusy(false);
  }
  return <fieldset className="panel" disabled={busy}>
    <legend>{providerName(source)} · {text('ใช้ API ไหน', 'Which API')}</legend>
    <label className="channel-radio"><input type="radio" name={`env-${source}`} checked={active === 'sandbox'} onChange={() => void choose('sandbox')} /> {text('Sandbox (ทดสอบ) — ค่าเริ่มต้น', 'Sandbox (testing) — default')}</label>
    <label className="channel-radio"><input type="radio" name={`env-${source}`} checked={active === 'production'} disabled={!hasProduction && active !== 'production'} onChange={() => void choose('production')} /> {text('ของจริง (production)', 'Live (production)')}{!hasProduction && <small> · {text('ใส่คีย์ production ก่อน', 'save production keys first')}</small>}</label>
    {message && <p className="notice" role="status">{message}</p>}
  </fieldset>;
}
