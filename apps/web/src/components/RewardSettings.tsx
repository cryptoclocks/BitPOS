import React,{useEffect,useState} from 'react';
import {api,errorMessage} from '../lib/api';
import type {Session} from '../lib/table';
import {fromMinor,rewardBody,type RewardDraft,type RewardRow,type RewardSettingsView} from '../lib/reward-setup';
const blank=(slot:number):RewardDraft=>({slot,nameTh:'',nameEn:'',pointsCost:'',discount:'',minimumSpend:'',validityDays:'30',enabled:true});
const draftOf=(r:RewardRow):RewardDraft=>({slot:r.slot,nameTh:r.nameTh,nameEn:r.nameEn,pointsCost:String(r.pointsCost),discount:fromMinor(r.discountMinor,r.decimals),minimumSpend:fromMinor(r.minimumSpendMinor,r.decimals),validityDays:String(r.validityDays),enabled:r.enabled});
/** Owner/manager setup of 1-3 merchant-funded reward vouchers (demo grade). The server prices and redeems them; this card only edits definitions. */
export default function RewardSettings({session,language}:{session:Session;language:'th'|'en'}){
 const text=(th:string,en:string)=>language==='th'?th:en;
 const [view,setView]=useState<RewardSettingsView>(),[drafts,setDrafts]=useState<RewardDraft[]>([]),[busy,setBusy]=useState(0),[message,setMessage]=useState(''),[error,setError]=useState('');
 const apply=(value:RewardSettingsView)=>{setView(value);setDrafts([1,2,3].map(slot=>{const row=value.rewards.find(r=>r.slot===slot);return row?draftOf(row):blank(slot);}));};
 useEffect(()=>{let active=true;void api<RewardSettingsView>('/settings/rewards',undefined,session.token).then(v=>{if(active)apply(v);}).catch(e=>{if(active)setError(errorMessage(e));});return()=>{active=false;};},[session.token]);
 const reasons:Record<string,[string,string]>={name:['กรอกชื่อไทยและอังกฤษ (ไม่เกิน 80 ตัวอักษร)','Enter a Thai and an English name (80 characters at most).'],points:['แต้มที่ใช้ต้องเป็นจำนวนเต็ม 1 ขึ้นไป','Points must be a whole number of 1 or more.'],discount:['ส่วนลดต้องมากกว่า 0 และไม่เกินทศนิยมของสกุลเงิน','The discount must be above 0 and within the currency precision.'],minimum:['ใส่ยอดขั้นต่ำเป็นจำนวนเงินที่มากกว่า 0','Enter a minimum spend above 0.'],'minimum-too-low':['ยอดขั้นต่ำต้องมากกว่าส่วนลด เพื่อไม่ให้ออเดอร์เหลือ 0','The minimum spend must be higher than the discount so an order is never free.'],validity:['อายุคูปองต้องเป็น 1-365 วัน','Validity must be 1-365 days.']};
 async function save(slot:number){
  if(!view||view.decimals===null||busy)return;const draft=drafts.find(d=>d.slot===slot)!,parsed=rewardBody(draft,view.decimals);
  setMessage('');setError('');if(!parsed.ok){setError(text(...reasons[parsed.reason]));return;}
  setBusy(slot);try{apply(await api<RewardSettingsView>('/settings/rewards',parsed.body,session.token,'PUT'));setMessage(text('บันทึกรางวัลแล้ว','Reward saved.'));}catch(e){setError(errorMessage(e));}finally{setBusy(0);}
 }
 const change=(slot:number,patch:Partial<RewardDraft>)=>setDrafts(list=>list.map(d=>d.slot===slot?{...d,...patch}:d));
 if(!view)return <section className="panel reward-settings" aria-label="Reward vouchers"><h2>{text('รางวัลแลกแต้ม','Point rewards')}</h2>{error?<p role="alert">{error}</p>:<p>{text('กำลังโหลด…','Loading…')}</p>}</section>;
 return <section className="panel reward-settings" aria-label="Reward vouchers">
  <h2>{text('รางวัลแลกแต้ม (เดโม)','Point rewards (demo)')}</h2>
  <p>{text('ลูกค้าได้ 1 แต้มต่อเงิน 1 หน่วยเต็มของออเดอร์ออนไลน์ที่ชำระแล้วและไม่มีการคืนเงินที่ร้านคุณ แลกเป็นคูปองส่วนลดแบบใช้ครั้งเดียวที่ร้านคุณเป็นผู้รับภาระเอง ระบบคิดราคาผ่านคูปองเดิมบนเซิร์ฟเวอร์ ส่วนลดและยอดขั้นต่ำแก้ไม่ได้หลังบันทึก หากต้องการเปลี่ยนให้ปิดรางวัลนั้นแล้วสร้างในช่องอื่น คูปองที่หมดอายุโดยไม่ได้ใช้จะไม่คืนแต้ม','Customers earn 1 point per whole currency unit of a paid, refund-free online order at your shop and swap points for a single-use discount voucher that you fund. The server prices it through the existing coupon path. The discount and minimum spend cannot be edited after saving; to change them, turn the reward off and create another in a free slot. Points are not returned when a voucher expires unused.')}</p>
  {view.currency===null&&<p role="status">{text('ต้องประกาศราคาสินค้าก่อนจึงจะตั้งรางวัลได้','Publish your prices before setting up rewards.')}</p>}
  {view.currency!==null&&<p className="muted">{text('สกุลเงิน','Currency')}: {view.currency}</p>}
  {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  {view.currency!==null&&drafts.map(draft=>{const saved=view.rewards.some(r=>r.slot===draft.slot);return <fieldset key={draft.slot} className="reward-slot" disabled={busy!==0} data-slot={draft.slot}>
   <legend>{text('ช่องที่','Slot')} {draft.slot}{saved?'':text(' (ว่าง)',' (empty)')}</legend>
   <label>{text('ชื่อ (ไทย)','Name (Thai)')}<input value={draft.nameTh} maxLength={80} onChange={e=>change(draft.slot,{nameTh:e.target.value})}/></label>
   <label>{text('ชื่อ (อังกฤษ)','Name (English)')}<input value={draft.nameEn} maxLength={80} onChange={e=>change(draft.slot,{nameEn:e.target.value})}/></label>
   <label>{text('แต้มที่ใช้แลก','Points to redeem')}<input inputMode="numeric" value={draft.pointsCost} onChange={e=>change(draft.slot,{pointsCost:e.target.value})}/></label>
   <label>{text('ส่วนลด','Discount')} ({view.currency})<input inputMode="decimal" value={draft.discount} disabled={saved} onChange={e=>change(draft.slot,{discount:e.target.value})}/></label>
   <label>{text('ยอดอาหารขั้นต่ำ','Minimum food spend')} ({view.currency})<input inputMode="decimal" value={draft.minimumSpend} disabled={saved} onChange={e=>change(draft.slot,{minimumSpend:e.target.value})}/></label>
   <label>{text('อายุคูปอง (วัน)','Voucher validity (days)')}<input inputMode="numeric" value={draft.validityDays} onChange={e=>change(draft.slot,{validityDays:e.target.value})}/></label>
   <label className="inline"><input type="checkbox" checked={draft.enabled} onChange={e=>change(draft.slot,{enabled:e.target.checked})}/> {text('เปิดให้แลก','Open for redemption')}</label>
   {saved&&<p className="muted">{text('ปิดรางวัลจะหยุดการแลกใหม่ คูปองที่ออกไปแล้วยังใช้ได้จนหมดอายุ','Turning a reward off stops new redemptions; vouchers already issued stay valid until they expire.')}</p>}
   <button type="button" onClick={()=>void save(draft.slot)}>{busy===draft.slot?text('กำลังบันทึก…','Saving…'):text('บันทึก','Save')}</button>
  </fieldset>;})}
 </section>;
}
