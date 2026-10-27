-- Online food lifecycle and narrow cross-tenant mobile bootstrap projections.
-- Local preparation only. Disable mobile admission for application rollback;
-- retain immutable customer events and financial/order evidence.
SET search_path=bitpos,public;

CREATE FUNCTION mobile_public_branches(p_branch uuid,p_after uuid,p_limit integer)
RETURNS TABLE(merchant_id uuid,profile jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT b.merchant_id,jsonb_build_object('id',b.id,'merchantId',b.merchant_id,'merchantName',m.name,
 'name',b.name,'nameEn',coalesce(b.name_en,''),'addressLabel',coalesce(b.address_label,''),
 'pickupEnabled',b.pickup_enabled,'deliveryEnabled',b.delivery_enabled,'version',b.version)
 FROM marketplace_branches b JOIN merchants m ON m.id=b.merchant_id
 WHERE b.enabled AND (p_branch IS NULL OR b.id=p_branch) AND (p_after IS NULL OR b.id>p_after)
 AND p_limit BETWEEN 1 AND 31 ORDER BY b.id LIMIT least(greatest(p_limit,1),31)
$$;
REVOKE ALL ON FUNCTION mobile_public_branches(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mobile_public_branches(uuid,uuid,integer) TO bitpos_app;

CREATE TABLE online_food_orders(
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,account_id uuid NOT NULL REFERENCES mobile_accounts,
 branch_id uuid NOT NULL,acceptance_status text NOT NULL DEFAULT 'PENDING'
 CHECK(acceptance_status IN ('PENDING','ACCEPTED','REJECTED','TIMED_OUT')),
 acceptance_version integer NOT NULL DEFAULT 0 CHECK(acceptance_version>=0),
 acceptance_deadline timestamptz NOT NULL,decision_by uuid,decision_reason text,
 event_sequence bigint NOT NULL DEFAULT 0 CHECK(event_sequence>=0),
 PRIMARY KEY(merchant_id,order_id),FOREIGN KEY(merchant_id,order_id) REFERENCES order_authority(merchant_id,order_id),
 FOREIGN KEY(merchant_id,branch_id) REFERENCES marketplace_branches(merchant_id,id),
 CHECK((acceptance_status='PENDING' AND acceptance_version=0 AND decision_by IS NULL AND decision_reason IS NULL)
 OR (acceptance_status<>'PENDING' AND acceptance_version=1))
);
CREATE INDEX online_food_orders_account ON online_food_orders(account_id,order_id);
CREATE TABLE mobile_order_events(
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),
 sequence bigint NOT NULL CHECK(sequence>0),kind text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),facts jsonb NOT NULL,
 PRIMARY KEY(merchant_id,order_id,sequence),UNIQUE(id),
 FOREIGN KEY(merchant_id,order_id) REFERENCES online_food_orders(merchant_id,order_id)
);
CREATE TABLE online_acceptance_requests(
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,idempotency_key text NOT NULL,
 request_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,order_id,idempotency_key),
 FOREIGN KEY(merchant_id,order_id) REFERENCES online_food_orders(merchant_id,order_id)
);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['online_food_orders','mobile_order_events','online_acceptance_requests'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_access ON %I TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON online_food_orders TO bitpos_app;
GRANT SELECT,INSERT ON mobile_order_events,online_acceptance_requests TO bitpos_app;
CREATE TRIGGER immutable_mobile_event BEFORE UPDATE OR DELETE ON mobile_order_events FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE TRIGGER immutable_online_acceptance_request BEFORE UPDATE OR DELETE ON online_acceptance_requests FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();

CREATE FUNCTION online_food_event(p_merchant uuid,p_order uuid,p_kind text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=bitpos,pg_temp AS $$
DECLARE n bigint; snapshot jsonb;
BEGIN
 UPDATE online_food_orders SET event_sequence=event_sequence+1
 WHERE merchant_id=p_merchant AND order_id=p_order RETURNING event_sequence INTO n;
 IF n IS NULL THEN RETURN; END IF;
 SELECT jsonb_build_object('paymentStatus',o.status,'paymentVersion',o.version,
 'acceptanceStatus',f.acceptance_status,'acceptanceVersion',f.acceptance_version,
 'fulfillmentStatus',coalesce(k.status,'RECEIVED'),'fulfillmentVersion',coalesce(k.version,0)) INTO snapshot
 FROM online_food_orders f JOIN orders o ON o.merchant_id=f.merchant_id AND o.id=f.order_id
 LEFT JOIN order_fulfillment k ON k.merchant_id=f.merchant_id AND k.order_id=f.order_id
 WHERE f.merchant_id=p_merchant AND f.order_id=p_order;
 INSERT INTO mobile_order_events(merchant_id,order_id,sequence,kind,facts) VALUES(p_merchant,p_order,n,p_kind,snapshot);
 PERFORM pg_notify('bitpos_mobile_orders','');
END $$;
REVOKE ALL ON FUNCTION online_food_event(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION online_food_event(uuid,uuid,text) TO bitpos_app;

CREATE FUNCTION initialize_online_food() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF NEW.source_kind='online' THEN
  INSERT INTO online_food_orders(merchant_id,order_id,account_id,branch_id,acceptance_deadline)
  SELECT NEW.merchant_id,NEW.order_id,NEW.source_account_id,NEW.source_branch_id,
   least(quote_expires_at,clock_timestamp()+interval '2 minutes') FROM orders WHERE merchant_id=NEW.merchant_id AND id=NEW.order_id;
  PERFORM online_food_event(NEW.merchant_id,NEW.order_id,'CREATED');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER initialize_online_food AFTER INSERT ON order_authority FOR EACH ROW EXECUTE FUNCTION initialize_online_food();

CREATE FUNCTION guard_online_food_update() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF (NEW.merchant_id,NEW.order_id,NEW.account_id,NEW.branch_id,NEW.acceptance_deadline)
 IS DISTINCT FROM (OLD.merchant_id,OLD.order_id,OLD.account_id,OLD.branch_id,OLD.acceptance_deadline)
 THEN RAISE EXCEPTION 'immutable online ownership' USING ERRCODE='23514'; END IF;
 IF NEW.acceptance_status IS DISTINCT FROM OLD.acceptance_status THEN
  IF OLD.acceptance_status<>'PENDING' OR NEW.acceptance_status='PENDING' OR NEW.acceptance_version<>OLD.acceptance_version+1
  THEN RAISE EXCEPTION 'invalid online acceptance transition' USING ERRCODE='23514'; END IF;
  IF NEW.acceptance_status='ACCEPTED' AND (NEW.decision_by IS NULL OR NEW.acceptance_deadline<=clock_timestamp())
  THEN RAISE EXCEPTION 'online acceptance expired or actor missing' USING ERRCODE='23514'; END IF;
 ELSIF (NEW.acceptance_version,NEW.decision_by,NEW.decision_reason) IS DISTINCT FROM (OLD.acceptance_version,OLD.decision_by,OLD.decision_reason)
 THEN RAISE EXCEPTION 'immutable online decision' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_online_food_update BEFORE UPDATE ON online_food_orders FOR EACH ROW EXECUTE FUNCTION guard_online_food_update();
CREATE FUNCTION record_online_food_change() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 PERFORM online_food_event(NEW.merchant_id,NEW.order_id,TG_ARGV[0]);RETURN NEW;
END $$;
CREATE TRIGGER online_acceptance_event AFTER UPDATE ON online_food_orders FOR EACH ROW
 WHEN(NEW.acceptance_status IS DISTINCT FROM OLD.acceptance_status) EXECUTE FUNCTION record_online_food_change('ACCEPTANCE');
CREATE FUNCTION record_online_payment_change() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 PERFORM online_food_event(NEW.merchant_id,NEW.id,'PAYMENT');RETURN NEW;
END $$;
CREATE TRIGGER online_payment_event AFTER UPDATE ON orders FOR EACH ROW
 WHEN(NEW.status IS DISTINCT FROM OLD.status) EXECUTE FUNCTION record_online_payment_change();
CREATE TRIGGER online_kitchen_event AFTER UPDATE ON order_fulfillment FOR EACH ROW
 WHEN(NEW.status IS DISTINCT FROM OLD.status) EXECUTE FUNCTION record_online_food_change('KITCHEN');
CREATE FUNCTION guard_online_kitchen() RETURNS trigger LANGUAGE plpgsql SET search_path=bitpos,pg_temp AS $$
BEGIN
 IF NEW.status<>'RECEIVED' AND EXISTS(SELECT 1 FROM online_food_orders WHERE merchant_id=NEW.merchant_id AND order_id=NEW.order_id)
 AND NOT EXISTS(SELECT 1 FROM online_food_orders f JOIN orders o ON o.merchant_id=f.merchant_id AND o.id=f.order_id
 WHERE f.merchant_id=NEW.merchant_id AND f.order_id=NEW.order_id AND f.acceptance_status='ACCEPTED' AND o.status='PAID')
 THEN RAISE EXCEPTION 'online kitchen requires accepted paid order' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_online_kitchen BEFORE INSERT OR UPDATE ON order_fulfillment FOR EACH ROW EXECUTE FUNCTION guard_online_kitchen();

-- Returns only routing identifiers for the already authenticated live session.
-- The API must still use tenant() and recheck ownership for every material read.
CREATE FUNCTION mobile_owned_order_locations(p_account uuid,p_session uuid,p_order uuid,p_before uuid,p_limit integer)
RETURNS TABLE(merchant_id uuid,order_id uuid,branch_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT f.merchant_id,f.order_id,f.branch_id FROM online_food_orders f
 JOIN orders o ON o.merchant_id=f.merchant_id AND o.id=f.order_id
 WHERE f.account_id=p_account AND (p_order IS NULL OR f.order_id=p_order)
 AND EXISTS(SELECT 1 FROM mobile_sessions s JOIN mobile_accounts a ON a.id=s.account_id
 WHERE s.id=p_session AND s.account_id=p_account AND s.revoked_at IS NULL
 AND s.access_expires_at>statement_timestamp() AND s.refresh_expires_at>statement_timestamp() AND a.disabled_at IS NULL)
 AND (p_before IS NULL OR (o.created_at,o.id)<(SELECT x.created_at,x.id FROM online_food_orders g
 JOIN orders x ON x.merchant_id=g.merchant_id AND x.id=g.order_id WHERE g.account_id=p_account AND g.order_id=p_before))
 AND p_limit BETWEEN 1 AND 31 ORDER BY o.created_at DESC,o.id DESC LIMIT least(greatest(p_limit,1),31)
$$;
REVOKE ALL ON FUNCTION mobile_owned_order_locations(uuid,uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mobile_owned_order_locations(uuid,uuid,uuid,uuid,integer) TO bitpos_app;
