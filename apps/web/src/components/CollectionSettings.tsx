import React,{useEffect,useState} from 'react';
import {api,errorMessage} from '../lib/api';
import type {Session} from '../lib/table';
export default function CollectionSettings({session}:{session:Session}){
 const [policy,setPolicy]=useState<{counterEnabled:boolean;version:number}>(),[choice,setChoice]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;void api<{counterEnabled:boolean;version:number}>('/settings/collection',undefined,session.token).then(value=>{if(active){setPolicy(value);setChoice(value.counterEnabled);}}).catch(e=>{if(active)setError(errorMessage(e));});return()=>{active=false;};},[session.token]);
 async function save(){if(!policy||busy)return;setBusy(true);setError('');try{const value=await api<{counterEnabled:boolean;version:number}>('/settings/collection',{counterEnabled:choice,expectedVersion:policy.version},session.token,'PUT');setPolicy(value);setChoice(value.counterEnabled);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 return <section aria-label="Customer collection policy"><h3>จุดรับสินค้า / Collection options</h3><p>ตัวเลือกนี้ไม่ย้ายโต๊ะหรือจอแจ้งเตือนของออเดอร์ และไม่แก้บิลเดิม / This never retargets the table or ready-notification display and never changes existing bills.</p><label><input type="checkbox" checked={choice} disabled={!policy||busy} onChange={e=>setChoice(e.target.checked)}/> อนุญาตลูกค้าเลือกไปรับหน้าเคาน์เตอร์ / Allow counter collection</label><button disabled={!policy||busy||policy.counterEnabled===choice} onClick={()=>void save()}>บันทึกนโยบาย / Save policy</button>{error&&<p className="error" role="alert">{error}</p>}</section>;
}
