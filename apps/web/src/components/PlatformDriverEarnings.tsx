import {parseSettlementSourcePairs} from '../lib/settlement-source-input';
import {formatMoney} from '../lib/money';
import {useEffect,useRef,useState} from 'react';
import {DriverSettlementSession,type DriverSettlementJournal,type DriverSettlementResult,type PendingDriverSettlement} from '../lib/driver-settlement-session';
import {PlatformError} from '../lib/platform-session';
import type {MobileMoney,SettlementEarningItem,SettlementFinancePage} from '../../../../packages/contracts/src/mobile-v1.generated';
import '../styles/food-dispatch.css';

// No floating-point conversion of canonical earning minor units or payout atoms.
function money(value:MobileMoney){return `${formatMoney(value).slice(value.currency.length+1)} ${value.currency}`;}
const uuidPattern='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

export default function PlatformDriverEarnings(){
 const ref=useRef<DriverSettlementSession|null>(null);if(!ref.current)ref.current=new DriverSettlementSession();const api=ref.current;
 const [thai,setThai]=useState(true),[phone,setPhone]=useState(''),[code,setCode]=useState(''),[sent,setSent]=useState(false);
 const [account,setAccount]=useState<string|null>(null),[roles,setRoles]=useState<string[]>([]),[merchant,setMerchant]=useState('');
 const [page,setPage]=useState<SettlementFinancePage|null>(null),[cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState<string|null>(null),[picked,setPicked]=useState<string[]>([]),[stale,setStale]=useState(false);
 const [driver,setDriver]=useState(''),[beneficiary,setBeneficiary]=useState(''),[beneficiaryVersion,setBeneficiaryVersion]=useState(''),[reason,setReason]=useState(''),[batchReason,setBatchReason]=useState(''),[batchSources,setBatchSources]=useState('');
 const [journal,setJournal]=useState<DriverSettlementJournal|null>(null),[result,setResult]=useState<DriverSettlementResult|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const epoch=useRef(0),running=useRef(false),alive=useRef(true);
 const t=(th:string,en:string)=>thai?th:en;
 const allowed=roles.some(role=>role==='finance'||role==='administrator'),pending=journal?.pending??null;
 const item=page?.items.find(row=>row.accrualId===selected),sources=page?.items.filter(row=>picked.includes(row.accrualId)).sort((a,b)=>a.accrualId<b.accrualId?-1:a.accrualId>b.accrualId?1:0)??[];
 const batch=item?.settlement,draft=batch&&journal?.drafts.find(saved=>saved.merchantId===page?.merchantId&&saved.driverId===item?.driverId&&saved.receipt.batchId===batch.batchId&&saved.receipt.version===batch.version);
 const blocked=busy||!!pending||!journal||stale||!page;
 function hideFacts(){epoch.current++;setPage(null);setCursor(null);setSelected(null);setPicked([]);setStale(false);setResult(null);setReason('');setBatchReason('');setBatchSources('');}
 function hideAccount(){hideFacts();setAccount(null);setRoles([]);setJournal(null);setMerchant('');setDriver('');setBeneficiary('');setBeneficiaryVersion('');setCode('');setSent(false);}
 function message(name:string){
  const labels:Record<string,[string,string]>={
   AUTH_REQUIRED:['เข้าสู่ระบบอีกครั้งเพื่อกู้คืนคำสั่งเดิม','Sign in again to recover the original command'],
   PROVIDER_RATE_LIMITED:['ขอรหัสบ่อยเกินไป กรุณารอรอบจำกัดก่อนลองอีกครั้ง อย่าขอซ้ำต่อเนื่อง','Too many authentication requests. Wait for the rate-limit window before trying again; do not repeatedly request codes.'],
   SESSION_CHANGED:['เซสชันเปลี่ยนแล้ว ซ่อนข้อมูลเดิมและเก็บคำสั่งค้างไว้','Session changed; old facts are hidden and unresolved commands are retained'],
   ROLE_REQUIRED:['ไม่มีสิทธิ์การเงินสำหรับร้านนี้ คำสั่งค้างยังไม่ถูกลบ','No finance authority for this merchant; unresolved commands are retained'],
   RESOURCE_NOT_FOUND:['ไม่พบข้อมูลในขอบเขตสิทธิ์ คำสั่งค้างยังไม่ถูกลบ','Resource unavailable in your scope; unresolved commands are retained'],
   VERSION_CONFLICT:['รุ่นข้อมูลเปลี่ยนแล้ว โหลดสถานะใหม่ก่อนสั่งอีกครั้ง','Version changed; reload facts before another command'],
   IDEMPOTENCY_CONFLICT:['รหัสคำสั่งซ้ำกับคำสั่งอื่น เซิร์ฟเวอร์ปฏิเสธคำสั่งนี้','Idempotency key conflicts with another command; this command was rejected'],
   PENDING_COMMAND:['ต้องกู้คืนคำสั่งเดิมก่อน ห้ามสร้างรหัสคำสั่งใหม่','Recover the original command first; do not create a replacement key'],
   INVALID_INPUT:['ตรวจ UUID เหตุผล รุ่น และรายการต้นทางก่อนส่ง','Check UUIDs, reason, versions and selected sources before submission'],
   INVALID_REQUEST:['เซิร์ฟเวอร์ปฏิเสธรูปแบบคำสั่ง โหลดข้อมูลใหม่ก่อนลองอีกครั้ง','Server rejected the command shape; reload before another command'],
   INVALID_RECEIPT:['คำตอบไม่ตรงสัญญา ผลคำสั่งยังไม่ทราบ เก็บคำสั่งเดิมไว้','Response failed the contract; command outcome is unknown and the original is retained'],
   INVALID_SAVED_COMMAND:['ข้อมูลคำสั่งที่เก็บไว้ไม่ถูกต้อง ระงับคำสั่งใหม่และไม่ลบข้อมูลเดิม','Saved journal is invalid; new commands are blocked and stored data is not deleted'],
   JOURNAL_UNAVAILABLE:['ไม่พร้อมจัดเก็บคำสั่งอย่างปลอดภัย ต้องใช้พื้นที่จัดเก็บและ Web Locks ในบริบทปลอดภัย ไม่ส่งคำสั่งใหม่','Safe command storage unavailable. Storage and Web Locks in a secure context are required; no new command is sent'],
   CONFIGURATION_REQUIRED:['การตั้งค่าเซิร์ฟเวอร์หรือผู้ให้บริการไม่พร้อม ไม่ใช่การโอนเงินสำเร็จ คำสั่งเดิมยังเก็บไว้','Server/provider configuration unavailable; no transfer is implied and the original command is retained'],
   SETUP_REQUIRED:['ข้อมูลการชำระเดิมหรือนโยบายโทเคนไม่พร้อม ไม่สามารถสร้างยอดจ่ายทดแทนได้','Original payment/policy setup is missing; no substitute payout amount can be invented'],
   SETTLEMENT_NOT_READY:['รายการ ผู้รับ หรือยอดบัญชียังไม่พร้อม เซิร์ฟเวอร์ปฏิเสธคำสั่งนี้ โหลดสถานะใหม่','Earning, beneficiary or payable facts are not ready; command rejected, reload facts'],
   SETTLEMENT_AUTH_RETRY:['สิทธิ์กำลังเปลี่ยน เก็บคำสั่งเดิมไว้และกู้คืนด้วยข้อมูลเดิมเท่านั้น','Authority is changing; retain and retry only the exact original command'],
   RESPONSE_UNAVAILABLE:['เครือข่ายหรือเซสชันไม่พร้อม ผลคำสั่งอาจยังไม่ทราบ เก็บคำสั่งค้างไว้','Network/session unavailable; a command may have committed and pending data is retained'],
  };
  return labels[name]?t(...labels[name]):t('บริการไม่พร้อม ไม่ถือว่าโอนเงินแล้ว','Service unavailable; no transfer is implied');
 }
 useEffect(()=>{
  alive.current=true;
  const hide=()=>{if(document.visibilityState!=='visible')hideFacts();};
  const changed=(event:StorageEvent)=>{if(!api.isJournalEvent(event.key))return;hideFacts();try{setJournal(api.journal());}catch(e){setJournal(null);setError(e instanceof PlatformError?e.code:'JOURNAL_UNAVAILABLE');}};
  document.addEventListener('visibilitychange',hide);window.addEventListener('storage',changed);
  return()=>{alive.current=false;epoch.current++;document.removeEventListener('visibilitychange',hide);window.removeEventListener('storage',changed);};
 },[api]);
 useEffect(()=>{
  if(!page)return;
  const expire=()=>{setStale(true);setPicked([]);setReason('');setBatchReason('');};
  // Local age guard, not a server-validity guarantee or a polling loop.
  const timer=setTimeout(expire,Math.max(0,60000-(Date.now()-Date.parse(page.snapshotAt))));return()=>clearTimeout(timer);
 },[page]);
 async function run(action:()=>Promise<void>){
  if(running.current)return;running.current=true;setBusy(true);setError('');
  try{await action();}
  catch(e){if(alive.current){const name=e instanceof PlatformError?e.code:'RESPONSE_UNAVAILABLE';setError(name);if(['ROLE_REQUIRED','RESOURCE_NOT_FOUND','SESSION_CHANGED','AUTH_REQUIRED'].includes(name)){hideFacts();if(name==='ROLE_REQUIRED')setRoles([]);}if(!api.accountId)hideAccount();}}
  finally{running.current=false;if(alive.current)setBusy(false);}
 }
 async function authority(){
  hideFacts();setRoles([]);setJournal(null);const owner=epoch.current;
  // Never read another account's journal or expose stored draft context before sign-in.
  const current=await api.roles();
  if(alive.current&&owner===epoch.current){setRoles(current.roles);setJournal(api.journal());}
 }
 async function login(){
  if(!sent){await api.requestOtp(phone.trim());if(alive.current)setSent(true);return;}
  hideAccount();const owner=epoch.current;await api.verify(phone.trim(),code.trim());
  if(!alive.current||owner!==epoch.current)return;setAccount(api.accountId);await authority();
 }
 async function load(after:string|null=null){
  hideFacts();const owner=epoch.current,m=merchant.trim().toLowerCase();
  const current=await api.financePage(m,after);
  if(!alive.current||owner!==epoch.current||document.visibilityState!=='visible')return;
  setPage(current);setCursor(after);setJournal(null);setJournal(api.journal());
 }
 async function submit(saved:PendingDriverSettlement){
  hideFacts();const owner=epoch.current;
  try{
   const receipt=await api.submitSettlement(saved);
   if(alive.current&&owner===epoch.current&&document.visibilityState==='visible')setResult(receipt);
  }finally{
   if(alive.current&&api.accountId){try{setJournal(api.journal());}catch(e){setJournal(null);throw e;}}
  }
 }
 function selectable(row:SettlementEarningItem){
  const anchor=sources[0];
  return row.state==='AVAILABLE'&&row.payout.status==='FROZEN_POLICY_AVAILABLE'&&BigInt(row.money.amountMinor)>0n&&(!row.settlement||['CANCELLED','FAILED'].includes(row.settlement.state))
   &&(!anchor||row.driverId===anchor.driverId&&row.money.currency===anchor.money.currency&&row.money.decimals===anchor.money.decimals&&anchor.payout.status==='FROZEN_POLICY_AVAILABLE'&&JSON.stringify(row.payout.asset)===JSON.stringify(anchor.payout.asset));
 }
 function eligibility(decision:'HOLD'|'RELEASE'){
  if(!item||!page)return;
  void run(()=>submit({kind:'ELIGIBILITY',merchantId:page.merchantId,accrualId:item.accrualId,command:{idempotencyKey:crypto.randomUUID(),expectedVersion:item.version,decision,reason:reason.trim()}}));
 }
 function approve(){
  if(!batch||!page)return;
  void run(async()=>{
   let sources:{sourceIds:string[];sourceVersions:string[]};
   try{sources=draft?{sourceIds:draft.receipt.sourceIds,sourceVersions:draft.receipt.sourceVersions}:parseSettlementSourcePairs(batchSources);}
   catch{throw new PlatformError('INVALID_INPUT',422);} 
   await submit({kind:'BATCH',merchantId:page.merchantId,batchId:batch.batchId,command:{
    kind:'APPROVE_RESERVE',idempotencyKey:crypto.randomUUID(),expectedVersion:batch.version,
    beneficiaryId:batch.beneficiaryId,beneficiaryVersion:batch.beneficiaryVersion,
    sourceIds:sources.sourceIds,
    sourceVersions:sources.sourceVersions,reason:batchReason.trim(),
   }});
  });
 }
 const readiness=(value:string)=>{
  const labels:Record<string,[string,string]>={
   CLOSED:['สิ้นสุดรอบแล้ว ไม่ใช่หลักฐานโอนเงินในตัวเอง','Batch closed; closure alone is not transfer proof'],
   BENEFICIARY_PENDING:['ผู้รับยังรอการตรวจสอบสิทธิ์','Beneficiary ownership verification pending'],
   PROVIDER_UNAVAILABLE:['ผู้ให้บริการยังไม่พร้อมหรือตั้งค่าไม่ครบ','Provider unavailable or unconfigured'],
   AWAITING_APPROVAL:['รออนุมัติสำรองบัญชี ไม่ใช่การโอน','Awaiting accounting reserve approval, not a transfer'],
   VERIFIED_FUNDING_REQUIRED:['ต้องมีเงินทุนที่ผ่านการตรวจสอบ ไม่ใช่เพียงยอดเจ้าหนี้','Verified funding required; a payable balance is not liquidity'],
   FUNDING_RECONCILIATION_REQUIRED:['ต้องตรวจสอบกระทบยอดเงินทุน ห้ามอนุมานว่าโอนแล้วหรือพร้อมจ่ายใหม่','Funding reconciliation required; do not infer payment or replacement readiness'],
   SOURCE_RECONCILIATION_REQUIRED:['ต้องตรวจสอบผลจ่ายเดิมที่ขัดแย้ง ห้ามอนุมานว่าโอนแล้วหรือพร้อมจ่ายใหม่','Source reconciliation required after contradictory prior payment evidence; do not infer payment or replacement readiness'],
   AWAITING_SIGNATURE:['รอผู้ปฏิบัติงานลงนาม ไม่ถือว่าจ่ายแล้ว','Awaiting worker signature; not paid'],
   READY_FOR_INITIAL_BROADCAST:['ผู้ปฏิบัติงานพร้อมส่งรายการที่กำหนด ไม่ใช่ยืนยันโอน','Worker ready for initial broadcast; not transfer confirmation'],
   EXACT_REBROADCAST_OR_RECONCILIATION_ONLY:['ส่งซ้ำได้เฉพาะรายการเดิมหรือกระทบยอด ห้ามสร้างรายการใหม่','Exact rebroadcast or reconciliation only; never a replacement transfer'],
  };return labels[value]?t(...labels[value]):value;
 };
 return <main className="dispatch-console" lang={thai?'th':'en'}>
  <aside className="dispatch-sidebar"><strong>BitPOS</strong><small>PLATFORM · {t('การเงินไรเดอร์','DRIVER FINANCE')}</small><nav><a href="/platform/support">{t('ช่วยเหลือลูกค้า','Customer support')}</a>
   <a href="/platform/food-dispatch">{t('จัดส่งและไรเดอร์','Food dispatch')}</a>
   <a href="/platform/food-incidents">{t('เหตุและความช่วยเหลือ','Incidents and support')}</a>
   <a href="/platform/food-cancellation-reviews">{t('ตรวจคำขอยกเลิก','Cancellation reviews')}</a>
   <a href="/platform/drivers">{t('ตรวจสิทธิ์ไรเดอร์','Driver verification')}</a>
   <a href="/platform/driver-earnings" aria-current="page">{t('รายได้และรอบจ่ายไรเดอร์','Driver earnings and settlement')}</a>
  </nav></aside>
  <div className="dispatch-main">
   <header><span>{t('เจ้าหน้าที่การเงิน · เซสชันแยกจากร้าน','Finance staff · independent mobile session')}</span><button onClick={()=>setThai(!thai)}>{thai?'English':'ไทย'}</button></header>
   <div className="dispatch-heading"><h1>{t('รายได้และรอบจ่ายไรเดอร์','Driver earnings and settlement')}</h1><p>{t('รายการจริงตามสิทธิ์ร้าน ไม่มีช่วงวันที่หรือยอดรายวันสมมติ สิทธิ์และรุ่นตรวจซ้ำที่เซิร์ฟเวอร์ทุกคำสั่ง','Server earning facts within merchant scope. No date-range or daily-total claims. Every command rechecks authority and versions.')}</p></div>
   {error&&<section className="dispatch-notice" role="alert">{message(error)} <small>({error})</small></section>}
   {!account?<form className="dispatch-login" onSubmit={event=>{event.preventDefault();void run(login);}}>
    <h2>{t('เข้าสู่ระบบเจ้าหน้าที่','Staff sign in')}</h2><p>{t('ไม่ใช้สิทธิ์หรือคุกกี้ร้านเพื่อสั่งการเงิน','Merchant authentication never grants finance authority.')}</p>
    <label>{t('โทรศัพท์','Phone')}<input type="tel" autoComplete="tel" required pattern="\+[1-9][0-9]{7,14}" disabled={busy||sent} value={phone} onChange={event=>setPhone(event.target.value)}/></label>
    {sent&&<label>OTP<input required pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" disabled={busy} value={code} onChange={event=>setCode(event.target.value)}/></label>}
    <button disabled={busy}>{sent?t('ยืนยัน OTP','Verify OTP'):t('ขอ OTP','Request OTP')}</button>
    {sent&&<button type="button" disabled={busy} onClick={()=>{setSent(false);setCode('');}}>{t('เปลี่ยนหมายเลข','Change phone')}</button>}
   </form>:<>
    <section className="dispatch-scope"><span>{t('บัญชี','Account')}: {account}</span><button disabled={busy} onClick={()=>void run(authority)}>{t('โหลดสิทธิ์ใหม่','Reload authority')}</button><button disabled={busy} onClick={()=>void run(async()=>{hideAccount();await api.logout();})}>{t('ออกจากระบบ / เปลี่ยนบัญชี','Sign out / switch account')}</button></section>
    {!allowed?<section className="dispatch-notice" role="status">{t('ต้องมีสิทธิ์ finance หรือ administrator และขอบเขตร้านที่ได้รับมอบหมาย โหลดสิทธิ์ใหม่หลังได้รับอนุญาต','Finance or administrator role and an assigned merchant scope are required. Reload authority after access is granted.')}</section>:<>
     {pending&&<section className="dispatch-notice" aria-label={t('คำสั่งค้างของบัญชีนี้','Account-owned unresolved command')}>
      <h2>{t('ผลคำสั่งเดิมยังไม่ทราบ','Original command unresolved')}</h2><p>{pending.kind} · {pending.command.idempotencyKey}</p><p>{t('ร้าน','Merchant')}: {pending.kind==='PREPARE'?pending.command.merchantId:pending.merchantId}</p>
      <p>{t('โหลดข้อมูลหรือเข้าสู่ระบบใหม่ไม่ลบคำสั่ง ห้ามแก้ไขรุ่น เหตุผล หรือรหัสเพื่อส่งแทนคำสั่งเดิม','Reload and sign-in do not discard pending data. Never change versions, reason or key to replace this command.')}</p>
      <details><summary>{t('ดูข้อมูลคำสั่งเดิม','Inspect original command')}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(pending,null,2)}</pre></details>
      <button disabled={busy} onClick={()=>void run(()=>submit(pending))}>{t('กู้คืนคำสั่งเดิมทุกไบต์','Retry exact original command')}</button>
     </section>}
     <form className="dispatch-scope" onSubmit={event=>{event.preventDefault();void run(()=>load());}}>
      <label>{t('รหัสร้าน (UUID) — เซิร์ฟเวอร์ตรวจขอบเขตสิทธิ์','Merchant UUID — server-enforced role scope')}<input required pattern={uuidPattern} disabled={busy} value={merchant} onChange={event=>{hideFacts();setDriver('');setBeneficiary('');setBeneficiaryVersion('');setMerchant(event.target.value);}}/></label><button disabled={busy}>{t('โหลดรายการปัจจุบัน','Load current facts')}</button>
     </form>
     {result&&<section className="dispatch-notice" role="status"><h2>{t('ใบรับคำสั่งบัญชี ไม่ใช่ใบยืนยันโอน','Accounting command receipt, not payout proof')}</h2>
      <p>{result.receipt.kind} · v{result.receipt.version}</p><p>{result.kind==='ELIGIBILITY'?result.receipt.accrualId:result.receipt.batchId}</p>
      <p>{t('โอนเงินแล้ว','fundsTransferred')}: <strong>false</strong></p>
      {result.kind!=='ELIGIBILITY'&&<><p>{t('รายได้ที่เป็นหนี้','Earning obligation')}: {money(result.receipt.money)}</p><p>{t('ยอดจ่ายโทเคนตามนโยบายเดิม','Original-policy token payout')}: {money(result.receipt.payoutMoney)} · {result.receipt.asset.displayLabel}</p><p>outwardReady: false</p></>}
      <p>{t('การเตรียมคือร่าง การอนุมัติคือสำรองบัญชี การยกเลิกยกเลิกเฉพาะร่าง ทั้งหมดไม่ได้โอนเงิน โหลดรายการใหม่ก่อนสั่งต่อ','Prepare creates a draft; approve reserves accounting funds; cancel only cancels a draft. None transfers money. Reload facts before another command.')}</p>
      <details><summary>{t('ใบรับที่ผ่านสัญญา รวมรหัสและรุ่นต้นทางเดิม','Validated command receipt, including original source/version context')}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(result.receipt,null,2)}</pre></details>
      <button disabled={busy} onClick={()=>void run(()=>load())}>{t('โหลดผลล่าสุดจากเซิร์ฟเวอร์','Reload server facts')}</button>
     </section>}
     <div className="dispatch-workspace">
      <section className="dispatch-board" aria-busy={busy}>
       <h2>{t('ข้อเท็จจริงรายได้','Earning facts')}</h2><p>{t('เรียงตามรหัส รายการละสกุลเงิน แสดงครั้งละไม่เกิน 50 รายการ ไม่ใช่สตรีมสด การพร้อมจ่ายไม่ใช่เงินทุนพร้อม','ID-ordered pages, up to 50 items each, currencies kept separate. Snapshots are not a live stream. Availability is not liquidity.')}</p>
       {!page&&<p role="status">{busy?t('กำลังโหลดหรือกู้คืนคำสั่ง','Loading or recovering command'):t('ยังไม่มีภาพสถานะสำหรับขอบเขตนี้ โหลดรายการเพื่อแสดงข้อมูล','No snapshot for this scope. Load facts to view server data.')}</p>}
       {page&&<><p><small>{t('ภาพสถานะ','Snapshot')}: {new Date(page.snapshotAt).toLocaleString(thai?'th-TH':'en-GB')} · {t('เริ่มหลังรหัส','After ID')}: {cursor??t('หน้าแรก','first page')}</small></p>
        {stale&&<p role="status">{t('ภาพสถานะเกินหนึ่งนาที ปิดคำสั่งที่อิงรุ่นจนกว่าจะโหลดใหม่','Snapshot is over one minute old. Versioned controls are disabled until reload.')}</p>}
        {page.items.length===0&&<p role="status">{cursor?t('ไม่มีรายการหลังรหัสนี้','No earnings after this cursor'):t('ยังไม่มีข้อเท็จจริงรายได้สำหรับร้านนี้','No earning facts for this merchant yet')}</p>}
        <div className="dispatch-jobs">{page.items.map(row=><article key={row.accrualId} className="dispatch-job" style={{padding:16}}>
         <strong>{money(row.money)} · {row.state}</strong><small>{row.accrualId} · v{row.version}</small><span>{t('ไรเดอร์','Driver')}: {row.driverId}</span>
         <span>{t('ยอดจ่ายแยกต่างหาก','Separate payout')}: {row.payout.status==='FROZEN_POLICY_AVAILABLE'?`${money(row.payout.payoutMoney)} · ${row.payout.asset.displayLabel}`:row.payout.status==='SETUP_REQUIRED'?`${t('ตั้งค่าไม่พร้อม','Setup required')} · ${row.payout.reasonCode}`:t('รายได้เป็นศูนย์ ไม่มีรายการจ่าย','Zero earning; no payout')}</span>
         <button disabled={busy} aria-pressed={selected===row.accrualId} onClick={()=>{setSelected(row.accrualId);setReason('');setBatchReason('');setBatchSources('');setResult(null);}}>{t('ดูรายละเอียด / ควบคุม','Detail / controls')}</button>
         <label className="dispatch-check"><input type="checkbox" checked={picked.includes(row.accrualId)} disabled={blocked||!selectable(row)} onChange={event=>{setPicked(current=>event.target.checked?[...current,row.accrualId]:current.filter(id=>id!==row.accrualId));if(event.target.checked)setDriver(row.driverId);}}/>{t('ใช้เป็นต้นทางร่างรอบจ่าย','Select as batch source')}</label>
        </article>)}</div>
        <div className="dispatch-actions"><button disabled={busy} onClick={()=>void run(()=>load())}>{t('หน้าแรก / โหลดใหม่','First page / reload')}</button><button disabled={busy||!page.nextAfterId} onClick={()=>{const after=page.nextAfterId;if(after)void run(()=>load(after));}}>{t('หน้าถัดไป','Next page')}</button></div>
       </>}
       {item&&<section className="dispatch-detail"><h3>{t('รายละเอียดรายได้','Earning detail')}</h3>
        <dl><dt>{t('ออร์เดอร์ / งาน','Order / assignment')}</dt><dd>{item.orderId} / {item.assignmentId}</dd><dt>{t('สร้างเมื่อ / พร้อมตามบัญชีเมื่อ','Created / available at')}</dt><dd>{item.createdAt} / {item.availableAt}</dd><dt>{t('ผลพิจารณาล่าสุด','Last eligibility decision')}</dt><dd>{item.eligibilityDecision?`${item.eligibilityDecision.decision} · ${item.eligibilityDecision.decidedAt}`:t('ยังไม่มีผลพิจารณา','No eligibility decision')}</dd><dt>{t('จำนวนรายได้จริง / ทศนิยม','Earning minor units / decimals')}</dt><dd>{item.money.amountMinor} / {item.money.decimals} · {item.money.currency}</dd></dl>
        {item.payout.status==='FROZEN_POLICY_AVAILABLE'&&<dl><dt>{t('จำนวนโทเคนจริง / ทศนิยม','Payout atoms / decimals')}</dt><dd>{item.payout.payoutMoney.amountMinor} / {item.payout.payoutMoney.decimals} · {item.payout.payoutMoney.currency}</dd><dt>Network / mint / token program</dt><dd>{item.payout.asset.cluster} / {item.payout.asset.mint} / {item.payout.asset.tokenProgram}</dd></dl>}
        <label>{t('เหตุผลการ HOLD / RELEASE (บันทึกตรวจสอบ)','HOLD / RELEASE reason (audited)')}<textarea maxLength={1000} value={reason} disabled={blocked} onChange={event=>setReason(event.target.value)}/></label>
        <p>{t('รุ่นที่คาดหวัง','expectedVersion')}: {item.version} · {t('ทุกคำสั่งสร้างรหัส idempotency และเก็บก่อนส่ง','Every new command gets an idempotency key persisted before sending')}</p>
        <div className="dispatch-actions"><button disabled={blocked||!reason.trim()||!['ACCRUED','HELD','AVAILABLE'].includes(item.state)} onClick={()=>eligibility('HOLD')}>{t('พักสิทธิ์รายได้ (HOLD)','Hold eligibility (HOLD)')}</button><button disabled={blocked||!reason.trim()||!['ACCRUED','HELD','AVAILABLE'].includes(item.state)} onClick={()=>eligibility('RELEASE')}>{t('ปล่อยสิทธิ์รายได้ (RELEASE)','Release eligibility (RELEASE)')}</button></div>
        <p>{t('RELEASE ไม่ใช่การจ่ายเงิน HOLD ไม่ใช่การคืนเงิน','RELEASE is not a payout; HOLD is not a refund.')}</p>
        {batch&&<><button type="button" disabled={blocked} onClick={()=>{setDriver(item.driverId);setBeneficiary(batch.beneficiaryId);setBeneficiaryVersion(batch.beneficiaryVersion);setPicked([]);}}>{t('ใช้ข้อมูลผู้รับจากรอบนี้ในแบบฟอร์ม','Use this batch recipient in the preparation form')}</button><p>{t('ใช้รหัสและรุ่นที่แสดงเท่านั้น ไม่ยืนยันว่าผู้รับยังมีสิทธิ์ เซิร์ฟเวอร์ตรวจใหม่เมื่อส่ง','Copies displayed IDs and version only. Eligibility is rechecked by the server on submission.')}</p><h3>{t('รอบจ่ายปัจจุบันจากเซิร์ฟเวอร์','Current server settlement')}</h3><p>{batch.batchId} · {batch.state} · v{batch.version}</p><p>{readiness(batch.readiness)} <small>({batch.readiness})</small></p>
         <dl><dt>{t('ยอดรายได้ / ยอดโทเคนของทั้งรอบ','Whole-batch earning / token payout')}</dt><dd>{money(batch.money)} / {money(batch.payoutMoney)}</dd><dt>{t('ผู้รับ / รุ่นที่ตรึงไว้','Beneficiary / frozen version')}</dt><dd>{batch.beneficiaryId} / {batch.beneficiaryVersion}</dd><dt>{t('สถานะความพยายามโอน','Transfer attempt state')}</dt><dd>{batch.attemptState??t('ยังไม่มี','None')}</dd><dt>outwardReady</dt><dd>{String(batch.outwardReady)} · {t('ความพร้อมผู้ปฏิบัติงาน ไม่ใช่ยืนยันโอน','Worker readiness, not transfer proof')}</dd></dl>
         {batch.state==='CONFIRMED'&&batch.attemptState==='CONFIRMED'&&batch.receiptId&&batch.confirmedAt?<p role="status">{t('เซิร์ฟเวอร์บันทึกผลโอน finalized ที่ตรวจสอบแล้ว','Server reports a verified finalized outbound transfer')}: {batch.receiptId} · {batch.confirmedAt}</p>:<p>{t('ยังไม่มีหลักฐานโอน finalized ที่ครบในภาพสถานะนี้ สถานะ SUBMITTED / UNKNOWN หรือแฮชไม่ยืนยันว่าจ่ายแล้ว','No complete finalized transfer receipt in this snapshot. SUBMITTED / UNKNOWN or a hash does not establish payout.')}</p>}
        </>}
       </section>}
      </section>
      <section className="dispatch-policy"><h2>{t('เตรียมรอบจ่าย','Prepare settlement batch')}</h2>
       <p>{t('เลือกต้นทางในหน้าปัจจุบัน ไม่เกิน 50 รายการ ไรเดอร์เดียว สกุลรายได้เดียว และสินทรัพย์จ่ายเดิมเดียวกัน ต้นทางและรุ่นจับคู่ตามลำดับรหัส','Select up to 50 sources from the current page, for one driver, earning denomination and original payout asset. Source IDs and versions remain paired in ID order.')}</p>
       <form onSubmit={event=>{event.preventDefault();if(!page||!sources.length)return;void run(()=>submit({kind:'PREPARE',command:{idempotencyKey:crypto.randomUUID(),expectedVersion:'0',merchantId:page.merchantId,driverId:driver.trim().toLowerCase(),beneficiaryId:beneficiary.trim().toLowerCase(),beneficiaryVersion:beneficiaryVersion.trim(),sourceIds:sources.map(row=>row.accrualId),sourceVersions:sources.map(row=>row.version)}}));}}>
        <fieldset disabled={blocked}>
         <label>{t('รหัสไรเดอร์ (UUID)','Driver UUID')}<input required pattern={uuidPattern} value={driver} onChange={event=>{setDriver(event.target.value);setPicked([]);}}/></label>
         <label>{t('รหัสผู้รับที่ลงทะเบียนแล้ว (UUID)','Enrolled beneficiary UUID')}<input required pattern={uuidPattern} value={beneficiary} onChange={event=>setBeneficiary(event.target.value)}/></label>
         <label>{t('รุ่นผู้รับที่คาดหวัง','Expected beneficiary version')}<input required pattern="[1-9][0-9]{0,18}" inputMode="numeric" value={beneficiaryVersion} onChange={event=>setBeneficiaryVersion(event.target.value)}/></label>
         <p>expectedVersion: 0 · {t('ต้นทางที่เลือก','Selected sources')}: {sources.length}</p>
         <div style={{overflowWrap:'anywhere'}}>{sources.map(row=><p key={row.accrualId}>{row.accrualId} · v{row.version} · {money(row.money)}</p>)}</div>
         <p>{t('หน้านี้ไม่มี API ค้นผู้รับหรืออนุมัติสิทธิ์กระเป๋า ใช้ UUID และรุ่นจากกระบวนการที่ได้รับอนุญาต เซิร์ฟเวอร์ตรวจความเป็นเจ้าของอีกครั้ง','This surface has no beneficiary discovery or wallet-proof approval API. Supply the UUID/version from authorized enrollment; the server rechecks ownership.')}</p>
         <button disabled={blocked||!sources.length||sources.some(row=>row.driverId!==driver.trim().toLowerCase())}>{t('เตรียมร่าง — ยังไม่สำรองหรือโอน','Prepare draft — no reserve or transfer')}</button>
        </fieldset>
       </form>
       {batch?.state==='DRAFT'&&<section className="dispatch-detail"><h3>{t('ควบคุมร่างที่เลือก','Selected draft controls')}</h3><p>{batch.batchId} · expectedVersion: {batch.version}</p>
        <p>{t('การอนุมัติเป็นการสำรองทางบัญชีเท่านั้น ผู้รับต้องผ่านการตรวจสอบและผู้ให้บริการต้องพร้อม การโอนยังต้องมีเงินทุนจริงที่ตรวจสอบแล้ว','Approval only reserves accounting funds. The beneficiary must be verified and provider configured. A transfer still requires independently verified funding.')}</p>
        {draft?<details><summary>{t('ข้อมูลต้นทางจากใบรับร่างเดิมที่เก็บในบัญชีนี้','Exact source context from this account’s saved draft receipt')}</summary><div style={{overflowWrap:'anywhere'}}>{draft.receipt.sourceIds.map((id,index)=><p key={id}>{id} · v{draft.receipt.sourceVersions[index]}</p>)}</div></details>:<><p>{t('ไม่มีใบรับร่างเดิมของบัญชีนี้สำหรับรุ่นปัจจุบัน กรอกต้นทางทั้งหมดจากใบรับเดิม ห้ามเดาจากรายการในหน้านี้ เซิร์ฟเวอร์ตรวจว่าตรงทุกคู่','No matching draft receipt is stored for this account. Supply all original source/version pairs from the original receipt, never infer them from this page. The server checks every pair.')}</p><label>{t('ต้นทางเดิม เรียงตาม UUID: UUID ตามด้วยเวอร์ชัน บรรทัดละหนึ่งคู่','Original sources in UUID order: UUID then version, one pair per line')}<textarea value={batchSources} disabled={blocked} onChange={event=>setBatchSources(event.target.value)} spellCheck={false}/></label></>}
        <label>{t('เหตุผลอนุมัติหรือยกเลิกร่าง','Reserve / cancel reason')}<textarea maxLength={1000} value={batchReason} disabled={blocked} onChange={event=>setBatchReason(event.target.value)}/></label>
        <div className="dispatch-actions"><button disabled={blocked||!draft&&!batchSources.trim()||!batchReason.trim()||batch.readiness!=='AWAITING_APPROVAL'} onClick={approve}>{t('อนุมัติสำรองบัญชี — ไม่ใช่โอน','Approve accounting reserve — not transfer')}</button>
         <button disabled={blocked||!batchReason.trim()} onClick={()=>{if(!page)return;void run(()=>submit({kind:'BATCH',merchantId:page.merchantId,batchId:batch.batchId,command:{kind:'CANCEL_DRAFT',idempotencyKey:crypto.randomUUID(),expectedVersion:batch.version,reason:batchReason.trim()}}));}}>{t('ยกเลิกเฉพาะร่าง','Cancel draft only')}</button></div>
       </section>}
       <section className="dispatch-detail"><h3>{t('ความหมายของยอดและหลักฐาน','Money and receipt meaning')}</h3><p>{t('รายได้ USD/2 หรือ USDG/6 แยกจากจำนวนโทเคนจ่าย/6 ตามนโยบายเดิม ไม่แปลงสกุลหรือสมมติว่าเท่ากัน','USD/2 or USDG/6 earning obligations are separate from original-policy payout token atoms/6. No currency conversion or assumed equality.')}</p><p>{t('ใบรับคำสั่งทุกประเภทบนหน้านี้ fundsTransferred=false การตอบกลับกระเป๋า ลายเซ็น หรือ proof hash ไม่ใช่อำนาจยืนยันจ่ายเงิน','Every command receipt here has fundsTransferred=false. A wallet callback, signature or proof hash is never payout authority.')}</p><p>{t('ไม่มีปุ่มเติมเงิน ลงนาม ส่งเชน หรือเรียก worker การตั้งค่าและเงินทุนที่ไม่พร้อมจะแสดงจากภาพสถานะจริงเท่านั้น','No funding, signing, chain submission or private-worker controls. Configuration and funding gaps are shown only from server snapshots.')}</p></section>
      </section>
     </div>
    </>}
   </>}
   <footer>{t('ระบบภาพอ้างอิง P38 / R16 / R17 ใช้ธีมและโครงหน้าแพลตฟอร์มเดิม ไม่อ้างความตรงทุกพิกเซล ข้อมูลเข้าสู่ระบบอยู่ในหน่วยความจำ คำสั่งค้างและใบรับร่างเก็บแยกตามบัญชี ต้องเข้าสู่ระบบเดิมเพื่อกู้คืน ข้อมูลบนหน้าถูกซ่อนเมื่อเปลี่ยนบัญชี โหลดใหม่ หรือซ่อนแท็บ','P38 / R16 / R17 visual references, existing platform theme and responsive shell; not pixel-parity acceptance. Credentials stay in memory. Pending commands and draft source receipts are account-owned and require sign-in to recover. Visible facts are hidden on account changes, refresh and tab hiding.')}</footer>
  </div>
 </main>;
}
