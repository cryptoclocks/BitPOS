import {z} from 'zod';
import type pg from 'pg';
import type {ConsumerError} from '../../../packages/contracts/src/index';
export class RequestError extends Error {
 constructor(readonly status:number,readonly code:ConsumerError['code'],message:string=code,readonly details?:Record<string,unknown>){super(message);}
 get view():ConsumerError{return {code:this.code,message:this.message,retryable:['DEVICE_OFFLINE','DEVICE_BUSY','PAYMENT_PENDING','CHAT_IMAGE_BUSY','CHAT_RETRY','DISPATCH_AUTH_RETRY','SETTLEMENT_AUTH_RETRY','LOCATION_RATE_LIMITED'].includes(this.code),...(this.details?{details:this.details}:{})};}
}
export const uuid=z.string().uuid();
export const integer=z.string().regex(/^(0|[1-9][0-9]*)$/).max(19).refine(v=>BigInt(v)<=9223372036854775807n);
export const positive=integer.refine(v=>BigInt(v)>0n);
export const label=z.string().min(1).refine(v=>Buffer.byteLength(v)<=95&&[...v].every(c=>{const code=c.codePointAt(0)!;return code>=32&&code<=126||code>=0x0e01&&code<=0x0e5b;}));
export const cart=z.array(z.object({productId:uuid,qty:z.number().int().min(1).max(100)}).strict()).max(50).refine(items=>new Set(items.map(i=>i.productId)).size===items.length);
export const serving=z.discriminatedUnion('kind',[z.object({kind:z.literal('table'),tableId:uuid}).strict(),z.object({kind:z.literal('counter')}).strict(),z.object({kind:z.literal('takeaway')}).strict()]);
export function fail(code:ConsumerError['code'],status=409,details?:Record<string,unknown>):never{throw new RequestError(status,code,code,details);}
export function requireRole(role:string,owner=false){if(owner?role!=='owner':!['owner','manager'].includes(role))fail('ROLE_REQUIRED',403);}
export async function routingLock(db:pg.PoolClient,merchant:string){const r=await db.query('SELECT * FROM merchants WHERE id=$1 FOR NO KEY UPDATE',[merchant]);if(!r.rowCount)fail('RESOURCE_NOT_FOUND',404);return r.rows[0];}
export function errorView(error:unknown){
 if(error instanceof RequestError)return error;
 if(error instanceof z.ZodError||error instanceof SyntaxError)return new RequestError(422,'INVALID_REQUEST','Invalid request');
 const known:Record<string,[number,ConsumerError['code']]> = {
 'DRIVER_PICKUP_PROOF_REQUIRED':[409,'DRIVER_PICKUP_PROOF_REQUIRED'],
 'DISPATCH_NOT_READY':[409,'DISPATCH_NOT_READY'],'PROOF_ROTATION_REQUIRED':[409,'PROOF_ROTATION_REQUIRED'],'DISPATCH_AUTH_RETRY':[409,'DISPATCH_AUTH_RETRY'],
 'TABLE_OCCUPANCY_CHANGED':[409,'TABLE_OCCUPANCY_CHANGED'],
 'ASSIGNMENT_CHANGED':[409,'ASSIGNMENT_CHANGED'],
 'PAYMENT_PENDING':[409,'PAYMENT_PENDING'],
 'ONLINE_ACCEPTANCE_DEADLINE_ELAPSED':[409,'ACCEPTANCE_UNAVAILABLE'],
 'DELIVERY_CONFIRMATION_SNAPSHOT_CHANGED_OR_EXPIRED':[409,'QUOTE_CHANGED'],
 'DELIVERY_ADDRESS_CHANGED':[409,'QUOTE_CHANGED'],
 'PAYMENT_ASSET_UNAVAILABLE':[422,'PAYMENT_ASSET_UNAVAILABLE'],
 'ONLINE_OPTIONS_DENOMINATION_CONFLICT':[409,'INVALID_CURRENCY'],
 'NONDIVISIBLE_DENOMINATION':[422,'INVALID_PRICE'],'INVALID_PAYMENT_AMOUNT':[422,'INVALID_PRICE'],
 'MISSING_PAYMENT_ASSET':[503,'PAYMENT_UNAVAILABLE'],'PAYMENT_QUOTE_MISMATCH':[503,'PAYMENT_UNAVAILABLE'],
 'Challenge expired or used':[409,'CHALLENGE_EXPIRED'],'Invalid wallet signature':[422,'INVALID_WALLET_PROOF'],
 'Wallet already bound':[409,'WALLET_CONFLICT'],'Wallet belongs to another customer':[409,'WALLET_CONFLICT'],
 'Bind wallet first':[409,'WALLET_PROOF_REQUIRED'],'Attempt pending':[409,'PAYMENT_PENDING'],
 'Attempt not found':[404,'RESOURCE_NOT_FOUND'],'Attempt already submitted':[409,'PAYMENT_PENDING'],
 'Attempt is not ready':[409,'PAYMENT_PENDING'],'Order is not payable':[409,'ORDER_NOT_PAYABLE'],
 'Transaction message was changed':[422,'INVALID_TRANSACTION'],'Invalid transaction signatures':[422,'INVALID_TRANSACTION'],
 'Missing payer signature':[422,'INVALID_TRANSACTION'],'Transaction too large':[422,'INVALID_TRANSACTION'],
 'Missing customer signature':[422,'INVALID_TRANSACTION'],'Missing fee payer signature':[422,'INVALID_TRANSACTION'],
 'Invalid items':[422,'INVALID_QUANTITY'],'Invalid quantity':[422,'INVALID_QUANTITY'],
 'Invalid payment participant':[422,'INVALID_PAYMENT_PARTICIPANT'],
 'Payment simulation failed':[409,'PAYMENT_SIMULATION_FAILED'],'Sponsor fee exceeds policy':[429,'SPONSOR_BUDGET_EXHAUSTED'],
 'Recipient account setup exceeds per-order sponsor budget; pre-create account':[429,'SPONSOR_BUDGET_EXHAUSTED']
 };
 const mapped=error instanceof Error?known[error.message]:null;
 return mapped?new RequestError(mapped[0],mapped[1],error instanceof Error?error.message:mapped[1]):new RequestError(500,'INTERNAL_ERROR','Request unavailable');
}
