import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';

interface Story { story: string; storyEn: string; ingredients: string; ingredientsEn: string; benefits: string; benefitsEn: string; videoUrl: string }

// The customer app's product page: a 5-second loop video (shipped with the site, no text in it) plus the shop's own
// story, ingredients and benefits as text. Owner/manager only; the API enforces the role again.
export function ProductStoryForm({ productId, token, language }: { productId: string; token: string; language: 'th' | 'en' }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const [saved, setSaved] = useState<Story | null>(null); const [draft, setDraft] = useState<Story | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => {
    let live = true;
    api<Story>(`/products/${encodeURIComponent(productId)}/story`, undefined, token).then(value => { if (live) { setSaved(value); setDraft(value); } }).catch(error => { if (live) setMessage(errorMessage(error)); });
    return () => { live = false; };
  }, [productId, token]);
  if (!draft || !saved) return <section className="panel" aria-label={text('เรื่องราวและวีดีโอ', 'Story and video')}><h2>{text('เรื่องราวและวีดีโอ', 'Story and video')}</h2>{message ? <p className="error" role="alert">{message}</p> : <p className="notice" role="status">{text('กำลังโหลด…', 'Loading…')}</p>}</section>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const area = (field: Exclude<keyof Story, 'videoUrl'>, th: string, en: string, max: number) => <label key={field}>{text(th, en)}<textarea value={draft[field]} maxLength={max} rows={field.startsWith('story') ? 4 : 2} onChange={event => setDraft({ ...draft, [field]: event.target.value })} /><small className="catalog-sub">{draft[field].length}/{max}</small></label>;
  async function save() {
    if (!draft) return;
    setBusy(true); setMessage('');
    try { const next = await api<Story>(`/products/${encodeURIComponent(productId)}/story`, draft, token, 'PUT'); setSaved(next); setDraft(next); setMessage(text('บันทึกเรื่องราวแล้ว ลูกค้าเห็นในแอปทันที', 'Story saved. Customers see it in the app now.')); }
    catch (error) { setMessage(errorMessage(error)); }
    setBusy(false);
  }
  return <form className="panel" onSubmit={event => { event.preventDefault(); void save(); }} aria-label={text('เรื่องราวและวีดีโอ', 'Story and video')}>
    <h2>{text('เรื่องราวและวีดีโอ', 'Story and video')}</h2>
    <p className="catalog-sub">{text('แสดงในหน้ารายละเอียดสินค้าในแอปลูกค้า เขียนเฉพาะสิ่งที่เป็นจริงของร้าน ไม่ใส่ราคาหรือสิทธิ์ที่ระบบไม่ได้ให้', 'Shown on the product page in the customer app. Write only what is true for your shop; do not state prices or rewards here.')}</p>
    {draft.videoUrl ? <video src={draft.videoUrl} muted loop autoPlay playsInline width={160} height={160} style={{ borderRadius: 12, objectFit: 'cover' }} aria-label={text('วีดีโอสินค้า 5 วินาที', '5-second product loop')} /> : <p className="catalog-sub">{text('ยังไม่มีวีดีโอ', 'No video yet.')}</p>}
    <label>{text('ไฟล์วีดีโอ (ในเว็บ เช่น /videos/menu/latte.mp4)', 'Video file (on the site, e.g. /videos/menu/latte.mp4)')}<input value={draft.videoUrl} maxLength={200} pattern="(/videos/menu/[a-z0-9-]{1,40}\.mp4)?" onChange={event => setDraft({ ...draft, videoUrl: event.target.value.trim() })} /></label>
    {area('story', 'เรื่องราว (ไทย)', 'Story (Thai)', 600)}
    {area('storyEn', 'เรื่องราว (อังกฤษ)', 'Story (English)', 600)}
    {area('ingredients', 'ส่วนประกอบ (ไทย)', 'Ingredients (Thai)', 300)}
    {area('ingredientsEn', 'ส่วนประกอบ (อังกฤษ)', 'Ingredients (English)', 300)}
    {area('benefits', 'ข้อดี/ประโยชน์ (ไทย)', 'Benefits (Thai)', 300)}
    {area('benefitsEn', 'ข้อดี/ประโยชน์ (อังกฤษ)', 'Benefits (English)', 300)}
    {message && <p className="notice" role="status">{message}</p>}
    <div className="toolbar"><button disabled={!dirty || busy}>{busy ? text('กำลังบันทึก…', 'Saving…') : text('บันทึกเรื่องราว', 'Save story')}</button></div>
  </form>;
}
