// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Shapes and words shared by the NEAR pages (merchant hub, customer pay page, simulated screen).
// The shapes mirror apps/api/src/near (bills.ts BillView / nearStatus, merchant.ts, device.ts).
import {ApiError, errorMessage} from './api';

export type Lang = 'th' | 'en';
export type BillStatus = 'none' | 'opening' | 'awaiting_payment' | 'escrow' | 'settling' | 'paid' | 'recovery' | 'payout_failed' | 'refunded' | 'void' | 'failed' | 'mismatch';
export interface Payout { role: string; label: string; account: string; amount: string; paid: boolean }
export interface BillView {
  status: BillStatus; billId: string | null; contract: string | null; merchantAccount: string | null; token: string | null;
  amount: { units: string; display: string } | null; witness: boolean; witnessDeadline: string | null; payer: string | null; payMessage: string | null;
  payouts: Payout[]; tx: { open: string | null; pay: string | null; witness: string | null; settle: string | null; refund: string | null }; issue: string | null;
}
export interface NearStatus {
  nearShop: boolean; enabled: boolean; network: 'testnet'; shopName: string; orderStatus: string; quoteExpiresAt: string;
  contract: string | null; relayer: string | null; explorerTx: string | null; merchantAccount: string | null;
  token: { contract: string; symbol: string; decimals: number } | null; amount: { units: string; display: string } | null;
  demoWallets: string[]; bill: BillView;
}
export const LIVE_STATUSES: readonly BillStatus[] = ['opening', 'awaiting_payment', 'escrow', 'settling', 'payout_failed'];

