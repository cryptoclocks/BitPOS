// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Merchant "PayPal" tab: Café Copilot (owner intent → AI tool steps → draft → owner approval → screen → results with
// evidence) and the PayPal Sandbox ledger. The AI only drafts; approval, screen choice and money stay with people/PayPal.
import React, {useCallback, useEffect, useState} from 'react';
import {api, ApiError, errorMessage} from '../../lib/api';
import type {Session} from '../../lib/table';
import '../../styles/paypal.css';

type Lang='th'|'en';
interface Step {seq:number;kind:string;tool:string|null;args:unknown;result:any;violations:string[]|null;latencyMs:number|null}
interface Run {id:string;intent:string;kind:string;provider:string|null;model:string|null;state:string;failure:string|null;question:string|null;envelopeId:string|null}
interface Money {currency:string;decimals:number;amountMinor:string}
interface Envelope {id:string;state:string;endedReason:string|null;version:number;approvedBy:string|null;maxUnits:number;maxUnitsPerOrder:number;discountPercent:number;endsAt:string;
 job:{id:string;state:string;blocker:string|null};campaign:null|{id:string;version:number;state:string;headline:string;copy:string;rationale:string;productName:string|null;productNameTh:string|null;basePrice:Money|null;offerPrice:Money|null};
 units:{reserved:number;consumed:number;released:number;remaining:number};targets:{id:string;state:string;label:string;renderedAt:string|null}[]}
interface Recent {id:string;state:string;maxUnits:number;discountPercent:number;endsAt:string;createdAt:string;productName:string|null;productNameTh:string|null}
interface Screen {deviceId:string;label:string;tableLabel:string|null;online:boolean;busy:boolean;capable:boolean}
interface Outcome {totals:{unitsPaid:number;unitsReserved:number;unitsRemaining:number;maxUnits:number;ordersPaid:number;collected:number;recovery:number;gross:string|null;fee:string|null;net:string|null;refunded:string|null;refunds:number};
 orders:{orderId:string;units:number;unitState:string;status:string;createdAt:string;serving:string|null;captureId:string|null;settlement:string|null;gross:string|null}[]}
interface Evidence {steps:{step:string;at:string|null;detail:string;source:string}[]}
interface LedgerRow {orderId:string;paypalOrderId:string|null;status:string;amount:string|null;createdAt:string;captureId:string|null;captureStatus:string|null;gross:string|null;fee:string|null;net:string|null;settlement:string|null;issue:string|null;verifiedVia:string|null}

