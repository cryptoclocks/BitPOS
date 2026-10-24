import {ExactSvmScheme} from '@x402/svm/exact/client';
import {decodePaymentRequiredHeader,encodePaymentSignatureHeader,decodePaymentResponseHeader} from '@x402/core/http';
import {address,getTransactionEncoder,getTransactionDecoder,type SignatureBytes,type SignatureDictionary,type TransactionPartialSigner} from '@solana/kit';
import type {OrderView} from '../../../../packages/contracts/src/index';
import type {ConnectedWallet} from './wallet';
import {z} from 'zod';
const NETWORK='solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const pendingSchema=z.object({owner:z.string().min(32).max(44),header:z.string().min(1).max(16384)}).strict();
const key=(access:string)=>'bitpos-x402-payment-v2:'+access;
export function pendingX402(access:string){const raw=localStorage.getItem(key(access));return raw?pendingSchema.parse(JSON.parse(raw)):null;}
export function forgetX402(access:string){localStorage.removeItem(key(access));}
async function send(access:string,owner:string,header?:string){return fetch('/api/pay/'+encodeURIComponent(access)+'/x402',{method:'POST',headers:{'Content-Type':'application/json',...(header?{'PAYMENT-SIGNATURE':header}:{})},body:JSON.stringify({address:owner}),cache:'no-store',signal:AbortSignal.timeout(30000)});}
async function acceptResponse(response:Response){
 const result=await response.json() as {status?:string;signature?:string;order?:OrderView;error?:string};
 if(response.status===200){const receipt=response.headers.get('PAYMENT-RESPONSE');if(!receipt||result.status!=='paid'||result.order?.status!=='PAID'||!result.signature)throw Error('Finalized x402 receipt unavailable; check saved payment');const decoded=decodePaymentResponseHeader(receipt);if(!decoded.success||decoded.network!==NETWORK||decoded.transaction!==result.signature)throw Error('x402 receipt mismatch; do not pay again');return {signature:result.signature,paid:true};}
 if(response.status===202&&result.status==='pending'&&result.signature)return {signature:result.signature,paid:false};
 throw Error('x402 payment not completed; retain saved authorization and reconcile / ยังไม่สำเร็จ กรุณาตรวจรายการเดิม ไม่จ่ายซ้ำ');
}
export async function resumeX402(access:string){const saved=pendingX402(access);if(!saved)throw Error('No saved x402 authorization');return acceptResponse(await send(access,saved.owner,saved.header));}
export async function submitX402(access:string,wallet:ConnectedWallet,order:OrderView,phase:(value:string)=>void){
 if(pendingX402(access))return resumeX402(access);
 if(order.settlement.assetId!=='usdc-devnet'||order.status!=='AWAITING_WALLET'&&order.status!=='AWAITING_PAYMENT')throw Error('This bill is not eligible for exact USDC devnet x402');
 const response=await send(access,wallet.address);if(response.status!==402)throw Error('x402 requirements unavailable');
 const requiredHeader=response.headers.get('PAYMENT-REQUIRED');if(!requiredHeader)throw Error('Missing PAYMENT-REQUIRED');const required=decodePaymentRequiredHeader(requiredHeader);
 const resource=new URL('/api/pay/'+encodeURIComponent(access)+'/x402',new URL(order.paymentUrl).origin).href;
 if(required.x402Version!==2||required.resource?.url!==resource||required.accepts.length!==1)throw Error('Wrong x402 resource');const accepted=required.accepts[0];
 if(accepted.scheme!=='exact'||accepted.network!==NETWORK||accepted.asset!==order.settlement.mint||accepted.amount!==order.settlement.amountMinor||accepted.payTo!==order.settlement.recipient||typeof accepted.extra?.memo!=='string'||!/^b2:[A-Za-z0-9_-]{43}$/.test(accepted.extra.memo)||accepted.extra.orderId!==order.id||typeof accepted.extra.feePayer!=='string'||typeof accepted.extra.recentBlockhash!=='string')throw Error('x402 requirement differs from reviewed bill');
 const owner=address(wallet.address);
 const signer:TransactionPartialSigner={address:owner,signTransactions:async transactions=>{
  const signatures:SignatureDictionary[]=[];for(const transaction of transactions){phase('Approve exact USDC payment in wallet…');const encoded=getTransactionEncoder().encode(transaction);const signed=await wallet.signTransaction(Uint8Array.from(encoded));const decoded=getTransactionDecoder().decode(signed);if(!BufferlessEqual(transaction.messageBytes,decoded.messageBytes))throw Error('Wallet changed the reviewed transaction');const signature=decoded.signatures[owner];if(!signature)throw Error('Wallet signature missing');signatures.push({[owner]:signature as SignatureBytes});}return signatures;
 }};
 const sdk=new ExactSvmScheme(signer);const created=await sdk.createPaymentPayload(2,accepted);
 const header=encodePaymentSignatureHeader({...created,resource:required.resource,accepted});
 localStorage.setItem(key(access),JSON.stringify({owner:wallet.address,header}));phase('Sending SDK x402 payment…');return acceptResponse(await send(access,wallet.address,header));
}
function BufferlessEqual(a:ArrayLike<number>,b:ArrayLike<number>){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
