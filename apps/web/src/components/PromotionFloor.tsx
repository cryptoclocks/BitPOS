import React, { useEffect, useRef, useState } from 'react';
import type { PromotionCampaign, PromotionDevice } from '../../../../packages/contracts/src/promotions';
import type { PromotionBatchTarget, PromotionDeviceProjection } from '../../../../packages/contracts/src/daily-promotions';
import type { Device, Session, Table } from '../lib/table';
import { api, errorMessage } from '../lib/api';
import { formatMoney } from '../lib/money';
import ShopFloor, { type FloorSelection } from './ShopFloor';
import PromotionPreview from './PromotionPreview';
import TableClearControls from './TableClearControls';
import { playlistStatusLabels } from './PromotionCampaignControl';

type Derivation = { source: PromotionCampaign; mode: 'edit' | 'regenerate'; device: PromotionDevice };

export default function PromotionFloor({ session, language, tables, devices, promotionDevices, registryCurrent, promotionsCurrent, selection, setSelection, onCurrentChange, disabled, configured, openCampaign, revoke, derive, refresh, children }: {
  session: Session; language: 'en' | 'th'; tables: Table[]; devices: Device[]; promotionDevices: PromotionDevice[];
  registryCurrent: boolean; promotionsCurrent: boolean; selection: FloorSelection; setSelection: (selection: FloorSelection) => void; onCurrentChange: (current: boolean) => void;
  revoke:(campaign:PromotionCampaign)=>void; disabled: boolean; configured: boolean; openCampaign: (campaign: PromotionCampaign) => void;
  derive: (campaign: PromotionCampaign, body: { expectedVersion: number; scope: 'all_campaign_devices' | 'this_table'; mode: 'edit' | 'regenerate'; device: PromotionBatchTarget; confirmScope: true }) => Promise<void>;
  refresh: () => Promise<void>; children: React.ReactNode;
}) {
  const text = (en: string, th: string) => language === 'th' ? th : en;
  const manage = session.role === 'owner' || session.role === 'manager';
  const dialog = useRef<HTMLDialogElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const floorRoot = useRef<HTMLElement>(null);
  const [projection, setProjection] = useState<PromotionDeviceProjection>();
  const [projectionFresh, setProjectionFresh] = useState(false);
  const [loadedAt, setLoadedAt] = useState('');
  const [error, setError] = useState('');
  const [derivation, setDerivation] = useState<Derivation>();
  const [mobile, setMobile] = useState(false);
  const [scope, setScope] = useState<'' | 'all_campaign_devices' | 'this_table'>('');
  const [confirmed, setConfirmed] = useState(false);
  const [reload, setReload] = useState(0);
  const selectedDevice = selection?.kind === 'device' ? devices.find(d => d.id === selection.deviceId && !d.revokedAt) : undefined;
  const selectedTable = selection?.kind === 'table' ? tables.find(t => t.id === selection.tableId && !t.retiredAt) : undefined;
  const tableId = selectedTable?.id ?? selectedDevice?.tableId ?? '';
  const deviceId = selectedDevice?.id;
  const selectionKey = selection?.kind === 'device' ? 'd:' + selection.deviceId : selection?.kind === 'table' ? 't:' + selection.tableId : '';
  function choose(next: FloorSelection) {
    if (document.activeElement instanceof HTMLElement && !dialog.current?.contains(document.activeElement)) returnFocus.current = document.activeElement;
    setSelection(next);
  }
  function containFocus(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (!mobile || event.key !== 'Tab') return;
    const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex]'))
      .filter(element => {
        const closed = element.closest('details:not([open])');
        return element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0
          && (!closed || element === closed.querySelector(':scope > summary'));
      });
    const first = elements[0], last = elements[elements.length - 1];
    if (!first) { event.preventDefault(); event.currentTarget.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { event.preventDefault(); first.focus(); }
  }
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const media = window.matchMedia('(max-width: 700px)');
    let previousOverflow: string | undefined;
    function present() {
      if (!element) return;
      if (element.open) element.close();
      if (previousOverflow !== undefined) { document.body.style.overflow = previousOverflow; previousOverflow = undefined; }
      setMobile(media.matches);
      if (!selectionKey) return;
      if (media.matches) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; element.showModal(); }
      else element.show();
      closeButton.current?.focus();
    }
    present(); media.addEventListener('change', present);
    function escape(event: KeyboardEvent) { if (event.key === 'Escape' && !media.matches && element?.open) { event.preventDefault(); setSelection(null); } }
    document.addEventListener('keydown', escape);
    return () => {
      media.removeEventListener('change', present); document.removeEventListener('keydown', escape);
      if (element.open) element.close();
      if (previousOverflow !== undefined) document.body.style.overflow = previousOverflow;
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
      else floorRoot.current?.querySelector<HTMLButtonElement>('.floor-view-toggle button')?.focus();
    };
  }, [selectionKey]);
  useEffect(() => { setDerivation(undefined); setScope(''); setConfirmed(false); }, [selectionKey]);
  useEffect(() => {
    let active = true, loading = false;
    setProjection(undefined); setProjectionFresh(false); setError(''); setLoadedAt('');
    if (!deviceId) return;
    const inspectionPath = `/promotions/devices/${encodeURIComponent(deviceId)}`;
    async function inspect() {
      if (loading) return; loading = true;
      try {
        const next = await api<PromotionDeviceProjection>(inspectionPath, undefined, session.token);
        if (active) { setProjection(next); setProjectionFresh(true); setLoadedAt(new Date().toLocaleString(language)); setError(''); }
      } catch (error) { if (active) { setProjectionFresh(false); setError(errorMessage(error)); } }
      finally { loading = false; }
    }
    void inspect(); const timer = window.setInterval(inspect, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [deviceId, session.token, reload]);
  const actual = projection?.device;
  const current = registryCurrent && promotionsCurrent && projectionFresh && !!selectedDevice && !!actual && actual.deviceId === selectedDevice.id && actual.tableId === selectedDevice.tableId && actual.assignmentGeneration === selectedDevice.assignmentGeneration && actual.authGeneration === selectedDevice.authGeneration && actual.screenGeneration === selectedDevice.screen.screenGeneration && actual.online === selectedDevice.online;
  useEffect(() => { onCurrentChange(current); }, [current, onCurrentChange]);
  const source = derivation ? projection?.campaigns.find(c => c.id === derivation.source.id) : undefined;
  const derivationCurrent = current && !!derivation && !!source && source.version === derivation.source.version && actual?.deviceId === derivation.device.deviceId && actual?.assignmentGeneration === derivation.device.assignmentGeneration && actual?.authGeneration === derivation.device.authGeneration && actual?.screenGeneration === derivation.device.screenGeneration && actual?.tableId === derivation.device.tableId;
  const personalDraft = !!derivation?.source.scope && derivation.source.scope.audience !== 'daily';
  const allCampaignAllowed = derivation?.source.scope?.audience === 'daily' && derivation.source.scope.placement?.kind !== 'table';
  const originalBinding = derivation?.source.scope?.binding;
  const originalTable = originalBinding ? tables.find(t => t.id === originalBinding.tableId && !t.retiredAt) : undefined;
  const thisTableAllowed = !!actual?.tableId && (!originalBinding || actual.deviceId === originalBinding.targetDeviceId && actual.tableId === originalBinding.tableId && actual.assignmentGeneration === originalBinding.assignmentGeneration && actual.authGeneration === originalBinding.authGeneration && originalTable?.occupancy.active && originalTable.occupancy.generation === originalBinding.occupancyGeneration && projection?.playlist.occupancyGeneration === originalBinding.occupancyGeneration) && (derivation?.source.scope?.placement?.kind !== 'table' || derivation.source.scope.placement.tableId === actual.tableId && derivation.source.scope.placement.deviceIds.includes(actual.deviceId));
  const scopeAllowed = scope === 'all_campaign_devices' ? allCampaignAllowed : scope === 'this_table' ? thisTableAllowed : false;
  return <section ref={floorRoot} className={`promotion-floor-workspace ${selection ? 'has-inspection' : ''}`} aria-label={text('Promotion floor', 'ผังโปรโมชัน')}>
    <details className="promotion-floor-fold" open={!mobile}><summary>{text('Floor plan','ผังร้าน')}</summary><ShopFloor key={session.merchantId} mode="inspect" merchantId={session.merchantId} language={language} tables={tables} devices={devices} selection={selection} onSelectionChange={choose} promotionDevices={promotionDevices} current={registryCurrent && promotionsCurrent}/></details>
    <dialog ref={dialog} className="promotion-floor-inspector" role={mobile ? 'dialog' : 'complementary'} aria-modal={mobile ? true : undefined} aria-labelledby="promotion-inspector-title" onKeyDown={containFocus} onCancel={event => { event.preventDefault(); setSelection(null); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setSelection(null); } }}>
      <div className="promotion-inspector-heading"><h2 id="promotion-inspector-title">{selectedDevice?.label ?? selectedTable?.label ?? text('Table / device unavailable', 'ไม่พบโต๊ะหรือเครื่อง')}</h2><button ref={closeButton} className="secondary" aria-label={text('Close inspection', 'ปิดรายละเอียด')} onClick={() => setSelection(null)}>{text('Close', 'ปิด')}</button></div>
      <div className="promotion-inspector-body">
        {!registryCurrent && <p className="notice" role="status">{text('Registry status is last known. Refresh before starting a new action.', 'สถานะโต๊ะและเครื่องเป็นข้อมูลเดิม โหลดใหม่ก่อนเริ่มคำสั่ง')}</p>}
        {selectedTable && <><p>{selectedTable.occupancy.active ? text('Table in use', 'โต๊ะมีผู้ใช้') : text('Table available', 'โต๊ะว่าง')} · {text('Visit generation', 'รอบโต๊ะ')}: {selectedTable.occupancy.generation}</p><h3>{text('Assigned screens', 'จอที่ผูกกับโต๊ะ')}</h3>{devices.filter(d => d.tableId === selectedTable.id && !d.revokedAt).map(d => <button key={d.id} className="secondary promotion-table-device" onClick={() => choose({ kind: 'device', deviceId: d.id })}>{text('Inspect screen', 'ตรวจจอ')}: {d.label}</button>)}{!devices.some(d => d.tableId === selectedTable.id && !d.revokedAt) && <p>{text('No assigned screens. No device or recipient is selected automatically.', 'ไม่มีจอที่ผูก ไม่เลือกเครื่องหรือผู้รับอัตโนมัติ')}</p>}</>}
        {selectedDevice && <section aria-label={text('Canonical device promotions', 'โปรโมชันจริงของเครื่อง')}>
          <button className="secondary" onClick={() => setReload(n => n + 1)}>{text('Refresh device playlist', 'โหลดเพลย์ลิสต์ใหม่')}</button>
          {!current && <p className="notice" role="status">{text('Status not current. Retained data is last known; new actions are disabled.', 'สถานะไม่เป็นปัจจุบัน ข้อมูลเดิมเป็นข้อมูลล่าสุดที่เคยอ่าน ปิดคำสั่งใหม่')} {loadedAt}</p>}
          {error && <p className="error" role="alert">{error}</p>}
          {actual && <p>{actual.online ? text('Online', 'ออนไลน์') : text('Offline · deferred', 'ออฟไลน์ · รอส่ง')} · {actual.busy ? text('Busy · payment/pickup takes priority', 'กำลังใช้งาน · ชำระเงิน/เรียกรับมาก่อน') : text('Available', 'ว่าง')} · {actual.capable ? 'promotion_playlist_v1' : text('Unsupported', 'ไม่รองรับ')} · {actual.tableLabel ?? text('Counter', 'เคาน์เตอร์')}</p>}
          <h3>{text(`Rotating playlist (${projection?.playlist.items.length??0})`, `รายการหมุนสลับ (${projection?.playlist.items.length??0})`)}</h3><p className="promotion-caption">{text('Canonical server selection, not the exact rotating screen. Device render acknowledgement is separate.', 'รายการจากเซิร์ฟเวอร์ ไม่ใช่ภาพที่หมุนอยู่ ณ วินาทีนี้ แยก ACK การแสดงของเครื่อง')}</p>
          {projection?.playlist.items.map(item => <article className="promotion-inspection-item" key={item.targetId} data-current-target={item.targetId}><strong>{(projection?.playlist.items.indexOf(item)??0)+1}. {item.headline}</strong><p>{item.copy}</p><small>{item.audience === 'personal' ? text('Personal · original recipient only', 'ส่วนตัว · ผู้รับเดิมเท่านั้น') : projection.campaigns.find(c => c.id === item.campaignId)?.scope?.priceAuthority === 'table' ? text('Table-only daily offer', 'ประจำวันเฉพาะโต๊ะ') : text('Daily', 'ประจำวัน')} · {text('Approved content', 'เนื้อหาที่อนุมัติ')} v{item.campaignVersion} · {formatMoney(item.unitPrice)} · {text('Expires', 'หมดอายุ')} {new Date(item.expiresAt).toLocaleString(language)}</small>{projection.campaigns.filter(c=>c.id===item.campaignId&&c.approvedVersion===item.campaignVersion).map(c=><div className="toolbar" key={c.id}><button className="secondary" disabled={disabled} onClick={()=>openCampaign(c)}>{text('Open','เปิด')}</button>{manage&&<><button className="secondary" disabled={disabled||!current} onClick={()=>{if(!actual)return;setDerivation({source:c,mode:'edit',device:actual});setScope('');setConfirmed(false);}}>{text('Edit','แก้ไข')}</button><button className="secondary" disabled={disabled||!current} onClick={()=>revoke(c)}>{text('Remove','ลบ')}</button></>}</div>)}</article>)}
          {projection && !projection.playlist.items.length && <p>{text('No currently eligible playlist items.', 'ยังไม่มีรายการที่มีสิทธิ์แสดง')}</p>}
          <details><summary>{text('Campaign details & scheduled items', 'รายละเอียดและรายการรอเริ่ม')}</summary>
          {projection?.campaigns.map(c => <article className="promotion-inspection-campaign" key={c.id} data-inspection-campaign={c.id}><strong>{c.headline}</strong><small>{c.state} · {text('Command version', 'เวอร์ชันคำสั่ง')} {c.version} · {text('Approved content', 'เนื้อหาที่อนุมัติ')} {c.approvedVersion ?? '—'}</small><small>{!c.scope ? text('Historical campaign · scope unavailable', 'แคมเปญเดิม ไม่พบขอบเขต') : c.scope.audience !== 'daily' ? text('Personal · original recipient', 'ส่วนตัว · ผู้รับเดิม') : c.scope.placement?.kind === 'table' ? text('Table-only discount authority', 'สิทธิ์ส่วนลดเฉพาะโต๊ะ') : text('Daily · public price', 'ประจำวัน · ราคาสาธารณะ')}</small><small>{c.provenance.kind === 'fixture_provider' ? text('HTTP fixture · not real AI', 'ข้อมูลทดสอบ ไม่ใช่ AI จริง') : `${c.provenance.provider} · ${c.provenance.model}`} · #{c.provenance.requestId}</small>{c.scope?.placement && <small>{text('Derived from', 'จากต้นทาง')} #{c.scope.placement.sourceCampaignId} v{c.scope.placement.sourceVersion} · {c.scope.origin}</small>}{c.scope?.pricePresentation === 'inherited_source' && <small>{text('Price presentation inherited from the source; the explicit public, table or original-recipient authority is unchanged.', 'รูปแบบราคาใช้ราคาเดิมจากต้นทาง รักษาขอบเขตสาธารณะ เฉพาะโต๊ะ หรือผู้รับเดิมตามที่ระบุ')}</small>}<PromotionPreview url={c.previewUrl} blocker={c.assetBlocker} language={language}/><p className="promotion-caption">{text('Shared campaign preview · not proof of device rendering', 'พรีวิวแคมเปญร่วมกัน ไม่ใช่หลักฐานการแสดงของจอ')}</p>{(c.playlistTargets ?? []).filter(t => t.deviceId === selectedDevice.id).map(t => <p key={t.id} data-device-receipt={t.state}>{text(playlistStatusLabels[t.state][1], playlistStatusLabels[t.state][0])} · v{t.campaignVersion}{t.renderedAt && ` · ${t.renderedAt}`}{t.failure && ` · ${t.failure}`}</p>)}<div className="toolbar"><button className="secondary" disabled={disabled} onClick={() => openCampaign(c)}>{text('Open campaign', 'เปิดแคมเปญ')}</button>{manage && c.scope && <><button className="secondary" disabled={disabled || !current} onClick={() => { if (!current || !actual) return; setDerivation({ source: c, mode: 'edit', device: actual }); setScope(''); setConfirmed(false); }}>{text('Edit as new draft', 'แก้เป็นแบบร่างใหม่')}</button><button className="secondary" disabled={disabled || !current || !configured} onClick={() => { if (!current || !actual) return; setDerivation({ source: c, mode: 'regenerate', device: actual }); setScope(''); setConfirmed(false); }}>{text('AI regenerate', 'สร้างใหม่ด้วย AI')}</button></>}</div></article>)}
          </details>
          {derivation && !allCampaignAllowed && <p className="notice">{personalDraft ? text('Private original-recipient draft only. The original device, visit and recipient stay bound; this is not a table-wide offer.', 'แบบร่างส่วนตัวเฉพาะผู้รับเดิม ผูกเครื่อง รอบโต๊ะ และผู้รับเดิม ไม่ใช่ข้อเสนอทั้งโต๊ะ') : text('This source is already table-local. A new draft retains that exact table destination; expanding to other screens is not allowed.', 'ต้นทางเป็นเฉพาะโต๊ะอยู่แล้ว แบบร่างใหม่รักษาปลายทางเดิม ไม่ขยายไปจออื่น')}</p>}
          {derivation && <section className="promotion-derive" aria-label={text('Choose draft scope', 'เลือกขอบเขตแบบร่าง')}><h3>{text('Choose scope before creating a draft', 'เลือกขอบเขตก่อนสร้างแบบร่าง')}</h3><p>{derivation.source.headline} · v{derivation.source.version} · {derivation.mode === 'edit' ? text('Manual draft · inherits actual provider provenance', 'แบบร่างแก้ไข สืบทอดแหล่งที่มาจริง') : text('New durable AI job · existing budget · no automatic send', 'งาน AI ใหม่ภายใต้งบเดิม ไม่ส่งอัตโนมัติ')}</p><fieldset disabled={disabled || !derivationCurrent}><label><input type="radio" name="derive-scope" checked={scope === 'all_campaign_devices'} disabled={!allCampaignAllowed} onChange={() => { setScope('all_campaign_devices'); setConfirmed(false); }}/>{text('All campaign devices', 'ทุกเครื่องของแคมเปญ')}</label><label><input type="radio" name="derive-scope" checked={scope === 'this_table'} disabled={!thisTableAllowed} onChange={() => { setScope('this_table'); setConfirmed(false); }}/>{personalDraft ? text('New draft for the original recipient here', 'แบบร่างใหม่สำหรับผู้รับเดิมที่นี่') : text('Fork a draft for this table only', 'แยกแบบร่างเฉพาะโต๊ะนี้')}</label></fieldset><p className="promotion-caption">{scope === 'all_campaign_devices' ? text('The source campaign’s device scope is retained. Other screens can be affected only after explicit approval and send.', 'รักษาขอบเขตเครื่องต้นทาง จออื่นได้รับผลเมื่ออนุมัติและยืนยันส่งเท่านั้น') : scope === 'this_table' ? personalDraft ? text('New private draft for the same original recipient, visit and device. Not a table-wide offer; the source stays unchanged.', 'แบบร่างส่วนตัวสำหรับผู้รับ รอบโต๊ะ และเครื่องเดิม ไม่ใช่ข้อเสนอทั้งโต๊ะ ต้นทางไม่เปลี่ยน') : `${text('New table-only draft', 'แบบร่างเฉพาะโต๊ะใหม่')}: ${actual?.tableLabel} · ${text('Original campaign stays unchanged. Not a personal offer.', 'ต้นทางไม่เปลี่ยน ไม่ใช่ข้อเสนอส่วนตัว')}` : text('No scope selected. No request has been sent.', 'ยังไม่เลือกขอบเขต ยังไม่มีคำขอถูกส่ง')}</p>{!derivationCurrent && <p className="notice">{text('Source version or routing changed. Refresh and select the source action again.', 'เวอร์ชันหรือการผูกเปลี่ยน โหลดใหม่และเลือกคำสั่งต้นทางอีกครั้ง')}</p>}<label className="promotion-confirm"><input type="checkbox" checked={confirmed} disabled={disabled || !derivationCurrent || !scopeAllowed} onChange={e => setConfirmed(e.target.checked)}/>{text('I confirm this draft scope. Creating does not approve or send.', 'ยืนยันขอบเขตแบบร่าง การสร้างไม่อนุมัติหรือส่ง')}</label><button disabled={disabled || !derivationCurrent || !scopeAllowed || !confirmed} onClick={() => { if (!scope || !scopeAllowed || !derivationCurrent) return; const { deviceId, assignmentGeneration, authGeneration, screenGeneration } = derivation.device; setConfirmed(false); void derive(derivation.source, { expectedVersion: derivation.source.version, scope, mode: derivation.mode, device: { deviceId, assignmentGeneration, authGeneration, screenGeneration }, confirmScope: true }); }}>{derivation.mode === 'edit' ? text('Create editable draft · do not send', 'สร้างแบบร่างแก้ไข ยังไม่ส่ง') : text('Start AI draft job · do not send', 'เริ่มงาน AI ยังไม่ส่ง')}</button><button className="secondary" onClick={() => setDerivation(undefined)}>{text('Cancel scope selection', 'ยกเลิกขอบเขต')}</button></section>}
        </section>}
        {children}
        <TableClearControls session={session} tables={tables} language={language} selectedTableId={tableId} current={registryCurrent && promotionsCurrent && !disabled && (!selectedDevice || current)} onRecovered={id => setSelection({ kind: 'table', tableId: id })} refresh={async () => { setConfirmed(false); setDerivation(undefined); await refresh(); setReload(n => n + 1); }}/>
      </div>
    </dialog>
  </section>;
}
