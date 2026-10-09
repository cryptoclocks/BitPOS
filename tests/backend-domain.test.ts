import test from 'node:test';
import assert from 'node:assert/strict';
import {quote,canonicalItems,assertSettlement,challengeMessage,liveOrder,avatar,MINT,TOKEN_PROGRAM,deviceBillLines} from '../packages/domain/src/index';
import nacl from 'tweetnacl';
test('canonical integer quote and duplicate cart quantities cannot change billing',()=>{
 assert.equal(quote(3500n),1000000n);assert.equal(quote(1n),286n);assert.equal(quote(35000000000000000000n),10000000000000000000000n);
 assert.deepEqual(canonicalItems([{productId:'b',qty:2},{productId:'a',qty:1},{productId:'b',qty:3}]),[{productId:'a',qty:1},{productId:'b',qty:5}]);assert.throws(()=>canonicalItems([{productId:'a',qty:1.5}]));assert.throws(()=>canonicalItems([]));
});
test('settlement rejects every mismatched attribution and failed chain execution',()=>{
 const expected={mint:MINT,program:TOKEN_PROGRAM,recipient:'treasury',rawAmount:1000000n,reference:'order-reference',payer:'customer'};
 assert.doesNotThrow(()=>assertSettlement({error:null,...expected},expected));
 for(const field of ['mint','program','recipient','reference','payer'] as const)assert.throws(()=>assertSettlement({error:null,...expected,[field]:'wrong'},expected));
 assert.throws(()=>assertSettlement({error:null,...expected,rawAmount:999999n},expected));assert.throws(()=>assertSettlement({error:{InstructionError:1},...expected},expected));
});
test('wallet proof binds domain, tenant, order, nonce and expiry; forged proof fails',()=>{
 const wallet=nacl.sign.keyPair();const input={nonce:'fixture-nonce',address:'fixture-address',orderId:'order-a',merchantId:'tenant-a',domain:'localhost',expiresAt:'2026-10-08T00:00:00Z'};
 const message=challengeMessage(input),signature=nacl.sign.detached(Buffer.from(message),wallet.secretKey);assert.equal(nacl.sign.detached.verify(Buffer.from(message),signature,wallet.publicKey),true);
 for(const field of ['nonce','address','orderId','merchantId','domain','expiresAt'] as const)assert.equal(nacl.sign.detached.verify(Buffer.from(challengeMessage({...input,[field]:'changed'})),signature,wallet.publicKey),false);
 assert.equal(avatar(input.address),avatar(input.address));assert.notEqual(avatar(input.address),avatar('other-wallet'));
});
test('expired and settled orders cannot issue new wallet challenges or attempts',()=>{
 assert.doesNotThrow(()=>liveOrder({status:'AWAITING_PAYMENT',quote_expires_at:new Date(2000)},1000));
 for(const status of ['PAID','RECOVERY','CONFIRMING','EXPIRED'])assert.throws(()=>liveOrder({status,quote_expires_at:new Date(2000)},1000));
 assert.throws(()=>liveOrder({status:'AWAITING_PAYMENT',quote_expires_at:new Date(1000)},1000));
});
test('minimal device bill stays within six UTF8-safe lines without shrinking full order',()=>{
 const items=Array.from({length:9},(_,i)=>({name:'กาแฟ'.repeat(40)+i,qty:i+1}));
 const lines=deviceBillLines(items);assert.equal(lines.length,6);assert.equal(lines[5],'+ 4 more items');
 for(const line of lines){assert.ok(Buffer.byteLength(line)<96);assert.equal(line.includes('�'),false);}
 assert.equal(items.length,9);assert.ok(items[0].name.length>100);
 for(const count of [6,7,12,50]) {
  const full=Array.from({length:count},(_,i)=>({name:`Coffee ${i+1}`,qty:1}));
  const frozen=structuredClone(full),shown=deviceBillLines(full);
  assert.deepEqual(shown.slice(0,count>6?5:6),full.slice(0,count>6?5:6).map(item=>`1 x ${item.name}`));
  if(count>6)assert.equal(shown[5],`+ ${count-5} more items`);
  assert.deepEqual(full,frozen,'bounded public bill must not truncate the canonical full order');
 }
});
test('device bill punctuation uses covered ASCII without losing Thai text',()=>{
 assert.deepEqual(deviceBillLines([{name:'Americano',qty:2},{name:'กาแฟ',qty:1}]),['2 x Americano','1 x กาแฟ']);
 const [line]=deviceBillLines([{name:'Coffee'.repeat(40),qty:1}]);
 assert.ok(line.endsWith('...'));assert.ok(Buffer.byteLength(line)<96);
 assert.ok([...line].every(character=>character.charCodeAt(0)>=32&&character.charCodeAt(0)<=126),'truncation must not introduce an unsupported ellipsis glyph');
});
