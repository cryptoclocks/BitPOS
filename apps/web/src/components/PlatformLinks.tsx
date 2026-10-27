const links: [string, string, string][] = [
 ['/platform', 'หน้าหลัก', 'Overview'],
 ['/platform/drivers', 'ตรวจสอบคนส่ง', 'Driver verification'],
 ['/platform/rides', 'งานเดินทาง', 'Ride operations'],
 ['/platform/support', 'ช่วยเหลือลูกค้า', 'Customer support'],
 ['/platform/food-dispatch', 'จัดส่งอาหาร', 'Food dispatch'],
 ['/platform/food-incidents', 'เหตุงานส่งอาหาร', 'Food incidents'],
 ['/platform/food-cancellation-reviews', 'คำขอยกเลิก', 'Cancellation reviews'],
 ['/platform/driver-earnings', 'การเงินไรเดอร์', 'Driver finance'],
];
export default function PlatformLinks({ thai, current }: { thai: boolean; current: string }) {
 return <nav className="platform-links" aria-label={thai ? 'เมนูแพลตฟอร์ม' : 'Platform menu'}>{links.map(([href, th, en]) => <a key={href} href={href} aria-current={href === current ? 'page' : undefined}>{thai ? th : en}</a>)}</nav>;
}
