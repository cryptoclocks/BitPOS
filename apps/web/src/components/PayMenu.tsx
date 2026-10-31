import {useEffect,useRef,useState} from 'react';
import {api,ApiError,errorMessage} from '../lib/api';
import {displayProduct,watchMenu,type Menu,type MenuWatcher} from '../lib/menu';
import {formatMoney} from '../lib/money';
import MerchantIcon,{LocaleFlag} from './MerchantIcon';
import '../styles/app.css';
import '../styles/customer-checkout.css';
import '../styles/table-menu.css';

/** Anonymous GET-only browsing. The original bill and private guest journal stay
 * untouched; opening a table menu is a separate, explicit navigation. */
export default function PayMenu({accessToken}:{accessToken:string}){
 const [language,setLanguageState]=useState<'en'|'th'>('th'),setLanguage=(next:'en'|'th')=>{setLanguageState(next);try{localStorage.setItem('bitpos.pay.language',next);}catch{/* keep the choice for this visit only */}},[menu,setMenu]=useState<Menu>(),[valid,setValid]=useState(false),[tableUrl,setTableUrl]=useState<string|null>(null),[search,setSearch]=useState('');
 useEffect(()=>{try{if(localStorage.getItem('bitpos.pay.language')==='en')setLanguageState('en');}catch{/* default stays Thai */}},[]);
 const [failure,setFailure]=useState<{kind:'denied'|'unavailable'|'transient';detail:string}>(),[refreshing,setRefreshing]=useState(false);
 const watcher=useRef<MenuWatcher|undefined>(undefined);
 const billUrl=`/pay/${encodeURIComponent(accessToken)}`,th=language==='th',copy=(en:string,thai:string)=>th?thai:en;
 useEffect(()=>{
  let active=true,blockedRead=false;
  setMenu(undefined);setValid(false);setTableUrl(null);setFailure(undefined);setSearch('');
  const watching=watchMenu(async()=>{
   if(active)setRefreshing(true);
   try{
    const result=await api<{menu:Menu;tableUrl:string|null}>(`${billUrl}/menu`);
    if(result.tableUrl!==null&&!/^\/table\/[A-Za-z0-9_-]{43}$/.test(result.tableUrl))throw Error('Menu route unavailable / เส้นทางเมนูไม่พร้อม');
    if(active){blockedRead=false;setTableUrl(result.tableUrl);setFailure(undefined);}
    return result.menu;
   }finally{if(active)setRefreshing(false);}
  },(next,current)=>{if(active&&!blockedRead){setMenu(next);setValid(current);}},e=>{
   if(!active)return;
   const denied=e instanceof ApiError&&(e.status===401||e.status===403),unavailable=e instanceof ApiError&&e.status===404;
   blockedRead=blockedRead||denied||unavailable;setValid(false);
   if(blockedRead){setMenu(undefined);setTableUrl(null);}
   setFailure({kind:denied?'denied':unavailable?'unavailable':'transient',detail:errorMessage(e)});
  });
  watcher.current=watching;return()=>{active=false;watching.stop();watcher.current=undefined;};
 },[billUrl]);
 const term=search.trim().toLowerCase();
 const products=menu?.products.map(product=>displayProduct(product,valid,menu.asOf)).filter(product=>!term||[product.name,product.nameEn,product.description].some(text=>text.toLowerCase().includes(term)))??[];
 return <main className="customer-checkout table-menu" lang={language} aria-busy={refreshing}><div className="checkout-shell">
  <header className="checkout-header"><img src="/images/bitpos-logo.png" alt="BitPOS" width="132" height="44"/><button className="table-language" aria-label={th?'Switch to English':'เปลี่ยนเป็นภาษาไทย'} onClick={()=>setLanguage(th?'en':'th')}><LocaleFlag language={th?'en':'th'}/></button></header>
  <section className="table-heading"><p>{menu?.merchant.name}</p><h1>{copy('Menu','เมนู')}</h1><p>{copy('Browse freely. Your original bill and payment stay unchanged.','ดูเมนูได้ทันที บิลเดิมและสิทธิ์ชำระไม่เปลี่ยนแปลง')}</p><a className="table-text-button" href={billUrl}>{copy('Back to my bill','กลับไปบิลเดิม')}</a>{tableUrl&&<a className="table-text-button" href={tableUrl}>{copy('Open this table’s ordering menu','เปิดเมนูสั่งของโต๊ะนี้')}</a>}</section>
  {failure&&<div className="error" role="alert"><strong>{failure.kind==='denied'?copy('This menu cannot be accessed.','ไม่สามารถเข้าถึงเมนูนี้ได้'):failure.kind==='unavailable'?copy('This menu is unavailable.','เมนูนี้ไม่พร้อมใช้งาน'):copy('Could not refresh the menu. Prices and availability are unconfirmed.','รีเฟรชเมนูไม่สำเร็จ ยังยืนยันราคาและสินค้าคงเหลือไม่ได้')}</strong><p>{copy('Refresh the menu to try again, or return to your original bill.','รีเฟรชเมนูเพื่อลองอีกครั้ง หรือกลับไปบิลเดิม')}</p><details><summary>{copy('Details','รายละเอียด')}</summary>{failure.detail}</details></div>}
  {menu&&!valid&&!failure&&<p className="notice" role="status">{copy('Menu prices and availability need refreshing.','ต้องรีเฟรชราคาและสินค้าคงเหลือของเมนู')}</p>}
  <label className="table-search"><span className="sr-only">{copy('Search menu','ค้นหาเมนู')}</span><input type="search" disabled={!menu} placeholder={copy('Find your favourite…','ค้นหาเมนูที่ชอบ…')} value={search} onChange={event=>setSearch(event.target.value)}/></label>
  {!menu&&!failure&&<p className="table-loading" role="status">{copy('Loading the menu…','กำลังโหลดเมนู…')}</p>}
  {menu&&valid&&!products.length&&<div className="notice pay-menu-empty" role="status"><h2>{term?copy('No matching items','ไม่พบเมนูที่ค้นหา'):copy('No menu items yet','ยังไม่มีรายการเมนู')}</h2><p>{term?copy('Try another search or clear it to see the menu.','ลองค้นหาคำอื่น หรือล้างการค้นหาเพื่อดูเมนู'):copy('Refresh to check for available items. Your original bill is unchanged.','รีเฟรชเพื่อตรวจสอบรายการที่มี บิลเดิมไม่เปลี่ยนแปลง')}</p>{term&&<button type="button" className="secondary" onClick={()=>setSearch('')}>{copy('Clear search','ล้างการค้นหา')}</button>}</div>}
  {menu&&<section className="table-products" aria-label={copy('Cafe menu','เมนูของร้าน')}>{products.map(product=><article className={'table-product'+(valid&&product.available<=0?' is-sold-out':'')} key={product.id}>
   <div className="table-product-image">{product.imageUrl&&<img src={product.imageUrl} alt={th?product.name:product.nameEn} loading="lazy"/>}{product.dailyPromotion&&<span className="table-discount">-{product.dailyPromotion.discountPercent}% · {copy('Daily offer','โปรประจำวัน')}</span>}</div>
   <div className="table-product-content"><h3>{th?product.name:product.nameEn}</h3>{product.description&&<details className="table-product-details"><summary>{copy('Details','รายละเอียด')}</summary><p>{product.description}</p></details>}<div className="table-product-bottom"><div className="table-product-price"><strong>{valid&&product.unitPrice?formatMoney(product.unitPrice):copy('Price unavailable','ราคายังไม่พร้อม')}</strong>{(product.promotion||product.dailyPromotion)&&product.basePrice&&<del>{formatMoney(product.basePrice)}</del>}{valid&&product.available<=0&&<span>{copy('Sold out','หมดแล้ว')}</span>}</div></div></div>
  </article>)}</section>}
  <footer className="table-footer"><button className="table-text-button" disabled={refreshing} onClick={()=>void watcher.current?.refresh()}><MerchantIcon name="refresh"/>{copy('Refresh menu','รีเฟรชเมนู')}</button></footer>
 </div></main>;
}
