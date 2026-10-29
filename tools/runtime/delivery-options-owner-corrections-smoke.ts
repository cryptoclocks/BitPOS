import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {parsePrice} from '../../apps/web/src/lib/money';
import {parseOptionDelta,pendingOnlineOptions,retainOnlineOptions,finishOnlineOptions} from '../../apps/web/src/lib/online-option-command';
import type {Session} from '../../apps/web/src/lib/table';
const passed:string[]=[];
const check=(name:string,fn:()=>void)=>{fn();passed.push(name);};
const values=new Map<string,string>();
Object.defineProperty(globalThis,'sessionStorage',{value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)},configurable:true});
const session={merchantId:'aa000000-0000-4000-8000-000000000001',userId:'aa000000-0000-4000-8000-000000000002',token:'fixture-not-real-session',role:'owner'} as Session;
const product='aa000000-0000-4000-8000-000000000003';
const command={expectedRevision:'0',idempotencyKey:'aa000000-0000-4000-8000-000000000004',priceVersion:'aa000000-0000-4000-8000-000000000005',noteEnabled:true,groups:[]};
check('Prior base-price parser rejects server-valid maximum USD2 option delta',()=>assert.throws(()=>parsePrice('9999999999999999.99','USD',2)));
for(const [decimals,value] of [[2,'9999999999999999.99'],[4,'99999999999999.9999'],[6,'999999999999.999999']] as const){
 check('Option delta maximum roundtrip decimals'+decimals,()=>assert.equal(parseOptionDelta(value,decimals),'999999999999999999'));
 check('Option delta zero decimals'+decimals,()=>assert.equal(parseOptionDelta('0.'+'0'.repeat(decimals),decimals),'0'));
 check('Option delta above maximum refused decimals'+decimals,()=>assert.throws(()=>parseOptionDelta('1'+'0'.repeat(18-decimals),decimals)));
}
check('Excess decimal places refused even for zero',()=>assert.throws(()=>parseOptionDelta('0.000',2)));
retainOnlineOptions(session,product,command);
check('Remount reads exact original publication identity',()=>assert.deepEqual(pendingOnlineOptions({...session},product),command));
check('Other product merchant and user cannot restore command',()=>{assert.equal(pendingOnlineOptions(session,'bb000000-0000-4000-8000-000000000003'),undefined);assert.equal(pendingOnlineOptions({...session,merchantId:'bb000000-0000-4000-8000-000000000001'},product),undefined);assert.equal(pendingOnlineOptions({...session,userId:'bb000000-0000-4000-8000-000000000002'},product),undefined);});
check('Cannot replace unresolved command',()=>assert.throws(()=>retainOnlineOptions(session,product,{...command,noteEnabled:false})));
check('Wrong completion cannot clear original command',()=>{assert.equal(finishOnlineOptions(session,product,{...command,noteEnabled:false}),false);assert.deepEqual(pendingOnlineOptions(session,product),command);});
finishOnlineOptions(session,product,command);
check('Resolved command cleared from recovery journal',()=>assert.equal(pendingOnlineOptions(session,product),undefined));
const receipt={environment:'deterministic_local_contract',assertions:passed.length,passed,limits:['Storage adapter is an isolated map; actual browser navigation proof separate','No money/provider operations'],physicalTesting:'deferred_by_user_2026-10-16'};
await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-options-owner-corrections.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
