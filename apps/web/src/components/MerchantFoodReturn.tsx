import {useEffect,useMemo,useRef,useState} from 'react';
import type {Session} from '../lib/table';
import {MerchantFoodReturn as ReturnService,type PendingMerchantReturn} from '../lib/merchant-food-return';
import type {FoodReturnSnapshot,FoodReturnExecution} from '../../../../packages/contracts/src/mobile-v1.generated';
import {errorMessage} from '../lib/api';
import {formatMoney} from '../lib/money';
export default function MerchantFoodReturn({session,orderId,assignmentId,language,onChange}:{session:Session;orderId:string;assignmentId?:string;language:'th'|'en';onChange:()=>void}){
 const alive=useRef(true),running=useRef(false);
 const service=useMemo(()=>new ReturnService(session,orderId,()=>alive.current),[session,orderId]);
 const [execution,setExecution]=useState<FoodReturnExecution|null>(null);
 const [executionError,setExecutionError]=useState('');
 const [snapshot,setSnapshot]=useState<FoodReturnSnapshot|null>(null),[pending,setPending]=useState<PendingMerchantReturn|null>(null),[reason,setReason]=useState(''),[condition,setCondition]=useState<'SEALED'|'OPENED'|'DAMAGED'>('SEALED'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
 const t=(th:string,en:string)=>language==='th'?th:en;
 const [readError,setReadError]=useState('');
 useEffect(()=>{alive.current=true;try{setPending(service.pending());}catch(e){setError(errorMessage(e));}return()=>{alive.current=false;};},[service]);
 useEffect(()=>{
  let current=true,reading=false;
  const refresh=async()=>{
   if(running.current||reading)return;
   reading=true;
   try{
    const saved=service.pending(),selected=saved?.assignmentId??assignmentId;
    if(current)setPending(saved);
    if(selected){const value=await service.snapshot(selected);if(current)setSnapshot(value);}
    if(current)setReadError('');
   }catch(e){if(current)setReadError(errorMessage(e));}
   finally{reading=false;}
  };
  void refresh();
  const timer=setInterval(()=>void refresh(),10000);
  return()=>{current=false;clearInterval(timer);};
 },[service,assignmentId]);
 async function run(command?:PendingMerchantReturn){
  if(running.current)return;running.current=true;setBusy(true);setError('');
  try{if(command){await service.receive(command);if(!alive.current)return;setDone(true);setReason('');onChange();}
   const selected=command?.assignmentId??pending?.assignmentId??assignmentId;
   if(selected){const value=await service.snapshot(selected);if(alive.current){setSnapshot(value);setReadError('');}}
  }catch(e){if(alive.current)setError(errorMessage(e));}finally{running.current=false;if(alive.current){setBusy(false);try{setPending(service.pending());}catch(e){setError(errorMessage(e));}}}
 }
 async function readExecution(){if(running.current)return;running.current=true;setBusy(true);setExecutionError('');setExecution(null);try{const value=await service.execution();if(alive.current)setExecution(value.execution);}catch(e){if(alive.current)setExecutionError(errorMessage(e));}finally{running.current=false;if(alive.current)setBusy(false);}}
 const record=snapshot?.case;
 return <>
 <details className="bill-details"><summary>{t('สถานะการคืนเงิน','Refund execution status')}</summary>
 <button disabled={busy} onClick={()=>void readExecution()}>{t('ตรวจผลคืนเงินของออเดอร์','Check order refund execution')}</button>
 {execution&&<p role="status">{execution.state==='SELECTED_FINALIZED'?t('ยืนยันคืนเฉพาะรายการที่เลือก ไม่ใช่ยอดชำระทั้งหมด','Selected line refunded; not all original payments'):execution.state==='FINALIZED'?t('ยืนยันคืนครบจากหลักฐานแล้ว','All payments refunded with finalized evidence'):execution.state==='RECONCILIATION_REQUIRED'?t('ผลคืนเงินต้องตรวจสอบ ยังยืนยันว่าคืนครบไม่ได้','Reconciliation required; refund completion unconfirmed'):execution.state==='PARTIAL'?t('ยืนยันคืนบางรายการ ยังไม่ครบ','Some payments refunded; incomplete'):t('ยังไม่มีหลักฐานยืนยันคืนครบ','Full refund completion unconfirmed')} · {execution.finalizedCount}/{execution.allocationCount}{execution.selectedRefund&&<> · {formatMoney(execution.selectedRefund.refundAmount)}</>}</p>}
 {executionError&&<div role="alert"><p>{t('ตรวจผลคืนเงินไม่สำเร็จ ลองตรวจอีกครั้ง','Could not check refund execution. Try again.')}</p><details><summary>{t('รายละเอียด','Details')}</summary>{executionError}</details></div>}
 </details>
 {(record||pending||error||readError||done)&&<details className="bill-details" open={pending?true:undefined}><summary>{pending?t('ต้องกู้คำขอรับอาหารคืนเดิม','Unresolved food return · recovery required'):t('รับอาหารคืนที่ร้าน','Receive returned food')}</summary>
 <section aria-label={t('รับอาหารคืนที่ร้าน','Receive returned food')}>
 <p>{t('บันทึกเฉพาะอาหารที่ได้รับคืนจริง ไม่คืน stock ไม่คืนเงิน และยังไม่ปิดหน้าที่ไรเดอร์','Record food physically received back only. This does not restore stock, refund payment or close rider duty.')}</p>
 {error&&<div role="alert"><p>{t('ทำคำขอไม่สำเร็จ ตรวจสถานะก่อนลองอีกครั้ง','Could not complete the request. Check its status before retrying.')}</p><details><summary>{t('รายละเอียด','Details')}</summary>{error}</details></div>}{done&&<p role="status">{t('บันทึกรับคืนแล้ว รอเจ้าหน้าที่ตรวจและปิดหน้าที่','Receipt recorded. Awaiting staff review and duty closure.')}</p>}
 {readError&&<div role="alert">{t('ตรวจสถานะคืนอาหารไม่สำเร็จ ลองตรวจอีกครั้ง คำขอเดิมยังคงอยู่','Could not check food return. Retry; saved commands are retained.')}<details><summary>{t('รายละเอียดการเชื่อมต่อ','Connection details')}</summary>{readError}</details></div>}
 {pending&&<button disabled={busy} onClick={()=>void run(pending)}>{t('กู้คำสั่งรับคืนเดิม','Recover original receipt command')}</button>}
 <button disabled={busy||!assignmentId&&!pending} onClick={()=>void run()}>{t('ตรวจคำสั่งคืนอาหาร','Check return request')}</button>
 {snapshot&&<p>{record?({RETURN_REQUESTED:t('รอรับอาหารคืนที่ร้าน','Food return requested'),RETURN_RECORDED:t('บันทึกได้รับอาหารคืนแล้ว','Food return recorded'),RETURN_RESOLVED:t('ตรวจสอบและปิดคำขอคืนแล้ว','Food return resolved')} as Record<string,string>)[record.state]??t('ตรวจสอบสถานะการคืนอาหาร','Check food return status'):t('ยังไม่มีคำสั่งคืนอาหาร','No return requested')}</p>}
 {record?.state==='RETURN_REQUESTED'&&snapshot&&<form onSubmit={e=>{e.preventDefault();void run({assignmentId:snapshot.assignmentId,caseId:record.caseId,command:{idempotencyKey:crypto.randomUUID(),expectedVersion:snapshot.shipmentVersion,condition,reason:reason.trim()}});}}>
 <label>{t('สภาพอาหารที่ได้รับคืน','Received food condition')}<select value={condition} disabled={busy||!!pending} onChange={e=>setCondition(e.target.value as typeof condition)}><option value="SEALED">{t('ปิดผนึก','Sealed')}</option><option value="OPENED">{t('เปิดแล้ว','Opened')}</option><option value="DAMAGED">{t('เสียหาย','Damaged')}</option></select></label>
 <label>{t('รายละเอียดรับคืน','Receipt details')}<textarea required maxLength={500} value={reason} disabled={busy||!!pending} onChange={e=>setReason(e.target.value)}/></label>
 <button disabled={busy||!!pending||!reason.trim()}>{t('ยืนยันได้รับอาหารคืนจริง','Confirm food physically received back')}</button></form>}
 </section></details>}
 </>;
}
