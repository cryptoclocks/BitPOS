-- DS42: scheduled-order admission, once-only due work and payment/cancel
-- convergence. Replaces the 107 "never admitted" order gate. A slot is bound to
-- exactly one order; capacity counts unbound live holds plus active bookings;
-- the kitchen-release instant is copied from the server-published window and
-- never supplied by a client. No provider or wallet callback is consulted.
SET search_path=bitpos,public;
CREATE TABLE schedule168_bookings(
 merchant_id uuid NOT NULL,order_id uuid NOT NULL,quote_id uuid NOT NULL,hold_id uuid NOT NULL UNIQUE REFERENCES schedule107_holds,slot_id uuid NOT NULL REFERENCES schedule107_windows,
 account_id uuid NOT NULL REFERENCES mobile_accounts,kitchen_release_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'BOUND'CHECK(state IN('BOUND','PAID','DUE','CANCELED')),version bigint NOT NULL DEFAULT 1 CHECK(version>0),due_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,order_id),UNIQUE(merchant_id,quote_id),FOREIGN KEY(merchant_id,order_id)REFERENCES orders(merchant_id,id),FOREIGN KEY(merchant_id,quote_id)REFERENCES order_quotes,
 CHECK((state='DUE')=(due_at IS NOT NULL))
);
CREATE INDEX schedule168_due ON schedule168_bookings(kitchen_release_at,order_id)WHERE state='PAID';
CREATE INDEX schedule168_capacity ON schedule168_bookings(slot_id)WHERE state IN('BOUND','PAID','DUE');
ALTER TABLE schedule168_bookings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON schedule168_bookings FROM PUBLIC,bitpos_app;
CREATE FUNCTION schedule168_booking_guard()RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF TG_OP<>'UPDATE'THEN RAISE EXCEPTION 'immutable authority record' USING ERRCODE='23514';END IF;
 IF(to_jsonb(NEW)-ARRAY['state','version','updated_at','due_at'])IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','updated_at','due_at'])OR NEW.version<>OLD.version+1
 OR NOT((OLD.state,NEW.state)IN(('BOUND','PAID'),('BOUND','CANCELED'),('PAID','DUE'),('PAID','CANCELED')))THEN RAISE EXCEPTION 'SCHEDULE_BOOKING_IMMUTABLE' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER schedule168_booking_guard BEFORE UPDATE OR DELETE ON schedule168_bookings FOR EACH ROW EXECUTE FUNCTION schedule168_booking_guard();
