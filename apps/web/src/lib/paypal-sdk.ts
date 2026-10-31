// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Loads the PayPal JS SDK v6 (sandbox) once and opens a one-time payment session. Verified on the real sandbox on
// 31 Oct 2026: createInstance({clientId, components:['paypal-payments']}), findEligibleMethods().isEligible('paypal'),
// createPayPalOneTimePaymentSession({onApprove,onCancel,onError}) and session.start({presentationMode:'auto'}, orderPromise).
// The SDK result is only a trigger: the server captures and decides "paid".
const SDK_URL='https://www.sandbox.paypal.com/web-sdk/v6/core';

export interface PayPalSession {start(options:{presentationMode:'auto'},order:Promise<{orderId:string}>):Promise<void>;}
export interface PayPalCallbacks {onApprove(data:{orderId:string}):Promise<void>|void;onCancel(data?:unknown):void;onError(error:unknown):void;}
interface PayPalSdk {createInstance(options:{clientId:string;components:string[]}):Promise<{findEligibleMethods():Promise<{isEligible(method:string):boolean}>;createPayPalOneTimePaymentSession(callbacks:PayPalCallbacks):PayPalSession}>;}

let loading:Promise<PayPalSdk>|null=null;
function loadSdk():Promise<PayPalSdk>{
 const w=window as unknown as {paypal?:PayPalSdk};
 if(w.paypal)return Promise.resolve(w.paypal);
 loading??=new Promise<PayPalSdk>((resolve,reject)=>{
  const script=document.createElement('script');script.src=SDK_URL;script.async=true;
  script.onload=()=>w.paypal?resolve(w.paypal):reject(new Error('PAYPAL_SDK_MISSING'));
  script.onerror=()=>{loading=null;reject(new Error('PAYPAL_SDK_UNAVAILABLE'));};
  document.head.appendChild(script);
 });
 return loading;
}

/** Returns null when PayPal is not eligible in this browser (the page then shows the open-in-browser fallback). */
export async function paypalSession(clientId:string,callbacks:PayPalCallbacks):Promise<PayPalSession|null>{
 const sdk=await loadSdk();
 const instance=await sdk.createInstance({clientId,components:['paypal-payments']});
 const eligibility=await instance.findEligibleMethods();
 if(!eligibility.isEligible('paypal'))return null;
 return instance.createPayPalOneTimePaymentSession(callbacks);
}

/** In-app browsers (Messenger, Instagram, LINE, Facebook) often block the PayPal window. */
export const inAppBrowser=(ua=typeof navigator==='undefined'?'':navigator.userAgent)=>/FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger/i.test(ua);
