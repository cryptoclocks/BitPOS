import React,{useState} from 'react';
import type {PromotionRecipientsView} from '../../../../packages/contracts/src/personal-promotions';
import MerchantIcon from './MerchantIcon';
import '../styles/customers.css';
export type CustomerSummary=PromotionRecipientsView['customers'][number];
export function customerDisplayName(customer:CustomerSummary,language:'en'|'th'){
 return customer.name|| (customer.walletLabel?`Wallet ${customer.walletLabel}`:language==='th'?'ลูกค้าทั่วไป':'Walk-in customer');
}
export function CustomerAvatar({customer}:{customer:CustomerSummary}){
 if(customer.avatar?.photo)return <img className="customer-avatar" src={customer.avatar.photo} alt=""/>;
 const seed=customer.avatarSeed??customer.id.replaceAll('-','');
 const palettes=[['#ede3ff','#6b3db2'],['#ffe6d1','#ae590c'],['#dff0e9','#34715b'],['#e2e9fc','#4968a9']];
 const [background,foreground]=palettes[(parseInt(seed.slice(0,2),16)||0)%palettes.length];
 const symbols:Record<string,string>={coffee:'☕',cat:'🐱',flower:'🌸',star:'⭐',person:'🙂'};
 const initial=symbols[customer.avatar?.preset??'']||(customer.name&&!customer.name.startsWith('Wallet ')?Array.from(customer.name.trim())[0]?.toUpperCase():'');
 return <svg className="customer-avatar" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="16" fill={background}/>{initial?<text x="24" y="31" textAnchor="middle" fontSize="22" fontWeight="600" fill={foreground}>{initial}</text>:<g fill={foreground}><circle cx="24" cy="18" r="7"/><path d="M11 39c0-9 5-14 13-14s13 5 13 14"/></g>}</svg>;
}
export function CustomerRowContent({customer,language}:{customer:CustomerSummary;language:'en'|'th'}){
 const name=customerDisplayName(customer,language);
 return <><CustomerAvatar customer={customer}/><span className="customer-row-copy"><strong>{name}</strong><small>{customer.walletLabel&&!name.includes(customer.walletLabel)&&<span>{customer.walletLabel}</span>}<span>{customer.paidOrders===undefined?`#${customer.id.slice(0,8)}`:customer.paidOrders?`${customer.paidOrders.toLocaleString(language==='th'?'th-TH':'en-US')} ${language==='th'?'บิลที่ชำระแล้ว':'paid orders'}`:language==='th'?'ยังไม่มีประวัติชำระ':'No paid orders yet'}</span></small></span></>;
}
export default function CustomerPicker({customers,selectedId,onSelect,language,disabled=false}:{customers:CustomerSummary[];selectedId:string;onSelect:(id:string)=>void;language:'en'|'th';disabled?:boolean}){
 const [search,setSearch]=useState('');const t=(th:string,en:string)=>language==='th'?th:en;
 const matches=customers.filter(c=>(c.name+' '+(c.walletLabel??'')+' '+c.id).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
 const selected=customers.find(c=>c.id===selectedId);
 const options=selected&&!matches.some(c=>c.id===selectedId)?[selected,...matches]:matches;
 return <div className="customer-picker customer-picker-compact"><label className="customer-search">{t('ค้นหาลูกค้า','Search customers')}<input type="search" value={search} onChange={e=>setSearch(e.target.value)} disabled={disabled} placeholder={t('ชื่อเล่น หรือ wallet','Nickname or wallet')}/></label><label>{t('เลือกลูกค้า','Choose customer')}<select value={selectedId} disabled={disabled} onChange={e=>onSelect(e.target.value)}><option value="">{t('เลือกลูกค้า','Select customer')}</option>{options.map(c=><option key={c.id} value={c.id}>{customerDisplayName(c,language)}{c.walletLabel&&!c.name.includes(c.walletLabel)?` · ${c.walletLabel}`:''}{c.paidOrders!==undefined?` · ${c.paidOrders} ${t('บิล','orders')}`:''}</option>)}</select></label>{selected&&<div className="customer-selection-summary"><CustomerRowContent customer={selected} language={language}/></div>}{!matches.length&&search&&<small>{t('ไม่พบลูกค้า','No customers found')}</small>}</div>;
}