CREATE OR REPLACE FUNCTION schedule107_hold_guard()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE w schedule107_windows;q order_quotes;at timestamptz;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'SCHEDULE_READ_COMMITTED_REQUIRED';END IF;
 IF TG_OP='DELETE'THEN RAISE EXCEPTION 'IMMUTABLE_SCHEDULE_HOLD';END IF;
 SELECT * INTO STRICT w FROM schedule107_windows WHERE id=NEW.slot_id FOR UPDATE;at:=clock_timestamp();
 IF TG_OP='UPDATE'THEN
  IF(to_jsonb(NEW)-'state')IS DISTINCT FROM(to_jsonb(OLD)-'state')OR OLD.state<>'HELD'OR NEW.state NOT IN('RELEASED','EXPIRED')THEN RAISE EXCEPTION 'IMMUTABLE_SCHEDULE_HOLD';END IF;
  IF NEW.state='EXPIRED'AND NEW.expires_at>at THEN RAISE EXCEPTION 'SCHEDULE_HOLD_STILL_LIVE';END IF;
  IF EXISTS(SELECT 1 FROM order_authority WHERE merchant_id=NEW.merchant_id AND quote_id=NEW.quote_id)AND NOT EXISTS(SELECT 1 FROM schedule168_bookings k WHERE k.hold_id=NEW.id AND k.state='CANCELED')THEN RAISE EXCEPTION 'SCHEDULE_RECONCILIATION_REQUIRED';END IF;
  RETURN NEW;
 END IF;
 PERFORM dispatch_realtime_actor();
 IF NEW.account_id IS DISTINCT FROM dispatch_live_actor()OR NEW.session_id IS DISTINCT FROM nullif(current_setting('bitpos.mobile_session',true),'')::uuid THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 SELECT * INTO q FROM order_quotes WHERE merchant_id=NEW.merchant_id AND id=NEW.quote_id AND origin_kind='online'AND source_account_id=NEW.account_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 IF NEW.merchant_id<>w.merchant_id OR q.source_branch_id IS DISTINCT FROM w.branch_id OR (q.authority->'serving'->>'kind')IS DISTINCT FROM w.serving
 OR NOT w.enabled OR w.booking_closes_at<=at OR q.valid_until<=at
 OR NOT EXISTS(SELECT 1 FROM marketplace_branches b WHERE b.merchant_id=w.merchant_id AND b.id=w.branch_id AND b.enabled AND b.timezone=w.timezone AND CASE w.serving WHEN 'pickup'THEN b.pickup_enabled ELSE b.delivery_enabled END)
 THEN RAISE EXCEPTION 'SCHEDULE_SLOT_UNAVAILABLE';END IF;
 IF EXISTS(SELECT 1 FROM order_authority WHERE merchant_id=q.merchant_id AND quote_id=q.id)THEN RAISE EXCEPTION 'SCHEDULE_QUOTE_ALREADY_BILLED';END IF;
 PERFORM assert_configured_quote(q.merchant_id,q.id);
 IF NEW.source_request_hash<>q.request_hash OR NEW.state<>'HELD'OR NEW.expires_at IS DISTINCT FROM least(q.valid_until,w.booking_closes_at)THEN RAISE EXCEPTION 'SCHEDULE_NONCANONICAL_HOLD';END IF;
 IF(SELECT count(*)FROM schedule107_holds x WHERE x.slot_id=w.id AND x.state='HELD'AND x.expires_at>at AND NOT EXISTS(SELECT 1 FROM schedule168_bookings k WHERE k.hold_id=x.id))+(SELECT count(*)FROM schedule168_bookings k WHERE k.slot_id=w.id AND k.state IN('BOUND','PAID','DUE'))>=w.capacity THEN RAISE EXCEPTION 'SCHEDULE_CAPACITY_EXHAUSTED';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION schedule107_order_gate()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;h schedule107_holds;w schedule107_windows;q order_quotes;at timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO h FROM schedule107_holds WHERE merchant_id=NEW.merchant_id AND quote_id=NEW.quote_id;
 IF NOT FOUND THEN RETURN NEW;END IF;
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'SCHEDULE_READ_COMMITTED_REQUIRED';END IF;
 actor:=dispatch_live_actor();
 IF NEW.merchant_id::text IS DISTINCT FROM current_setting('bitpos.merchant',true)OR NEW.source_kind<>'online'OR NEW.source_account_id IS DISTINCT FROM actor OR h.account_id<>actor THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 SELECT * INTO STRICT w FROM schedule107_windows WHERE id=h.slot_id FOR UPDATE;
 SELECT * INTO STRICT h FROM schedule107_holds WHERE id=h.id FOR UPDATE;
 SELECT * INTO STRICT q FROM order_quotes WHERE merchant_id=NEW.merchant_id AND id=NEW.quote_id;
 IF h.state<>'HELD'OR h.expires_at<=at OR NOT w.enabled OR w.booking_closes_at<=at OR q.valid_until<=at THEN RAISE EXCEPTION 'SCHEDULE_HOLD_UNAVAILABLE';END IF;
 IF q.source_branch_id IS DISTINCT FROM w.branch_id OR(q.authority->'serving'->>'kind')IS DISTINCT FROM w.serving OR q.request_hash<>h.source_request_hash
 OR NOT EXISTS(SELECT 1 FROM marketplace_branches b WHERE b.merchant_id=w.merchant_id AND b.id=w.branch_id AND b.enabled AND b.timezone=w.timezone AND CASE w.serving WHEN 'pickup'THEN b.pickup_enabled ELSE b.delivery_enabled END)
 THEN RAISE EXCEPTION 'SCHEDULE_SLOT_UNAVAILABLE';END IF;
 PERFORM assert_configured_quote(q.merchant_id,q.id);
 IF EXISTS(SELECT 1 FROM schedule168_bookings WHERE hold_id=h.id OR merchant_id=NEW.merchant_id AND quote_id=NEW.quote_id)THEN RAISE EXCEPTION 'SCHEDULE_ALREADY_BOOKED';END IF;
 INSERT INTO schedule168_bookings(merchant_id,order_id,quote_id,hold_id,slot_id,account_id,kitchen_release_at)VALUES(NEW.merchant_id,NEW.order_id,NEW.quote_id,h.id,w.id,actor,w.kitchen_release_at);
 RETURN NEW;
