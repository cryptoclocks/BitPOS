import {useEffect,useRef,useState} from 'react';
import {api,ApiError,errorMessage} from '../lib/api';
import {authenticateCustomerWallet,type ConnectedWallet,type WalletChoice} from '../lib/wallet';
import {CUSTOMER_CONSENT_VERSION,CUSTOMER_CONSENT_DISCLOSURE,type CustomerAuthVerification,type CustomerAuthRevocation} from '../../../../packages/contracts/src/customer-auth';
import {restoreCustomerSession,saveCustomerSession,forgetCustomerSession,useCustomerSession} from '../lib/customer-session';
import '../styles/customer-consent.css';

export interface CustomerConsentProps {
 accessToken:string;orderId:string;merchantId:string;wallet?:ConnectedWallet;choices:WalletChoice[];disabled?:boolean;
 language?:'en'|'th';onWallet:(wallet:ConnectedWallet)=>void;onBusyChange:(busy:boolean)=>void;
}
export default function CustomerConsent({accessToken,orderId,merchantId,wallet,choices,disabled,language='en',onWallet,onBusyChange}:CustomerConsentProps){
 const [lang,setLang]=useState(language),[consent,setConsent]=useState(false),[session,setSession]=useState<CustomerAuthVerification|null>(null);
 const [choice,setChoice]=useState(''),[busy,setBusy]=useState(false),[checking,setChecking]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const working=useRef(false),boundSession=useRef('');const [applied,setApplied]=useState(false);
 const root=`/pay/${encodeURIComponent(accessToken)}/customer`,th=lang==='th';
 const text=(thai:string,english:string)=>th?thai:english;
 useEffect(()=>{setLang(language);},[language]);
 useEffect(()=>{
  let active=true;setSession(null);setApplied(false);setConsent(false);setChecking(true);setError('');setNotice('');
  async function restore(){try{const restored=await restoreCustomerSession(accessToken,merchantId,wallet?.address,api);if(active){setSession(restored);setApplied(!!restored&&restored.sessionId===boundSession.current);}}catch(e){if(active)setError(errorMessage(e));}finally{if(active)setChecking(false);}}
  void restore();return()=>{active=false;};
 },[accessToken,merchantId,wallet?.address]);
 async function run(action:()=>Promise<void>){
  if(disabled||checking||working.current)return;working.current=true;setBusy(true);onBusyChange(true);setError('');setNotice('');
  try{await action();}catch(e){setError(errorMessage(e));if(e instanceof ApiError&&e.status===401&&session){setSession(null);setApplied(false);}}finally{working.current=false;setBusy(false);onBusyChange(false);}
 }
 async function verify(){
  if(!consent)throw Error(text('กรุณาอ่านและติ๊กยินยอมก่อนลงนาม','Read and explicitly check consent before signing.'));
  const selected=choices.find(candidate=>candidate.name===choice),connected=wallet??(selected?await selected.connect():undefined);
  if(!connected)throw Error(text('เลือก wallet ที่รองรับการลงนามข้อความ ยังจ่ายตามปกติได้','Choose a wallet supporting signMessage. Normal payment remains available.'));
  const restored=await restoreCustomerSession(accessToken,merchantId,connected.address,api);
  const result=restored?await useCustomerSession(accessToken,restored,api):await authenticateCustomerWallet(accessToken,orderId,connected,{version:CUSTOMER_CONSENT_VERSION,profile:true,purchaseHistory:true},api);
  if(result.merchantId!==merchantId)throw Error('Customer session merchant mismatch');
  boundSession.current=result.sessionId;setSession(result);setApplied(true);setConsent(false);onWallet(connected);
  try{saveCustomerSession(result);}catch{setNotice(text('ยืนยันสำเร็จ แต่บันทึก session ในแท็บไม่ได้ กรุณาเพิกถอนก่อนปิดหน้า หากไม่ต้องการคงความยินยอม','Verified, but this tab could not save the session. Revoke before closing if you do not want to keep consent.'));}
 }
 async function useExisting(){
  if(!session||wallet&&wallet.address!==session.walletAddress)return;
  try{const result=await useCustomerSession(accessToken,session,api);boundSession.current=result.sessionId;setSession(result);setApplied(true);}catch(e){setSession(null);setApplied(false);throw e;}
 }
 async function revoke(){
  if(!session)return;const result=await api<CustomerAuthRevocation>(`${root}/revoke`,{sessionToken:session.sessionToken});
  if(result.revoked!==true||result.scope!=='merchant-wallet')throw Error('Revocation response unavailable. Retry revoke / ผลเพิกถอนไม่ชัดเจน กรุณาลองเพิกถอนอีกครั้ง');
  boundSession.current='';setSession(null);setApplied(false);setConsent(false);
  try{forgetCustomerSession(merchantId,session.walletAddress);}catch{/* Server revocation is authoritative even if this tab cannot clear its cached credential. */}
  setNotice(text('เพิกถอนการยืนยันตัวตนและความยินยอมของ wallet นี้ที่ร้านแล้ว ไม่ลบประวัติและไม่เปลี่ยนสิทธิ์ชำระ','Authentication and consent revoked for this wallet at this merchant. History and payment permissions are unchanged.'));
 }
 const locked=!!disabled||busy||checking,canSign=wallet?.supportsMessageSigning!==false;
 return <details lang={lang} className="checkout-options customer-consent" aria-label={text('ความยินยอมและบัญชีลูกค้าแบบเลือกใช้','Optional customer consent and account')}>
  <summary><span>{text('บัญชีลูกค้าที่ผูกกับร้านนี้','Account linked to this merchant')}</span>{session&&<span className="customer-consent-summary-status">✓</span>}</summary>
  <section className="customer-consent-surface" aria-live="polite">
   <header className="customer-consent-header"><span className={`customer-consent-icon${session?' is-verified':''}`} aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="15" r="7"/><path d="M10 39v-5a14 14 0 0 1 28 0v5"/></svg></span><div><h2>{session?text('บันทึกบัญชีแล้ว','Account saved'):text('บันทึกบัญชีที่ร้านนี้','Save an account with this merchant')}</h2><p>{text('เลือกได้เอง ยังสั่งและจ่ายแบบไม่ยืนยันตัวตนได้ การยืนยัน wallet ไม่ให้สิทธิ์ตัดเงิน','Optional. You can still order and pay anonymously. Wallet authentication gives no charging authority.')}</p></div></header>
   <label className="customer-consent-language">{text('ภาษา','Language')}<select value={lang} onChange={event=>setLang(event.target.value==='th'?'th':'en')}><option value="en">English</option><option value="th">ไทย</option></select></label>
   {checking&&<p className="customer-consent-status" role="status">{text('กำลังตรวจ session เดิม ไม่ขอลงนามซ้ำ','Checking your existing session without another signature…')}</p>}
   {session&&(!wallet||session.walletAddress===wallet.address)?<div className="customer-consent-verified">
    <p className="customer-consent-status" role="status"><strong>{applied?text('ยืนยันแล้วสำหรับบิลนี้','Verified for this bill'):text('session ที่ยืนยันแล้วพร้อมใช้','Verified session ready to use')}</strong><span>{session.walletAddress.slice(0,6)}…{session.walletAddress.slice(-4)}</span></p>
    <p className="customer-consent-expiry">{text('หมดอายุ','Expires')}: <time dateTime={session.expiresAt}>{new Date(session.expiresAt).toLocaleString(th?'th-TH':'en-US')}</time> · {session.consentVersion}</p>
    {!applied&&<button type="button" disabled={locked} onClick={()=>void run(useExisting)}>{text('ใช้ session นี้รับข้อเสนอสำหรับบิลนี้','Use this session for this bill')}</button>}
    <button type="button" className="customer-consent-revoke" disabled={locked} onClick={()=>void run(revoke)}>{text('เพิกถอนการยืนยันและความยินยอม','Revoke authentication & consent')}</button>
    <p className="customer-consent-boundary">{text('เพิกถอนเฉพาะ auth/consent ของ wallet นี้ที่ร้าน ไม่ลบโปรไฟล์ ประวัติ หรือสิทธิ์ SPL เดิม','Revoke only this wallet’s authentication/consent at this merchant, not its profile, history or existing SPL permissions.')}</p>
   </div>:<div className="customer-consent-choice">
    {!wallet&&<label className="customer-consent-wallet">{text('เลือก wallet','Choose wallet')}<select value={choice} disabled={locked} onChange={event=>setChoice(event.target.value)}><option value="">{text('เลือก wallet','Select wallet')}</option>{choices.map((candidate,index)=><option key={index} value={candidate.name}>{candidate.name}</option>)}</select></label>}
    {!wallet&&!choices.length&&<p className="customer-consent-status">{text('ยังไม่พบ wallet เปิดลิงก์นี้ในเบราว์เซอร์ wallet ที่รองรับการลงนามข้อความ หรือจ่ายตามปกติ','No wallet discovered. Open this exact link in a wallet browser supporting signMessage, or continue normal payment.')}</p>}
    {!canSign&&<p className="customer-consent-status">{text('wallet หรือบัญชีนี้ไม่รองรับ Solana signMessage จึงรับข้อเสนอส่วนตัวไม่ได้ แต่ยังชำระตามปกติได้','This wallet/account lacks Solana signMessage. Personal offers are unavailable; normal payment still works.')}</p>}
    <label className="customer-consent-disclosure"><input type="checkbox" checked={consent} disabled={locked} onChange={event=>setConsent(event.target.checked)}/><span>{CUSTOMER_CONSENT_DISCLOSURE[lang]} <small>({CUSTOMER_CONSENT_VERSION})</small></span></label>
    <button type="button" className="customer-consent-confirm" disabled={locked||!consent||!canSign||(!wallet&&!choice)} onClick={()=>void run(verify)}>{busy?text('รอการยืนยัน…','Please wait…'):text('ลงนามข้อความและยืนยันความยินยอม','Sign message & confirm consent')}</button>
   </div>}
   {session?.walletAddress===wallet?.address&&wallet?.fixture&&<p className="fixture">TEST WALLET FIXTURE — browser automation only, not a real mobile test</p>}
   {notice&&<p className="customer-consent-notice" role="status">{notice}</p>}
   {error&&<p className="error" role="alert">{error} {text('การจ่ายตามปกติยังใช้งานได้','Normal payment remains available.')}</p>}
  </section>
 </details>;
}
