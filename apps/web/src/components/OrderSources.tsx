import React, { useState, type ReactNode } from 'react';
import ChannelOrders from './ChannelOrders';
import AllOrders, { type BitposRow } from './AllOrders';
import type { MapProduct } from './ChannelItemMap';
import '../styles/channel-orders.css';

type Source = 'all' | 'bitpos' | 'grabfood' | 'lineman';

// Order-center source switch. "BitPOS" is the existing order center, untouched. Platform channels are listed separately because
// their orders are not Solana-quoted BitPOS orders; the "All" tab is a read-only, time-ordered list that links into each source.
export default function OrderSources({ token, language, enabled, products, canMap, bitposOrders, children }: { token: string; language: 'th' | 'en'; enabled: boolean; products: MapProduct[]; canMap: boolean; bitposOrders: BitposRow[]; children: ReactNode }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [source, setSource] = useState<Source>('bitpos');
  if (!enabled) return <>{children}</>;
  const tabs: { id: Source; label: string }[] = [{ id: 'all', label: text('ทั้งหมด', 'All') }, { id: 'bitpos', label: 'BitPOS' }, { id: 'grabfood', label: 'GrabFood' }, { id: 'lineman', label: 'LINE MAN' }];
  return <>
    <nav className="order-source-tabs" aria-label={text('แหล่งที่มาของออเดอร์', 'Order source')}>
      {tabs.map(t => <button key={t.id} type="button" aria-pressed={source === t.id} className={source === t.id ? 'active' : ''} onClick={() => setSource(t.id)}>{t.label}</button>)}
    </nav>
    {source === 'all' ? <AllOrders token={token} language={language} bitpos={bitposOrders} open={s => setSource(s)} /> : source === 'bitpos' ? children : <ChannelOrders key={source} source={source} token={token} language={language} products={products} canMap={canMap} />}
  </>;
}
