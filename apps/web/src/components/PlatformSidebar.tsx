import { platformNav } from '../lib/platform-nav';

// Navigation only: reads no data and performs no operation.
export default function PlatformSidebar({ thai, current }: { thai: boolean; current: string }) {
  return <aside className="dispatch-sidebar"><strong>BitPOS</strong><small>PLATFORM</small>
    <nav aria-label={thai ? 'เมนูแพลตฟอร์ม' : 'Platform menu'}>{platformNav.map(item => <a key={item.href} href={item.href} aria-current={item.href === current ? 'page' : undefined}>{item.title[thai ? 0 : 1]}</a>)}</nav>
    <p className="dispatch-sidebar-foot">BitPOS Platform</p></aside>;
}
