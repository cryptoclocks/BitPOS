export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryable: boolean, readonly details?: unknown) { super(`${code}: ${message}`); }
  get definiteRefusal(): boolean { return this.status >= 400 && this.status < 500 || this.code === 'DEVICE_OFFLINE'; }
}
export function errorMessage(error:unknown):string{
  const messages:Record<string,string>={
    WALLET_CONFLICT:'A different wallet is linked to this bill. Ask the cafe team for help.',
    DEVICE_BUSY:'POSClock is in use. Close its current bill first.',
    DEVICE_OFFLINE:'POSClock is reconnecting. Please wait.',
    ORDER_NOT_RELEASABLE:'This payment is still being checked. Please wait before closing.',
    PAYMENT_PENDING:'A payment is in progress. Please do not pay again.',
    QUOTE_EXPIRED:'This bill has expired. Review your order again.',
    LEASE_EXPIRED:'This review has expired. Review your order again.',
    PRICE_VERSION_CHANGED:'Prices changed. Review your order again.',
    QUOTE_CHANGED:'Your bill changed. Review your order again.',
    ASSIGNMENT_CHANGED:'The table connection changed. Review your order again.',
    PAIRING_CHANGED:'The POSClock connection changed. Refresh and review again.',
    TABLE_OCCUPANCY_CHANGED:'This table visit has ended. Keep any saved bill; start a new visit only after its status is known. / รอบโต๊ะนี้สิ้นสุดแล้ว เก็บบิลเดิมไว้ และเริ่มรอบใหม่เมื่อทราบผลบิลแล้ว',
    TABLE_JOIN_CONFIRMATION_REQUIRED:'This table is in use. Refresh its status, then explicitly join and review. / โต๊ะนี้มีผู้ใช้อยู่ รีเฟรชสถานะ แล้วกดยืนยันร่วมโต๊ะและตรวจบิล',
    TABLE_CLEAR_BLOCKED:'A bill or payment is still unresolved. Reconcile it before clearing this table. / ยังมีบิลหรือผลชำระที่ไม่แน่ชัด กรุณาตรวจสอบก่อนเคลียร์โต๊ะ',
    STOCK_UNAVAILABLE:'An item is no longer available. Update your cart.',
    PROMOTION_OFFER_INVALID:'This offer is expired or not eligible for your visit. Ask the cafe team. / โปรโมชันหมดอายุหรือใช้ไม่ได้กับการเข้าโต๊ะนี้ กรุณาสอบถามพนักงาน',
    PROMOTION_LIMIT_EXCEEDED:'This offer allows one discounted item and one eligible order only. / โปรโมชันนี้ลดราคาได้หนึ่งชิ้นและใช้ได้กับออเดอร์ที่มีสิทธิ์ครั้งเดียว',
    ORDER_NOT_PAYABLE:'This bill cannot be paid. Ask the cafe team.',
    RESOURCE_NOT_FOUND:'This link is no longer available. Ask the cafe team.',
    AUTH_REQUIRED:'Please sign in again.',
    FORBIDDEN:'Your account cannot make this change.',
  };
  const messagesTh:Record<string,string>={
    WALLET_CONFLICT:'บิลนี้ผูกกับกระเป๋าอื่นอยู่ กรุณาแจ้งทีมร้าน',
    DEVICE_BUSY:'POSClock กำลังใช้งานอยู่ กรุณาปิดบิลปัจจุบันก่อน',
    DEVICE_OFFLINE:'POSClock กำลังเชื่อมต่อใหม่ กรุณารอสักครู่',
    ORDER_NOT_RELEASABLE:'กำลังตรวจสอบการชำระเงิน กรุณารอก่อนปิดบิล',
    PAYMENT_PENDING:'มีการชำระเงินที่กำลังดำเนินการ กรุณาอย่าจ่ายซ้ำ',
    QUOTE_EXPIRED:'บิลนี้หมดอายุแล้ว กรุณาตรวจรายการอีกครั้ง',
    LEASE_EXPIRED:'การตรวจรายการนี้หมดอายุแล้ว กรุณาตรวจอีกครั้ง',
    PRICE_VERSION_CHANGED:'ราคามีการเปลี่ยนแปลง กรุณาตรวจรายการอีกครั้ง',
    QUOTE_CHANGED:'บิลของคุณเปลี่ยนไป กรุณาตรวจรายการอีกครั้ง',
    ASSIGNMENT_CHANGED:'การเชื่อมต่อโต๊ะเปลี่ยนไป กรุณาตรวจรายการอีกครั้ง',
    PAIRING_CHANGED:'การเชื่อมต่อ POSClock เปลี่ยนไป กรุณารีเฟรชแล้วตรวจอีกครั้ง',
    STOCK_UNAVAILABLE:'มีสินค้าที่หมดแล้ว กรุณาแก้ตะกร้า',
    ORDER_NOT_PAYABLE:'บิลนี้ชำระเงินไม่ได้ กรุณาแจ้งทีมร้าน',
    RESOURCE_NOT_FOUND:'ลิงก์นี้ใช้ไม่ได้แล้ว กรุณาแจ้งทีมร้าน',
    AUTH_REQUIRED:'กรุณาเข้าสู่ระบบอีกครั้ง',
    FORBIDDEN:'บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้',
  };
  const thai=typeof document!=='undefined'&&(document.querySelector('main[lang]')?.getAttribute('lang')??document.documentElement.lang)==='th';
  const say=(en:string,thText:string)=>thai?thText:en;
  if(error instanceof ApiError){
    if(thai&&messagesTh[error.code])return messagesTh[error.code];
    if(messages[error.code])return messages[error.code];
    if(error.status>=500)return say('Connection interrupted. Your order is saved; check its status before trying again.','การเชื่อมต่อขัดข้อง ออเดอร์ถูกบันทึกไว้แล้ว กรุณาตรวจสถานะก่อนลองอีกครั้ง');
    if(error.status===401||error.status===403)return say('Please sign in again or ask the shop owner for access.','กรุณาเข้าสู่ระบบอีกครั้ง หรือขอสิทธิ์จากเจ้าของร้าน');
  }
  if(error instanceof Error){if(error.name==='TimeoutError'||error.name==='TypeError')return say('Connection interrupted. Please check your saved order before trying again.','การเชื่อมต่อขัดข้อง กรุณาตรวจออเดอร์ที่บันทึกไว้ก่อนลองอีกครั้ง');return error.message.replace(/^[A-Z_]+:\s*/, '');}
  return say('Please try again. If you already paid, ask the cafe team.','กรุณาลองอีกครั้ง หากชำระเงินแล้วให้แจ้งทีมร้าน');
}
export async function api<T>(path: string, body?: unknown, token?: string, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch(`/api${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    if (payload && typeof payload === 'object' && 'error' in payload) {
      const error = payload.error;
      if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && 'message' in error && typeof error.message === 'string') {
        throw new ApiError(response.status, error.code, error.message, 'retryable' in error && error.retryable === true, 'details' in error ? error.details : undefined);
      }
      if (typeof error === 'string') throw new ApiError(response.status, 'REQUEST_FAILED', error, false);
    }
    throw new ApiError(response.status, 'REQUEST_FAILED', `Request failed (${response.status})`, false);
  }
  return response.json();
}
