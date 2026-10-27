import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {createMobilePushCrypto,loadMobilePushCrypto,mobilePushCryptoPath} from '../packages/domain/src/mobile-push-crypto';
const key=()=>randomBytes(32).toString('base64'),context={app:'CUSTOMER',deviceId:'00000000-0000-4000-8000-000000000087'} as const;
test('encrypted endpoint is authenticated to its exact app device and fingerprint',()=>{
 const crypto=createMobilePushCrypto({active:'v1',keys:{v1:key()}}),fid='synthetic-private-fid',encrypted=crypto.encrypt(fid,context);
 assert.equal(crypto.decrypt(encrypted,context),fid);assert.equal(encrypted.ciphertext.includes(fid),false);
 assert.throws(()=>crypto.decrypt(encrypted,{...context,app:'DRIVER'}),/PUSH_ENCRYPTION_UNAVAILABLE/);
 assert.throws(()=>crypto.decrypt(encrypted,{...context,deviceId:'00000000-0000-4000-8000-000000000088'}),/PUSH_ENCRYPTION_UNAVAILABLE/);
 assert.throws(()=>crypto.decrypt({...encrypted,endpointHash:'0'.repeat(64)},context),/PUSH_ENCRYPTION_UNAVAILABLE/);
 const bytes=Buffer.from(encrypted.ciphertext,'base64url');bytes[12]^=1;
 assert.throws(()=>crypto.decrypt({...encrypted,ciphertext:bytes.toString('base64url')},context),/PUSH_ENCRYPTION_UNAVAILABLE/);
 assert.throws(()=>crypto.encrypt('fid\nheader',context),/PUSH_ENCRYPTION_UNAVAILABLE/);
});
test('active key rotation preserves old ciphertext only while explicit retired key is retained',()=>{
 const old=key(),next=key(),initial=createMobilePushCrypto({active:'old',keys:{old}}),encrypted=initial.encrypt('synthetic-fid',context);
 const rotated=createMobilePushCrypto({active:'next',keys:{old,next}});assert.equal(rotated.decrypt(encrypted,context),'synthetic-fid');assert.equal(rotated.encrypt('synthetic-fid',context).keyId,'next');
 const retired=createMobilePushCrypto({active:'next',keys:{next}});assert.throws(()=>retired.decrypt(encrypted,context),/PUSH_ENCRYPTION_UNAVAILABLE/);
});
test('missing configuration performs no file read and invalid configuration fails without key material',async()=>{
 assert.equal(mobilePushCryptoPath({}),null);assert.equal(await loadMobilePushCrypto(null,async()=>{assert.fail('No configured private file authority');}),null);
 assert.throws(()=>mobilePushCryptoPath({BITPOS_PUSH_ENDPOINT_KEYRING_FILE:'relative.json'}),/PUSH_ENCRYPTION_UNAVAILABLE/);
 for(const raw of [{active:'bad',keys:{bad:'not-a-key'}},{active:'missing',keys:{good:key()}},{active:'a',keys:{a:key()},secret:'never echo'}])assert.throws(()=>createMobilePushCrypto(raw),/PUSH_ENCRYPTION_UNAVAILABLE/);
 await assert.rejects(loadMobilePushCrypto('/synthetic.json',async()=>'{not-json'),/PUSH_ENCRYPTION_UNAVAILABLE/);
});
