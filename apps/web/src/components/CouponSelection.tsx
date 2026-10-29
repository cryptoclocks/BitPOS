import {useState} from 'react';
import '../styles/coupon-selection.css';
export type CouponChoice={id:string;title:string;terms:string;eligible:boolean};
/** Presentation only. Eligibility and canonical quote remain caller-owned. */
export default function CouponSelection({coupons,thai=true,onApply,preview=false}:{coupons:CouponChoice[];thai?:boolean;onApply?:(id:string)=>void;preview?:boolean}){
 const [selected,setSelected]=useState<string|null>(null),[notice,setNotice]=useState('');
 const selectedCoupon=coupons.find(c=>c.id===selected&&c.eligible);
 const t=(th:string,en:string)=>thai?th:en;
 return <section className="bp-coupons" aria-labelledby="coupon-heading">
  <header><span className="bp-coupons-brand">BitPOS Pay</span><h1 id="coupon-heading">{t('คูปองสำหรับรายการนี้','Coupons for this order')}</h1></header>
  {preview&&<p className="bp-coupons-notice" role="note">{t('ตัวอย่าง UI · ข้อมูลสมมติ · ไม่มีการใช้คูปองหรือคิดเงินจริง','UI preview · fictional data · no coupon redemption or charge')}</p>}
  <div className="bp-coupons-layout"><div><h2>{t('คูปองที่ใช้ได้','Available coupons')}</h2>
   {coupons.length===0?<p>{t('ยังไม่มีคูปองที่ใช้ได้กับรายการนี้','No eligible coupons for this order')}</p>:<fieldset><legend className="bp-visually-hidden">{t('เลือกคูปอง','Choose a coupon')}</legend>
   {coupons.map(c=><label key={c.id} className={`bp-coupon${selected===c.id?' selected':''}${!c.eligible?' unavailable':''}`}>
    <span aria-hidden="true" className="bp-coupon-icon">%</span><span><strong>{c.title}</strong><small>{c.terms}</small></span>
    <input type="radio" name="coupon" value={c.id} checked={selected===c.id} disabled={!c.eligible} onChange={()=>{setSelected(c.id);setNotice('');}}/>
   </label>)}</fieldset>}</div>
   <aside><h2>{t('ตรวจสอบก่อนใช้','Before applying')}</h2><p>{t('ร้านจะตรวจสิทธิ์และคำนวณยอดใหม่ก่อนยืนยัน คูปองยังไม่เปลี่ยนยอดชำระจนกว่าจะได้รับราคาจากเซิร์ฟเวอร์','Eligibility and the updated total must be confirmed by the server before checkout.')}</p>
   <button type="button" disabled={!selectedCoupon||(!preview&&!onApply)} onClick={()=>{if(!selected||!selectedCoupon)return;if(preview){setNotice(t('เลือกคูปองในตัวอย่างแล้ว · ยังไม่ได้ใช้สิทธิ์จริง','Preview selection recorded · no coupon redeemed'));}else{onApply?.(selected);}}}>{t('ใช้คูปองที่เลือก','Apply selected coupon')}</button>
   <p role="status" aria-live="polite">{notice}</p></aside></div>
 </section>;
}
