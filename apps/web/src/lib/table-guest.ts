import {requestId} from './request-id';
import {z} from 'zod';
import type {Quote,OrderAuthority,OrderView,CartItem} from '../../../../packages/contracts/src/index';
import type {DelegatedPermission} from '../../../../packages/contracts/src/delegated-payments';
export type GuestQuote=Quote&{authority:OrderAuthority};
export type GuestState={items:CartItem[];requestId:string;visitToken?:string;offer?:string;collection?:'table'|'counter';delegatedCheckout?:{permission:DelegatedPermission;nonce:string}}&(
 |{phase:'draft'}|{phase:'review';quote:GuestQuote}|{phase:'pending';quote:GuestQuote;request:{quoteId:string;priceVersion:string;idempotencyKey:string}}|{phase:'order';order:OrderView}
);
const items=z.array(z.object({productId:z.string().uuid(),qty:z.number().int().min(1).max(100)}).strict()).max(50);
const checkout=z.object({permission:z.object({grantId:z.string().uuid(),owner:z.string().min(32).max(44),sessionToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/),expiresAt:z.string().datetime({offset:true})}).strict(),nonce:z.string().uuid()}).strict();
const envelope=z.object({items,requestId:z.string().uuid(),visitToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),offer:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),collection:z.enum(['table','counter']).optional(),delegatedCheckout:checkout.optional(),phase:z.enum(['draft','review','pending','order'])}).passthrough();
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
 return {phase:'draft',items:state.items,requestId:state.requestId,collection:state.collection??'table',...(state.delegatedCheckout?{delegatedCheckout:state.delegatedCheckout}:{}),...(state.visitToken?{visitToken:state.visitToken}:{}),...(state.offer?{offer:state.offer}:{})};
}
export function saveGuest(entry:string,state:GuestState){localStorage.setItem(guestKey(entry),JSON.stringify(state));return state;}
/** Call only after the server accepts Done for this verified order. The saved
 * journal may still contain its original unpaid submission response. */
export function finishGuestOrder(entry:string,order:Pick<OrderView,'id'|'status'|'tableOccupancyGeneration'>){
 if(order.status!=='PAID')return;
 const raw=localStorage.getItem(guestKey(entry));if(!raw)return;
 const saved=envelope.parse(JSON.parse(raw));
 if(saved.phase==='order'&&saved.order&&typeof saved.order==='object'&&'id' in saved.order&&saved.order.id===order.id){
  if(saved.visitToken)localStorage.setItem('bitpos-table-paid-visit-v1:'+entry,JSON.stringify({visitToken:saved.visitToken,orderId:order.id,...(order.tableOccupancyGeneration?{occupancyGeneration:order.tableOccupancyGeneration}:{})}));
  saveGuest(entry,freshGuest());
 }
}
/** Opaque prior paid capability stays separate from the next cart. Server still
 * verifies settlement, tenant and ownership before any repeat operation. */
export function priorPaidVisit(entry:string){
 const raw=localStorage.getItem('bitpos-table-paid-visit-v1:'+entry);
 return raw?z.object({visitToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/),orderId:z.string().uuid(),occupancyGeneration:z.string().regex(/^[1-9][0-9]*$/).optional()}).strict().parse(JSON.parse(raw)):null;
}
