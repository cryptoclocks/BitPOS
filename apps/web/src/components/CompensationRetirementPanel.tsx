import {useEffect,useRef,useState} from 'react';
import {FoodReturnSession,type PendingCompensationRetirement} from '../lib/food-return-session';
import {PlatformError} from '../lib/platform-session';
import type {FoodCompensationSnapshot} from '../../../../packages/contracts/src/mobile-v1.generated';
export default function CompensationRetirementPanel({service,caseId,thai,disabled}:{service:FoodReturnSession;caseId:string;thai:boolean;disabled:boolean}){
 const [snapshot,setSnapshot]=useState<FoodCompensationSnapshot|null>(null),[pending,setPending]=useState<PendingCompensationRetirement|null>(null),[policy,setPolicy]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState('');
 const alive=useRef(true),running=useRef(false),t=(th:string,en:string)=>thai?th:en;
 useEffect(()=>{alive.current=true;try{setPending(service.pendingCompensationRetirement());}catch{setError(t('อ่านคำสั่งค้างไม่ได้','Saved command unavailable'));}return()=>{alive.current=false;};},[service]);
 async function run(command?:PendingCompensationRetirement){
  if(disabled||running.current)return;running.current=true;setBusy(true);setError('');setSnapshot(null);setResult('');let acknowledged=false;
  try{if(command){const receipt=await service.retireCompensation(command);acknowledged=true;if(!alive.current)return;setResult(receipt.policyId);setReason('');setPolicy('');}const current=await service.compensationSnapshot(caseId);if(alive.current)setSnapshot(current);}
  catch(e){if(alive.current)setError(acknowledged?t('เลิกใช้นโยบายแล้ว แต่โหลดสถานะล่าสุดไม่ได้','Policy retired. Latest status unavailable.'):e instanceof PlatformError?e.code:t('ยังไม่ทราบผล ให้กู้คำสั่งเดิม','Outcome unknown. Recover original command.'));}
  finally{running.current=false;if(alive.current){setBusy(false);if(service.accountId)try{setPending(service.pendingCompensationRetirement());}catch{setError(t('อ่านคำสั่งค้างไม่ได้','Saved command unavailable'));}}}
 }
 const blocked=disabled||busy;
 return <section aria-label={t('เลิกใช้นโยบายค่าชดเชย','Compensation policy retirement')}><h4>{t('เลิกใช้นโยบายค่าชดเชย','Compensation policy retirement')}</h4><p>{t('หยุดใช้กับคำอนุมัติใหม่ ประวัติและค่าชดเชยที่อนุมัติแล้วคงเดิม ไม่โอนเงิน','Stop new approvals using this policy. Historical approvals stay unchanged; no transfer is made.')}</p>
 {error&&<p role="alert">{error}</p>}{result&&<p role="status">{t('เลิกใช้นโยบายแล้ว','Policy retired')}: {result}</p>}
 {pending&&<button disabled={blocked} onClick={()=>void run(pending)}>{t('กู้คำสั่งเลิกใช้นโยบายเดิม','Recover original policy retirement')}</button>}
 <button disabled={blocked} onClick={()=>void run()}>{t('โหลดนโยบายที่ยังใช้ได้','Load active compensation policies')}</button>
 {snapshot&&<form onSubmit={e=>{e.preventDefault();if(!snapshot.policies.some(p=>p.policyId===policy))return;void run({caseId,command:{idempotencyKey:crypto.randomUUID(),expectedVersion:snapshot.shipmentVersion,policyId:policy,reason:reason.trim()}});}}>
 {snapshot.policies.length===0&&<p>{t('ไม่มีนโยบายที่ยังใช้ได้','No active compensation policies')}</p>}
 <label>{t('นโยบายที่จะเลิกใช้','Policy to retire')}<select required disabled={blocked||!!pending} value={policy} onChange={e=>setPolicy(e.target.value)}><option value="">{t('เลือกนโยบาย','Choose policy')}</option>{snapshot.policies.map(p=><option key={p.policyId} value={p.policyId}>{p.policyId}</option>)}</select></label>
 <label>{t('เหตุผล','Retirement reason')}<textarea required maxLength={500} value={reason} disabled={blocked||!!pending} onChange={e=>setReason(e.target.value)}/></label><button disabled={blocked||!!pending||!policy||!reason.trim()}>{t('เลิกใช้นโยบายนี้','Retire selected policy')}</button></form>}
 </section>;
}
