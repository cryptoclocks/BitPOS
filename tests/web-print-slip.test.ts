import assert from 'node:assert/strict';
import test from 'node:test';
import {cashReceiptDoc,escapeHtml,receiptDoc,stickerDocs,zReportDoc} from '../apps/web/src/lib/print-slip';
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

// M09: the shop-wide look changes how a bill looks, never what it says.
const look=(over:Record<string,unknown>={})=>({shopName:'ร้านกาแฟ <ทดสอบ>',shopNameEn:'Test Cafe',footer:'แล้วพบกันใหม่',footerEn:'See you!',paperMm:80 as const,...over});
const stripLook=(html:string)=>html.replace(/<h1>.*?<\/h1>/s,'').replace(/<p class="c">(แล้วพบกันใหม่|See you!|แล้วพบกันใหม่ \/ See you!|ขอบคุณที่อุดหนุน|Thank you|ขอบคุณที่อุดหนุน \/ Thank you)<\/p>/,'').replace(/@page\{size:[^;]*;/,'').replace(/width:\d+mm/,'');
test('receipt look: shop name and footer follow the bill language, markup is escaped, the default is unchanged',()=>{
 const th=receiptDoc(order(),'th',look()),en=receiptDoc(order(),'en',look()),both=receiptDoc(order(),'both',look());
 assert.ok(th.includes('<h1>ร้านกาแฟ &lt;ทดสอบ&gt;</h1>')&&th.includes('แล้วพบกันใหม่')&&!th.includes('See you!'));
 assert.ok(en.includes('<h1>Test Cafe</h1>')&&en.includes('See you!'));
 assert.ok(both.includes('ร้านกาแฟ &lt;ทดสอบ&gt; / Test Cafe')&&both.includes('แล้วพบกันใหม่ / See you!'));
 assert.ok(!th.includes('<ทดสอบ>'));
 // an English bill with no English footer falls back to the Thai footer; no footer at all keeps the default thank-you
 assert.ok(receiptDoc(order(),'en',look({footerEn:''})).includes('แล้วพบกันใหม่'));
 assert.ok(receiptDoc(order(),'en',look({footer:'',footerEn:''})).includes('Thank you'));
 assert.ok(receiptDoc(order(),'th').includes('<h1>BitPOS</h1>')&&receiptDoc(order(),'th').includes('ขอบคุณที่อุดหนุน'));
});
test('receipt look: paper width changes the page, the amounts and lines stay byte-identical',()=>{
 const w80=receiptDoc(order(),'th',look()),w58=receiptDoc(order(),'th',look({paperMm:58}));
 assert.ok(w80.includes('size:72mm auto')&&w58.includes('size:48mm auto')&&w58.includes('width:48mm'));
 assert.equal(stripLook(w58).replace(/48mm/g,''),stripLook(w80).replace(/72mm/g,''));
 assert.equal(stripLook(receiptDoc(order(),'en',look())),stripLook(receiptDoc(order(),'en')),'only name, footer and width differ from the old bill');
});
test('receipt look: a reprint is stamped as a copy, the original never is',()=>{
 assert.ok(!receiptDoc(order(),'th',look()).includes('สำเนา'));
 assert.ok(receiptDoc(order(),'th',look({copy:2})).includes('*** สำเนา ครั้งที่ 1 ***'));
 assert.ok(receiptDoc(order(),'en',look({copy:4})).includes('*** COPY 3 ***'));
 assert.ok(receiptDoc(order(),'both',look({copy:3})).includes('สำเนา ครั้งที่ 2 / COPY 2'));
});
test('receipt look: Z-report and cash receipt take the shop look; a voided cash sale keeps its VOID stamp and a copy stamp',()=>{
 const z=zReportDoc({periodStart:'2026-11-01T02:00:00Z',periodEnd:'2026-11-01T11:00:00Z',closedBy:'owner',note:'',countedCash:null,groups:[{currency:'THB',decimals:2,orders:1,totalMinor:'100'}]},'en',look({paperMm:58}));
 assert.ok(z.includes('<h1>Test Cafe</h1>')&&z.includes('size:48mm auto'));
 const sale={id:'s',receiptNo:'H-0001',status:'VOIDED',createdAt:'2026-11-01T03:00:00Z',currency:{code:'THB',decimals:2},vatMode:'none',vatBps:700,subtotalMinor:'6500',discountMinor:'0',netMinor:'6500',totalMinor:'6500',tenderMinor:'10000',changeMinor:'3500',
  seller:{name:'ร้านทดสอบ',nameEn:'',address:'',addressEn:'',taxId:'',branch:'00000'},lines:[{name:'ลาเต้',nameEn:'Latte',qty:1,unit:'',unitMinor:'6500',lineTotalMinor:'6500',sweetness:null,addons:[]}]} as never;
 const html=cashReceiptDoc(sale,'th',look({copy:2,paperMm:58}));
 assert.ok(html.includes('ยกเลิกแล้ว')&&html.includes('สำเนา ครั้งที่ 1')&&html.includes('แล้วพบกันใหม่')&&html.includes('size:48mm auto')&&html.includes('THB 65.00'));
 assert.ok(html.includes('<h1>ร้านทดสอบ</h1>'),'the legal seller name on a cash receipt still comes from the cash settings, not the receipt look');
 assert.ok(!html.includes('ใบกำกับภาษี')&&!/tax invoice/i.test(html),'a cash receipt is never called a tax invoice');
});
