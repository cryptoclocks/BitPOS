import ShopFloor from './ShopFloor';
import MerchantIcon from './MerchantIcon';
import React, { useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import type { Device, Register, Session, Table } from '../lib/table';
import CollectionSettings from './CollectionSettings';
import TableClearControls from './TableClearControls';
import '../styles/registry-settings.css';

type Language = 'en' | 'th';

export default function RegistrySettings({ session, tables, devices, registers, refresh, language }: { session: Session; tables: Table[]; devices: Device[]; registers: Register[]; refresh(): Promise<void>; language: Language }) {
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [credential, setCredential] = useState<{ deviceId: string; deviceToken: string; authGeneration: string }>();
  const editable = session.role === 'owner' || session.role === 'manager';
  const text = (th: string, en: string) => language === 'th' ? th : en;
  async function act(run: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await run();
      setMessage(text('บันทึกแล้ว', 'Saved.'));
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const activeTables = tables.filter(table => !table.retiredAt);
  const activeDevices = devices.filter(device => !device.revokedAt);
  return <section className="panel registry" aria-label={text('ทะเบียนโต๊ะและอุปกรณ์', 'Table and device registry')}>
    <header className="registry-hero">
      <div><p className="eyebrow">{text('พื้นที่ร้าน', 'YOUR FLOOR')}</p><h2>{text('โต๊ะ จุดขาย และ BitPOS Mini', 'Tables, registers & BitPOS Mini')}</h2><p>{text('จัดผังร้าน เชื่อม BitPOS Mini กับจุดขาย และตรวจสถานะก่อนรับออเดอร์', 'Arrange the floor, pair BitPOS Mini to registers, and check readiness before taking orders.')}</p></div>
      <div className="registry-counts" aria-label={text('สรุปอุปกรณ์', 'Device summary')}><span><b>{activeTables.length}</b>{text('โต๊ะใช้งาน', 'active tables')}</span><span><b>{activeDevices.filter(device => device.online).length}/{activeDevices.length}</b>{text('ออนไลน์', 'online')}</span></div>
    </header>
    {!editable && <p className="notice registry-access" role="status">{text('ดูสถานะและรายละเอียดได้ บัญชีนี้ไม่มีสิทธิ์เพิ่ม แก้ไข หรือยกเลิกอุปกรณ์', 'You can review status and details. This account cannot create, edit, revoke, or pair equipment.')}</p>}
    <ShopFloor mode="arrange" language={language} merchantId={session.merchantId} tables={tables} devices={devices} editable={editable} assign={async (device, tableId) => {
      await api(`/devices/${encodeURIComponent(device.id)}`, { tableId, expectedAssignmentGeneration: device.assignmentGeneration }, session.token, 'PATCH');
      await refresh();
    }}/>
    <details className="floor-manage">
      <summary><MerchantIcon name="plus"/>{text('จัดการโต๊ะ อุปกรณ์ และการเชื่อมต่อ', 'Manage tables, devices & connections')}</summary>
      <div className="registry-manage-intro"><div><p className="eyebrow">{text('ตั้งค่าอุปกรณ์', 'DEVICE SETUP')}</p><h2>{text('ตั้งค่าการเชื่อมต่ออย่างปลอดภัย', 'Set up connections safely')}</h2><p>{text('การเปลี่ยนแปลงใช้รุ่นข้อมูลปัจจุบันเสมอ หากเกิดความขัดแย้ง ให้รีเฟรชก่อนลองใหม่', 'Changes always use the current generation. If there is a conflict, refresh before trying again.')}</p></div><button className="secondary" disabled={busy} onClick={() => void act(refresh)}><MerchantIcon name="arrow"/>{text('รีเฟรชสถานะ', 'Refresh status')}</button></div>
      {editable && <section className="registry-create" aria-label={text('เพิ่มรายการ', 'Add registry item')}>{(['tables', 'devices', 'registers'] as const).map(kind => {
        const label = kind === 'tables' ? text('โต๊ะ', 'table') : kind === 'devices' ? text('BitPOS Mini', 'BitPOS Mini') : text('จุดขาย', 'register');
        return <form key={kind} onSubmit={event => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void act(async () => { await api(`/${kind}`, { label: data.get('label') }, session.token); form.reset(); });
        }}><p className="eyebrow">{text('เพิ่มใหม่', 'ADD NEW')}</p><h3>{label}</h3><label>{text('ชื่อที่แสดง', 'Display name')}<input name="label" required maxLength={95}/></label><button disabled={busy}><MerchantIcon name="plus"/>{text(`เพิ่ม${label}`, `Create ${label}`)}</button></form>;
      })}</section>}
      <section className="registry-section" aria-labelledby="registry-tables"><div className="registry-section-heading"><div><p className="eyebrow">{text('พื้นที่ขาย', 'SERVICE AREAS')}</p><h3 id="registry-tables">{text('โต๊ะ', 'Tables')}</h3></div><small>{text(`${activeTables.length} โต๊ะกำลังใช้งาน`, `${activeTables.length} active`)}</small></div>{tables.length ? tables.map(table => <form className="registry-row" key={`${table.id}:${table.label}:${table.retiredAt}`} onSubmit={event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void act(async () => { await api(`/tables/${encodeURIComponent(table.id)}`, { label: data.get('label') }, session.token, 'PATCH'); });
      }}><label>{text('ชื่อโต๊ะ', 'Table name')}<input name="label" defaultValue={table.label} readOnly={!editable || !!table.retiredAt} required maxLength={95}/></label><span className="badge">{table.retiredAt ? text('เลิกใช้แล้ว', 'Retired') : text('ใช้งาน', 'Active')}</span>{editable && !table.retiredAt && <div className="registry-actions"><button disabled={busy}><MerchantIcon name="save"/>{text('บันทึกชื่อ', 'Save name')}</button><button type="button" className="secondary" disabled={busy} onClick={() => void act(async () => { await api(`/tables/${encodeURIComponent(table.id)}`, { retired: true }, session.token, 'PATCH'); })}><MerchantIcon name="arrow"/>{text('เลิกใช้โต๊ะ', 'Retire table')}</button></div>}</form>) : <p className="registry-empty">{text('ยังไม่มีโต๊ะ เพิ่มโต๊ะเพื่อเริ่มจัดผังร้าน', 'No tables yet. Add a table to start arranging your floor.')}</p>}</section>
      <section className="registry-section" aria-labelledby="registry-devices"><div className="registry-section-heading"><div><p className="eyebrow">BITPOS MINI</p><h3 id="registry-devices">{text('อุปกรณ์แสดงผล', 'Display devices')}</h3></div><small>{text(`${activeDevices.length} เครื่องที่ยังไม่ยกเลิก`, `${activeDevices.length} not revoked`)}</small></div>{devices.length ? devices.map(device => <form className="registry-row registry-device-row" key={`${device.id}:${device.assignmentGeneration}:${device.label}:${device.revokedAt}`} onSubmit={event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void act(async () => { await api(`/devices/${encodeURIComponent(device.id)}`, { label: data.get('label'), tableId: data.get('tableId') || null, expectedAssignmentGeneration: device.assignmentGeneration }, session.token, 'PATCH'); });
      }}><label>{text('ชื่ออุปกรณ์', 'Device name')}<input name="label" defaultValue={device.label} readOnly={!editable} required maxLength={95}/></label><label>{text('โต๊ะที่ผูก', 'Assigned table')}<select aria-label={text('โต๊ะที่ผูก', 'Assigned table')} name="tableId" defaultValue={device.tableId ?? ''} disabled={!editable || busy || !!device.revokedAt}><option value="">{text('ไม่มีโต๊ะ / เคาน์เตอร์', 'No table / counter')}</option>{tables.filter(table => !table.retiredAt).map(table => <option key={table.id} value={table.id}>{table.label}</option>)}</select></label><span className={`badge ${device.online ? 'is-ready' : ''}`}>{device.revokedAt ? text('ยกเลิกแล้ว', 'Revoked') : device.online ? text('ออนไลน์', 'Online') : text('ออฟไลน์', 'Offline')}</span><details className="bill-details"><summary>{text('รายละเอียดการเชื่อมต่อ', 'Connection details')}</summary><p className="mono">{device.id}<small>{device.online ? text('ออนไลน์', 'Online') : text('ออฟไลน์', 'Offline')} · {device.screen.kind} · {text('รุ่นการผูก', 'Assignment')} {device.assignmentGeneration} · {text('พบล่าสุด', 'Last seen')} {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : text('ไม่เคย', 'Never')}{device.revokedAt ? ` · ${text('ยกเลิกแล้ว', 'Revoked')}` : ''}</small></p></details>{editable && !device.revokedAt && <div className="registry-actions"><button disabled={busy}><MerchantIcon name="save"/>{text('บันทึกการผูก', 'Save assignment')}</button>{session.role === 'owner' && <><button type="button" className="secondary" disabled={busy} onClick={() => void act(async () => { setCredential(await api(`/devices/${encodeURIComponent(device.id)}/credential`, {}, session.token)); })}><MerchantIcon name="arrow"/>{text('ตั้งค่าการเชื่อมต่อ', 'Set up connection')}</button><button type="button" className="secondary" disabled={busy} onClick={() => void act(async () => { await api(`/devices/${encodeURIComponent(device.id)}/credential`, undefined, session.token, 'DELETE'); setCredential(undefined); })}><MerchantIcon name="arrow"/>{text('เพิกถอนข้อมูลเชื่อมต่อ', 'Revoke credential')}</button><button type="button" className="secondary" disabled={busy} onClick={() => void act(async () => { await api(`/devices/${encodeURIComponent(device.id)}`, { revoked: true, expectedAssignmentGeneration: device.assignmentGeneration }, session.token, 'PATCH'); })}><MerchantIcon name="arrow"/>{text('ยกเลิกอุปกรณ์', 'Revoke device')}</button></>}</div>}</form>) : <p className="registry-empty">{text('ยังไม่มี BitPOS Mini เพิ่มอุปกรณ์ก่อนจับคู่กับจุดขาย', 'No BitPOS Mini yet. Add one before pairing it to a register.')}</p>}</section>
      {credential && session.role === 'owner' && <section className="notice registry-credential" aria-label={text('ข้อมูลเชื่อมต่ออุปกรณ์แบบใช้ครั้งเดียว', 'One-time device credential')}><h3>{text('ข้อมูลเชื่อมต่อแบบใช้ครั้งเดียว · เก็บเป็นความลับ', 'One-time credential · keep private')}</h3><p>{text('สำหรับการตั้งค่าโดยผู้ประสานงานเท่านั้น การหมุนข้อมูลจะทำให้ข้อมูลเดิมใช้ไม่ได้ เบราว์เซอร์จะไม่บันทึกค่านี้', 'For coordinator-controlled provisioning only. Rotating invalidates the old credential. This value is not stored in the browser journal.')}</p><p className="mono">{text('อุปกรณ์', 'Device')} {credential.deviceId} · {text('รุ่นการยืนยันตัวตน', 'Auth generation')} {credential.authGeneration}</p><label>{text('ข้อมูลลับของอุปกรณ์', 'Private device credential')}<input type="password" readOnly value={credential.deviceToken} autoComplete="off"/></label><div className="registry-actions"><button type="button" onClick={() => void navigator.clipboard.writeText(credential.deviceToken).then(() => setMessage(text('คัดลอกข้อมูลเชื่อมต่อแล้ว ล้างหลังตั้งค่าส่วนตัว', 'Credential copied. Clear it after private provisioning.'))).catch(() => setError(text('ไม่สามารถใช้คลิปบอร์ดได้ ให้ใช้ช่องข้อมูลลับส่วนตัว', 'Clipboard unavailable; use the private credential field.')))}><MerchantIcon name="arrow"/>{text('คัดลอกข้อมูลลับ', 'Copy private credential')}</button><button type="button" className="secondary" onClick={() => setCredential(undefined)}><MerchantIcon name="trash"/>{text('ล้างข้อมูลลับ', 'Clear credential')}</button></div></section>}
      <section className="registry-section" aria-labelledby="registry-pairing"><div className="registry-section-heading"><div><p className="eyebrow">{text('เส้นทางออเดอร์', 'ORDER ROUTING')}</p><h3 id="registry-pairing">{text('จับคู่จุดขาย', 'Register pairing')}</h3></div><small>{text('ออเดอร์ใหม่เท่านั้น', 'New orders only')}</small></div>{registers.filter(register => !register.retiredAt).length ? registers.filter(register => !register.retiredAt).map(register => <PairingRow key={`${register.id}:${register.pairingGeneration}`} register={register} devices={devices} registers={registers} editable={editable} busy={busy} language={language} save={deviceId => act(async () => { await api(`/registers/${encodeURIComponent(register.id)}/pairing`, { deviceId, expectedPairingGeneration: register.pairingGeneration }, session.token, 'PUT'); })}/>) : <p className="registry-empty">{text('ยังไม่มีจุดขาย เพิ่มจุดขายก่อนจับคู่ BitPOS Mini', 'No registers yet. Add a register before pairing BitPOS Mini.')}</p>}</section>
    </details>
    {error && <p className="error" role="alert">{error} · {text('รีเฟรชก่อนลองใหม่เมื่อรุ่นข้อมูลขัดแย้ง ระบบจะไม่เขียนทับอัตโนมัติ', 'Refresh before retrying a generation conflict; no automatic overwrite.')}</p>}
    {message && <p role="status">{message}</p>}
    <TableClearControls session={session} tables={tables} refresh={refresh} language={language}/>
    {editable && <CollectionSettings session={session}/>}
  </section>;
}

