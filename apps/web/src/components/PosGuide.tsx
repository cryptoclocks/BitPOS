import React, { useEffect, useRef, useState } from 'react';
import MerchantIcon from './MerchantIcon';
import '../styles/pos-guide.css';

export type WorkspacePage = 'menu' | 'cart' | 'incoming' | 'promotions' | 'customers' | 'settings';
export default function PosGuide({ language, page, role, onClose, onNavigate }: { language: 'en' | 'th'; page: WorkspacePage; role?: string; onClose: () => void; onNavigate: (page: WorkspacePage) => void }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [topic, setTopic] = useState<WorkspacePage>(page);
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    element?.showModal(); document.body.style.overflow = 'hidden'; close.current?.focus();
    return () => { element?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  const topics: { id: WorkspacePage; icon: 'menu' | 'cart' | 'receipt' | 'edit' | 'staff' | 'settings'; title: string; steps: [string, string][]; note: string }[] = [
    { id: 'menu', icon: 'menu', title: text('รับออเดอร์', 'Take an order'), steps: [
      [text('เลือกจุดขาย', 'Choose a register'), text('เลือกจุดขายด้านบน และตรวจว่า BitPOS Mini ออนไลน์และว่าง', 'Select a register at the top. Its BitPOS Mini should be online and available.')],
      [text('เลือกเมนูและจำนวน', 'Add items'), text('ค้นหาหรือเลือกหมวดเมนู แตะสินค้า แล้วปรับจำนวนในตะกร้า', 'Search or filter the menu, tap an item and adjust quantities in the cart.')],
      [text('ตรวจรายการ', 'Review the cart'), text('เลือกโต๊ะ เคาน์เตอร์ หรือกลับบ้าน แล้วกดตรวจรายการก่อนชำระ', 'Choose a table, counter or takeaway, then review before checkout.')]],
      note: text('ลูกค้าสั่งเองได้ด้วยการสแกน QR ของโต๊ะบน BitPOS Mini', 'Customers can also scan the table QR on BitPOS Mini to order on their phone.') },
    { id: 'cart', icon: 'cart', title: text('รับชำระ', 'Take payment'), steps: [
      [text('ตรวจสินค้าและโต๊ะ', 'Check items and table'), text('ตรวจจำนวน ยอดรวม และเครื่องปลายทางก่อนสร้างบิล', 'Check quantities, total and destination screen before creating the bill.')],
      [text('ให้ลูกค้าสแกนจ่าย', 'Let the customer pay'), text('ลูกค้าเปิดหน้าชำระจาก QR ตรวจยอด แล้วอนุมัติในกระเป๋า', 'The customer scans the payment QR, checks the amount and approves in their wallet.')],
      [text('รอสถานะชำระแล้ว', 'Wait for Paid'), text('เมื่อระบบยืนยันแล้ว จึงกดเสร็จสิ้นเพื่อปิดหน้าบิล', 'Once payment is verified, use Done to dismiss the receipt.')]],
      note: text('ยืนยันในกระเป๋าไม่เท่ากับชำระแล้ว หากกำลังยืนยันให้รอ ไม่สร้างบิลซ้ำ', 'Wallet approval is not Paid. While confirming, wait and avoid creating another bill.') },
    { id: 'incoming', icon: 'receipt', title: text('ทำและเรียกรับ', 'Prepare & call for pickup'), steps: [
      [text('เลือกออเดอร์', 'Choose an order'), text('ค้นหาจากโต๊ะหรือเลขออเดอร์ ตรวจรายการและสถานะชำระ', 'Find the table or order number and check the items and payment status.')],
      [text('เริ่มทำ → ทำเสร็จแล้ว', 'Start preparing → Ready'), text('เมื่อเตรียมเสร็จ กดทำเสร็จแล้ว · เรียกรับ เพื่อแจ้งจอของออเดอร์นั้น', 'When ready, tap Ready · call for pickup to notify that order’s screen.')],
      [text('ส่งมอบสินค้า', 'Hand over the order'), text('กดรับสินค้าแล้วเมื่อส่งมอบจริง ลูกค้ากดรับทราบยังไม่ใช่การรับสินค้า', 'Mark collected after handover. A guest acknowledgment does not mean the order was collected.')]],
      note: text('ถ้าจอกำลังใช้งาน การแจ้งจะรอจอว่าง ตรวจสถานะการแจ้งในรายละเอียดออเดอร์', 'If the screen is busy, the notice waits. Check delivery status in the order details.') },
    { id: 'promotions', icon: 'edit', title: text('สร้างโปรโมชัน', 'Create a promotion'), steps: [
      [text('เลือกกลุ่มและสินค้า', 'Choose audience and products'), text('ประจำวันสำหรับร้าน ลูกค้าสำหรับคนที่เลือก หรือจากออเดอร์สำหรับการเสนอครั้งถัดไป', 'Choose Daily for the shop, Customer for a selected guest, or From order for a follow-up offer.')],
      [text('ให้ AI ร่าง แล้วตรวจ', 'Generate and review'), text('กำหนดสินค้า ส่วนลด และเวลา ตรวจข้อความ ราคา และภาพก่อนอนุมัติ', 'Set products, discount and time. Review the draft, price and preview before approval.')],
      [text('เลือกจอและยืนยันส่ง', 'Choose screens and confirm'), text('ตรวจเครื่องปลายทางก่อนกดยืนยัน เลือกเครื่องบนผังอย่างเดียวจะยังไม่ส่ง', 'Check the destination screens before confirming. Selecting a screen on the floor plan does not send anything.')]],
      note: text('เมื่อลูกค้าออกจากโต๊ะ ใช้เคลียร์โต๊ะเพื่อล้างข้อเสนอส่วนตัวและเริ่มรอบใหม่', 'When guests leave, use Clear table to end the visit and remove personal offers.') },
    { id: 'customers', icon:'staff',title:text('จัดการลูกค้า','Manage customers'),steps:[[text('เลือกโปรไฟล์','Choose a profile'),text('ค้นหาชื่อเล่นหรือ wallet แล้วเลือกแถวลูกค้า','Search by nickname or wallet and choose a customer row.')],[text('แก้ไขข้อมูล','Edit details'),text('ตั้งชื่อเล่นและเพิ่มข้อมูลติดต่อเมื่อจำเป็น','Set a nickname and add optional contact details.')],[text('บันทึก','Save'),text('ชื่อใหม่จะใช้ในรายการลูกค้าและหน้าโปรโมชัน','The name appears in the customer directory and promotion picker.')]],note:text('การแก้ชื่อไม่เปลี่ยน wallet หรือบิลที่จ่ายแล้ว','Editing a name does not change wallets or saved bills.') },
    { id: 'settings', icon: 'settings', title: text('ตั้งค่าร้าน', 'Set up your shop'), steps: [
      [text('เพิ่มโต๊ะและเครื่อง', 'Add tables and screens'), text('ในผังร้านและอุปกรณ์ เพิ่มโต๊ะและ BitPOS Mini แล้วผูกเครื่องกับโต๊ะ', 'In Floor & devices, add tables and BitPOS Mini screens, then assign screens to tables.')],
      [text('จับคู่จุดขาย', 'Pair a register'), text('เลือกหนึ่งเครื่องให้แต่ละจุดขาย แล้วบันทึกการเชื่อมต่อ', 'Choose one screen for each register and save the connection.')],
      [text('ตรวจราคาและกระเป๋าร้าน', 'Check prices and wallet'), text('เจ้าของร้านตั้งราคาเมนูและตรวจกระเป๋ารับชำระจากหมวดที่แยกไว้', 'The owner can set menu prices and view the receiving wallet in their separate sections.')]],
      note: text('การเปลี่ยนการผูกหรือราคาใช้กับออเดอร์ใหม่ บิลเดิมยังใช้ข้อมูลเดิม', 'Assignment and price changes apply to new orders. Existing bills retain their original details.') },
  ];
  const current = topics.find(t => t.id === topic)!;
  const labels: Record<WorkspacePage, string> = { menu: text('ออเดอร์', 'Orders'), cart: text('ชำระเงิน', 'Payment'), incoming: text('เรียกรับ', 'Pickup'), promotions: text('โปรโมชัน', 'Offers'), customers:text('ลูกค้า','Customers'), settings: text('ตั้งค่า', 'Setup') };
  return <dialog className="pos-guide" ref={dialog} aria-labelledby="pos-guide-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="pos-guide-heading"><div><span>{text('คู่มือสำหรับคนขาย', 'Merchant quick guide')}</span><h2 id="pos-guide-title">{text('ใช้งาน BitPOS', 'Using BitPOS')}</h2></div><button ref={close} type="button" className="secondary" aria-label={text('ปิดคู่มือ', 'Close guide')} onClick={onClose}><MerchantIcon name="close"/></button></div>
    <nav className="pos-guide-topics" aria-label={text('หัวข้อคู่มือ', 'Guide topics')}>{topics.map(t => <button type="button" key={t.id} aria-pressed={topic === t.id} onClick={() => setTopic(t.id)}><MerchantIcon name={t.icon}/>{labels[t.id]}</button>)}</nav>
    <div className="pos-guide-body"><h3>{current.title}</h3><ol>{current.steps.map(([title, description], i) => <li key={title}><span aria-hidden="true">{i + 1}</span><div><strong>{title}</strong><p>{description}</p></div></li>)}</ol><p className="pos-guide-note">{current.note}</p>
      {role === 'staff' && ['settings', 'promotions'].includes(topic) && <p className="pos-guide-note">{text('บางคำสั่งต้องให้เจ้าของร้านหรือผู้จัดการดำเนินการ ตามสิทธิ์ของบัญชี', 'Some actions require an owner or manager, depending on account permissions.')}</p>}
      <details><summary>{text('ปุ่มกดไม่ได้ หรือจอไม่ขึ้น?', 'Button disabled or screen not updating?')}</summary><p>{text('ตรวจจุดขายที่เลือก เครื่องออนไลน์ และบิลที่ยังค้าง จากนั้นรีเฟรชสถานะ หากกำลังยืนยันการจ่าย อย่าสั่งจ่ายซ้ำ', 'Check the selected register, screen connection and any active bill, then refresh status. Do not pay again while confirmation is pending.')}</p></details>
      {role && <button type="button" className="pos-guide-open" onClick={() => { onClose(); onNavigate(topic); }}>{text('ไปหน้านี้', 'Open this page')}<MerchantIcon name="arrow"/></button>}
    </div>
  </dialog>;
}
