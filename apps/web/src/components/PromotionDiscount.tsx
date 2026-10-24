import React, { useEffect, useState } from 'react';
import type { Money } from '../../../../packages/contracts/src/index';
import { decimalAmount, formatMoney } from '../lib/money';
import { discountPreview, percentForReduction } from '../lib/promotion-discount';
export default function PromotionDiscount({base,percent,cap,language,onChange,onValidity}:{base:Money;percent:number;cap:number;language:'th'|'en';onChange:(percent:number)=>void;onValidity:(valid:boolean)=>void}) {
  const text=(th:string,en:string)=>language==='th'?th:en;
  const [mode,setMode]=useState<'percent'|'amount'>('percent');
  const [value,setValue]=useState(String(percent));
  const [error,setError]=useState('');
  let preview: ReturnType<typeof discountPreview> | undefined;try{preview=discountPreview(base,percent);}catch{}
  useEffect(()=>{setValue(mode==='percent'?String(percent):preview?decimalAmount(preview.reduction):'');setError('');onValidity(!!preview);},[base.amountMinor,base.currency,percent,mode]);
  function update(value:string){
    setValue(value);setError('');
    try {
      const next=mode==='amount'?percentForReduction(base,value,cap):Number(value);
      if(!value.trim()||!Number.isInteger(next)||next<1||next>cap)throw Error();
      discountPreview(base,next);onChange(next);onValidity(true);
    }catch{onValidity(false);setError(mode==='amount'?text('จำนวนเงินนี้ไม่ตรงกับส่วนลดที่ระบบรองรับ หรือเกินเพดาน ลองจำนวนอื่นหรือเลือก %','This exact amount cannot be represented within the discount cap. Choose another amount or %.'):text(`ใส่ส่วนลด 1–${cap}% ที่ลดราคาได้จริง`,`Enter 1–${cap}% that reduces the price.`));}
  }
  return <div className="promotion-discount-editor">
    <div className="promotion-mode" role="group" aria-label={text('วิธีตั้งส่วนลด','Discount method')}>
      <button type="button" className="secondary" aria-pressed={mode==='amount'} onClick={()=>setMode('amount')}>{text('ลดเป็น','Amount off')} {base.currency}</button>
      <button type="button" className="secondary" aria-pressed={mode==='percent'} onClick={()=>setMode('percent')}>{text('ลดเป็น %','Percent off')}</button>
    </div>
    <label>{mode==='amount'?text(`จำนวนเงินที่ลด (${base.currency})`,`Amount off (${base.currency})`):text('ส่วนลด (%)','Discount (%)')}<input type="text" inputMode="decimal" required value={value} aria-invalid={!!error} onChange={event=>update(event.target.value)}/></label>
    {error?<p className="error" role="alert">{error}</p>:preview&&<div className="promotion-discount-result" aria-live="polite"><div><small>{text('ราคาเดิม','Original')}</small><strong>{formatMoney(base)}</strong></div><span>→</span><div><small>{text('ราคาหลังลด','After discount')}</small><strong>{formatMoney(preview.final)}</strong></div><p>{text('ลด','Save')} {formatMoney(preview.reduction)} · {preview.effectivePercent}%{preview.effectivePercent!==percent&&text(' หลังปัดเศษตามหน่วยเงิน',' after currency rounding')}</p></div>}
  </div>;
}