const price=(m:Money|null)=>m?`${m.currency} ${(Number(m.amountMinor)/10**m.decimals).toFixed(2)}`:'—';
const time=(iso:string|null)=>iso?new Date(iso).toLocaleString(undefined,{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'}):'—';

export default function PayPalWorkspace({session,language}:{session:Session;language:Lang}){
 const t=(th:string,en:string)=>language==='th'?th:en;
 const [view,setView]=useState<'copilot'|'ledger'>('copilot');
 return <main className="paypal-workspace">
  <header className="pp-ws-header"><div><p className="eyebrow">PayPal Sandbox</p><h1>{view==='copilot'?'Café Copilot':t('รายการ PayPal','PayPal payments')}</h1></div>
   <nav className="pp-ws-tabs" aria-label="PayPal"><button aria-pressed={view==='copilot'} onClick={()=>setView('copilot')}>Café Copilot</button><button aria-pressed={view==='ledger'} onClick={()=>setView('ledger')}>{t('รายการ PayPal','Ledger')}</button></nav></header>
  <p className="pp-sandbox" role="note">{t('PayPal Sandbox · เงินทดสอบ ไม่มีการตัดเงินจริง','PayPal Sandbox — test money only')}</p>
  {view==='copilot'?<Copilot session={session} t={t} language={language}/>:<Ledger session={session} t={t}/>}
 </main>;
}

function Copilot({session,t,language}:{session:Session;t:(th:string,en:string)=>string;language:Lang}){
 const manage=session.role==='owner'||session.role==='manager';
 const [intent,setIntent]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [run,setRun]=useState<{run:Run;steps:Step[]}|null>(null);const [envelope,setEnvelope]=useState<Envelope|null>(null);
 const [screens,setScreens]=useState<Screen[]>([]);const [confirming,setConfirming]=useState(false);
 const [outcome,setOutcome]=useState<Outcome|null>(null);const [evidence,setEvidence]=useState<{orderId:string;data:Evidence}|null>(null);
 const [showTrace,setShowTrace]=useState(false);const [form,setForm]=useState(false);const [recent,setRecent]=useState<Recent[]>([]);
 const call=useCallback(<T,>(path:string,body?:unknown)=>api<T>(path,body,session.token),[session.token]);
 // Results are a separate read: if they fail, the action that just succeeded is not reported as failed.
 const loadEnvelope=useCallback(async(id:string)=>{const e=await call<Envelope>(`/paypal/copilot/envelopes/${id}`);setEnvelope(e);
  if(e.state!=='DRAFT')setOutcome(await call<Outcome>(`/paypal/envelopes/${id}/outcome`).catch(()=>null));return e;},[call]);
 const loadRecent=useCallback(()=>call<{envelopes:Recent[]}>('/paypal/copilot/envelopes').then(r=>setRecent(r.envelopes)).catch(()=>{/* list is optional */}),[call]);
 useEffect(()=>{void loadRecent();},[loadRecent,envelope?.id,envelope?.state]);
 useEffect(()=>{void call<{screens:Screen[]}>('/paypal/screens').then(r=>setScreens(r.screens)).catch(()=>{/* shown when needed */});},[call]);
 // The draft's copy and image come from the existing generator; poll until the campaign exists, then follow results.
 useEffect(()=>{if(!envelope)return;const id=envelope.id;const done=envelope.campaign&&envelope.state!=='APPROVED';
  if(done&&envelope.state!=='DRAFT')return;
  const timer=setInterval(()=>{void loadEnvelope(id).catch(()=>{/* next tick */});},envelope.campaign?5000:2000);return ()=>clearInterval(timer);},[envelope?.id,envelope?.campaign?.id,envelope?.state,loadEnvelope]);

 const start=async()=>{setBusy(true);setError('');setRun(null);setEnvelope(null);setOutcome(null);
  try{const r=await call<{runId:string;state:string;envelopeId:string|null;question:string|null;failure:string|null;trace:{run:Run;steps:Step[]};envelope:Envelope|null}>('/paypal/copilot/runs',{intent,language});
   setRun(r.trace);if(r.envelope)setEnvelope(r.envelope);if(r.state==='FAILED')setError(failureText(r.failure,t));}
  catch(e){setError(ownerError(e,t));}finally{setBusy(false);}};
 const approve=async()=>{if(!envelope?.campaign)return;setBusy(true);setError('');
  try{await call(`/paypal/copilot/envelopes/${envelope.id}/approve`,{campaignVersion:envelope.campaign.version});await loadEnvelope(envelope.id);setConfirming(false);}
  catch(e){setError(ownerError(e,t));}finally{setBusy(false);}};
 const publish=async()=>{if(!envelope)return;setBusy(true);setError('');
  try{await call(`/paypal/copilot/envelopes/${envelope.id}/publish`,{confirmAllScreens:true});await loadEnvelope(envelope.id);}
  catch(e){setError(ownerError(e,t));}finally{setBusy(false);}};
 const stop=async()=>{if(!envelope)return;setBusy(true);setError('');try{await call(`/paypal/copilot/envelopes/${envelope.id}/stop`,{});await loadEnvelope(envelope.id);}catch(e){setError(ownerError(e,t));}finally{setBusy(false);}};
 const open=async(id:string)=>{setError('');setRun(null);setOutcome(null);setConfirming(false);try{await loadEnvelope(id);}catch(e){setError(ownerError(e,t));}};
 const openEvidence=async(orderId:string)=>{try{setEvidence({orderId,data:await call<Evidence>(`/paypal/orders/${orderId}/evidence`)});}catch(e){setError(ownerError(e,t));}};

 const examples=[t('ขายครัวซองต์ที่เหลือ 8 ชิ้นก่อน 16:00 ลดไม่เกิน 10%','Sell the 8 croissants left before 4pm, at most 10% off'),t('ดันลาเต้เย็นช่วงบ่าย 20 แก้ว ลดไม่เกิน 15% ก่อน 17:00','Push 20 iced lattes this afternoon, max 15% off, before 5pm')];
 const c=envelope?.campaign;
 return <section className="pp-copilot">
  {!manage&&<p className="notice">{t('ต้องเป็นเจ้าของหรือผู้จัดการร้าน','Owner or manager only')}</p>}
  <div className="pp-card">
   <label htmlFor="pp-intent"><strong>{t('บอกสิ่งที่อยากขาย','Tell Copilot what to sell')}</strong></label>
   <textarea id="pp-intent" rows={3} maxLength={600} value={intent} onChange={e=>setIntent(e.target.value)} placeholder={examples[0]} disabled={!manage||busy}/>
   <div className="pp-row">{examples.map(x=><button key={x} type="button" className="secondary" onClick={()=>setIntent(x)}>{x}</button>)}</div>
   <div className="pp-row"><button type="button" disabled={!manage||busy||intent.trim().length<3} onClick={()=>void start()}>{busy?t('AI กำลังทำงาน…','Copilot is working…'):t('ให้ Copilot ร่างโปร','Draft with Copilot')}</button>
    <button type="button" className="secondary" onClick={()=>setForm(v=>!v)}>{t('ใช้แบบฟอร์มแทน (ไม่ใช้ AI)','Use the form instead (no AI)')}</button></div>
   <p className="pp-caption">{t('AI อ่านสต็อกและยอดขาย ตรวจขอบเขต แล้วบันทึกเป็นร่างเท่านั้น ไม่เผยแพร่ ไม่เลือกจอ ไม่เก็บเงินเอง','AI reads stock and sales, checks the limits and saves a draft only. It never publishes, picks screens or takes money.')}</p>
  </div>
  {recent.length>0&&<div className="pp-card"><h2>{t('แคมเปญล่าสุด','Recent campaigns')}</h2>
   <ul className="pp-recent">{recent.map(r=><li key={r.id} aria-current={envelope?.id===r.id?'true':undefined}><button type="button" className="secondary" onClick={()=>void open(r.id)}>
    {(language==='th'?r.productNameTh:r.productName)??'—'} · −{r.discountPercent}% · {r.maxUnits} {t('ชิ้น','units')} · {t('จบ','ends')} {time(r.endsAt)} · <strong>{stateText(r.state,t)}</strong></button></li>)}</ul></div>}
  {form&&<RulesForm call={call} t={t} language={language} onDone={(id,r)=>{setRun(r);void loadEnvelope(id);setForm(false);}} onError={setError}/>}
  {error&&<div className="error" role="alert">{error}</div>}
  {run&&<div className="pp-card"><h2>{t('ขั้นตอนของ AI','What Copilot did')}</h2>
   <ol className="pp-steps">{run.steps.filter(s=>s.kind==='tool_call').map(s=><li key={s.seq} className={s.violations?'has-violations':''}><code>{s.tool}</code> {stepText(s,t)}{s.latencyMs!==null&&<small> · {s.latencyMs} ms</small>}</li>)}</ol>
   {run.run.question&&<p className="pp-question" role="status">{t('AI ถาม:','Copilot asks:')} {run.run.question}</p>}
   <button type="button" className="secondary" onClick={()=>setShowTrace(v=>!v)}>{showTrace?t('ซ่อนรายละเอียด','Hide details'):t('ดูรายละเอียด (trace)','Details (trace)')}</button>
   {showTrace&&<div className="pp-trace"><p>{run.run.kind==='rules_baseline'?t('แบบฟอร์ม (ไม่ใช้ AI)','Form (no AI)'):`${run.run.model??''} · ${run.run.provider??''}`} · run {run.run.id.slice(0,8)}</p>
    <table><thead><tr><th>#</th><th>{t('ชนิด','Kind')}</th><th>{t('เครื่องมือ','Tool')}</th><th>{t('ผล','Result')}</th></tr></thead><tbody>
    {run.steps.map(s=><tr key={s.seq}><td>{s.seq}</td><td>{s.kind}</td><td>{s.tool??''}</td><td><code>{JSON.stringify(s.result??s.args).slice(0,160)}</code>{s.violations&&<strong> {s.violations.join(', ')}</strong>}</td></tr>)}</tbody></table></div>}
  </div>}
  {envelope&&<div className="pp-card pp-draft"><h2>{envelope.state==='DRAFT'?t('ร่างแคมเปญ (ยังไม่เผยแพร่)','Campaign draft (not published)'):envelope.state==='APPROVED'?t('แคมเปญที่อนุมัติแล้ว','Approved campaign'):t('แคมเปญจบแล้ว','Campaign ended')}</h2>
   {!c&&<p role="status">{envelope.job.state==='CONFIGURATION_REQUIRED'?t('ยังไม่ได้ตั้งค่า AI ของร้าน จึงยังเขียนข้อความโปรไม่ได้','AI is not configured for this shop, so the offer text cannot be written yet.'):t('กำลังเขียนข้อความและภาพโปร…','Writing the offer text and image…')}</p>}
   {c&&<dl className="pp-envelope">
    <dt>{t('สินค้า','Product')}</dt><dd>{language==='th'?c.productNameTh:c.productName}</dd>
    <dt>{t('ราคา','Price')}</dt><dd><s>{price(c.basePrice)}</s> → <strong>{price(c.offerPrice)}</strong> (−{envelope.discountPercent}%) <small>{t('คำนวณโดยเซิร์ฟเวอร์','server-computed')}</small></dd>
    <dt>{t('จำนวนสูงสุด','Max units')}</dt><dd>{envelope.maxUnits} · {t('ต่อออร์เดอร์','per order')} {envelope.maxUnitsPerOrder}</dd>
    <dt>{t('จบเวลา','Ends')}</dt><dd>{time(envelope.endsAt)}</dd>
    <dt>{t('หัวข้อ','Headline')}</dt><dd>{c.headline}</dd><dt>{t('ข้อความ','Copy')}</dt><dd>{c.copy}</dd>
    <dt>{t('เหตุผลของ AI','Why')}</dt><dd>{c.rationale}</dd></dl>}
   {envelope.state==='DRAFT'&&c&&manage&&(!confirming?<button type="button" onClick={()=>setConfirming(true)}>{t('อนุมัติ','Approve')}</button>:
    <div className="pp-confirm" role="dialog" aria-label={t('ยืนยันการอนุมัติ','Confirm approval')}><p>{t(`จะเปิดราคาโปรนี้จนถึง ${time(envelope.endsAt)} หรือจนขายครบ ${envelope.maxUnits} ชิ้น ลูกค้าจ่ายด้วย PayPal Sandbox`,`This offer runs until ${time(envelope.endsAt)} or until ${envelope.maxUnits} sell. Customers pay with PayPal Sandbox.`)}</p>
     <button type="button" disabled={busy} onClick={()=>void approve()}>{t('ยืนยันอนุมัติ','Confirm approval')}</button> <button type="button" className="secondary" onClick={()=>setConfirming(false)}>{t('ยกเลิก','Cancel')}</button></div>)}
   {envelope.state==='APPROVED'&&manage&&<div className="pp-screens"><h3>{t('ส่งไปจอของร้าน','Send to the shop’s screens')}</h3>
    <p className="pp-caption">{t('โปรประจำวันจะแสดงบนทุกจอของร้าน','A daily offer shows on every screen of the shop.')}</p>
    {screens.length===0&&<p>{t('ยังไม่มีจอ','No screens yet')}</p>}
    <ul>{screens.map(s=><li key={s.deviceId}>{s.label}{s.tableLabel?` · ${s.tableLabel}`:''} <small>{s.online?t('ออนไลน์','online'):t('ออฟไลน์ (จะแสดงเมื่อกลับมา)','offline (shows when back)')}{!s.capable?' · '+t('จอนี้ไม่รองรับ','not supported'):''}</small></li>)}</ul>
    <div className="pp-row"><button type="button" disabled={busy||!screens.length} onClick={()=>void publish()}>{t(`ส่งไปทุกจอ (${screens.length})`,`Send to all screens (${screens.length})`)}</button> <button type="button" className="secondary" disabled={busy} onClick={()=>void stop()}>{t('หยุดโปร','Stop offer')}</button></div>
    {envelope.targets.length>0&&<ul>{envelope.targets.map(x=><li key={x.id}>{x.label}: {x.state}{x.renderedAt?` · ${t('แสดงแล้ว','shown')} ${time(x.renderedAt)}`:''}</li>)}</ul>}</div>}
  </div>}
  {outcome&&<div className="pp-card"><h2>{t('ผลแคมเปญ','Campaign results')}</h2>
   <div className="pp-tiles">
    <Tile label={t('ขายแล้ว (จ่ายแล้ว)','Sold (paid)')} value={`${outcome.totals.unitsPaid} / ${outcome.totals.maxUnits}`}/>
    <Tile label={t('จองอยู่','Reserved')} value={String(outcome.totals.unitsReserved)}/>
    <Tile label={t('เหลือ','Left')} value={String(outcome.totals.unitsRemaining)}/>
    <Tile label={t('ยอด PayPal (gross)','PayPal gross')} value={`USD ${outcome.totals.gross??'0.00'}`}/>
    <Tile label={t('ค่าธรรมเนียม / สุทธิ','Fee / net')} value={`${outcome.totals.fee??'0.00'} / ${outcome.totals.net??'0.00'}`}/>
    <Tile label={t('คืนเงิน','Refunded')} value={`USD ${outcome.totals.refunded??'0.00'}`}/>
   </div>
   {outcome.totals.recovery>0&&<p className="error">{t(`มี ${outcome.totals.recovery} รายการที่ต้องตรวจ (RECOVERY)`,`${outcome.totals.recovery} payment(s) need review (RECOVERY)`)}</p>}
   <table className="pp-table"><thead><tr><th>{t('เวลา','Time')}</th><th>{t('ที่','Where')}</th><th>{t('สถานะ','Status')}</th><th>PayPal</th><th></th></tr></thead><tbody>
    {outcome.orders.map(o=><tr key={o.orderId}><td>{time(o.createdAt)}</td><td>{o.serving??''}</td><td>{o.status}{o.settlement?` · ${o.settlement}`:''}</td><td>{o.captureId?`…${o.captureId.slice(-6)} · USD ${o.gross}`:'—'}</td><td><button type="button" className="secondary" onClick={()=>void openEvidence(o.orderId)}>{t('หลักฐาน','Evidence')}</button></td></tr>)}</tbody></table>
   <p className="pp-caption">{t('ตัวเลขทั้งหมดมาจาก capture ที่เซิร์ฟเวอร์ตรวจกับ PayPal แล้ว (Sandbox ไม่ใช่ยอดขายจริง)','All money comes from captures the server verified with PayPal (Sandbox, not real sales).')}</p>
  </div>}
  {evidence&&<div className="pp-card" role="dialog" aria-label={t('หลักฐาน','Evidence')}><h2>{t('หลักฐานของออร์เดอร์','Order evidence')} · {evidence.orderId.slice(0,8)}</h2>
   <ol className="pp-timeline">{evidence.data.steps.map((s,i)=><li key={i}><strong>{s.step}</strong> <small>{time(s.at)} · {s.source}</small><div>{s.detail}</div></li>)}</ol>
   <div className="pp-row"><button type="button" className="secondary" onClick={()=>void navigator.clipboard?.writeText(JSON.stringify(evidence.data,null,1))}>{t('คัดลอก JSON','Copy JSON')}</button><button type="button" className="secondary" onClick={()=>setEvidence(null)}>{t('ปิด','Close')}</button></div></div>}
 </section>;
}

function RulesForm({call,t,language,onDone,onError}:{call:<T,>(p:string,b?:unknown)=>Promise<T>;t:(th:string,en:string)=>string;language:Lang;onDone:(envelopeId:string,run:{run:Run;steps:Step[]})=>void;onError:(e:string)=>void}){
 const [products,setProducts]=useState<{productId:string;nameTh:string;nameEn:string;available:number}[]>([]);
 const [d,setD]=useState({productId:'',maxUnits:8,discountPercent:10,endsAt:''});
 useEffect(()=>{void call<any>('/menu').then((m:any)=>setProducts((m?.products??[]).map((p:any)=>({productId:p.id,nameTh:p.name,nameEn:p.nameEn,available:p.available})))).catch(()=>{/* manual id */});},[call]);
 const submit=async()=>{try{const r=await call<{runId:string;envelopeId:string|null;violations:string[]}>('/paypal/copilot/rules',{...d,endsAt:new Date(d.endsAt).toISOString(),language});
  if(!r.envelopeId){onError(r.violations.join(', '));return;}onDone(r.envelopeId,await call(`/paypal/copilot/runs/${r.runId}`));}catch(e){onError(ownerError(e,t));}};
 return <div className="pp-card"><h2>{t('แบบฟอร์ม (ไม่ใช้ AI)','Form (no AI)')}</h2>
  <label>{t('สินค้า','Product')}<select value={d.productId} onChange={e=>setD({...d,productId:e.target.value})}><option value="">—</option>{products.map(p=><option key={p.productId} value={p.productId}>{language==='th'?p.nameTh:p.nameEn} ({p.available})</option>)}</select></label>
  <label>{t('จำนวนสูงสุด','Max units')}<input type="number" min={1} max={50} value={d.maxUnits} onChange={e=>setD({...d,maxUnits:Number(e.target.value)})}/></label>
  <label>{t('ส่วนลด %','Discount %')}<input type="number" min={1} max={20} value={d.discountPercent} onChange={e=>setD({...d,discountPercent:Number(e.target.value)})}/></label>
  <label>{t('จบเวลา','Ends at')}<input type="datetime-local" value={d.endsAt} onChange={e=>setD({...d,endsAt:e.target.value})}/></label>
  <button type="button" disabled={!d.productId||!d.endsAt} onClick={()=>void submit()}>{t('บันทึกร่าง','Save draft')}</button></div>;
}

function Ledger({session,t}:{session:Session;t:(th:string,en:string)=>string}){
 const [rows,setRows]=useState<LedgerRow[]|null>(null);const [error,setError]=useState('');
 useEffect(()=>{let live=true;const load=()=>api<{rows:LedgerRow[]}>('/paypal/ledger',undefined,session.token).then(r=>{if(live)setRows(r.rows);}).catch(e=>{if(live)setError(ownerError(e,t));});
  void load();const timer=setInterval(()=>void load(),10000);return ()=>{live=false;clearInterval(timer);};},[session.token]);
 const settled=(rows??[]).filter(r=>r.settlement==='SETTLED');
 const sum=(k:'gross'|'fee'|'net')=>settled.reduce((a,r)=>a+Math.round(Number(r[k]??0)*100),0)/100;
 return <section className="pp-ledger">
  {error&&<div className="error" role="alert">{error}</div>}
  <div className="pp-tiles"><Tile label={t('จ่ายแล้ว','Paid')} value={String(settled.length)}/><Tile label="Gross" value={`USD ${sum('gross').toFixed(2)}`}/><Tile label={t('ค่าธรรมเนียม','Fee')} value={`USD ${sum('fee').toFixed(2)}`}/><Tile label={t('สุทธิ','Net')} value={`USD ${sum('net').toFixed(2)}`}/>
   <Tile label={t('ต้องตรวจ','Needs attention')} value={String((rows??[]).filter(r=>['MISMATCH','UNKNOWN','PENDING'].includes(r.status)||r.settlement==='RECOVERY').length)}/></div>
  <table className="pp-table"><thead><tr><th>{t('เวลา','Time')}</th><th>PayPal order</th><th>{t('สถานะ','Status')}</th><th>USD</th><th>Capture</th><th>Gross / fee / net</th><th>{t('ตรวจจาก','Verified via')}</th></tr></thead><tbody>
   {(rows??[]).map(r=><tr key={(r.paypalOrderId??'')+r.createdAt}><td>{time(r.createdAt)}</td><td>{r.paypalOrderId??'—'}</td><td>{r.status}{r.settlement?` · ${r.settlement}`:''}{r.issue?` · ${r.issue}`:''}</td><td>{r.amount}</td><td>{r.captureId?`…${r.captureId.slice(-6)} ${r.captureStatus}`:'—'}</td><td>{r.gross?`${r.gross} / ${r.fee??'—'} / ${r.net??'—'}`:'—'}</td><td>{r.verifiedVia??''}</td></tr>)}
  </tbody></table>
  {rows&&rows.length===0&&<p>{t('ยังไม่มีการจ่ายด้วย PayPal','No PayPal payments yet')}</p>}
 </section>;
}

function Tile({label,value}:{label:string;value:string}){return <div className="pp-tile"><small>{label}</small><strong>{value}</strong></div>;}
function stepText(s:Step,t:(th:string,en:string)=>string){
 const r=s.result??{};
 if(s.tool==='read_catalog_stock')return t(`อ่านสินค้า ${r.products?.length??0} รายการ`,`read ${r.products?.length??0} products`);
 if(s.tool==='read_recent_sales')return t(`ขายไปแล้ว ${r.unitsPaid??0} ชิ้นใน ${r.windowHours} ชม.`,`${r.unitsPaid??0} sold in ${r.windowHours} h`);
 if(s.tool==='read_merchant_limits')return t(`ขอบเขตร้าน: ลดได้สูงสุด ${r.maxDiscountPercent}%`,`shop limits: max ${r.maxDiscountPercent}% off`);
 if(s.tool==='validate_campaign')return r.ok?t(`ผ่าน: ${r.computed?.offerPrice?.value} ${r.computed?.offerPrice?.currency}`,`valid: ${r.computed?.offerPrice?.currency} ${r.computed?.offerPrice?.value}`):t(`ไม่ผ่าน: ${(s.violations??[]).join(', ')}`,`not valid: ${(s.violations??[]).join(', ')}`);
 if(s.tool==='save_campaign_draft')return r.saved?t('บันทึกเป็นร่างแล้ว','saved as a draft'):t('บันทึกไม่ได้','not saved');
 return '';
}
function stateText(state:string,t:(th:string,en:string)=>string){
 return state==='DRAFT'?t('ร่าง','Draft'):state==='APPROVED'?t('อนุมัติแล้ว','Approved'):state==='ENDED'?t('จบแล้ว','Ended'):state==='REVOKED'?t('ยกเลิก','Revoked'):state;
}
/** Owner-facing errors: the shared errorMessage() wording is about a customer's saved order, which is wrong here. */
function ownerError(e:unknown,t:(th:string,en:string)=>string){
 if(e instanceof ApiError){
  if(e.status===429)return t('ใช้ AI ครบโควตาวันนี้แล้ว ใช้แบบฟอร์มแทนได้','Today’s AI allowance is used up. Use the form instead.');
  if(e.status>=500)return t('เซิร์ฟเวอร์ขัดข้อง ลองใหม่อีกครั้ง','The server had a problem. Please try again.');
  if(e.status===409&&e.code)return t('ทำไม่ได้ตอนนี้','Not possible right now')+` (${e.code})`;
 }
 return errorMessage(e);
}
function failureText(code:string|null,t:(th:string,en:string)=>string){
 return code==='CONFIGURATION_REQUIRED'?t('ยังไม่ได้ตั้งค่า AI ของร้าน ใช้แบบฟอร์มแทนได้','AI is not configured for this shop. Use the form instead.')
  :code==='STEP_LIMIT'?t('AI ยังร่างไม่สำเร็จ ลองเขียนให้ชัดขึ้นหรือใช้แบบฟอร์ม','Copilot could not finish a draft. Rephrase or use the form.')
  :t('AI ใช้งานไม่ได้ตอนนี้ ลองใหม่หรือใช้แบบฟอร์ม','Copilot is unavailable right now. Try again or use the form.')+(code?` (${code})`:'');
}