function PairingRow({ register, devices, registers, editable, busy, language, save }: { register: Register; devices: Device[]; registers: Register[]; editable: boolean; busy: boolean; language: Language; save(deviceId: string | null): Promise<void> }) {
  const [target, setTarget] = useState(register.deviceId ?? '');
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const targetDevice = devices.find(device => device.id === target);
  return <form className="registry-row registry-pairing-row" onSubmit={event => { event.preventDefault(); void save(target || null); }}><div><strong>{register.label}</strong><p>{text('ปัจจุบัน', 'Current')}: {devices.find(device => device.id === register.deviceId)?.label ?? text('ยังไม่จับคู่', 'Unpaired')} · {register.targetOnline ? text('ออนไลน์', 'Online') : text('ออฟไลน์ / ยังไม่จับคู่', 'Offline / unpaired')}</p></div><label>POSClock<select aria-label="POSClock" value={target} disabled={!editable || busy} onChange={event => setTarget(event.target.value)}><option value="">{text('ยกเลิกการจับคู่', 'Unpair')}</option>{devices.filter(device => !device.revokedAt).map(device => <option key={device.id} value={device.id} disabled={registers.some(other => other.id !== register.id && other.deviceId === device.id)}>{device.label} · {device.online ? text('ออนไลน์', 'Online') : text('ออฟไลน์', 'Offline')} · {device.screen.kind}</option>)}</select></label><p className="notice">{text('ออเดอร์ใหม่จะไปที่', 'New orders go to')} {targetDevice?.label ?? text('ไม่มีอุปกรณ์', 'no device')}. {text('บิลปัจจุบันยังคงใช้จอเดิม', 'Current bills keep their original screen.')}</p>{editable && <button disabled={busy}><MerchantIcon name="link"/>{target ? register.deviceId ? text('บันทึกการเชื่อมต่อ', 'Save connection') : text('เชื่อม POSClock', 'Connect POSClock') : text('ตัดการเชื่อมต่อ', 'Disconnect POSClock')}</button>}</form>;
}
