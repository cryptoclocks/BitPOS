import {useEffect,useRef,useState} from 'react';
import {FoodMerchantWorkSchema,FoodMerchantProofIssueCommandSchema,FoodProofIssueReceiptSchema,type FoodMerchantWork,type FoodMerchantProofIssueCommand,type FoodProofIssueReceipt} from '../../../../packages/contracts/src/mobile-v1.generated';
import type {Session} from '../lib/table';
import {api,ApiError,errorMessage} from '../lib/api';
import MerchantFoodReturn from './MerchantFoodReturn';
import MerchantIcon from './MerchantIcon';

/** Secrets live only in this mounted, session/order-scoped view. Journal stores command, never secret. */
export default function FoodHandoff({session,orderId,language,onChange}:{session:Session;orderId:string;language:'th'|'en';onChange:()=>void}){
 const t=(th:string,en:string)=>language==='th'?th:en;
 const [work,setWork]=useState<FoodMerchantWork>(),[pending,setPending]=useState<FoodMerchantProofIssueCommand>(),[receipt,setReceipt]=useState<FoodProofIssueReceipt>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [rotationConfirmed,setRotationConfirmed]=useState(false);
 const [readFailure,setReadFailure]=useState<{kind:'denied'|'unavailable'|'connection';detail:string}>();
 const active=useRef(true),running=useRef(false),request=useRef(0);
 const key=`bitpos.pickupProof.${session.merchantId}.${session.userId}.${orderId}`,path=`/orders/${encodeURIComponent(orderId)}/delivery`;
 async function load(){
  const intent=++request.current;
  try{
   const value=FoodMerchantWorkSchema.parse(await api(path,undefined,session.token));
   if(active.current&&intent===request.current){setWork(value);setReadFailure(undefined);setReceipt(current=>current&&value.assignment?.id===current.assignmentId&&value.assignment.pickupProof?.id===current.proofId?current:undefined);}
  }catch(e){
   if(active.current&&intent===request.current){setWork(undefined);setReceipt(undefined);setReadFailure({kind:e instanceof ApiError&&(e.status===401||e.status===403)?'denied':e instanceof ApiError&&['CONFIGURATION_REQUIRED','RESOURCE_NOT_FOUND'].includes(e.code)?'unavailable':'connection',detail:errorMessage(e)});}
  }
 }
 useEffect(()=>{active.current=true;try{const saved=localStorage.getItem(key);setPending(saved?FoodMerchantProofIssueCommandSchema.parse(JSON.parse(saved)):undefined);}catch(e){setError(errorMessage(e));}
  void load();
  const timer=setInterval(()=>{if(!running.current)void load();},10000);
  return()=>{active.current=false;request.current++;clearInterval(timer);};
 },[key,session.token]);
 useEffect(()=>setRotationConfirmed(false),[work?.assignment?.id,work?.assignment?.pickupProof?.id]);
 async function issue(rotate:boolean){if(running.current)return;running.current=true;setBusy(true);setError('');let command=pending;
  try{await navigator.locks.request(key,async()=>{
   if(!active.current)return;
   const retained=localStorage.getItem(key);if(retained)command=FoodMerchantProofIssueCommandSchema.parse(JSON.parse(retained));
   if(!command){const assignment=work?.assignment;if(!assignment)throw new Error('ASSIGNMENT_UNAVAILABLE');command={assignmentId:assignment.id,generation:assignment.generation,leaseGeneration:assignment.leaseGeneration,idempotencyKey:crypto.randomUUID(),rotate};}
   localStorage.setItem(key,JSON.stringify(command));setPending(command);
   try{
    const result=FoodProofIssueReceiptSchema.parse(await api(path+'/pickup-proof',command,session.token));
    localStorage.removeItem(key);if(!active.current)return;setPending(undefined);setReceipt(result);await load();onChange();
   }catch(e){if(e instanceof ApiError&&e.definiteRefusal){localStorage.removeItem(key);if(active.current)setPending(undefined);}throw e;}
  });}catch(e){if(active.current)setError(errorMessage(e));}
  finally{running.current=false;if(active.current)setBusy(false);}
 }
 const assignment=work?.assignment,proof=assignment?.pickupProof,closed=['DELIVERED','CANCELLED','FAILED'].includes(work?.state??'');
 return <aside className="delivery-handoff" aria-label={t('การส่งมอบให้ไรเดอร์','Rider handoff')}>
  {proof&&assignment?.state==='AT_PICKUP'&&!pending&&<label><input type="checkbox" checked={rotationConfirmed} disabled={busy} onChange={event=>setRotationConfirmed(event.target.checked)}/>{t('ยืนยันยกเลิกรหัสเดิมและออกใหม่','Confirm revoking the existing proof and issuing a replacement')}</label>}
  {pending?<button disabled={busy} onClick={()=>void issue(false)}>{t('ลองคำขอเดิมอีกครั้ง','Retry exact proof command')}</button>:assignment?.state==='AT_PICKUP'&&<button disabled={busy||!!proof&&!rotationConfirmed} onClick={()=>void issue(!!proof)}>{proof?t('เปลี่ยนรหัสรับอาหาร','Replace pickup proof'):t('ออกรหัสรับอาหาร','Issue pickup proof')}</button>}
  <h3>{assignment?.state==='AT_PICKUP'?t('คนส่งถึงร้านแล้ว','Rider at store'):assignment?t('การส่งมอบให้ไรเดอร์','Rider handoff'):t('สถานะขนส่ง','Delivery status')}</h3><p>{t('ส่งมอบที่ร้าน ≠ ส่งถึงลูกค้า','Store collection is not customer delivery')}</p>
  {assignment&&<div className="handoff-rider"><span className="handoff-rider-icon" aria-hidden="true"><MerchantIcon name="bike"/></span><div>{assignment.rider?<strong>{t('คนส่ง','Rider')}: {assignment.rider.displayName}</strong>:<strong>{t('ไม่มีชื่อคนส่งที่ยืนยันได้ในขณะนี้','Verified rider display is unavailable right now')}</strong>}{(assignment.state==='ACCEPTED'||assignment.state==='AT_PICKUP')&&<small>{t('ตรวจสอบงานและรหัสก่อนส่งมอบ','Check the assignment and proof before handoff')}</small>}</div></div>}
  {work?<><p>{t('สถานะขนส่ง','Delivery')}: {({
   WAITING_MERCHANT:t('รอร้านจัดเตรียม','Waiting for the kitchen'),
   WAITING_PAYMENT:t('รอยืนยันการชำระเงิน','Waiting for payment confirmation'),
   READY_FOR_DISPATCH:t('กำลังหาคนส่ง','Finding a rider'),
   OFFERING:t('กำลังเสนอให้คนส่ง','Offering the job to riders'),
   ASSIGNED:t('มีคนส่งรับงานแล้ว','Rider assigned'),
   AT_PICKUP:t('คนส่งถึงร้านแล้ว · ตรวจสอบก่อนส่งมอบ','Rider at store · check before handoff'),
   PICKED_UP:t('กำลังจัดส่ง','On the way'),
   AT_DROPOFF:t('คนส่งถึงจุดส่งแล้ว','Rider at destination'),
   DELIVERED:t('ส่งถึงลูกค้าแล้ว','Delivered to customer'),
   CANCELLED:t('ยกเลิกการจัดส่ง','Delivery cancelled'),
   FAILED:t('การจัดส่งมีปัญหา','Delivery needs attention'),
   INCIDENT:t('เกิดปัญหาการจัดส่ง · ต้องตรวจสอบ','Delivery incident · attention required'),
  } as Record<string,string>)[work.state]??t('ตรวจสอบสถานะการจัดส่ง','Check delivery status')}</p>{assignment?<details className="bill-details"><summary>{t('รายละเอียดงานและรหัสรับอาหาร','Assignment and pickup proof details')}</summary><p>{assignment.id} · {assignment.state} · {assignment.generation}/{assignment.leaseGeneration}</p>{proof&&<p>{t('รหัสรับอาหารใช้ได้ถึง','Pickup proof expires')}: {new Date(proof.expiresAt).toLocaleString()} · {t('ครั้งที่เหลือ','Attempts remaining')}: {proof.attemptsRemaining}</p>}</details>:<p>{closed?t('งานขนส่งปิดแล้ว ไม่มีไรเดอร์ที่กำลังทำงาน','Shipment closed; no active rider'):t('ยังไม่มีไรเดอร์ที่ได้รับมอบหมาย','No assigned rider yet')}</p>}</>:readFailure?<div role="status"><p>{readFailure.kind==='denied'?t('บัญชีนี้ไม่มีสิทธิ์ดูข้อมูลส่งมอบ เข้าสู่ระบบด้วยบัญชีที่ได้รับอนุญาต','This account cannot view handoff. Sign in with an authorized account.'):readFailure.kind==='unavailable'?t('ข้อมูลส่งมอบยังไม่พร้อมใช้งาน','Handoff is not available for this order.'):t('โหลดข้อมูลส่งมอบไม่สำเร็จ คำขอเดิมยังคงอยู่','Could not load handoff. Saved requests are retained.')}</p><button type="button" className="secondary" disabled={busy} onClick={()=>void load()}>{t('โหลดสถานะอีกครั้ง','Reload handoff')}</button><details><summary>{t('รายละเอียดการเชื่อมต่อ','Connection details')}</summary>{readFailure.detail}</details></div>:<p role="status">{t('กำลังโหลดข้อมูลส่งมอบ','Loading handoff')}</p>}
  {assignment&&assignment.state!==work?.state&&<p className="handoff-stage">{({
   ACCEPTED:t('คนส่งรับงานแล้ว','Rider accepted the job'),
   AT_PICKUP:t('คนส่งถึงร้านแล้ว · ตรวจสอบก่อนส่งมอบ','Rider at store · check before handoff'),
   PICKED_UP:t('คนส่งรับอาหารจากร้านแล้ว','Rider collected the food'),
   AT_DROPOFF:t('คนส่งถึงจุดส่งแล้ว','Rider at destination'),
   INCIDENT:t('งานคนส่งมีปัญหา · ต้องตรวจสอบ','Rider incident · attention required')
  } as Record<string,string>)[assignment.state]??t('ตรวจสอบสถานะคนส่ง','Check rider status')}</p>}
  {receipt?.secret&&proof?.id===receipt.proofId&&Date.parse(receipt.expiresAt)>Date.now()&&<p><label>{t('แสดงให้ไรเดอร์ที่มารับอาหารจริงเท่านั้น','Show only to the assigned rider physically collecting this order')}<input readOnly value={receipt.secret} autoComplete="off" spellCheck={false} aria-label={t('รหัสรับอาหาร','Pickup proof secret')}/></label></p>}
  {receipt?.secretRecoveryRequired&&<p>{t('คำขอเดิมสำเร็จแล้ว ไม่สามารถอ่านรหัสเดิมซ้ำได้ เลือกเปลี่ยนรหัสอย่างชัดเจน','Original issue succeeded. The secret cannot be recovered. Explicitly replace the proof if needed.')}</p>}
  <MerchantFoodReturn key={`${session.token}:${orderId}:${assignment?.id??"none"}`} session={session} orderId={orderId} assignmentId={assignment?.id} language={language} onChange={onChange}/>
  {error&&<p role="alert">{error}</p>}
 </aside>;
}
