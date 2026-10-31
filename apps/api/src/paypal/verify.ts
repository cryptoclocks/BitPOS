// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// The only place that decides whether a PayPal response proves payment for a BitPOS checkout.
// A browser callback, SDK onApprove or webhook body is never proof; only an order/capture fetched from PayPal by the server.
import {customId,invoiceId,type PayPalOrder,type PayPalCapture} from './client';

export interface ExpectedPayment {paypalOrderId:string;merchantId:string;orderId:string;checkoutId:string;amountCents:bigint;payeeMerchantId:string;}
export type CaptureState='COMPLETED'|'PENDING'|'DECLINED'|'REFUNDED'|'NONE';
export type Verdict=
 |{state:'COMPLETED';capture:PayPalCapture}
 |{state:'PENDING'|'DECLINED'|'REFUNDED';capture:PayPalCapture}
 |{state:'NONE'}
 |{state:'MISMATCH';reasons:string[];capture:PayPalCapture|null};

/** Checks every attribution fact (plan 01 §6); any mismatch blocks settlement and must be shown to the merchant, never auto-resolved. */
export function verifyOrder(expected:ExpectedPayment,order:PayPalOrder):Verdict{
 const reasons:string[]=[];
 if(order.id!==expected.paypalOrderId)reasons.push('ORDER_ID');
 if(order.units.length!==1)reasons.push('PURCHASE_UNITS');
 const u=order.units[0];
 if(u){
  if(u.referenceId!==expected.orderId)reasons.push('REFERENCE_ID');
  if(u.customId!==customId(expected.merchantId,expected.orderId,expected.checkoutId))reasons.push('CUSTOM_ID');
  if(u.invoiceId!==invoiceId(expected.checkoutId))reasons.push('INVOICE_ID');
  if(u.payeeMerchantId!==expected.payeeMerchantId)reasons.push('PAYEE');
  if(u.currency!==null&&u.currency!=='USD'||u.valueCents!==null&&u.valueCents!==expected.amountCents)reasons.push('ORDER_AMOUNT');
 }
 const captures=u?.captures??[];
 if(captures.length>1)reasons.push('MULTIPLE_CAPTURES');
 const c=captures[0]??null;
 if(c){
  if(c.currency!=='USD'||c.valueCents!==expected.amountCents)reasons.push('CAPTURE_AMOUNT');
  // Gross, not net: PayPal's fee never changes what the customer owed.
  if(c.grossCents!==null&&c.grossCents!==expected.amountCents)reasons.push('GROSS_AMOUNT');
  if(c.customId!==null&&c.customId!==customId(expected.merchantId,expected.orderId,expected.checkoutId))reasons.push('CAPTURE_CUSTOM_ID');
  if(c.invoiceId!==null&&c.invoiceId!==invoiceId(expected.checkoutId))reasons.push('CAPTURE_INVOICE_ID');
  if(c.status==='COMPLETED'&&c.finalCapture!==true)reasons.push('NOT_FINAL');
 }
 if(reasons.length)return {state:'MISMATCH',reasons,capture:c};
 if(!c)return {state:'NONE'};
 // REFUNDED/PARTIALLY_REFUNDED were paid first: settlement stands and the refund is a separate ledger event.
 const state=c.status==='COMPLETED'?'COMPLETED':c.status==='PENDING'?'PENDING':c.status==='REFUNDED'||c.status==='PARTIALLY_REFUNDED'?'REFUNDED':'DECLINED';
 return {state,capture:c};
}
