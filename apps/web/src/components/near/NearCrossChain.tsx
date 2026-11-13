// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// "Mainnet preview · not executed": real NEAR Intents (1Click) prices for paying a bill from another chain, or for
// sending earnings to another chain. Display only. There is no button here that moves money.
import React from 'react';
import type {CrossChainPreview, Lang} from '../../lib/near-shared';

const about = (value: string | null) => { const n = Number(value); return value !== null && Number.isFinite(n) ? n.toFixed(2) : null; };
export default function NearCrossChain({preview, language, symbol}: {preview: CrossChainPreview; language: Lang; symbol: string}) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  return <div className="near-cross">
    <p className="near-chip near-chip-violet">{text('ดูตัวอย่างบน mainnet · ไม่มีการส่งจริง', 'Mainnet preview · not executed')}</p>
    <p className="near-hint">{text('NEAR Intents ไม่มี testnet ที่นี่จึงเป็นการเช็กราคาจริงบน mainnet เท่านั้น ไม่มีการส่งเงินใด ๆ', 'NEAR Intents has no testnet, so this is a real mainnet price check only; nothing is sent.')}</p>
    <ul className="near-cross-rows">{preview.quotes.map(quote => {
      const value = about(preview.direction === 'pay-in' ? quote.amountIn : quote.amountOut);
      const where = text(`${quote.symbol} บน ${quote.chain}`, `${quote.symbol} on ${quote.chain}`);
      return <li key={quote.id} data-unavailable={quote.issue || value === null ? 'true' : undefined}>
        {quote.issue || value === null ? <><strong>{where}</strong><span>{text('ยังใช้ไม่ได้ในตอนนี้', 'not available right now')}</span></>
          : preview.direction === 'pay-in' ? <><strong>{where}</strong><span>{text(`จ่ายประมาณ ${value}`, `pay about ${value}`)}{quote.seconds !== null && ` · ~${quote.seconds} ${text('วินาที', 's')}`}</span></>
          : <><strong>{text(`ได้รับประมาณ ${value} ${quote.symbol} บน ${quote.chain}`, `arrives as ≈ ${value} ${quote.symbol} on ${quote.chain}`)}</strong><span>{quote.seconds !== null ? `~${quote.seconds} ${text('วินาที', 's')}` : ''}</span></>}
      </li>;
    })}</ul>
    <p className="near-hint">{preview.direction === 'pay-in' ? text(`ร้านจะได้รับ ${preview.amount} ${symbol} บน NEAR พอดียอด`, `The café would receive exactly ${preview.amount} ${symbol} on NEAR.`) : text(`จากรายได้ ${preview.amount} ${symbol} บน NEAR`, `From ${preview.amount} ${symbol} of earnings on NEAR.`)}</p>
  </div>;
}
