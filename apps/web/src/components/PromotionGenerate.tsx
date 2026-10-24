import BundlePriceEditor from './BundlePriceEditor';
import React, { useEffect, useState } from 'react';
import type { PromotionRecipientsView, SeatPromotionCustomer } from '../../../../packages/contracts/src/personal-promotions';
import type { PromotionGenerate as GenerateBody } from '../../../../packages/contracts/src/promotions';
import type { PromotionAudience } from '../../../../packages/contracts/src/promotion-context';
import type { Product } from '../lib/menu';
import { formatMoney, parsePrice, decimalAmount } from '../lib/money';

import { discountPreview } from '../lib/promotion-discount';
import {requestId} from '../lib/request-id';
import PromotionHelp from './PromotionHelp';
import CustomerPicker from './CustomerPicker';

export default function PromotionGenerate({ language, products, disabled, recipients, recipientsFresh, recipientsError, reloadRecipients, generate, seatCustomer,devices }: {
  devices:import('../../../../packages/contracts/src/promotions').PromotionDevice[]; language: 'th' | 'en'; products: Product[]; disabled: boolean;
  recipients?: PromotionRecipientsView; recipientsFresh: boolean; recipientsError: string;
  reloadRecipients: () => void; generate: (body: Omit<GenerateBody, 'idempotencyKey'>) => Promise<void>;
  seatCustomer:(body:SeatPromotionCustomer)=>Promise<{visitId:string}>;
}) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [deliveryScope,setDeliveryScope]=useState<'all'|'device'>('all'),[destinationId,setDestinationId]=useState('');
  const destinationDevice=devices.find(d=>d.deviceId===destinationId);
  const [audience, setAudience] = useState<PromotionAudience>('daily');
  const [customerId, setCustomerId] = useState('');
  const [tableId, setTableId] = useState('');
  const [visitId, setVisitId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [recipientConfirmed, setRecipientConfirmed] = useState(false);
  const [presenceConfirmed,setPresenceConfirmed]=useState(false);
  const [seating,setSeating]=useState(false);
  const [seatRequest,setSeatRequest]=useState<SeatPromotionCustomer>();
  const [bundleMode,setBundleMode]=useState(false),[bundleUnitMinor,setBundleUnitMinor]=useState(''),[bundleValid,setBundleValid]=useState(false);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [discountPercent, setDiscountPercent] = useState('15');
  const [discountPrice, setDiscountPrice] = useState('');
  const [discountError, setDiscountError] = useState('');
  const order = audience === 'from_order' ? recipients?.orders.find(item => item.id === orderId) : undefined;
  const table = recipients?.tables.find(item => item.id === (audience === 'from_order' ? order?.tableId : tableId));
  const guest = table?.guests.find(item => item.visitId === (audience === 'from_order' ? order?.recipientVisitId : visitId));
  const customer = recipients?.customers.find(item => item.id === customerId);

  const customerLabel=(item:PromotionRecipientsView['customers'][number])=>item.name ? item.name+(item.walletLabel&&!item.name.includes(item.walletLabel)?` · ${item.walletLabel}`:'') : item.walletLabel?`Wallet ${item.walletLabel}`:text('ลูกค้า','Customer')+` · #${item.id.slice(0,8)}`;
  const eligibleGuests=table?.guests.filter(item=>audience!=='customer'||!item.customerId||item.customerId===customerId)??[];
  useEffect(()=>{setPresenceConfirmed(false);setSeatRequest(undefined);},[customerId,tableId]);
  async function confirmSeating(){
    if(!customer||!table?.device||!presenceConfirmed||!recipientsFresh)return;
    setSeating(true);setError('');
    const body=seatRequest??{customerId:customer.id,tableId:table.id,expectedGeneration:table.generation,deviceId:table.device.id,assignmentGeneration:table.device.assignmentGeneration,authGeneration:table.device.authGeneration,requestId:requestId(),confirmPresent:true as const};setSeatRequest(body);
    try{const result=await seatCustomer(body);setVisitId(result.visitId);setRecipientConfirmed(false);setSeatRequest(undefined);setPresenceConfirmed(false);}
    catch{setError(text('ยังยืนยันไม่สำเร็จ กดตรวจคำขอเดิมหรือโหลดข้อมูลล่าสุด','Confirmation is incomplete. Check the saved request or refresh recipients.'));}
    finally{setSeating(false);}
  }
  const excluded = new Set(order?.items.map(item => item.productId) ?? []);
  const catalogPrice = products.find(product => product.basePrice)?.basePrice;
  const currency = catalogPrice?.currency;
  const supportedCurrency = currency === 'USD' || currency === 'USDG' ? currency : undefined;
  const allowed = (product: Product) => !!product.basePrice && product.basePrice.currency === currency && product.basePrice.decimals === catalogPrice?.decimals && product.available > 0 && !excluded.has(product.id);
  const selectedProducts = products.filter(product => productIds.includes(product.id) && allowed(product));
  const referenceProduct = selectedProducts.reduce<Product | undefined>((lowest, product) => !lowest || BigInt(product.basePrice!.amountMinor) < BigInt(lowest.basePrice!.amountMinor) ? product : lowest, undefined);
  const referencePrice = bundleMode&&selectedProducts.length===2?{...selectedProducts[0].basePrice!,amountMinor:String(selectedProducts.reduce((n,p)=>n+BigInt(p.basePrice!.amountMinor),0n))}:referenceProduct?.basePrice;
  useEffect(() => {
    if (!referencePrice) { setDiscountPrice(''); setDiscountError(''); return; }
    updatePercent(discountPercent);
  }, [referenceProduct?.id, referencePrice?.amountMinor, referencePrice?.currency]);
  function updatePercent(value: string) {
    setDiscountPercent(value); setDiscountError('');
    if (!referencePrice) { setDiscountPrice(''); return; }
    try { setDiscountPrice(decimalAmount(discountPreview(referencePrice, Number(value)).final)); }
    catch { setDiscountPrice(''); setDiscountError(text('กรอกส่วนลดที่ทำให้ราคาลดลงจริง 1–99%', 'Enter 1–99% that reduces the price.')); }
  }
  function updatePrice(value: string) {
    setDiscountPrice(value); setDiscountError('');
    if (!referencePrice || !supportedCurrency) return;
    try {
      const minor = parsePrice(value.trim(), supportedCurrency,referencePrice.decimals);
      for (let percent = 1; percent <= 99; percent++) {
        try { if (discountPreview(referencePrice, percent).final.amountMinor === minor) { setDiscountPercent(String(percent)); return; } } catch {}
      }
      throw Error();
    } catch { setDiscountPercent(''); setDiscountError(text('ราคานี้แปลงเป็นส่วนลดไม่ได้ กรุณาเลือกราคาอื่นหรือกรอก %', 'This price cannot be represented. Choose another price or enter %.')); }
  }
  const recipientFence = JSON.stringify([audience, customer?.id, table?.id, table?.generation, guest?.visitId, guest?.deviceId, guest?.recognition, guest?.customerId, order]);
  useEffect(() => { setRecipientConfirmed(false); }, [recipientFence, recipientsFresh]);
  const now = Date.now();
  const localTime = (time: number) => { const date = new Date(time); return new Date(time - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const recognition: Record<'guest' | 'staff_confirmed_profile' | 'verified_wallet', string> = { verified_wallet: text('wallet ที่เซิร์ฟเวอร์ยืนยัน', 'Server-verified wallet'), staff_confirmed_profile: text('โปรไฟล์ที่พนักงานจำได้ ไม่ใช่การยืนยัน wallet', 'Staff-recognized profile · not wallet verification'), guest: text('ผู้ร่วมโต๊ะแบบ guest', 'Guest at table') };
  const personalReady = recipientsFresh && !!table?.active && !!guest && (audience === 'customer' ? !!customer&&(!guest.customerId||guest.customerId===customer.id) : !!order && table.generation === order.occupancyGeneration && guest.deviceId === order.targetDeviceId);

  async function submit(form: HTMLFormElement) {
    setError('');
    try {
      const data = new FormData(form);
      if ((!bundleMode&&discountError)||!referencePrice||(!bundleMode&&!discountPrice)||(bundleMode&&(!bundleValid||selectedProducts.length!==2))) throw Error(discountError || text('เลือกสินค้าก่อนตั้งส่วนลด', 'Choose a product before setting a discount.')); 
      if (!supportedCurrency || !catalogPrice || (supportedCurrency==='USD'?![2,4].includes(catalogPrice.decimals):catalogPrice.decimals!==6)) throw Error(text('ต้องมีราคาสินค้าในหน่วยเงินที่รองรับก่อน', 'Configure supported catalog currency prices first.'));
      const selected = products.filter(product => productIds.includes(product.id) && allowed(product));
      if (selected.length!==(bundleMode?2:1)) throw Error(text('เลือกสินค้าที่มีราคาและสต็อก และไม่ซ้ำออเดอร์เดิม', 'Choose priced, in-stock products that are not in the original order.'));
      let minimumUnitMinor: string;
      try { minimumUnitMinor = bundleMode?'1':parsePrice(String(data.get('minimumPrice') ?? ''), supportedCurrency,catalogPrice.decimals); }
      catch { throw Error(text(`กรอกราคาต่ำสุดเป็นจำนวนบวกใน ${supportedCurrency} ทศนิยมไม่เกิน ${catalogPrice.decimals} ตำแหน่งและอยู่ในขอบเขตราคาที่รองรับ`, `Enter a positive ${supportedCurrency} floor with at most ${catalogPrice.decimals} decimal places within supported price limits.`)); }
      const goal = String(data.get('goal') ?? '').trim();
      if (!goal || goal.length > 500) throw Error(text('กรอกเป้าหมาย 1–500 ตัวอักษร', 'Enter a goal of 1–500 characters.'));
      const startsAt = new Date(String(data.get('startsAt'))).toISOString();
      const expiresAt = new Date(String(data.get('expiresAt'))).toISOString();
      if (Date.parse(expiresAt) <= Math.max(Date.now(), Date.parse(startsAt))) throw Error(text('กำหนดเวลาหมดอายุหลังเวลาเริ่มและเวลาปัจจุบัน', 'Expiry must follow the start and current time.'));
      const body: Omit<GenerateBody, 'idempotencyKey'> = { requestedDiscountPercent:bundleMode?1:Number(data.get('maxDiscountPercent')), language, audience, productIds: selected.map(product => product.id), goal, maxDiscountPercent: bundleMode?99:Number(data.get('maxDiscountPercent')), minimumUnitMinor, startsAt, expiresAt };
      if(bundleMode)body.bundle={unitMinor:bundleUnitMinor};
      if (Date.parse(expiresAt) - Date.parse(startsAt) > 7 * 86400000) throw Error(text('กำหนดระยะเวลาโปรโมชันไม่เกิน 7 วัน', 'Promotion duration must not exceed 7 days.'));
      if (selected.length > 50) throw Error(text('เลือกสินค้าไม่เกิน 50 รายการ', 'Choose at most 50 products.'));
      if (selected.some(product => BigInt(minimumUnitMinor) > BigInt(product.basePrice!.amountMinor))) throw Error(text('ราคาต่ำสุดต้องไม่เกินราคาสินค้าที่เลือก', 'The price floor must not exceed a selected product price.'));
      if (audience === 'daily') {
        if(deliveryScope==='device'){if(!destinationDevice?.tableId)throw Error(text('เลือกเครื่องที่ผูกกับโต๊ะก่อน','Choose a screen assigned to a table.'));body.destination={deviceId:destinationDevice.deviceId,tableId:destinationDevice.tableId,assignmentGeneration:destinationDevice.assignmentGeneration,authGeneration:destinationDevice.authGeneration};}
        const timezone = String(data.get('timezone')).trim();
        try { if (!timezone || timezone.length > 80) throw Error(); new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); }
        catch { throw Error(text('ตรวจเขตเวลาร้าน เช่น Asia/Bangkok', 'Check the shop timezone, for example Asia/Bangkok.')); }
        body.daily = { timezone, lookbackWeeks: Number(data.get('lookbackWeeks')) };
      }
      else {
        if (!personalReady || !recipientConfirmed || !table || !guest) throw Error(text('โหลดผู้รับล่าสุด เลือกและยืนยันความสัมพันธ์ก่อน', 'Refresh, select and explicitly confirm the recipient relationship first.'));
        body.personal = { tableId: table.id, occupancyGeneration: table.generation, recipientVisitId: guest.visitId, confirmRecipient: true, ...(audience === 'customer' && customer ? { customerId: customer.id } : {}), ...(audience === 'from_order' && order ? { sourceOrderId: order.id } : {}) };
      }
      await generate(body);
    } catch (failure) { setError(failure instanceof Error ? failure.message : text('ไม่สามารถสร้างคำขอได้', 'Unable to prepare the request.')); }
  }

  return <form className="promotion-generate-form" onSubmit={event => { event.preventDefault(); void submit(event.currentTarget); }}>
    {error && <p className="error" role="alert">{error}</p>}
    <fieldset disabled={disabled || seating}>
      <div className="promotion-mode" role="group" aria-label={text('ประเภทโปรโมชัน', 'Promotion audience')}>
        {(['daily', 'customer', 'from_order'] as const).map(mode => <button type="button" key={mode} className="secondary" aria-pressed={audience === mode} onClick={() => { setAudience(mode); if(mode!=='daily')setBundleMode(false); setRecipientConfirmed(false); setProductIds([]); setError(''); }}>{mode === 'daily' ? text('ประจำวัน', 'Daily') : mode === 'customer' ? text('เลือกลูกค้า', 'Customer') : text('จากออเดอร์', 'From order')}</button>)}
      </div>
      {audience === 'daily' ? <><div className="promotion-form-grid"><label>{text('ส่งไปที่','Destination')}<select value={deliveryScope} onChange={e=>setDeliveryScope(e.target.value as 'all'|'device')}><option value="all">{text('รายวัน · ทุกเครื่อง','Daily · all screens')}</option><option value="device">{text('เฉพาะเครื่อง','One screen')}</option></select></label>{deliveryScope==='device'&&<label>{text('เครื่องปลายทาง','Destination screen')}<select value={destinationId} required onChange={e=>setDestinationId(e.target.value)}><option value="">{text('เลือกเครื่อง','Select screen')}</option>{devices.filter(d=>d.tableId).map(d=><option key={d.deviceId} value={d.deviceId}>{d.tableLabel} · {d.label.replace(/^(?:BitPOSClock|POSClock).*?(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i,'BitPOS Mini')}</option>)}</select></label>}</div>
        <details className="promotion-advanced"><summary aria-label={text('ข้อมูลที่ AI ใช้', 'AI context')} title={text('ข้อมูลที่ AI ใช้', 'AI context')}>?</summary><p className="promotion-caption">{text('AI รับสถิติรวมจากบิล PAID ที่ตรวจสอบแล้วตามวันและช่วงเวลา พร้อมสต็อกเท่านั้น ไม่ส่งชื่อ wallet หรือข้อมูลติดต่อ ถ้าประวัติน้อยให้เน้นสต็อก ไม่ทำนายรายบุคคล', 'AI receives aggregate verified PAID sales by weekday/time and stock only. No names, wallets or contacts. Sparse history means stock-first, not personal prediction.')}</p>
        <div className="promotion-form-grid"><label>{text('เขตเวลาร้าน', 'Shop timezone')}<input name="timezone" defaultValue="Asia/Bangkok" maxLength={80} required /></label><label>{text('ย้อนหลัง (สัปดาห์)', 'Lookback (weeks)')}<input name="lookbackWeeks" type="number" min="4" max="8" step="1" defaultValue="6" required /></label></div></details>
      </> : <div className="promotion-recipient">
        <div className="toolbar"><PromotionHelp label={text('การเลือกลูกค้าและโต๊ะ','Choosing a customer and table')}><p>{text('เลือกโปรไฟล์และโต๊ะ แล้วให้พนักงานยืนยันว่าลูกค้าอยู่จริง ไม่ยืนยัน wallet หรือส่งโปรโมชันอัตโนมัติ','Choose a profile and table, then confirm the customer is present. Staff recognition does not authenticate a wallet or send a promotion.')}</p></PromotionHelp><button type="button" className="secondary" onClick={reloadRecipients}>{text('โหลดผู้รับล่าสุด', 'Refresh recipients')}</button></div>
        {recipientsError && <p className="error" role="alert">{recipientsError}</p>}
        {!recipientsFresh && <p className="notice">{text('ข้อมูลผู้รับยังไม่เป็นปัจจุบัน การสร้างเฉพาะบุคคลถูกปิด คำขอที่บันทึกเดิมยังอยู่', 'Recipients are not current. Personal generation is disabled; the saved action is retained.')}</p>}
        {audience === 'customer' ? <div className="promotion-form-grid">
          <CustomerPicker customers={recipients?.customers??[]} selectedId={customerId} onSelect={id=>{setCustomerId(id);setVisitId('');setRecipientConfirmed(false);}} language={language} disabled={disabled||seating}/>
          <label>{text('โต๊ะ', 'Table')}<select value={tableId} onChange={event => { setTableId(event.target.value); setVisitId(''); setRecipientConfirmed(false); }} required><option value="">{text('เลือกโต๊ะ', 'Select table')}</option>{recipients?.tables.map(item => <option key={item.id} value={item.id}>{item.label} · {item.active ? text('มีลูกค้า','In use') : text('ว่าง','Available')}</option>)}</select></label>
          <label>{text('ผู้รับจริงที่โต๊ะ', 'Actual recipient at table')}<select value={visitId} disabled={!eligibleGuests.length} onChange={event => { setVisitId(event.target.value); setRecipientConfirmed(false); }} required><option value="">{text('เลือกผู้รับ', 'Select recipient')}</option>{eligibleGuests.map(item => <option key={item.visitId} value={item.visitId}>{item.customerId===customerId&&customer ? customerLabel(customer) : text('ลูกค้า','Guest')+` #${item.visitId.slice(0,4)}`} · {recognition[item.recognition]}</option>)}</select></label>
        </div> : <>
          <label>{text('ออเดอร์ PAID ที่ยังอยู่ในรอบเดิม', 'Verified PAID order in its original open visit')}<select value={orderId} onChange={event => { setOrderId(event.target.value); setProductIds([]); setRecipientConfirmed(false); }} required><option value="">{text('เลือกออเดอร์เดิม', 'Select original order')}</option>{recipients?.orders.map(item => <option key={item.id} value={item.id}>#{item.id.slice(0, 8)} · {recipients.tables.find(entry => entry.id === item.tableId)?.label ?? item.tableId}</option>)}</select></label>
          {order && <p className="promotion-caption">{text('รายการเดิมที่ต้องไม่เสนอซ้ำ', 'Original items excluded from suggestions')}: {order.items.map(item => `${products.find(product => product.id === item.productId)?.[language === 'th' ? 'name' : 'nameEn'] ?? item.productId} × ${item.quantity}`).join(', ')}</p>}
        </>}
        {audience==='customer'&&customer&&table&&!guest&&<div className="promotion-seating">
          {!table.device?<p className="notice">{text('โต๊ะนี้ต้องผูกกับ Mini หนึ่งเครื่องก่อน','Assign exactly one Mini to this table first.')}</p>:<>
            <p>{customerLabel(customer)} · {table.label}</p>
            <label className="promotion-confirm"><input type="checkbox" checked={presenceConfirmed} onChange={event=>setPresenceConfirmed(event.target.checked)} />{text('ฉันยืนยันว่าลูกค้านี้อยู่โต๊ะนี้','I confirm this customer is at this table.')}</label>
            <button type="button" disabled={!presenceConfirmed||!recipientsFresh} onClick={()=>void confirmSeating()}>{seatRequest?text('ตรวจคำขอเดิม','Check saved confirmation'):text('ยืนยันลูกค้าที่โต๊ะ','Confirm customer at table')}</button>
          </>}
        </div>}
        {table && guest && <p className="promotion-caption">{table.label} · {text('รอบ', 'generation')} {table.generation} · {text('ผู้รับ', 'recipient')} #{guest.visitId.slice(0, 8)} · {text('เครื่องต้นทาง', 'original device')} #{guest.deviceId.slice(0, 8)} · {recognition[guest.recognition]}</p>}
        <label className="promotion-confirm"><input type="checkbox" checked={recipientConfirmed} disabled={!personalReady} onChange={event => setRecipientConfirmed(event.target.checked)} />{audience === 'customer' ? text('ใช้ลูกค้าและโต๊ะที่เลือก','Use this customer and table') : text('ฉันยืนยันผู้รับ รอบโต๊ะ และเครื่องต้นทางของออเดอร์นี้ ห้ามย้ายเป้าหมายหรือเปลี่ยนบิลเดิม', 'I confirm this order’s original recipient, table visit and device. No retargeting or original bill changes.')}</label>
      </div>}
      {audience==='daily'&&<div className="promotion-mode" role="group" aria-label={text('ประเภทสินค้า','Offer type')}><button type="button" className="secondary" aria-pressed={!bundleMode} onClick={()=>{setBundleMode(false);setProductIds([]);}}>{text('สินค้าเดี่ยว','Single item')}</button><button type="button" className="secondary" aria-pressed={bundleMode} onClick={()=>{setBundleMode(true);setProductIds([]);setBundleValid(false);}}>{text('ชุดคู่','Pair bundle')}</button></div>}<p><strong>{bundleMode?text('เลือกสินค้า 2 รายการ · อย่างละ 1','Choose two products · one each'):text('เลือกสินค้า 1 รายการ','Choose one product')}</strong></p>
      <div className="promotion-products">{products.map(product => <label key={product.id}><input type={bundleMode?'checkbox':'radio'} name="productIds" value={product.id} checked={productIds.includes(product.id) && allowed(product)} disabled={!allowed(product)||(bundleMode&&productIds.length===2&&!productIds.includes(product.id))} onChange={event => setProductIds(bundleMode?(event.target.checked?[...productIds,product.id]:productIds.filter(id=>id!==product.id)):[product.id])} />{product.imageUrl && <img src={product.imageUrl} alt="" width="56" height="44" loading="lazy" />}<span>{language === 'th' ? product.name : product.nameEn}<small>{product.basePrice ? formatMoney(product.basePrice) : text('ยังไม่มีราคา', 'No price')} · {product.available} {text('คงเหลือ', 'in stock')}{excluded.has(product.id) && ` · ${text('อยู่ในออเดอร์เดิม', 'In original order')}`}</small></span></label>)}</div>
      <label>{text('อยากให้ AI ช่วยเสนออะไร?', 'What should AI suggest?')}<textarea name="goal" required maxLength={500} placeholder={text('เช่น ลดสินค้าคงเหลือก่อนปิดร้าน ไม่ใส่ชื่อหรือข้อมูลติดต่อ', 'For example, sell remaining stock before closing. Do not enter names or contacts.')} /></label>
      <div className="promotion-form-grid">
        {bundleMode?referencePrice&&selectedProducts.length===2?<BundlePriceEditor key={productIds.join(',')} base={referencePrice} value={bundleUnitMinor||String(BigInt(referencePrice.amountMinor)*85n/100n)} language={language} onChange={(minor,valid)=>{setBundleUnitMinor(minor);setBundleValid(valid);}}/>:null:<><label>{text('ส่วนลด (%)', 'Discount (%)')}<input name="maxDiscountPercent" type="number" min="1" max="99" step="1" value={discountPercent} onChange={event => updatePercent(event.target.value)} disabled={!referencePrice} required /></label>
        <label>{text('ราคาหลังลด', 'After-discount price')} {supportedCurrency ?? ''}<input name="minimumPrice" type="text" inputMode="decimal" value={discountPrice} onChange={event => updatePrice(event.target.value)} disabled={!referencePrice} required /></label>
        <div className="promotion-linked-price-note">{referenceProduct && <small>{text('ราคาเดิม', 'Original price')}: {formatMoney(referencePrice!)} · {language === 'th' ? referenceProduct.name : referenceProduct.nameEn}{selectedProducts.some(product => product.basePrice!.amountMinor !== referencePrice!.amountMinor) && text(' · คำนวณจากสินค้าราคาต่ำสุด', ' · based on the lowest-priced selected product')}</small>}<small>{text('AI ใช้ส่วนลดตามที่เลือก', 'AI uses the selected discount.')}</small>{discountError && <p className="error" role="alert">{discountError}</p>}</div>
        </>}<label>{text('เริ่มเมื่อ', 'Starts at')}<input name="startsAt" type="datetime-local" defaultValue={localTime(now)} required /></label>
        <label>{text('หมดอายุเมื่อ', 'Expires at')}<input name="expiresAt" type="datetime-local" defaultValue={localTime(now + 3600000)} required /></label>
      </div>
      <button disabled={!supportedCurrency || !productIds.length || !!discountError || !discountPrice || (audience !== 'daily' && (!personalReady || !recipientConfirmed))}>{text('สร้างแบบร่างด้วย AI', 'Create AI draft')}</button>
    </fieldset>
  </form>;
}
