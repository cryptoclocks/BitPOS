import {z} from 'zod';
import {ApiError} from './api';
import {decodeCustomerAuthSession,type PaymentRequest} from './wallet';
import type {CustomerAuthVerification} from '../../../../packages/contracts/src/customer-auth';

export interface PayCustomerContext {merchantId:string;menuUrl:string}
const tokenSchema=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const scope=(merchantId:string)=>`bitpos-customer-auth:${location.origin}:${merchantId}`;
const key=(merchantId:string,walletAddress:string)=>`${scope(merchantId)}:${walletAddress}`;
export function decodePayCustomerContext(input:unknown,accessToken:string):PayCustomerContext{
 return z.object({merchantId:z.string().uuid(),menuUrl:z.literal(`/pay/${encodeURIComponent(accessToken)}/menu`)}).parse(input);
}
function scopedSession(input:unknown,merchantId:string,walletAddress:string):CustomerAuthVerification{
 const view=decodeCustomerAuthSession(input),{sessionToken}=z.object({sessionToken:tokenSchema}).parse(input);
 if(view.merchantId!==merchantId||view.origin!==location.origin||view.walletAddress!==walletAddress||Date.parse(view.expiresAt)<=Date.now())throw Error('Saved customer session scope or expiry is invalid / session ลูกค้าไม่ตรงกับร้านหรือหมดอายุ');
 return {...view,sessionToken};
}
export function saveCustomerSession(session:CustomerAuthVerification){
 const verified=scopedSession(session,session.merchantId,session.walletAddress);
 sessionStorage.setItem(key(verified.merchantId,verified.walletAddress),JSON.stringify(verified));
 sessionStorage.setItem(scope(verified.merchantId),verified.walletAddress);
}
export function forgetCustomerSession(merchantId:string,walletAddress:string){
 sessionStorage.removeItem(key(merchantId,walletAddress));
 if(sessionStorage.getItem(scope(merchantId))===walletAddress)sessionStorage.removeItem(scope(merchantId));
}
/** Tab-local credentials, separated from order/payment journals. Restore is read-only;
 * only explicit use binds the new bill's original private recipient. */
export async function restoreCustomerSession(accessToken:string,merchantId:string,walletAddress:string|undefined,request:PaymentRequest):Promise<CustomerAuthVerification|null>{
 const address=walletAddress??sessionStorage.getItem(scope(merchantId));
 if(!address)return null;
 const saved=sessionStorage.getItem(key(merchantId,address));if(!saved)return null;
 let cached:CustomerAuthVerification;
 try{cached=scopedSession(JSON.parse(saved),merchantId,address);}catch(e){forgetCustomerSession(merchantId,address);throw e;}
 try{
  const view=await request<unknown>(`/pay/${encodeURIComponent(accessToken)}/customer/session`,{sessionToken:cached.sessionToken});
  try{return scopedSession({...decodeCustomerAuthSession(view),sessionToken:cached.sessionToken},merchantId,address);}catch(e){forgetCustomerSession(merchantId,address);throw e;}
 }catch(e){if(e instanceof ApiError&&e.status===401)forgetCustomerSession(merchantId,address);throw e;}
}
export async function useCustomerSession(accessToken:string,session:CustomerAuthVerification,request:PaymentRequest):Promise<CustomerAuthVerification>{
 let cached:CustomerAuthVerification;
 try{cached=scopedSession(session,session.merchantId,session.walletAddress);}catch(e){forgetCustomerSession(session.merchantId,session.walletAddress);throw e;}
 try{
  const view=await request<unknown>(`/pay/${encodeURIComponent(accessToken)}/customer/use`,{sessionToken:cached.sessionToken,walletAddress:cached.walletAddress});
  try{return scopedSession({...decodeCustomerAuthSession(view),sessionToken:cached.sessionToken},cached.merchantId,cached.walletAddress);}catch(e){forgetCustomerSession(cached.merchantId,cached.walletAddress);throw e;}
 }catch(e){if(e instanceof ApiError&&e.status===401)forgetCustomerSession(cached.merchantId,cached.walletAddress);throw e;}
}
