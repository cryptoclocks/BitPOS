import React from 'react';
import { saveReceiptLang } from '../lib/receipt-lang';
import type { DocLang } from '../lib/print-slip';

/** Chooses the language of the printed bill; the choice is remembered on this device. */
export default function ReceiptLangPicker({ value, onChange, language }: { value: DocLang; onChange: (v: DocLang) => void; language: 'th' | 'en' }) {
  const label = language === 'th' ? 'ภาษาบิล' : 'Bill language';
  return <label className="receipt-lang"><span>{label}</span>
    <select aria-label={label} value={value} onChange={e => { const v = e.target.value as DocLang; saveReceiptLang(v); onChange(v); }}>
      <option value="th">ไทย</option><option value="en">English</option><option value="both">{language === 'th' ? 'สองภาษา' : 'Thai + English'}</option>
    </select></label>;
}
