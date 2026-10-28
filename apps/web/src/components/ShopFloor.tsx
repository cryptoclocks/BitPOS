import React, { useEffect, useRef, useState } from 'react';
import type { Device, Table } from '../lib/table';
import type { PromotionDevice } from '../../../../packages/contracts/src/promotions';
import MerchantIcon from './MerchantIcon';
import '../styles/shop-floor.css';

export type FloorSelection = { kind: 'table'; tableId: string } | { kind: 'device'; deviceId: string } | null;
type Props = { merchantId: string; tables: Table[]; devices: Device[] } & (
  | { mode: 'arrange'; language?: 'en' | 'th'; editable: boolean; assign: (device: Device, tableId: string | null) => Promise<void> }
  | { mode: 'inspect'; language: 'en' | 'th'; selection: FloorSelection; onSelectionChange: (selection: FloorSelection) => void; promotionDevices: PromotionDevice[]; current: boolean; editable?: never; assign?: never }
);
type Point = { x: number; y: number };
type Node = Point & { key: string; label: string } & ({ device: Device; table?: never } | { table: Table; device?: never });
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export default function ShopFloor(props: Props) {
  const { merchantId, tables, devices } = props;
  const inspect = props.mode === 'inspect';
  const editable = props.mode === 'arrange' && props.editable;
  const text = (en: string, th: string) => props.language === 'th' ? th : en;
  const key = 'bitpos-floor-v1:' + merchantId;
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [selected, setSelected] = useState('');
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [list, setList] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ key: string; startX: number; startY: number; point: Point; rect: DOMRect } | null>(null);
  useEffect(() => {
    setPositions({});
    try {
      const raw = localStorage.getItem(key); if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
      const clean: Record<string, Point> = {};
      for (const [id, p] of Object.entries(parsed)) {
        const v = p as Point;
        if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) clean[id] = { x: clamp(v.x, 10, 90), y: clamp(v.y, 20, 85) };
      }
      setPositions(clean);
    } catch { setError(text('Layout storage unavailable. Positions will not be saved.', 'อ่านผังในเบราว์เซอร์ไม่ได้')); }
  }, [key]);
  const activeTables = tables.filter(t => !t.retiredAt), activeDevices = devices.filter(d => !d.revokedAt);
  // Default slots are three columns wide with a 125 px row pitch below the table rows; extra rows make the plan taller so screens never stack.
  const tableRows = Math.min(3, Math.ceil(activeTables.length / 3)), deviceTop = 290 + Math.max(0, tableRows - 2) * 88;
  const canvasHeight = Math.max(440, deviceTop + 70 + (Math.max(1, Math.ceil(activeDevices.length / 3)) - 1) * 125);
  const nodes: Node[] = [...activeTables.map((t, i) => ({ key: 't:' + t.id, label: t.label, table: t, x: 26 + i % 3 * 27, y: (167 + Math.floor(i / 3) % 3 * 88) / canvasHeight * 100 })), ...activeDevices.map((d, i) => ({ key: 'd:' + d.id, label: d.label, device: d, x: 39 + i % 3 * 23, y: (deviceTop + Math.floor(i / 3) * 125) / canvasHeight * 100 }))].map(n => ({ ...n, ...positions[n.key] }));
  const selectedKey = props.mode === 'inspect' ? props.selection?.kind === 'table' ? 't:' + props.selection.tableId : props.selection?.kind === 'device' ? 'd:' + props.selection.deviceId : '' : selected;
  const node = nodes.find(n => n.key === selectedKey);
  function deviceStatus(d: Device) {
    if (props.mode !== 'inspect') return `${d.online ? text('Online', 'ออนไลน์') : text('Offline', 'ออฟไลน์')} · ${d.screen.kind === 'idle' ? text('Available', 'ว่าง') : text('In use', 'กำลังใช้งาน')}`;
    const actual = props.current ? props.promotionDevices.find(p => p.deviceId === d.id && p.tableId === d.tableId && p.assignmentGeneration === d.assignmentGeneration && p.authGeneration === d.authGeneration && p.screenGeneration === d.screen.screenGeneration && p.online === d.online) : undefined;
    if (!actual) return text('Status not current', 'สถานะไม่เป็นปัจจุบัน');
    return `${actual.online ? text('Online', 'ออนไลน์') : text('Offline · deferred', 'ออฟไลน์ · รอส่ง')} · ${!actual.capable ? text('Unsupported', 'ไม่รองรับ') : actual.busy ? text('Busy · deferred', 'กำลังใช้งาน · รอจอว่าง') : text('Available', 'ว่าง')}`;
  }
  function choose(n: Node) {
    if (props.mode === 'inspect') props.onSelectionChange(n.device ? { kind: 'device', deviceId: n.device.id } : { kind: 'table', tableId: n.table!.id });
    else { setSelected(n.key); setTarget(n.device?.tableId ?? ''); setError(''); }
  }
  function savePosition(id: string, p: Point) {
    if (props.mode !== 'arrange') return;
    setPositions(prior => { const next = { ...prior, [id]: p }; try { localStorage.setItem(key, JSON.stringify(next)); setSaved(true); } catch { setError(text('Position could not be saved in this browser.', 'บันทึกตำแหน่งในเบราว์เซอร์นี้ไม่ได้')); } return next; });
  }
  function pointerDown(e: React.PointerEvent<HTMLButtonElement>, n: Node) {
    if (props.mode !== 'arrange') return;
    choose(n); if (!editable || saving || !canvas.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { key: n.key, startX: e.clientX, startY: e.clientY, point: { x: n.x, y: n.y }, rect: canvas.current.getBoundingClientRect() };
  }
  function move(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current; if (!d) return;
    const p = { x: clamp(d.point.x + (e.clientX - d.startX) / d.rect.width * 100, 10, 90), y: clamp(d.point.y + (e.clientY - d.startY) / d.rect.height * 100, 20, 85) };
    setPositions(prior => ({ ...prior, [d.key]: p })); setSaved(false);
  }
  function finish(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current; if (!d) return; drag.current = null;
    const p = positions[d.key] ?? d.point; savePosition(d.key, p);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const n = nodes.find(n => n.key === d.key);
    if (n?.device) { const nearest = nodes.filter(n => n.table).find(n => Math.hypot(n.x - p.x, n.y - p.y) < 12); if (nearest?.table) setTarget(nearest.table.id); }
  }
  async function saveAssignment() {
    if (props.mode !== 'arrange' || !node?.device) return;
    setSaving(true); setError('');
    try { await props.assign(node.device, target || null); } catch (e) { setError(e instanceof Error ? e.message : text('Could not save assignment.', 'บันทึกการผูกอุปกรณ์ไม่ได้')); } finally { setSaving(false); }
  }
  function renderInspectionDevice(d: Device) {
    return <button key={d.id} type="button" className="floor-card-device" aria-label={text('Select device', 'เลือกเครื่อง') + ': ' + d.label} aria-pressed={selectedKey === 'd:' + d.id} onClick={() => props.mode === 'inspect' && props.onSelectionChange({ kind: 'device', deviceId: d.id })}>
      <span className="floor-card-art" aria-hidden="true"><span className="floor-clock"><span className="clock-screen"><span>BitPOS</span><i/></span></span><span className={`floor-dot ${d.online ? 'is-online' : ''}`}/></span>
      <span className="floor-card-copy"><strong>{d.label}</strong><small>{deviceStatus(d)}</small></span>
    </button>;
  }
  const selectLabel = (n: Node) => inspect ? `${n.device ? text('Select device', 'เลือกเครื่อง') : text('Select table', 'เลือกโต๊ะ')}: ${n.label}` : `${text('Move', 'ย้าย')} ${n.device ? 'POSClock' : text('table', 'โต๊ะ')}: ${n.label}`;
  return <div className={`shop-floor ${inspect ? 'floor-inspect' : ''}`}>
    <div className="floor-heading"><div><span className="floor-eyebrow">{text('YOUR CAFE, CONNECTED', 'ร้านของคุณ เชื่อมต่อแล้ว')}</span><h2>{inspect ? text('Promotions on your floor.', 'โปรโมชันบนผังร้าน') : text('Bring your space to life.', 'จัดพื้นที่ร้านให้พร้อมขาย')}</h2><p>{inspect ? text('Select to inspect. Selection never assigns or sends.', 'เลือกเพื่อตรวจสอบ ไม่ย้ายเครื่องหรือส่งอัตโนมัติ') : text('Move tables and POSClocks. Make every seat a point of sale.', 'ย้ายโต๊ะและ POSClock ในเบราว์เซอร์ แล้วเลือกจุดขายให้พร้อมรับออเดอร์')}</p></div>{props.mode !== 'arrange' && <div className="floor-stats"><span><b>{activeTables.length}</b>{text('tables', 'โต๊ะ')}</span><span><b>{activeDevices.filter(d => d.online).length}/{activeDevices.length}</b>{text('online', 'ออนไลน์')}</span></div>}</div>
    {(inspect || activeDevices.length > 6) && <div className="floor-view-toggle" role="group" aria-label={text('Floor view', 'มุมมองผัง')}><button className="secondary" aria-pressed={!list} onClick={() => setList(false)}>{text('Floor plan', 'ผังร้าน')}</button><button className="secondary" aria-pressed={list} onClick={() => setList(true)}>{text('Accessible list', 'รายการ')}</button></div>}
    <div className="floor-layout">{list ? <div className="floor-entity-list">{nodes.map(n => <button key={n.key} className="secondary" aria-label={selectLabel(n)} aria-pressed={selectedKey === n.key} onClick={() => choose(n)}><strong>{n.label}</strong><small>{n.device ? `${deviceStatus(n.device)} · ${n.device.tableLabel ?? text('Counter', 'เคาน์เตอร์')}` : `${props.mode === 'inspect' && !props.current ? text('Status not current', 'สถานะไม่เป็นปัจจุบัน') : n.table!.occupancy.active ? text('In use', 'มีผู้ใช้') : text('Available', 'ว่าง')} · ${activeDevices.filter(d => d.tableId === n.table!.id).map(d => d.label).join(', ') || text('No assigned screens', 'ไม่มีจอที่ผูก')}`}</small></button>)}</div> : <div className="floor-scroll"><div className={`floor-canvas ${inspect ? "floor-canvas-inspect" : ""}`} ref={canvas} style={inspect ? undefined : { height: canvasHeight }} aria-label={text('Interactive cafe floor plan', 'ผังร้าน')}><div className="floor-window">W I N D O W</div><div className="floor-counter"><MerchantIcon name="cart"/><span>COFFEE BAR</span><i/><i/><i/></div><div className="floor-plant plant-a"><i/><i/><i/></div><div className="floor-plant plant-b"><i/><i/><i/></div><span className="floor-door">ENTRANCE</span>
      {!inspect && <svg className="floor-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{nodes.filter(n => n.device?.tableId).map(n => { const t = nodes.find(t => t.table?.id === n.device?.tableId); return t ? <line key={n.key} x1={n.x} y1={n.y} x2={t.x} y2={t.y}/> : null; })}</svg>}
      {inspect && <div className="floor-table-cards">{activeTables.map(t => <section className="floor-table-card" key={t.id}>
        <button type="button" className="floor-card-table" aria-label={text('Select table', 'เลือกโต๊ะ') + ': ' + t.label} aria-pressed={selectedKey === 't:' + t.id} onClick={() => props.mode === 'inspect' && props.onSelectionChange({ kind: 'table', tableId: t.id })}><span className="floor-card-number" aria-hidden="true">{activeTables.findIndex(table => table.id === t.id) + 1}</span><span><strong>{t.label}</strong><small>{props.mode === 'inspect' && !props.current ? text('Status not current', 'สถานะไม่เป็นปัจจุบัน') : t.occupancy.active ? text('In use', 'มีผู้ใช้') : text('Available', 'ว่าง')}</small></span></button>
        {activeDevices.filter(d => d.tableId === t.id).map(d => renderInspectionDevice(d))}
        {!activeDevices.some(d => d.tableId === t.id) && <p className="floor-card-empty">{text('No assigned screens', 'ไม่มีจอที่ผูก')}</p>}
      </section>)}{activeDevices.filter(d => !activeTables.some(t => t.id === d.tableId)).map(d => <section className="floor-table-card" key={d.id}><p className="floor-card-counter">{text('Counter / unassigned', 'เคาน์เตอร์ / ยังไม่ผูกโต๊ะ')}</p>{renderInspectionDevice(d)}</section>)}</div>}
      {!inspect && nodes.map(n => <button key={n.key} type="button" className={`floor-node ${n.device ? 'floor-device' : 'floor-table'} ${selectedKey === n.key ? 'is-selected' : ''}`} style={{ left: n.x + '%', top: n.y + '%' }} aria-label={selectLabel(n)} aria-pressed={selectedKey === n.key} onPointerDown={e => pointerDown(e, n)} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { const d = drag.current; drag.current = null; if (d) setPositions(prior => ({ ...prior, [d.key]: d.point })); }} onClick={e => { if (inspect || e.detail === 0) choose(n); }} onKeyDown={e => { if (editable && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); savePosition(n.key, { x: clamp(n.x + (e.key === 'ArrowRight' ? 2 : e.key === 'ArrowLeft' ? -2 : 0), 10, 90), y: clamp(n.y + (e.key === 'ArrowDown' ? 2 : e.key === 'ArrowUp' ? -2 : 0), 20, 85) }); } }}>
        {n.device ? <><span className="floor-clock"><span className="clock-screen"><span>BitPOS</span><i/><small>{n.device.online ? text('ONLINE', 'ออนไลน์') : text('OFFLINE', 'ออฟไลน์')}</small></span></span><span className={`floor-dot ${n.device.online ? 'is-online' : ''}`}/></> : <span className="floor-table-art"><i/><i/><i/><i/><span>{activeTables.findIndex(t => t.id === n.table?.id) + 1}</span></span>}<strong>{n.label}</strong><small>{n.device ? deviceStatus(n.device) : null}</small>
      </button>)}{!nodes.length && <div className="floor-empty">{text('Your cafe starts here.', 'เริ่มต้นร้านของคุณ')}<small>{text('Add a table or POSClock in Settings.', 'เพิ่มโต๊ะหรือเครื่องในการตั้งค่า')}</small></div>}
    </div></div>}
    {props.mode === 'arrange' && <aside className="floor-inspector"><span className="floor-eyebrow">{node ? text('SELECTED', 'รายการที่เลือก') : text('FLOOR PLAN', 'ผังร้าน')}</span><h3>{node?.device ? 'POSClock' : node?.table ? text('Table', 'โต๊ะ') : text('A place for every connection.', 'ทุกจุดเชื่อมต่อในร้านเดียวกัน')}</h3><p>{node?.label ?? text('Select a table or device to see its details.', 'เลือกโต๊ะหรืออุปกรณ์เพื่อดูรายละเอียด')}</p>{node?.device && <><span className={`floor-status ${node.device.online ? 'is-online' : ''}`}>{deviceStatus(node.device)}</span><label>{text('Serving table', 'โต๊ะที่ให้บริการ')}<select value={target} disabled={!editable || saving} onChange={e => setTarget(e.target.value)}><option value="">{text('Counter / unassigned', 'เคาน์เตอร์ / ยังไม่ผูกโต๊ะ')}</option>{activeTables.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>{editable && <button disabled={saving || target === (node.device.tableId ?? '')} onClick={() => void saveAssignment()}><MerchantIcon name="save"/>{saving ? text('Saving…', 'กำลังบันทึก…') : text('Save assignment', 'บันทึกการผูก')}</button>}</>}<div className="floor-help"><MerchantIcon name="menu"/><p>{editable ? text('Drag to arrange. Arrow keys also work.', 'ลากเพื่อจัดผัง หรือใช้ปุ่มลูกศรได้') : text('View your cafe layout.', 'ดูผังร้านของคุณ')}<small>{saved ? text('Position saved in this browser.', 'บันทึกตำแหน่งในเบราว์เซอร์นี้แล้ว') : text('Layout positions are saved in this browser.', 'ตำแหน่งผังบันทึกในเบราว์เซอร์นี้')} {text('Table assignments are shared with your team.', 'การผูกโต๊ะแชร์กับทีมของคุณ')}</small></p></div></aside>}
    </div>{error && <p role="alert" className="error">{error}</p>}
  </div>;
}
