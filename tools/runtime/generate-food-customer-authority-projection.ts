import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const source=await readFile('supabase/migrations/078_food_driver_authority.sql','utf8');
assert.equal(createHash('sha256').update(source).digest('hex'),'32324ed323388cf0a6ebd51ba40c4672b9fd05ae26bd8964bea9207d3099f83d','Applied078 must remain immutable');
const start=source.indexOf('CREATE OR REPLACE FUNCTION dispatch_customer_work('),end=source.indexOf('$$;',source.indexOf('AS $$',start)+5);assert.ok(start>=0&&end>start);let body=source.slice(start,end+3);
function replace(needle:string,value:string){assert.equal(body.split(needle).length,2,needle);body=body.replace(needle,value);}
replace('tracking jsonb;active jsonb:=NULL;available boolean;','tracking jsonb;proof jsonb;active jsonb:=NULL;available boolean;');
replace(`  available:=a.state<>'INCIDENT' AND food_driver_authority(a.driver_id,a.shipment_id) IS NULL;
  active:=jsonb_build_object('serviceAvailable',available,'id',a.id,'state',a.state,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text,
   'location',tracking->'location',
   'deliveryProof',CASE WHEN available THEN (SELECT jsonb_build_object('id',f.id,'kind',f.kind,'expiresAt',f.expires_at,'attemptsRemaining',10-f.attempts) FROM fulfillment_proofs f WHERE f.assignment_id=a.id AND f.generation=a.generation AND f.kind='DELIVERY' AND f.revoked_at IS NULL AND f.consumed_at IS NULL) ELSE NULL END);`,
`  SELECT jsonb_build_object('id',f.id,'kind',f.kind,'expiresAt',f.expires_at,'attemptsRemaining',10-f.attempts) INTO proof FROM fulfillment_proofs f WHERE f.assignment_id=a.id AND f.generation=a.generation AND f.kind='DELIVERY' AND f.revoked_at IS NULL AND f.consumed_at IS NULL;
  -- One final live decision gates every previously fetched private field.
  available:=a.state<>'INCIDENT' AND food_driver_authority(a.driver_id,a.shipment_id) IS NULL;
  active:=jsonb_build_object('serviceAvailable',available,'id',a.id,'state',a.state,'generation',a.generation::text,'leaseGeneration',a.lease_generation::text,
   'location',CASE WHEN available THEN tracking->'location' ELSE NULL END,
   'deliveryProof',CASE WHEN available THEN proof ELSE NULL END);`);
await writeFile('supabase/migrations/079_food_customer_authority_projection.sql','-- Forward correction of078 customer expiry privacy; applied078 remains immutable.\nSET search_path=bitpos,public;\n'+body+'\n');
console.log('Generated079 final shared customer availability/location/proof decision from immutable078');
