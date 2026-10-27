import {customerCrm,customerAvatar} from '../../../../packages/contracts/src/customer-profile';
import {customerPhoto} from '../lib/customer-photo';
import React,{useEffect,useRef,useState} from 'react';
import {api,ApiError,errorMessage} from '../lib/api';
import type {PrivateOrder,Session} from '../lib/table';
import type {Customer} from './CustomerCard';
import {personalRecipientsView,type PromotionRecipientsView} from '../../../../packages/contracts/src/personal-promotions';
import {CustomerAvatar,customerDisplayName,type CustomerSummary} from './CustomerPicker';
import MerchantIcon from './MerchantIcon';
import OrderBill from './OrderBill';
const blank={name:'',phone:'',email:'',notes:'',crm:customerCrm.parse({}),avatar:customerAvatar.parse({})};
export default function Customers(props:{session:Session;language:'en'|'th'}){
 return <CustomerWorkspace key={`${props.session.merchantId}:${props.session.userId}`} {...props}/>;
}
function CustomerWorkspace({session,language}:{session:Session;language:'en'|'th'}){
 const t=(th:string,en:string)=>language==='th'?th:en;
 const [customers,setCustomers]=useState<Customer[]>([]);
 const [summaries,setSummaries]=useState<PromotionRecipientsView['customers']>([]);
 const [search,setSearch]=useState('');
 const [includeGuests,setIncludeGuests]=useState(false);
 const [limit,setLimit]=useState(30);
 const [selectedId,setSelectedId]=useState<string>();
 const [creating,setCreating]=useState(false);
 const [draft,setDraft]=useState(blank);
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [loaded,setLoaded]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const alive=useRef(true);
 const working=useRef(false);
 const refreshEpoch=useRef(0);
 const token=useRef(session.token);token.current=session.token;
 const retirement=useRef(0);
 const [denied,setDenied]=useState(false);
 const outcomeKey=`bitpos.customer-create-unresolved:${session.merchantId}:${session.userId}`;
 const [unknownCreate,setUnknownCreate]=useState(()=>{try{return sessionStorage.getItem(outcomeKey)!==null;}catch{return true;}});
 function retire(){
  ++retirement.current;++refreshEpoch.current;setLoading(false);setDenied(true);setCustomers([]);setSummaries([]);setSelectedId(undefined);setCreating(false);setDraft(blank);setSearch('');setMessage('');setLoaded(false);
 }
 const editor=useRef<HTMLElement>(null);
 const nameInput=useRef<HTMLInputElement>(null);
 async function refresh(){
  if(!alive.current)return false;
  const epoch=++refreshEpoch.current;
  const credential=token.current;
  setLoading(true);
  setError('');
  try{
   const [all,view]=await Promise.all([api<{customers:Customer[]}>('/customers',undefined,credential),api<unknown>('/promotions/recipients',undefined,credential)]);
   const parsed=personalRecipientsView.parse(view);
   if(alive.current&&credential===token.current&&epoch===refreshEpoch.current){setCustomers(all.customers);setSummaries(parsed.customers);setLoaded(true);setDenied(false);return true;}
  }catch(error){
   if(alive.current&&credential===token.current&&epoch===refreshEpoch.current){
    if(error instanceof ApiError&&(error.status===401||error.status===403))retire();
    setError(errorMessage(error));
   }
  }finally{
   if(alive.current&&epoch===refreshEpoch.current)setLoading(false);
  }
  return false;
 }
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;++refreshEpoch.current;};},[]);
 useEffect(()=>{void refresh();},[session.token]);
 useEffect(()=>setLimit(30),[search,includeGuests]);
 const summaryMap=new Map(summaries.map(summary=>[summary.id,summary]));
 const rows:CustomerSummary[]=customers
  .filter(customer=>includeGuests||summaryMap.has(customer.id))
  .map(customer=>({... (summaryMap.get(customer.id)??{id:customer.id,name:customer.name??'',walletLabel:customer.wallets[0]?customer.wallets[0].address.slice(0,4)+'…'+customer.wallets[0].address.slice(-4):null}),avatar:customer.avatar}));
 rows.sort((left,right)=>(right.paidOrders??0)-(left.paidOrders??0)||left.name.localeCompare(right.name));
 const matches=rows.filter(customer=>{
  const contact=customers.find(row=>row.id===customer.id);
  return [customer.name,customer.walletLabel,contact?.phone,contact?.email,...(contact?.wallets.map(wallet=>wallet.address)??[])].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
 });
 const selected=customers.find(customer=>customer.id===selectedId);
 const summary=summaryMap.get(selectedId??'')??{id:selectedId??'00000000',name:draft.name};
 function open(customer?:Customer){
  if(denied||(!customer&&unknownCreate))return;
  setSelectedId(customer?.id);
  setCreating(!customer);
  setDraft(customer?{name:customer.name??'',phone:customer.phone??'',email:customer.email??'',notes:customer.notes??'',crm:customerCrm.parse(customer.crm??{}),avatar:customerAvatar.parse(customer.avatar??{})}:blank);
  setError('');
  setMessage('');
  setTimeout(()=>{editor.current?.scrollIntoView({behavior:'smooth',block:'nearest'});nameInput.current?.focus({preventScroll:true});},0);
 }
 async function save(){
  if(working.current||denied||(creating&&unknownCreate))return;
  working.current=true;
  setBusy(true);
  setError('');
  setMessage('');
  const credential=token.current,generation=retirement.current;
  let attempted=false;
  const createIntent=crypto.randomUUID();
  try{
   const name=draft.name.trim();
   if(!name)throw Error(t('ใส่ชื่อเล่นก่อนบันทึก','Enter a nickname before saving.'));
   if(creating){
    try{sessionStorage.setItem(outcomeKey,createIntent);if(sessionStorage.getItem(outcomeKey)!==createIntent)throw Error();}
    catch{throw Error(t('ไม่สามารถบันทึกสถานะคำขอได้ ยังไม่ได้ส่งข้อมูล กรุณาเปิดใช้พื้นที่จัดเก็บของเบราว์เซอร์','Cannot persist request status. Nothing was submitted. Enable browser session storage.'));}
   }
   attempted=true;
   const saved=await api<Customer>(creating?'/customers':`/customers/${encodeURIComponent(selectedId!)}`,{...draft,name},credential,creating?'POST':'PATCH');
   if(creating){try{if(sessionStorage.getItem(outcomeKey)===createIntent)sessionStorage.removeItem(outcomeKey);}catch{/* Keep the conservative unresolved fence if storage becomes unavailable. */}}
   if(!alive.current||generation!==retirement.current)return;
   setCustomers(rows=>[saved,...rows.filter(row=>row.id!==saved.id)]);
   setSelectedId(saved.id);setCreating(false);setDraft({...draft,name});setMessage(t('บันทึกแล้ว','Saved'));
   await refresh();
  }catch(error){
   if(creating&&attempted&&error instanceof ApiError&&error.definiteRefusal){try{if(sessionStorage.getItem(outcomeKey)===createIntent)sessionStorage.removeItem(outcomeKey);}catch{/* Retain unresolved intent when bookkeeping cannot be confirmed. */}}
   if(alive.current&&generation===retirement.current){
    if(error instanceof ApiError&&(error.status===401||error.status===403)){
     if(credential!==token.current)return;
     retire();
    }else if(creating&&attempted&&(!(error instanceof ApiError)||error.status>=500)){
     setUnknownCreate(true);
    }
    setError(errorMessage(error));
   }
  }finally{
   working.current=false;
   if(alive.current)setBusy(false);
  }
 }
 return <main className="customers-workspace" data-editing={!!selected||creating} aria-label={t('จัดการลูกค้า','Manage customers')} onChangeCapture={()=>setMessage('')} onClickCapture={event=>{if((event.target as Element).closest('.customer-avatar-details'))setMessage('');}}>
  <div className="customers-heading"><div><p className="eyebrow">{t('จัดการร้าน','YOUR SHOP')}</p><h1>{selected||creating?t('โปรไฟล์ลูกค้า','Customer profile'):t('ลูกค้า','Customers')}</h1><p>{t('จัดการร้านของคุณในที่เดียว','Manage your shop in one place')}</p></div><div className="toolbar"><button className="secondary" disabled={busy||loading} onClick={()=>void refresh()}><MerchantIcon name="refresh"/>{t('รีเฟรช','Refresh')}</button></div></div>
  {error&&<section className="customer-error" role="alert"><p>{error}</p><button className="secondary" type="button" disabled={loading||busy} onClick={()=>void refresh()}><MerchantIcon name="refresh"/>{t('ลองอีกครั้ง','Retry')}</button></section>}
  {unknownCreate&&<section className="customer-error" role="status"><p>{t('ยังไม่ทราบผลการเพิ่มลูกค้า ห้ามส่งซ้ำ ตรวจรายชื่อก่อนเริ่มรายการใหม่','Customer creation outcome is unknown. Do not submit again. Check the directory before starting a distinct new profile.')}</p><button type="button" disabled={busy||loading||denied||!loaded} onClick={()=>{if(!window.confirm(t('คุณตรวจรายชื่อแล้วและต้องการเริ่มโปรไฟล์ใหม่ ไม่ใช่ส่งรายการเดิมซ้ำใช่หรือไม่','Have you checked the directory and intend to start a distinct new profile, not retry the previous creation?')))return;try{sessionStorage.removeItem(outcomeKey);}catch{return;}setUnknownCreate(false);setCreating(false);setSelectedId(undefined);setDraft(blank);setMessage('');}}>{t('ตรวจรายชื่อแล้ว เริ่มรายการใหม่','Directory checked — start distinct profile')}</button></section>}
  <div className="customers-columns"><section className="customers-list-panel" aria-label={t('รายชื่อลูกค้า','Customer list')} aria-busy={loading}>
   <div className="customer-directory-search-row"><label className="customer-search">{t('ค้นหาลูกค้า','Search customers')}<input type="search" value={search} disabled={busy} onChange={event=>setSearch(event.target.value)} placeholder={t('ชื่อเล่น wallet หรือเบอร์โทร','Nickname, wallet or phone')}/></label>{!selected&&!creating&&<button disabled={busy||loading||denied||unknownCreate} onClick={()=>open()}><MerchantIcon name="plus"/>{t('เพิ่มลูกค้า','Add customer')}</button>}</div>
   <div className="customer-directory-actions"><button className="secondary" aria-pressed={includeGuests} disabled={busy} onClick={()=>setIncludeGuests(value=>!value)}>{includeGuests?t('ซ่อนลูกค้าทั่วไป','Hide walk-in customers'):t('แสดงลูกค้าทั่วไป','Show walk-in customers')}</button>{search&&<button className="secondary" type="button" disabled={busy} onClick={()=>setSearch('')}>{t('ล้างการค้นหา','Clear search')}</button>}</div>
   <div className="customer-directory-head" aria-hidden="true"><span>{t('รายการ','Customer')}</span><span>{t('รายละเอียด','Details')}</span><span>{t('สถานะ','Status')}</span></div>
   <div className="customers-directory-list">{loading?<p className="customer-empty" role="status">{t('กำลังโหลดลูกค้า…','Loading customers…')}</p>:matches.slice(0,limit).map(customer=><button key={customer.id} className="customer-profile-row" aria-pressed={!creating&&selectedId===customer.id} disabled={busy} onClick={()=>open(customers.find(row=>row.id===customer.id))}><span className="customer-directory-name"><CustomerAvatar customer={customer}/><strong>{customerDisplayName(customer,language)}</strong></span><span className="customer-directory-description">{customers.find(row=>row.id===customer.id)?.crm?.tags||customer.walletLabel||t('โปรไฟล์เฉพาะร้าน','Shop customer profile')}</span><span className="customer-directory-status">{customer.paidOrders===undefined?t('ไม่มีข้อมูลบิลที่ชำระ','Paid-order summary unavailable'):`${customer.paidOrders.toLocaleString(language==='th'?'th-TH':'en-US')} ${t('บิลที่ชำระแล้ว','paid orders')}`}<MerchantIcon name="edit"/></span></button>)}{loaded&&!loading&&!matches.length&&<p className="customer-empty">{t('ไม่พบลูกค้า','No customers found')}</p>}</div>
   <div className="customer-directory-footer">{matches.length>limit&&<button className="secondary" disabled={busy} onClick={()=>setLimit(value=>value+30)}>{t('ดูเพิ่มเติม','Show more')}</button>}</div>
  </section>
  {(selected||creating)?<section ref={editor} className="customer-profile-editor" aria-label={t('แก้ไขโปรไฟล์','Edit profile')}><div className="customer-profile-heading"><CustomerAvatar customer={{...summary,name:draft.name,avatar:draft.avatar}}/><div><h2>{creating?t('ลูกค้าใหม่','New customer'):customerDisplayName(summary,language)}</h2>{summary.walletLabel&&<small>{summary.walletLabel}</small>}</div></div><form onSubmit={event=>{event.preventDefault();void save();}}><label>{t('ชื่อเล่น','Nickname')}<input ref={nameInput} value={draft.name} maxLength={120} required disabled={busy} onChange={event=>setDraft(value=>({...value,name:event.target.value}))}/></label><section className="customer-contact-details"><h3>{t('ข้อมูลติดต่อ','Contact details')}</h3><div className="customer-contact-fields"><label>{t('เบอร์โทร','Phone')}<input type="tel" value={draft.phone} maxLength={40} disabled={busy} onChange={event=>setDraft(value=>({...value,phone:event.target.value}))}/></label><label>{t('บันทึกสำหรับร้าน','Shop notes')}<textarea value={draft.notes} maxLength={2000} disabled={busy} onChange={event=>setDraft(value=>({...value,notes:event.target.value}))}/></label></div></section><label>{t('ภาษาที่ต้องการ','Preferred language')}<select disabled={busy} value={draft.crm.preferredLanguage} onChange={event=>setDraft(value=>({...value,crm:{...value.crm,preferredLanguage:event.target.value as ''|'th'|'en'}}))}><option value="">{t('ไม่ระบุ','Not specified')}</option><option value="th">ไทย</option><option value="en">English</option></select></label><div className="customer-profile-actions"><button disabled={busy||loading}><MerchantIcon name="save"/>{t('บันทึก','Save')}</button><button className="secondary" type="button" disabled={busy} onClick={()=>{setSelectedId(undefined);setCreating(false);setMessage('');}}>{t('ปิด','Close')}</button></div><details><summary>{t('ช่องทางติดต่อเพิ่มเติม','Additional contact')}</summary><div className="customer-contact-fields"><label>{t('อีเมล','Email')}<input type="email" value={draft.email} maxLength={254} disabled={busy} onChange={event=>setDraft(value=>({...value,email:event.target.value}))}/></label></div></details>{[{title:t('ข้อมูลส่วนตัว','Personal details'),fields:[['fullName',t('ชื่อ–นามสกุล','Full name')],['birthday',t('วันเกิด','Birthday')],['lineId','LINE ID'],['company',t('บริษัท / อาชีพ','Company / occupation')],['address',t('ที่อยู่','Address')]]},{title:t('ความชอบและ CRM','Preferences & CRM'),fields:[['preferredDrink',t('เมนูโปรด','Favourite drink')],['sweetness',t('ระดับความหวาน','Sweetness')],['milk',t('นมที่เลือก','Milk preference')],['allergies',t('อาหารที่แพ้ / ข้อควรระวัง','Allergies / dietary notes')],['tags',t('แท็ก เช่น ลูกค้าประจำ, VIP','Tags, e.g. regular, VIP')]]}].map(group=><details key={group.title}><summary>{group.title}</summary><div className="customer-contact-fields">{group.fields.map(([field,label])=><label key={field}>{label}<input type={field==='birthday'?'date':'text'} maxLength={field==='address'||field==='allergies'?1000:200} disabled={busy} value={draft.crm[field as keyof typeof draft.crm]} onChange={event=>setDraft(value=>({...value,crm:{...value.crm,[field]:event.target.value}}))}/></label>)}</div></details>)}<details className="customer-avatar-details"><summary>{t('รูปโปรไฟล์','Profile picture')}</summary><fieldset className="customer-avatar-picker"><legend>{t('รูปโปรไฟล์','Profile picture')}</legend><div className="customer-avatar-options">{(['auto','coffee','cat','flower','star','person'] as const).map((preset,index)=><button key={preset} type="button" className="secondary" disabled={busy} aria-pressed={draft.avatar.preset===preset&&!draft.avatar.photo} aria-label={t(['อัตโนมัติ','กาแฟ','แมว','ดอกไม้','ดาว','ใบหน้า'][index],['Automatic','Coffee','Cat','Flower','Star','Face'][index])} onClick={()=>setDraft(value=>({...value,avatar:{preset,photo:''}}))}><CustomerAvatar customer={{...summary,avatar:{preset,photo:''}}}/></button>)}</div><label className="customer-photo-upload">{t('อัปโหลดรูป','Upload photo')}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;const photoGeneration=retirement.current;setBusy(true);void customerPhoto(file).then(photo=>{if(alive.current&&photoGeneration===retirement.current)setDraft(value=>({...value,avatar:{...value.avatar,photo}}));}).catch(()=>{if(alive.current&&photoGeneration===retirement.current)setError(t('ใช้รูป JPG, PNG หรือ WebP ขนาดไม่เกิน 10 MB','Use JPG, PNG or WebP up to 10 MB.'));}).finally(()=>{if(alive.current)setBusy(false);});}}/></label>{draft.avatar.photo&&<button type="button" className="secondary" disabled={busy} onClick={()=>setDraft(value=>({...value,avatar:{preset:'auto',photo:''}}))}>{t('ลบรูป','Remove photo')}</button>}</fieldset></details>{message&&<p className="customer-profile-message" role="status">{message}</p>}</form></section>:<section className="customer-profile-editor customer-profile-placeholder"><p className="customer-empty">{t('เลือกลูกค้าเพื่อแก้ไขชื่อเล่นและข้อมูลติดต่อ','Choose a customer to edit their nickname and contact details.')}</p></section>}
  {(selected||creating)&&<aside className="customer-profile-preview" aria-label={t('พรีวิวและรายละเอียด','Preview and details')}><h2>{t('พรีวิวและรายละเอียด','Preview and details')}</h2><section className="customer-draft-status"><small>{t('สถานะการแก้ไข','Editing status')}</small><strong>{busy?t('กำลังบันทึก','Saving'):message?t('บันทึกแล้ว','Saved'):t('ตรวจข้อมูลก่อนบันทึก','Review before saving')}</strong><p>{t('การแก้ไขยังไม่บันทึกจนกดบันทึกและเซิร์ฟเวอร์ยืนยัน','Edits are not saved until Save is confirmed by the server.')}</p></section><p>{t('ข้อมูลโปรไฟล์นี้เป็นของร้านที่เข้าสู่ระบบ ไม่ได้ยืนยันการชำระเงินหรือผูกกระเป๋าเงิน','This profile belongs to the signed-in shop. Editing does not confirm payment or bind a wallet.')}</p></aside>}
  {selected&&!denied&&<CustomerHistory key={`${selected.id}:${session.token}`} customerId={selected.id} token={session.token} language={language} onDenied={retire}/>}
  </div>
 </main>;
}

