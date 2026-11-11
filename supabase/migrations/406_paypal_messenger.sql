-- PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
-- Messenger ordering for a PayPal shop (apps/api/src/paypal/messenger.ts). Messages arrive without a tenant, so the
-- app role cannot touch these tables directly, only through the SECURITY DEFINER functions below.
--  * paypal_messenger_messages: one row per signature-verified incoming message id (dedup + per-sender rate limit).
--    The sender is stored only as a salted hash; message text is never stored.
--  * paypal_messenger_orders: the chat that created a bill, so the worker can send ONE "paid" reply after PayPal
--    capture is verified. The page-scoped sender id is kept only until that reply, then erased.
SET search_path TO bitpos,extensions,public;

CREATE TABLE paypal_messenger_messages(
 message_id text PRIMARY KEY CHECK(length(message_id) BETWEEN 1 AND 200),
 sender_hash text NOT NULL CHECK(sender_hash ~ '^[0-9a-f]{64}$'),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX paypal_messenger_messages_sender ON paypal_messenger_messages(sender_hash,received_at);
REVOKE ALL ON paypal_messenger_messages FROM PUBLIC;

CREATE TABLE paypal_messenger_orders(
 merchant_id uuid NOT NULL,
 order_id uuid PRIMARY KEY,
 sender_id text CHECK(sender_id ~ '^[0-9]{5,40}$'),
 table_label text NOT NULL CHECK(length(table_label) BETWEEN 1 AND 60),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 notified_at timestamptz,
 FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id) ON DELETE CASCADE
);
CREATE INDEX paypal_messenger_orders_due ON paypal_messenger_orders(created_at) WHERE notified_at IS NULL;
REVOKE ALL ON paypal_messenger_orders FROM PUBLIC;

-- Returns 'new', 'duplicate' or 'limited' (more than p_max messages from this sender in the last minute).
CREATE FUNCTION bitpos.paypal_messenger_receive(p_message_id text,p_sender_hash text,p_max integer)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
DECLARE v_new boolean;
BEGIN
 INSERT INTO paypal_messenger_messages(message_id,sender_hash) VALUES(p_message_id,p_sender_hash)
 ON CONFLICT(message_id) DO NOTHING RETURNING true INTO v_new;
 IF v_new IS NULL THEN RETURN 'duplicate'; END IF;
 IF (SELECT count(*) FROM paypal_messenger_messages WHERE sender_hash=p_sender_hash AND received_at>clock_timestamp()-interval '1 minute')>p_max THEN RETURN 'limited'; END IF;
 RETURN 'new';
END $$;

CREATE FUNCTION bitpos.paypal_messenger_remember(p_merchant uuid,p_order uuid,p_sender text,p_table text)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 INSERT INTO paypal_messenger_orders(merchant_id,order_id,sender_id,table_label) VALUES(p_merchant,p_order,p_sender,p_table)
 ON CONFLICT(order_id) DO NOTHING;
$$;

-- Bills from chat that are now PAID and not yet answered (oldest first, bounded; skip-locked for several workers).
CREATE FUNCTION bitpos.paypal_messenger_due(p_limit integer)
RETURNS TABLE(order_id uuid,sender_id text,table_label text) LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 SELECT m.order_id,m.sender_id,m.table_label FROM paypal_messenger_orders m JOIN orders o ON o.merchant_id=m.merchant_id AND o.id=m.order_id
 WHERE m.notified_at IS NULL AND m.sender_id IS NOT NULL AND o.status='PAID' AND m.created_at>clock_timestamp()-interval '23 hours'
 ORDER BY m.created_at LIMIT least(greatest(p_limit,1),20) FOR UPDATE OF m SKIP LOCKED;
$$;

-- Marks the paid reply sent (or given up) and erases the sender id.
CREATE FUNCTION bitpos.paypal_messenger_done(p_order uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,bitpos,pg_temp AS $$
 UPDATE paypal_messenger_orders SET notified_at=clock_timestamp(),sender_id=NULL WHERE order_id=p_order;
$$;

REVOKE ALL ON FUNCTION bitpos.paypal_messenger_receive(text,text,integer),bitpos.paypal_messenger_remember(uuid,uuid,text,text),bitpos.paypal_messenger_due(integer),bitpos.paypal_messenger_done(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.paypal_messenger_receive(text,text,integer),bitpos.paypal_messenger_remember(uuid,uuid,text,text),bitpos.paypal_messenger_due(integer),bitpos.paypal_messenger_done(uuid) TO bitpos_app;
