import {useEffect,useRef,useState} from 'react';
import {FoodReturnSession,type PendingRefundReconciliation} from '../lib/food-return-session';
import {PlatformError} from '../lib/platform-session';
import type {FoodReturnFinancialSnapshot} from '../../../../packages/contracts/src/mobile-v1.generated';
export default function RefundReconciliationPanel({service,caseId,thai,disabled,onReconciled}:{service:FoodReturnSession;caseId:string;thai:boolean;disabled:boolean;onReconciled?:()=>Promise<void>}){
 const [snapshot,setSnapshot]=useState<FoodReturnFinancialSnapshot|null>(null),[pending,setPending]=useState<PendingRefundReconciliation|null>(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<number|null>(null);
 const alive=useRef(true),running=useRef(false);const t=(th:string,en:string)=>thai?th:en;
 useEffect(()=>{alive.current=true;try{setPending(service.pendingReconciliation());}catch{setError(t('อ่านคำสั่งค้างไม่ได้','Saved command unavailable'));}return()=>{alive.current=false;};},[service]);
 async function run(command?:PendingRefundReconciliation){
  if(disabled||running.current)return;running.current=true;setBusy(true);setError('');setResult(null);let acknowledged=false;
  try{if(command){const receipt=await service.reconcilePayments(command);if(!alive.current)return;acknowledged=true;setResult(receipt.addedPaymentCount);setReason('');await onReconciled?.();if(!alive.current)return;}
   const current=await service.financialSnapshot(caseId);if(alive.current)setSnapshot(current);
  }catch(e){if(alive.current){setSnapshot(null);setError(acknowledged?t('บันทึกสำเร็จแล้ว แต่โหลดสถานะล่าสุดไม่ได้ กรุณาโหลดสถานะอีกครั้ง','Reconciliation recorded. Latest status unavailable; reload the current review.'):e instanceof PlatformError?e.code:t('ยังไม่ทราบผล กรุณากู้คำสั่งเดิม','Outcome unknown. Recover original command.'));}}
  finally{running.current=false;if(alive.current){setBusy(false);if(service.accountId)try{setPending(service.pendingReconciliation());}catch{setError(t('อ่านคำสั่งค้างไม่ได้','Saved command unavailable'));}}}
 }
 const blocked=disabled||busy;
 return <section aria-label={t('ตรวจรายการเงินเข้าเพิ่ม','Reconcile additional payments')}><h4>{t('ตรวจรายการเงินเข้าเพิ่ม','Reconcile additional payments')}</h4><p>{t('เพิ่มภาระที่ขาดจากรายการรับเงินจริงฝั่งเซิร์ฟเวอร์เท่านั้น ไม่แก้คำอนุมัติเดิมและไม่โอนเงิน','Add missing obligations from server payment facts only. Original approval stays unchanged; no transfer is made.')}</p>
 {error&&<p role="alert">{error}</p>}{result!==null&&<p role="status">{t('เพิ่มภาระ','Obligations added')}: {result} · {t('ยังไม่ยืนยันโอนคืน','Transfer not confirmed')}</p>}
 {pending&&<button disabled={blocked} onClick={()=>void run(pending)}>{t('กู้คำสั่งตรวจเงินเข้าเดิม','Recover original payment reconciliation')}</button>}
 <button disabled={blocked} onClick={()=>void run()}>{t('โหลดสถานะก่อนตรวจเงินเข้า','Load current payment review')}</button>
 {snapshot?.decision?.decision==='FULL_REFUND'&&<form onSubmit={e=>{e.preventDefault();void run({caseId,command:{idempotencyKey:crypto.randomUUID(),expectedVersion:snapshot.shipmentVersion,reason:reason.trim()}});}}><label>{t('เหตุผลการตรวจรายการเพิ่ม','Reconciliation reason')}<textarea required maxLength={500} disabled={blocked||!!pending} value={reason} onChange={e=>setReason(e.target.value)}/></label><button disabled={blocked||!!pending||!reason.trim()}>{t('เพิ่มภาระคืนเงินที่ขาด ไม่โอนเงิน','Add missing refund obligations without transfer')}</button></form>}
 </section>;
}
