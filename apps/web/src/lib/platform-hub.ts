export interface PlatformDestination {
  id: string;
  title: [th: string, en: string];
  href?: string; // absent = not connected; `needs` then says why
  duty?: [th: string, en: string]; // what a connected page is for
  needs?: [th: string, en: string];
}
// OP01-OP16 plus Reviews. A destination is linked only when a real page exists.
export const platformDestinations: PlatformDestination[] = [
  { id: 'OP01', title: ['คิวจัดส่ง', 'Dispatch queue'], href: '/platform/food-dispatch', duty: ['ติดตามงานจัดส่งที่ยังไม่สิ้นสุดและเสนอหรือมอบหมายงาน', 'Track open deliveries and offer or assign them'] },
  { id: 'OP02', title: ['แผนที่ไรเดอร์ที่ได้รับงาน', 'Assigned fleet map'], needs: ['ต้องมีผู้ให้บริการแผนที่และตำแหน่งสดที่ตรวจแล้ว', 'Needs a verified live-location and map provider'] },
  { id: 'OP03', title: ['เหตุระหว่างดูแลอาหาร', 'Custody incidents'], href: '/platform/food-incidents', duty: ['ตรวจเหตุระหว่างดูแลอาหารและการคืนของ', 'Review custody incidents and returns'] },
  { id: 'OP04', title: ['ตรวจสอบไรเดอร์', 'Driver verification'], href: '/platform/drivers', duty: ['ตรวจเอกสารและสถานะคนส่งอาหาร', 'Review rider documents and status'] },
  { id: 'OP05', title: ['บัญชีแยกประเภทที่แก้ไม่ได้', 'Immutable ledger'], needs: ['ต้องมี API อ่านบัญชีแยกประเภทสำหรับแพลตฟอร์ม', 'Needs a platform ledger read API'] },
  { id: 'OP06', title: ['กระทบยอด', 'Reconciliation'], needs: ['ต้องมีงานกระทบยอดและ API อ่านผล', 'Needs reconciliation jobs and a read API'] },
  { id: 'OP07', title: ['คำขอยกเลิกและคืนเงิน', 'Cancellation and refund reviews'], href: '/platform/food-cancellation-reviews', duty: ['ตรวจคำขอยกเลิกที่ลูกค้าส่งมา', 'Review cancellation requests from customers'] },
  { id: 'OP08', title: ['รายได้และรอบโอนไรเดอร์', 'Driver earnings and payouts'], href: '/platform/driver-earnings', duty: ['รอบจ่ายและใบรับคำสั่งบัญชีของไรเดอร์', 'Rider settlement runs and ledger instruction receipts'] },
  { id: 'OP09', title: ['เคสช่วยเหลือ', 'Support cases'], href: '/platform/support', duty: ['คำร้องและข้อความจากลูกค้า', 'Customer cases and messages'] },
  { id: 'OP10', title: ['ยกระดับความปลอดภัย', 'Safety escalation'], needs: ['ต้องมีขั้นตอนยกระดับและเจ้าหน้าที่รับผิดชอบ', 'Needs an escalation workflow and owners'] },
  { id: 'OP11', title: ['คำขอข้อมูลส่วนบุคคล', 'Privacy requests'], needs: ['ต้องมีการส่งออก/ลบข้อมูลจริง (DS44)', 'Needs real export/delete fulfilment (DS44)'] },
  { id: 'OP12', title: ['งานเก็บรักษาข้อมูล', 'Retention jobs'], needs: ['ต้องมีงานเก็บรักษาข้อมูลและบันทึกผล (DS44)', 'Needs retention jobs with run records (DS44)'] },
  { id: 'OP13', title: ['นโยบายบริการ', 'Service policy'], href: '/platform/food-dispatch', duty: ['นโยบายค้นหาไรเดอร์อัตโนมัติ', 'Automatic rider-search policy'] },
  { id: 'OP14', title: ['ตรวจสอบบทบาทและการเข้าถึง', 'Role and access audit'], needs: ['ต้องมี API อ่านสมาชิกและประวัติการใช้งาน', 'Needs member and audit read APIs'] },
  { id: 'OP15', title: ['งานเดินทางผู้โดยสาร', 'Ride operations'], href: '/platform/rides', duty: ['อัตราค่าโดยสารและเที่ยวที่ต้องตรวจ', 'Ride fares and trips to review'] },
  { id: 'OP16', title: ['ปฏิบัติการคอมเมิร์ซขั้นสูง', 'Advanced commerce operations'], needs: ['ต้องมีออเดอร์หลายร้าน กลุ่ม และสมาชิก (DS49–DS51)', 'Needs multi-merchant, group and membership services (DS49–DS51)'] },
  { id: 'REV', title: ['รีวิว', 'Reviews'], href: '/platform/reviews', duty: ['ตรวจรีวิวก่อนเผยแพร่', 'Moderate reviews before publishing'] },
];
