import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const parts=['-- Keep unconsumed/unrevoked issuer metadata after expiry so authorized UI can explicitly rotate.\n-- Consumption still rejects expired proofs; this never revives a secret.\nSET search_path=bitpos,public;'];
for(const [file,name] of [['066_food_merchant_work.sql','dispatch_merchant_work'],['067_food_customer_work.sql','dispatch_customer_work']]){
 const source=await readFile('supabase/migrations/'+file,'utf8'),start=source.indexOf('CREATE FUNCTION '+name+'('),end=source.indexOf('END $$;',start)+7;
 assert.ok(start>=0&&end>start);const body=source.slice(start,end),guard=' AND f.expires_at>clock_timestamp()';assert.equal(body.split(guard).length,2,'Exactly one issuer metadata expiry predicate expected');
 parts.push(body.replace('CREATE FUNCTION ','CREATE OR REPLACE FUNCTION ').replace(guard,''));
}
const path='supabase/migrations/068_food_proof_expiry_recovery.sql',output=parts.join('\n')+'\n';
if(process.argv.includes('--check'))assert.equal(await readFile(path,'utf8'),output,'Regenerate expiry recovery migration');else await writeFile(path,output);
