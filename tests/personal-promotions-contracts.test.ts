import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {personalTargetInput,personalRecipientsView,seatPromotionCustomer} from '../packages/contracts/src/personal-promotions';
test('staff seating requires explicit presence and complete table/device fences, not payment or wallet authority',()=>{
 const input={tableId:randomUUID(),customerId:randomUUID(),expectedGeneration:'1',deviceId:randomUUID(),assignmentGeneration:'2',authGeneration:'3',requestId:randomUUID(),confirmPresent:true};
 assert.deepEqual(seatPromotionCustomer.parse(input),input);
 for(const invalid of [{...input,confirmPresent:false},{...input,expectedGeneration:'0'},{...input,assignmentGeneration:'9223372036854775808'},{...input,walletAddress:'client-wallet'},{...input,markPaid:true}])assert.equal(seatPromotionCustomer.safeParse(invalid).success,false);
});
test('staff recognition requires explicit relationship confirmation and signed bigint generation, never client wallet/contact authority',()=>{
 const input={tableId:randomUUID(),occupancyGeneration:'1',recipientVisitId:randomUUID(),customerId:randomUUID(),confirmRecipient:true};
 assert.deepEqual(personalTargetInput.parse(input),input);
 for(const invalid of [{...input,confirmRecipient:false},{...input,occupancyGeneration:'0'},{...input,occupancyGeneration:'9223372036854775808'},{...input,walletAddress:'client-assertion'},{...input,phone:'private-contact'}])assert.equal(personalTargetInput.safeParse(invalid).success,false);
});
test('merchant recipient discovery distinguishes guest, staff relationship and verified auth without public capabilities',()=>{
 const table=randomUUID(),visit=randomUUID(),recipient=randomUUID(),device=randomUUID(),customer=randomUUID();
 const view={tables:[{id:table,label:'Table 4',generation:'2',active:true,guests:[{visitId:visit,recipientId:recipient,customerId:customer,recognition:'staff_confirmed_profile',orderId:null,deviceId:device}]}],customers:[{id:customer,name:'Merchant-only name'}],orders:[]};
 assert.deepEqual(personalRecipientsView.parse(view),view);
 assert.equal(personalRecipientsView.safeParse({...view,tables:[{...view.tables[0],guests:[{...view.tables[0].guests[0],recognition:'wallet_address_from_client'}]}]}).success,false);
 assert.equal(personalRecipientsView.safeParse({...view,customers:[{...view.customers[0],walletAddress:'private'}]}).success,false);
 assert.equal(personalRecipientsView.safeParse({...view,tables:[{...view.tables[0],guests:[{...view.tables[0].guests[0],visitToken:'private'}]}]}).success,false);
});
