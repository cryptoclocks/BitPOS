import React, { useState } from 'react';

export default function PromotionPreview({ url, blocker, language }: { url: string | null; blocker: string | null; language: 'th' | 'en' }) {
  const [failed, setFailed] = useState(false);
  const unavailable = !url || failed;
  return <figure className="promotion-preview" aria-label="480 by 320 promotion preview">
    {unavailable ? <figcaption role="status">{language === 'th' ? 'ภาพพรีวิวจากรูปสินค้าจริงยังไม่พร้อม ไม่ใช้ภาพ AI หรือรูปสินค้าทดแทน' : 'Actual product preview unavailable. No AI image or substitute product photo.'}{blocker && <small>{language === 'th' ? 'ต้องตรวจรูปสินค้าปัจจุบันและบริการสร้างภาพบนเซิร์ฟเวอร์' : blocker}</small>}</figcaption> : <img src={url} width="480" height="320" alt={language === 'th' ? 'พรีวิวรูปสินค้าจริงและราคาที่เซิร์ฟเวอร์คำนวณ 480 × 320' : 'Actual product photo and server-price preview · 480 × 320'} onError={() => setFailed(true)} />}
  </figure>;
}
