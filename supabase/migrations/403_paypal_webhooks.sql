-- PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
-- Verified PayPal webhook inbox. Events arrive without a tenant; the app role cannot read or write the table directly,
-- only through these SECURITY DEFINER functions. A row exists only for signature-verified events; each PayPal event id
-- takes effect once (PayPal retries up to 25 times over 3 days). The event body is never trusted for money:
-- processing re-fetches the order/capture from PayPal.
SET search_path TO bitpos,extensions,public;

CREATE TABLE paypal_webhook_inbox(
 event_id text PRIMARY KEY CHECK(event_id ~ '^WH-[A-Za-z0-9-]{5,100}$'),
 event_type text NOT NULL CHECK(event_type ~ '^[A-Z_.]{3,80}$'),
 resource_type text CHECK(length(resource_type)<=40),
 resource_id text CHECK(resource_id ~ '^[A-Z0-9]{10,30}$'),
 transmission_id text NOT NULL CHECK(length(transmission_id) BETWEEN 1 AND 128),
 body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[0-9a-f]{64}$'),
 redacted jsonb NOT NULL,
 merchant_id uuid,order_id uuid,checkout_id uuid,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 deliveries integer NOT NULL DEFAULT 1 CHECK(deliveries>=1),
 processed_at timestamptz,
 process_attempts integer NOT NULL DEFAULT 0 CHECK(process_attempts>=0),
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_error text CHECK(length(last_error)<=200)
);
CREATE INDEX paypal_webhook_inbox_due ON paypal_webhook_inbox(next_attempt_at) WHERE processed_at IS NULL;
REVOKE ALL ON paypal_webhook_inbox FROM PUBLIC;

-- Returns true when this delivery is the first for its event id.
CREATE FUNCTION bitpos.paypal_webhook_receive(p_event_id text,p_event_type text,p_resource_type text,p_resource_id text,p_transmission_id text,p_body_sha256 text,p_redacted jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE v_new boolean;
BEGIN
 INSERT INTO paypal_webhook_inbox(event_id,event_type,resource_type,resource_id,transmission_id,body_sha256,redacted)
 VALUES(p_event_id,p_event_type,p_resource_type,p_resource_id,p_transmission_id,p_body_sha256,p_redacted)
 ON CONFLICT(event_id) DO UPDATE SET deliveries=paypal_webhook_inbox.deliveries+1
 RETURNING (xmax=0) INTO v_new;
 RETURN v_new;
END $$;

-- Claims due events for one worker; SKIP LOCKED lets several workers run without double processing.
CREATE FUNCTION bitpos.paypal_webhook_claim(p_limit integer)
RETURNS TABLE(event_id text,event_type text,resource_type text,resource_id text,redacted jsonb,process_attempts integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
BEGIN
 RETURN QUERY
 WITH due AS (
  SELECT i.event_id FROM paypal_webhook_inbox i
  WHERE i.processed_at IS NULL AND i.next_attempt_at<=clock_timestamp() AND i.process_attempts<10
  ORDER BY i.received_at LIMIT greatest(1,least(p_limit,50)) FOR UPDATE SKIP LOCKED)
 UPDATE paypal_webhook_inbox i SET process_attempts=i.process_attempts+1,next_attempt_at=clock_timestamp()+interval '60 seconds'
 FROM due WHERE i.event_id=due.event_id
 RETURNING i.event_id,i.event_type,i.resource_type,i.resource_id,i.redacted,i.process_attempts;
END $$;

CREATE FUNCTION bitpos.paypal_webhook_done(p_event_id text,p_merchant uuid,p_order uuid,p_checkout uuid,p_error text)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 UPDATE paypal_webhook_inbox SET merchant_id=coalesce(p_merchant,merchant_id),order_id=coalesce(p_order,order_id),checkout_id=coalesce(p_checkout,checkout_id),
  processed_at=CASE WHEN p_error IS NULL THEN clock_timestamp() END,last_error=left(p_error,200),
  next_attempt_at=CASE WHEN p_error IS NULL THEN next_attempt_at ELSE clock_timestamp()+least(interval '1 hour',interval '30 seconds'*power(2,least(process_attempts,7))) END
 WHERE event_id=p_event_id;
$$;

-- Read-only diagnostics for one shop's merchant screen (no other shop's events).
CREATE FUNCTION bitpos.paypal_webhook_recent(p_merchant uuid,p_limit integer)
RETURNS TABLE(event_id text,event_type text,resource_id text,checkout_id uuid,received_at timestamptz,deliveries integer,processed_at timestamptz,process_attempts integer,last_error text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT event_id,event_type,resource_id,checkout_id,received_at,deliveries,processed_at,process_attempts,last_error FROM paypal_webhook_inbox
 WHERE merchant_id=p_merchant AND current_setting('bitpos.merchant',true)=p_merchant::text
 ORDER BY received_at DESC LIMIT greatest(1,least(p_limit,100));
$$;

REVOKE ALL ON FUNCTION bitpos.paypal_webhook_receive(text,text,text,text,text,text,jsonb),bitpos.paypal_webhook_claim(integer),bitpos.paypal_webhook_done(text,uuid,uuid,uuid,text),bitpos.paypal_webhook_recent(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.paypal_webhook_receive(text,text,text,text,text,text,jsonb),bitpos.paypal_webhook_claim(integer),bitpos.paypal_webhook_done(text,uuid,uuid,uuid,text),bitpos.paypal_webhook_recent(uuid,integer) TO bitpos_app;

-- The worker must find due PayPal checkouts across shops without reading their payment rows (same pattern as the
-- existing actionable-merchant lookup): ids only.
CREATE FUNCTION bitpos.paypal_due_merchants() RETURNS TABLE(merchant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT DISTINCT c.merchant_id FROM paypal_checkouts c
 WHERE c.status IN ('CREATING','APPROVED','CAPTURING','PENDING','UNKNOWN') AND (c.next_check_at IS NULL OR c.next_check_at<=clock_timestamp())
 UNION SELECT DISTINCT c.merchant_id FROM paypal_checkouts c WHERE c.status='CREATED' AND c.expires_at<=clock_timestamp();
$$;
REVOKE ALL ON FUNCTION bitpos.paypal_due_merchants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.paypal_due_merchants() TO bitpos_app;
