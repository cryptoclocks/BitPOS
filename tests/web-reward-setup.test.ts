import test from 'node:test';
import assert from 'node:assert/strict';
import {fromMinor,rewardBody,toMinor,type RewardDraft} from '../apps/web/src/lib/reward-setup';
const draft=(o:Partial<RewardDraft>={}):RewardDraft=>({slot:1,nameTh:'ส่วนลด 20 บาท',nameEn:'20 off',pointsCost:'100',discount:'20',minimumSpend:'100',validityDays:'30',enabled:true,...o});
test('money text converts to exact integer minor units',()=>{
 assert.equal(toMinor('20',2),'2000');assert.equal(toMinor('12.5',2),'1250');assert.equal(toMinor('0.05',2),'5');assert.equal(toMinor('7',0),'7');
 for(const bad of ['','0','0.00','-1','1.234','1,5','abc','1e3','1.','.5',' ','1234567890'])assert.equal(toMinor(bad,2),null,bad);
 assert.equal(fromMinor('2000',2),'20');assert.equal(fromMinor('1250',2),'12.5');assert.equal(fromMinor('5',2),'0.05');assert.equal(fromMinor('7',0),'7');
});
test('reward form produces only a request the server accepts and refuses free or invalid vouchers',()=>{
 const ok=rewardBody(draft(),2);assert.ok(ok.ok);if(ok.ok)assert.deepEqual(ok.body,{slot:1,nameTh:'ส่วนลด 20 บาท',nameEn:'20 off',pointsCost:100,discountMinor:'2000',minimumSpendMinor:'10000',validityDays:30,enabled:true});
 const reason=(o:Partial<RewardDraft>)=>{const r=rewardBody(draft(o),2);return r.ok?'ok':r.reason;};
 assert.equal(reason({minimumSpend:'20'}),'minimum-too-low');assert.equal(reason({minimumSpend:'10'}),'minimum-too-low');
 assert.equal(reason({nameTh:' '}),'name');assert.equal(reason({nameEn:'x'.repeat(81)}),'name');
 assert.equal(reason({pointsCost:'0'}),'points');assert.equal(reason({pointsCost:'1.5'}),'points');assert.equal(reason({pointsCost:'1000001'}),'points');
 assert.equal(reason({discount:'0'}),'discount');assert.equal(reason({minimumSpend:''}),'minimum');
 assert.equal(reason({validityDays:'0'}),'validity');assert.equal(reason({validityDays:'366'}),'validity');
});
