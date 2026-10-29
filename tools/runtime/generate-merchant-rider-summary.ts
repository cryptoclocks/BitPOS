// Preserve the authorized merchant custody projection; add only current approved display identity.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const source=await readFile('supabase/migrations/068_food_proof_expiry_recovery.sql','utf8');
const start=source.indexOf('CREATE OR REPLACE FUNCTION dispatch_merchant_work(');
const end=source.indexOf('CREATE OR REPLACE FUNCTION dispatch_customer_work(',start);
assert.ok(start>=0&&end>start);
let sql=source.slice(start,end);
function replaceOnce(before:string,after:string){assert.equal(sql.split(before).length,2,'Merchant projection anchor changed');sql=sql.replace(before,after);}
replaceOnce('actor uuid;active jsonb:=NULL;','actor uuid;active jsonb:=NULL;rider jsonb:=NULL;');
replaceOnce(" IF FOUND THEN\n  SELECT jsonb_build_object",` IF FOUND THEN
  -- Root first, then the established occupancy/assignment/lease fence. Never use a previous rider.
  a:=dispatch_lock_assignment(a.id,s.generation,a.lease_generation);
  -- This gate locks identity/service authority NOWAIT and returns a reason for restricted duty.
  -- Restricted custody metadata remains visible, but unapproved application data does not.
  IF food_driver_authority(a.driver_id,s.id) IS NULL THEN
   SELECT jsonb_build_object('displayName',btrim(p.display_name)) INTO rider FROM driver_profiles p WHERE p.id=a.driver_id;
  END IF;
  SELECT jsonb_build_object`);
replaceOnce("'leaseGeneration',a.lease_generation::text,","'leaseGeneration',a.lease_generation::text,'rider',rider,");
const expected='-- Merchant-only current approved rider display. No profile/contact/location grant.\n-- Local migration draft; deploy with regenerated merchant contracts, never independently.\nSET search_path=bitpos,public;\n'+sql;
const path='supabase/migrations/136_food_merchant_rider_summary.sql';
if(process.argv.includes('--check'))assert.equal(await readFile(path,'utf8'),expected);
else await writeFile(path,expected);
console.log(process.argv.includes('--check')?'Merchant rider migration matches generator':'Generated merchant rider projection migration');
