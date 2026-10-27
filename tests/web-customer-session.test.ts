import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError} from '../apps/web/src/lib/api';
import {restoreCustomerSession,saveCustomerSession,forgetCustomerSession,useCustomerSession,decodePayCustomerContext} from '../apps/web/src/lib/customer-session';
import type {PaymentRequest} from '../apps/web/src/lib/wallet';
import {CUSTOMER_CONSENT_VERSION,type CustomerAuthVerification} from '../packages/contracts/src/customer-auth';

const merchant='00000000-0000-4000-8000-000000000001',otherMerchant='00000000-0000-4000-8000-000000000002';
const wallet='11111111111111111111111111111111',otherWallet='11111111111111111111111111111112';
function fixture(){
 const values=new Map<string,string>();
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)}});
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://shop.example'}});
 const session:CustomerAuthVerification={sessionId:'00000000-0000-4000-8000-000000000003',customerId:'00000000-0000-4000-8000-000000000004',merchantId:merchant,origin:location.origin,walletAddress:wallet,consentVersion:CUSTOMER_CONSENT_VERSION,consentedPurchaseContext:true,expiresAt:new Date(Date.now()+7*86400000).toISOString(),sessionToken:'A'.repeat(43)};
 const calls:{path:string;body:unknown}[]=[];
 const request:PaymentRequest=async<T>(path:string,body:unknown)=>{calls.push({path,body});return session as T;};
 const close=()=>{Reflect.deleteProperty(globalThis,'sessionStorage');Reflect.deleteProperty(globalThis,'location');};
 return {values,session,calls,request,close};
}
test('two distinct bills restore one scoped session without challenge/signature, and bind only on explicit use',async()=>{
 const f=fixture();try{
  saveCustomerSession(f.session);
  assert.equal((await restoreCustomerSession('bill-one',merchant,undefined,f.request))?.sessionToken,f.session.sessionToken);
  const second=await restoreCustomerSession('bill-two',merchant,wallet,f.request);assert.ok(second);
  assert.deepEqual(f.calls.map(call=>call.path),['/pay/bill-one/customer/session','/pay/bill-two/customer/session']);
  assert.equal(f.calls.some(call=>call.path.endsWith('/use')),false,'Restoring must not bind a new bill');
  await useCustomerSession('bill-two',second,f.request);
  assert.deepEqual(f.calls[2],{path:'/pay/bill-two/customer/use',body:{sessionToken:f.session.sessionToken,walletAddress:wallet}});
  assert.equal(f.calls.some(call=>/challenge|verify|attempt|submit|dismiss|release/.test(call.path)),false);
 }finally{f.close();}
});
test('merchant, origin and connected wallet caches stay separate; discovery never supplies authentication',async()=>{
 const f=fixture();try{
  saveCustomerSession(f.session);
  assert.equal(await restoreCustomerSession('other',otherMerchant,undefined,f.request),null);
  assert.equal(await restoreCustomerSession('other-wallet',merchant,otherWallet,f.request),null);
  Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://other.example'}});
  assert.equal(await restoreCustomerSession('other-origin',merchant,undefined,f.request),null);
  assert.deepEqual(f.calls,[]);
 }finally{f.close();}
});
test('local expiry clears the cached credential without sending it, but never clears a payment journal',async()=>{
 const f=fixture();try{
  saveCustomerSession(f.session);f.values.set('bitpos-signed-payment:bill-two','untouched-signed-bytes');
  const key=[...f.values.keys()].find(key=>key.endsWith(':'+wallet))!;
  f.values.set(key,JSON.stringify({...f.session,expiresAt:'2000-01-01T00:00:00Z'}));
  await assert.rejects(restoreCustomerSession('bill-two',merchant,wallet,f.request));
  assert.equal(f.values.has(key),false);assert.equal(f.values.get('bitpos-signed-payment:bill-two'),'untouched-signed-bytes');assert.deepEqual(f.calls,[]);
 }finally{f.close();}
});
for(const operation of ['restore','use'] as const)test(`server revocation during ${operation} clears cached authentication`,async()=>{
 const f=fixture();try{
  saveCustomerSession(f.session);
  const refused:PaymentRequest=async()=>{throw new ApiError(401,'AUTH_REQUIRED','Revoked',false);};
  await assert.rejects(operation==='restore'?restoreCustomerSession('bill-two',merchant,wallet,refused):useCustomerSession('bill-two',f.session,refused),ApiError);
  assert.equal(await restoreCustomerSession('bill-three',merchant,wallet,f.request),null);assert.equal(f.values.size,0);
 }finally{f.close();}
});
for(const change of [{merchantId:otherMerchant},{origin:'https://foreign.example'},{walletAddress:otherWallet},{expiresAt:'2000-01-01T00:00:00Z'}])test('server session scope or expiry disagreement is never accepted',async()=>{
 const f=fixture();try{
  saveCustomerSession(f.session);
  const response:PaymentRequest=async<T>()=>({...f.session,...change}) as T;
  await assert.rejects(restoreCustomerSession('bill-two',merchant,wallet,response));
  assert.equal(await restoreCustomerSession('bill-two',merchant,wallet,f.request),null);
 }finally{f.close();}
});
test('unknown server outcome refuses reuse without destroying a potentially live session',async()=>{
 const f=fixture();try{
  saveCustomerSession(f.session);
  const interrupted:PaymentRequest=async()=>{throw new TypeError('Transport interrupted');};
  await assert.rejects(restoreCustomerSession('bill-two',merchant,wallet,interrupted),TypeError);
  assert.equal((await restoreCustomerSession('bill-two',merchant,wallet,f.request))?.sessionToken,f.session.sessionToken);
  forgetCustomerSession(merchant,wallet);assert.equal(f.values.size,0);
 }finally{f.close();}
});
test('pay context permits only this bill-bound local menu path',()=>{
 assert.deepEqual(decodePayCustomerContext({merchantId:merchant,menuUrl:'/pay/exact-bill/menu'},'exact-bill'),{merchantId:merchant,menuUrl:'/pay/exact-bill/menu'});
 for(const menuUrl of ['https://foreign.example/menu','/table/arbitrary','/pay/another-bill/menu','javascript:alert(1)'])assert.throws(()=>decodePayCustomerContext({merchantId:merchant,menuUrl},'exact-bill'));
});
