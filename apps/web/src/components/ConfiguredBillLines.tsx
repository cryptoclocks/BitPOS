import React from 'react';
import type {MobileConfiguredFoodSnapshot} from '../../../../packages/contracts/src/mobile-v1.generated';
import {formatMoney} from '../lib/money';
export default function ConfiguredBillLines({snapshot,language,className='bill'}:{snapshot:MobileConfiguredFoodSnapshot;language:'th'|'en';className?:string}){
 const th=language==='th';
 const name=(thai:string,english:string)=>{const preferred=th?thai:english;return preferred.trim()?preferred:(th?english:thai);};
 return <ul className={`${className} configured-bill-lines`}>{snapshot.lines.map(line=><li key={line.lineId}><div className="configured-bill-content"><div><strong><span className="bill-inline-quantity">{line.qty} × </span>{name(line.name,line.nameEn)}</strong><span> · {formatMoney(line.unitPrice)} {th?'ต่อชิ้น':'each'}</span></div>{line.selections.length>0&&<ul>{line.selections.map(choice=><li key={`${choice.groupId}:${choice.choiceId}`}>{name(choice.groupName,choice.groupNameEn)} · {name(choice.choiceName,choice.choiceNameEn)} × {choice.qty} (+{formatMoney(choice.priceDelta)} {th?'ต่อหน่วยตัวเลือก':'per choice unit'})</li>)}</ul>}{line.allergyNote!==null&&<p className="configured-allergy-note"><strong>{th?'หมายเหตุอาหารแพ้ / คำแนะนำ':'Allergy notes / instructions'}:</strong> {line.allergyNote}</p>}</div><><span className="bill-column-quantity" hidden>{line.qty}</span><strong>{formatMoney(line.lineTotal)}</strong></></li>)}</ul>;
}
export function ConfiguredBillBreakdown({snapshot,language}:{snapshot:MobileConfiguredFoodSnapshot;language:'th'|'en'}){
 const labels=language==='th'?['ยอดก่อนลด','ส่วนลดสินค้า','ค่าบริการ','ภาษีเพิ่มเติม']:['Subtotal','Product discount','Fees','Additional tax'];
 return <dl className="configured-bill-breakdown">{[snapshot.subtotal,snapshot.discount,snapshot.fees,snapshot.tax].map((value,index)=><React.Fragment key={index}><dt>{labels[index]}</dt><dd>{formatMoney(value)}</dd></React.Fragment>)}</dl>;
}
