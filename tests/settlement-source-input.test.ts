import test from 'node:test';import assert from 'node:assert/strict';
import {parseSettlementSourcePairs} from '../apps/web/src/lib/settlement-source-input';
const a='00000000-0000-4000-8000-00000000000a',b='00000000-0000-4000-8000-00000000000b';
test('operator pairs sort together without changing exact version strings',()=>{
 assert.deepEqual(parseSettlementSourcePairs(`${b.toUpperCase()} 9007199254740993\r\n${a} 2`),{sourceIds:[a,b],sourceVersions:['2','9007199254740993']});
});
test('invalid, duplicate and oversized operator sources cannot become a command',()=>{
 for(const text of ['',`${a} 0`,`${a} 01`,`${a} 1 extra`,`${a} 1\n${a.toUpperCase()} 2`,'not-an-id 1',Array(51).fill(`${a} 1`).join('\n')])assert.throws(()=>parseSettlementSourcePairs(text));
});