/** Customer NEAR routes answer {error:"CODE"}; merchant routes {error:{code,…}}. Both end up here as one code. */
export function nearCode(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code !== 'REQUEST_FAILED') return error.code;
    const bare = error.message.match(/^REQUEST_FAILED: ([A-Z0-9_]+)$/);
    return bare ? bare[1] : 'REQUEST_FAILED';
  }
  return 'UNKNOWN';
}
const MESSAGES: Record<string, [string, string]> = {
  NEAR_PASS_BILL_LIMIT: ['บิลนี้เกินวงเงินต่อบิลของสิทธิ์ AI', 'This bill is over the AI pass\'s per-bill limit'],
  NEAR_PASS_BALANCE_LOW: ['ยอดในสิทธิ์ AI ไม่พอจ่ายบิลนี้', 'The AI pass does not have enough left for this bill'],
  NEAR_PASS_EXPIRED: ['สิทธิ์ AI หมดเวลาแล้ว', 'The AI pass has expired'],
  NEAR_PASS_CLOSED: ['สิทธิ์ AI ถูกปิดแล้ว', 'The AI pass was closed'],
  NEAR_PASS_LIMIT_INVALID: ['วงเงินไม่ถูกต้อง (สูงสุด 50 และวงเงินต่อบิลต้องไม่เกินวงเงินรวม)', 'Check the limits: at most 50, and the per-bill limit cannot be above the cap'],
  NEAR_PASS_NOT_FOUND: ['ไม่พบสิทธิ์ AI นี้', 'That AI pass was not found'],
  NEAR_AI_PASS_UNAVAILABLE: ['ร้านนี้ยังไม่เปิดใช้สิทธิ์ AI', 'AI passes are not enabled for this café'],
  NEAR_UNAVAILABLE: ['ระบบ NEAR ยังไม่พร้อม ลองอีกครั้งในอีกสักครู่', 'NEAR is not reachable right now. Try again in a moment.'],
  NEAR_NOT_ENABLED: ['ร้านนี้ยังไม่ได้เปิดรับเงินผ่าน NEAR', 'This shop has not turned on NEAR payments.'],
  ORDER_NOT_PAYABLE: ['บิลนี้ชำระไม่ได้แล้ว กรุณาแจ้งทีมร้าน', 'This bill can no longer be paid. Ask the café team.'],
  QUOTE_EXPIRING: ['บิลนี้ใกล้หมดอายุ กรุณาขอบิลใหม่จากร้าน', 'This bill is about to expire. Ask the café for a new one.'],
  PAYMENT_PENDING: ['มีการชำระเงินที่กำลังดำเนินการ กรุณาอย่าจ่ายซ้ำ', 'A payment is already in progress. Please do not pay again.'],
  NEAR_CURRENCY_UNSUPPORTED: ['บิลนี้ไม่ได้ตั้งราคาเป็นดอลลาร์ จึงจ่ายผ่าน NEAR ไม่ได้', 'This bill is not priced in dollars, so it cannot be paid on NEAR.'],
  NEAR_AMOUNT_NOT_EXACT: ['ยอดบิลแปลงเป็นหน่วยเหรียญแบบพอดีไม่ได้', 'This total cannot be turned into token units exactly.'],
  NEAR_AMOUNT_TOO_LARGE: ['ยอดบิลสูงกว่าเพดานของรุ่นทดสอบ', 'This total is above the limit of the test edition.'],
  NEAR_RECIPE_INVALID: ['ภาษี ทิป และใบแจ้งหนี้รวมกันเกิน 90% ของบิล เจ้าของร้านต้องเหลือส่วนแบ่ง', 'Tax, tips and invoices together are over 90% of a bill. The owner must keep a share.'],
  NEAR_WITNESS_NOT_READY: ['เครื่องพยานยังไม่ได้ลงทะเบียนกุญแจ', 'The witness screen has not registered its key yet.'],
  NEAR_BILL_REQUIRED: ['ยังไม่ได้เปิดบิลบน NEAR', 'The bill has not been opened on NEAR yet.'],
  NEAR_PAYMENT_NOT_FOR_THIS_BILL: ['คำสั่งจ่ายนี้ไม่ตรงกับบิล ร้านจึงไม่ส่งต่อให้', 'That payment is not exactly this bill, so the café did not relay it.'],
  NEAR_RELAY_FAILED: ['ส่งคำสั่งจ่ายไม่สำเร็จ ยังไม่มีเงินเคลื่อนไหว ลองอีกครั้งได้', 'The payment could not be sent. No money moved; you can try again.'],
  NEAR_TX_NOT_FOUND: ['ยังหาธุรกรรมนี้บนเชนไม่พบ', 'That transaction was not found on chain yet.'],
  NEAR_WITNESS_WINDOW_OPEN: ['ยังอยู่ในเวลารอพยาน ขอคืนเงินได้เมื่อครบเวลา', 'The screen still has time to confirm. You can take the money back when the timer ends.'],
  NEAR_FAUCET_UNAVAILABLE: ['ร้านนี้ไม่มีเหรียญทดสอบให้แจก', 'This shop has no test tokens to hand out.'],
  NEAR_FAUCET_LIMIT: ['บัญชีนี้ขอเหรียญทดสอบไปแล้ว ลองใหม่ในหนึ่งชั่วโมง', 'This account already asked for test tokens. Try again in an hour.'],
  NEAR_ACCOUNT_NOT_FOUND: ['ไม่พบบัญชี NEAR นี้บน testnet', 'That NEAR account does not exist on testnet.'],
  ROLE_REQUIRED: ['เฉพาะเจ้าของร้านหรือผู้จัดการ', 'Owner or manager only.'],
  NEAR_TOO_MANY_OPEN_INVOICES: ['เปิดใบแจ้งหนี้พร้อมกันได้ไม่เกิน 3 ใบ', 'At most 3 invoices can be open at once.'],
  NEAR_INVOICE_EXISTS: ['มีใบแจ้งหนี้เลขนี้แล้ว', 'An invoice with this reference already exists.'],
  NEAR_BILL_NOT_HELD: ['สัญญาไม่ได้ถือเงินของบิลนี้อยู่ จึงคืนเงินจากที่นี่ไม่ได้', 'The contract is not holding this bill\'s money, so it cannot be refunded from here.'],
  NEAR_BILL_NOT_FAILED: ['บิลนี้ไม่ได้อยู่ในสถานะแบ่งจ่ายล้มเหลว', 'This bill is not in a failed-split state.'],
  DEVICE_KEY_ALREADY_REGISTERED: ['เครื่องนี้ลงทะเบียนกุญแจอื่นไว้แล้ว', 'Another key is already registered for this screen.'],
  DEVICE_AUTH_REQUIRED: ['ลิงก์ตั้งค่าของจอนี้ใช้ไม่ได้', 'This screen\'s setup link is not valid.'],
  NEAR_CFO_DAILY_LIMIT: ['วันนี้ถาม CFO ครบจำนวนแล้ว ลองใหม่พรุ่งนี้', 'The CFO has been asked as often as allowed today. Try again tomorrow.'],
  NEAR_CFO_UNAVAILABLE: ['ตอนนี้ติดต่อโมเดลไม่ได้ สูตรไม่เปลี่ยน', 'The model cannot be reached right now. The recipe did not change.'],
  NEAR_CFO_ALREADY_DECIDED: ['ข้อเสนอนี้ถูกตัดสินไปแล้ว', 'This proposal was already decided.'],
  INVALID_REQUEST: ['ข้อมูลที่กรอกไม่ถูกต้อง', 'Something in the form is not valid.'],
};
export function nearMessage(error: unknown, lang: Lang): string {
  const found = MESSAGES[nearCode(error)];
  if (found) return found[lang === 'th' ? 0 : 1];
  return errorMessage(error);
}
const ROLES: Record<string, [string, string]> = { owner: ['เจ้าของร้าน', 'Owner'], tax: ['กองภาษี', 'Tax reserve'], tips: ['ทิปพนักงาน', 'Staff tips'], supplier: ['ซัพพลายเออร์', 'Supplier'] };
export const roleLabel = (role: string, lang: Lang) => (ROLES[role] ?? [role, role])[lang === 'th' ? 0 : 1];
/** FigCraft tokens: split colours on a light and on a dark surface. */
export const ROLE_COLOR: Record<string, string> = { owner: '#0B1020', tips: '#00B37E', tax: '#F2A93B', supplier: '#5E6B7A' };
export const ROLE_COLOR_DARK: Record<string, string> = { owner: '#FFFFFF', tips: '#00B37E', tax: '#F2A93B', supplier: '#8FA0BA' };
/** A link only for a real transaction hash; placeholders stored by the server are never linked. */
export const txUrl = (base: string | null | undefined, hash: string | null | undefined) => base && hash && /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(hash) ? base + hash : null;
export const shortHash = (hash: string) => hash.length > 14 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
export const shortAccount = (id: string) => id.length > 30 ? `${id.slice(0, 16)}…${id.slice(-10)}` : id;
/** "5.40" → 540 hundredths-of-a-cent-free number for proportions only (never for money maths). */
export const shareOf = (amount: string, total: string) => { const t = Number(total); return t > 0 ? Math.max(0, Math.min(100, Number(amount) / t * 100)) : 0; };

/** A real mainnet price check from NEAR Intents (1Click), shown as a preview only: nothing is ever sent. */
export interface CrossChainQuote { id: string; chain: string; symbol: string; amountIn: string | null; amountOut: string | null; seconds: number | null; issue: string | null }
export interface CrossChainPreview { label: string; network: 'mainnet'; direction: 'pay-in' | 'send-home'; amount: string; quotes: CrossChainQuote[]; quotedAt: string }
