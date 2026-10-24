import React from 'react';
import type { OrderView, Settlement } from '../../../../packages/contracts/src/index';
import { formatMoney, lineTotal } from '../lib/money';
import { denominationLabel, settlementLabel } from '../lib/payment-assets';
import ConfiguredBillLines,{ConfiguredBillBreakdown} from './ConfiguredBillLines';

export function SettlementTrust({ settlement,language='en' }: { settlement: Settlement;language?:'th'|'en' }) {
  const t=(th:string,en:string)=>language==='th'?th:en,policy=settlement.denominationPolicy;
  return <section className="notice trust" aria-label={t('ข้อมูลยืนยันสินทรัพย์ชำระ','Settlement trust')}><strong>{formatMoney(settlement)} · {settlementLabel(settlement)} · {t('โทเคนทดสอบ ไม่ใช่เงินที่แลกคืนได้','test tokens, not redeemable money')}</strong><p>{settlement.network} · {t('ร้านสนับสนุนค่าธรรมเนียมเครือข่าย โดยเครือข่ายยังมีค่าธรรมเนียม','Merchant-funded network fee sponsor (network fees still exist).')}</p><p>{language==='en'?denominationLabel(settlement):policy?`${policy.id} · หน่วยดิบ = หน่วยย่อยบิล × ${policy.numerator}/${policy.denominator} (อัตราหน่วยจำนวนเต็ม ไม่ใช่อัตราแลกเปลี่ยนตลาด)`:'อัตราหน่วยเดิมที่ตรึงไว้'}</p><dl>{settlement.assetId && <><dt>{t('รหัสสินทรัพย์','Asset ID')}</dt><dd className="mono">{settlement.assetId}</dd></>}<dt>{t('มินต์โทเคน','Mint')}</dt><dd className="mono">{settlement.mint}</dd><dt>{t('โปรแกรมโทเคน','Token program')}</dt><dd className="mono">{settlement.tokenProgram}</dd><dt>{t('แฮชเครือข่ายเริ่มต้น','Genesis')}</dt><dd className="mono">{settlement.genesisHash}</dd><dt>{t('ผู้รับชำระ','Recipient')}</dt><dd className="mono">{settlement.recipient}</dd></dl></section>;
}
export function FrozenRouting({ authority,language='en' }: { authority: OrderView['authority'];language?:'th'|'en' }) {
  const t=(th:string,en:string)=>language==='th'?th:en;
  return <dl className="routing"><dt>{t('จุดรับบริการ','Serving')}</dt><dd>{authority.serving.label}</dd><dt>{t('ช่องทางสั่ง','Source')}</dt><dd>{authority.source.kind === 'register' ? t('แท็บเล็ต / จุดขาย','Tablet / register') : authority.source.kind === 'device' ? t('อุปกรณ์โต๊ะ','Table device') : authority.source.kind === 'online' ? t('แอพลูกค้า','Customer app') : t('เคาน์เตอร์เดิม','Legacy counter')} · {authority.source.label}</dd><dt>{t('จอเป้าหมาย','Display target')}</dt><dd className="mono">{authority.kind === 'versioned' ? authority.target?.deviceId ?? t('ออนไลน์ — ไม่มีจอร้าน','Online — no store display') : authority.target.legacyTerminalId}</dd>{authority.kind === 'versioned' && authority.target && <><dt>{t('รุ่นการผูกที่ตรึงไว้','Frozen generations')}</dt><dd>{t('การมอบหมาย','Assignment')} {authority.target.assignmentGeneration} · {t('การจับคู่','Pairing')} {authority.pairingGeneration ?? t('อุปกรณ์อิสระ','Independent device')}</dd></>}</dl>;
}
function FrozenDelivery({order,language}:{order:OrderView;language:'en'|'th'}){
  const destination=order.delivery;if(!destination)return null;
  const text=(th:string,en:string)=>language==='th'?th:en;
  return <section className="delivery-summary" aria-label={text('ที่อยู่จัดส่งที่ยืนยันแล้ว','Frozen delivery address')}>
    <strong>{text('จัดส่งถึง','Deliver to')}: {destination.addressText}</strong>{destination.instructions&&<p>{destination.instructions}</p>}
    {destination.fixture&&<small className="delivery-fixture">{text('ข้อมูลทดสอบ · ที่อยู่และค่าธรรมเนียมจำลอง','FIXTURE · synthetic destination and fees')}</small>}
  </section>;
}
export default function OrderBill({ order, language = 'en', publicView = false, customer = false, children }: { order: OrderView; language?: 'en' | 'th'; publicView?: boolean; customer?: boolean; children?:React.ReactNode }) {
  if (customer) return <section aria-label="Your order">{order.configuredFood?<><ConfiguredBillLines snapshot={order.configuredFood} language={language} className="checkout-lines"/><ConfiguredBillBreakdown snapshot={order.configuredFood} language={language}/></>:<ul className="checkout-lines">{order.pricing.lines.map(line => <li key={line.productId}><span><span className="checkout-quantity">{line.qty} ×</span> {language === 'th' ? line.name : line.nameEn || line.name}</span><strong>{formatMoney(lineTotal(line))}</strong></li>)}</ul>}</section>;
  const text=(th:string,en:string)=>language==='th'?th:en;
  const status = order.closureReason === 'canceled' ? text('ยกเลิกแล้ว','Canceled') : ({
    AWAITING_WALLET:text('รอชำระ','Awaiting payment'),AWAITING_PAYMENT:text('รอชำระ','Awaiting payment'),
    CONFIRMING:text('กำลังยืนยันการชำระ','Confirming payment'),PAID:text('ชำระแล้ว','Paid'),
    EXPIRED:text('หมดเวลา','Expired'),RECOVERY:text('ต้องตรวจสอบ','Needs attention')
  } as Record<string,string>)[order.status] || text('ตรวจสอบสถานะ','Check status');
  const primary=<>
    <p className="bill-reference">#{order.id.slice(0,8)} · {order.authority.serving.label}</p>
    <div className="bill-status-row">{order.authority.source.kind==='online'&&<span className="bill-channel">{order.authority.serving.kind==='delivery'?text('แอพจัดส่ง','App delivery'):text('แอพรับเอง','App pickup')}</span>}<p className={`status ${order.status.toLowerCase()}`} role="status">{status}</p></div>
    <div className="bill-column-head" aria-hidden="true"><span>{text('รายการ','Item')}</span><span>{text('จำนวน','Quantity')}</span><span>{text('ยอด','Amount')}</span></div>
    {order.configuredFood?<><ConfiguredBillLines snapshot={order.configuredFood} language={language}/><ConfiguredBillBreakdown snapshot={order.configuredFood} language={language}/></>:<ul className="bill">{order.pricing.lines.map(line => <li key={line.productId}><span><span className="bill-inline-quantity">{line.qty} × </span>{language === 'th' ? line.name : line.nameEn || line.name}</span><span className="bill-column-quantity" hidden>{line.qty}</span><strong>{formatMoney(lineTotal(line))}</strong></li>)}</ul>}
    <div className="total"><span>{text('ยอดรวมบิล','Bill total')}</span><strong>{formatMoney(order.pricing.total)}</strong></div>
  </>;
  const amount=<div className="total settlement-total"><span>{order.status==='PAID'?text('ชำระแล้ว','Amount paid'):text('ยอดชำระ','Payment amount')}</span><strong>{formatMoney(order.settlement)}</strong></div>;
  const destination=!publicView&&<FrozenDelivery order={order} language={language}/>;
  const secondary=<>
    <p className="bill-network">{text('โทเคนทดสอบ Devnet','Devnet test tokens')} · {settlementLabel(order.settlement)} · {text('ร้านออกค่าธรรมเนียมเครือข่าย','Network fee covered by the store')}</p>
    {!publicView&&order.delivery&&<details className="bill-details"><summary>{text('ผู้รับและค่าจัดส่งที่ยืนยันแล้ว','Frozen recipient and delivery charges')}</summary>
      <p>{order.delivery.recipientName} · {order.delivery.phone}</p>
      <dl><dt>{text('ค่าจัดส่ง','Delivery fee')}</dt><dd>{formatMoney(order.delivery.deliveryFee)}</dd><dt>{text('ค่าบริการ','Service fee')}</dt><dd>{formatMoney(order.delivery.serviceFee)}</dd></dl>
      <p>{text('ที่อยู่และค่าธรรมเนียมยืนยันตั้งแต่ขอราคา การแก้สมุดที่อยู่ภายหลังไม่เปลี่ยนบิลนี้','Destination and fees were frozen with the quote. Later address-book edits do not change this bill.')}</p>
    </details>}
    <details className="bill-details"><summary>{text('รายละเอียดธุรกรรม','Payment details')}</summary>
      <p className="mono">{text('ออร์เดอร์','Order')}: {order.id}</p>
      {!order.configuredFood&&<ul className="bill">{order.pricing.lines.map(line=><li key={line.productId}><span>{language==='th'?line.name:line.nameEn||line.name}</span><span>{formatMoney(line.unitPrice)} {text('ต่อชิ้น','each')}</span></li>)}</ul>}
      {!publicView && <FrozenRouting authority={order.authority} language={language} />}
      <SettlementTrust settlement={order.settlement} language={language} />
    </details>
  </>;
  return <section aria-label="Order bill" className={children?'order-bill-workspace':undefined}>
    {children?<><div className="order-bill-primary">{primary}{destination}</div>{children}<div className="order-bill-secondary">{amount}{secondary}</div></>:<>{primary}{amount}{destination}{secondary}</>}
  </section>;
}
