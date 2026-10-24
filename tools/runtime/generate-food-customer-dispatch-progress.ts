import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const base=await readFile('supabase/migrations/079_food_customer_authority_projection.sql','utf8');
assert.equal(createHash('sha256').update(base).digest('hex'),'01ac7cd85760b0931bd82525825fcbde3238ae102b01a05dc605619fba8964fa','Immutable079 source drift');
const searchBase=await readFile('supabase/migrations/074_food_dispatch_search.sql','utf8');
assert.equal(createHash('sha256').update(searchBase).digest('hex'),'e880b4c033b2a42d929cc61c8973fb69002956c694c096a7fc2c26258128f485','Immutable074 source drift');
function once(source:string,from:string,to:string){assert.equal(source.split(from).length,2,'Expected exactly one pinned projection fragment');return source.replace(from,to);}
let projection=base.slice(base.indexOf('CREATE OR REPLACE FUNCTION'));
projection=once(projection,"BEGIN\n","BEGIN\n IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DISPATCH_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';END IF;\n");
projection=once(projection,'available boolean;','available boolean;progress jsonb;');
projection=once(projection,' actor:=dispatch_live_actor();\n SELECT *',' actor:=nullif(current_setting(\'bitpos.mobile_account\',true),\'\')::uuid;\n SELECT *');
projection=once(projection,' s:=dispatch_lock_root(s.id);actor:=dispatch_live_actor();',' s:=dispatch_lock_root(s.id);PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();');
projection=once(projection," RETURN jsonb_build_object('shipmentId',s.id,'state',s.state,'version',s.version::text,'generation',s.generation::text,'assignment',active);"," progress:=food_customer_dispatch_progress(s,active);\n IF active IS NOT NULL THEN\n  available:=a.state<>'INCIDENT' AND food_driver_authority(a.driver_id,a.shipment_id) IS NULL;\n  IF NOT available THEN active:=active||jsonb_build_object('serviceAvailable',false,'location',NULL,'deliveryProof',NULL);progress:=progress||jsonb_build_object('phase','NEEDS_ATTENTION','attentionReason',NULL);END IF;\n END IF;\n PERFORM dispatch_realtime_actor();\n RETURN jsonb_build_object('shipmentId',s.id,'state',s.state,'version',s.version::text,'generation',s.generation::text,'assignment',active,'dispatch',progress);");
const searchStart=searchBase.indexOf('CREATE FUNCTION food_dispatch_search_value('),searchEnd=searchBase.indexOf('CREATE FUNCTION food_dispatch_search_snapshot(');
assert.ok(searchStart>=0&&searchEnd>searchStart);
const priorSearch=searchBase.slice(searchStart,searchEnd),attentionStart=priorSearch.indexOf("'attentionReason',")+18,attentionEnd=priorSearch.indexOf(",\n 'openedAt'");
assert.ok(attentionStart>18&&attentionEnd>attentionStart);
const attentionRule=priorSearch.slice(attentionStart,attentionEnd);
assert.ok(attentionRule.startsWith('CASE WHEN ')&&attentionRule.endsWith(' END'));
const shared=`-- One effective attention rule; customer polling never builds staff cycle-history JSON.
SET search_path=bitpos,public;
CREATE FUNCTION food_dispatch_search_attention(s food_dispatch_searches) RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$ SELECT ${attentionRule.replaceAll('s.','(s).')}; $$;
REVOKE ALL ON FUNCTION food_dispatch_search_attention(food_dispatch_searches) FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker;
${once(once(priorSearch,'CREATE FUNCTION','CREATE OR REPLACE FUNCTION'),attentionRule,'food_dispatch_search_attention(s)')}
`;
const helper=`-- Owner-only matching/reassignment facts; no driver history, staff reasons, policy or worker secrets.
CREATE FUNCTION food_customer_dispatch_progress(s food_shipments,active jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE phase text;attention text;released integer;last_released timestamptz;matching jsonb;reassignment jsonb;
BEGIN
 IF s.state IN('DELIVERED','CANCELLED','FAILED') THEN phase:='CLOSED';
 ELSIF active IS NOT NULL THEN phase:=CASE WHEN (active->>'serviceAvailable')::boolean THEN 'ASSIGNED' ELSE 'NEEDS_ATTENTION' END;
 ELSIF EXISTS(SELECT 1 FROM food_dispatch_offers o WHERE o.shipment_id=s.id AND o.generation=s.generation AND o.state='OFFERED' AND o.expires_at>clock_timestamp()) THEN phase:='OFFERED';
 ELSE
  SELECT jsonb_build_object('version',q.version::text,'expiresAt',q.absolute_deadline),food_dispatch_search_attention(q) INTO matching,attention FROM food_dispatch_searches q WHERE q.shipment_id=s.id;
  IF FOUND THEN
  attention:=CASE WHEN attention IN('PROVIDER_UNAVAILABLE','NO_CANDIDATE','DEADLINE','BUDGET','POLICY_UNAVAILABLE','MANUAL') THEN attention ELSE NULL END;
  phase:=CASE WHEN attention IS NULL THEN 'SEARCHING' ELSE 'NEEDS_ATTENTION' END;
 ELSIF s.state IN('OFFERING','READY_FOR_DISPATCH','INCIDENT') THEN phase:='NEEDS_ATTENTION';
 ELSE phase:='NOT_STARTED';END IF;
 END IF;
 SELECT count(*)::integer,max(a.closed_at) INTO released,last_released FROM food_assignments a WHERE a.shipment_id=s.id AND a.state='RELEASED' AND a.picked_up_at IS NULL;
 IF released>0 THEN reassignment:=jsonb_build_object('count',released,'lastReleasedAt',last_released);END IF;
 RETURN jsonb_build_object('phase',phase,'attentionReason',attention,'search',matching,'reassignment',reassignment);
END $$;
REVOKE ALL ON FUNCTION food_customer_dispatch_progress(food_shipments,jsonb) FROM PUBLIC,bitpos_app,bitpos_food_dispatch_worker,bitpos_food_search_worker;
`;
const wakes=`\n-- Empty transactional wake hints only; existing snapshot authorization/clock reconciliation remains authoritative.
CREATE TRIGGER food_customer_search_realtime_wake AFTER INSERT OR UPDATE OR DELETE ON food_dispatch_searches FOR EACH STATEMENT EXECUTE FUNCTION dispatch_realtime_wake();
CREATE TRIGGER food_customer_policy_realtime_wake AFTER INSERT OR UPDATE OR DELETE ON food_dispatch_policy_heads FOR EACH STATEMENT EXECUTE FUNCTION dispatch_realtime_wake();
`;
const target='supabase/migrations/086_food_customer_dispatch_progress.sql',source=shared+helper+projection+wakes;
if(process.argv.includes('--check'))assert.equal(await readFile(target,'utf8'),source,'Generated086 drift');else await writeFile(target,source);
console.log(JSON.stringify({status:process.argv.includes('--check')?'MATCH':'GENERATED_UNAPPLIED',path:target,sourceSha256:createHash('sha256').update(source).digest('hex')}));
