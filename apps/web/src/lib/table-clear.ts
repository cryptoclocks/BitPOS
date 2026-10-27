import {z} from 'zod';
import type {Session} from './table';
const intentSchema=z.object({tableId:z.string().uuid(),request:z.object({expectedGeneration:z.string().regex(/^[1-9][0-9]*$/),idempotencyKey:z.string().uuid(),confirmClear:z.literal(true)}).strict()}).strict();
export type TableClearIntent=z.infer<typeof intentSchema>;
const key=(session:Session)=>`bitpos-table-clear:${session.merchantId}:${session.userId}`;
export function readTableClear(session:Session):TableClearIntent|null {const value=localStorage.getItem(key(session));return value===null?null:intentSchema.parse(JSON.parse(value));}
export function saveTableClear(session:Session,intent:TableClearIntent):void {const value=JSON.stringify(intentSchema.parse(intent));localStorage.setItem(key(session),value);if(localStorage.getItem(key(session))!==value)throw Error('Table clear storage unavailable / ไม่สามารถบันทึกคำขอเคลียร์โต๊ะได้');}
export function finishTableClear(session:Session):void {localStorage.removeItem(key(session));if(localStorage.getItem(key(session))!==null)throw Error('Table clear recovery record remains / ยังมีบันทึกคำขอเคลียร์โต๊ะ');}
