import assert from 'node:assert/strict';
import test from 'node:test';
import {jobStateText,printerErrorText} from '../apps/web/src/lib/printer/messages';
import {testReceiptHtml} from '../apps/web/src/lib/printer/test-receipt';
import {layoutParts} from '../apps/web/src/lib/printer/render';

test('every error maps to a plain Thai and English sentence, never a raw code',()=>{
 for(const e of ['BLUETOOTH_UNSUPPORTED','PRINTER_NOT_SELECTED','NotFoundError User cancelled','CONNECT_TIMEOUT','DISCONNECTED','CANCELLED','RECEIPT_TOO_LONG','SecurityError x','weird']){
  for(const l of ['th','en'] as const){const t=printerErrorText(e,l);assert.ok(t.length>10);assert.ok(!/[A-Z_]{8,}/.test(t),t);}
 }
 assert.match(printerErrorText('DISCONNECTED','en'),/Check the printer before printing again/);
});
test('"sent" never claims the paper came out; "uncertain" and "failed" are different',()=>{
 assert.match(jobStateText('sent',1,1,'en'),/cannot confirm paper output/);
 assert.match(jobStateText('sent',1,1,'th'),/ยืนยันกระดาษที่ออกจริงไม่ได้/);
 assert.notEqual(jobStateText('failed',0,5,'en'),jobStateText('uncertain',2,5,'en'));
 assert.match(jobStateText('sending',3,9,'en'),/3\/9/);
});
test('the test receipt has Thai, English and escaped values',()=>{
 const html=testReceiptHtml('th',{printer:'<b>x</b>',paperMm:80,density:2,when:new Date('2026-11-04T01:00:00Z')});
 assert.match(html,/พิมพ์ทดสอบเครื่องพิมพ์ใบเสร็จ/);assert.match(html,/Chocolate brownie/);assert.ok(!html.includes('<b>x</b>'));assert.match(html,/&lt;b&gt;x&lt;\/b&gt;/);
});
