import assert from 'node:assert/strict';
import test from 'node:test';
import {lineKey,minorToInput,optionsText,parseDiscount,quickTenders} from '../apps/web/src/lib/cash-view';
import {cashReceiptDoc,isTaxInvoice} from '../apps/web/src/lib/print-slip';
import type {CashSale} from '../apps/web/src/lib/cash-view';

const sale=(over:Partial<CashSale>={}):CashSale=>({id:'i',seq:'7',receiptNo:'T000007',status:'PAID',currency:{code:'THB',decimals:2},subtotalMinor:'18500',discountMinor:'1850',totalMinor:'16650',netMinor:'15561',vatMinor:'1089',vatMode:'inclusive',vatBps:700,tenderMinor:'20000',changeMinor:'3350',cashier:'c',createdAt:'2026-11-02T03:00:00Z',void:null,
 seller:{name:'ร้านทดสอบ',taxId:'0105500000001',branch:'00000',address:'1 ถนนทดสอบ'},lines:[{lineNo:1,productId:'p',name:'ลาเต้ <b>',nameEn:'Latte',qty:2,unit:'แก้ว',baseMinor:'6500',sweetness:50,addons:[{id:'a',label:'วิปครีม',labelEn:'Whip',priceMinor:'0'}],unitMinor:'6500',lineTotalMinor:'13000'},{lineNo:2,productId:'q',name:'ชา',nameEn:'Tea',qty:1,unit:'',baseMinor:'5500',sweetness:null,addons:[],unitMinor:'5500',lineTotalMinor:'5500'}],...over});

test('quick tender buttons: exact first, then round amounts that cover the total',()=>{
 assert.deepEqual(quickTenders(16650n,2),[16650n,20000n,50000n,100000n]);
 assert.deepEqual(quickTenders(100n,2),[100n,5000n,10000n,50000n]);
 assert.deepEqual(quickTenders(15000n,2),[15000n,20000n,50000n,100000n]);   // 150 is already a multiple of 50: the next round amounts follow
 assert.deepEqual(quickTenders(99999n,0),[99999n,100000n]);   // whole-unit currency: only the next round amount is larger
 for(const total of [1n,99n,4999n,123456n]){const q=quickTenders(total,2);assert.equal(q[0],total);assert.ok(q.slice(1).every(v=>v>total)&&q.length<=4,String(total));}
});
test('discount box: percent in basis points, amount in minor units, empty means none, junk is invalid',()=>{
 assert.deepEqual(parseDiscount('percent','10',2),{kind:'percent',bps:1000});
 assert.deepEqual(parseDiscount('percent','12.5',2),{kind:'percent',bps:1250});
 assert.deepEqual(parseDiscount('amount','25',2),{kind:'amount',minor:'2500'});
 assert.equal(parseDiscount('amount','',2),null);
 for(const bad of ['abc','-5','0','100','12.345'])assert.equal(parseDiscount('percent',bad,2),undefined,bad);
 assert.equal(parseDiscount('amount','0',2),undefined);
 assert.equal(parseDiscount('amount','1.234',2),undefined);
});
test('minorToInput shows the editable decimal text',()=>{
 assert.equal(minorToInput('6500',2),'65.00');assert.equal(minorToInput('5',2),'0.05');assert.equal(minorToInput('7',0),'7');
});
test('tax-inclusive sale with a complete seller prints as an abbreviated tax invoice',()=>{
 const th=cashReceiptDoc(sale(),'th');
 assert.ok(isTaxInvoice(sale()));
 for(const x of ['ใบกำกับภาษีอย่างย่อ','T000007','0105500000001','ร้านทดสอบ','THB 166.50','THB 155.61','VAT 7%','THB 10.89','ราคารวมภาษีมูลค่าเพิ่มแล้ว','THB 33.50','ส่วนลด'])assert.ok(th.includes(x),x);
 assert.ok(!th.includes('ลาเต้ <b>')&&th.includes('ลาเต้ &lt;b&gt;'));
});
test('without tax data it is a plain receipt; a voided sale is stamped; English labels follow the language',()=>{
 for(const s of [sale({vatMode:'none',vatMinor:'0',netMinor:'16650'}),sale({seller:{name:'ร้าน',taxId:'123'}}),sale({seller:{}})]){
  const html=cashReceiptDoc(s,'en');assert.ok(html.includes('Receipt')&&!html.includes('tax invoice')&&!html.includes('VAT'),html.slice(0,80));
 }
 assert.ok(cashReceiptDoc(sale({status:'VOIDED',void:{at:'x',by:'m',reason:'r',restocked:false}}),'en').includes('VOID'));
 assert.ok(cashReceiptDoc(sale(),'en').includes('Abbreviated tax invoice')&&cashReceiptDoc(sale(),'en').includes('Latte'));
 assert.ok(!cashReceiptDoc(sale({discountMinor:'0',subtotalMinor:'16650'}),'th').includes('ส่วนลด'));
});
test('options text, line identity and the receipt show sweetness, add-ons and units',()=>{
 assert.equal(optionsText(50,[{label:'วิปครีม',labelEn:'Whip'}],'th'),'หวาน 50% · วิปครีม');
 assert.equal(optionsText(0,[{label:'วิปครีม',labelEn:'Whip'}],'en'),'Sweet 0% · Whip');
 assert.equal(optionsText(null,[],'th'),'');
 assert.equal(lineKey({productId:'p',sweetness:50,addonIds:['b','a']}),lineKey({productId:'p',sweetness:50,addonIds:['a','b','a']}));
 assert.notEqual(lineKey({productId:'p',sweetness:50}),lineKey({productId:'p',sweetness:0}));
 assert.notEqual(lineKey({productId:'p'}),lineKey({productId:'p',sweetness:0}));
 const th=cashReceiptDoc(sale(),'th');
 assert.ok(th.includes('2 แก้ว')&&th.includes('หวาน 50% · วิปครีม'));
 assert.ok(cashReceiptDoc(sale(),'en').includes('Sweet 50% · Whip'));
});

test('English and bilingual bills: names, labels, options and the shop name follow the chosen language',()=>{
 const s=sale({seller:{name:'ร้านตัวอย่าง',nameEn:'Sample Cafe',taxId:'0105500000001',branch:'00000',address:'1 ถนนตัวอย่าง',addressEn:'1 Sample Rd'}});
 const en=cashReceiptDoc(s,'en');
 for(const x of ['Sample Cafe','1 Sample Rd','Abbreviated tax invoice','Latte','Sweet 50% · Whip','Cash received','Change','Thank you'])assert.ok(en.includes(x),x);
 assert.ok(!/[\u0e00-\u0e7f]/.test(en.replace(/<title>.*<\/title>/,'').replace('แก้ว','')),'no Thai left on an English bill except the unit the owner typed');
 const both=cashReceiptDoc(s,'both');
 for(const x of ['ร้านตัวอย่าง / Sample Cafe','ใบกำกับภาษีอย่างย่อ / Abbreviated tax invoice','ลาเต้','Latte','รับเงินสด / Cash received','เงินทอน / Change','ขอบคุณที่อุดหนุน / Thank you','หวาน 50% / Sweet 50%'])assert.ok(both.includes(x)||both.includes(x.replace(' / ',' / ')),x);
 // an English bill never invents English text: a shop with no English name falls back to the Thai one
 assert.ok(cashReceiptDoc(sale(),'en').includes('ร้านทดสอบ'));
 assert.ok(optionsText(null,[{label:'ไข่มุก',labelEn:''}],'en')==='ไข่มุก');
});