END $$;
-- Payment / cancel / late-payment convergence driven by the order the verifier settles.
CREATE FUNCTION schedule168_cancel(target schedule168_bookings)RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 UPDATE schedule168_bookings SET state='CANCELED',version=version+1,updated_at=clock_timestamp()WHERE merchant_id=target.merchant_id AND order_id=target.order_id AND state IN('BOUND','PAID');
 UPDATE schedule107_holds SET state='RELEASED'WHERE id=target.hold_id AND state='HELD';
END $$;
CREATE FUNCTION schedule168_order_status()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE b schedule168_bookings;
BEGIN
 SELECT * INTO b FROM schedule168_bookings WHERE merchant_id=NEW.merchant_id AND order_id=NEW.id FOR UPDATE;
 IF NOT FOUND OR b.state NOT IN('BOUND','PAID')THEN RETURN NEW;END IF;
 IF NEW.status='PAID'AND b.state='BOUND'THEN
  UPDATE schedule168_bookings SET state='PAID',version=version+1,updated_at=clock_timestamp()WHERE merchant_id=b.merchant_id AND order_id=b.order_id;
 ELSIF b.state='BOUND'AND(NEW.status='RECOVERY'OR NEW.status='EXPIRED'AND NEW.closure_reason IS NOT NULL)THEN
  PERFORM schedule168_cancel(b);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER schedule168_order_status AFTER UPDATE OF status,closure_reason ON orders FOR EACH ROW EXECUTE FUNCTION schedule168_order_status();
CREATE FUNCTION schedule168_acceptance()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE b schedule168_bookings;
BEGIN
 IF NEW.acceptance_status IN('REJECTED','TIMED_OUT')AND NEW.acceptance_status IS DISTINCT FROM OLD.acceptance_status THEN
  SELECT * INTO b FROM schedule168_bookings WHERE merchant_id=NEW.merchant_id AND order_id=NEW.order_id FOR UPDATE;
  IF FOUND AND b.state IN('BOUND','PAID')THEN PERFORM schedule168_cancel(b);END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER schedule168_acceptance AFTER UPDATE OF acceptance_status ON online_food_orders FOR EACH ROW EXECUTE FUNCTION schedule168_acceptance();
-- Once-only due work: PAID + accepted + kitchen release instant reached -> DUE, with a durable mobile order event.
CREATE FUNCTION schedule168_release_due(batch integer DEFAULT 50)RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE b schedule168_bookings;n integer:=0;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'SCHEDULE_READ_COMMITTED_REQUIRED';END IF;
 IF batch IS NULL OR batch<1 OR batch>100 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 FOR b IN SELECT * FROM schedule168_bookings k WHERE k.state='PAID'AND k.kitchen_release_at<=clock_timestamp()ORDER BY k.kitchen_release_at,k.order_id LIMIT batch FOR UPDATE SKIP LOCKED LOOP
  CONTINUE WHEN NOT EXISTS(SELECT 1 FROM orders o JOIN online_food_orders f ON f.merchant_id=o.merchant_id AND f.order_id=o.id WHERE o.merchant_id=b.merchant_id AND o.id=b.order_id AND o.status='PAID'AND f.acceptance_status IN('PENDING','ACCEPTED'));
  UPDATE schedule168_bookings SET state='DUE',due_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()WHERE merchant_id=b.merchant_id AND order_id=b.order_id;
  PERFORM online_food_event(b.merchant_id,b.order_id,'SCHEDULE_DUE');
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION schedule168_booking_guard(),schedule168_cancel(schedule168_bookings),schedule168_order_status(),schedule168_acceptance(),schedule168_release_due(integer),schedule107_order_gate()FROM PUBLIC,bitpos_app;
GRANT EXECUTE ON FUNCTION schedule168_release_due(integer)TO bitpos_app;
