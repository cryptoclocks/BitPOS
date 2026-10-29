import test from 'node:test';import assert from 'node:assert/strict';
import React from 'react';import{renderToStaticMarkup}from'react-dom/server';
import OrderBill from '../apps/web/src/components/OrderBill';
import type{OrderView}from'../packages/contracts/src/index';
import{MobileConfiguredFoodSnapshotSchema}from'../packages/contracts/src/mobile-v1.generated';
const id='10000000-0000-4000-8000-000000000001';
const money=(amountMinor:string)=>({currency:'USD' as const,decimals:2 as const,amountMinor});
const price=money('270');
const snapshot=MobileConfiguredFoodSnapshotSchema.parse({lines:[{lineId:id,productId:id,name:'อาหารทดสอบ',nameEn:'',qty:1,priceVersion:id,optionVersion:null,selections:[],allergyNote:'No nuts <private>',productBasePrice:price,productUnitPrice:price,optionsUnitPrice:money('0'),basePrice:price,unitPrice:price,lineTotal:price}],subtotal:price,discount:money('20'),fees:money('35'),tax:money('5'),total:money('290')});
// Deliberately customer-summary-only fixture. No payment/authority interaction.
const order={configuredFood:snapshot} as OrderView;
for(const language of ['en','th'] as const)test('customer bill exposes frozen breakdown and safe snapshot text: '+language,()=>{
 const html=renderToStaticMarkup(React.createElement(OrderBill,{order,language,customer:true}));
 assert.match(html,/อาหารทดสอบ/);assert.match(html,/No nuts &lt;private&gt;/);
 for(const amount of ['0.20','0.35','0.05'])assert.ok(html.includes(amount),amount);
 for(const label of language==='th'?['ยอดก่อนลด','ส่วนลดสินค้า','ค่าบริการ','ภาษีเพิ่มเติม']:['Subtotal','Product discount','Fees','Additional tax'])assert.ok(html.includes(label),label);
 assert.ok(!html.includes('2.90'),'parent checkout renders total separately; summary must not duplicate or recompute it');
});
