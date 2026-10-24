-- Private scheduling foundation. NOT admitted to checkout or public app roles.
-- Absolute windows are published server-side in the branch timezone; clients
-- select an opaque ID, never supply a trusted timestamp/capacity/quote expiry.
SET search_path=bitpos,public;
CREATE TABLE schedule107_windows(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,branch_id uuid NOT NULL,
 serving text NOT NULL CHECK(serving IN('pickup','delivery')),timezone text NOT NULL,
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,kitchen_release_at timestamptz NOT NULL,
 booking_closes_at timestamptz NOT NULL,capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 10000),
 enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(merchant_id,branch_id)REFERENCES marketplace_branches(merchant_id,id),
 UNIQUE(merchant_id,branch_id,serving,starts_at),
 CHECK(ends_at>starts_at AND ends_at-starts_at<=interval '4 hours'),
 CHECK(booking_closes_at<=kitchen_release_at AND kitchen_release_at<=starts_at)
);
CREATE TABLE schedule107_holds(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,slot_id uuid NOT NULL REFERENCES schedule107_windows,
 quote_id uuid NOT NULL,account_id uuid NOT NULL REFERENCES mobile_accounts,session_id uuid NOT NULL REFERENCES mobile_sessions,
 source_request_hash text NOT NULL,state text NOT NULL DEFAULT 'HELD' CHECK(state IN('HELD','RELEASED','EXPIRED')),
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(merchant_id,quote_id),FOREIGN KEY(merchant_id,quote_id)REFERENCES order_quotes,
 CHECK(expires_at>created_at)
);
CREATE INDEX schedule107_capacity ON schedule107_holds(slot_id,expires_at)WHERE state='HELD';
CREATE TABLE schedule107_commands(
 account_id uuid NOT NULL REFERENCES mobile_accounts,command_id uuid NOT NULL,operation text NOT NULL CHECK(operation IN('HOLD','RELEASE')),
 slot_id uuid NOT NULL REFERENCES schedule107_windows,quote_id uuid NOT NULL,hold_id uuid NOT NULL REFERENCES schedule107_holds,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(account_id,command_id)
);
ALTER TABLE schedule107_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule107_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule107_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON schedule107_windows,schedule107_holds,schedule107_commands FROM PUBLIC,bitpos_app;
CREATE FUNCTION schedule107_window_guard()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE b marketplace_branches;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'SCHEDULE_READ_COMMITTED_REQUIRED';END IF;
 IF TG_OP='DELETE'THEN RAISE EXCEPTION 'IMMUTABLE_SCHEDULE_WINDOW';END IF;
 IF TG_OP='UPDATE'THEN
  IF(to_jsonb(NEW)-'enabled')IS DISTINCT FROM(to_jsonb(OLD)-'enabled')THEN RAISE EXCEPTION 'IMMUTABLE_SCHEDULE_WINDOW';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO b FROM marketplace_branches WHERE merchant_id=NEW.merchant_id AND id=NEW.branch_id FOR UPDATE;
 IF NOT FOUND OR NEW.timezone<>b.timezone OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.timezone)THEN RAISE EXCEPTION 'SCHEDULE_INVALID_TIMEZONE';END IF;
 IF EXISTS(SELECT 1 FROM schedule107_windows WHERE merchant_id=NEW.merchant_id AND branch_id=NEW.branch_id AND serving=NEW.serving AND starts_at<NEW.ends_at AND ends_at>NEW.starts_at)THEN RAISE EXCEPTION 'SCHEDULE_WINDOW_OVERLAP';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER schedule107_window_guard BEFORE INSERT OR UPDATE OR DELETE ON schedule107_windows FOR EACH ROW EXECUTE FUNCTION schedule107_window_guard();
CREATE FUNCTION schedule107_hold_guard()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE w schedule107_windows;q order_quotes;at timestamptz;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'SCHEDULE_READ_COMMITTED_REQUIRED';END IF;
 IF TG_OP='DELETE'THEN RAISE EXCEPTION 'IMMUTABLE_SCHEDULE_HOLD';END IF;
 SELECT * INTO STRICT w FROM schedule107_windows WHERE id=NEW.slot_id FOR UPDATE;at:=clock_timestamp();
 IF TG_OP='UPDATE'THEN
  IF(to_jsonb(NEW)-'state')IS DISTINCT FROM(to_jsonb(OLD)-'state')OR OLD.state<>'HELD'OR NEW.state NOT IN('RELEASED','EXPIRED')THEN RAISE EXCEPTION 'IMMUTABLE_SCHEDULE_HOLD';END IF;
  IF NEW.state='EXPIRED'AND NEW.expires_at>at THEN RAISE EXCEPTION 'SCHEDULE_HOLD_STILL_LIVE';END IF;
  IF EXISTS(SELECT 1 FROM order_authority WHERE merchant_id=NEW.merchant_id AND quote_id=NEW.quote_id)THEN RAISE EXCEPTION 'SCHEDULE_RECONCILIATION_REQUIRED';END IF;
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
 IF(SELECT count(*)FROM schedule107_holds WHERE slot_id=w.id AND state='HELD'AND expires_at>at)>=w.capacity THEN RAISE EXCEPTION 'SCHEDULE_CAPACITY_EXHAUSTED';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER schedule107_hold_guard BEFORE INSERT OR UPDATE OR DELETE ON schedule107_holds FOR EACH ROW EXECUTE FUNCTION schedule107_hold_guard();
