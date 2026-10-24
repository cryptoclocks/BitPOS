import React,{useEffect,useRef,useState} from 'react';
import {api,ApiError,errorMessage} from '../lib/api';
import {requestId} from '../lib/request-id';
import {createVoiceInput,audioBase64,type VoiceState,type VoiceInput} from '../lib/voice-input';
import type {CoffeeResult} from '../../../../packages/contracts/src/coffee-copilot';
import type {Product} from '../lib/menu';
import '../styles/coffee-copilot.css';
const refusalMessages:Record<string,string>={
 AI_FREE_LIMIT:'ถึงขีดจำกัด AI ฟรีแล้ว เลือกเมนูตามปกติได้ / Free AI limit reached; the menu remains available.',
 COPILOT_STALE:'เมนูหรือรายการเปลี่ยนแล้ว กรุณาตรวจใหม่ / Menu or cart changed; review again.',
 EMPTY_TRANSCRIPT:'ไม่พบเสียงพูดชัดเจน ลองใหม่หรือพิมพ์ / No clear speech; try again or type.',
 EPHEMERAL_RESULT_NOT_RETAINED:'ไม่เก็บข้อความเสียงไว้ กรุณาพิมพ์หรือลองใหม่ / Speech text is not retained; type or record again.',
 CONFIGURATION_REQUIRED:'ระบบ AI ยังไม่พร้อม เลือกเมนูได้ / AI unavailable; use the menu.',
 PROVIDER_RATE_LIMITED:'บริการเสียง/AI จำกัดคำขอ กรุณาพิมพ์หรือเลือกเมนู / AI rate limit; type or use the menu.',
 PROVIDER_OUTCOME_UNKNOWN:'ผลคำขอยังไม่ชัดเจน ไม่มีออเดอร์หรือการจ่ายเงิน / Request outcome unknown; no order or payment.',
 INVALID_AUDIO:'ไฟล์เสียงไม่รองรับ กรุณาพิมพ์หรือลองบันทึกใหม่ / Unsupported audio; type or record again.',
 AUDIO_DURATION_INVALID:'เสียงต้องสั้นกว่า 20 วินาที / Keep speech under 20 seconds.'
};
function refusalMessage(code:string){return refusalMessages[code]??'ไม่สามารถอ่านคำขอได้ เลือกเมนูหรือพิมพ์ใหม่ / Unable to interpret; use the menu or try typing.';}
interface Props {language:'th'|'en';disabled:boolean;draftRevision:string;products:Product[];visit:()=>Promise<string>;apply:(proposal:Extract<CoffeeResult,{kind:'proposal'}>)=>void;}
export default function CoffeeCopilot({language,disabled,draftRevision,products,visit,apply}:Props){
 const [open,setOpen]=useState(true),[text,setText]=useState(''),[state,setState]=useState<VoiceState>('idle'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<CoffeeResult>();
 const mounted=useRef(true),generation=useRef(0),revision=useRef(draftRevision);revision.current=draftRevision;
 const voice=useRef<VoiceInput|null>(null);
 const visitCurrent=useRef(visit);visitCurrent.current=visit;
 const th=language==='th';const copy=(en:string,thai:string)=>th?thai:en;
 async function requestOperation(base:string,purpose:'copilot'|'transcribe',payload:Record<string,unknown>):Promise<CoffeeResult>{
  const key='bitpos-coffee-operation-v1:'+base+':'+purpose,raw=localStorage.getItem(key);
  const prior=raw?JSON.parse(raw) as {requestId:string;draftRevision:string;inputHash?:string}:null;
  const inputHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload))))).map(v=>v.toString(16).padStart(2,'0')).join('');
  if(prior){
   let recovered:CoffeeResult;
   try{recovered=await api<CoffeeResult>(base+'/copilot/'+prior.requestId);}
   catch(e){if(e instanceof ApiError&&e.code==='RESOURCE_NOT_FOUND')localStorage.removeItem(key);throw e;}
   if(recovered.kind!=='pending')localStorage.removeItem(key);
   return prior.inputHash===inputHash&&prior.draftRevision===payload.draftRevision?recovered:{kind:'refused',code:recovered.kind==='pending'?'PROVIDER_OUTCOME_UNKNOWN':'COPILOT_STALE',requestId:prior.requestId,draftRevision:String(payload.draftRevision)};
  }
  const id=requestId();localStorage.setItem(key,JSON.stringify({requestId:id,draftRevision:payload.draftRevision,inputHash}));
  try{const response=await api<CoffeeResult>(base+'/'+purpose,{...payload,requestId:id});if(response.kind!=='pending')localStorage.removeItem(key);return response;}
  catch(e){if(e instanceof ApiError&&(e.definiteRefusal||e.code==='CONFIGURATION_REQUIRED'))localStorage.removeItem(key);throw e;}
 }
 useEffect(()=>{mounted.current=true;voice.current=createVoiceInput({state:setState,transcript:value=>{setText(value);setResult(undefined);},error:setError,audio:async(blob,durationMs)=>{const token=generation.current,rev=revision.current;const base=await visitCurrent.current();const response=await requestOperation(base,'transcribe',{draftRevision:rev,mimeType:blob.type,durationMs,audio:await audioBase64(blob)});if(!mounted.current||token!==generation.current||rev!==revision.current)return;if(response.kind==='transcript')setText(response.text);else if(response.kind==='refused')setError(refusalMessage(response.code));else setError('Transcription pending. Keep typed input / กำลังตรวจสอบเสียง กรุณาพิมพ์ได้');}});return()=>{mounted.current=false;generation.current++;voice.current?.dispose();};},[]);
 useEffect(()=>{generation.current++;setResult(undefined);voice.current?.cancel();},[draftRevision,disabled,language]);
 async function interpret(){if(disabled||busy||!text.trim())return;voice.current?.cancel();setBusy(true);setError('');setResult(undefined);const rev=draftRevision,token=generation.current;try{const base=await visitCurrent.current();const response=await requestOperation(base,'copilot',{draftRevision:rev,text});if(mounted.current&&token===generation.current&&rev===revision.current)setResult(response);}catch(e){if(mounted.current)setError(e instanceof ApiError ? refusalMessage(e.code) : errorMessage(e));}finally{if(mounted.current)setBusy(false);}}
 return <section className="coffee-copilot" aria-label="Coffee Copilot"><button className="coffee-toggle" aria-expanded={open} onClick={()=>{(generation.current++, setOpen(!open));if(open)voice.current?.cancel();}}>{copy('Ask AI','สั่งกับ AI')}</button>{open&&<div className="coffee-content"><label><span className="sr-only">{copy('Your order','เมนูที่ต้องการ')}</span><textarea maxLength={2000} value={text} disabled={busy} onChange={e=>{(generation.current++, voice.current?.cancel(), setText(e.target.value));setResult(undefined);}} placeholder={copy('One iced latte','ลาเต้เย็นหนึ่งแก้ว')}/></label><div className="coffee-actions">{state==='listening'||state==='permission'?<button onClick={()=>voice.current?.stop()}>{copy('Stop microphone','หยุดไมโครโฟน')}</button>:<><button disabled={disabled||busy||state==='processing'} onClick={()=>{setError('');void voice.current?.start(language);}} aria-label={copy('Start microphone','เริ่มไมโครโฟน')}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 10v2a6 6 0 0 0 12 0v-2M12 18v3M9 21h6"/></svg></button></>}<button disabled={disabled||busy||state!=='idle'||!text.trim()} aria-label={copy('Send order request','ส่งคำสั่ง')} title={copy('Send order request','ส่งคำสั่ง')} onClick={()=>void interpret()}>{busy?'…':<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 12 6-6 6 6M12 6v13"/></svg>}</button></div><p className="coffee-status" hidden={state==='idle'} role="status" aria-live="polite">{state==='listening'?copy('Listening · maximum 20 seconds','กำลังฟัง · สูงสุด 20 วินาที'):state==='permission'?copy('Waiting for microphone permission','รออนุญาตไมโครโฟน'):state==='processing'?copy('Transcribing…','กำลังแปลงเสียง…'):copy('Nothing is ordered or paid automatically. Wallet approval is separate.','ไม่มีการสั่งหรือชำระอัตโนมัติ การอนุมัติกระเป๋าแยกต่างหาก')}</p><details className="coffee-input-options"><summary>{copy('Voice options & privacy','ตัวเลือกเสียงและความเป็นส่วนตัว')}</summary><p>{copy('Review speech text before sending. Avoid personal details; audio may be processed by an AI provider. You review the order and payment separately.','ตรวจข้อความก่อนส่ง หลีกเลี่ยงข้อมูลส่วนตัว เสียงอาจถูกประมวลผลโดยผู้ให้บริการ AI คุณยังตรวจรายการและยืนยันการจ่ายเอง')}</p><button disabled={disabled||busy||state!=='idle'} onClick={()=>{setError('');void voice.current?.start(language,true);}}>{copy('Record audio instead','บันทึกเสียงแทน')}</button></details>{error&&<p role="alert" className="error">{error}</p>}{result?.kind==='clarification'&&<p role="status">{result.message}</p>}{result?.kind==='refused'&&<p role="alert">{refusalMessage(result.code)} · {copy('Try typing or use the menu','ลองพิมพ์หรือเลือกจากเมนู')}</p>}{result?.kind==='pending'&&<p role="status">{copy('Outcome pending. No order created. Use the menu.','ผลยังไม่ชัดเจน ไม่มีการสร้างออเดอร์ เลือกจากเมนูได้')}</p>}{result?.kind==='proposal'&&<div className="coffee-proposal"><ul>{result.items.map(i=>{const p=products.find(p=>p.id===i.productId);return <li key={i.productId}>{p?.imageUrl&&<img src={p.imageUrl} alt=""/>}{i.qty} × {p?(th?p.name:p.nameEn):i.productId}</li>;})}</ul><p>{result.collection==='counter'?copy('Collect at counter','รับหน้าเคาน์เตอร์'):copy('Serve at table','รับที่โต๊ะ')}</p><p>{copy('Exact current prices appear in the server review next. No sugar or milk options are supported.','ราคาปัจจุบันจะแสดงในหน้าตรวจรายการ ไม่มีตัวเลือกความหวานหรือนม')}</p><button disabled={disabled||Date.parse(result.expiresAt)<=Date.now()||result.draftRevision!==draftRevision} onClick={()=>{apply(result);setResult(undefined);}}>{copy('Review order','ตรวจออเดอร์')}</button></div>}</div>}</section>;
}
