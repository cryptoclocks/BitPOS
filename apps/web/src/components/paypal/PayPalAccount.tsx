// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Settings → payment destination for a PayPal shop: shows where PayPal payments go (read-only, masked). Shops without
// PayPal keep the existing Solana wallet form, passed in as `fallback`.
import React, {useEffect, useState} from 'react';
import {api, errorMessage} from '../../lib/api';
import type {Session} from '../../lib/table';

interface Account {paypalShop:boolean;environment:string;payee:string|null;ready:boolean;webhook:boolean;updatedAt:string|null}

export default function PayPalAccount({session,language,fallback}:{session:Session;language:'th'|'en';fallback:React.ReactNode}){
 const t=(th:string,en:string)=>language==='th'?th:en;
 const [account,setAccount]=useState<Account|null>();const [error,setError]=useState('');
 useEffect(()=>{let live=true;api<Account>('/paypal/account',undefined,session.token).then(a=>{if(live)setAccount(a);}).catch(e=>{if(live){setAccount(null);setError(errorMessage(e));}});return ()=>{live=false;};},[session.token]);
 if(account===undefined)return <section className="panel"><p role="status">{t('กำลังโหลด…','Loading…')}</p></section>;
 if(!account?.paypalShop)return <>{error&&<p className="error" role="alert">{error}</p>}{fallback}</>;
 return <section className="panel"><h2>{t('บัญชีรับเงิน','Where payments go')}</h2>
  <p>{t('ร้านนี้รับเงินด้วย PayPal เงินเข้าบัญชีธุรกิจ PayPal ของร้านโดยตรง ไม่ผ่านกระเป๋าคริปโต','This shop is paid with PayPal. Money goes straight to the shop’s PayPal business account, not to a crypto wallet.')}</p>
  <dl className="pp-envelope">
   <dt>{t('ระบบ','Environment')}</dt><dd>{account.environment} · {t('เงินทดสอบ','test money')}</dd>
   <dt>{t('บัญชีผู้รับเงิน','Payee account')}</dt><dd>PayPal Business {account.payee}</dd>
   <dt>{t('สถานะ','Status')}</dt><dd>{account.ready?t('พร้อมรับเงิน','Ready to take payments'):t('ยังไม่พร้อม แจ้งผู้ดูแลระบบ','Not ready — contact the operator')}</dd>
   <dt>{t('การแจ้งเตือนจาก PayPal','PayPal notifications')}</dt><dd>{account.webhook?t('เปิดใช้ (webhook ตรวจลายเซ็น)','On (signed webhook)'):t('ปิด','Off')}</dd>
  </dl>
  <p className="pp-caption">{t('บัญชีผู้รับเงินตั้งโดยผู้ดูแลระบบฝั่งเซิร์ฟเวอร์ เปลี่ยนจากหน้านี้ไม่ได้ เพื่อไม่ให้ใครแก้ปลายทางเงินจากเบราว์เซอร์','The payee is set by the operator on the server and cannot be changed here, so nobody can redirect payments from a browser.')}</p>
 </section>;
}
