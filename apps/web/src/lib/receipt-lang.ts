import type { DocLang } from './print-slip';

// Which language a printed bill uses is a per-device choice (a till facing tourists may want English or both), kept in this browser only.
// Until it is chosen, bills follow the language the screen is in.
const KEY = 'bitpos.receipt.lang';
export const receiptLangs: DocLang[] = ['th', 'en', 'both'];
export function readReceiptLang(fallback: 'th' | 'en'): DocLang {
  try { const v = localStorage.getItem(KEY); return v === 'th' || v === 'en' || v === 'both' ? v : fallback; } catch { return fallback; }
}
export function saveReceiptLang(value: DocLang): void { try { localStorage.setItem(KEY, value); } catch { /* storage unavailable: the choice lasts for this page only */ } }
