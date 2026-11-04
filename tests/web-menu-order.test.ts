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

import {cellKey,channelChanges,savedMap} from '../apps/web/src/lib/channel-prices';
test('channel price changes send only edited cells; blank removes a saved override; bad text names the cell',()=>{
 const saved=savedMap([{productId:'p1',channel:'counter',unitMinor:'300'}]);
 const parse=(t:string)=>{if(!/^\d+(\.\d{1,2})?$/.test(t))throw Error('bad');return String(Math.round(Number(t)*100));};
 assert.deepEqual(channelChanges(saved,{[cellKey('p1','counter')]:'3.00',[cellKey('p1','table')]:''},parse),{set:[]});
 assert.deepEqual(channelChanges(saved,{[cellKey('p1','counter')]:'',[cellKey('p2','online')]:'1.5'},parse),{set:[{productId:'p1',channel:'counter',unitMinor:null},{productId:'p2',channel:'online',unitMinor:'150'}]});
 assert.deepEqual(channelChanges(saved,{[cellKey('p1','table')]:'abc'},parse),{bad:'p1|table'});
});
