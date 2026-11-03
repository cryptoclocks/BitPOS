import assert from 'node:assert/strict';
import test from 'node:test';
import {newProofSecret,normalizeProofSecret,PROOF_CODE_LENGTH} from '../apps/api/src/proof-code';

test('new proof secrets are short, unambiguous and pass the published pattern',()=>{
 const seen=new Set<string>();
 for(let i=0;i<500;i++){const s=newProofSecret();assert.equal(s.length,PROOF_CODE_LENGTH);assert.match(s,/^[0-9A-HJKMNP-TV-Z]{10}$/);assert.match(s,/^[A-Za-z0-9_-]{8,64}$/);seen.add(s);}
 assert.equal(seen.size,500);
});
test('typed short codes ignore case, spaces, dashes and look-alike letters',()=>{
 const code='AB7K9-MN0Q1';
 assert.equal(normalizeProofSecret('ab7k9-mn0q1'),'AB7K9MN0Q1');
 assert.equal(normalizeProofSecret(' ab7k9 mnoql '),'AB7K9MN0Q1');
 assert.equal(normalizeProofSecret(code),'AB7K9MN0Q1');
});
test('legacy 43-character tokens are left exactly as issued',()=>{
 const legacy='wY4ov-KQZk-rWykf0RGDd2E69cenQ1LmnaEUYY7Ibjo';
 assert.equal(normalizeProofSecret(legacy),legacy);
});
