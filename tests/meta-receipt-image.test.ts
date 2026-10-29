// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {receiptImageKey,receiptImageKeyValid,receiptImageUrl,receiptPng,receiptSvg} from '../apps/api/src/meta/receipt-image';

const master=Buffer.alloc(16,3),id='11111111-2222-4333-8444-555555555555';
const pic={shop:'Muse Café <x>',code:'C923',receipt:{recipientName:'',orderNumber:'C923',currency:'USD',paymentMethod:'',timestamp:1793000000,
 elements:[{title:'🥛 ลาเต้ / Latte',quantity:2,price:4.5,currency:'USD',imageUrl:'https://pay.example.test/meta/images/menu/latte.jpg'}],total:8,subtotal:9,discount:1}};

test('receipt picture URL: HMAC per order; other orders and forged keys refused',()=>{
 const k=receiptImageKey(master,id);
 assert.ok(receiptImageKeyValid(master,id,k));
 assert.ok(!receiptImageKeyValid(master,'11111111-2222-4333-8444-555555555556',k));
 assert.ok(!receiptImageKeyValid(Buffer.alloc(16,4),id,k));assert.ok(!receiptImageKeyValid(master,id,null));assert.ok(!receiptImageKeyValid(master,id,'x'));
 assert.equal(receiptImageUrl('https://pay.example.test',master,id),`https://pay.example.test/meta/receipt/${id}.png?k=${k}`);
});

test('receipt picture: escaped text, no emoji, the menu photo embedded, totals; PNG when resvg is present',async()=>{
 const svg=await receiptSvg(pic);
 assert.match(svg,/Muse Café &lt;x&gt;/);assert.doesNotMatch(svg,/🥛/);assert.match(svg,/#C923/);assert.match(svg,/\$9\.00/);assert.match(svg,/−\$1\.00/);assert.match(svg,/\$8\.00/);
 assert.match(svg,/data:image\/jpeg;base64,/,'menu photo read from the repository');
 const png=await receiptPng(pic);
 if(png)assert.deepEqual([...png.subarray(0,4)],[0x89,0x50,0x4e,0x47]);
});
