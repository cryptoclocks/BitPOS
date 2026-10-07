import 'dotenv/config';
import {z} from 'zod';
export const config=z.object({DATABASE_URL:z.string().min(1),ADMIN_DATABASE_URL:z.string().min(1),AUTH_URL:z.string().url(),AUTH_ANON_KEY:z.string().min(1),APP_SECRET:z.string().min(32),DEVICE_TOKEN:z.string().min(32),PUBLIC_URL:z.string().url(),SOLANA_RPC:z.literal('https://api.devnet.solana.com'),DEVNET_PRIVATE_DIR:z.string().min(1)}).parse(process.env);
export const MERCHANT_A='11111111-1111-4111-8111-111111111111';
export const MERCHANT_B='22222222-2222-4222-8222-222222222222';
