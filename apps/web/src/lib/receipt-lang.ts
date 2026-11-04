import type { DocLang } from './print-slip';
import { currentReceiptSettings } from './receipt-look';

// Which language a printed bill uses is a per-device choice (a till facing tourists may want English or both), kept in this browser only.
// Until it is chosen, bills follow the language the screen is in.
const KEY = 'bitpos.receipt.lang';
export const receiptLangs: DocLang[] = ['th', 'en', 'both'];
export function readReceiptLang(fallback: 'th' | 'en'): DocLang {
  try { const v = localStorage.getItem(KEY); if (v === 'th' || v === 'en' || v === 'both') return v; } catch { /* storage unavailable */ }
  const shop = currentReceiptSettings(); return shop?.configured ? shop.defaultLang : fallback;
}
export function saveReceiptLang(value: DocLang): void { try { localStorage.setItem(KEY, value); } catch { /* storage unavailable: the choice lasts for this page only */ } }
