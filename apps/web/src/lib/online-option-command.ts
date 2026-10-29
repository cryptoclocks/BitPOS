import {OnlineOptionsPublicationSchema,type OnlineOptionsPublication} from '../../../../packages/contracts/src/mobile-v1.generated';
import type {Session} from './table';
const key=(session:Session,product:string)=>`bitpos-online-options-v1:${session.merchantId}:${session.userId}:${product}`;
export function pendingOnlineOptions(session:Session,product:string):OnlineOptionsPublication|undefined {
 const raw=sessionStorage.getItem(key(session,product));return raw===null?undefined:OnlineOptionsPublicationSchema.parse(JSON.parse(raw));
}
export function retainOnlineOptions(session:Session,product:string,command:OnlineOptionsPublication){
 const existing=pendingOnlineOptions(session,product),raw=JSON.stringify(OnlineOptionsPublicationSchema.parse(command));
 if(existing&&JSON.stringify(existing)!==raw)throw Error('Resolve the original option command first / ตรวจคำสั่งตัวเลือกเดิมก่อน');
 sessionStorage.setItem(key(session,product),raw);
 if(sessionStorage.getItem(key(session,product))!==raw)throw Error('Option command storage unavailable / บันทึกคำสั่งตัวเลือกไม่ได้');
}
export function finishOnlineOptions(session:Session,product:string,command:OnlineOptionsPublication){
 const existing=pendingOnlineOptions(session,product);
 if(existing&&JSON.stringify(existing)!==JSON.stringify(command))return false;
 sessionStorage.removeItem(key(session,product));
 if(sessionStorage.getItem(key(session,product))!==null)throw Error('Option command recovery record remains / ยังมีบันทึกคำสั่งตัวเลือก');
 return true;
}
/** Configuration deltas need not fit a whole payable quote until selected. */
export function parseOptionDelta(input:string,decimals:number){
 if(![2,4,6].includes(decimals)||!/^\d+(?:\.\d+)?$/.test(input))throw Error('Invalid option price / ราคาตัวเลือกไม่ถูกต้อง');
 const [whole,fraction='']=input.split('.');
 if(fraction.length>decimals)throw Error('Too many decimal places / ทศนิยมเกินกำหนด');
 const minor=BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0'));
 if(minor>999999999999999999n)throw Error('Option price exceeds supported range / ราคาตัวเลือกเกินกำหนด');
 return String(minor);
}
