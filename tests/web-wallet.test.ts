import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { avatar, bindWallet, connectPhantom, discoverWallets, phantomBrowseUrl, submitPayment, type ConnectedWallet, type PaymentRequest, type TestWalletProvider } from '../apps/web/src/lib/wallet';
import { formatMoney } from '../apps/web/src/lib/money';

test('challenge signs exact UTF8 and binds detached base58 signature to this order', async () => {
  const calls: { path: string; body: unknown }[] = [];
  const signature = Uint8Array.of(1, 2, 255);
  const wallet: ConnectedWallet = { address: 'customer', name: 'fixture', fixture: true, async signMessage(message) { assert.equal(new TextDecoder().decode(message), 'ร้าน A\norder-42\nnonce'); return signature; }, async signTransaction() { throw new Error('Unexpected transaction'); } };
  const request: PaymentRequest = async <T>(path: string, body: unknown) => { calls.push({ path, body }); return (path.endsWith('/challenge') ? { id: 'nonce-id', message: 'ร้าน A\norder-42\nnonce', expiresAt: new Date(Date.now() + 60000).toISOString() } : { payer: 'customer', avatar: 'a' }) as T; };
  await bindWallet('order-token', wallet, request);
  assert.deepEqual(calls, [{ path: '/pay/order-token/challenge', body: { address: 'customer' } }, { path: '/pay/order-token/bind', body: { challengeId: 'nonce-id', signature: bs58.encode(signature) } }]);
});
test('expired challenge never signs or binds', async () => {
  let signed = false; let count = 0;
  const wallet: ConnectedWallet = { address: 'customer', name: 'fixture', fixture: true, async signMessage() { signed = true; return new Uint8Array(); }, async signTransaction() { throw new Error('Unexpected transaction'); } };
  const request: PaymentRequest = async <T>() => { count++; return { id: 'expired', message: 'no', expiresAt: '2000-01-01T00:00:00Z' } as T; };
  await assert.rejects(bindWallet('token', wallet, request), /expired/); assert.equal(signed, false); assert.equal(count, 1);
});
test('signed transaction submits attempt bytes, not a client paid callback', async () => {
  const calls: { path: string; body: unknown }[] = [];
  const wallet: ConnectedWallet = { address: 'customer', name: 'fixture', fixture: true, async signMessage() { throw new Error('Unexpected message'); }, async signTransaction(bytes) { assert.deepEqual([...bytes], [1, 2, 3]); return Uint8Array.of(4, 5, 6); } };
  const request: PaymentRequest = async <T>(path: string, body: unknown) => { calls.push({ path, body }); return (path.endsWith('/attempt') ? { id: 'attempt-1', base64: 'AQID' } : { signature: 'chain-signature', status: 'submitted' }) as T; };
  const result = await submitPayment('token', wallet, request);
  assert.deepEqual(calls, [{ path: '/pay/token/attempt', body: { address: wallet.address } }, { path: '/pay/token/submit', body: { attemptId: 'attempt-1', base64: 'BAUG' } }]); assert.equal(result.status, 'submitted');
});
test('Phantom injected message compatibility passes exact bytes and utf8', async () => {
  const wallet = await connectPhantom({ async connect() { return { publicKey: { toString: () => 'payer' } }; }, async signMessage(message, encoding) { assert.equal(encoding, 'utf8'); assert.deepEqual([...message], [7, 8]); return { signature: Uint8Array.of(9) }; }, async signTransaction() { throw new Error('Unused'); } });
  assert.equal(wallet.address, 'payer'); assert.deepEqual([...(await wallet.signMessage(Uint8Array.of(7, 8)))], [9]); assert.equal(wallet.fixture, false);
});
test('browser fixture requires localhost, explicit opt-in and visible fixture identity', async () => {
  const fixture: TestWalletProvider = { isBitPOSTestFixture: true, async connect() { return { address: 'fixture-address' }; }, async signMessage(bytes) { return bytes; }, async signTransaction(bytes) { return bytes; } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(new EventTarget(), { __BITPOS_TEST_WALLET__: fixture }) });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { hostname: '127.0.0.1', search: '?testWallet=1' } });
  const choices = await discoverWallets(); const choice = choices.find(c => c.name.includes('TEST WALLET'))!; assert.ok(choice); assert.equal((await choice.connect()).fixture, true);
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { hostname: 'shop.example', search: '?testWallet=1' } });
  assert.equal((await discoverWallets()).some(c => c.name.includes('TEST WALLET')), false);
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { hostname: 'localhost', search: '' } });
  assert.equal((await discoverWallets()).some(c => c.name.includes('TEST WALLET')), false);
  Reflect.deleteProperty(globalThis, 'window'); Reflect.deleteProperty(globalThis, 'location');
});
test('Phantom browse preserves exact order URL, rejects executable schemes', () => {
  const url = 'https://shop.example/pay/order_A?testWallet=1'; const deep = new URL(phantomBrowseUrl(url)); assert.equal(decodeURIComponent(deep.pathname.slice('/ul/browse/'.length)), url); assert.equal(deep.searchParams.get('ref'), 'https://shop.example'); assert.throws(() => phantomBrowseUrl('javascript:alert(1)'));
});
test('minor units retain integer precision and avatar stays symmetric and wallet-specific', () => {
  assert.equal(formatMoney({ currency: 'THB', decimals: 2, amountMinor: '900719925474099399' }), 'THB 9007199254740993.99'); assert.equal(formatMoney({ currency: 'USDG', decimals: 6, amountMinor: '1234567' }), 'USDG 1.234567');
  assert.deepEqual(avatar('wallet-A'), avatar('wallet-A')); assert.notDeepEqual(avatar('wallet-A'), avatar('wallet-B')); const pattern = avatar('wallet-A'); for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) assert.equal(pattern.cells[y * 5 + x], pattern.cells[y * 5 + 4 - x]);
});

test('ambiguous signed submit retries the same persisted bytes without another wallet approval',async()=>{
 const store=new Map<string,string>();Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v),removeItem:(k:string)=>store.delete(k)}}});
 let signatures=0;const requests:{path:string;body:unknown}[]=[];
 const wallet:ConnectedWallet={address:'retry-wallet',name:'fixture',fixture:true,async signMessage(){throw Error('No message approval expected');},async signTransaction(){signatures++;return Uint8Array.of(4,5,6);}};
 let refuse=true;const request:PaymentRequest=async<T>(path:string,body:unknown)=>{requests.push({path,body});if(path.endsWith('/attempt'))return {id:'attempt-1',base64:'AQID'} as T;if(refuse)throw new TypeError('Transport interrupted');return {signature:'same-signature',status:'AWAITING_PAYMENT'} as T;};
 try{await assert.rejects(submitPayment('retry-token',wallet,request),TypeError);refuse=false;await submitPayment('retry-token',wallet,request);assert.equal(signatures,1);assert.deepEqual(requests[1],requests[2]);assert.equal(requests.length,3);}finally{Reflect.deleteProperty(globalThis,'window');}
});
