import test from 'node:test';
import assert from 'node:assert/strict';
import {signOwnerRefund,cancelOwnerRefund,WalletMismatch,WalletTimeout,withWalletTimeout,decodeBase64,encodeBase64,shortAddress} from '../apps/web/src/lib/refund-sign';
import type {ConnectedWallet} from '../apps/web/src/lib/wallet';
// Browser side of the owner-signed refund: the connected wallet must be the shop's treasury BEFORE anything is requested, the prepared bytes go to the wallet
// untouched, and only what the wallet returns is submitted.
const wallet=(address:string,signed:Uint8Array,seen:Uint8Array[]=[]):ConnectedWallet=>({address,name:'t',fixture:true,signMessage:async()=>new Uint8Array(64),signTransaction:async b=>{seen.push(b);return signed;}});
function stubFetch(handler:(path:string,body:any,method:string)=>unknown){
 const calls:{path:string;body:any}[]=[];const before=globalThis.fetch;
 globalThis.fetch=(async(url:string,init:{method:string;body?:string})=>{const body=init.body?JSON.parse(init.body):undefined;calls.push({path:String(url),body});return {ok:true,json:async()=>handler(String(url),body,init.method)} as Response;}) as never;
 return {calls,restore:()=>{globalThis.fetch=before;}};
}
test('a wallet that is not the treasury is refused before any request is made',async()=>{
 const s=stubFetch(()=>({}));
 try{await assert.rejects(signOwnerRefund('o1','tok',wallet('OTHER',new Uint8Array(1)),'TREASURY'),(e:unknown)=>e instanceof WalletMismatch&&e.expected==='TREASURY'&&e.actual==='OTHER');assert.equal(s.calls.length,0);}finally{s.restore();}
});
test('prepare, sign the exact prepared bytes, submit only the signed bytes',async()=>{
 const unsigned=Uint8Array.from([1,2,3,4,5]),signed=Uint8Array.from([9,8,7,6,5,4]),seen:Uint8Array[]=[];
 const s=stubFetch(path=>path.endsWith('/prepare')?{refundId:'r',sourceOwner:'TREASURY',beneficiary:'B',amountMinor:'5400000',unsignedBase64:encodeBase64(unsigned),lastValidBlockHeight:10}:{refund:{id:'r',state:'PREPARED',signature:'sig'}});
 try{
  const r=await signOwnerRefund('o1','tok',wallet('TREASURY',signed,seen),'TREASURY');
  assert.equal(r.refund.state,'PREPARED');assert.deepEqual(s.calls.map(c=>c.path),['/api/bills/orders/o1/refund/prepare','/api/bills/orders/o1/refund/submit']);
  assert.deepEqual(Array.from(seen[0]!),Array.from(unsigned));assert.deepEqual(s.calls[1]!.body,{base64:encodeBase64(signed)});
  // the server naming a different signer than the connected wallet is also refused, before signing
  const t=stubFetch(()=>({refundId:'r',sourceOwner:'SOMEONE_ELSE',beneficiary:'B',amountMinor:'1',unsignedBase64:'AQ==',lastValidBlockHeight:1}));seen.length=0;
  await assert.rejects(signOwnerRefund('o1','tok',wallet('TREASURY',signed,seen),'TREASURY'),WalletMismatch);assert.equal(seen.length,0);t.restore();
  const c=stubFetch(()=>({cancelled:true}));await cancelOwnerRefund('o1','tok');assert.equal(c.calls[0]!.path,'/api/bills/orders/o1/refund/cancel');c.restore();
 }finally{s.restore();}
});
test('base64 helpers round-trip and addresses are shortened for display',()=>{assert.deepEqual(Array.from(decodeBase64(encodeBase64(Uint8Array.from([0,255,128])))),[0,255,128]);assert.equal(shortAddress('4Vm9jmb7JNd7SRJiD6PWxhkxjFck1xDGzxGchTd7BAdh'),'4Vm9…7BAdh'.replace('…','…').slice(0,4)+'…'+'7BAdh'.slice(1));});
test('a wallet that never answers ends in a visible timeout instead of hanging forever',async()=>{
 const s=stubFetch(()=>({refundId:'r',sourceOwner:'TREASURY',beneficiary:'B',amountMinor:'1',unsignedBase64:'AQ==',lastValidBlockHeight:1}));
 const silent:ConnectedWallet={address:'TREASURY',name:'t',fixture:true,signMessage:async()=>new Uint8Array(64),signTransaction:()=>new Promise<Uint8Array>(()=>{})};
 try{
  await assert.rejects(signOwnerRefund('o1','tok',silent,'TREASURY',30),(e:unknown)=>e instanceof WalletTimeout&&e.step==='sign');
  assert.deepEqual(s.calls.map(c=>c.path),['/api/bills/orders/o1/refund/prepare'],'nothing is submitted when the wallet never signed');
  await assert.rejects(withWalletTimeout(new Promise<never>(()=>{}),'connect',20),(e:unknown)=>e instanceof WalletTimeout&&e.step==='connect');
  assert.equal(await withWalletTimeout(Promise.resolve(7),'connect',20),7);
 }finally{s.restore();}
});
