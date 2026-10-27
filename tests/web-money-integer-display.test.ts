import test from 'node:test';import assert from 'node:assert/strict';
import {formatMoney} from '../apps/web/src/lib/money';
test('integer money display preserves zero precision and negative subunit adjustments',()=>{
 assert.equal(formatMoney({currency:'THB',decimals:0,amountMinor:'123'}),'THB 123');
 assert.equal(formatMoney({currency:'THB',decimals:0,amountMinor:'-123'}),'THB -123');
 assert.equal(formatMoney({currency:'USD',decimals:2,amountMinor:'-1'}),'USD -0.01');
 assert.equal(formatMoney({currency:'USDG',decimals:6,amountMinor:'1000000'}),'USDG 1.000000');
 assert.equal(formatMoney({currency:'USD',decimals:4,amountMinor:'10000'}),'USD 1.00');
 assert.equal(formatMoney({currency:'USD',decimals:2,amountMinor:'9007199254740993123'}),'USD 90071992547409931.23');
});
