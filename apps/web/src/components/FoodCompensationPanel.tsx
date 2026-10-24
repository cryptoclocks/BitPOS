import {useEffect,useRef,useState} from 'react';
import {FoodReturnSession,type PendingFoodCompensation} from '../lib/food-return-session';
import {PlatformError} from '../lib/platform-session';
import type {FoodCompensationSnapshot,FoodCompensationExecution} from '../../../../packages/contracts/src/mobile-v1.generated';
import {MobileMoneySchema} from '../../../../packages/contracts/src/mobile-v1.generated';
import {formatMoney} from '../lib/money';
export default function FoodCompensationPanel({service,caseId,thai,disabled}:{service:FoodReturnSession;caseId:string;thai:boolean;disabled:boolean}){
 const [execution,setExecution]=useState<FoodCompensationExecution|null>(null);
 const [snapshot,setSnapshot]=useState<FoodCompensationSnapshot|null>(null),[pending,setPending]=useState<PendingFoodCompensation|null>(null),[policy,setPolicy]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const alive=useRef(true),running=useRef(false);const t=(th:string,en:string)=>thai?th:en;
 useEffect(()=>{alive.current=true;try{setPending(service.pendingCompensation());}catch{setError(t('อ่านคำสั่งค้างไม่ได้','Saved command unavailable'));}return()=>{alive.current=false;};},[service]);
 async function run(command?:PendingFoodCompensation){
  if(disabled||running.current)return;running.current=true;setBusy(true);setError('');setSnapshot(null);setExecution(null);let acknowledged=false;
  try{if(command){await service.approveCompensation(command);acknowledged=true;if(!alive.current)return;setPolicy('');setReason('');}const value=await service.compensationSnapshot(caseId);if(alive.current)setSnapshot(value);}
  catch(e){if(alive.current)setError(acknowledged?t('อนุมัติแล้ว แต่โหลดสถานะล่าสุดไม่ได้','Approval recorded. Latest status unavailable.'):e instanceof PlatformError?e.code:t('ยังไม่ทราบผล ให้กู้คำสั่งเดิม','Outcome unknown. Recover original command.'));}
  finally{running.current=false;if(alive.current){setBusy(false);if(service.accountId)try{setPending(service.pendingCompensation());}catch{setError(t('อ่านคำสั่งค้างไม่ได้','Saved command unavailable'));}}}
 }
 async function loadExecution(){
  if(disabled||running.current)return;running.current=true;setBusy(true);setError('');setExecution(null);
  try{const value=await service.compensationExecution(caseId);if(alive.current)setExecution(value);}catch(e){if(alive.current){setSnapshot(null);setError(e instanceof PlatformError?e.code:t('ตรวจผลไม่ได้','Execution status unavailable'));}}finally{running.current=false;if(alive.current)setBusy(false);}
 }
 const labels:Record<string,string>={NOT_DECIDED:t('ยังไม่อนุมัติค่าชดเชย','Compensation not decided'),ZERO_APPROVED:t('อนุมัติศูนย์ ไม่มีการโอน','Zero compensation approved; no transfer'),PENDING:t('รอดำเนินการ ยังไม่ยืนยันโอน','Compensation pending; transfer not confirmed'),FUNDING_REQUIRED:t('รอเงินสำรอง ยังไม่ยืนยันโอน','Compensation funding required; transfer not confirmed'),PREPARED:t('เตรียมธุรกรรมแล้ว ยังไม่ยืนยันโอน','Compensation prepared; transfer not confirmed'),UNKNOWN:t('ยังไม่ทราบผลโอน รอตรวจสอบ','Compensation outcome unknown; reconciliation pending'),FINALIZED:t('ยืนยันโอนค่าชดเชยจาก finalized แล้ว','Compensation finalized; transfer verified'),FAILED:t('โอนค่าชดเชยล้มเหลว รอตรวจสอบ','Compensation transfer failed; review required'),RECONCILIATION_REQUIRED:t('ผลค่าชดเชยขัดแย้ง ต้องตรวจสอบ','Compensation requires reconciliation; completion unconfirmed')};
 const blocked=disabled||busy;
 return <section aria-label={t('ค่าชดเชยไรเดอร์','Rider compensation')}><h4>{t('ค่าชดเชยไรเดอร์','Rider compensation')}</h4><p>{t('แยกจากรายได้ส่งสำเร็จ การอนุมัติยังไม่ยืนยันการโอนเงิน','Separate from completed delivery earnings. Approval does not confirm a transfer.')}</p>
 {error&&<p role="alert">{error}</p>}{pending&&<button disabled={blocked} onClick={()=>void run(pending)}>{t('กู้คำอนุมัติค่าชดเชยเดิม','Recover original compensation approval')}</button>}
 <button disabled={blocked} onClick={()=>void loadExecution()}>{t('ตรวจผลโอนค่าชดเชย','Check compensation execution')}</button>{execution&&<p role="status">{labels[execution.state]}</p>}
 <button disabled={blocked} onClick={()=>void run()}>{t('โหลดค่าชดเชย','Load compensation review')}</button>
 {snapshot?.decision?<p role="status">{t('อนุมัติค่าชดเชยแล้ว','Compensation approved')}: {formatMoney(MobileMoneySchema.parse({currency:snapshot.decision.currency,decimals:snapshot.decision.decimals,amountMinor:snapshot.decision.amountMinor}))}</p>:snapshot&&<form onSubmit={e=>{e.preventDefault();if(!snapshot.policies.some(p=>p.policyId===policy))return;void run({caseId,command:{idempotencyKey:crypto.randomUUID(),expectedVersion:snapshot.shipmentVersion,policyId:policy,reason:reason.trim()}});}}>
 {snapshot.policies.length===0&&<p>{t('ยังไม่มีนโยบายที่ใช้ได้','No eligible compensation policy')}</p>}
 <label>{t('นโยบายค่าชดเชย','Compensation policy')}<select required disabled={blocked||!!pending} value={policy} onChange={e=>setPolicy(e.target.value)}><option value="">{t('เลือกนโยบาย','Choose policy')}</option>{snapshot.policies.map(p=><option key={p.policyId} value={p.policyId}>{p.returnedRateBps/100}% · {t('สูงสุด','Cap')} {formatMoney(MobileMoneySchema.parse({currency:p.currency,decimals:p.decimals,amountMinor:p.maxMinor}))} · {p.policyId}</option>)}</select></label>
 <label>{t('เหตุผล','Compensation reason')}<textarea required maxLength={500} disabled={blocked||!!pending} value={reason} onChange={e=>setReason(e.target.value)}/></label><button disabled={blocked||!!pending||!policy||!reason.trim()}>{t('อนุมัติค่าชดเชย ไม่โอนเงิน','Approve compensation without transfer')}</button></form>}
 </section>;
}
