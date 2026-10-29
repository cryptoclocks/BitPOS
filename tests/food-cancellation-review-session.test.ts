import test from 'node:test';import assert from 'node:assert/strict';
import {FoodCancellationReviewSession} from '../apps/web/src/lib/food-cancellation-review-session';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
for(const wrong of ['reviewId','decision','customerExplanation','reviewedShipmentVersion','refundExecuted'])test(`wrong cancellation review ${wrong} must retain exact unresolved disposition`,async()=>{
 const oldFetch=globalThis.fetch,storage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),values=new Map<string,string>();let lock=Promise.resolve(),corrupt=true,commands=0;
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:(_name:string,action:()=>unknown)=>{const next=lock.then(action);lock=next.then(()=>{},()=>{});return next;}}}});
 const saved={reviewId:id(3),command:{idempotencyKey:id(4),expectedReviewVersion:'1',expectedShipmentVersion:'7',decision:'COMPENSATION_REVIEW_REQUIRED',customerExplanation:'Public customer explanation; not a refund receipt'}};
 globalThis.fetch=async input=>{
  if(String(input).endsWith('/auth/verify'))return Response.json({accountId:id(1),sessionId:id(2),accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),accessExpiresAt:'2099-01-01T00:00:00Z',refreshExpiresAt:'2099-02-01T00:00:00Z'});
  commands++;const review:Record<string,unknown>={state:'REVIEWED',reviewId:id(3),shipmentId:id(5),reviewVersion:'2',reasonCode:'LATE_ORDER',requestedShipmentVersion:'6',requestedShipmentState:'AT_PICKUP',requestedAt:'2026-10-18T00:00:00Z',reviewedAt:'2026-10-18T00:01:00Z',decision:saved.command.decision,customerExplanation:saved.command.customerExplanation,reviewedShipmentVersion:'7',reviewedShipmentState:'AT_PICKUP'},value={review,shipmentVersion:'8',orderCancelled:false,refundExecuted:false,custodyReleased:false,stockReturned:false};
  if(corrupt){if(wrong==='refundExecuted')value.refundExecuted=true;else review[wrong]=wrong==='reviewId'?id(99):wrong==='decision'?'DECLINED':wrong==='reviewedShipmentVersion'?'99':'Wrong public explanation';}return Response.json(value);
 };
 try{
  const api=new FoodCancellationReviewSession();await api.verify('+66900000002','123456');await assert.rejects(api.submitReview(saved));assert.deepEqual(api.pendingReview(),saved);
  await assert.rejects(api.submitReview({...saved,command:{...saved.command,idempotencyKey:id(9)}}),(error:unknown)=>error instanceof Error&&error.message==='PENDING_COMMAND');assert.equal(commands,1);
  const restarted=new FoodCancellationReviewSession();await restarted.verify('+66900000002','123456');assert.deepEqual(restarted.pendingReview(),saved);corrupt=false;const result=await restarted.submitReview(saved);assert.equal(result.review.state,'REVIEWED');assert.equal(result.refundExecuted,false);assert.equal(restarted.pendingReview(),null);assert.equal(commands,2);
 }finally{globalThis.fetch=oldFetch;if(storage)Object.defineProperty(globalThis,'localStorage',storage);else Reflect.deleteProperty(globalThis,'localStorage');if(nav)Object.defineProperty(globalThis,'navigator',nav);else Reflect.deleteProperty(globalThis,'navigator');}
});
