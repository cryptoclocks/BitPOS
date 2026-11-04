// M13: short how-to topics for the merchant screens. Each statement describes what the product actually enforces (server rules), nothing aspirational.
export interface HelpTopic { id: string; title: [string, string]; points: [string, string][] }
export const helpTopics: HelpTopic[] = [
  { id: 'void', title: ['ยกเลิกบิล กับ คืนเงิน', 'Void vs refund'], points: [
    ['ยกเลิก (void) ทำได้เฉพาะออเดอร์หน้าร้าน/โต๊ะที่ยังไม่ชำระ และบิลเงินสด โดยผู้จัดการหรือเจ้าของ ต้องใส่เหตุผล', 'Void works only on unpaid counter/table orders and on cash sales, by a manager or owner, with a reason.'],
    ['ออเดอร์ที่ชำระแล้ว void ไม่ได้ เงินกลับผ่านขั้นตอนคืนเงิน/คืนสินค้าเท่านั้น', 'A paid order can never be voided; money goes back through the refund/return workflow only.'],
    ['ถ้ามีการชำระที่กำลังยืนยันอยู่ ระบบจะไม่ยอมให้ยกเลิก', 'If a payment is still being confirmed, the void is refused.'] ] },
  { id: 'cash', title: ['ลิ้นชักเงินสดและปิดรอบ', 'Cash drawer and closing the round'], points: [
    ['เงินสดที่ควรมี = เงินทอนตั้งต้น + ยอดขายเงินสด + เงินเข้า − เงินออก', 'Expected cash = opening float + cash sales + cash in − cash out.'],
    ['เงินเข้า/ออกต้องมีเหตุผล และแก้ไขย้อนหลังไม่ได้ ถ้าบันทึกผิดให้บันทึกรายการตรงข้าม', 'Cash in/out needs a reason and cannot be edited; fix a mistake with an opposite entry.'],
    ['ตอนปิดรอบ ใส่เงินที่นับได้ เซิร์ฟเวอร์คำนวณส่วนต่างให้เอง', 'When you close, enter the counted cash; the server works out the difference.'] ] },
  { id: 'stock', title: ['สต็อกและซัพพลายเออร์', 'Stock and suppliers'], points: [
    ['รับเข้า/ปรับสต็อกต้องมีเหตุผล และเลือกซัพพลายเออร์ได้เมื่อรับเข้า', 'Receive/adjust needs a reason; a receipt can name its supplier.'],
    ['ประวัติสต็อกแก้ไขไม่ได้ ใช้ตัวกรองประเภท/ซัพพลายเออร์เพื่อค้นหา', 'The stock history cannot be edited; filter it by type or supplier.'],
    ['ระบบไม่ขายเกินสต็อก แม้ออเดอร์หน้าร้าน เงินสด และการปรับสต็อกเกิดพร้อมกัน', 'The system does not oversell, even when an order, a cash sale and an adjustment hit the last unit together.'] ] },
  { id: 'reports', title: ['อ่านรายงานให้ตรงกัน', 'Reading the reports'], points: [
    ['ยอดขายนับตามวันที่ชำระเงินตามเวลาของร้าน บิลที่ยังไม่จ่าย ยกเลิก หรือหมดเวลา ไม่นับ และแสดงแยกไว้', 'Sales count by paid date in the shop’s time zone; unpaid, voided and expired bills are not counted and are listed apart.'],
    ['ยอดรวม แจกแจง รายการบิล และไฟล์ CSV มาจากชุดข้อมูลเดียวกัน แต่ละสกุลเงินแยกกัน ไม่บวกข้ามสกุล', 'Totals, breakdown, bill list and CSV come from the same data; each currency stays separate.'],
    ['แท็บ "เปรียบเทียบสาขา" อ่านอย่างเดียว เห็นเฉพาะร้านที่บัญชีนี้เป็นเจ้าของหรือผู้จัดการ', 'The Branches tab is read-only and shows only shops this account owns or manages.'] ] },
  { id: 'receipt', title: ['ใบเสร็จและการพิมพ์ซ้ำ', 'Receipts and reprints'], points: [
    ['ตั้งชื่อร้าน ข้อความท้ายบิล ภาษา และความกว้างกระดาษที่ ตั้งค่า › หน้าตาใบเสร็จ ค่านี้ไม่เปลี่ยนยอดเงินหรือรายการ', 'Set the shop name, footer, language and paper width in Settings › Receipt layout. It never changes amounts or lines.'],
    ['การพิมพ์ซ้ำจากประวัติบิลมีตรา "สำเนา" และถูกบันทึกว่าใครพิมพ์', 'A reprint from Bills is stamped as a copy and recorded with who printed it.'],
    ['ใบที่พิมพ์เป็น "ใบเสร็จรับเงิน" ไม่ใช่ใบกำกับภาษี', 'What prints is a receipt, not a tax invoice.'] ] },
  { id: 'team', title: ['พนักงาน สิทธิ์ และ PIN', 'Staff, roles and PINs'], points: [
    ['สิทธิ์ถูกบังคับที่เซิร์ฟเวอร์ ไม่ใช่แค่ซ่อนปุ่ม', 'Roles are enforced by the server, not just by hiding buttons.'],
    ['ตั้ง PIN ให้พนักงานเพื่อสลับผู้ใช้ที่เครื่องเดิม ใส่ PIN ผิดซ้ำจะถูกล็อกชั่วคราว', 'Give staff a PIN to switch user on a shared till; repeated wrong PINs lock it for a while.'],
    ['ปิดการใช้งานพนักงานแล้ว เซสชันของเขาจะถูกยกเลิกทันที', 'Disabling a staff member ends their sessions at once.'] ] },
  { id: 'audit', title: ['ประวัติการใช้งาน', 'Activity history'], points: [
    ['เหตุการณ์สำคัญถูกเซิร์ฟเวอร์บันทึกไว้ อ่านอย่างเดียว ไม่มีใครแก้หรือลบได้จากแอป', 'Key events are recorded by the server, read-only; nobody can edit or delete them from the app.'],
    ['กรองตามประเภท ผู้ทำรายการ และวันที่ แล้วดาวน์โหลด CSV ได้', 'Filter by kind, actor and date, and download a CSV.'] ] },
  { id: 'assistant', title: ['ผู้ช่วยวิเคราะห์ยอดขาย', 'Sales assistant'], points: [
    ['AI เลือกได้แค่รายงานที่ตายตัว 6 แบบ ตัวเลขทุกตัวมาจากเซิร์ฟเวอร์', 'The AI can only pick one of six fixed reports; every figure comes from the server.'],
    ['ถ้า AI ใช้ไม่ได้ ยังเลือกรายงานและช่วงเวลาเองได้', 'If the AI is unavailable you can still pick the report and period yourself.'] ] },
];
