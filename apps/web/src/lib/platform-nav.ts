export interface PlatformNavItem {
  href: string;
  title: [th: string, en: string];
}
// One menu for every operator page (FigCraft PL01-PL11). Refund reconciliation is a
// panel inside the incidents page, so it has no entry of its own. Role checks stay on
// each page's server calls; a link here grants nothing.
export const platformNav: PlatformNavItem[] = [
  { href: '/platform', title: ['ศูนย์ปฏิบัติการ', 'Operations'] },
  { href: '/platform/food-dispatch', title: ['จัดส่งและไรเดอร์', 'Dispatch and riders'] },
  { href: '/platform/drivers', title: ['ตรวจสอบไรเดอร์', 'Driver verification'] },
  { href: '/platform/food-incidents', title: ['เหตุและความช่วยเหลือ', 'Incidents and support'] },
  { href: '/platform/support', title: ['ช่วยเหลือลูกค้า', 'Customer support'] },
  { href: '/platform/reviews', title: ['ตรวจรีวิว', 'Review moderation'] },
  { href: '/platform/driver-earnings', title: ['รายได้ไรเดอร์', 'Driver earnings'] },
  { href: '/platform/food-cancellation-reviews', title: ['คำขอยกเลิก', 'Cancellation reviews'] },
  { href: '/platform/rides', title: ['งานเดินทาง', 'Ride operations'] },
];
