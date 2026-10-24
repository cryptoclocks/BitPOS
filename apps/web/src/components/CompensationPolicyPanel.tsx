import {useEffect,useRef,useState} from 'react';
import {FoodReturnSession,type PendingCompensationPublication} from '../lib/food-return-session';
import {PlatformError} from '../lib/platform-session';
export default function CompensationPolicyPanel({service,caseId,thai,disabled}:{service:FoodReturnSession;caseId:string;thai:boolean;disabled:boolean}){
 const [version,setVersion]=useState<string|null>(null),[pending,setPending]=useState<PendingCompensationPublication|null>(null),[rate,setRate]=useState(''),[cap,setCap]=useState(''),[reason,setReason]=useState(''),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(''),[denomination,setDenomination]=useState('');
 const alive=useRef(true),running=useRef(false),t=(th:string,en:string)=>thai?th:en;
 useEffect(()=>{alive.current=true;try{setPending(service.pendingCompensationPublication());}catch{setError(t('อ่านคำสั่งค้างไม่ได้','Saved command unavailable'));}return()=>{alive.current=false;};},[service]);
 async function run(command?:PendingCompensationPublication){
  if(disabled||running.current)return;running.current=true;setBusy(true);setError('');setVersion(null);setResult('');let acknowledged=false;
  try{if(command){const receipt=await service.publishCompensation(command);acknowledged=true;if(!alive.current)return;setResult(receipt.policyId);setReason('');setEnabled(false);}
   const snapshot=await service.compensationSnapshot(caseId);if(alive.current){setVersion(snapshot.shipmentVersion);setDenomination(snapshot.currency+' / '+snapshot.decimals);}
  }catch(e){if(alive.current)setError(acknowledged?t('เผยแพร่แล้ว แต่โหลดสถานะล่าสุดไม่ได้','Policy published. Latest status unavailable.'):e instanceof PlatformError?e.code:t('ยังไม่ทราบผล ให้กู้คำสั่งเดิม','Outcome unknown. Recover original command.'));}
  finally{running.current=false;if(alive.current){setBusy(false);if(service.accountId)try{setPending(service.pendingCompensationPublication());}catch{setError(t('อ่านคำสั่งค้างไม่ได้','Saved command unavailable'));}}}
 }
 const blocked=disabled||busy;
 const valid=/^(0|[1-9][0-9]{0,4})$/.test(rate)&&Number(rate)<=10000&&/^(0|[1-9][0-9]{0,18})$/.test(cap)&&BigInt(cap)<=9223372036854775807n;
 return <section aria-label={t('นโยบายค่าชดเชย','Compensation policy publication')}><h4>{t('นโยบายค่าชดเชย','Compensation policy publication')}</h4><p>{t('สร้าง version ใหม่ ไม่แก้นโยบายเดิมและไม่โอนเงิน นโยบายใหม่ที่ปิดอยู่ไม่ยกเลิก version เก่า','Create a new version without changing prior policies or transferring funds. A disabled new version does not retire earlier versions.')}</p>
 {error&&<p role="alert">{error}</p>}{result&&<p role="status">{t('เผยแพร่นโยบายแล้ว','Policy published')}: {result}</p>}
 {pending&&<button disabled={blocked} onClick={()=>void run(pending)}>{t('กู้คำสั่งเผยแพร่นโยบายเดิม','Recover original policy publication')}</button>}
 <button disabled={blocked} onClick={()=>void run()}>{t('โหลดข้อมูลก่อนสร้างนโยบาย','Load policy publication context')}</button>
 {version&&<form onSubmit={e=>{e.preventDefault();if(!valid)return;void run({caseId,command:{idempotencyKey:crypto.randomUUID(),expectedVersion:version,enabled,returnedRateBps:Number(rate),maxMinor:cap,reason:reason.trim()}});}}>
 <p>{t('สกุลเงินและทศนิยมของ quote','Quote currency and decimals')}: {denomination}</p>
 <label>{t('อัตรา basis points (10000 = 100%)','Rate in basis points (10000 = 100%)')}<input required inputMode="numeric" value={rate} disabled={blocked||!!pending} onChange={e=>setRate(e.target.value)}/></label>
 <label>{t('เพดานหน่วยย่อยจำนวนเต็ม','Cap in integer minor units')}<input required inputMode="numeric" value={cap} disabled={blocked||!!pending} onChange={e=>setCap(e.target.value)}/></label>
 <label><input type="checkbox" checked={enabled} disabled={blocked||!!pending} onChange={e=>setEnabled(e.target.checked)}/>{t('เปิดใช้นโยบายใหม่นี้','Enable this new policy')}</label>
 <label>{t('เหตุผล','Publication reason')}<textarea required maxLength={500} disabled={blocked||!!pending} value={reason} onChange={e=>setReason(e.target.value)}/></label><button disabled={blocked||!!pending||!valid||!reason.trim()}>{t('เผยแพร่ version ใหม่ ไม่โอนเงิน','Publish new policy without transfer')}</button></form>}
 </section>;
}