function CustomerHistory({customerId,token,language,onDenied}:{customerId:string;token:string;language:'en'|'th';onDenied():void}){
 const t=(th:string,en:string)=>language==='th'?th:en;
 const [orders,setOrders]=useState<PrivateOrder[]>([]);
 const [state,setState]=useState<'idle'|'loading'|'ready'|'error'>('idle');
 const [error,setError]=useState('');
 const alive=useRef(true),working=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function load(){
  if(working.current)return;
  working.current=true;setState('loading');setError('');
  try{
   const result=await api<{orders:PrivateOrder[]}>(`/customers/${encodeURIComponent(customerId)}/history`,undefined,token);
   if(alive.current){setOrders(result.orders);setState('ready');}
  }catch(error){
   if(alive.current){
    setOrders([]);
    if(error instanceof ApiError&&(error.status===401||error.status===403)){onDenied();return;}
    setError(errorMessage(error));setState('error');
   }
  }finally{working.current=false;}
 }
 return <section className="customer-history" aria-label={t('ประวัติคำสั่งซื้อ','Order history')} aria-busy={state==='loading'}>
  <h2>{t('ประวัติคำสั่งซื้อ','Order history')}</h2>
  <p>{t('รายการจากร้านนี้เท่านั้น สถานะและยอดอ้างอิงจากบิลที่บันทึกแล้ว','Orders from this shop only. Status and amounts come from saved bills.')}</p>
  <button type="button" className="secondary" disabled={state==='loading'} onClick={()=>void load()}>{state==='loading'?t('กำลังโหลด…','Loading…'):state==='error'?t('ลองอีกครั้ง','Retry'):t('โหลดประวัติ','Load history')}</button>
  {error&&<p role="alert">{error}</p>}
  {state==='ready'&&orders.length===0&&<p role="status">{t('ยังไม่มีคำสั่งซื้อ','No orders yet')}</p>}
  {orders.map(order=><details key={order.id}><summary>{order.id.slice(0,8)} · {t('ดูบิลที่บันทึกแล้ว','View saved bill')}</summary><OrderBill order={order} language={language}/></details>)}
 </section>;
}
