import assert from 'node:assert/strict';
import test from 'node:test';
import {escapeHtml,receiptDoc,stickerDocs,zReportDoc} from '../apps/web/src/lib/print-slip';
import {queuePhrase} from '../apps/web/src/lib/voice-call';

const money=(m:string)=>({currency:'THB',decimals:2,amountMinor:m});
const line=(name:string,qty:number,unit:string)=>({productId:'p',name,nameEn:name+' EN',qty,priceVersion:'v',basePrice:money(unit),unitPrice:money(unit),promotion:null});
const order=(over:Record<string,unknown>={})=>({id:'abcdef12-0000-0000-0000-000000000000',status:'PAID',authority:{serving:{label:'โต๊ะ B1'}},
 pricing:{kind:'versioned',priceVersion:'v',lines:[line('ลาเต้',2,'5500'),line('<b>ชา</b>',1,'4500')],total:money('15500')},settlement:money('15500'),...over}) as never;

test('escapeHtml neutralises markup in names',()=>{
 assert.equal(escapeHtml(`<b a="1">&'`),'&lt;b a=&quot;1&quot;&gt;&amp;&#39;');
 assert.ok(!receiptDoc(order(),'th').includes('<b>ชา</b>'));
});
test('receipt shows lines, total and paid state from integer minor units',()=>{
 const th=receiptDoc(order(),'th'),en=receiptDoc(order(),'en');
 assert.ok(th.includes('2× ลาเต้')&&th.includes('THB 110.00')&&th.includes('THB 155.00')&&th.includes('ชำระแล้ว')&&th.includes('#ABCDEF12'));
 assert.ok(en.includes('Short receipt')&&en.includes('ลาเต้ EN'));
 assert.ok(receiptDoc(order({status:'AWAITING_WALLET'}),'en').includes('Not paid'));
});
test('one cup label per unit ordered, numbered of the total',()=>{
 const html=stickerDocs(order(),'th');
 assert.equal((html.match(/class="sticker"/g)??[]).length,3);
 assert.ok(html.includes('1/3')&&html.includes('3/3')&&html.includes('#ABCD'));
 assert.ok(stickerDocs(order({pricing:{kind:'versioned',priceVersion:'v',lines:[],total:money('0')}}),'en').includes('No items'));
});
test('Z-report keeps currencies apart and prints the counted cash',()=>{
 const html=zReportDoc({periodStart:'2026-11-01T02:00:00Z',periodEnd:'2026-11-01T11:00:00Z',closedBy:'owner',note:'<script>',countedCash:{minor:'120000',currency:'THB',decimals:2},
  groups:[{currency:'THB',decimals:2,orders:3,totalMinor:'30000'},{currency:'THB',decimals:2,orders:2,totalMinor:'20000'},{currency:'USD',decimals:2,orders:1,totalMinor:'500'}]},'en');
 assert.ok(html.includes('5 orders')&&html.includes('THB 500.00')&&html.includes('1 orders')&&html.includes('USD 5.00')&&html.includes('THB 1200.00'));
 assert.ok(!html.includes('<script>')&&html.includes('&lt;script&gt;'));
});
test('queue call names the same short code as the cup label and the pickup point',()=>{
 assert.equal(queuePhrase(order(),'th'),'คิวหมายเลข A B C D พร้อมรับแล้วค่ะ ที่ โต๊ะ B1');
 assert.equal(queuePhrase(order(),'en'),'Order A B C D is ready for pickup at โต๊ะ B1');
});
