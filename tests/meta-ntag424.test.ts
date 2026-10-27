// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv} from 'node:crypto';
import {aesCmac,deriveTagKeys,verifySun,SunError,type SunKeys} from '../packages/meta-ai/src/ntag424';

const hex=(s:string)=>Buffer.from(s,'hex');
const zeroKeys:SunKeys={metaReadKey:Buffer.alloc(16),fileReadKey:Buffer.alloc(16)};
const code=(c:string)=>(e:unknown)=>e instanceof SunError&&e.code===c;

test('AES-CMAC matches RFC 4493 vectors',()=>{
 const k=hex('2b7e151628aed2a6abf7158809cf4f3c');
 assert.equal(aesCmac(k,Buffer.alloc(0)).toString('hex'),'bb1d6929e95937287fa37d129b756746');
 assert.equal(aesCmac(k,hex('6bc1bee22e409f96e93d7e117393172a')).toString('hex'),'070a16b46b4d4144f79bdd9dd04a287c');
 assert.equal(aesCmac(k,hex('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411')).toString('hex'),'dfa66747de9ae63030ca32611497c827');
});

test('NXP SUN example with default keys decodes UID 04DE5F1EACC040 and counter 61',()=>{
 assert.deepEqual(verifySun(zeroKeys,'EF963FF7828658A599F3041510671E88','94EED9EE65337086'),{uid:'04DE5F1EACC040',counter:61});
 assert.deepEqual(verifySun(zeroKeys,'ef963ff7828658a599f3041510671e88','94eed9ee65337086',undefined,'04de5f1eacc040'),{uid:'04DE5F1EACC040',counter:61});
});

test('tampered MAC, wrong key, wrong UID and malformed input are refused',()=>{
 assert.throws(()=>verifySun(zeroKeys,'EF963FF7828658A599F3041510671E88','94EED9EE65337087'),code('BAD_CMAC'));
 assert.throws(()=>verifySun({...zeroKeys,fileReadKey:Buffer.alloc(16,1)},'EF963FF7828658A599F3041510671E88','94EED9EE65337086'),code('BAD_CMAC'));
 assert.throws(()=>verifySun({...zeroKeys,metaReadKey:Buffer.alloc(16,1)},'EF963FF7828658A599F3041510671E88','94EED9EE65337086'),(e:unknown)=>e instanceof SunError&&(e.code==='BAD_PICC_DATA'||e.code==='BAD_CMAC'));
 assert.throws(()=>verifySun(zeroKeys,'EF963FF7828658A599F3041510671E88','94EED9EE65337086',undefined,'04DE5F1EACC041'),code('UID_MISMATCH'));
 assert.throws(()=>verifySun(zeroKeys,'EF963FF7','94EED9EE65337086'),code('MALFORMED'));
 assert.throws(()=>verifySun(zeroKeys,'EF963FF7828658A599F3041510671E88','zz'),code('MALFORMED'));
});

test('derived per-sticker keys round-trip a simulated tap and differ between stickers',()=>{
 const master=hex('00112233445566778899aabbccddeeff');
 const keys=deriveTagKeys(master,'mini-01');
 assert.notDeepEqual(keys,deriveTagKeys(master,'mini-02'));
 assert.notDeepEqual(keys.metaReadKey,keys.fileReadKey);
 // Simulate what the sticker writes for UID 04A1B2C3D4E5F6 at counter 0x000102.
 const uid=hex('04a1b2c3d4e5f6'),ctr=Buffer.from([0x02,0x01,0x00]);
 const plain=Buffer.concat([Buffer.from([0xc7]),uid,ctr,Buffer.alloc(5,0x5a)]);
 const c=createCipheriv('aes-128-cbc',keys.metaReadKey,Buffer.alloc(16));c.setAutoPadding(false);
 const picc=Buffer.concat([c.update(plain),c.final()]).toString('hex');
 const full=aesCmac(aesCmac(keys.fileReadKey,Buffer.concat([hex('3cc300010080'),uid,ctr])),Buffer.alloc(0));
 const mac=Buffer.from([1,3,5,7,9,11,13,15].map(i=>full[i])).toString('hex');
 assert.deepEqual(verifySun(keys,picc,mac,undefined,'04A1B2C3D4E5F6'),{uid:'04A1B2C3D4E5F6',counter:258});
 assert.throws(()=>verifySun(deriveTagKeys(master,'mini-02'),picc,mac),(e:unknown)=>e instanceof SunError);
 assert.throws(()=>deriveTagKeys(Buffer.alloc(8),'mini-01'));
 assert.throws(()=>deriveTagKeys(master,'bad id!'));
});