CREATE TRIGGER schedule107_commands_immutable BEFORE UPDATE OR DELETE ON schedule107_commands FOR EACH ROW EXECUTE FUNCTION immutable_authority_row();
CREATE FUNCTION schedule107_hold(slot uuid,quote uuid,command uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;sid uuid;merchant uuid;w schedule107_windows;q order_quotes;h schedule107_holds;c schedule107_commands;replayed boolean:=false;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'SCHEDULE_READ_COMMITTED_REQUIRED';END IF;
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();sid:=nullif(current_setting('bitpos.mobile_session',true),'')::uuid;merchant:=nullif(current_setting('bitpos.merchant',true),'')::uuid;
 IF command IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('schedule107:'||actor::text||':'||command::text,0));
 SELECT * INTO c FROM schedule107_commands WHERE account_id=actor AND command_id=command;
 IF FOUND THEN
  IF c.operation<>'HOLD'OR c.slot_id IS DISTINCT FROM slot OR c.quote_id IS DISTINCT FROM quote THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  SELECT * INTO h FROM schedule107_holds WHERE id=c.hold_id AND merchant_id=merchant;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
  replayed:=true;
 ELSE
  SELECT * INTO w FROM schedule107_windows WHERE id=slot AND merchant_id=merchant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
  SELECT * INTO q FROM order_quotes WHERE merchant_id=merchant AND id=quote AND origin_kind='online'AND source_account_id=actor FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
  INSERT INTO schedule107_holds(merchant_id,slot_id,quote_id,account_id,session_id,source_request_hash,expires_at)
  VALUES(merchant,slot,quote,actor,sid,q.request_hash,least(q.valid_until,w.booking_closes_at))RETURNING * INTO h;
  INSERT INTO schedule107_commands(account_id,command_id,operation,slot_id,quote_id,hold_id)VALUES(actor,command,'HOLD',slot,quote,h.id);
 END IF;
 RETURN jsonb_build_object('id',h.id,'slotId',h.slot_id,'quoteId',h.quote_id,'state',CASE WHEN h.state='HELD'AND h.expires_at<=clock_timestamp()THEN 'EXPIRED'ELSE h.state END,'expiresAt',h.expires_at,'replayed',replayed,'checkoutReady',false);
END $$;
CREATE FUNCTION schedule107_release(hold uuid,command uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE actor uuid;merchant uuid;h schedule107_holds;c schedule107_commands;replayed boolean:=false;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'SCHEDULE_READ_COMMITTED_REQUIRED';END IF;
 PERFORM dispatch_realtime_actor();actor:=dispatch_live_actor();merchant:=nullif(current_setting('bitpos.merchant',true),'')::uuid;
 IF command IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('schedule107:'||actor::text||':'||command::text,0));
 SELECT * INTO h FROM schedule107_holds WHERE id=hold AND merchant_id=merchant AND account_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND';END IF;
 -- Consistent lock order with hold: window before hold.
 PERFORM 1 FROM schedule107_windows WHERE id=h.slot_id FOR UPDATE;
 SELECT * INTO STRICT h FROM schedule107_holds WHERE id=hold FOR UPDATE;
 SELECT * INTO c FROM schedule107_commands WHERE account_id=actor AND command_id=command;
 IF FOUND THEN
  IF c.operation<>'RELEASE'OR c.hold_id<>hold THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;replayed:=true;
 ELSE
  IF h.state='HELD'THEN UPDATE schedule107_holds SET state=CASE WHEN expires_at<=clock_timestamp()THEN 'EXPIRED'ELSE 'RELEASED'END WHERE id=hold RETURNING * INTO h;END IF;
  INSERT INTO schedule107_commands(account_id,command_id,operation,slot_id,quote_id,hold_id)VALUES(actor,command,'RELEASE',h.slot_id,h.quote_id,h.id);
 END IF;
 RETURN jsonb_build_object('id',h.id,'slotId',h.slot_id,'quoteId',h.quote_id,'state',h.state,'expiresAt',h.expires_at,'replayed',replayed,'checkoutReady',false);
END $$;
-- Enforce a database boundary while order/payment/stock/kitchen lifecycle work
-- is incomplete. A caller cannot accidentally use this hold as checkout proof.
CREATE FUNCTION schedule107_order_gate()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM schedule107_holds WHERE merchant_id=NEW.merchant_id AND quote_id=NEW.quote_id)THEN RAISE EXCEPTION 'SCHEDULE_CHECKOUT_NOT_ADMITTED';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER schedule107_order_gate BEFORE INSERT ON order_authority FOR EACH ROW EXECUTE FUNCTION schedule107_order_gate();
REVOKE ALL ON FUNCTION schedule107_window_guard(),schedule107_hold_guard(),schedule107_hold(uuid,uuid,uuid),schedule107_release(uuid,uuid),schedule107_order_gate() FROM PUBLIC,bitpos_app;

CREATE FUNCTION schedule107_expire(batch integer DEFAULT 50)RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE w record;n integer;total integer:=0;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'SCHEDULE_READ_COMMITTED_REQUIRED';END IF;
 IF batch IS NULL OR batch<1 OR batch>100 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 FOR w IN SELECT s.id FROM schedule107_windows s WHERE EXISTS(SELECT 1 FROM schedule107_holds h WHERE h.slot_id=s.id AND h.state='HELD'AND h.expires_at<=clock_timestamp())ORDER BY s.id LIMIT batch FOR UPDATE SKIP LOCKED LOOP
  UPDATE schedule107_holds h SET state='EXPIRED'WHERE h.slot_id=w.id AND h.state='HELD'AND h.expires_at<=clock_timestamp()AND NOT EXISTS(SELECT 1 FROM order_authority a WHERE a.merchant_id=h.merchant_id AND a.quote_id=h.quote_id);
  GET DIAGNOSTICS n=ROW_COUNT;total:=total+n;
 END LOOP;
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION schedule107_expire(integer)FROM PUBLIC,bitpos_app;
