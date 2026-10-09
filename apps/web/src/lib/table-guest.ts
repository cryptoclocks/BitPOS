import {requestId} from './request-id';
import {z} from 'zod';
import type {Quote,OrderAuthority,OrderView,CartItem} from '../../../../packages/contracts/src/index';
export type GuestQuote=Quote&{authority:OrderAuthority};
export type GuestState={items:CartItem[];requestId:string;visitToken?:string}&(
 |{phase:'draft'}|{phase:'review';quote:GuestQuote}|{phase:'pending';quote:GuestQuote;request:{quoteId:string;priceVersion:string;idempotencyKey:string}}|{phase:'order';order:OrderView}
);
const items=z.array(z.object({productId:z.string().uuid(),qty:z.number().int().min(1).max(100)}).strict()).max(50);
const envelope=z.object({items,requestId:z.string().uuid(),visitToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),phase:z.enum(['draft','review','pending','order'])}).passthrough();
export function freshGuest():GuestState{return {phase:'draft',items:[],requestId:requestId()};}
export function guestKey(entry:string){return 'bitpos-table-guest-v1:'+entry;}
export function restoreGuest(entry:string):GuestState{
 const raw=localStorage.getItem(guestKey(entry));if(!raw)return freshGuest();const state=envelope.parse(JSON.parse(raw));
 if(state.phase==='pending'){
  const request=z.object({quoteId:z.string().uuid(),priceVersion:z.string().uuid(),idempotencyKey:z.string().uuid()}).strict().parse(state.request);
  if(!state.visitToken||!state.quote||typeof state.quote!=='object')throw Error('Saved pending submission is incomplete. Retain browser storage; do not create a replacement.');
  return {...state,phase:'pending',request,quote:state.quote as GuestQuote};
 }
 // Never trust a restored client order/quote. Reload its private visit state from the server.
 return {phase:'draft',items:state.items,requestId:state.requestId,...(state.visitToken?{visitToken:state.visitToken}:{})};
}
export function saveGuest(entry:string,state:GuestState){localStorage.setItem(guestKey(entry),JSON.stringify(state));return state;}
export function finishGuestOrder(entry:string,orderId:string){
 const raw=localStorage.getItem(guestKey(entry));if(!raw)return;
 const saved=envelope.parse(JSON.parse(raw));
 if(saved.phase==='order'&&saved.order&&typeof saved.order==='object'&&'id' in saved.order&&saved.order.id===orderId)saveGuest(entry,freshGuest());
}
