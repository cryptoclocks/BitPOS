import {useEffect,useRef,useState} from 'react';
import {api,ApiError,errorMessage} from '../lib/api';
import {authenticateCustomerWallet,type ConnectedWallet,type WalletChoice} from '../lib/wallet';
import {CUSTOMER_CONSENT_VERSION,CUSTOMER_CONSENT_DISCLOSURE,type CustomerAuthVerification,type CustomerAuthRevocation} from '../../../../packages/contracts/src/customer-auth';
import {restoreCustomerSession,saveCustomerSession,forgetCustomerSession,useCustomerSession} from '../lib/customer-session';

export interface CustomerConsentProps {
 accessToken:string;orderId:string;merchantId:string;wallet?:ConnectedWallet;choices:WalletChoice[];disabled?:boolean;
 language?:'en'|'th';onWallet:(wallet:ConnectedWallet)=>void;onBusyChange:(busy:boolean)=>void;
}
export default function CustomerConsent({accessToken,orderId,merchantId,wallet,choices,disabled,language='en',onWallet,onBusyChange}:CustomerConsentProps){
 const [lang,setLang]=useState(language),[consent,setConsent]=useState(false),[session,setSession]=useState<CustomerAuthVerification|null>(null);
 const [choice,setChoice]=useState(''),[busy,setBusy]=useState(false),[checking,setChecking]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const working=useRef(false),boundSession=useRef('');
 const [applied,setApplied]=useState(false);
 const root=`/pay/${encodeURIComponent(accessToken)}/customer`;
 const th=lang==='th';
 useEffect(()=>{setLang(language);},[language]);
 useEffect(()=>{
  let active=true;setSession(null);setApplied(false);setConsent(false);setChecking(true);setError('');setNotice('');
  async function restore(){
   try{
    const restored=await restoreCustomerSession(accessToken,merchantId,wallet?.address,api);
    if(active){setSession(restored);setApplied(!!restored&&restored.sessionId===boundSession.current);}
   }catch(e){
    if(active)setError(errorMessage(e));
   }finally{if(active)setChecking(false);}
  }
  void restore();return()=>{active=false;};
 },[accessToken,merchantId,wallet?.address]);
 async function run(action:()=>Promise<void>){
  if(disabled||checking||working.current)return;working.current=true;setBusy(true);onBusyChange(true);setError('');setNotice('');
  try{await action();}catch(e){setError(errorMessage(e));if(e instanceof ApiError&&e.status===401&&session){setSession(null);setApplied(false);}}finally{working.current=false;setBusy(false);onBusyChange(false);}
 }
 async function verify(){
  if(!consent)throw Error(th?'กรุณาอ่านและติ๊กยินยอมก่อนลงนาม':'Read and explicitly check consent before signing.');
  const selected=choices.find(candidate=>candidate.name===choice);
  const connected=wallet??(selected?await selected.connect():undefined);
  if(!connected)throw Error(th?'เลือก wallet ที่รองรับการลงนามข้อความ ยังจ่ายตามปกติได้':'Choose a wallet supporting signMessage. Normal payment remains available.');
  const restored=await restoreCustomerSession(accessToken,merchantId,connected.address,api);
  const result=restored?await useCustomerSession(accessToken,restored,api):await authenticateCustomerWallet(accessToken,orderId,connected,{version:CUSTOMER_CONSENT_VERSION,profile:true,purchaseHistory:true},api);
  if(result.merchantId!==merchantId)throw Error('Customer session merchant mismatch');
  boundSession.current=result.sessionId;setSession(result);setApplied(true);setConsent(false);onWallet(connected);
  try{saveCustomerSession(result);}catch{setNotice(th?'ยืนยันสำเร็จ แต่บันทึก session ในแท็บไม่ได้ กรุณาเพิกถอนก่อนปิดหน้า หากไม่ต้องการคงความยินยอม':'Verified, but this tab could not save the session. Revoke before closing if you do not want to keep consent.');}
 }
 async function useExisting(){
  if(!session||wallet&&wallet.address!==session.walletAddress)return;
  try{
   const result=await useCustomerSession(accessToken,session,api);
   boundSession.current=result.sessionId;setSession(result);setApplied(true);
  }catch(e){setSession(null);setApplied(false);throw e;}
 }
 async function revoke(){
  if(!session)return;
  const result=await api<CustomerAuthRevocation>(`${root}/revoke`,{sessionToken:session.sessionToken});
  if(result.revoked!==true||result.scope!=='merchant-wallet')throw Error('Revocation response unavailable. Retry revoke / ผลเพิกถอนไม่ชัดเจน กรุณาลองเพิกถอนอีกครั้ง');
  boundSession.current='';setSession(null);setApplied(false);setConsent(false);
  try{forgetCustomerSession(merchantId,session.walletAddress);}catch{/* Server revocation is authoritative even if this tab cannot clear its cached credential. */}
  setNotice(th?'เพิกถอนการยืนยันตัวตนและความยินยอมของ wallet นี้ที่ร้านแล้ว ไม่ลบประวัติและไม่เปลี่ยนสิทธิ์ชำระ':'Authentication and consent revoked for this wallet at this merchant. History and payment permissions are unchanged.');
 }
 const locked=!!disabled||busy||checking;
 return <details className="checkout-options" aria-label="Optional personal offers / ข้อเสนอส่วนตัวแบบเลือกใช้">
  <summary>{th?'รับข้อเสนอสำหรับคุณ · ไม่บังคับ':'Personal offers for you · optional'}{session?' ✓':''}</summary>
  <div className="stack">
   <label>{th?'ภาษา':'Language'}<select value={lang} onChange={event=>setLang(event.target.value==='th'?'th':'en')}><option value="en">English</option><option value="th">ไทย</option></select></label>
   <p role="note">{th?'ยืนยัน wallet เท่านั้น ไม่ให้สิทธิ์ตัดเงิน ยังสั่งและจ่ายแบบไม่ยืนยันตัวตนได้':'Wallet authentication only — no charging authority. You can still order and pay anonymously.'}</p>
   {checking&&<p role="status">{th?'กำลังตรวจ session เดิม ไม่ขอลงนามซ้ำ':'Checking your existing session without another signature…'}</p>}
   {session&&(!wallet||session.walletAddress===wallet.address)?<>
    <p role="status">{applied?(th?'ยืนยันแล้วสำหรับข้อเสนอส่วนตัวของบิลนี้':'Verified for personal offers on this bill'):(th?'session ที่ยืนยันแล้วพร้อมใช้':'Verified session ready to use')} · {session.walletAddress.slice(0,6)}…{session.walletAddress.slice(-4)}</p>
    <p>{th?'หมดอายุ':'Expires'}: {new Date(session.expiresAt).toLocaleString(th?'th-TH':'en-US')} · {session.consentVersion}</p>
    {!applied&&<button className="secondary" disabled={locked} onClick={()=>void run(useExisting)}>{th?'ใช้ session นี้รับข้อเสนอสำหรับบิลนี้':'Use this session for this bill'}</button>}
    <button className="secondary" disabled={locked} onClick={()=>void run(revoke)}>{th?'เพิกถอนการยืนยันและความยินยอม':'Revoke authentication & consent'}</button>
    <p>{th?'เพิกถอนเฉพาะ auth/consent ของ wallet นี้ที่ร้าน ไม่ลบโปรไฟล์ ประวัติ หรือสิทธิ์ SPL เดิม':'Revoke only this wallet’s authentication/consent at this merchant, not its profile, history or existing SPL permissions.'}</p>
   </>:<>
    {!wallet&&<label>{th?'เลือก wallet':'Choose wallet'}<select value={choice} disabled={locked} onChange={event=>setChoice(event.target.value)}><option value="">{th?'เลือก wallet':'Select wallet'}</option>{choices.map((candidate,index)=><option key={index} value={candidate.name}>{candidate.name}</option>)}</select></label>}
    {wallet?.supportsMessageSigning===false&&<p role="status">{th?'wallet หรือบัญชีนี้ไม่รองรับ Solana signMessage จึงรับข้อเสนอส่วนตัวไม่ได้ แต่ยังชำระตามปกติได้':'This wallet/account lacks Solana signMessage. Personal offers are unavailable; normal payment still works.'}</p>}
    {!wallet&&!choices.length&&<p>{th?'ยังไม่พบ wallet เปิดลิงก์นี้ในเบราว์เซอร์ wallet ที่รองรับการลงนามข้อความ หรือจ่ายตามปกติ':'No wallet discovered. Open this exact link in a wallet browser supporting signMessage, or continue normal payment.'}</p>}
    <label><input type="checkbox" checked={consent} disabled={locked} onChange={event=>setConsent(event.target.checked)}/>{CUSTOMER_CONSENT_DISCLOSURE[lang]} <small>({CUSTOMER_CONSENT_VERSION})</small></label>
    <button className="secondary" disabled={locked||!consent||wallet?.supportsMessageSigning===false||(!wallet&&!choice)} onClick={()=>void run(verify)}>{busy?(th?'รอการยืนยัน…':'Please wait…'):(th?'ลงนามข้อความและยืนยันความยินยอม':'Sign message & confirm consent')}</button>
   </>}
   {session?.walletAddress===wallet?.address&&wallet?.fixture&&<p className="fixture">TEST WALLET FIXTURE — browser automation only, not a real mobile test</p>}
   {notice&&<p role="status">{notice}</p>}{error&&<p className="error" role="alert">{error} {th?'การจ่ายตามปกติยังใช้งานได้':'Normal payment remains available.'}</p>}
  </div>
 </details>;
}
