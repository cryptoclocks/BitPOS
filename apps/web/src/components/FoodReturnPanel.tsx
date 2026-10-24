import FoodReturnFinancialPanel from './FoodReturnFinancialPanel';
import {useEffect,useRef,useState} from 'react';
import type {FoodReturnSnapshot} from '../../../../packages/contracts/src/mobile-v1.generated';
import {FoodReturnSession,type PendingFoodReturn} from '../lib/food-return-session';
import {PlatformError} from '../lib/platform-session';
export default function FoodReturnPanel({service,assignmentId,generation,leaseGeneration,thai,disabled,onChanged,canFinance=false}:{service:FoodReturnSession;assignmentId:string;generation:string;leaseGeneration:string;thai:boolean;disabled:boolean;onChanged:()=>Promise<void>;canFinance?:boolean}){
 const [snapshot,setSnapshot]=useState<FoodReturnSnapshot|null>(null),[pending,setPending]=useState<PendingFoodReturn|null>(()=>service.pendingReturn()),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const alive=useRef(true),running=useRef(false);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const t=(th:string,en:string)=>thai?th:en;
 async function run(command?:PendingFoodReturn){
  if(running.current||disabled)return;running.current=true;setBusy(true);setError('');
  try{
   if(command){const result=await service.submitReturn(command);if(!alive.current)return;setMessage(result.kind==='REQUEST'?t('สั่งคืนอาหารแล้ว รอร้านบันทึกรับคืน','Return requested. Awaiting merchant receipt.'):t('ปิดหน้าที่แล้ว การเงินรอตรวจ ยังไม่มีการคืนเงินหรือคืน stock','Duty closed. Financial review pending; no refund or stock restoration.'));setReason('');}
   const result=await service.returnSnapshot(assignmentId);if(alive.current)setSnapshot(result);
   if(command&&alive.current)await onChanged();
  }catch(e){if(alive.current)setError(e instanceof PlatformError?e.code:t('ยังไม่ทราบผล โปรดกู้คำสั่งเดิม','Outcome unknown. Recover the original command.'));}
  finally{running.current=false;if(alive.current){setBusy(false);if(service.accountId)setPending(service.pendingReturn());}}
 }
 const blocked=disabled||busy,record=snapshot?.case;
 return <section aria-label={t('คืนอาหารที่ร้าน','Return food to merchant')}>
  <h3>{t('คืนอาหารที่ร้าน','Return food to merchant')}</h3>
  <p>{t('ร้านต้องบันทึกรับคืนและเจ้าหน้าที่รับทราบเหตุทั้งหมดก่อนปิดหน้าที่ การคืนเงินพิจารณาแยก','Merchant receipt and acknowledgement of all blocking incidents are required before duty closure. Refunds are reviewed separately.')}</p>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {pending&&<aside><p>{t('มีคำสั่งคืนอาหารค้าง ต้องกู้คำสั่งเดิมก่อน','An unresolved return command must be recovered first.')}</p><button disabled={blocked} onClick={()=>void run(pending)}>{t('กู้คำสั่งคืนอาหารเดิม','Recover original return command')}</button></aside>}
  <button disabled={blocked} onClick={()=>void run()}>{t('ตรวจสถานะคืนอาหาร','Check return status')}</button>
  {canFinance&&record?.state==='RETURN_RESOLVED'&&<FoodReturnFinancialPanel key={record.caseId} service={service} caseId={record.caseId} thai={thai} disabled={blocked||!!pending}/>}
  {snapshot&&<>
   <p>{record?record.state:t('ยังไม่มีคำสั่งคืนอาหาร','No return requested')}</p>
   {record?.receivedAt&&<p>{t('ร้านรับคืนเมื่อ','Merchant received at')}: {new Date(record.receivedAt).toLocaleString(thai?'th-TH':'en-GB')}</p>}
   {record?.custodyReleased&&<p>{t('ปิดหน้าที่ดูแลอาหารแล้ว การเงินรอตรวจ','Custody released; financial review pending')}</p>}
   <label>{t('เหตุผลการคืนอาหาร / ปิดหน้าที่','Return / duty closure reason')}<textarea maxLength={500} value={reason} disabled={blocked||!!pending} onChange={e=>setReason(e.target.value)}/></label>
   {!record&&<button disabled={blocked||!!pending||!reason.trim()} onClick={()=>void run({kind:'REQUEST',assignmentId,command:{idempotencyKey:crypto.randomUUID(),expectedVersion:snapshot.shipmentVersion,generation,leaseGeneration,reason:reason.trim()}})}>{t('สั่งคืนอาหารที่ร้าน','Request return to merchant')}</button>}
   {record?.state==='RETURN_RECORDED'&&<button disabled={blocked||!!pending||!reason.trim()} onClick={()=>void run({kind:'RESOLVE',assignmentId,caseId:record.caseId,command:{idempotencyKey:crypto.randomUUID(),expectedVersion:snapshot.shipmentVersion,reason:reason.trim()}})}>{t('ยืนยันปิดหน้าที่หลังร้านรับคืน','Close duty after merchant receipt')}</button>}
  </>}
 </section>;
}
