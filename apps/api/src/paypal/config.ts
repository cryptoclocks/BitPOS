// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// PayPal Sandbox configuration. Live mode is refused outright: this edition never moves real money.
import {z} from 'zod';

export const PAYPAL_SANDBOX_API='https://api-m.sandbox.paypal.com';
export type PayPalErrorCode='CONFIGURATION_REQUIRED'|'LIVE_MODE_REFUSED'|'AUTH_FAILED'|'OUTCOME_UNKNOWN'|'REJECTED'|'RESPONSE_INVALID'|'RESPONSE_TOO_LARGE'|'INVALID_AMOUNT';
/** `issue` is PayPal's first details[].issue (e.g. ORDER_ALREADY_CAPTURED); `debugId` is PayPal's support id, never a secret. */
export class PayPalError extends Error {constructor(readonly code:PayPalErrorCode,readonly issue?:string,readonly debugId?:string|null,readonly httpStatus?:number){super(issue?code+':'+issue:code);}}

export interface PayPalConfig {apiBase:typeof PAYPAL_SANDBOX_API;clientId:string;clientSecret:string;merchantId:string;webhookId:string|null;timeoutMs:number;}
const credential=z.string().regex(/^[A-Za-z0-9_-]{20,200}$/);
const schema=z.object({
 PAYPAL_ENVIRONMENT:z.literal('sandbox'),PAYPAL_API_BASE_URL:z.literal(PAYPAL_SANDBOX_API),
 PAYPAL_CLIENT_ID:credential,PAYPAL_CLIENT_SECRET:credential,PAYPAL_MERCHANT_ID:z.string().regex(/^[A-Z0-9]{13}$/),
 PAYPAL_WEBHOOK_ID:z.string().regex(/^[A-Z0-9]{10,40}$/).optional(),PAYPAL_TIMEOUT_MS:z.coerce.number().int().min(1000).max(60000).default(15000)
});

/** Throws LIVE_MODE_REFUSED for any non-sandbox environment or API host, CONFIGURATION_REQUIRED for anything else missing or malformed. */
export function paypalConfig(env:NodeJS.ProcessEnv=process.env):PayPalConfig{
 if(env.PAYPAL_ENVIRONMENT&&env.PAYPAL_ENVIRONMENT!=='sandbox'||env.PAYPAL_API_BASE_URL&&env.PAYPAL_API_BASE_URL!==PAYPAL_SANDBOX_API)throw new PayPalError('LIVE_MODE_REFUSED');
 const c=schema.safeParse({...env,PAYPAL_WEBHOOK_ID:env.PAYPAL_WEBHOOK_ID||undefined});
 if(!c.success)throw new PayPalError('CONFIGURATION_REQUIRED');
 return {apiBase:c.data.PAYPAL_API_BASE_URL,clientId:c.data.PAYPAL_CLIENT_ID,clientSecret:c.data.PAYPAL_CLIENT_SECRET,merchantId:c.data.PAYPAL_MERCHANT_ID,webhookId:c.data.PAYPAL_WEBHOOK_ID??null,timeoutMs:c.data.PAYPAL_TIMEOUT_MS};
}
