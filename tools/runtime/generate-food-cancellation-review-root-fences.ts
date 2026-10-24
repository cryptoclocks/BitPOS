import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {readFile,writeFile} from 'node:fs/promises';
const source=await readFile('supabase/migrations/083_food_cancellation_review.sql','utf8');assert.equal(createHash('sha256').update(source).digest('hex'),'1675a2b7acca854898a1604f47909af290d9089b5135861de9e150672de51334');
const names=['dispatch_customer_cancellation_review_request','dispatch_customer_cancellation_reviews','dispatch_food_cancellation_review_snapshot','dispatch_food_cancellation_review_inspect','dispatch_food_cancellation_review_disposition'];
let result='-- Forward083 correction: canonical root before retained account/session locks.\nSET search_path=bitpos,public;\n';
for(const name of names){
 const start=source.indexOf('CREATE FUNCTION '+name+'(');assert.ok(start>=0);const end=source.indexOf('END $$;',start);assert.ok(end>start);let fn=source.slice(start,end+7).replace('CREATE FUNCTION ','CREATE OR REPLACE FUNCTION ');
 const customer=name.startsWith('dispatch_customer_'),before=customer?'PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();SELECT * INTO s':'PERFORM dispatch_realtime_actor();SELECT * INTO r';
 const after=customer?"actor:=nullif(current_setting('bitpos.mobile_account',true),'')::uuid;SELECT * INTO s":'SELECT * INTO r';
 assert.equal(fn.split(before).length,2);fn=fn.replace(before,after);assert.ok(fn.includes('s:=dispatch_lock_root('));
 // Existing locked-root live presented-bearer/staff checks remain unchanged.
 result+=fn+'\n';
}
await writeFile('supabase/migrations/084_food_cancellation_review_root_fences.sql',result);console.log('Generated five forward root-first cancellation-review functions from immutable083; final live identity/scoped authority unchanged');
