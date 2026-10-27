import {readFile,writeFile} from 'node:fs/promises';
// Extract the reviewed delivery-only dependency closure, never the advanced platform chain.
const dispatch=await readFile('docs/plans/database-20261017/drafts/061_food_dispatch_tracking.sql','utf8');
const invariants=await readFile('docs/plans/database-20261017/drafts/067_domain_invariants.sql','utf8');
function section(source:string,start:string,end:string){const a=source.indexOf(start),b=source.indexOf(end,a);if(a<0||b<0)throw Error('Delivery source anchor missing: '+start);return source.slice(a,b);}
const tables=section(dispatch,'CREATE TABLE quote_delivery_snapshots(','CREATE INDEX food_shipment_dispatch_queue').replace('zone_version_id uuid REFERENCES service_zone_versions','zone_version_id uuid').replaceAll(/(\w+) platform_minor NOT NULL/g,'$1 bigint NOT NULL CHECK($1>=0)');
const hashes=section(invariants,'CREATE FUNCTION draft067_delivery_request_hash(','-- Preserve 057');
const validation=section(invariants,'CREATE OR REPLACE FUNCTION assert_configured_quote(','CREATE FUNCTION draft067_assert_allocations(');
const guards=`
CREATE FUNCTION delivery_quote_destination(merchant uuid,branch uuid,account uuid,quote uuid,address uuid,address_version bigint,policy uuid,price uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF merchant::text IS DISTINCT FROM current_setting('bitpos.merchant',true) OR account::text IS DISTINCT FROM current_setting('bitpos.mobile_account',true) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('merchant_id',p.merchant_id,'quote_id',quote,'branch_id',p.branch_id,'account_id',a.account_id,'address_id',a.id,'address_version',a.version::text,'policy_version_id',p.id,'zone_version_id',NULL,'recipient_name',a.recipient_name,'phone',a.phone,'address_text',a.address_text,'instructions',a.instructions,'origin_latitude_e7',p.origin_latitude_e7,'origin_longitude_e7',p.origin_longitude_e7,'latitude_e7',a.latitude_e7,'longitude_e7',a.longitude_e7,'currency',p.currency,'decimals',p.decimals,'delivery_minor',p.delivery_minor::text,'service_minor',p.service_minor::text,'merchant_minor',p.merchant_minor::text,'driver_minor',p.driver_minor::text,'platform_minor',p.platform_minor::text,'fixture',p.fixture) INTO result
 FROM branch_delivery_policies h JOIN delivery_policy_versions p ON(p.merchant_id,p.branch_id,p.id)=(h.merchant_id,h.branch_id,h.active_version_id)
 JOIN marketplace_branches b ON(b.merchant_id,b.id)=(p.merchant_id,p.branch_id) JOIN mobile_addresses a ON a.account_id=account AND a.id=address
 WHERE h.merchant_id=merchant AND h.branch_id=branch AND h.enabled AND b.enabled AND b.delivery_enabled AND NOT a.archived AND a.version=address_version AND p.id=policy AND p.price_version_id=price
 AND a.latitude_e7 BETWEEN p.south_e7 AND p.north_e7 AND a.longitude_e7 BETWEEN p.west_e7 AND p.east_e7 FOR SHARE OF h,p,b,a;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION delivery_quote_destination(uuid,uuid,uuid,uuid,uuid,bigint,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delivery_quote_destination(uuid,uuid,uuid,uuid,uuid,bigint,uuid,uuid) TO bitpos_app;
CREATE TRIGGER delivery_snapshot_immutable BEFORE UPDATE OR DELETE ON quote_delivery_snapshots FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION delivery_runtime_snapshot_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN PERFORM draft067_assert_quote(NEW.merchant_id,NEW.quote_id);RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER delivery_runtime_snapshot_complete AFTER INSERT ON quote_delivery_snapshots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION delivery_runtime_snapshot_complete();
CREATE FUNCTION delivery_runtime_shipment_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE a order_authority;
BEGIN
 SELECT * INTO a FROM order_authority WHERE merchant_id=NEW.merchant_id AND order_id=NEW.order_id;
 IF NOT FOUND OR a.source_kind<>'online' OR a.serving_kind<>'delivery' OR a.quote_id IS DISTINCT FROM NEW.quote_id OR a.source_account_id IS DISTINCT FROM NEW.account_id
 OR NOT EXISTS(SELECT 1 FROM online_food_orders f WHERE f.merchant_id=NEW.merchant_id AND f.order_id=NEW.order_id AND f.account_id=NEW.account_id AND f.branch_id=a.source_branch_id)
 OR NEW.state<>'WAITING_MERCHANT' OR NEW.version<>1 OR NEW.generation<>0 OR NEW.event_sequence<>0 OR NEW.active_assignment_id IS NOT NULL
 THEN RAISE EXCEPTION 'INVALID_DELIVERY_SHIPMENT_ADMISSION' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER delivery_runtime_shipment_identity BEFORE INSERT ON food_shipments FOR EACH ROW EXECUTE FUNCTION delivery_runtime_shipment_identity();
REVOKE ALL ON FUNCTION delivery_runtime_snapshot_complete(),delivery_runtime_shipment_identity() FROM PUBLIC,bitpos_app;
CREATE FUNCTION delivery_runtime_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 PERFORM draft067_assert_quote(NEW.merchant_id,NEW.id);RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER delivery_runtime_quote_complete AFTER INSERT ON order_quotes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION delivery_runtime_complete();
CREATE FUNCTION delivery_runtime_admit_shipment() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
DECLARE a order_authority;
BEGIN
 SELECT * INTO STRICT a FROM order_authority WHERE merchant_id=NEW.merchant_id AND order_id=NEW.order_id;
 IF a.serving_kind='delivery' THEN
  INSERT INTO food_shipments(merchant_id,order_id,quote_id,account_id,state) VALUES(NEW.merchant_id,NEW.order_id,a.quote_id,NEW.account_id,'WAITING_MERCHANT');
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER delivery_runtime_shipment AFTER INSERT ON online_food_orders FOR EACH ROW EXECUTE FUNCTION delivery_runtime_admit_shipment();
ALTER TABLE quote_delivery_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_delivery_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE food_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_shipments FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_snapshot_tenant ON quote_delivery_snapshots TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY delivery_shipment_tenant ON food_shipments TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
REVOKE ALL ON quote_delivery_snapshots,food_shipments FROM PUBLIC,bitpos_app;
GRANT SELECT,INSERT ON quote_delivery_snapshots,food_shipments TO bitpos_app;
REVOKE ALL ON FUNCTION draft067_delivery_request_hash(uuid,uuid,jsonb,quote_delivery_snapshots),draft067_delivery_hash(uuid,uuid,jsonb),draft067_assert_quote(uuid,uuid),draft067_snapshot_insert(),draft067_shipment_insert(),delivery_runtime_complete(),delivery_runtime_admit_shipment() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION draft067_delivery_request_hash(uuid,uuid,jsonb,quote_delivery_snapshots),draft067_delivery_hash(uuid,uuid,jsonb),draft067_assert_quote(uuid,uuid) TO bitpos_app;
`;
await writeFile('supabase/migrations/060_food_delivery_snapshots.sql','-- Generated by tools/runtime/generate-delivery-snapshot-migration.ts.\n-- Local delivery closure only. No production activation; preserve immutable evidence on rollback.\nSET search_path=bitpos,public;\n'+tables+hashes+validation+guards);
