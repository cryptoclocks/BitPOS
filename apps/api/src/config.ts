import 'dotenv/config';
import {z} from 'zod';
export const config=z.object({DATABASE_URL:z.string().min(1),ADMIN_DATABASE_URL:z.string().min(1),AUTH_URL:z.string().url(),AUTH_ANON_KEY:z.string().min(1),APP_SECRET:z.string().min(32),PUBLIC_URL:z.string().url().max(600).refine(value=>{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&u.pathname==='/'&&!u.username&&!u.password&&!u.search&&!u.hash;}).transform(value=>new URL(value).origin),SOLANA_RPC:z.literal('https://api.devnet.solana.com'),DEVNET_PRIVATE_DIR:z.string().min(1),BITPOS_DEMO_QUICK_SIGNIN:z.enum(['0','1']).default('0')}).parse(process.env);
export const MERCHANT_A='11111111-1111-4111-8111-111111111111';
export const MERCHANT_B='22222222-2222-4222-8222-222222222222';

// Customer HTTPS origin is separate from private merchant demo/login origin.
export const customerOrigin = process.env.BITPOS_CUSTOMER_PUBLIC_URL ? (() => { const url = new URL(process.env.BITPOS_CUSTOMER_PUBLIC_URL!); if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("Invalid customer HTTPS origin"); return url.origin; })() : config.PUBLIC_URL;
