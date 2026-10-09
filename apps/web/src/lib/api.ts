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
    STOCK_UNAVAILABLE:'An item is no longer available. Update your cart.',
    ORDER_NOT_PAYABLE:'This bill cannot be paid. Ask the cafe team.',
    RESOURCE_NOT_FOUND:'This link is no longer available. Ask the cafe team.',
    AUTH_REQUIRED:'Please sign in again.',
    FORBIDDEN:'Your account cannot make this change.',
  };
  if(error instanceof ApiError){
    if(messages[error.code])return messages[error.code];
    if(error.status>=500)return 'Connection interrupted. Your order is saved; check its status before trying again.';
    if(error.status===401||error.status===403)return 'Please sign in again or ask the shop owner for access.';
  }
  if(error instanceof Error){if(error.name==='TimeoutError'||error.name==='TypeError')return 'Connection interrupted. Please check your saved order before trying again.';return error.message.replace(/^[A-Z_]+:\s*/, '');}
  return 'Please try again. If you already paid, ask the cafe team.';
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
