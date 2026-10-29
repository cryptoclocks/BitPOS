import CompensationRetirementPanel from './CompensationRetirementPanel';
import CompensationPolicyPanel from './CompensationPolicyPanel';
import FoodCompensationPanel from './FoodCompensationPanel';
import RefundReconciliationPanel from './RefundReconciliationPanel';
import {useEffect,useRef,useState} from 'react';
import type {FoodReturnFinancialSnapshot,FoodReturnExecution} from '../../../../packages/contracts/src/mobile-v1.generated';
import {FoodReturnSession,type PendingFoodReturnFinancial} from '../lib/food-return-session';
import {PlatformError} from '../lib/platform-session';
import {formatMoney} from '../lib/money';
export default function FoodReturnFinancialPanel({service,caseId,thai,disabled}:{service:FoodReturnSession;caseId:string;thai:boolean;disabled:boolean}){
 const [execution,setExecution]=useState<FoodReturnExecution|null>(null);
 const [snapshot,setSnapshot]=useState<FoodReturnFinancialSnapshot|null>(null),[pending,setPending]=useState<PendingFoodReturnFinancial|null>(null),[choice,setChoice]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [selectedLine,setSelectedLine]=useState('');
 const alive=useRef(true),running=useRef(false);const t=(th:string,en:string)=>thai?th:en;
 useEffect(()=>{alive.current=true;try{setPending(service.pendingFinancial());}catch{setError(t('อ่านคำสั่งค้างไม่ได้ ห้ามสร้างคำสั่งทดแทน','Saved command unavailable. Do not replace it.'));}return()=>{alive.current=false;};},[service]);
 async function run(command?:PendingFoodReturnFinancial){
  if(running.current||disabled)return;running.current=true;setBusy(true);setError('');setExecution(null);setSnapshot(null);
  try{if(command){await service.decideFinancial(command);if(!alive.current)return;setChoice('');setReason('');}
   const result=await service.financialSnapshot(caseId);if(alive.current)setSnapshot(result);
  }catch(e){if(alive.current){setSnapshot(null);setExecution(null);setError(e instanceof PlatformError?e.code:t('ยังไม่ทราบผล โปรดกู้คำสั่งเดิม','Outcome unknown. Recover original decision.'));}}
  finally{running.current=false;if(alive.current){setBusy(false);if(service.accountId)try{setPending(service.pendingFinancial());}catch{setError(t('อ่านคำสั่งค้างไม่ได้','Saved command unavailable'));}}}
 }
 async function loadExecution(){if(running.current||disabled)return;running.current=true;setBusy(true);setError('');setExecution(null);try{const value=await service.executionSnapshot(caseId);if(alive.current)setExecution(value);}catch(e){if(alive.current){setExecution(null);if(e instanceof PlatformError&&[401,403,404].includes(e.status)){setSnapshot(null);setChoice('');setReason('');}setError(e instanceof PlatformError?e.code:t('ตรวจผลไม่ได้','Execution status unavailable'));}}finally{running.current=false;if(alive.current)setBusy(false);}}
 async function refreshAfterReconciliation(){
  const refreshExecution=execution!==null;setExecution(null);setSnapshot(null);setError('');
  try{const current=await service.financialSnapshot(caseId);if(!alive.current)return;setSnapshot(current);if(refreshExecution){const next=await service.executionSnapshot(caseId);if(alive.current)setExecution(next);}}
  catch(e){if(alive.current){setSnapshot(null);setExecution(null);setError(e instanceof PlatformError?e.code:t('ตรวจผลไม่ได้','Execution status unavailable'));}throw e;}
 }
 const blocked=disabled||busy;
 const selectedFact=snapshot?.decision?.decision==='LINE_REFUND'?snapshot.decision.selection:snapshot?.lines.find(line=>line.lineId===selectedLine);
 return <section aria-label={t('ตรวจการเงินหลังคืนอาหาร','Returned food financial review')}><h3>{t('ตรวจการเงินหลังคืนอาหาร','Returned food financial review')}</h3>
 <p>{t('ผู้ดูแลที่มีสิทธิ์ในร้านเท่านั้น การอนุมัติเป็นคำสั่งรอดำเนินการ ไม่ยืนยันโอนคืน และไม่คืน stock','Scoped administrators only. Approval remains pending execution; it does not confirm a refund transfer or restore stock.')}</p>
 {error&&<p role="alert">{error}</p>}
 {pending&&<aside><p>{t('มีคำสั่งการเงินค้าง','Unresolved financial decision')} · {pending.caseId}</p><button disabled={blocked} onClick={()=>void run(pending)}>{t('กู้คำตัดสินการเงินเดิม','Recover original financial decision')}</button></aside>}
 <button disabled={blocked} onClick={()=>void run()}>{t('โหลดการตรวจการเงิน','Load financial review')}</button>
 <button disabled={blocked} onClick={()=>void loadExecution()}>{t('ตรวจผลคืนเงินจริง','Check refund execution')}</button>
 {execution&&<aside role="status"><p>{({NOT_DECIDED:t('ยังไม่ตัดสินการเงิน','Financial decision not recorded'),NOT_REQUESTED:t('ไม่ได้ร้องขอโอนคืน','No refund transfer requested'),PENDING:t('รอดำเนินการ ยังไม่ยืนยันโอนคืน','Execution pending; transfer not confirmed'),PARTIAL:t('ยืนยันคืนบางรายการ ยังไม่ครบ','Some payments refunded; incomplete'),FAILED:t('การโอนล้มเหลว รอตรวจสอบ','Transfer failed; review required'),FINALIZED:t('ยืนยันคืนครบจากหลักฐาน finalized','All payments refunded with finalized evidence'),SELECTED_FINALIZED:t('ยืนยันคืนเฉพาะรายการที่เลือก ไม่ใช่ยอดชำระทั้งหมด','Selected line refunded; not all original payments'),RECONCILIATION_REQUIRED:t('ผลหรือรายการชำระต้องตรวจสอบ ห้ามถือว่าคืนครบแล้ว','Payments or outcomes require reconciliation; refund completion is unconfirmed')})[execution.state]}</p>{execution.selectedRefund&&<p>{t('ยอดคืนรายการที่เลือก','Selected line refund')}: {formatMoney(execution.selectedRefund.refundAmount)}</p>}<p>{t('ยืนยันแล้ว / รายการจัดสรรคืน','Finalized / refund allocations')}: {execution.finalizedCount} / {execution.allocationCount}</p></aside>}

 <CompensationRetirementPanel key={'retirement:'+caseId} service={service} caseId={caseId} thai={thai} disabled={blocked||!!pending}/>
 <CompensationPolicyPanel key={'policy:'+caseId} service={service} caseId={caseId} thai={thai} disabled={blocked||!!pending}/>
 <FoodCompensationPanel key={'compensation:'+caseId} service={service} caseId={caseId} thai={thai} disabled={blocked||!!pending}/>
 <RefundReconciliationPanel key={caseId} service={service} caseId={caseId} thai={thai} disabled={blocked||!!pending} onReconciled={refreshAfterReconciliation}/>
 {snapshot&&<><p>{t('ยอดออเดอร์เดิม ไม่ใช่ยอดโอนคืน','Original order total, not refund transfer amount')}: {formatMoney(snapshot.catalogTotal)}</p><p>{t('รายการรับชำระที่ตรวจพบ','Recorded payments')}: {snapshot.paymentCount}</p>
 {!snapshot.decision&&snapshot.lines.length===0&&<p>{t('ยังคืนเฉพาะรายการไม่ได้จากข้อเท็จจริงการชำระเดิม กรุณาตรวจยอดและสินทรัพย์ ยังตรวจคืนเต็มจำนวนได้','Selected-line refund unavailable for these original payment facts. Review amount and asset; full refund review remains available.')}</p>}
 {snapshot.decision?<p role="status">{snapshot.decision.decision==='LINE_REFUND'?`${t('อนุมัติคืนรายการที่เลือก ยังไม่ยืนยันโอนคืน','Selected line approved; transfer not confirmed')}: ${formatMoney(snapshot.decision.selection.refundAmount)}`:snapshot.decision.decision==='FULL_REFUND'?t('อนุมัติคืนเต็มจำนวน รอดำเนินการ ยังไม่ยืนยันโอนคืน','Full refund approved; execution pending. Transfer not confirmed.'):t('ตัดสินไม่คืนเงิน ไม่มีคำสั่งโอนคืน','No refund approved; no transfer requested.')}</p>:<form onSubmit={e=>{e.preventDefault();const common={idempotencyKey:crypto.randomUUID(),expectedVersion:snapshot.shipmentVersion,reason:reason.trim()};if(choice==='LINE_REFUND'){if(!snapshot.lines.some(line=>line.lineId===selectedLine))return;void run({caseId,command:{...common,decision:'LINE_REFUND',lineId:selectedLine}});}else if(choice==='FULL_REFUND'||choice==='NO_REFUND')void run({caseId,command:{...common,decision:choice}});}}>
 <label>{t('คำตัดสิน','Decision')}<select required value={choice} disabled={blocked||!!pending} onChange={e=>setChoice(e.target.value)}><option value="">{t('เลือกคำตัดสิน','Choose decision')}</option><option value="FULL_REFUND">{t('อนุมัติคืนเต็มจำนวน','Approve full refund')}</option><option value="NO_REFUND">{t('ไม่อนุมัติคืนเงิน','Decline refund')}</option>{snapshot.lines.length>0&&<option value="LINE_REFUND">{t('คืนเฉพาะรายการอาหารเดิม ไม่รวมค่าจัดส่ง','Refund original food line excluding delivery fees')}</option>}</select></label>
 {choice==='LINE_REFUND'&&<label>{t('รายการเดิมและยอดคืนที่เซิร์ฟเวอร์คำนวณ','Original line and server-derived refund')}<select required value={selectedLine} style={{maxWidth:'100%',minWidth:0}} disabled={blocked||!!pending} onChange={e=>setSelectedLine(e.target.value)}><option value="">{t('เลือกรายการ','Choose line')}</option>{snapshot.lines.map(line=><option key={line.lineId} value={line.lineId}>{thai?line.name:line.nameEn||line.name} ×{line.qty} · {line.selections.map(option=>`${thai?option.groupName:option.groupNameEn}: ${thai?option.choiceName:option.choiceNameEn} ×${option.qty}`).join(', ')||t('ไม่มีตัวเลือกเพิ่มเติม','No extra options')} · {formatMoney(line.refundAmount)} · {line.lineId}</option>)}</select></label>}
 <label>{t('เหตุผลการตัดสิน','Decision reason')}<textarea required maxLength={500} value={reason} disabled={blocked||!!pending} onChange={e=>setReason(e.target.value)}/></label>
 <button disabled={blocked||!!pending||!choice||!reason.trim()}>{t('บันทึกคำตัดสิน ไม่โอนเงิน','Record decision without transfer')}</button></form>}
 </>}
 {selectedFact&&<details className="bill-details" open><summary>{t('รายการอาหารเดิมที่เลือก','Selected original configured line')}</summary><p>{thai?selectedFact.name:selectedFact.nameEn} ×{selectedFact.qty}</p><p style={{overflowWrap:'anywhere'}}>{t('รหัสรายการเดิม','Original line reference')}: {selectedFact.lineId}</p>{selectedFact.selections.length>0?<ul>{selectedFact.selections.map(option=><li key={`${option.groupId}:${option.choiceId}`}>{thai?option.groupName:option.groupNameEn}: {thai?option.choiceName:option.choiceNameEn} ×{option.qty}</li>)}</ul>:<p>{t('ไม่มีตัวเลือกเพิ่มเติมในรายการเดิม','No extra options in the original line')}</p>}</details>}
 </section>;
}
