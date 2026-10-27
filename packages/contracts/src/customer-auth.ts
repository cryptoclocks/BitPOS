export const CUSTOMER_CONSENT_VERSION = 'bitpos-personal-offers-v1' as const;
export const CUSTOMER_CONSENT_DISCLOSURE = {
  en: 'I allow this merchant to create or use my wallet-linked profile and purchase history at this merchant for personal offers. Optional: I can still order and pay anonymously. Signing this message gives no charging, transfer, x402 or SPL delegation authority. I can revoke authentication and this consent without deleting my profile or history; existing payment permissions are unchanged.',
  th: 'ฉันยินยอมให้ร้านนี้สร้างหรือใช้โปรไฟล์ที่ผูกกับ wallet และประวัติซื้อเฉพาะร้านนี้เพื่อข้อเสนอส่วนตัว เป็นทางเลือก: ยังสั่งและจ่ายแบบไม่ยืนยันตัวตนได้ การลงนามข้อความนี้ไม่ให้สิทธิ์ตัดเงิน โอนเงิน x402 หรือมอบสิทธิ์ SPL ฉันเพิกถอนการยืนยันตัวตนและความยินยอมนี้ได้โดยไม่ลบโปรไฟล์หรือประวัติ และไม่เปลี่ยนสิทธิ์ชำระเดิม',
} as const;
export interface CustomerConsent {
  version: typeof CUSTOMER_CONSENT_VERSION;
  profile: true;
  purchaseHistory: true;
}
export interface CustomerOrderContext {
  orderId: string;
  requestHash: string;
  createdAt: string;
  occupancyId: string | null;
  occupancyGeneration: string | null;
}
export interface CustomerAuthChallenge {
  challengeId: string;
  origin: string;
  merchantId: string;
  walletAddress: string;
  order: CustomerOrderContext;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  consentVersion: typeof CUSTOMER_CONSENT_VERSION;
  message: string;
}
export interface CustomerAuthIdentity {
  sessionId: string;
  customerId: string;
  walletAddress: string;
  consentVersion: string;
  consentedPurchaseContext: boolean;
}
export interface CustomerAuthSession extends CustomerAuthIdentity {
  merchantId: string;
  origin: string;
  expiresAt: string;
}
export interface CustomerAuthVerification extends CustomerAuthSession { sessionToken: string }
export interface CustomerAuthRevocation { revoked: true; scope: 'merchant-wallet'; }
/** Exact UTF-8 bytes signed by the wallet; context is a read-only snapshot, not payment authority. */
export function customerAuthMessage(challenge: Omit<CustomerAuthChallenge, 'message'>): string {
  return [
    `${new URL(challenge.origin).host} wants you to sign in with your Solana account:`,
    challenge.walletAddress,
    '',
    'BitPOS optional customer authentication and explicit personal-offers consent.',
    'Purposes: create/use wallet-linked profile and purchase history at this merchant for personal offers.',
    'No charging, transfer, x402 or SPL delegation authority. Ordinary anonymous payment remains available.',
    'Revocation ends authentication/consent only; profiles, purchase history and payment permissions remain.',
    '',
    `URI: ${challenge.origin}`,
    'Version: 1',
    'Chain ID: solana:devnet',
    `Merchant: ${challenge.merchantId}`,
    `Order context (read-only): ${JSON.stringify({orderId:challenge.order.orderId,requestHash:challenge.order.requestHash,createdAt:challenge.order.createdAt,occupancyId:challenge.order.occupancyId,occupancyGeneration:challenge.order.occupancyGeneration})}`,
    `Challenge: ${challenge.challengeId}`,
    `Nonce: ${challenge.nonce}`,
    `Issued At: ${challenge.issuedAt}`,
    `Expiration Time: ${challenge.expiresAt}`,
    `Consent Version: ${challenge.consentVersion}`,
    'Consent Purposes: profile,purchase-history',
  ].join('\n');
}
