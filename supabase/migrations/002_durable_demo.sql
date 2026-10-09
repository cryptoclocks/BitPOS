SET search_path TO bitpos, public;
ALTER TABLE orders ADD COLUMN reservation_released boolean NOT NULL DEFAULT false;
ALTER TABLE payment_attempts ADD COLUMN signed_base64 text;
ALTER TABLE payment_attempts ADD COLUMN budget_lamports bigint NOT NULL DEFAULT 1000000;
CREATE TABLE sponsor_days(day date PRIMARY KEY, reserved_lamports bigint NOT NULL DEFAULT 0 CHECK(reserved_lamports BETWEEN 0 AND 20000000));
CREATE TABLE sponsor_orders(order_id uuid PRIMARY KEY REFERENCES orders, merchant_id uuid NOT NULL REFERENCES merchants, reserved_lamports bigint NOT NULL DEFAULT 0 CHECK(reserved_lamports BETWEEN 0 AND 1000000));
CREATE TABLE device_state(terminal_id text PRIMARY KEY, merchant_id uuid NOT NULL REFERENCES merchants,last_paid_order uuid,last_paid_version int NOT NULL DEFAULT 0);
CREATE INDEX reconciliation_queue ON payment_attempts(status,created_at);
CREATE INDEX outbox_terminal_queue ON outbox_events(merchant_id,created_at);
GRANT SELECT,INSERT,UPDATE,DELETE ON sponsor_days,sponsor_orders,device_state TO bitpos_app;
-- Capability discovery exposes tenant identifiers only, never order/profile data.
CREATE FUNCTION bitpos.resolve_access(token text) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=bitpos,public AS $$ SELECT merchant_id FROM orders WHERE access_token=token $$;
REVOKE ALL ON FUNCTION bitpos.resolve_access(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.resolve_access(text) TO bitpos_app;
ALTER TABLE sponsor_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON sponsor_orders TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
ALTER TABLE device_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON device_state TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
