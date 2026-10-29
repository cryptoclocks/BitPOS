import React,{useEffect,useRef,useState} from 'react';
import {api,ApiError,errorMessage} from '../lib/api';
import {requestId} from '../lib/request-id';
import type {Session,Table} from '../lib/table';
import type {TableClearRequest,TableClearResult} from '../../../../packages/contracts/src/table-visits';
import {readTableClear,saveTableClear,finishTableClear} from '../lib/table-clear';
export default function TableClearControls({session,tables,refresh,language,selectedTableId,current=true,onRecovered}:{session:Session;tables:Table[];refresh:()=>Promise<void>;language:'en'|'th';selectedTableId?:string;current?:boolean;onRecovered?:(tableId:string)=>void}){
 const [tableId,setTableId]=useState(''),[confirmation,setConfirmation]=useState<{tableId:string;request:TableClearRequest}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const working=useRef(false);const table=tables.find(t=>t.id===tableId&&!t.retiredAt);const copy=(en:string,th:string)=>language==='th'?th:en;
 const [submitted,setSubmitted]=useState(false),[journalReady,setJournalReady]=useState(false);
 useEffect(()=>{setJournalReady(false);try{const intent=readTableClear(session);if(intent){setTableId(intent.tableId);setConfirmation(intent);setSubmitted(true);onRecovered?.(intent.tableId);}else{setConfirmation(null);setSubmitted(false);}setJournalReady(true);}catch{setError(copy('Saved clear request is unreadable; do not start another clear.','อ่านคำขอเคลียร์เดิมไม่ได้ อย่าเริ่มเคลียร์ซ้ำ'));}},[session.merchantId,session.userId]);
 useEffect(()=>{if(journalReady&&selectedTableId!==undefined&&!confirmation){setTableId(selectedTableId);setError('');setMessage('');}},[selectedTableId,confirmation,journalReady]);
 if(!['owner','manager','staff'].includes(session.role))return null;
 async function clear(){
  if(!confirmation||working.current)return;working.current=true;setBusy(true);setError('');
  try{
   if(!submitted){saveTableClear(session,confirmation);setSubmitted(true);}
   const result=await api<TableClearResult>('/tables/'+confirmation.tableId+'/clear',confirmation.request,session.token);
   if(!result.cleared)throw Error(copy('Table clear result unavailable','ไม่พบผลการเคลียร์โต๊ะ'));
   finishTableClear(session);setSubmitted(false);setConfirmation(null);setMessage(copy('Table cleared','เคลียร์โต๊ะแล้ว'));await refresh();
  }catch(e){setError(errorMessage(e));if(e instanceof ApiError&&e.definiteRefusal&&!['AUTH_REQUIRED','FORBIDDEN','ROLE_REQUIRED','RESOURCE_NOT_FOUND'].includes(e.code)){try{finishTableClear(session);setSubmitted(false);setConfirmation(null);}catch{setError(copy('Keep the saved clear request and retry.','เก็บคำขอเคลียร์เดิมไว้และตรวจผลอีกครั้ง'));}}}
  finally{working.current=false;setBusy(false);}
 }
 async function saveTimeout(value:number){
  if(!current||!table||working.current||confirmation)return;working.current=true;setBusy(true);setError('');
  try{await api('/tables/'+table.id,{occupancyTimeoutMinutes:value},session.token,'PATCH');setMessage(copy('Inactivity timeout saved','บันทึกเวลาสำรองแล้ว'));await refresh();}
  catch(e){setError(errorMessage(e));}finally{working.current=false;setBusy(false);}
 }
 return <section aria-label={copy('Clear table','เคลียร์โต๊ะ')} className="table-clear-controls"><label>{copy('Table','โต๊ะ')}<select value={tableId} disabled={selectedTableId!==undefined||!current||!journalReady||busy||!!confirmation} onChange={e=>{setTableId(e.target.value);setError('');setMessage('');}}><option value="">{copy('Select table','เลือกโต๊ะ')}</option>{tables.filter(t=>!t.retiredAt).map(t=><option key={t.id} value={t.id}>{t.label} · {t.occupancy.active?copy('In use','มีผู้ใช้'):copy('Available','ว่าง')}</option>)}</select></label>{table&&!confirmation&&<button type="button" className="secondary" disabled={!current||!journalReady||busy} onClick={()=>{setMessage('');setConfirmation({tableId:table.id,request:{expectedGeneration:table.occupancy.generation,idempotencyKey:requestId(),confirmClear:true}});}}>{copy('Clear table','เคลียร์โต๊ะ')}</button>}
 {confirmation&&<div role="group" aria-label={copy('Confirm table clear','ยืนยันเคลียร์โต๊ะ')}><p>{copy('Saved target','โต๊ะในคำขอเดิม')}: {tables.find(t=>t.id===confirmation.tableId)?.label??confirmation.tableId}</p><p>{submitted?copy('The saved clear request may already have committed. Check it using the same request; do not clear again.','คำขอเคลียร์เดิมอาจสำเร็จแล้ว ตรวจผลด้วยคำขอเดิม อย่าเคลียร์ซ้ำ'):copy('End this table visit and its personal offers. Saved bills and wallet permissions stay.','จบรอบโต๊ะและข้อเสนอส่วนตัว เก็บบิลและสิทธิ์ wallet เดิมไว้')}</p><button disabled={!journalReady||busy||(!submitted&&(!current||table?.occupancy.generation!==confirmation.request.expectedGeneration))} onClick={()=>void clear()}>{busy?copy('Please wait','รอสักครู่'):submitted?copy('Check saved clear','ตรวจผลเคลียร์เดิม'):copy('Confirm clear','ยืนยันเคลียร์')}</button>{!submitted&&<button className="secondary" disabled={busy} onClick={()=>setConfirmation(null)}>{copy('Cancel','ยกเลิก')}</button>}</div>}
 {table&&!confirmation&&['owner','manager'].includes(session.role)&&<details key={table.id+':'+table.occupancy.timeoutMinutes}><summary>{copy('Inactivity fallback','เวลาสำรองเมื่อไม่มีการใช้งาน')}</summary><form onSubmit={e=>{e.preventDefault();void saveTimeout(Number(new FormData(e.currentTarget).get('minutes')));}}><label>{copy('Minutes without ordering or payment','นาทีที่ไม่มีการสั่งหรือชำระเงิน')}<input name="minutes" type="number" min="30" max="1440" step="1" defaultValue={table.occupancy.timeoutMinutes} required disabled={busy||!current}/></label><small>{copy('Unresolved bills or payments always block automatic clearing.','บิลหรือผลชำระที่ยังไม่แน่ชัดจะขัดขวางการเคลียร์อัตโนมัติเสมอ')}</small><button disabled={busy||!current}>{copy('Save timeout','บันทึกเวลา')}</button></form></details>}
 {error&&<p className="error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}</section>;
}
