import React, { useState } from 'react';
import type { PromotionCampaign, PromotionDevice } from '../../../../packages/contracts/src/promotions';
import type { PlaylistDeliveryState } from '../../../../packages/contracts/src/daily-promotions';
import PromotionHelp from './PromotionHelp';
import { formatMoney } from '../lib/money';
import type { Product } from '../lib/menu';

export function PromotionContextReview({ campaign, language, products }: { campaign: PromotionCampaign; language: 'th' | 'en'; products: Product[] }) {
  const scope = campaign.scope;
  if (!scope) return <p className="notice">{language === 'th' ? 'แคมเปญเดิมก่อนมีประเภทผู้รับ แสดงประวัติเท่านั้น ไม่เปลี่ยนหรือส่งใหม่' : 'Historical campaign without audience scope. Read-only history; no edits or republication.'}</p>;
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const context = scope.context;
  const weekdays = language === 'th' ? ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'] : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const windows: Record<string, string> = language === 'th' ? { morning: 'เช้า', afternoon: 'บ่าย', evening: 'เย็น', night: 'กลางคืน' } : { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };
  return <div className="promotion-context">
    <p><strong>{scope.audience !== 'daily' ? scope.audience === 'customer' ? text('ลูกค้าที่พนักงานเลือก · เฉพาะผู้รับเดิม', 'Staff-selected customer · original recipient only') : text('เสนอเพิ่มจากออเดอร์เดิม · เฉพาะผู้รับเดิม', 'Add-on from original order · original recipient only') : scope.placement?.kind === 'table' ? text('ส่วนลดเฉพาะโต๊ะ · ไม่ใช่ข้อเสนอส่วนตัว', 'Table-only discount · not a personal offer') : scope.placement?.kind === 'campaign_devices' ? text('ทุกเครื่องเดิมของแคมเปญ', 'All original campaign devices') : text('ประจำวัน · ทุกเครื่องที่เปิดใช้', 'Daily · all enabled screens')}</strong> · {text('ราคาต่ำสุดต่อชิ้น', 'Minimum unit price')}: {formatMoney({ ...campaign.basePrice, amountMinor: scope.minimumUnitMinor })} · {text('เพดานส่วนลด', 'Discount cap')}: {campaign.maxDiscountPercent}%</p>
    {scope.placement && <p className="promotion-caption">{text('ต้นทาง', 'Source')}: #{scope.placement.sourceCampaignId} v{scope.placement.sourceVersion} · {scope.origin} · {scope.placement.deviceIds.length} {text('เครื่อง', 'screens')}{scope.placement.tableId && ` · ${text('โต๊ะต้นทาง', 'Original table')}: ${scope.placement.tableId}`} · {scope.priceAuthority === 'personal' ? text('ราคาส่วนตัวเฉพาะผู้รับเดิม ไม่ใช่สิทธิ์ทั้งโต๊ะ', 'Private original-recipient price, not a table-wide offer') : scope.priceAuthority === 'table' ? text('สิทธิ์ส่วนลดเฉพาะโต๊ะ ไม่เผยเป็นราคาสาธารณะ', 'Table-only discount authority, not a public menu price') : text('ราคาสาธารณะ', 'Public price authority')}{scope.pricePresentation === 'inherited_source' && ` · ${text('รูปแบบราคาสืบทอดจากต้นทาง', 'Price presentation inherited from source')}`}</p>}
    {context.kind === 'daily' ? <>
      <p className={context.sparseHistory ? 'notice' : 'promotion-caption'}>{context.sparseHistory ? text('ประวัติน้อย: อิงสต็อกเป็นหลัก ไม่อ้างว่าทำนายความชอบหรือการกลับมาของบุคคล', 'Sparse history: stock-first, not a prediction of personal preferences or return visits.') : text('อิงยอดขาย PAID ที่ตรวจสอบแล้วและสต็อก', 'Based on verified PAID sales and stock')} · {text('บิลที่ตรวจสอบ', 'Verified orders')}: {context.verifiedPaidOrderCount}</p>
      <p className="promotion-caption">{context.timezone} · {context.lookbackWeeks} {text('สัปดาห์', 'weeks')} · {weekdays[context.weekday]} · {new Date(context.from).toLocaleDateString(language, { timeZone: context.timezone })} – {new Date(context.until).toLocaleDateString(language, { timeZone: context.timezone })} · {text('สถิติรวมเท่านั้น ไม่มีข้อมูลระบุตัวตนส่งให้ AI', 'Aggregates only; no identifying information sent to AI')}</p>
      <details><summary>{text('ตรวจสถิติวันและช่วงเวลา', 'Review weekday and time aggregates')} ({context.buckets.length})</summary><div className="promotion-aggregate-table"><table><thead><tr><th>{text('สินค้า', 'Product')}</th><th>{text('วัน / ช่วง', 'Day / time')}</th><th>{text('บิล / จำนวน', 'Orders / quantity')}</th></tr></thead><tbody>{context.buckets.map((bucket, index) => <tr key={`${bucket.productId}:${bucket.weekday}:${bucket.window}:${index}`}><td>{products.find(product => product.id === bucket.productId)?.[language === 'th' ? 'name' : 'nameEn'] ?? bucket.productId}</td><td>{weekdays[bucket.weekday]} · {windows[bucket.window]}</td><td>{bucket.orderCount} / {bucket.quantity}</td></tr>)}</tbody></table>{!context.buckets.length && <p>{text('ไม่มีประวัติ PAID ที่เพียงพอ ใช้สต็อกและสินค้าที่อนุญาต', 'No sufficient verified PAID history. Use stock and allowed products.')}</p>}</div></details>
    </> : <>
      <p className="promotion-caption">{context.historyBasis === 'staff_confirmed_profile' ? text('ประวัติโปรไฟล์ที่พนักงานยืนยัน ไม่ใช่การพิสูจน์เจ้าของ wallet', 'Staff-confirmed profile history · not wallet ownership proof') : context.historyBasis === 'verified_wallet_consent' ? text('ประวัติจาก wallet ที่เซิร์ฟเวอร์ยืนยันและตรวจความยินยอมแล้ว', 'Server-verified wallet history with checked consent') : text('อิงออเดอร์ปัจจุบันเท่านั้น ไม่แต่งความชอบ', 'Current order only · no invented preferences')} · {context.historyIncluded ? text('รวมประวัติที่มีสิทธิ์เข้าถึง', 'Eligible history included') : text('ไม่มีประวัติส่วนตัวเพิ่ม', 'No additional personal history')}</p>
      <details><summary>{text('ตรวจข้อมูลสินค้าที่ส่งให้ AI (ไม่มีตัวตน)', 'Review product-only AI context (no identity)')}</summary><ul>{context.items.map(item => <li key={item.productId}>{products.find(product => product.id === item.productId)?.[language === 'th' ? 'name' : 'nameEn'] ?? item.productId} × {item.quantity}{item.lastPurchasedDaysAgo !== null && ` · ${item.lastPurchasedDaysAgo} ${text('วันก่อน', 'days ago')}`}</li>)}</ul><p className="promotion-caption">{text('รายการในออเดอร์เดิม', 'Original order items')}: {context.currentOrderItems.map(item => `${products.find(product => product.id === item.productId)?.[language === 'th' ? 'name' : 'nameEn'] ?? item.productId} × ${item.quantity}`).join(', ') || text('ไม่มี', 'None')}</p></details>
    </>}
  </div>;
}

export function PromotionPublication({ campaign, devices, language, disabled, publish }: {
  campaign: PromotionCampaign; devices: PromotionDevice[]; language: 'th' | 'en'; disabled: boolean;
  publish: (body: { expectedVersion: number; confirmTargets: true; targets: { deviceId: string; assignmentGeneration: string; authGeneration: string; screenGeneration: string }[] }) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<PromotionDevice[]>();
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const scope = campaign.scope;
  if (!scope) return null;
  const daily = scope.audience === 'daily';
  const binding = scope.binding;
  const boundDevice = binding ? devices.find(device => device.deviceId === binding.targetDeviceId && device.tableId === binding.tableId && device.assignmentGeneration === binding.assignmentGeneration && device.authGeneration === binding.authGeneration) : undefined;
  const placement = scope.placement;
  const tableOnly = daily && placement?.kind === 'table';
  const candidates = !daily ? boundDevice && (!placement || placement.deviceIds.includes(boundDevice.deviceId)) ? [boundDevice] : [] : placement ? devices.filter(device => placement.deviceIds.includes(device.deviceId) && (placement.kind !== 'table' || device.tableId === placement.tableId)) : devices;
  const complete = !placement || candidates.length === placement.deviceIds.length;
  // Screen fences are current idle fences. Assignment/auth remain the original binding.
  const fence = (items: PromotionDevice[]) => JSON.stringify(items.map(device => [device.deviceId, device.assignmentGeneration, device.authGeneration, device.screenGeneration, device.tableId, device.capable]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  const current = complete && !!snapshot?.length && fence(snapshot) === fence(candidates);
  const shown = snapshot ?? candidates;
  return <section className="panel" aria-label="Select screen and confirm">
    <h2>3 · {text('ยืนยันเครื่องปลายทาง', 'Confirm destination screens')}</h2>
    <p className="promotion-caption">{!daily ? text('ส่งเฉพาะจอของลูกค้าคนนี้', 'Send to this customer’s original screen only.') : tableOnly ? text('ส่งเฉพาะจอเดิมของโต๊ะนี้', 'Send to this table’s original screens only.') : placement ? text('ส่งไปยังจอเดิมของโปรโมชันนี้', 'Send to this campaign’s original screens.') : text('ส่งไปยังทุกเครื่องในรายการ', 'Send to every screen listed below.')}</p>
    {!daily && !boundDevice && <p className="error" role="status">{text('ไม่พบเครื่องต้นทางที่มีการผูกเดิม หรือข้อมูลผูกยังไม่พร้อม ส่งไม่ได้ ห้ามเลือกเครื่องอื่นแทน', 'Original bound device is unavailable or changed. Sending is disabled; do not substitute another screen.')}</p>}
    {!shown.length && <p className="notice">{text('ไม่มีเครื่องปลายทางที่ยืนยันได้', 'No destination screens available to confirm.')}</p>}
    {!complete && <p className="error" role="status">{text('เครื่องเดิมในขอบเขตหายไปหรือย้ายโต๊ะ ส่งไม่ได้ ห้ามแทนที่ด้วยเครื่องอื่น', 'An original scoped screen is missing or moved tables. Sending is disabled; no substitute screen is allowed.')}</p>}
    <ul className="promotion-device-list">{shown.map(device => {
      const latest = devices.find(item => item.deviceId === device.deviceId);
      const legacy = /^(?:BitPOSClock|POSClock|BitPOS Mini).*?(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(device.label);
      const tableLabel = device.tableLabel?.replace(/^Devnet demo table (\d+)$/i, language === 'th' ? 'โต๊ะ $1' : 'Table $1').replace(/^Table (\d+)$/i, language === 'th' ? 'โต๊ะ $1' : 'Table $1');
      const state = !latest ? 'missing' : !latest.capable ? 'unsupported' : !latest.online ? 'offline' : latest.busy ? 'busy' : 'ready';
      const stateLabel = state === 'missing' ? text('ข้อมูลเปลี่ยน', 'Changed') : state === 'unsupported' ? text('ไม่รองรับ', 'Unsupported') : state === 'offline' ? text('รอออนไลน์', 'Waiting online') : state === 'busy' ? text('รอจอว่าง', 'Waiting for screen') : text('พร้อมส่ง', 'Ready');
      return <li key={device.deviceId} className="promotion-destination">
        <div className="promotion-destination-row"><div><strong>{tableLabel ?? text('เคาน์เตอร์', 'Counter')}</strong><small>{legacy ? 'BitPOS Mini' : device.label}</small></div><span className="promotion-destination-status" data-state={state}>{stateLabel}</span></div>
        <details className="promotion-destination-details"><summary aria-label={text('รายละเอียดเครื่อง', 'Screen details')} title={text('รายละเอียดเครื่อง', 'Screen details')}>?</summary><small>{device.label}</small><small>{device.tableLabel ?? text('ไม่มีโต๊ะ', 'No table')}</small><small>{text('รหัสเครื่อง', 'Device ID')}: {device.deviceId}</small><small>{text('รุ่นผูก / ยืนยันเครื่อง / จอ', 'Assignment / auth / screen fences')}: {device.assignmentGeneration} / {device.authGeneration} / {device.screenGeneration}</small><small>{!latest ? text('เครื่องไม่อยู่ในรายการล่าสุด', 'Not in the current device list') : `${latest.online ? text('ออนไลน์', 'Online') : text('ออฟไลน์', 'Offline')} · ${latest.busy ? text('กำลังใช้งาน', 'Busy') : text('ว่าง', 'Available')} · ${latest.capable ? 'promotion_playlist_v1' : 'UNSUPPORTED'}`}</small></details>
      </li>;
    })}</ul>
    <PromotionHelp label={text('เกี่ยวกับคิวส่ง', 'About the send queue')}><p className="promotion-safety">{text('เครื่องที่ไม่พร้อมจะรอในคิว ส่วนเครื่องที่ไม่รองรับจะแสดงโปรโมชันไม่ได้', 'Unavailable screens wait in the queue. Unsupported screens cannot display this promotion.')}</p></PromotionHelp>
    {snapshot && !current && <p className="notice">{text('รายชื่อหรือรุ่นการผูกเปลี่ยน ยกเลิกเครื่องหมายแล้วตรวจรายการล่าสุดและยืนยันใหม่', 'Device list or fences changed. Uncheck, review the current list and confirm again.')}</p>}
    <label className="promotion-confirm"><input type="checkbox" checked={!!snapshot} disabled={disabled || !complete || (!snapshot && !candidates.length)} onChange={event => setSnapshot(event.target.checked ? candidates.map(device => ({ ...device })) : undefined)} />{tableOnly ? text('ยืนยันทุกเครื่องเดิมในขอบเขตโต๊ะนี้เท่านั้น', 'I confirm all original screens in this table-only scope.') : daily ? text('ยืนยันส่งทุกเครื่องในรายการ รวมเครื่องที่ยังไม่พร้อม', 'Confirm all listed screens, including those not ready.') : text('ฉันยืนยันส่งเวอร์ชันที่อนุมัติไปยังเครื่องต้นทางนี้เพียงเครื่องเดียว', 'I confirm sending the approved revision to this one original bound device.')}</label>
    <button disabled={disabled || !current} onClick={() => { if (snapshot && current) { const targets = snapshot.map(device => ({ deviceId: device.deviceId, assignmentGeneration: device.assignmentGeneration, authGeneration: device.authGeneration, screenGeneration: device.screenGeneration })); setSnapshot(undefined); void publish({ expectedVersion: campaign.version, confirmTargets: true, targets }); } }}>{tableOnly ? text('ยืนยันส่งเฉพาะโต๊ะนี้', 'Confirm & send to this table only') : daily ? text('ยืนยันส่งทุกเครื่องในรายการ', 'Confirm & send to all listed screens') : text('ยืนยันส่งเครื่องต้นทาง', 'Confirm & send to original screen')}</button>
  </section>;
}

export const playlistStatusLabels: Record<PlaylistDeliveryState, [string, string]> = {
  QUEUED: ['รอส่ง', 'Queued'], DEFERRED_BUSY: ['รอจอว่าง · การชำระเงินมาก่อน', 'Deferred · financial screen busy'], DEFERRED_OFFLINE: ['รอเครื่องออนไลน์', 'Deferred · offline'],
  DELIVERED: ['ส่งถึงเครื่อง ยังไม่ยืนยันแสดง', 'Delivered · not yet rendered'], RENDERED: ['เครื่องนี้ยืนยันแสดงแล้ว', 'This device confirmed rendering'],
  EXPIRED: ['หมดอายุ', 'Expired'], REVOKED: ['เพิกถอนแล้ว', 'Revoked'], TARGET_CHANGED: ['การผูกเป้าหมายเปลี่ยน', 'Target fences changed'], UNSUPPORTED: ['เครื่องไม่รองรับ playlist', 'Playlist unsupported'],
};
