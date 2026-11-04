import test from 'node:test';
import assert from 'node:assert/strict';
import {categoryOrder,moveItem,moveProduct} from '../apps/web/src/lib/menu-order';

test('category order is first appearance; moving swaps neighbours and stops at the ends',()=>{
 const p=[{id:'1',category:'A'},{id:'2',category:'A'},{id:'3',category:'B'},{id:'4',category:''}];
 assert.deepEqual(categoryOrder(p),['A','B','']);
 assert.deepEqual(moveItem(['A','B',''],'B',-1),['B','A','']);
 assert.equal(moveItem(['A','B'],'A',-1),null);assert.equal(moveItem(['A','B'],'B',1),null);assert.equal(moveItem(['A','B'],'Z',1),null);
});
test('moving a product inside a category skips products of other categories',()=>{
 const p=[{id:'1',category:'A'},{id:'2',category:'B'},{id:'3',category:'A'}];
 assert.deepEqual(moveProduct(p,'3',-1,'A'),['3','2','1']);
 assert.deepEqual(moveProduct(p,'3',-1),['1','3','2']);
 assert.equal(moveProduct(p,'1',-1,'A'),null);assert.equal(moveProduct(p,'x',1),null);
});
